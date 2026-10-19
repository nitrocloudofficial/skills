---
name: nitrostack-cli-workflow-generators
description: Complete reference for the NitroStack CLI (@nitrostack/cli), including initialization with presets, multi-process dev orchestration, production builds, and code generation commands.
---

## When to Use
Use this skill when scaffolding new projects with presets, running local multi-process development servers, generating boilerplate for modules, tools, guards, or filters, generating strongly-typed widget interfaces, building production bundles, or configuring IDE integrations.

---

## 1. Multi-Process Development Architecture

NitroStack projects coordinate a full-stack MCP environment consisting of a Node.js TypeScript server running on standard I/O and a Next.js React frontend serving UI widgets:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NitroStack Local Development Ports                   │
├────────────────────────────────────────────────────────────────────────┤
│  CLI Command: 'nitrostack dev' (orchestrates dev runtime)              │
│                                │                                       │
│  ┌─────────────────────────────┼─────────────────────────────┐         │
│  ▼                             ▼                             ▼         │
│  Process 1: TypeScript         Process 2: MCP Server         Process 3 │
│  - 'npx tsc --watch'           - Transport: Stdio (stdin)    - Widgets │
│  - Hot compilation to dist/    - JSON-RPC 2.0 Protocol       - Port:   │
│  - Connects to IDE / Studio    - Automatic restart on build  - 3001    │
│  - Incremental type checks     - Exposes tools/resources     - Next.js │
│                                                                        │
│  [ NitroStack Studio ] ──> Desktop IDE / Web UI connects via stdio     │
│  - Interactive Tool Tester, AI Chat (LLM), and Live Widget Previews    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Project Initialization (`nitrostack init`)

Initialize new projects using presets optimized for different use cases:

```bash
# Initialize using the default starter preset
npx @nitrostack/cli init my-server

# Initialize with a specific preset
npx @nitrostack/cli init enterprise-mcp --preset enterprise-search
```

### Available Presets

| Preset Flag | Template Name | Target Use Case & Included Features |
| :--- | :--- | :--- |
| `--preset starter` | `typescript-starter` | (Default) Calculator tools, interactive widgets, DI, health checks. |
| `--preset enterprise-search` | `typescript-enterprise-search` | `BM25SearchTransform` progressive tool discovery, `@Controller` namespacing. |
| `--preset code-mode` | `typescript-code-mode` | QuickJS WebAssembly sandbox worker pool for batch script execution. |
| `--preset pizzaz` | `typescript-pizzaz` | Rich interactive React widgets, Mapbox map integrations, state sync. |
| `--preset oauth` | `typescript-oauth` | Full OAuth 2.1 PKCE authorization flow & Duffel API flight booking tools. |

### Actions Executed by `init`
1. Clones and scaffolds project files from the chosen template.
2. Installs root dependencies for the MCP server.
3. Installs frontend widget dependencies inside `src/widgets/`.
4. Copies `.env.example` to `.env`.
5. Installs agent skills into editor config directories (`.cursor/skills/`, `.claude/skills/`, `.gemini/skills/`, `.antigravity/skills/`).

---

## 3. Multi-Process Development Server (`nitrostack dev`)

Start the unified development runtime:

```bash
# Start dev runtime on default ports (Widgets on 3001)
nitrostack dev

# Specify a custom port for the Next.js widget development server
nitrostack dev --port 3005
```

### Managed Processes
1. **TypeScript Watcher (`tsc --watch`)**: Incrementally compiles `src/**/*.ts` to `dist/` with ES module imports.
2. **MCP Server**: Runs on standard I/O (stdio) and auto-restarts upon build completion.
3. **Widget Development Server**: Serves Next.js components on `http://localhost:3001` with Hot Module Replacement (HMR).
4. **Route Watcher**: Detects new routes in `src/widgets/app/**/page.tsx` and dynamically registers them with the server.

---

## 4. Code Generators (`nitrostack generate`)

The CLI provides **12 code generators** to scaffold type-safe components and boilerplate across your application:

```bash
nitrostack generate <type> [name] [options]
```

### Generator Reference

