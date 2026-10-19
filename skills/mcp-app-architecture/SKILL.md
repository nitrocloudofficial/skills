---
name: nitrostack-mcp-app-architecture
description: Best practices and guidelines for bootstrapping, defining modules, using dependency injection, managing server lifecycles, and handling events in the NitroStack SDK.
---

## When to Use
Use this skill whenever you are bootstrapping a new NitroStack MCP server, creating modules, injecting services, configuring environment variables, or handling application lifecycle events.

---

## 1. Bootstrapping a NitroStack Application

The standard entry point for every NitroStack MCP server is an `index.ts` file that uses `McpApplicationFactory.create(AppModule)` to instantiate and start the server runtime.

```typescript
// src/index.ts
import { McpApplicationFactory } from '@nitrostack/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const server = await McpApplicationFactory.create(AppModule);
  await server.start();
}

bootstrap().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
```

---

## 2. Root Application Configuration (`@McpApp`)

The root module of your application must be decorated with both `@McpApp` and `@Module`. The `@McpApp` decorator configures server metadata, transport options, logging levels, transforms, and OS shutdown handlers.

```typescript
// src/app.module.ts
import { McpApp, Module, ConfigModule } from '@nitrostack/core';
import { DatabaseModule } from './database/database.module.js';
import { UsersModule } from './users/users.module.js';

@McpApp({
  module: AppModule,
  server: {
    name: 'enterprise-mcp-server',
    version: '1.0.0',
    protocolVersion: '2026-07-28', // '2026-07-28' (modern stateless) or '2025-06-18' (legacy)
    extensions: {
      'custom-feature': { enabled: true },
    },
  },
  logging: {
    level: 'info', // 'debug' | 'info' | 'warn' | 'error'
  },
  transport: {
    type: 'stdio', // 'stdio' | 'http' | 'dual'
    http: {
      port: 3000,
      host: '0.0.0.0',
      basePath: '/mcp',
    },
  },
  shutdownHooks: true, // Graceful shutdown on SIGINT/SIGTERM (default: true)
  transforms: [],      // Optional McpTransform[] (e.g. BM25SearchTransform, CodeModeTransform)
})
@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '.env' }),
    DatabaseModule,
    UsersModule,
  ],
})
export class AppModule {}
```

### Configuration Options Breakdown

| Property | Type | Description |
| :--- | :--- | :--- |
| `module` | `ClassConstructor` | The root module class decorated with `@Module`. |
| `server.name` | `string` | The server name advertised to MCP clients. |
| `server.version` | `string` | The semantic version of the server. |
| `server.protocolVersion` | `string` | Protocol spec version (`'2026-07-28'` modern or `'2025-06-18'` legacy). Defaults to auto-negotiate. |
| `server.extensions` | `Record<string, ...>` | Optional custom extensions advertised in modern server discovery. |
| `logging.level` | `'debug' \| 'info' \| 'warn' \| 'error'` | Application logging verbosity. Default is `'info'`. |
| `transport.type` | `'stdio' \| 'http' \| 'dual'` | Protocol transport. Default is `'stdio'`. `'dual'` runs STDIO for tools + HTTP for metadata. |
| `shutdownHooks` | `boolean` | Registers `SIGTERM` and `SIGINT` signal handlers for graceful teardown. Default is `true`. |
| `transforms` | `McpTransform[]` | Catalog transforms pipeline (e.g., BM25 progressive tool discovery, Code Mode WASM). |

---

## 3. Environment Configuration (`ConfigModule` & `ConfigService`)

NitroStack provides a built-in `ConfigModule` and `ConfigService` for managing environment variables and application secrets.

### 1. Registering `ConfigModule`
Register `ConfigModule.forRoot()` inside your root `@Module` imports:

```typescript
import { Module, ConfigModule } from '@nitrostack/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
      isGlobal: true,
    }),
  ],
})
export class AppModule {}
```

### 2. Injecting `ConfigService`
Inject `ConfigService` into any `@Injectable()` service to read typed configuration values:

```typescript
import { Injectable, ConfigService } from '@nitrostack/core';

@Injectable({ deps: [ConfigService] })
export class DatabaseService {
  private readonly connectionString: string;

  constructor(private readonly config: ConfigService) {
    this.connectionString = this.config.get<string>('DATABASE_URL', 'postgresql://localhost:5432/mcp');
  }

  getConnectionString(): string {
    return this.connectionString;
  }
}
```

