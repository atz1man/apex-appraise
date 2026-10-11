import { readFile, unlink } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { JWT_SECRET } from '../src/context.js';
import { registerUploads, uploadPathFor } from '../src/uploads.js';
import { drainUploadErasure } from '../src/upload-erasure.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});

const app = Fastify();
const files = new Set<string>();
beforeAll(async () => { resetDatabase(); await registerUploads(app, prisma); await app.ready(); }, 120_000);
afterAll(async () => { await app.close(); for (const url of files) await unlink(uploadPathFor(url)!).catch(() => {}); });
const token = (t: Tenant) => jwt.sign({ sub: t.userId }, JWT_SECRET, { expiresIn: '1h' });
async function upload(t: Tenant, kind: 'document' | 'photo' | 'logo') {
  const b = '----erasure-test';
  const payload = `--${b}\r\nContent-Disposition: form-data; name="dealId"\r\n\r\n${t.dealId}\r\n` +
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="fixture..png"\r\nContent-Type: image/png\r\n\r\nsynthetic-${kind}\r\n--${b}--\r\n`;
  const response = await app.inject({ method: 'POST', url: `/uploads/${kind}`, headers: {
    authorization: `Bearer ${token(t)}`, 'content-type': `multipart/form-data; boundary=${b}`,
  }, payload });
  if (response.statusCode === 200) files.add(response.json().url);
  return response;
}
async function erase(t: Tenant) {
  const org = await prisma.organisation.findUniqueOrThrow({ where: { id: t.orgId } });
  return callerFor(t.principal).org.deleteWorkspace({ confirmName: org.name });
}

it('queues all three upload kinds, retries failed removals and preserves another tenant', async () => {
  const a = await makeTenant('EraseBytes');
  const b = await makeTenant('KeepBytes');
  const urls: string[] = [];
  for (const kind of ['document', 'photo', 'logo'] as const) {
    const response = await upload(a, kind);
    expect(response.statusCode).toBe(200);
    urls.push(response.json().url);
  }
  const keep = (await upload(b, 'document')).json().url;
  const keptBytes = await readFile(uploadPathFor(keep)!);
  await erase(a);
  expect(await prisma.uploadErasure.count()).toBe(3);
  const now = new Date(Date.now() + 1000);
  expect(await drainUploadErasure(prisma, { now, remove: async () => { throw Object.assign(new Error('busy'), { code: 'EACCES' }); } })).toEqual({ removed: 0, deferred: 3 });
  expect(await prisma.uploadErasure.count({ where: { attempts: 1 } })).toBe(3);
  for (const url of urls) expect((await readFile(uploadPathFor(url)!)).length).toBeGreaterThan(0);
  expect(await drainUploadErasure(prisma, { now })).toEqual({ removed: 0, deferred: 0 });
  expect(await drainUploadErasure(prisma, { now: new Date(now.getTime() + 61_000) })).toEqual({ removed: 3, deferred: 0 });
  for (const url of urls) await expect(readFile(uploadPathFor(url)!)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(uploadPathFor(keep)!)).toEqual(keptBytes);
  expect(await prisma.uploadErasure.count()).toBe(0);
  expect((await app.inject({ method: 'GET', url: keep, headers: { authorization: `Bearer ${token(b)}` } })).statusCode).toBe(200);
});

it('rolls the queue back with a refused database deletion', async () => {
  const a = await makeTenant('RollbackBytes');
  const url = (await upload(a, 'document')).json().url;
  await prisma.$executeRawUnsafe(`CREATE TRIGGER refuse_org_erasure BEFORE DELETE ON "Organisation" BEGIN SELECT RAISE(ABORT, 'test rollback'); END`);
  try { await expect(erase(a)).rejects.toThrow(); }
  finally { await prisma.$executeRawUnsafe('DROP TRIGGER refuse_org_erasure'); }
  expect(await prisma.uploadErasure.count({ where: { url } })).toBe(0);
  expect(await prisma.document.count({ where: { url } })).toBe(1);
  expect((await readFile(uploadPathFor(url)!)).length).toBeGreaterThan(0);
});

it('defers shared references, recovers after unlink, and refuses invalid paths', async () => {
  const a = await makeTenant('SharedBytes');
  const b = await makeTenant('SharedSurvivor');
  const url = (await upload(a, 'document')).json().url;
  // Legacy anomaly: no public endpoint can attach an arbitrary file URL.
  await prisma.organisation.update({ where: { id: b.orgId }, data: { logoUrl: url } });
  await erase(a);
  const now = new Date(Date.now() + 1000);
  expect(await drainUploadErasure(prisma, { now })).toEqual({ removed: 0, deferred: 1 });
  expect((await readFile(uploadPathFor(url)!)).length).toBeGreaterThan(0);
  await prisma.organisation.update({ where: { id: b.orgId }, data: { logoUrl: '' } });
  await unlink(uploadPathFor(url)!);
  expect(await drainUploadErasure(prisma, { now: new Date(now.getTime() + 3_600_001) })).toEqual({ removed: 1, deferred: 0 });
  for (const invalid of ['/uploads/files/../schema.prisma', '/uploads/files/', 'https://example.test/file']) await prisma.uploadErasure.create({ data: { url: invalid } });
  const remove = vi.fn();
  expect(await drainUploadErasure(prisma, { now: new Date(Date.now() + 1000), remove })).toEqual({ removed: 0, deferred: 3 });
  expect(remove).not.toHaveBeenCalled();
});

for (const kind of ['document', 'photo'] as const) it(`refuses a ${kind} stream after workspace deletion`, async () => {
  const a = await makeTenant(`Race${kind}`);
  const dir = dirname(uploadPathFor('/uploads/files/fixture')!);
  const before = readdirSync(dir).sort();
  const transaction = prisma.$transaction.bind(prisma);
  // Interleave after the real stream/ownership check, before metadata commit.
  const spy = vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (operation: any) => {
    await erase(a);
    return transaction(operation);
  });
  try { expect((await upload(a, kind)).statusCode).toBe(404); }
  finally { spy.mockRestore(); }
  expect(readdirSync(dir).sort()).toEqual(before);
  expect(await prisma.document.count({ where: { orgId: a.orgId } })).toBe(0);
  expect(await prisma.sitePhoto.count({ where: { orgId: a.orgId } })).toBe(0);
});

it('queues a rejected upload when immediate unlink fails', async () => {
  const a = await makeTenant('RefusedBytes');
  const originalUnlink = vi.mocked(fs.unlink).getMockImplementation()!;
  vi.mocked(fs.unlink).mockRejectedValue(Object.assign(new Error('busy'), { code: 'EACCES' }));
  try {
    // Auth succeeds, but the uploaded bytes name an unavailable deal.
    expect((await upload({ ...a, dealId: 'missing-deal' }, 'document')).statusCode).toBe(404);
  } finally { vi.mocked(fs.unlink).mockImplementation(originalUnlink); }
  const pending = await prisma.uploadErasure.findMany({ where: { attempts: 0 } });
  expect(pending).toHaveLength(1);
  const url = pending[0]!.url;
  files.add(url);
  expect((await readFile(uploadPathFor(url)!)).length).toBeGreaterThan(0);
  expect(await drainUploadErasure(prisma, { now: new Date(Date.now() + 1000) })).toEqual({ removed: 1, deferred: 0 });
  await expect(readFile(uploadPathFor(url)!)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('accepts dots inside a filename but never directories or separators', () => {
  expect(uploadPathFor('/uploads/files/uuid-survey..png')).toMatch(/uuid-survey\.\.png$/);
  for (const url of ['/uploads/files/', '/uploads/files/.', '/uploads/files/..', '/uploads/files/../secret', '/uploads/files/a/b', '/uploads/files/a\\b', '/uploads/files/a\0b']) {
    expect(uploadPathFor(url)).toBeNull();
  }
});