#### 1. `generate module <name>`
Scaffolds a cohesive feature module with tools, resources, prompts, and an injectable service:
```bash
nitrostack generate module payments
```
Creates:
* `src/modules/payments/payments.module.ts` (`@Module`)
* `src/modules/payments/payments.tools.ts` (`@Tool`)
* `src/modules/payments/payments.resources.ts` (`@Resource`)
* `src/modules/payments/payments.prompts.ts` (`@Prompt`)
* `src/modules/payments/payments.service.ts` (`@Injectable`)

#### 2. `generate tools <name> --module <mod>`
Appends a `@Tool` method with Zod schema, examples, and execution context:
```bash
nitrostack generate tools capture-charge --module payments
```

#### 3. `generate resources <name> --module <mod>`
Appends a `@Resource` method with URI pattern, MIME type, and return structure:
```bash
nitrostack generate resources payment-receipt --module payments
```

#### 4. `generate prompts <name> --module <mod>`
Appends a `@Prompt` method with argument declarations and message templates:
```bash
nitrostack generate prompts refund-inquiry --module payments
```

#### 5. `generate guard <name>`
Creates a request authorization guard:
```bash
nitrostack generate guard roles
# Creates: src/guards/roles.guard.ts (implements Guard)
```

#### 6. `generate middleware <name>`
Creates a pipeline middleware handler:
```bash
nitrostack generate middleware request-audit
# Creates: src/middleware/request-audit.middleware.ts (implements MiddlewareInterface)
```

#### 7. `generate interceptor <name>`
Creates a request/response interceptor:
```bash
nitrostack generate interceptor telemetry
# Creates: src/interceptors/telemetry.interceptor.ts (implements InterceptorInterface)
```

#### 8. `generate pipe <name>`
Creates an input transformation and validation pipe:
```bash
nitrostack generate pipe parse-int
# Creates: src/pipes/parse-int.pipe.ts (implements PipeInterface)
```

#### 9. `generate filter <name>`
Creates an exception filter to format caught errors:
```bash
nitrostack generate filter payment-error
# Creates: src/filters/payment-error.filter.ts (implements ExceptionFilterInterface)
```

#### 10. `generate service <name>`
Creates an injectable business logic service:
```bash
nitrostack generate service ledger
# Creates: src/services/ledger.service.ts (@Injectable({ deps: [] }))
```

#### 11. `generate health <name>`
Creates an application health check provider:
```bash
nitrostack generate health redis
# Creates: src/health/redis.health.ts (@HealthCheck, implements HealthCheckInterface)
```

#### 12. `generate types [--output <path>]`
Scans all `*.tools.ts` files, extracts Zod input/output schemas, and generates TypeScript interfaces:
```bash
nitrostack generate types
# Generates: src/widgets/types/tool-data.ts
```

---

## 5. Dual Dependency Management (`nitrostack install`)

Because NitroStack applications contain dual `package.json` files (one at the root for the backend and one at `src/widgets/package.json` for Next.js), running `npm install` at root skips frontend dependencies.

Use `nitrostack install` to install dependencies in both environments simultaneously:

```bash
# Installs dependencies in both root and src/widgets/
nitrostack install

# Skip frontend widget dependencies
nitrostack install --skip-widgets
```

---

## 6. Production Build & Deployment Commands

### Production Build (`nitrostack build`)
```bash
nitrostack build
```
1. Statically exports Next.js widgets into standalone HTML bundles at `src/widgets/out/`.
2. Compiles TypeScript backend files into `dist/` with ES module `.js` imports.

### Starting Production Server (`nitrostack start`)
```bash
# Starts the server in production mode on port 3000
nitrostack start --port 3000
```
Runs `dist/index.js` with Streamable HTTP (`/mcp`) and Legacy SSE (`/sse`) transports enabled.

### Creating Deployment Archive (`nitrostack pack`)
```bash
# Generates an optimized, production-ready .zip archive
nitrostack pack

# Preview included and excluded files without creating the archive
nitrostack pack --dry-run
```
Excludes build caches, `node_modules/`, `.git/`, and `.env` secret files.

### Cursor IDE Integration (`nitrostack cursor`)
```bash
# Configure local .cursor/mcp.json in command mode
nitrostack cursor

# Configure for modern Streamable HTTP
nitrostack cursor --type streamable-http --url http://localhost:3000/mcp

# Configure for legacy SSE
nitrostack cursor --type legacy-sse --port 3000
```