---

## 4. Modules Architecture (`@Module`)

Modules organize your codebase into cohesive, decoupled domains. Use the `@Module` decorator to declare imports, providers, and exports.

* **`imports`**: Other modules whose exported providers are required within this module.
* **`providers`**: Services, tools, resources, prompts, or health checks instantiated and managed by the DI container.
* **`exports`**: Providers defined in this module that should be accessible to other modules importing this one.

```typescript
// src/users/users.module.ts
import { Module } from '@nitrostack/core';
import { DatabaseModule } from '../database/database.module.js';
import { UsersService } from './users.service.js';
import { UsersTools } from './users.tools.js';

@Module({
  imports: [DatabaseModule],
  providers: [UsersService, UsersTools],
  exports: [UsersService],
})
export class UsersModule {}
```

---

## 5. Controllers & Automatic Namespacing

Group related tools, resources, and prompts inside controllers decorated with `@ControllerDecorator` (or aliased as `@Controller`).

### Automatic Tool Namespacing
When you provide a prefix string to `@Controller('prefix')`, NitroStack automatically prefixes all tool names in that controller with `${prefix}_${toolName}`. This avoids collisions across large multi-domain MCP servers.

```typescript
// src/github/github.controller.ts
import { ControllerDecorator as Controller, ToolDecorator as Tool, ExecutionContext, z } from '@nitrostack/core';

@Controller('github')
export class GitHubController {
  @Tool({
    name: 'create_issue',
    description: 'Create a new issue in a GitHub repository',
    inputSchema: z.object({
      repo: z.string().describe('Repository name in owner/repo format'),
      title: z.string().describe('Issue title'),
      body: z.string().optional().describe('Issue description'),
    }),
  })
  async createIssue(input: { repo: string; title: string; body?: string }, ctx: ExecutionContext) {
    // Exposed to MCP clients as "github_create_issue"
    ctx.logger.info(`Creating issue in ${input.repo}: ${input.title}`);
    return { id: 101, url: `https://github.com/${input.repo}/issues/101` };
  }
}
```

---

## 6. Dependency Injection & Node.js ESM

NitroStack uses an in-memory Dependency Injection (DI) container. In Node.js ES modules (`type: "module"`), constructor parameter reflection metadata (`emitDecoratorMetadata`) can be lost across compilation boundaries.

To guarantee bulletproof dependency resolution in Node ESM, **always specify explicit `deps` in the `@Injectable()` options array**:

```typescript
// src/users/users.service.ts
import { Injectable, Scope } from '@nitrostack/core';
import { DatabaseService } from '../database/database.service.js';

@Injectable({
  scope: Scope.SINGLETON, // Default: Scope.SINGLETON
  deps: [DatabaseService], // Explicit deps prevent reflection loss in Node ESM
})
export class UsersService {
  constructor(private readonly db: DatabaseService) {}

  async getUser(id: string) {
    return this.db.query('SELECT * FROM users WHERE id = $1', [id]);
  }
}
```

### Injection Scopes

| Scope | Enum | Description |
| :--- | :--- | :--- |
| **Singleton** | `Scope.SINGLETON` | (Default) A single instance is shared across the entire application runtime. |
| **Transient** | `Scope.TRANSIENT` | A brand-new instance is instantiated every time it is injected or resolved. |
| **Scoped** | `Scope.SCOPED` | A new instance is created per incoming request or context session. |

---

## 7. Application Lifecycles and Hooks

Providers, controllers, and modules can hook into state transitions throughout the application lifecycle:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NitroStack Application Lifecycle Flow                │
├────────────────────────────────────────────────────────────────────────┤
│  McpApplicationFactory.create(AppModule)                               │
│                                │                                       │
│                                ▼                                       │
│  1. Container Resolution       ──> Instantiate Providers & Controllers │
│                                │                                       │
│                                ▼                                       │
│  2. OnModuleInit               ──> Connect DBs & prepare services      │
│                                │                                       │
│                                ▼                                       │
│  3. server.start()             ──> Bind Stdio / Streamable HTTP & SSE  │
│                                │                                       │
│                                ▼                                       │
│  4. OnApplicationBootstrap     ──> Ready to handle MCP tool requests   │
│                                │                                       │
│                                ▼  (OS Signal: SIGINT / SIGTERM)        │
│  5. BeforeApplicationShutdown  ──> Stop accepting new requests         │
│                                │                                       │
│                                ▼                                       │
│  6. OnModuleDestroy            ──> Flush buffers & close connections   │
│                                │                                       │
│                                ▼                                       │
│  7. OnApplicationShutdown      ──> Release system handles & shutdown   │
└────────────────────────────────────────────────────────────────────────┘
```

