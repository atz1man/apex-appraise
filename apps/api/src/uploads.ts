import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { JWT_SECRET, prisma } from './context.js';
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

async function principalFrom(req: FastifyRequest) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { sub: string };
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    return user && user.principalType === 'internal' ? user : null;
  } catch {
    return null;
  }
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

async function orgForKey(key: string): Promise<string | null> {
  const url = `/uploads/files/${key}`;
  const [doc, photo, org] = await Promise.all([
    prisma.document.findFirst({ where: { url }, select: { orgId: true } }),
    prisma.sitePhoto.findFirst({ where: { url }, select: { orgId: true } }),
    prisma.organisation.findFirst({ where: { logoUrl: url }, select: { id: true } }),
  ]);
  return doc?.orgId ?? photo?.orgId ?? org?.id ?? null;
}

export async function registerUploads(app: FastifyInstance) {
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

    const owner = await orgForKey(key);
    // a key nobody owns is not a file we serve — never fall back to the disk
    if (!owner) return reply.code(404).send({ error: 'not found' });

    const bearer = await principalFrom(req);
    let allowed = bearer?.orgId === owner;
    if (!allowed && req.query.t) {
      const claim = verifyDownloadToken(req.query.t, { kind: 'file', key });
      if (claim) {
        const u = await prisma.user.findUnique({ where: { id: claim.userId } });
        allowed = !!u && u.orgId === owner;
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
    const user = await principalFrom(req);
    if (!user) return reply.code(401).send({ error: 'unauthorised' });
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
    if (!stored || !dealId) return reply.code(400).send({ error: 'file and dealId required' });
    const deal = await prisma.deal.findFirst({ where: { id: dealId, orgId: user.orgId } });
    if (!deal) return reply.code(404).send({ error: 'deal not found' });
    const ext = stored.filename.includes('.') ? stored.filename.split('.').pop()! : 'pdf';
    const doc = await prisma.document.create({
      data: {
        orgId: user.orgId,
        dealId,
        name: stored.filename,
        category,
        ext,
        sizeBytes: BigInt(stored.bytes),
        url: `/uploads/files/${stored.key}`,
        extraction: 'STORED',
        addedById: user.id,
      },
    });
    await prisma.activityEvent.create({
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
    const user = await principalFrom(req);
    if (!user) return reply.code(401).send({ error: 'unauthorised' });
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
    await prisma.organisation.update({ where: { id: user.orgId }, data: { logoUrl: url } });
    return { url };
  });

  app.post('/uploads/photo', async (req, reply) => {
    const user = await principalFrom(req);
    if (!user) return reply.code(401).send({ error: 'unauthorised' });
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
    if (!key || !dealId) return reply.code(400).send({ error: 'file and dealId required' });
    const deal = await prisma.deal.findFirst({ where: { id: dealId, orgId: user.orgId } });
    if (!deal) return reply.code(404).send({ error: 'deal not found' });
    const taken = new Date(takenAt + 'T00:00:00Z');
    const wc = new Date(taken);
    wc.setUTCDate(wc.getUTCDate() - ((wc.getUTCDay() + 6) % 7));
    const photo = await prisma.sitePhoto.create({
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
    return { id: photo.id, url: photo.url };
  });
}
