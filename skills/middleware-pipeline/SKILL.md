---
name: nitrostack-middleware-pipeline
description: Best practices for implementing and applying Guards, Interceptors, Middleware, Pipes, Exception Filters, and managing ExecutionContext and tool visibility in the NitroStack SDK.
---

## When to Use
Use this skill whenever you are designing or implementing request validation, authorization checks, pre/post execution interception, logging, error translation, or dynamic tool visibility in NitroStack.

---

## 1. Pipeline Execution Sequence

Every incoming MCP request (tool invocation, resource fetch, prompt evaluation) flows through a deterministic multi-stage execution pipeline:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NitroStack Pipeline Lifecycle Order                  │
├────────────────────────────────────────────────────────────────────────┤
│  Incoming MCP Request (Tools / Resources / Prompts)                    │
│                                │                                       │
│                                ▼                                       │
│  1. Guards (@UseGuards)        ──> Check Auth & Roles (Boolean)        │
│                                │                                       │
│                                ▼                                       │
│  2. Middleware (@UseMiddleware)──> Pre-execution logic (Logging)       │
│                                │                                       │
│                                ▼                                       │
│  3. Interceptors (Pre-call)    ──> Mutate context / Start stopwatch    │
│                                │                                       │
│                                ▼                                       │
│  4. Pipes (@UsePipes)          ──> Validate & Transform inputs (Zod)   │
│                                │                                       │
│                                ▼                                       │
│  5. Tool Handler Method        ──> Execute business logic / DB service │
│                                │                                       │
│                                ▼                                       │
│  6. Interceptors (Post-call)   ──> Response mapping / Spillover check  │
│                                │                                       │
│                                ▼                                       │
│  7. Exception Filters          ──> Catch errors & map JSON payload     │
│                                │                                       │
│                                ▼                                       │
│  Response delivered to MCP Client                                      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. ExecutionContext API Reference

The `ExecutionContext` object is supplied to all pipeline stages and tool handlers. It provides request metadata, logging utilities, authentication claims, session identifiers, and runtime controls.

### Property & Method Reference

| Property / Method | Type | Description |
| :--- | :--- | :--- |
| `requestId` | `string` | Unique UUID assigned to the incoming request for distributed tracing. |
| `toolName?` | `string` | The resolved name of the tool currently being invoked. |
| `logger` | `Logger` | Scoped logger with `debug()`, `info()`, `warn()`, `error()` methods. |
| `metadata?` | `Record<string, JsonValue>` | Request headers, transport-level metadata, and client parameters. |
| `auth?` | `AuthContext` | Authenticated subject (`subject`), granted scopes (`scopes`), and tokens. |
| `sessionId?` | `string` | Isolation key (`anon:<session>` or `user:<subject>:<session>`) for session scoping. |
| `abortSignal?` | `AbortSignal` | Observed for client disconnects, timeouts, or worker sandbox termination. |
| `task?` | `TaskContext` | Task handle (`updateProgress`, `requestInput`, `throwIfCancelled`, `isCancelled`). |
| `enableTools?(names: string[])` | `Promise<void>` | Dynamically exposes an array of tool names for this session. |
| `disableTools?(names: string[])` | `Promise<void>` | Dynamically hides an array of tool names for this session. |
| `getVisibleTools?()` | `Set<string> \| undefined` | Returns the set of currently visible tools for this session. |
| `protocolVersion?` | `string` | Negotiated protocol era (e.g. `'2026-07-28'`). |
| `requestState?` | `JsonValue` | Opaque state persisted across interactive Multi Round-Trip turns (SEP-2322). |
| `inputResponses?` | `Record<string, JsonValue>` | User-submitted inputs responding to a prior `inputRequired(...)` turn. |
| `trace?` | `{ traceparent?; tracestate?; baggage? }` | W3C distributed trace context (SEP-414). |
| `clientInfo?` | `{ name?; version? }` | Client software identity from request envelope (SEP-2575). |

---

## 3. Guards (`Guard` and `@UseGuards`)

Guards execute first. They evaluate whether the request is authorized to proceed based on authentication tokens, client metadata, or user roles.

