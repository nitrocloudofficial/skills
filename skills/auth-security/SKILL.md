---
name: nitrostack-auth-security
description: Best practices for implementing OAuth 2.1 (PKCE & CIMD), JWT, API Keys, and Role-Based Access Control (RBAC) with built-in OAuthGuard and createScopeGuard in the NitroStack SDK.
---

## When to Use
Use this skill when configuring authentication modules, securing tools and resources with OAuth 2.1 or JWT guards, enforcing scope-based or role-based access control, publishing Client ID Metadata Documents (CIMD), or verifying API keys.

---

## 1. Authentication & Security Architecture

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NitroStack Authentication & Security Flows           │
├────────────────────────────────────────────────────────────────────────┤
│  Incoming MCP Request (Stdio / Streamable HTTP)                        │
│                                │                                       │
│                                ▼                                       │
│  [ Strategy Evaluation ]       ──> Authenticate Bearer / Header / Key  │
│       ├─ OAuth 2.1 + PKCE      ──> JWT / JWKS / RFC 7662 Introspection │
│       ├─ CIMD Metadata (2026)  ──> Resolve client_id URL to RFC 7591   │
│       ├─ JSON Web Token (JWT)  ──> Cryptographic signature validation  │
│       └─ API Key Header        ──> Multi-key hash / environment check  │
│                                │                                       │
│                                ▼                                       │
│  [ ExecutionContext.auth ]     ──> Populates subject, scopes, roles    │
│                                │                                       │
│                                ▼                                       │
│  [ Authorization Guards ]      ──> OAuthGuard, createScopeGuard, RBAC  │
│                                │                                       │
│                                ▼                                       │
│  Authorized Tool Handler Execution                                     │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. OAuth 2.1 Authentication (`OAuthModule`)

NitroStack provides a built-in, production-grade `OAuthModule` compliant with OAuth 2.1 ([draft-ietf-oauth-v2-1-13](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-v2-1-13)), RFC 9728 (Protected Resource Metadata), and RFC 8707 (Resource Indicators / Audience Binding).

### Registering `OAuthModule`
Register `OAuthModule.forRoot()` in your root application module:

```typescript
// src/app.module.ts
import { McpApp, Module, ConfigModule, OAuthModule } from '@nitrostack/core';
import { OrdersModule } from './orders/orders.module.js';

@McpApp({
  module: AppModule,
  server: { name: 'secure-orders-server', version: '1.0.0' },
})
@Module({
  imports: [
    ConfigModule.forRoot(),
    OAuthModule.forRoot({
      // Enforce authentication (default false during local dev)
      required: process.env.OAUTH_REQUIRED === 'true',

      // Server public URI for audience binding (RFC 8707)
      resourceUri: process.env.RESOURCE_URI || 'http://localhost:3000',

      // Authorized OAuth identity providers
      authorizationServers: [process.env.AUTH_SERVER_URL || 'https://auth.company.com'],

      // Scopes supported by this MCP server
      scopesSupported: ['read:orders', 'write:orders', 'admin:orders'],

      // Remote JWKS URI for cryptographic signature verification
      jwksUri: process.env.JWKS_URI,

      // Token Introspection (RFC 7662) for opaque tokens (alternative to JWKS)
      tokenIntrospectionEndpoint: process.env.INTROSPECTION_ENDPOINT,
      tokenIntrospectionClientId: process.env.INTROSPECTION_CLIENT_ID,
      tokenIntrospectionClientSecret: process.env.INTROSPECTION_CLIENT_SECRET,

      // Audience and issuer verification
      audience: process.env.TOKEN_AUDIENCE,
      issuer: process.env.TOKEN_ISSUER,
    }),
    OrdersModule,
  ],
})
export class AppModule {}
```

### Dual Transport for OAuth Discovery
When `OAuthModule` is enabled, NitroStack automatically runs a **Dual Transport** architecture:
* **STDIO Transport**: Handles standard MCP tool communication with AI clients or IDEs.
* **HTTP Server** (port `3005` in STDIO mode, or configured HTTP port): Serves RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource` and RFC 8414 Authorization Server Metadata so clients can discover endpoints and execute PKCE token exchanges.

---

## 3. Protecting Tools with `OAuthGuard` and `createScopeGuard`

NitroStack exports ready-to-use guards for zero-boilerplate tool protection.

### Basic Protection with `OAuthGuard`
Requires a valid, non-expired Bearer token issued by an authorized server:

```typescript
// src/orders/orders.tools.ts
import { ToolDecorator as Tool, UseGuards, OAuthGuard, ExecutionContext, z } from '@nitrostack/core';

