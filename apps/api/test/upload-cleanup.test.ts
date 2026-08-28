import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { JWT_SECRET } from '../src/context.js';
import { registerUploads } from '../src/uploads.js';
import { makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * A refused upload leaves nothing on disk.
 *
 * Multipart has to be consumed before the fields it carries can be read, so the
 * file is written before the deal it names can be checked. Every refusal after
 * that point left the bytes behind, referenced by no row and collected by
 * nothing: an internal member of one firm could post to another firm's deal id
 * in a loop and get a 404 and a permanent file every time. The logo route
 * already unlinked when it rejected an oversize image; the two routes that take
 * a deal id did not.
 */

const UPLOAD_DIR = join(import.meta.dirname, '..', 'uploads');
const count = () => readdirSync(UPLOAD_DIR).length;

let A: Tenant;
let B: Tenant;
let bContractor: string;
let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Keeper');
  B = await makeTenant('Stranger');
  bContractor = (
    await prisma.contractor.create({
      data: { orgId: B.orgId, name: 'Stranger Groundworks', trade: 'Groundworks', weeks: '[]' },
    })
  ).id;
  app = Fastify();
  await registerUploads(app, prisma);
  await app.ready();
}, 120_000);

function post(url: string, fields: Record<string, string>) {
  const b = '----apexcleanup';
  const part = (name: string, value: string) =>
    `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const payload =
    Object.entries(fields).map(([k, v]) => part(k, v)).join('') +
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="site.jpg"\r\n` +
    `Content-Type: image/jpeg\r\n\r\nnot-really-a-jpeg\r\n--${b}--\r\n`;
  return app.inject({
    method: 'POST',
    url,
    headers: {
      authorization: `Bearer ${jwt.sign({ sub: A.userId }, JWT_SECRET, { expiresIn: '12h' })}`,
      'content-type': `multipart/form-data; boundary=${b}`,
    },
    payload,
  });
}

describe('an upload this firm may not make', () => {
  it('leaves no file behind — a photo for another firm’s deal', async () => {
    const before = count();
    const res = await post('/uploads/photo', {
      dealId: B.dealId,
      caption: 'Slab pour',
      takenAt: '2026-06-30',
    });
    expect(res.statusCode).toBe(404);
    expect(count()).toBe(before);
  });

  it('leaves no file behind — a photo naming another firm’s contractor', async () => {
    const before = count();
    const res = await post('/uploads/photo', {
      dealId: A.dealId,
      caption: 'Slab pour',
      contractorId: bContractor,
      takenAt: '2026-06-30',
    });
    expect(res.statusCode).toBe(404);
    expect(count()).toBe(before);
  });

  it('leaves no file behind — a document for another firm’s deal', async () => {
    const before = count();
    const res = await post('/uploads/document', { dealId: B.dealId, category: 'Legal' });
    expect(res.statusCode).toBe(404);
    expect(count()).toBe(before);
  });

  it('still keeps the file when the upload is the firm’s own', async () => {
    // the cleanup must not be reaching further than the refusal
    const before = count();
    const res = await post('/uploads/photo', {
      dealId: A.dealId,
      caption: 'Steel frame',
      takenAt: '2026-07-01',
    });
    expect(res.statusCode).toBe(200);
    expect(count()).toBe(before + 1);
  });
});
