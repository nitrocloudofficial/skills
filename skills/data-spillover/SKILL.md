---
name: nitrostack-data-spillover
description: Guidelines and patterns for managing large tool payloads, preventing LLM context window blowouts via DataSpilloverInterceptor, configuring disk/memory spillover stores, and inspecting truncated previews with resourceUri.
---

## When to Use
Use this skill whenever tools query high-volume datasets (e.g. database rows, audit trails, server logs, reports, spreadsheets) that risk exceeding model context window limits, inflating API token costs, or crashing conversations.

---

## 1. Data Spillover Architecture

When an MCP tool returns an unexpectedly large payload (e.g. 5,000 JSON records), returning the raw response directly to the LLM overflows its context window.

NitroStack solves this with the `DataSpilloverInterceptor`. It monitors serialization size, automatically offloads payloads exceeding a configurable byte threshold to a spillover store, and returns a compact `SpilloverEnvelope` containing summary metadata, a representative preview, and a read-only `resourceUri`:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NitroStack Data Spillover Lifecycle                  │
├────────────────────────────────────────────────────────────────────────┤
│  Tool Execution Result (e.g. 5,000 database records / 2.5 MB)          │
│                                │                                       │
│                                ▼                                       │
│  [ DataSpilloverInterceptor ]  ──> Calculate Buffer.byteLength(json)   │
│                                │                                       │
│                                ▼                                       │
│  [ Payload Size Check ]        ──> Evaluate against maxPayloadBytes    │
│       ├─ Payload <= Limit      ──> Deliver JSON directly to model      │
│       └─ Payload > Limit       ──> Offload full dataset to store       │
│                                │                                       │
│                                ▼                                       │
│  [ SpilloverEnvelope Created ] ──> Store in Memory or FsSpilloverStore │
│  - Returns compact preview     ──> First N items for schema inspection │
│  - Embeds resourceUri pointer  ──> 'resource://data-spillover/{id}'    │
│                                │                                       │
│                                ▼                                       │
│  Agent fetches full data on demand via standard MCP 'resources/read'   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Binding `DataSpilloverInterceptor`

You can attach `DataSpilloverInterceptor` at the method level on specific tools, or at the class level across an entire controller.

### Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `maxPayloadBytes` | `number` | `10240` (10 KB) | Byte threshold beyond which payload is offloaded to the spillover store. |
| `spilloverTtlSeconds` | `number` | `3600` (1 hr) | Expiration time before offloaded payloads are evicted from storage. |
| `previewItems` | `number` | `3` | Number of sample array elements retained in the preview envelope. |
| `previewStringChars` | `number` | `500` | Number of initial characters retained if payload is a raw string. |
| `storage` | `'memory' \| 'filesystem' \| SpilloverStore` | `'memory'` | Storage driver used to persist the offloaded payload. |
| `resourceUriPrefix` | `string` | `'resource://data-spillover/'` | URI scheme for the generated resource pointer. |

### Tool-Level Example

```typescript
// src/ledger/ledger.tools.ts
import { ToolDecorator as Tool, UseInterceptors, DataSpilloverInterceptor, ExecutionContext, z } from '@nitrostack/core';
import { LedgerService } from './ledger.service.js';

export class LedgerTools {
  constructor(private readonly ledgerService: LedgerService) {}

  @Tool({
    name: 'query_transactions',
    description: 'Fetch transactions with automatic data spillover protection for large result sets',
    inputSchema: z.object({
      accountId: z.string(),
      startDate: z.string(),
      endDate: z.string(),
    }),
  })
  @UseInterceptors(new DataSpilloverInterceptor({
    maxPayloadBytes: 8192,  // 8 KB threshold
    previewItems: 2,        // Retain first 2 items in LLM preview
    storage: 'memory',      // 'memory' for ephemeral or 'filesystem' for persistent
  }))
  async queryTransactions(input: { accountId: string; startDate: string; endDate: string }, ctx: ExecutionContext) {
    ctx.logger.info(`Querying ledger transactions for account: ${input.accountId}`);
    return await this.ledgerService.getTransactions(input.accountId, input.startDate, input.endDate);
  }
}
```

