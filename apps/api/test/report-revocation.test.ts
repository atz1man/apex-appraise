import Fastify from 'fastify';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
import { signDownloadToken } from '../src/download-token.js';
const { renderer } = vi.hoisted(() => ({ renderer: vi.fn() }));
vi.mock('../src/report-browser.js', () => ({ getReportBrowser: renderer }));
import { registerReports } from '../src/reports.js';

let A: Tenant;
let app: ReturnType<typeof Fastify>;
beforeAll(async () => {
  resetDatabase();
  A = await makeTenant('Revoked reports');
  app = Fastify();
  registerReports(app, prisma);
  await app.ready();
}, 120_000);
describe('a report URL after password reset', () => {
  it.each(['appraisal', 'redbook', 'engagement', 'portfolio'] as const)(
    'rejects the previously minted %s token before starting Chromium',
    async (kind) => {
      await prisma.user.update({ where: { id: A.userId }, data: { sessionsValidFrom: new Date(Date.now() - 2000) } });
      const token = signDownloadToken({ sub: A.userId, kind, ...(kind === 'portfolio' ? {} : { dealId: A.dealId }) });
      await prisma.user.update({ where: { id: A.userId }, data: { sessionsValidFrom: new Date(Date.now() + 1000) } });
      const url = kind === 'portfolio' ? '/reports/portfolio/funding-pack.pdf' : `/reports/${A.dealId}/${kind}.pdf`;
      renderer.mockClear();
      const res = await app.inject({ url: `${url}?t=${encodeURIComponent(token)}` });
      expect(res.statusCode).toBe(401);
      expect(renderer).not.toHaveBeenCalled();
    },
  );
  it('a fresh token on a valid account still reaches the renderer', async () => {
    await prisma.user.update({ where: { id: A.userId }, data: { sessionsValidFrom: new Date(Date.now() - 2000) } });
    renderer.mockRejectedValueOnce(new Error('test renderer offline'));
    const token = signDownloadToken({ sub: A.userId, kind: 'portfolio' });
    const res = await app.inject({ url: `/reports/portfolio/funding-pack.pdf?t=${encodeURIComponent(token)}` });
    expect(res.statusCode).toBe(501);
    expect(renderer).toHaveBeenCalledTimes(1);
  });
});