export class OrdersTools {
  @Tool({
    name: 'get_my_orders',
    description: 'Fetch purchase orders for the authenticated user',
    inputSchema: z.object({}),
  })
  @UseGuards(OAuthGuard)
  async getMyOrders(input: Record<string, never>, ctx: ExecutionContext) {
    // Authenticated user ID extracted from token subject ('sub' claim)
    const userId = ctx.auth?.subject;
    ctx.logger.info(`Fetching orders for subject: ${userId}`);

    return {
      userId,
      orders: [
        { id: 'ord-101', total: 49.99, status: 'shipped' },
      ],
    };
  }
}
```

### Fine-Grained Protection with `createScopeGuard`
Use `createScopeGuard` to enforce specific OAuth scopes:

```typescript
import {
  ToolDecorator as Tool,
  UseGuards,
  OAuthGuard,
  createScopeGuard,
  ExecutionContext,
  z,
} from '@nitrostack/core';

export class ProtectedOrdersTools {
  // Requires 'read:orders' scope
  @Tool({
    name: 'list_all_orders',
    description: 'List orders. Requires read:orders scope.',
    inputSchema: z.object({ limit: z.number().default(10) }),
  })
  @UseGuards(OAuthGuard, createScopeGuard(['read:orders']))
  async listOrders(input: { limit: number }, ctx: ExecutionContext) {
    return { count: 1, items: [{ id: 'ord-1' }] };
  }

  // Requires 'write:orders' scope
  @Tool({
    name: 'cancel_order',
    description: 'Cancel an active order. Requires write:orders scope.',
    inputSchema: z.object({ orderId: z.string() }),
  })
  @UseGuards(OAuthGuard, createScopeGuard(['write:orders']))
  async cancelOrder(input: { orderId: string }, ctx: ExecutionContext) {
    return { cancelled: true, orderId: input.orderId };
  }

  // Requires BOTH 'write:orders' AND 'admin:orders' scopes
  @Tool({
    name: 'refund_order',
    description: 'Issue full refund. Requires write:orders and admin:orders scopes.',
    inputSchema: z.object({ orderId: z.string(), reason: z.string() }),
  })
  @UseGuards(OAuthGuard, createScopeGuard(['write:orders', 'admin:orders']))
  async refundOrder(input: { orderId: string; reason: string }, ctx: ExecutionContext) {
    return { refunded: true, orderId: input.orderId };
  }
}
```

---

## 4. Client ID Metadata Documents (CIMD / MCP 2026-07-28)

On the modern MCP `2026-07-28` specification, **Dynamic Client Registration (DCR) is deprecated** in favor of Client ID Metadata Documents (CIMD, [draft-ietf-oauth-client-id-metadata-document](https://datatracker.ietf.org/doc/draft-ietf-oauth-client-id-metadata-document/)).

### Why CIMD?
Instead of registering dynamically and managing shared secrets or ephemeral IDs, a client uses an **HTTPS URL as its `client_id`** (e.g. `https://client.example.com/oauth/client.json`). The authorization server fetches and caches this document directly, eliminating registration endpoints, state bloat, and SSRF vulnerabilities.

### Built-in Utilities in `@nitrostack/core`

```typescript
import {
  createClientIdMetadataDocument,
  validateClientIdMetadataDocument,
  resolveClientIdMetadataDocument,
  isClientIdMetadataUrl,
} from '@nitrostack/core';
```

### 1. Publishing Client Metadata
When building an MCP client or host application, generate a conforming CIMD payload:

```typescript
import { createClientIdMetadataDocument } from '@nitrostack/core';

const clientMetadata = createClientIdMetadataDocument(
  'https://agent.enterprise.com/oauth/mcp-client.json',
  {
    client_name: 'Enterprise AI Agent',
    redirect_uris: ['https://agent.enterprise.com/callback'],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none', // Public client using PKCE
    scope: 'read:orders write:orders',
  },
);
```

### 2. Resolving Client Metadata
Servers and authorization handlers resolve client metadata URLs using `resolveClientIdMetadataDocument`:

