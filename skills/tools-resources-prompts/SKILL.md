---
name: nitrostack-tools-resources-prompts
description: Guidelines and patterns for defining Tools, Resources, and Prompts in a NitroStack application with schema validation via Zod, examples, MCP Tasks, MRTR interactive flows, caching, rate-limiting, and base64 file uploads.
---

## When to Use
Use this skill whenever you are defining, updating, or validating tools, resources, or prompts on a NitroStack MCP server, configuring execution policies (caching, rate limiting), managing asynchronous tasks, implementing interactive multi-round-trip flows, or handling file uploads.

---

## 1. Overview & Tool Execution Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│               NitroStack Tools, Tasks & Interactive Flows              │
├────────────────────────────────────────────────────────────────────────┤
│  Client Invocation (tools/call)                                        │
│                                │                                       │
│                                ▼                                       │
│  [ Policy Evaluation ]         ──> Check @RateLimit & @Cache Hit       │
│                                │                                       │
│                                ▼                                       │
│  [ Schema Validation ]         ──> Validate input against Zod schema   │
│                                │                                       │
│                                ▼                                       │
│  [ Execution Mode ]            ──> Standard / Async Task / MRTR        │
│       ├─ Standard Execution    ──> Return output matching outputSchema │
│       ├─ MCP Task Context      ──> ctx.task.updateProgress / Cancel    │
│       └─ SEP-2322 MRTR Flow    ──> inputRequired() interactive pause   │
│                                │                                       │
│                                ▼                                       │
│  Client Response Delivered with Tool Result & Widget Metadata          │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Defining Tools (`@Tool`)

An MCP tool exposes a callable function to AI clients. Decorate a provider or controller method with `@ToolDecorator` (aliased as `@Tool`).

### Tool Decorator Options

| Option | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique kebab-case or snake_case tool identifier. |
| `description` | `string` | Clear description explaining purpose, parameters, and return format to LLMs. |
| `inputSchema` | `ZodSchema` | Zod object schema for strict runtime validation of input arguments. |
| `outputSchema` | `ZodSchema` | (Optional) Zod schema validating the structure of returned results. |
| `examples` | `{ request: any; response: any }` | (Recommended) Sample request/response payloads for client prompting and NitroStudio preview. |
| `taskSupport` | `'forbidden' \| 'optional' \| 'required'` | Task execution policy for long-running async background operations. |

### Complete Tool Example with Output Schema & Examples

```typescript
import { ToolDecorator as Tool, ControllerDecorator as Controller, ExecutionContext, z } from '@nitrostack/core';

@Controller('billing')
export class BillingTools {
  @Tool({
    name: 'calculate_tax',
    description: 'Calculate regional sales tax and total for an order line item',
    inputSchema: z.object({
      amount: z.number().positive().describe('The pre-tax amount in dollars'),
      region: z.string().length(2).describe('Two-letter state or province code (e.g. CA, NY)'),
    }),
    outputSchema: z.object({
      amount: z.number(),
      taxRate: z.number(),
      taxAmount: z.number(),
      total: z.number(),
    }),
    examples: {
      request: { amount: 100, region: 'CA' },
      response: { amount: 100, taxRate: 0.0825, taxAmount: 8.25, total: 108.25 },
    },
  })
  async calculateTax(input: { amount: number; region: string }, ctx: ExecutionContext) {
    ctx.logger.info(`Calculating tax for $${input.amount} in ${input.region}`);
    
    const taxRates: Record<string, number> = { CA: 0.0825, NY: 0.08875, TX: 0.0625 };
    const taxRate = taxRates[input.region.toUpperCase()] || 0.05;
    const taxAmount = Math.round(input.amount * taxRate * 100) / 100;
    const total = Math.round((input.amount + taxAmount) * 100) / 100;

    return {
      amount: input.amount,
      taxRate,
      taxAmount,
      total,
    };
  }
}
```

---

## 3. Initial Tools (`@InitialTool`)

Decorate a tool with `@InitialTool()` to mark it as the session bootstrap tool. Compatible MCP clients and NitroStudio automatically invoke this tool upon establishing a session connection.

```typescript
import { ToolDecorator as Tool, InitialTool, ExecutionContext, z } from '@nitrostack/core';

export class WorkspaceTools {
  @Tool({
    name: 'bootstrap_workspace',
    description: 'Initial session initialization tool executed on client connect',
    inputSchema: z.object({}),
  })
  @InitialTool()
  async bootstrapSession(input: Record<string, never>, ctx: ExecutionContext) {
    ctx.logger.info(`Session initialized for client: ${ctx.clientInfo?.name || 'unknown'}`);
    return {
      status: 'ready',
      version: '1.0.0',
      serverTime: new Date().toISOString(),
      activeSessionId: ctx.sessionId,
    };
  }
}
```

---

## 4. MCP Tasks (Long-Running Asynchronous Operations)

For tools that take significant time to execute (e.g., deep file scanning, large dataset exports, multi-step migrations), configure `taskSupport` on `@Tool`.