### Interface
```typescript
import { ExecutionContext } from '@nitrostack/core';

export interface Guard {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}
```

### Implementation & Binding
```typescript
import { Injectable, Guard, ExecutionContext, ToolDecorator as Tool, UseGuards, z } from '@nitrostack/core';

@Injectable({ deps: [] })
export class RolesGuard implements Guard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const userRole = context.auth?.role;
    if (userRole !== 'admin') {
      context.logger.warn(`Unauthorized access attempt by ${context.auth?.subject || 'anonymous'}`);
      return false;
    }
    return true;
  }
}

export class ManagementTools {
  @Tool({
    name: 'purge_cache',
    description: 'Purge internal application cache. Admin only.',
    inputSchema: z.object({}),
  })
  @UseGuards(RolesGuard)
  async purgeCache(input: Record<string, never>, ctx: ExecutionContext) {
    ctx.logger.info('Purging cache...');
    return { purged: true };
  }
}
```

---

## 4. Middleware (`MiddlewareInterface` and `@UseMiddleware`)

Middleware runs after guards. It is suitable for request auditing, timer starts, and global request validation.

### Interface
```typescript
import { ExecutionContext } from '@nitrostack/core';

export interface MiddlewareInterface {
  use(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown>;
}
```

### Implementation & Binding
```typescript
import { Middleware, MiddlewareInterface, ExecutionContext, ToolDecorator as Tool, UseMiddleware, z } from '@nitrostack/core';

@Middleware()
export class RequestLoggerMiddleware implements MiddlewareInterface {
  async use(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
    context.logger.info(`[Pipeline] Entering tool: ${context.toolName} (Req: ${context.requestId})`);
    try {
      const result = await next();
      context.logger.info(`[Pipeline] Exited tool: ${context.toolName} successfully`);
      return result;
    } catch (error) {
      context.logger.error(`[Pipeline] Tool ${context.toolName} threw error: ${error}`);
      throw error;
    }
  }
}

export class ReportingTools {
  @Tool({
    name: 'generate_analytics',
    description: 'Generates telemetry report',
    inputSchema: z.object({}),
  })
  @UseMiddleware(RequestLoggerMiddleware)
  async generateAnalytics() {
    return { reports: [] };
  }
}
```

---

## 5. Interceptors (`InterceptorInterface` and `@UseInterceptors`)

Interceptors wrap both the execution and result mapping of the tool handler. They can benchmark execution, transform response structures, or trigger data spillover.

### Interface
```typescript
import { ExecutionContext } from '@nitrostack/core';

export interface InterceptorInterface {
  intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown>;
}
```

### Implementation & Binding
```typescript
import { Injectable, InterceptorInterface, ExecutionContext, ToolDecorator as Tool, UseInterceptors, z } from '@nitrostack/core';

@Injectable({ deps: [] })
export class BenchmarkInterceptor implements InterceptorInterface {
  async intercept(context: ExecutionContext, next: () => Promise<unknown>): Promise<unknown> {
    const start = performance.now();
    const result = await next();
    const elapsedMs = Math.round(performance.now() - start);

    context.logger.info(`Tool ${context.toolName} executed in ${elapsedMs}ms`);

    if (result && typeof result === 'object' && !Array.isArray(result)) {
      return {
        ...result,
        _telemetry: { executionTimeMs: elapsedMs },
      };
    }
    return result;
  }
}

export class SearchTools {
  @Tool({
    name: 'query_records',
    description: 'Query database records with timing metrics',
    inputSchema: z.object({ query: z.string() }),
  })
  @UseInterceptors(BenchmarkInterceptor)
  async queryRecords(input: { query: string }) {
    return { records: ['rec-1', 'rec-2'] };
  }
}
```

---

## 6. Pipes (`PipeInterface` and `@UsePipes`)

Pipes validate and sanitize input arguments before they reach the tool handler method.

### Interface
```typescript
import { ArgumentMetadata } from '@nitrostack/core';

export interface PipeInterface<T = unknown, R = unknown> {
  transform(value: T, metadata: ArgumentMetadata): R | Promise<R>;
}
```

