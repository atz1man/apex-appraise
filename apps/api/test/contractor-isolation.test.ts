import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeAll, describe, expect, it } from 'vitest';
import { JWT_SECRET } from '../src/context.js';
import { registerUploads } from '../src/uploads.js';
import { callerFor, expectDenied, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * A site photo names a contractor, and the contractor id is the caller's to
 * supply.
 *
 * `auth/owned.ts` describes this exact shape and exists to stop it: "a procedure
 * checks that the DEAL the caller named belongs to them, and then updates a
 * record by an id the caller also supplied. Those are two independent inputs,
 * and validating the first says nothing about the second." It shipped five times
 * before that helper was written. Three more sites take a `contractorId` and
 * none of them called it — `photos.add`, `cost.upsertPackage`, and the raw
 * `POST /uploads/photo`, which `isolation-sweep` cannot see because it walks the
 * tRPC router.
 *
 * Measured before the fix: firm A attaches firm B's contractor to a photo on its
 * own deal, and firm A's cost monitoring screen renders "Bravo Groundworks Ltd".
 * `photos.list` joins `contractor: { select: { name: true } }` and filters only
 * on the photo's own orgId, so the join is where the name crosses.
 */

let A: Tenant;
let B: Tenant;
let bContractor: string;
let aContractor: string;

beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Alpha');
  B = await makeTenant('Bravo');
  bContractor = (
    await prisma.contractor.create({
      data: { orgId: B.orgId, name: 'Bravo Groundworks Ltd', trade: 'Groundworks', weeks: '[]' },
    })
  ).id;
  aContractor = (
    await prisma.contractor.create({
      data: { orgId: A.orgId, name: 'Alpha Groundworks Ltd', trade: 'Groundworks', weeks: '[]' },
    })
  ).id;
}, 120_000);

describe('a contractor id from another firm', () => {
  it('is refused by photos.add', async () => {
    await expectDenied('photos.add with another firm’s contractor', () =>
      callerFor(A.principal).photos.add({
        dealId: A.dealId,
        caption: 'Slab pour',
        contractorId: bContractor,
        takenAt: '2026-06-30',
      }),
    );
  });

  it('is refused by cost.upsertPackage', async () => {
    await expectDenied('upsertPackage with another firm’s contractor', () =>
      callerFor(A.principal).cost.upsertPackage({
        dealId: A.dealId,
        name: 'Groundworks',
        budget: 100_000,
        forecast: 100_000,
        contractorId: bContractor,
      }),
    );
  });

  it('is refused by the upload route that carries the photograph', async () => {
    const app = Fastify();
    await registerUploads(app, prisma);
    await app.ready();

    const post = (contractorId: string) => {
      const b = '----apextest';
      const part = (name: string, value: string) =>
        `--${b}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      const payload =
        part('dealId', A.dealId) +
        part('caption', 'Slab pour') +
        part('contractorId', contractorId) +
        part('takenAt', '2026-06-30') +
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="site.jpg"\r\n` +
        `Content-Type: image/jpeg\r\n\r\nnot-really-a-jpeg\r\n--${b}--\r\n`;
      return app.inject({
        method: 'POST',
        url: '/uploads/photo',
        headers: {
          authorization: `Bearer ${jwt.sign({ sub: A.userId }, JWT_SECRET, { expiresIn: '12h' })}`,
          'content-type': `multipart/form-data; boundary=${b}`,
        },
        payload,
      });
    };

    expect((await post(bContractor)).statusCode).toBe(404);
    // and the firm's own contractor still goes through the same door
    const ok = await post(aContractor);
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it('never renders another firm’s subcontractor name on this firm’s screen', async () => {
    // the read that carried it. A photo with no contractor is ordinary, so the
    // list still has to work — refusing the id must not refuse the photo.
    await callerFor(A.principal).photos.add({
      dealId: A.dealId,
      caption: 'Steel frame',
      contractorId: null,
      takenAt: '2026-07-01',
    });
    const list = (await callerFor(A.principal).photos.list(A.dealId)) as { contractor: string | null }[];
    expect(list.length).toBeGreaterThan(0);
    expect(list.map((p) => p.contractor)).not.toContain('Bravo Groundworks Ltd');
  });
});

describe('the photograph itself', () => {
  it('is written down when it lands, not only when a row is typed', async () => {
    /**
     * `photos.add` records "added a site photo" and argues for it: the site log
     * is what a disputed valuation of works-in-progress is argued from, and
     * `takenAt` is typed by hand, so when it was RECORDED is the only one of the
     * two facts that cannot be backdated. The upload route — the one that
     * carries the actual image — wrote nothing.
     */
    const events = await prisma.activityEvent.findMany({
      where: { orgId: A.orgId, action: 'added a site photo' },
      orderBy: { at: 'desc' },
    });
    // one from the tRPC door in the test above, one from the upload route
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.target?.includes('taken 2026-06-30'))).toBe(true);
    for (const e of events) expect(e.actor).toBe(A.principal.name);
  });
});