### Task Support Modes
* `'forbidden'` (default): Tool runs synchronously within standard request timeout.
* `'optional'`: Client can invoke tool either synchronously or as an async task.
* `'required'`: Client MUST invoke tool as an async task.

### Using `ctx.task` API
When invoked as a task, `ctx.task` is automatically populated on `ExecutionContext`:
* `ctx.task.updateProgress(message: string)`: Sends a progress notification to the client.
* `ctx.task.throwIfCancelled()`: Throws immediately if the client has aborted or cancelled the task.
* `ctx.task.isCancelled`: Boolean indicating cancellation status.
* `ctx.task.requestInput(message: string)`: Solicits intermediate input from the client.
* `ctx.task.update?(message: string, data?: JsonValue)`: Pushes an intermediate data update (spec `2026-07-28`).

```typescript
import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';

export class DataProcessingTools {
  @Tool({
    name: 'process_large_dataset',
    description: 'Processes large records dataset asynchronously with progress reporting',
    taskSupport: 'optional',
    inputSchema: z.object({
      datasetUri: z.string().describe('URI of the dataset to process'),
      batchSize: z.number().default(100),
    }),
  })
  async processDataset(input: { datasetUri: string; batchSize: number }, ctx: ExecutionContext) {
    const totalBatches = 10;

    for (let batch = 1; batch <= totalBatches; batch++) {
      // Check cancellation before intensive work
      if (ctx.task) {
        ctx.task.throwIfCancelled();
        ctx.task.updateProgress(`Processing batch ${batch} of ${totalBatches}...`);
      }

      // Simulate batch processing
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return {
      success: true,
      recordsProcessed: totalBatches * input.batchSize,
      completedAt: new Date().toISOString(),
    };
  }
}
```

---

## 5. Interactive Multi Round-Trip Requests (MRTR / SEP-2322)

Multi Round-Trip Requests allow a tool to pause execution and request user approval, confirmation, or clarification from the client before committing state changes.

Use `inputRequired` to pause execution, and `acceptedContent` to inspect answers provided on the resumed turn:

```typescript
import {
  ToolDecorator as Tool,
  ExecutionContext,
  inputRequired,
  acceptedContent,
  z,
} from '@nitrostack/core';

export class FinancialTools {
  @Tool({
    name: 'transfer_funds',
    description: 'Transfer funds between accounts with interactive human confirmation',
    inputSchema: z.object({
      recipientAccount: z.string().describe('Target account ID'),
      amount: z.number().positive().describe('Transfer amount in USD'),
    }),
  })
  async transferFunds(
    input: { recipientAccount: string; amount: number },
    ctx: ExecutionContext,
  ) {
    const confirmationId = 'confirm_fund_transfer';

    // 1. Check if client has already provided the confirmation answer
    if (!acceptedContent(ctx.inputResponses, confirmationId)) {
      // 2. Pause and request interactive user input
      return inputRequired({
        requests: [
          {
            id: confirmationId,
            message: `Please confirm: Authorize wire transfer of $${input.amount} to account ${input.recipientAccount}?`,
            schema: { type: 'boolean' },
          },
        ],
        requestState: {
          recipientAccount: input.recipientAccount,
          amount: input.amount,
        },
      });
    }

    // 3. User confirmed: extract response value and execute transfer
    const confirmed = ctx.inputResponses?.[confirmationId] === true;
    if (!confirmed) {
      return { status: 'cancelled', message: 'Transfer cancelled by user.' };
    }

    return {
      status: 'completed',
      txId: `tx-${Date.now()}`,
      amount: input.amount,
      recipientAccount: input.recipientAccount,
    };
  }
}
```

---

## 6. Execution Policies: Caching (`@Cache`) and Rate Limiting (`@RateLimit`)

Control performance and throttle requests using declarative method decorators.

### 1. Caching with `@Cache`
Caches tool execution results for a specified duration in seconds:
* `ttl`: Time-to-live in seconds (required).
* `key` (optional): Function `(input: any, ctx?: ExecutionContext) => string` to generate cache keys.

```typescript
import { ToolDecorator as Tool, Cache, z } from '@nitrostack/core';

export class MarketTools {
  @Tool({
    name: 'get_stock_quote',
    description: 'Fetch real-time stock quote. Cached for 60 seconds per ticker.',
    inputSchema: z.object({ symbol: z.string() }),
  })
  @Cache({
    ttl: 60,
    key: (input) => `quote:${input.symbol.toUpperCase()}`,
  })
  async getQuote(input: { symbol: string }) {
    // API request is only executed once every 60 seconds per symbol
    return { symbol: input.symbol.toUpperCase(), price: 142.50, timestamp: Date.now() };
  }
}
```

### 2. Rate Limiting with `@RateLimit`
Restricts tool invocation counts across rolling time windows:
* `requests`: Maximum allowed calls within the window (required).
* `window`: Throttling duration format (e.g. `'1s'`, `'1m'`, `'1h'`).
* `key` (optional): Function `(ctx: ExecutionContext) => string` to scope limits per user, token, or session.

