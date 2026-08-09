import { beforeAll, describe, expect, it } from 'vitest';
import { captureError, httpCapturePayload, redact, trpcCapturePayload } from '../src/errors.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

let T: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Errors');
}, 120_000);

describe('redaction', () => {
  it('removes anything that looks like a credential', () => {
    /**
     * On the way IN, not on the way out: an error log is exported into tickets
     * and pasted into chats, so a token that reaches the table has effectively
     * been published. Only one of those directions is reversible.
     */
    const dirty = [
      'auth failed for eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.abc123signature',
      'stripe said sk_live_abcdef123456 is invalid',
      'anthropic sk-ant-api03-secret_value_here rejected',
      'user surveyor@clientfirm.co.uk not found',
      'connect postgresql://apex:hunter2@db:5432/apex failed',
      '{"password":"hunter2","authorization":"Bearer abc"}',
    ].join(' | ');

    const clean = redact(dirty);
    for (const secret of ['eyJhbGciOiJIUzI1NiJ9', 'sk_live_abcdef123456', 'sk-ant-api03', 'surveyor@clientfirm.co.uk', 'hunter2']) {
      expect(clean).not.toContain(secret);
    }
    // and it still says what went wrong
    expect(clean).toContain('auth failed');
    expect(clean).toContain('stripe said');
  });
});

describe('capture', () => {
  it('records a fault with enough to find it', async () => {
    await captureError(prisma, {
      orgId: T.orgId,
      userId: T.userId,
      method: 'POST',
      path: 'trpc/deals.create?batch=1',
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Cannot read properties of undefined',
      stack: 'Error: boom\n  at thing (file.ts:1:1)',
    });
    const row = await prisma.errorEvent.findFirstOrThrow({ where: { orgId: T.orgId } });
    expect(row.path).toBe('trpc/deals.create'); // query string dropped
    expect(row.count).toBe(1);
    expect(row.stack).toContain('at thing');
  });

  it('folds repeats into one row instead of burying the other bugs', async () => {
    const again = () =>
      captureError(prisma, {
        orgId: T.orgId,
        method: 'POST',
        path: 'trpc/deals.create',
        statusCode: 500,
        message: 'Cannot read properties of undefined',
      });
    await again();
    await again();
    const rows = await prisma.errorEvent.findMany({ where: { message: 'Cannot read properties of undefined' } });
    // one bug reached from many requests is one thing to fix
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(3);
  });

  it('never throws, whatever it is handed', async () => {
    // reporting a fault must not cause one
    await expect(
      captureError(null as never, { method: 'GET', path: '/x', statusCode: 500, message: 'x' }),
    ).resolves.toBeUndefined();
  });
});

describe('who can read them', () => {
  it('is admin-only, and hides the stack from the list', async () => {
    const rows = (await callerFor(T.principal).org.errors({ limit: 10 } as never)) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    // the stack is the part most likely to carry something that should not travel
    expect(rows[0]).not.toHaveProperty('stack');

    await expect(
      callerFor({ ...T.principal, role: 'ANALYST' }).org.errors({ limit: 10 } as never),
    ).rejects.toThrow(/Admin/i);
  });

  it('does not show one firm the other’s faults', async () => {
    const other = await makeTenant('Rival');
    await captureError(prisma, { orgId: other.orgId, method: 'GET', path: '/theirs', statusCode: 500, message: 'their problem' });
    const rows = (await callerFor(T.principal).org.errors({ limit: 50 } as never)) as Array<{ path: string }>;
    expect(rows.map((r) => r.path)).not.toContain('/theirs');
  });
});

describe('what gets recorded at all', () => {
  it('records a server fault and ignores the API correctly saying no', () => {
    /**
     * The rule most worth getting wrong. A NOT_FOUND or a FORBIDDEN is the system
     * working; a log full of those buries the real faults underneath.
     */
    const server = trpcCapturePayload(
      { code: 'INTERNAL_SERVER_ERROR', message: 'boom', stack: 'at x' },
      { path: 'deals.create', type: 'mutation', orgId: 'org1', userId: 'u1' },
    );
    expect(server).toMatchObject({ path: 'trpc/deals.create', method: 'MUTATION', statusCode: 500, orgId: 'org1' });

    for (const code of ['NOT_FOUND', 'FORBIDDEN', 'BAD_REQUEST', 'UNAUTHORIZED', 'CONFLICT', 'TOO_MANY_REQUESTS']) {
      expect(trpcCapturePayload({ code, message: 'no' }, { type: 'query' })).toBeNull();
    }
  });

  it('prefers the underlying cause’s stack, which is where the bug is', () => {
    const cause = new Error('the real one');
    const p = trpcCapturePayload(
      { code: 'INTERNAL_SERVER_ERROR', message: 'wrapped', stack: 'at trpc-wrapper', cause },
      { path: 'x', type: 'query' },
    );
    expect(p!.stack).toBe(cause.stack);
  });

  it('captures 5xx from the non-tRPC routes and lets 4xx through untouched', () => {
    expect(httpCapturePayload({ statusCode: 500, message: 'render failed' }, { method: 'GET', url: '/reports/x.pdf' }))
      .toMatchObject({ statusCode: 500, path: '/reports/x.pdf' });
    // a missing route or a rejected upload is not a fault of ours
    expect(httpCapturePayload({ statusCode: 404, message: 'nope' }, { method: 'GET', url: '/x' })).toBeNull();
    expect(httpCapturePayload({ statusCode: 406, message: 'not multipart' }, { method: 'POST', url: '/uploads/logo' })).toBeNull();
    // no statusCode at all is the worst case — an unhandled throw — and counts
    expect(httpCapturePayload({ message: 'unhandled' }, { method: 'GET', url: '/x' })).toMatchObject({ statusCode: 500 });
  });
});
