import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { JWT_SECRET } from '../src/context.js';
import { registerUploads } from '../src/uploads.js';
import { makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

const dir = join(import.meta.dirname, '..', 'uploads');
let A: Tenant;
let B: Tenant;
let app: ReturnType<typeof Fastify>;
beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Upload owner');
  B = await makeTenant('Other owner');
  app = Fastify();
  await registerUploads(app, prisma);
  await app.ready();
}, 120_000);
afterEach(() => vi.restoreAllMocks());

function post(
  url: string,
  {
    tenant = A,
    filename = 'workfile.pdf',
    body = 'original bytes',
    fields = { dealId: tenant.dealId },
    extraFile = false,
    server = app,
  }: {
    tenant?: Tenant;
    filename?: string;
    body?: string;
    fields?: Record<string, string>;
    extraFile?: boolean;
    server?: typeof app;
  } = {},
) {
  const boundary = 'apex-workfile-test';
  const file = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${url.endsWith('/logo') ? 'image/png' : 'application/octet-stream'}\r\n\r\n${body}\r\n`;
  // File first deliberately: later parser failures must clean up earlier bytes.
  const payload =
    file +
    (extraFile ? file : '') +
    Object.entries(fields)
      .map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`)
      .join('') +
    `--${boundary}--\r\n`;
  return server.inject({
    method: 'POST',
    url,
    payload,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      authorization: `Bearer ${jwt.sign({ sub: tenant.userId }, JWT_SECRET, { expiresIn: '1h' })}`,
    },
  });
}
const count = () => readdirSync(dir).length;
const auth = (tenant: Tenant) => ({
  authorization: `Bearer ${jwt.sign({ sub: tenant.userId }, JWT_SECRET, { expiresIn: '1h' })}`,
});

describe('workfile storage under competing and failed writes', () => {
  it('same filename in the same millisecond cannot overwrite another firm’s bytes', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const [a, b] = await Promise.all([
      post('/uploads/document', { body: 'A confidential bytes' }),
      post('/uploads/document', { tenant: B, body: 'B confidential bytes' }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().url).not.toBe(b.json().url);
    expect((await app.inject({ url: a.json().url, headers: auth(A) })).body).toBe('A confidential bytes');
    expect((await app.inject({ url: b.json().url, headers: auth(B) })).body).toBe('B confidential bytes');
    expect((await app.inject({ url: b.json().url, headers: auth(A) })).statusCode).toBe(404);
  });
  it.each(['/uploads/document', '/uploads/photo', '/uploads/logo'])(
    'refuses extra files without retaining the first file: %s',
    async (url) => {
      const before = count();
      const res = await post(url, { extraFile: true });
      expect(res.statusCode).toBe(413);
      expect(count()).toBe(before);
    },
  );
  it('a later field-limit failure leaves no earlier file', async () => {
    const before = count();
    const fields = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`field${i}`, 'x']));
    expect((await post('/uploads/document', { fields })).statusCode).toBe(413);
    expect(count()).toBe(before);
  });
  it('oversized logos stop at the stream limit and leave no partial file', async () => {
    const before = count();
    const priorLogo = (await prisma.organisation.findUniqueOrThrow({ where: { id: A.orgId } })).logoUrl;
    const res = await post('/uploads/logo', {
      filename: 'logo.png',
      fields: {},
      body: 'x'.repeat(2 * 1024 * 1024 + 128),
    });
    expect(res.statusCode).toBe(413);
    expect(count()).toBe(before);
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: A.orgId } })).logoUrl).toBe(priorLogo);
  });
  it.each(['bad-date', '2026-02-30'])('an invalid photo date is a refusal, with no file: %s', async (takenAt) => {
    const before = count();
    expect(
      (
        await post('/uploads/photo', {
          fields: { dealId: A.dealId, takenAt },
        })
      ).statusCode,
    ).toBe(400);
    expect(count()).toBe(before);
  });
  it.each(['/uploads/document', '/uploads/photo'])(
    'audit failure rolls back the row and deletes its bytes: %s',
    async (url) => {
      const db = prisma.$extends({
        query: {
          activityEvent: {
            create() {
              throw new Error('audit unavailable');
            },
          },
        },
      });
      const server = Fastify();
      await registerUploads(server, db as never);
      const files = count();
      const docs = await prisma.document.count();
      const photos = await prisma.sitePhoto.count();
      try {
        expect((await post(url, { server })).statusCode).toBe(500);
        expect(count()).toBe(files);
        expect(await prisma.document.count()).toBe(docs);
        expect(await prisma.sitePhoto.count()).toBe(photos);
      } finally {
        await server.close();
      }
    },
  );
});

