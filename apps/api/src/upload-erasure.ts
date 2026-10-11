import type { PrismaClient } from '@prisma/client';
import { unlink } from 'node:fs/promises';
import { uploadPathFor } from './uploads.js';

/** Bounded durable outbox drain. Upload keys are server-generated and never
 * reused; public mutations cannot attach an existing URL. Check all references
 * anyway so legacy/shared references cannot erase another firm's live file. */
export async function drainUploadErasure(db: PrismaClient, opts: {
  now?: Date;
  remove?: (path: string) => Promise<void>;
} = {}) {
  const now = opts.now ?? new Date();
  const remove = opts.remove ?? unlink;
  const jobs = await db.uploadErasure.findMany({
    where: { nextAttemptAt: { lte: now } }, orderBy: [{ nextAttemptAt: 'asc' }, { url: 'asc' }], take: 100,
  });
  let removed = 0;
  let deferred = 0;
  for (const job of jobs) {
    // Only a direct local filename may be erased. Never follow URLs or paths.
    const key = job.url.slice('/uploads/files/'.length);
    const file = job.url.startsWith('/uploads/files/') && key && !/[\\/\x00?#]/.test(key)
      ? uploadPathFor(job.url) : null;
    if (!file) {
      // Keep invalid work observable and retryable, without touching any path.
      await db.uploadErasure.updateMany({ where: { url: job.url }, data: {
        attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 86_400_000),
      } });
      deferred++;
      continue;
    }
    const [doc, photo, logo] = await Promise.all([
      db.document.count({ where: { url: job.url } }),
      db.sitePhoto.count({ where: { url: job.url } }),
      db.organisation.count({ where: { logoUrl: job.url } }),
    ]);
    try {
      if (doc || photo || logo) {
        deferred++;
        await db.uploadErasure.updateMany({ where: { url: job.url }, data: { nextAttemptAt: new Date(now.getTime() + 3_600_000) } });
        continue;
      }
      try { await remove(file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      // A crash after unlink is safe: ENOENT is success on the next drain.
      await db.uploadErasure.deleteMany({ where: { url: job.url } });
      removed++;
    } catch {
      await db.uploadErasure.updateMany({ where: { url: job.url }, data: {
        attempts: { increment: 1 },
        nextAttemptAt: new Date(now.getTime() + Math.min(3_600_000, 60_000 * 2 ** Math.min(job.attempts, 6))),
      } });
      deferred++;
    }
  }
  return { removed, deferred };
}

export function startUploadErasure(db: PrismaClient, report: (result: { removed: number; deferred: number }) => void, onError: (error: unknown) => void) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { const result = await drainUploadErasure(db); if (result.removed || result.deferred) report(result); }
    catch (error) { onError(error); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
