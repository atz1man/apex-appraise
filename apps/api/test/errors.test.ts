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

  it('folds identifiers out of the path, so one bug is one row and no token is stored', async () => {
    /**
     * Faults from a browser carry the customer's own URL, and this app's routes
     * carry ids. Without this, a screen broken on fifty deals writes fifty rows
     * and evicts real faults from a capped table — and `/terms/<signing token>`
     * stores a live credential in the table redaction exists to keep clean.
     */
    const token = 'a3f9c1d4e7b20518aa6c3d9f1e4b7c2d0918f6a3b5c7d9e1';
    await captureError(prisma, {
      orgId: T.orgId,
      method: 'CLIENT',
      path: `/terms/${token}`,
      statusCode: 0,
      code: 'CLIENT_RENDER',
      message: 'signing page blew up',
    });
    const row = await prisma.errorEvent.findFirstOrThrow({ where: { message: 'signing page blew up' } });
    expect(row.path).toBe('/terms/:id');
    expect(row.path).not.toContain(token);

    // and the same fault on two different deals is one row, not two
    await captureError(prisma, { orgId: T.orgId, method: 'CLIENT', path: '/deal/clx1234567890abcdefghij/report', statusCode: 0, message: 'report blew up' });
    await captureError(prisma, { orgId: T.orgId, method: 'CLIENT', path: '/deal/clz0987654321zyxwvutsr/report', statusCode: 0, message: 'report blew up' });
    const folded = await prisma.errorEvent.findMany({ where: { message: 'report blew up' } });
    expect(folded).toHaveLength(1);
    expect(folded[0]!.path).toBe('/deal/:id/report');
    expect(folded[0]!.count).toBe(2);
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

  it('shows each firm the SAME bug, instead of only the firm that hit it first', async () => {
    /**
     * Folding used to be global. Two firms hitting one bug produced one row,
     * owned by whoever got there first — so the second firm's admin read an
     * empty error log while their customers were looking at the failure. A log
     * that is silent for everyone but the first reporter is worse than none,
     * because it is trusted.
     *
     * Asserted for BOTH principals: a shared bug must be visible from each side.
     */
    const other = await makeTenant('Shared-Bug');
    const shared = { method: 'CLIENT', path: '/board', statusCode: 0, code: 'CLIENT_RENDER', message: 'deals.map is not a function' };
    await captureError(prisma, { ...shared, orgId: T.orgId });
    await captureError(prisma, { ...shared, orgId: other.orgId });

    for (const tenant of [T, other]) {
      const rows = (await callerFor(tenant.principal).org.errors({ limit: 50 } as never)) as Array<{ message: string; count: number }>;
      const mine = rows.filter((r) => r.message === shared.message);
      expect(mine).toHaveLength(1);
      // each side sees its OWN occurrence, not a count of the other's traffic
      expect(mine[0]!.count).toBe(1);
    }
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