describe('untrusted file delivery', () => {
  it('active documents download with a sandbox rather than becoming an app page', async () => {
    const uploaded = await post('/uploads/document', {
      filename: 'page.html',
      body: '<script>localStorage.clear()</script>',
    });
    expect(uploaded.statusCode).toBe(200);
    const res = await app.inject({
      url: uploaded.json().url,
      headers: auth(A),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment');
    expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });
  it('raster files remain displayable with the same isolation headers', async () => {
    const uploaded = await post('/uploads/photo', { filename: 'site.jpg' });
    expect(uploaded.statusCode).toBe(200);
    const res = await app.inject({
      url: uploaded.json().url,
      headers: auth(A),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('portal file links follow current access', () => {
  it('a stored logo round-trips for its owner and refuses another tenant', async () => {
    const res = await post('/uploads/logo', {
      filename: 'logo.png',
      fields: {},
      body: 'logo bytes',
    });
    expect(res.statusCode).toBe(200);
    const url = (await prisma.organisation.findUniqueOrThrow({ where: { id: A.orgId } })).logoUrl!;
    expect((await app.inject({ url, headers: auth(A) })).body).toBe('logo bytes');
    expect((await app.inject({ url, headers: auth(B) })).statusCode).toBe(404);
  });
  it('withdrawing a buyer document or reassigning the buyer revokes an already minted link', async () => {
    const uploaded = await post('/uploads/document');
    const unit = await prisma.unit.create({
      data: {
        orgId: A.orgId,
        dealId: A.dealId,
        name: 'Portal plot',
        spec: '3 bed',
        appraisedValue: 450_000_00,
      },
    });
    const user = await prisma.user.create({
      data: {
        orgId: A.orgId,
        email: 'workfile-buyer@example.test',
        password: 'x',
        name: 'Buyer',
        initials: 'BY',
        principalType: 'buyer',
        buyerUnitId: unit.id,
        sessionsValidFrom: new Date(0),
      },
    });
    await prisma.document.update({
      where: { id: uploaded.json().id },
      data: { unitId: unit.id, buyerVisible: true },
    });
    const { signFileUrl } = await import('../src/uploads.js');
    const url = signFileUrl(uploaded.json().url, user.id);
    expect((await app.inject({ url })).statusCode).toBe(200);
    await prisma.document.update({
      where: { id: uploaded.json().id },
      data: { buyerVisible: false },
    });
    expect((await app.inject({ url })).statusCode).toBe(404);
    await prisma.document.update({
      where: { id: uploaded.json().id },
      data: { buyerVisible: true },
    });
    await prisma.user.update({
      where: { id: user.id },
      data: { buyerUnitId: null },
    });
    expect((await app.inject({ url })).statusCode).toBe(404);
  });
  it('withdrawing an investor document or removing their holding revokes an already minted link', async () => {
    const uploaded = await post('/uploads/document');
    const investor = await prisma.investor.create({
      data: { orgId: A.orgId, name: 'Workfile LP' },
    });
    const user = await prisma.user.create({
      data: {
        orgId: A.orgId,
        email: 'workfile-lp@example.test',
        password: 'x',
        name: 'LP',
        initials: 'LP',
        principalType: 'investor',
        investorId: investor.id,
        sessionsValidFrom: new Date(0),
      },
    });
    const holding = await prisma.holding.create({
      data: { investorId: investor.id, dealId: A.dealId, committed: 1_000_00 },
    });
    await prisma.document.update({
      where: { id: uploaded.json().id },
      data: { investorVisible: true },
    });
    const { signFileUrl } = await import('../src/uploads.js');
    const url = signFileUrl(uploaded.json().url, user.id);
    expect((await app.inject({ url })).statusCode).toBe(200);
    await prisma.document.update({
      where: { id: uploaded.json().id },
      data: { investorVisible: false },
    });
    expect((await app.inject({ url })).statusCode).toBe(404);
    await prisma.document.update({
      where: { id: uploaded.json().id },
      data: { investorVisible: true },
    });
    await prisma.holding.delete({ where: { id: holding.id } });
    expect((await app.inject({ url })).statusCode).toBe(404);
  });
});
