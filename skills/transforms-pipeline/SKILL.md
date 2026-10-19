---
name: nitrostack-transforms-pipeline
description: Best practices for implementing MCP protocol transforms in NitroStack, including BM25 progressive tool discovery, sandboxed Code Mode WASM execution, and dynamic session visibility.
---

## When to Use
Use this skill when developing large enterprise MCP servers with dozens of tools, optimizing LLM prompt token consumption, implementing progressive tool discovery, executing batch data pipelines inside isolated WebAssembly sandboxes, or dynamically scoping tool visibility per session.

---

## 1. Context Window Protection Architecture

As an MCP server grows from a handful of tools to dozens or hundreds, exposing all tool definitions upfront in `tools/list` introduces **Tool Schema Bloat**: thousands of tokens are consumed on every user message before the conversation even begins.

NitroStack resolves this through its **Transforms Pipeline**, which intercepts client protocol requests and dynamically transforms the visible tool catalog:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   Context Window Protection Architecture               │
├────────────────────────────────────────────────────────────────────────┤
│  Client Prompt / Model Query                                           │
│                                │                                       │
│                                ▼                                       │
│  [ Transforms Pipeline ]       ──> BM25 Search / Code Mode WASM        │
│  - Hides 98% of tool schemas   ──> Injects search_tools & call_tool    │
│  - Dynamically exposes tools   ──> QuickJS isolated script execution   │
│                                │                                       │
│                                ▼                                       │
│  [ Tool Execution ]            ──> Database query / API fetch          │
│                                │                                       │
│                                ▼                                       │
│  [ Data Spillover Check ]      ──> Payload > maxPayloadBytes (10KB)    │
│  - Full data saved to store    ──> Memory or FsSpilloverStore          │
│  - Returns SpilloverEnvelope   ──> Preview + resourceUri pointer       │
│                                │                                       │
│                                ▼                                       │
│  Compact Result with 'resource://data-spillover/{id}' delivered to LLM │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Progressive Tool Discovery (`BM25SearchTransform`)

The `BM25SearchTransform` hides underlying tool schemas from the initial `tools/list` handshake. Instead, it builds an in-memory Okapi BM25 relevance index over all tool names, descriptions, and parameter definitions, exposing only two lightweight meta-tools:
1. `search_tools`: Searches the catalog for relevant capabilities based on the model's natural language intent.
2. `call_tool`: Dispatches the invocation to the discovered tool, validating input against the tool's Zod schema before running.

This reduces prompt token overhead by **up to 98%**, scaling to hundreds of enterprise tools without degrading LLM reasoning.

### Configuring `@McpApp` with BM25 Search

```typescript
// src/app.module.ts
import { McpApp, Module, BM25SearchTransform } from '@nitrostack/core';
import { CatalogModule } from './catalog/catalog.module.js';
import { OrdersModule } from './orders/orders.module.js';

@McpApp({
  module: AppModule,
  server: { name: 'enterprise-server', version: '1.0.0' },
  transforms: [
    new BM25SearchTransform({
      defaultLimit: 5,                  // Default max tools returned per search
      defaultDetail: 'detailed',        // 'brief' | 'detailed' | 'full'
      alwaysVisible: [                  // Critical tools exposed directly in tools/list
        'bootstrap_workspace',
        'auth_login',
        'system_status',
      ],
      nameBoost: 2.5,                   // BM25 term weighting boosts
      descBoost: 1.0,
      paramBoost: 0.8,
    }),
  ],
})
@Module({
  imports: [CatalogModule, OrdersModule],
})
export class AppModule {}
```

### Injected Meta-Tools Behavior

#### `search_tools`
Invoked by the LLM when it needs to discover capabilities for a specific task:
* **Input**: `{ query: string, limit?: number }`
* **Output**: Ranked array of matching tools with descriptions and parameter summaries.
* **Detail Levels**:
  * `'brief'`: Tool name and description only.
  * `'detailed'`: Tool name, description, and parameter names.
  * `'full'`: Complete JSON Schema for all input arguments.

#### `call_tool`
Invoked by the LLM to execute a discovered tool:
* **Input**: `{ name: string, arguments: Record<string, unknown> }`
* **Validation**: NitroStack automatically resolves the target tool, verifies visibility permissions, validates input against the tool's registered Zod schema, and executes the handler through the full pipeline (Guards, Middleware, Interceptors, Pipes).

---

## 3. Sandboxed Code Mode (`CodeModeTransform`)

For complex agent workflows that require multi-step data manipulation, calling tools sequentially over JSON-RPC introduces multiple round-trip network latencies and risks leaking intermediate raw payloads into the prompt context.

The `CodeModeTransform` runs an isolated **QuickJS WebAssembly sandbox** directly inside the server process. Instead of making 10 individual tool calls back and forth, the model writes a JavaScript script that stitches multiple tools together in a single execution.

### Configuring `@McpApp` with Code Mode

```typescript
// src/app.module.ts
import { McpApp, Module, CodeModeTransform } from '@nitrostack/core';
import { AnalyticsModule } from './analytics/analytics.module.js';

@McpApp({
  module: AppModule,
  server: { name: 'analytics-mcp-server', version: '1.0.0' },
  transforms: [
    new CodeModeTransform({
      workerPoolSize: 4,          // Concurrent QuickJS WASM worker threads
      memoryLimitMb: 128,         // Maximum RAM cap per VM sandbox instance
      timeoutMs: 15000,           // Execution timeout before hard abort (15s)
      maxToolCalls: 50,           // Maximum nested tool calls per script
      allowDestructive: false,    // Block execution of tools flagged destructiveHint: true
      alwaysVisible: ['ping'],    // Tools that remain directly accessible
    }),
  ],
})
@Module({
  imports: [AnalyticsModule],
})
export class AppModule {}
```