```typescript
import { ToolDecorator as Tool, RateLimit, ExecutionContext, z } from '@nitrostack/core';

export class AdminOpsTools {
  @Tool({
    name: 'sync_database',
    description: 'Triggers heavy database synchronization. Heavily rate limited.',
    inputSchema: z.object({}),
  })
  @RateLimit({
    requests: 5,
    window: '1h',
    key: (ctx: ExecutionContext) => ctx.auth?.subject || ctx.sessionId || 'anonymous',
  })
  async syncDatabase(input: Record<string, never>, ctx: ExecutionContext) {
    ctx.logger.info('Running database sync...');
    return { status: 'sync_started' };
  }
}
```

---

## 7. Defining Resources (`@Resource`)

An MCP resource exposes read-only static or dynamic URIs to AI clients.

### Resource Decorator Options
* `uri`: URI pattern (e.g. `app://config` or parameterized `file://{owner}/{repo}/README.md`).
* `name`: Human-readable name.
* `description`: Contextual summary of the content returned.
* `mimeType`: Content type header (e.g. `'application/json'`, `'text/plain'`).
* `examples`: Sample resource payload for client inspection.

```typescript
import { Resource, ExecutionContext } from '@nitrostack/core';

export class SystemResources {
  @Resource({
    uri: 'system://metrics',
    name: 'System Telemetry',
    description: 'Current memory usage and process uptime telemetry',
    mimeType: 'application/json',
    examples: {
      response: { uptimeSec: 3600, memoryMb: 128 },
    },
  })
  async getMetrics(ctx: ExecutionContext) {
    return {
      uptimeSec: Math.floor(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    };
  }
}
```

---

## 8. Defining Prompts (`@Prompt`)

MCP prompts expose reusable instruction templates that guide LLM reasoning and behavior.

### Prompt Decorator Options
* `name`: Unique prompt identifier.
* `description`: Explains what task or role this prompt template enables.
* `arguments`: Declares input variables accepted by the template.

```typescript
import { Prompt, ExecutionContext } from '@nitrostack/core';

export class EngineeringPrompts {
  @Prompt({
    name: 'explain_code',
    description: 'Guides the model to provide a clear technical walkthrough of code',
    arguments: [
      { name: 'language', description: 'Programming language (e.g. TypeScript, Python)', required: true },
      { name: 'code', description: 'The source code snippet to explain', required: true },
    ],
  })
  async explainCode(args: { language: string; code: string }, ctx: ExecutionContext) {
    return {
      messages: [
        {
          role: 'user',
          content: `You are an expert software engineer. Walk through the following ${args.language} code step-by-step and explain its architecture and performance:\n\n\`\`\`${args.language}\n${args.code}\n\`\`\``,
        },
      ],
    };
  }
}
```

---

## 9. Secure Base64 File Uploads

When receiving files from MCP clients or NitroStudio, accept them as base64-encoded strings with path sanitization to prevent path traversal attacks.

### 1. Schema Definition
Define three required parameters: `file_name`, `file_type`, and `file_content`.

### 2. Universal Decoder Helper
Handles both standard Data URLs (`data:...;base64,...`) and raw base64 payloads:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';

function decodeBase64Content(content: string): Buffer {
  const dataUrlMatch = content.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
  if (dataUrlMatch && dataUrlMatch.length === 3) {
    return Buffer.from(dataUrlMatch[2], 'base64');
  }
  return Buffer.from(content, 'base64');
}

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

export class DocumentUploadTools {
  @Tool({
    name: 'upload_document',
    description: 'Decodes and safely saves an uploaded file to the server workspace',
    inputSchema: z.object({
      file_name: z.string().describe('File name including extension (e.g. report.pdf)'),
      file_type: z.string().describe('MIME type (e.g. application/pdf)'),
      file_content: z.string().describe('Base64 encoded string of file bytes'),
    }),
  })
  async uploadDocument(
    input: { file_name: string; file_type: string; file_content: string },
    ctx: ExecutionContext,
  ) {
    // 1. Ensure upload directory exists
    if (!fs.existsSync(UPLOAD_ROOT)) {
      fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
    }

    // 2. Strict path traversal defense: strip directories using path.basename
    const safeFileName = path.basename(input.file_name);
    const destinationPath = path.resolve(UPLOAD_ROOT, safeFileName);

    if (!destinationPath.startsWith(UPLOAD_ROOT)) {
      throw new Error('Access denied: directory traversal path detected.');
    }

    // 3. Decode base64 buffer and write file
    const fileBuffer = decodeBase64Content(input.file_content);
    fs.writeFileSync(destinationPath, fileBuffer);

    ctx.logger.info(`Saved uploaded file: ${safeFileName} (${fileBuffer.length} bytes)`);

    return {
      success: true,
      fileName: safeFileName,
      sizeBytes: fileBuffer.length,
      savedAt: destinationPath,
    };
  }
}
```