### Lifecycle Hooks Reference

| Hook Interface | Method | Trigger Moment |
| :--- | :--- | :--- |
| `OnModuleInit` | `onModuleInit()` | Called immediately after module dependencies have resolved. |
| `OnApplicationBootstrap` | `onApplicationBootstrap()` | Called once the MCP transport is bound and listening for requests. |
| `BeforeApplicationShutdown` | `beforeApplicationShutdown(signal?: string)` | Triggered when a shutdown signal (`SIGINT`, `SIGTERM`) is intercepted. |
| `OnModuleDestroy` | `onModuleDestroy()` | Triggered during application teardown before final destruction. |
| `OnApplicationShutdown` | `onApplicationShutdown(signal?: string)` | Final teardown hook before process termination. |

### Complete Lifecycle Provider Implementation

```typescript
import {
  Injectable,
  OnModuleInit,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
  OnModuleDestroy,
  OnApplicationShutdown,
} from '@nitrostack/core';

@Injectable({ deps: [] })
export class DatabaseService
  implements
    OnModuleInit,
    OnApplicationBootstrap,
    BeforeApplicationShutdown,
    OnModuleDestroy,
    OnApplicationShutdown
{
  async onModuleInit() {
    console.log('[Lifecycle] Connecting to database pools...');
    await this.connectPools();
  }

  async onApplicationBootstrap() {
    console.log('[Lifecycle] Database active and listening for MCP requests.');
  }

  async beforeApplicationShutdown(signal?: string) {
    console.log(`[Lifecycle] Intercepted signal ${signal}. Halting new queries.`);
  }

  async onModuleDestroy() {
    console.log('[Lifecycle] Flushing uncommitted write buffers...');
    await this.flushBuffers();
  }

  async onApplicationShutdown(signal?: string) {
    console.log(`[Lifecycle] Closing database connection pools (signal: ${signal}).`);
    await this.closePools();
  }

  private async connectPools() { /* ... */ }
  private async flushBuffers() { /* ... */ }
  private async closePools() { /* ... */ }
}
```

---

## 8. Decoupled Eventing (`emitEvent` and `@OnEvent`)

NitroStack includes a lightweight, decoupled event bus. Any tool or service can emit events asynchronously using `emitEvent`, and any registered provider can subscribe using `@OnEvent`.

> [!WARNING]
> Always use the top-level `emitEvent(name, payload)` function. Never use deprecated `ctx.emit()`.

### 1. Emitting Events
Call `emitEvent` to broadcast an event with an arbitrary payload:

```typescript
import { Injectable, emitEvent } from '@nitrostack/core';

@Injectable({ deps: [] })
export class OrdersService {
  async placeOrder(orderId: string, amount: number) {
    // Execute business logic...
    
    // Broadcast event asynchronously
    emitEvent('order.placed', {
      orderId,
      amount,
      createdAt: new Date().toISOString(),
    });

    return { orderId, status: 'confirmed' };
  }
}
```

### 2. Subscribing to Events with `@OnEvent`
Decorate a method inside any `@Injectable()` provider with `@OnEvent('pattern')`:

```typescript
import { Injectable, OnEvent } from '@nitrostack/core';

@Injectable({ deps: [] })
export class NotificationHandler {
  @OnEvent('order.placed')
  async handleOrderPlaced(payload: { orderId: string; amount: number; createdAt: string }) {
    console.log(`[Notification] New order ${payload.orderId} placed for $${payload.amount}`);
  }
}
```

> [!NOTE]
> The subscriber class must be listed under the `providers` array of an imported module for `@OnEvent` handlers to be registered at bootstrap.