### Static Factory Syntax (`configure`)

Alternatively, you can use the static `DataSpilloverInterceptor.configure(...)` factory:

```typescript
@UseInterceptors(DataSpilloverInterceptor.configure({
  maxPayloadBytes: 15 * 1024,
  previewItems: 5,
}))
async fetchAuditLogs() { /* ... */ }
```

---

## 3. Protocol-Native Spillover Envelope Structure

When a tool returns an array or object exceeding `maxPayloadBytes`, the interceptor offloads the data and returns a structured `SpilloverEnvelope`:

```json
{
  "_spillover": true,
  "resourceUri": "resource://data-spillover/spill-f9d2a10b",
  "mimeType": "application/json",
  "sizeBytes": 384120,
  "totalItems": 1250,
  "summary": "1250 items (384.1 KB)",
  "preview": [
    { "id": "tx-1", "amount": 150.00, "status": "completed", "date": "2026-10-15" },
    { "id": "tx-2", "amount": 42.50, "status": "completed", "date": "2026-10-15" }
  ],
  "hint": "Full dataset (1250 items (384.1 KB)) exceeded prompt limit. Read full data via MCP resources/read with URI 'resource://data-spillover/spill-f9d2a10b'."
}
```

### Key Envelope Fields

* `_spillover`: Boolean discriminator allowing LLMs and clients to detect that truncation occurred.
* `resourceUri`: Deterministic MCP resource URI (`resource://data-spillover/{id}`) pointing to the complete payload.
* `sizeBytes`: Total uncompressed payload byte size.
* `totalItems`: Total element count if payload was an array.
* `preview`: Truncated slice containing the first `previewItems` elements, allowing the LLM to inspect schema and fields without full ingestion.
* `hint`: Actionable natural-language instruction explaining how the model can retrieve the full dataset.

---

## 4. How AI Agents Read Spillover Resources

AI models and MCP clients consume the full offloaded dataset on-demand using standard MCP protocol primitives:

1. **Automatic Resource Mounting**: NitroStack automatically mounts an internal resource handler for `resource://data-spillover/{id}`.
2. **Reading with `resources/read`**: The model issues a standard MCP resource read call:
   ```json
   {
     "method": "resources/read",
     "params": {
       "uri": "resource://data-spillover/spill-f9d2a10b"
     }
   }
   ```
3. **Streamed Content Delivery**: The server streams the JSON payload back as resource contents.
4. **Session Isolation**: Resource access is isolated to the session that generated the spillover, preventing cross-tenant data leakage.

---

## 5. Storage Drivers: Memory vs Filesystem

NitroStack supports two built-in spillover storage drivers:

### 1. `MemorySpilloverStore` (`storage: 'memory'`)
* Stores serialized payloads in process memory using a Least-Recently-Used (LRU) cache with automated TTL cleanup.
* **Best For**: Containerized or serverless deployments, stateless microservices, and moderate payload sizes (up to 50MB total cache).
* **Eviction**: Automatically evicts entries older than `spilloverTtlSeconds` (default: 3600 seconds).

### 2. `FsSpilloverStore` (`storage: 'filesystem'`)
* Persists large JSON arrays directly to disk files in a designated temporary directory.
* **Best For**: Persistent server installations, massive report extractions (e.g. 100MB+ logs or CSV exports), and workloads requiring survival across process restarts.
* **Eviction**: Periodic background cleanup task deletes expired spillover files.

```typescript
// Example configuring filesystem spillover store
@UseInterceptors(new DataSpilloverInterceptor({
  maxPayloadBytes: 50 * 1024,   // 50 KB
  storage: 'filesystem',
  spilloverTtlSeconds: 7200,    // Retain on disk for 2 hours
}))
export class ReportTools { /* ... */ }
```
