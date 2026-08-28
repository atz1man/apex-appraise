import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { issuedBefore, prisma, principalFromAuthHeader } from './context.js';
import { guard, internalWriter } from './http-guards.js';
import { signDownloadToken, verifyDownloadToken } from './download-token.js';

const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

/** Resolve a stored document's `/uploads/files/<key>` URL to its on-disk path. */
export function uploadPathFor(url: string): string | null {
  const prefix = '/uploads/files/';
  if (!url.startsWith(prefix)) return null;
  const key = url.slice(prefix.length);
  if (key.includes('/') || key.includes('..')) return null; // no traversal
  return path.join(UPLOAD_DIR, key);
}

/**
 * Who is asking, for the upload routes.
 *
 * These are plain Fastify routes rather than tRPC procedures, so they do not go
 * through createContext — and this function used to verify the session token
 * itself, in a second copy of the same six lines. The copy then fell behind:
 * when sessions gained a cutoff (User.sessionsValidFrom, see context.ts), tRPC
 * honoured it and this did not. Changing a phished password shut the attacker
 * out of the application while leaving them the data room: every client
 * document readable, and uploads into it still accepted.
 *
 * One verifier now, shared. The `internal` check stays here because it is this
 * surface's own rule — an investor or buyer portal login has no business
 * writing to a firm's document store.
 */
export async function principalFrom(req: Pick<FastifyRequest, 'headers'>, db = prisma) {
  const principal = await principalFromAuthHeader(db, req.headers.authorization);
  return principal?.principalType === 'internal' ? principal : null;
}

const safeName = (name: string) => name.replace(/[^\w.\- ()£]/g, '_');

/**
 * Real file storage for the data room and site photo log. Local disk in dev
 * (apps/api/uploads/, gitignored); swap the write for S3 presigned uploads in prod —
 * the URL contract (`/uploads/files/<key>`) stays the same.
 */

/**
 * Which organisation owns a stored file.
 *
 * Uploads land in three places — deal documents, site photos and firm logos — and
 * the key alone says nothing about who owns it. Anything not claimed by a row is
 * not served at all, which also covers files left on disk by a deleted workspace.
 */
/**
 * Append a file token to a stored upload URL.
 *
 * Returns anything that is not one of our upload URLs untouched — an external
 * link or an empty string is not ours to sign, and quietly rewriting it would
 * break it.
 */
export function signFileUrl(url: string | null | undefined, userId: string): string {
  if (!url || !url.startsWith('/uploads/files/')) return url ?? '';
  const key = url.slice('/uploads/files/'.length);
  return `${url}?t=${encodeURIComponent(signDownloadToken({ sub: userId, kind: 'file', key }))}`;
}

async function orgForKey(key: string, db: PrismaClient = prisma): Promise<string | null> {
  const url = `/uploads/files/${key}`;
  const [doc, photo, org] = await Promise.all([
    db.document.findFirst({ where: { url }, select: { orgId: true } }),
    db.sitePhoto.findFirst({ where: { url }, select: { orgId: true } }),
    db.organisation.findFirst({ where: { logoUrl: url }, select: { id: true } }),
  ]);
  return doc?.orgId ?? photo?.orgId ?? org?.id ?? null;
}

/**
 * Refuse an upload whose bytes are already on disk.
 *
 * Multipart has to be consumed before the fields it carries can be read, so the
 * file is written before the deal or the contractor it names can be checked.
 * Every refusal after that point left the bytes behind with no row that would
 * ever reference them: an internal member of one firm posting to another firm's
 * deal id got a 404 and a permanent file, and nothing collects them. The logo
 * route already unlinks when it rejects an oversize image; these did not.
 *
 * Best-effort on the unlink — a file that is already gone is the outcome we
 * wanted, and failing the refusal because the cleanup failed would turn a 404
 * into a 500.
 */
async function refuse(
  reply: FastifyReply,
  code: number,
  error: string,
  ...keys: (string | null | undefined)[]
) {
  const { unlink } = await import('node:fs/promises');
  await Promise.all(
    keys.filter((k): k is string => !!k).map((k) => unlink(path.join(UPLOAD_DIR, k)).catch(() => {})),
  );
  return reply.code(code).send({ error });
}

