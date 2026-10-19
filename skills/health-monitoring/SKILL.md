---
name: nitrostack-health-monitoring
description: Best practices for implementing application health checks in NitroStack using the @HealthCheck class decorator, HealthCheckInterface, and the auto-exposed health://checks MCP resource.
---

## When to Use
Use this skill when implementing system telemetry, liveness/readiness probes for Kubernetes or Docker, verifying database and cache connectivity, configuring custom health intervals, or monitoring health metrics via NitroStudio.

---

## 1. Health Observability Architecture

NitroStack provides built-in application health monitoring. Health checks are declared as injectable providers using the `@HealthCheck` class decorator. NitroStack aggregates these checks into an automated MCP resource (`health://checks`) and an HTTP endpoint (`GET /health`):

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NitroStack Health Observability Flow                 │
├────────────────────────────────────────────────────────────────────────┤
│  Application Providers Decorated with @HealthCheck                     │
│       ├─ SystemHealthCheck     ──> Process uptime & memory telemetry   │
│       ├─ DatabaseHealthCheck   ──> Active connection pool ping check   │
│       └─ RedisHealthCheck      ──> Cache read/write latency check      │
│                                │                                       │
│                                ▼                                       │
│  [ NitroStack Health Registry ]──> Periodically runs check() methods   │
│                                │                                       │
│  ┌─────────────────────────────┴─────────────────────────────┐         │
│  ▼                                                           ▼         │
│  [ MCP Resource: health://checks ]          [ HTTP Probe: /health ]    │
│  - Aggregated JSON telemetry report         - Standard REST probe      │
│  - Consumed by Studio & AI Agents           - Kubernetes k8s probes    │
│  - Includes transform & spillover stats     - Returns 200 or 503       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Health Check Class Decorator (`@HealthCheck`)

In NitroStack, `@HealthCheck` is a **class decorator** that registers a provider with the internal health registry.

### Interfaces & Types
* `HealthCheckInterface`: Classes must implement this interface and define a `check()` method returning `Promise<HealthCheckResult> | HealthCheckResult`.
* `HealthCheckResult`:
  * `status`: `'up' | 'down' | 'degraded'`
  * `message?`: Human-readable summary string
  * `details?`: Arbitrary structured telemetry (uptime, memory, latency)
* `HealthCheckOptions`:
  * `name`: Unique health check identifier (required)
  * `description?`: Explanatory description
  * `interval?`: Polling frequency in seconds

### Basic System Health Check Example

```typescript
// src/health/system.health.ts
import { HealthCheck, type HealthCheckInterface, type HealthCheckResult } from '@nitrostack/core';

@HealthCheck({
  name: 'system',
  description: 'Node.js process uptime and heap memory telemetry',
  interval: 30, // Evaluated every 30 seconds
})
export class SystemHealthCheck implements HealthCheckInterface {
  async check(): Promise<HealthCheckResult> {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    return {
      status: uptime > 0 ? 'up' : 'down',
      message: 'Node.js process operational',
      details: {
        uptimeSeconds: Math.floor(uptime),
        heapUsedMb: Math.round(memory.heapUsed / 1024 / 1024),
        rssMb: Math.round(memory.rss / 1024 / 1024),
      },
    };
  }
}
```

---

## 3. Dependency Health Checks with Dependency Injection

Health check classes are fully integrated into the NitroStack DI container. You can inject database services, Redis clients, or external API connectors using `@Injectable({ deps: [...] })`:

```typescript
// src/health/database.health.ts
import { Injectable, HealthCheck, type HealthCheckInterface, type HealthCheckResult } from '@nitrostack/core';
import { DatabaseService } from '../database/database.service.js';

@Injectable({ deps: [DatabaseService] })
@HealthCheck({
  name: 'database',
  description: 'PostgreSQL connection pool readiness check',
  interval: 15,
})
export class DatabaseHealthCheck implements HealthCheckInterface {
  constructor(private readonly db: DatabaseService) {}

  async check(): Promise<HealthCheckResult> {
    const start = performance.now();
    try {
      await this.db.ping();
      const latencyMs = Math.round(performance.now() - start);

      return {
        status: 'up',
        message: 'Database connection active',
        details: {
          latencyMs,
          activePoolConnections: this.db.getActiveConnectionCount(),
        },
      };
    } catch (error: any) {
      return {
        status: 'down',
        message: 'Database ping failed',
        details: {
          error: error.message,
        },
      };
    }
  }
}
```

---

## 4. Registering Health Checks in Modules

Health check providers must be registered inside the `providers` array of an active `@Module`:

```typescript
// src/app.module.ts
import { Module } from '@nitrostack/core';
import { SystemHealthCheck } from './health/system.health.js';
import { DatabaseHealthCheck } from './health/database.health.js';
import { DatabaseModule } from './database/database.module.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    SystemHealthCheck,
    DatabaseHealthCheck,
  ],
})
export class AppModule {}
```

During bootstrap (`McpApplicationFactory.create(AppModule)`), NitroStack scans module providers, detects classes decorated with `@HealthCheck`, instantiates them, and binds them to the server health registry.

---

## 5. Auto-Exposed MCP Resource (`health://checks`)

NitroStack automatically constructs and registers an MCP resource at:
```text
health://checks
```

Clients (like Cursor, Claude Code, or NitroStudio) read this resource using standard MCP `resources/read`. It returns a consolidated JSON document:

```json
{
  "status": "healthy",
  "uptimeSeconds": 3600,
  "checks": [
    {
      "name": "system",
      "status": "up",
      "message": "Node.js process operational",
      "details": {
        "uptimeSeconds": 3600,
        "heapUsedMb": 64
      }
    },
    {
      "name": "database",
      "status": "up",
      "message": "Database connection active",
      "details": {
        "latencyMs": 4,
        "activePoolConnections": 5
      }
    }
  ],
  "transforms": {
    "bm25IndexedTools": 42,
    "codeModeWorkersActive": 4
  },
  "spillover": {
    "activeRecords": 2,
    "memorySizeBytes": 81920
  }
}
```

---

## 6. HTTP Endpoint Probe (`/health`)

When running in HTTP or SSE transport modes (e.g. `nitrostack start` or `@McpApp({ transport: { type: 'http' } })`), the server exposes a REST health endpoint at:
```http
GET /health
```

### Response Status Codes
* **HTTP 200 OK**: All registered health checks report status `'up'`.
* **HTTP 503 Service Unavailable**: One or more health checks report status `'down'`.

### Docker & Kubernetes Configuration

#### Kubernetes Deployment Probe
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
  periodSeconds: 15

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 10
```

#### Dockerfile HEALTHCHECK
```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1
```