```typescript
import { resolveClientIdMetadataDocument, isClientIdMetadataUrl } from '@nitrostack/core';

async function handleClientAuthorization(clientId: string) {
  if (isClientIdMetadataUrl(clientId)) {
    // Fetches URL, checks RFC 6890 private IP blocklists, asserts safe targets, and validates document
    const doc = await resolveClientIdMetadataDocument(clientId, {
      timeoutMs: 5000,
      maxDocumentBytes: 5120, // 5 KiB limit per specification
    });

    console.log(`Resolved client: ${doc.client_name}, allowed redirects: ${doc.redirect_uris.join(', ')}`);
    return doc;
  }
  throw new Error('Legacy client IDs must register via static configuration.');
}
```

---

## 5. JSON Web Token (JWT) Authentication (`JWTModule`)

For direct service-to-service communication with shared secrets or RSA keys:

### 1. Register `JWTModule`
```typescript
import { JWTModule, Module } from '@nitrostack/core';

@Module({
  imports: [
    JWTModule.forRoot({
      secret: process.env.JWT_SECRET || 'dev-secret-key-change-in-prod',
      expiresIn: '7d',
    }),
  ],
})
export class AppModule {}
```

### 2. Custom `JWTGuard` Implementation
```typescript
import { Guard, ExecutionContext, Injectable, ConfigService } from '@nitrostack/core';
import * as jwt from 'jsonwebtoken';

@Injectable({ deps: [ConfigService] })
export class JWTGuard implements Guard {
  constructor(private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authHeader = context.metadata?.authorization as string | undefined;
    if (!authHeader?.startsWith('Bearer ')) {
      return false;
    }

    const token = authHeader.substring(7);
    try {
      const secret = this.config.get<string>('JWT_SECRET', 'dev-secret-key-change-in-prod');
      const payload = jwt.verify(token, secret) as { sub: string; role: string; [key: string]: unknown };

      context.auth = {
        subject: payload.sub,
        role: payload.role,
        token,
      };
      return true;
    } catch {
      return false;
    }
  }
}
```

---

## 6. API Key Authentication (`ApiKeyModule`)

For automated cron jobs, webhooks, or external integration scripts:

### 1. Register `ApiKeyModule`
```typescript
import { ApiKeyModule, Module } from '@nitrostack/core';

@Module({
  imports: [
    ApiKeyModule.forRoot({
      keysEnvPrefix: 'API_KEY', // Reads API_KEY_1, API_KEY_2, etc. from environment
      headerName: 'x-api-key',
      hashed: false,
    }),
  ],
})
export class AppModule {}
```

### 2. API Key Guard
```typescript
import { Injectable, Guard, ExecutionContext, ApiKeyModule } from '@nitrostack/core';

@Injectable({ deps: [] })
export class ApiKeyGuard implements Guard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rawKey = context.metadata?.['x-api-key'] || context.metadata?.apiKey;
    if (typeof rawKey !== 'string') return false;

    const isValid = await ApiKeyModule.validate(rawKey);
    if (isValid) {
      context.auth = {
        subject: `apikey_${rawKey.substring(0, 8)}...`,
        scopes: ['*'],
      };
      return true;
    }
    return false;
  }
}
```

---

## 7. Role-Based Access Control (RBAC) & Guard Chaining

Guards execute sequentially in the order passed to `@UseGuards()`. If any guard returns `false` or throws, subsequent guards are skipped and execution halts immediately.

```typescript
import { Injectable, Guard, ExecutionContext, UseGuards, ToolDecorator as Tool, z } from '@nitrostack/core';
import { OAuthGuard } from '@nitrostack/core';

@Injectable({ deps: [] })
export class AdminRoleGuard implements Guard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Requires OAuthGuard to have verified token and populated context.auth first
    const roles = (context.auth?.tokenPayload as { roles?: string[] })?.roles || [];
    return roles.includes('admin');
  }
}

export class InfrastructureTools {
  @Tool({
    name: 'wipe_test_database',
    description: 'Wipes non-production database. Restricted to authenticated admins.',
    inputSchema: z.object({ confirm: z.boolean() }),
  })
  @UseGuards(OAuthGuard, AdminRoleGuard) // 1. Verify OAuth token -> 2. Assert admin role
  async wipeDatabase(input: { confirm: boolean }, ctx: ExecutionContext) {
    ctx.logger.warn(`Database wipe initiated by admin: ${ctx.auth?.subject}`);
    return { success: true };
  }
}
```