### Implementation & Binding
```typescript
import { Pipe, PipeInterface, ArgumentMetadata, ToolDecorator as Tool, UsePipes, z } from '@nitrostack/core';

@Pipe()
export class SanitizeInputPipe implements PipeInterface<Record<string, unknown>, Record<string, unknown>> {
  transform(value: Record<string, unknown>, metadata: ArgumentMetadata) {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[key] = typeof val === 'string' ? val.trim() : val;
    }
    return sanitized;
  }
}

export class NotificationTools {
  @Tool({
    name: 'send_sms',
    description: 'Sends SMS message with sanitized whitespace',
    inputSchema: z.object({ text: z.string() }),
  })
  @UsePipes(SanitizeInputPipe)
  async sendSms(input: { text: string }) {
    return { delivered: true, text: input.text };
  }
}
```

---

## 7. Exception Filters (`ExceptionFilterInterface` and `@UseFilters`)

Exception filters catch uncaught errors thrown anywhere in the pipeline or tool handler, transforming raw errors into structured, user-friendly JSON payloads.

### Interface
```typescript
import { ExecutionContext } from '@nitrostack/core';

export interface ExceptionFilterInterface {
  catch(exception: unknown, context: ExecutionContext): unknown | Promise<unknown>;
}
```

### Implementation & Binding
```typescript
import { Injectable, ExceptionFilterInterface, ExecutionContext, ToolDecorator as Tool, UseFilters, z } from '@nitrostack/core';

@Injectable({ deps: [] })
export class FriendlyExceptionFilter implements ExceptionFilterInterface {
  catch(exception: unknown, context: ExecutionContext) {
    const message = exception instanceof Error ? exception.message : 'Internal tool error';
    context.logger.error(`Exception in ${context.toolName}: ${message}`);

    return {
      error: true,
      message,
      requestId: context.requestId,
      timestamp: new Date().toISOString(),
    };
  }
}

export class ComputeTools {
  @Tool({
    name: 'perform_division',
    description: 'Safely divides two numbers',
    inputSchema: z.object({ a: z.number(), b: z.number() }),
  })
  @UseFilters(FriendlyExceptionFilter)
  async divide(input: { a: number; b: number }) {
    if (input.b === 0) {
      throw new Error('Division by zero is not permitted.');
    }
    return { result: input.a / input.b };
  }
}
```

---

## 8. Dynamic Runtime Tool Visibility

Tools can be hidden by default and progressively unlocked per user session. NitroStack exposes three methods on `ExecutionContext`:

* `ctx.enableTools(names: string[])`: Reveals an array of tool names for the active session.
* `ctx.disableTools(names: string[])`: Hides an array of tool names for the active session.
* `ctx.getVisibleTools()`: Returns the set of currently visible tools.

> [!IMPORTANT]
> Both `ctx.enableTools` and `ctx.disableTools` accept an **array of strings** (`string[]`). Always pass tool names as an array: `await ctx.enableTools?.(['sensitive_tool'])`.

```typescript
import { ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';

export class AdminAccessTools {
  @Tool({
    name: 'dangerous_wipe',
    visibility: 'hidden', // Hidden by default from tools/list
    inputSchema: z.object({ confirmed: z.boolean() }),
  })
  async dangerousWipe(input: { confirmed: boolean }) {
    return { wiped: true };
  }

  @Tool({
    name: 'elevate_privileges',
    description: 'Elevate active session to access sensitive operations',
    inputSchema: z.object({ masterKey: z.string() }),
  })
  async elevate(input: { masterKey: string }, ctx: ExecutionContext) {
    if (input.masterKey !== process.env.MASTER_KEY) {
      throw new Error('Invalid master authorization key.');
    }

    // Dynamically reveal the hidden tool for this session
    if (ctx.enableTools) {
      await ctx.enableTools(['dangerous_wipe']);
      ctx.logger.info(`Unlocked tools for session ${ctx.sessionId}`);
    }

    return { elevated: true, unlockedTools: ['dangerous_wipe'] };
  }
}
```