export async function registerUploads(app: FastifyInstance, db: PrismaClient = prisma) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  /**
   * Uploaded files are SERVED behind a check, not by a static handler.
   *
   * `fastifyStatic` used to answer /uploads/files/<key> to anyone. The keys are
   * `<Date.now()>-<original filename>`, so "cost-plan.pdf" or
   * "planning-decision.pdf" plus a timestamp — guessable, and it did not much
   * matter, because nothing was checked anyway. A client's cost plan came back
   * with HTTP 200 to a request carrying no credentials at all.
   *
   * Two ways in, because two kinds of caller exist. Application code can send a
   * bearer header; an <img> or a link in a new tab cannot, so those carry a token
   * scoped to the single file (see download-token.ts). Both end in the same
   * question: does this file belong to the caller's organisation?
   */
  await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/raw-internal/', serve: false });

  app.get<{ Params: { '*': string }; Querystring: { t?: string } }>('/uploads/files/*', async (req, reply) => {
    const key = req.params['*'];
    if (!key || key.includes('..')) return reply.code(400).send({ error: 'bad key' });

    const owner = await orgForKey(key, db);
    // a key nobody owns is not a file we serve — never fall back to the disk
    if (!owner) return reply.code(404).send({ error: 'not found' });

    const bearer = await principalFrom(req, db);
    let allowed = bearer?.orgId === owner;
    if (!allowed && req.query.t) {
      const claim = verifyDownloadToken(req.query.t, { kind: 'file', key });
      if (claim) {
        const u = await db.user.findUnique({ where: { id: claim.userId } });
        /**
         * The session cutoff applies here too. A file token lives half an hour
         * — long enough to matter, and this branch already has the row in hand,
         * so honouring it costs nothing. Tokens are minted at render time, so
         * `iat` is when the page was drawn.
         */
        allowed = !!u && u.orgId === owner && !issuedBefore(claim.issuedAt, u.sessionsValidFrom);
      }
    }
    // the same 404 either way: whether a file exists is not something to confirm
    // to someone who may not have it
    if (!allowed) return reply.code(404).send({ error: 'not found' });

    reply.header('cache-control', 'private, no-store');
    reply.header('x-robots-tag', 'noindex, nofollow');
    return reply.sendFile(key, UPLOAD_DIR);
  });

  app.post('/uploads/document', async (req, reply) => {
    // the whole internalProcedure chain, in one place — see http-guards.ts
    const user = await guard(reply, () => internalWriter(req, 'uploads.document', db));
    if (!user) return;
    const parts = req.parts();
    let dealId = '';
    let category = 'Legal';
    let stored: { key: string; filename: string; bytes: number } | null = null;
    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'dealId') dealId = String(part.value);
        if (part.fieldname === 'category') category = String(part.value);
      } else {
        const key = `${Date.now()}-${safeName(part.filename)}`;
        const dest = path.join(UPLOAD_DIR, key);
        await pipeline(part.file, createWriteStream(dest));
        const { size } = await import('node:fs/promises').then((fs) => fs.stat(dest));
        stored = { key, filename: part.filename, bytes: size };
      }
    }
    // split so the cleanup has a file to name: no upload, nothing to collect
    if (!stored) return reply.code(400).send({ error: 'file and dealId required' });
    if (!dealId) return refuse(reply, 400, 'file and dealId required', stored.key);
    const deal = await db.deal.findFirst({ where: { id: dealId, orgId: user.orgId } });
    if (!deal) return refuse(reply, 404, 'deal not found', stored.key);
    const ext = stored.filename.includes('.') ? stored.filename.split('.').pop()! : 'pdf';
    const doc = await db.document.create({
      data: {
        orgId: user.orgId,
        dealId,
        name: stored.filename,
        category,
        ext,
        sizeBytes: BigInt(stored.bytes),
        url: `/uploads/files/${stored.key}`,
        extraction: 'STORED',
        addedById: user.userId,
      },
    });
    await db.activityEvent.create({
      data: { orgId: user.orgId, dealId, actor: user.name, action: 'uploaded', target: stored.filename },
    });
    return { id: doc.id, url: doc.url };
  });

  /**
   * Firm logo for client-facing documents. Admin only, raster only: an SVG
   * served from this origin can carry script that runs when the file is opened
   * directly, and a logo is not worth that.
   */
  app.post('/uploads/logo', async (req, reply) => {
    // the whole internalProcedure chain, in one place — see http-guards.ts
    const user = await guard(reply, () => internalWriter(req, 'uploads.logo', db));
    if (!user) return;
    if (user.role !== 'ADMIN') return reply.code(403).send({ error: 'admin access required' });
    const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
    const MAX_BYTES = 2 * 1024 * 1024;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'file required' });
    const ext = ALLOWED[file.mimetype];
    if (!ext) return reply.code(415).send({ error: 'PNG, JPEG or WebP only' });
    const key = `logo-${user.orgId}-${Date.now()}.${ext}`;
    const dest = path.join(UPLOAD_DIR, key);
    await pipeline(file.file, createWriteStream(dest));
    const { stat, unlink } = await import('node:fs/promises');
    const { size } = await stat(dest);
    if (size > MAX_BYTES) {
      await unlink(dest);
      return reply.code(413).send({ error: 'Logo must be 2MB or smaller' });
    }
    const url = `/uploads/files/${key}`;
    await db.organisation.update({ where: { id: user.orgId }, data: { logoUrl: url } });
    return { url };
  });

  app.post('/uploads/photo', async (req, reply) => {
    // the whole internalProcedure chain, in one place — see http-guards.ts
    const user = await guard(reply, () => internalWriter(req, 'uploads.photo', db));
    if (!user) return;
    const parts = req.parts();
    let dealId = '';
    let contractorId: string | null = null;
    let caption = 'Site photo';
    let takenAt = new Date().toISOString().slice(0, 10);
    let key: string | null = null;
    for await (const part of parts) {
      if (part.type === 'field') {
        if (part.fieldname === 'dealId') dealId = String(part.value);
        if (part.fieldname === 'contractorId') contractorId = String(part.value) || null;
        if (part.fieldname === 'caption') caption = String(part.value);
        if (part.fieldname === 'takenAt') takenAt = String(part.value);
      } else {
        key = `${Date.now()}-${safeName(part.filename)}`;
        await pipeline(part.file, createWriteStream(path.join(UPLOAD_DIR, key)));
      }
    }
    // split so the cleanup has a file to name: no upload, nothing to collect
    if (!key) return reply.code(400).send({ error: 'file and dealId required' });
    if (!dealId) return refuse(reply, 400, 'file and dealId required', key);
    const deal = await db.deal.findFirst({ where: { id: dealId, orgId: user.orgId } });
    if (!deal) return refuse(reply, 404, 'deal not found', key);
    // the deal and the contractor are two independent inputs. The tRPC twin of
    // this route took the same id on trust, and firm B's subcontractor name then
    // rendered on firm A's cost screen — `photos.list` joins the contractor and
    // filters only on the photo's own orgId.
    if (contractorId && !(await db.contractor.findFirst({ where: { id: contractorId, orgId: user.orgId } })))
      return refuse(reply, 404, 'contractor not found', key);
    const taken = new Date(takenAt + 'T00:00:00Z');
    const wc = new Date(taken);
    wc.setUTCDate(wc.getUTCDate() - ((wc.getUTCDay() + 6) % 7));
    const photo = await db.sitePhoto.create({
      data: {
        orgId: user.orgId,
        dealId,
        caption,
        contractorId,
        url: `/uploads/files/${key}`,
        takenAt: taken,
        weekCommencing: wc,
      },
    });
    /**
     * The same event its tRPC twin writes, and for the reason `photos.add` gives:
     * the site log is what a disputed valuation of works-in-progress is argued
     * from, and `takenAt` is typed by hand — so when it was RECORDED, and by
     * whom, is a different fact from when it was taken, and the only one of the
     * two that cannot be backdated.
     *
     * This is the door that carries the actual photograph; `photos.add` creates a
     * row with no image. The argument was written on the wrong one.
     */
    await db.activityEvent.create({
      data: {
        orgId: user.orgId,
        dealId,
        userId: user.userId,
        actor: user.name,
        action: 'added a site photo',
        target: `${caption} · taken ${takenAt}`,
      },
    });
    return { id: photo.id, url: photo.url };
  });
}
