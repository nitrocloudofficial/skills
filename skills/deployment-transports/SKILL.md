---
name: nitrostack-deployment-transports
description: Best practices for configuring MCP 2026-07-28 dual-spec transports (Streamable HTTP /mcp and legacy SSE /sse), Accept header negotiation, multi-stage Docker builds with static widgets, and cloud deployments.
---

## When to Use
Use this skill when configuring network transports, deploying MCP servers to cloud platforms (Docker, Kubernetes, AWS, GCP, Fly.io), setting up reverse proxies (Nginx, Caddy, Traefik), managing streaming buffer headers, or containerizing full-stack servers with Next.js UI widgets.

---

## 1. Protocol Dual-Spec Architecture

Production MCP servers must support modern stateless Streamable HTTP (spec version `2026-07-28`) while maintaining backward compatibility with legacy Server-Sent Events (SSE, spec version `2025-06-18`).

NitroStack natively mounts both protocols concurrently and auto-negotiates transport according to client headers and requested endpoints:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   MCP Dual-Spec Protocol Negotiation                   │
├────────────────────────────────────────────────────────────────────────┤
│  Incoming MCP Client Request                                           │
│                                │                                       │
│                                ▼                                       │
│  [ Transport Auto-Negotiator ] ──> Checks protocol & Accept headers    │
│                                │                                       │
│         ┌──────────────────────┴──────────────────────┐                │
│         ▼                                             ▼                │
│  [ Modern Streamable HTTP ]                   [ Legacy SSE ]           │
│  - Endpoint: /mcp                             - Endpoint: /sse         │
│  - Version: 2026-07-28                        - Version: 2025-06-18    │
│  - High throughput POST & chunks              - Server-Sent Events     │
│  - Supports Tasks & Extensions                - Backward compatibility │
│                                │                                       │
│                                ▼                                       │
│  [ NitroStack Runtime Engine ] ──> Tools, Resources, Prompts, Widgets  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Dual-Spec Protocol Auto-Negotiation

NitroStack exports protocol version constants and handles protocol detection automatically:

```typescript
import {
  MODERN_PROTOCOL_VERSION, // '2026-07-28'
  LEGACY_PROTOCOL_VERSION, // '2025-06-18'
  PROTOCOL_ENV_VAR,        // 'NITRO_MCP_PROTOCOL_VERSION'
} from '@nitrostack/core';
```

### Protocol Comparison

| Capability | Modern Streamable HTTP (`/mcp`) | Legacy Server-Sent Events (`/sse`) |
| :--- | :--- | :--- |
| **Protocol Spec** | `2026-07-28` | `2025-06-18` |
| **Endpoint** | `POST /mcp` (or streaming chunks) | `GET /sse` (events) + `POST /message` |
| **Connection Model** | Stateless or session-pinned HTTP | Stateful session connection |
| **MCP Tasks** | Full support (`tasks/update`, cancellations) | Restricted |
| **Client Support** | Modern AI Editors (Cursor, Claude Code) | Older MCP 2025 implementations |

### Enforcing Protocol Version via Environment
By default, NitroStack runs in auto-negotiate mode (`'auto'`). You can force a specific protocol era using environment variables:
```bash
# Force modern stateless 2026-07-28 protocol
export NITRO_MCP_PROTOCOL_VERSION="2026-07-28"

# Force legacy 2025-06-18 SSE protocol
export NITRO_MCP_PROTOCOL_VERSION="2025-06-18"
```

---

## 3. Accept Header Handling & Transparent Rewriting

Standard MCP 2026-07-28 POST invocations require the following header:
```http
Accept: application/json, text/event-stream
```

### Transparent Rewriting
Standard HTTP clients (such as `curl`, Postman, health check probes, or generic webhook triggers) frequently omit `text/event-stream` or provide wildcards (`Accept: */*`). 

NitroStack incorporates a transparent header rewrite engine that normalizes incoming `Accept` headers before routing them to the SDK. This prevents erroneous `406 Not Acceptable` status codes while ensuring standard JSON response delivery.

### Diagnostic Logging
To debug incoming transport headers and inspect negotiation decisions in development:
```bash
NITRO_DEBUG_ACCEPT=1 npm run dev
```

---

## 4. Production Multi-Stage Dockerfile with Widgets

Deploying a full-stack NitroStack server requires compiling the Node.js TypeScript backend to `dist/` and exporting Next.js frontend widgets into standalone static HTML bundles (`src/widgets/out/`).

> [!IMPORTANT]
> NitroStack resolves `@Widget({ route: 'card' })` views at runtime by reading static HTML from `src/widgets/out/card.html`. Do **not** copy `.next/` directly; always ensure `src/widgets/out/` is copied into the final production image.

### Production Dockerfile (`Dockerfile`)

```dockerfile
# ============================================================================
# Stage 1: Build Backend & Static Widgets
# ============================================================================
FROM node:20-alpine AS builder
WORKDIR /app

# Install build dependencies
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy full application source
COPY src ./src

# Build production backend (dist/) and export static Next.js widgets (src/widgets/out/)
RUN npm run build

# ============================================================================
# Stage 2: Production Minimal Runtime
# ============================================================================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production-only backend dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend and static widget HTML bundles
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/widgets/out ./src/widgets/out

# Security: Run as unprivileged node user
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

---

## 5. Cloud Deployments & Reverse Proxy Configuration

Both Streamable HTTP (`/mcp`) and SSE (`/sse`) rely on unbuffered HTTP streaming. When deploying behind a reverse proxy (e.g. Nginx, Traefik, AWS ALB, Cloudflare), you must disable proxy buffering to prevent chunk accumulation.

### Nginx Configuration

```nginx
upstream mcp_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name mcp.company.com;

    # Modern Streamable HTTP Endpoint
    location /mcp {
        proxy_pass http://mcp_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable response buffering for streaming chunks
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 24h;
    }

    # Legacy Server-Sent Events (SSE) Endpoint
    location /sse {
        proxy_pass http://mcp_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;

        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 24h;
    }

    # REST Health Check Probe
    location /health {
        proxy_pass http://mcp_backend/health;
        proxy_http_version 1.1;
    }
}
```

---

## 6. Docker Stdio Execution for AI Editors

When AI coding assistants (like Cursor, Claude Code, or Gemini CLI) connect to a containerized MCP server over standard I/O (stdio), the container must be started in **interactive mode** (`-i`) to keep stdin/stdout streams open:

```json
{
  "mcpServers": {
    "enterprise-tools": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e", "NODE_ENV=production",
        "-e", "DATABASE_URL=postgresql://db.internal:5432/mcp",
        "company/mcp-server:latest"
      ]
    }
  }
}
```

> [!TIP]
> Never pass `-t` (allocate TTY) when configuring stdio MCP servers in AI editors. A TTY corrupts JSON-RPC protocol messages by injecting ANSI escape codes and carriage returns. Always pass `-i` only.
