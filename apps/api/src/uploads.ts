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

const UPLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

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
export async function registerUploads(app: FastifyInstance) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  await app.register(fastifyStatic, { root: UPLOAD_DIR, prefix: '/uploads/files/' });

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
