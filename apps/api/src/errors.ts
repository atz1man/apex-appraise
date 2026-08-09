import type { PrismaClient } from '@prisma/client';

/**
 * Server faults, captured where someone can look at them.
 *
 * Until now a 500 in production went to a warn-level logger on an ephemeral
 * machine and was gone. You cannot fix what you cannot see, and "a customer said
 * it broke last Tuesday" is not a bug report.
 *
 * Self-hosted on purpose. An external provider would be less work, but it is also
 * a decision about where a firm's data goes — and for a product holding client
 * valuations under a data-residency policy, that decision belongs to the owner,
 * not to this file. The cost is that retention and volume have to be bounded
 * here, which is what the rest of this module is.
 */

/** Keep the table small enough to stay useful and cheap to read. */
const MAX_ROWS = 500;
const MAX_STACK = 4000;
const MAX_MESSAGE = 1000;

/**
 * Anything that looks like a credential is removed before storage.
 *
 * An error log is read by more people than the database is, exported into
 * tickets, and pasted into chats. A token that reaches it has effectively been
 * published — so the redaction runs on the way IN, not on the way out, because
 * only one of those is reversible.
 */
const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, '[jwt]'],
  [/\bsk_(live|test)_[A-Za-z0-9]{6,}/g, '[stripe-key]'],
  [/\bsk-ant-[A-Za-z0-9_-]{6,}/g, '[anthropic-key]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[email]'],
  [/(password|secret|token|authorization)("?\s*[:=]\s*"?)([^",\s]+)/gi, '$1$2[redacted]'],
  [/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/gi, '$1[redacted]$2'],
];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, [re, to]) => acc.replace(re, to), text);
}

export interface CapturedError {
  orgId?: string | null;
  userId?: string | null;
  method: string;
  path: string;
  statusCode: number;
  code?: string | null;
  message: string;
  stack?: string | null;
}

/**
 * Record a fault, folding repeats into one row.
 *
 * Deduplication is on (path, message) rather than on the stack: the same bug
 * reached from a hundred requests is one thing to fix, and a hundred rows of it
 * would bury the other ninety-nine bugs underneath.
 */
export async function captureError(prisma: PrismaClient, e: CapturedError): Promise<void> {
  try {
    const message = redact(e.message).slice(0, MAX_MESSAGE);
    const path = e.path.split('?')[0]!.slice(0, 300);
    const stack = e.stack ? redact(e.stack).slice(0, MAX_STACK) : null;

    const existing = await prisma.errorEvent.findFirst({ where: { path, message } });
    if (existing) {
      await prisma.errorEvent.update({
        where: { id: existing.id },
        data: { count: { increment: 1 }, lastAt: new Date(), statusCode: e.statusCode },
      });
      return;
    }

    await prisma.errorEvent.create({
      data: {
        orgId: e.orgId ?? null,
        userId: e.userId ?? null,
        method: e.method,
        path,
        statusCode: e.statusCode,
        code: e.code ?? null,
        message,
        stack,
      },
    });

    // Prune only when a new distinct fault appears, so an error storm — which
    // increments rather than inserts — cannot also spin the delete path.
    const total = await prisma.errorEvent.count();
    if (total > MAX_ROWS) {
      const oldest = await prisma.errorEvent.findMany({
        orderBy: { lastAt: 'asc' },
        take: total - MAX_ROWS,
        select: { id: true },
      });
      await prisma.errorEvent.deleteMany({ where: { id: { in: oldest.map((o) => o.id) } } });
    }
  } catch {
    // Reporting a fault must never cause one. If this write fails the request has
    // already gone wrong; making it go wrong twice helps nobody.
  }
}

/**
 * The two handlers, exported so the FILTERING can be tested.
 *
 * They were inline in main.ts, where the only way to exercise them was to provoke
 * a real 500 — and every malformed request the API was offered came back as a
 * correct 4xx, which is the system working and left this logic unverified. The
 * rule they encode ("5xx only") is the part worth getting wrong, so it lives
 * somewhere a test can reach.
 */

export interface TrpcErrorish {
  code: string;
  message: string;
  stack?: string;
  cause?: unknown;
}

/** Returns what would be captured, or null when the error is not ours to record. */
export function trpcCapturePayload(
  error: TrpcErrorish,
  opts: { path?: string; type: string; orgId?: string | null; userId?: string | null },
): CapturedError | null {
  // a NOT_FOUND or a FORBIDDEN is the API working; recording those buries the
  // faults under a log of the system correctly saying no
  if (error.code !== 'INTERNAL_SERVER_ERROR') return null;
  return {
    orgId: opts.orgId ?? null,
    userId: opts.userId ?? null,
    method: opts.type.toUpperCase(),
    path: `trpc/${opts.path ?? 'unknown'}`,
    statusCode: 500,
    code: error.code,
    message: error.message,
    stack: error.cause instanceof Error ? error.cause.stack : error.stack,
  };
}

export function httpCapturePayload(
  error: { statusCode?: number; code?: string; message: string; stack?: string },
  req: { method: string; url: string },
): CapturedError | null {
  const statusCode = error.statusCode ?? 500;
  if (statusCode < 500) return null;
  return {
    method: req.method,
    path: req.url,
    statusCode,
    code: error.code ?? null,
    message: error.message,
    stack: error.stack,
  };
}