### Injected Code Mode Meta-Tools

When `CodeModeTransform` is enabled, the server presents three meta-tools:
1. `search({ query, limit })`: Discovers tool names and summaries matching the script's goal.
2. `get_schema({ toolName })`: Inspects the exact Zod input and output schemas for a target tool.
3. `execute({ code })`: Runs JavaScript code in the QuickJS WebAssembly sandbox.

### Sandboxed Script Execution Example
Inside the `execute` sandbox, the model invokes tools via the global asynchronous `await callTool(name, args)` helper:

```javascript
// Example script submitted by the LLM to execute({ code })
async function run() {
  // 1. Fetch user records
  const users = await callTool('get_active_users', { department: 'Engineering' });
  
  // 2. Filter and calculate metrics inside the sandbox without round-trip latency
  const highSpenders = [];
  for (const user of users) {
    const expenses = await callTool('get_user_expenses', { userId: user.id });
    const total = expenses.reduce((sum, item) => sum + item.amount, 0);
    if (total > 5000) {
      highSpenders.push({ id: user.id, name: user.name, totalExpenses: total });
    }
  }

  // 3. Return only the aggregated summary to the model
  return {
    analyzedUsers: users.length,
    flaggedCount: highSpenders.length,
    highSpenders,
  };
}
```

---

## 4. Dynamic Session Visibility (`VisibilityTransform`)

The `VisibilityTransform` enables conditional tool exposure scoped to the active session or authenticated principal. Sensitive tools can remain completely hidden from `tools/list` until unlocked via authentication or workflow milestones.

### Registering `VisibilityTransform`

```typescript
// src/app.module.ts
import { McpApp, Module, VisibilityTransform } from '@nitrostack/core';
import { WorkspaceTools } from './workspace.tools.js';

@McpApp({
  module: AppModule,
  server: { name: 'secure-workspace-server', version: '1.0.0' },
  transforms: [
    new VisibilityTransform(),
  ],
})
@Module({
  providers: [WorkspaceTools],
})
export class AppModule {}
```

### Declaring Hidden Tools & Dynamic Unlocking

Use `visibility: 'hidden'` on `@Tool` to conceal a tool from the catalog. To expose it dynamically, call `ctx.enableTools(['tool_name'])`.

> [!IMPORTANT]
> `ctx.enableTools` and `ctx.disableTools` require an **array of strings** (`string[]`).

```typescript
// src/workspace.tools.ts
import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';

export class WorkspaceTools {
  // 1. Tool hidden by default from tools/list
  @Tool({
    name: 'wire_funds',
    description: 'Execute high-value bank wire transfer',
    visibility: 'hidden',
    inputSchema: z.object({
      recipient: z.string(),
      amount: z.number().positive(),
    }),
  })
  async wireFunds(input: { recipient: string; amount: number }) {
    return { status: 'transferred', amount: input.amount, to: input.recipient };
  }

  // 2. Unlocking tool that dynamically exposes sensitive tools for the session
  @Tool({
    name: 'authenticate_admin',
    description: 'Verify admin credentials and unlock privileged tools',
    inputSchema: z.object({
      totpCode: z.string().length(6),
    }),
  })
  async authenticateAdmin(input: { totpCode: string }, ctx: ExecutionContext) {
    if (input.totpCode !== '123456') {
      throw new Error('Invalid authentication code.');
    }

    // Dynamically reveal the tool for the active session
    if (ctx.enableTools) {
      await ctx.enableTools(['wire_funds']);
      ctx.logger.info(`Unlocked wire_funds for session: ${ctx.sessionId}`);
    }

    return {
      authenticated: true,
      message: 'Admin authorization granted. Tool "wire_funds" is now available.',
    };
  }

  // 3. Lock tool that re-hides sensitive tools
  @Tool({
    name: 'revoke_session',
    description: 'Lock privileged tools and end administrative session',
    inputSchema: z.object({}),
  })
  async revokeSession(input: Record<string, never>, ctx: ExecutionContext) {
    if (ctx.disableTools) {
      await ctx.disableTools(['wire_funds']);
      ctx.logger.info(`Locked wire_funds for session: ${ctx.sessionId}`);
    }
    return { revoked: true };
  }
}
```

---

## 5. Combining Transforms in the Pipeline

Transforms execute sequentially in the order defined in `@McpApp({ transforms: [...] })`. 

When combining `VisibilityTransform` and `BM25SearchTransform`:
1. Place `VisibilityTransform` **first**: It filters the active tool catalog based on session authorization.
2. Place `BM25SearchTransform` **second**: It indexes only the tools that are visible to the current session, ensuring unauthenticated sessions cannot discover hidden tools through search queries.

```typescript
@McpApp({
  module: AppModule,
  server: { name: 'hardened-server', version: '1.0.0' },
  transforms: [
    new VisibilityTransform(),
    new BM25SearchTransform({
      defaultLimit: 5,
      alwaysVisible: ['authenticate_admin', 'bootstrap_session'],
    }),
  ],
})
export class AppModule {}
```
