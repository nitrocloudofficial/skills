---
name: nitrostack-testing-quality
description: Unit and integration testing best practices for NitroStack MCP servers using TestingModule from @nitrostack/core/testing, mock execution contexts, mock loggers, and dependency injection isolation.
---

## When to Use
Use this skill when writing unit tests for tools, resources, prompts, or services, creating integration test suites with dependency injection mocking, inspecting log assertions without console pollution, or testing asynchronous background events.

---

## 1. Test Harness Architecture

NitroStack provides a dedicated, zero-dependency test harness packaged under the explicit subpath export `@nitrostack/core/testing`. It allows you to isolate the DI container, inject mocks, generate realistic execution contexts, and assert behavior without starting external networks or transports:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   Test Harness & Health Architecture                   │
├────────────────────────────────────────────────────────────────────────┤
│  [ TestingModule ]             ──> In-memory DI Container isolation    │
│  - addProvider / addMock       ──> Mock external DB & API dependencies │
│  - createMockContext           ──> Mock logger, auth, and task handles │
│  - createMockFn / spyOn        ──> Method execution & assertion checks │
│                                │                                       │
│                                ▼                                       │
│  [ @HealthCheck Decorators ]   ──> Decorates health check classes      │
│  - System memory & uptime      ──> Node.js process health telemetry    │
│  - Database / Cache ping       ──> Up / Down readiness probes          │
│                                │                                       │
│                                ▼                                       │
│  [ health://checks Resource ]  ──> Auto-exposed MCP monitoring schema  │
│  - /health HTTP endpoint       ──> Express container liveness probe    │
│  - Consumed by NitroStudio     ──> Visual health dashboard on :3000    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Subpath Import Isolation (`@nitrostack/core/testing`)

> [!IMPORTANT]
> Always import testing utilities from the explicit subpath export `@nitrostack/core/testing`. Importing them directly from `@nitrostack/core` will fail compilation because testing primitives are segregated to keep production runtime bundles lean.

```typescript
// Correct
import { TestingModule, createMockContext, MockLogger } from '@nitrostack/core/testing';

// Incorrect: will throw module resolution error
import { TestingModule } from '@nitrostack/core';
```

---

## 3. Test Module Builder (`TestingModule`)

`TestingModule` creates an isolated in-memory dependency injection container for your test suite, allowing you to substitute live database pools, external APIs, or message brokers with mocks.

### Testing a Tool with Mock Providers

```typescript
// test/users.tools.test.ts
import { describe, it, expect, beforeEach } from '@jest/globals';
import { TestingModule, createMockContext } from '@nitrostack/core/testing';
import { UsersTools } from '../src/users/users.tools.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('UsersTools Unit Tests', () => {
  let tools: UsersTools;
  let mockDb: Partial<DatabaseService>;

  beforeEach(() => {
    // 1. Create a typed mock for DatabaseService
    mockDb = {
      query: jest.fn().mockResolvedValue([
        { id: 'usr-101', name: 'Alice Smith', email: 'alice@example.com' },
      ]) as any,
    };

    // 2. Build and compile an isolated TestingModule
    const moduleRef = TestingModule.create()
      .addProvider(UsersTools)
      .addMock(DatabaseService, mockDb)
      .compile();

    // 3. Resolve the tool instance from the container
    tools = moduleRef.get(UsersTools);
  });

  it('should return user details by ID', async () => {
    const ctx = createMockContext({
      auth: { subject: 'admin-usr', scopes: ['read:users'] },
    });

    const result = await tools.getUser({ id: 'usr-101' }, ctx);

    expect(result).toEqual({
      id: 'usr-101',
      name: 'Alice Smith',
      email: 'alice@example.com',
    });
    expect(mockDb.query).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = $1',
      ['usr-101'],
    );
  });
});
```

---

## 4. Mock Execution Context (`createMockContext`)

The `createMockContext(overrides?)` helper supplies a fully conforming `ExecutionContext` object pre-wired with an in-memory `MockLogger`.

### Inspecting Log Assertions
Instead of polluting the test console or hijacking `console.log`, assert logs directly using the logger's built-in `hasLog(level, message)` helper:

```typescript
import { createMockContext } from '@nitrostack/core/testing';
import { PaymentService } from '../src/services/payment.service.js';

describe('PaymentService Logging', () => {
  it('should log audit trace on transaction settlement', async () => {
    const ctx = createMockContext({
      requestId: 'req-test-99',
      auth: { subject: 'customer-123' },
    });

    const service = new PaymentService();
    await service.settleCharge({ amount: 50.00 }, ctx);

    // Assert that the logger captured the expected log entry
    expect(ctx.logger.hasLog('info', 'Charge settled for customer-123')).toBe(true);
    expect(ctx.logger.hasLog('error', 'Payment failed')).toBe(false);
  });
});
```

---

## 5. Built-in Mock Functions & Spies (`createMockFn`, `spyOn`)

NitroStack ships with zero-dependency mock functions and method spies that seamlessly adapt whether running under Jest, Vitest, or standard Node.js test runners:

### `createMockFn()`
Creates a mock function recording invocations and arguments:

```typescript
import { createMockFn } from '@nitrostack/core/testing';

const mockSendEmail = createMockFn();
mockSendEmail.mockResolvedValue({ status: 'sent', id: 'email-1' });

await mockSendEmail('user@test.com', 'Welcome');

expect(mockSendEmail.calls.length).toBe(1);
expect(mockSendEmail.calls[0]).toEqual(['user@test.com', 'Welcome']);
```

### `spyOn(object, method)`
Spies on an existing method and allows restoring the original implementation:

```typescript
import { spyOn } from '@nitrostack/core/testing';
import { MetricsService } from '../src/services/metrics.service.js';

const metrics = new MetricsService();
const spy = spyOn(metrics, 'recordExecutionTime');

await service.runTask(metrics);

expect(spy.calls.length).toBe(1);

// Restore original implementation after test completion
spy.restore();
```

---

## 6. Testing Asynchronous Events with `flushPromises`

When testing methods that dispatch asynchronous events via `emitEvent()`, background handlers execute on the next tick of the event loop. Use `flushPromises()` to wait for all queued microtasks and immediate handlers to settle before asserting:

```typescript
import { flushPromises } from '@nitrostack/core/testing';
import { emitEvent } from '@nitrostack/core';
import { AuditLogHandler } from '../src/handlers/audit.handler.js';

describe('Event Dispatching', () => {
  it('should trigger audit log handler on order event', async () => {
    const handler = new AuditLogHandler();
    const handleSpy = spyOn(handler, 'onOrderPlaced');

    // Trigger internal asynchronous event
    emitEvent('order.placed', { orderId: 'ord-55', amount: 99.00 });

    // Wait for all asynchronous event promises to resolve
    await flushPromises();

    expect(handleSpy.calls.length).toBe(1);
    expect(handleSpy.calls[0][0]).toEqual({ orderId: 'ord-55', amount: 99.00 });
  });
});
```
