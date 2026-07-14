import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from './context.js';
import { seedDemo } from './demo-seed.js';
import { orgCascadeDeletes } from './org-delete.js';

const DEMO_ADMIN_EMAIL = 'arthur@apexappraise.co.uk';

/**
 * Nightly demo reset (curl'd by .github/workflows/demo-reset.yml through the
 * web nginx proxy): wipes the public demo org and re-runs the seed so the live
 * demo always looks pristine. Guarded by RESET_TOKEN — while the env var is
 * unset the route plays dead (404), so it is inert unless deliberately armed.
 */
export function registerAdmin(app: FastifyInstance) {
  app.post('/admin/reset-demo', async (req, reply) => {
    const token = process.env.RESET_TOKEN;
    if (!token) return reply.code(404).send({ error: 'Not found' });
    const given = req.headers['x-reset-token'];
    const a = Buffer.from(typeof given === 'string' ? given : '');
    const b = Buffer.from(token);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    // The demo org is whichever org owns the seeded admin. If it's missing
    // (fresh or manually wiped DB) skip the delete and just reseed.
    const admin = await prisma.user.findUnique({ where: { email: DEMO_ADMIN_EMAIL } });
    if (admin) {
      await prisma.$transaction([
        ...orgCascadeDeletes(prisma, admin.orgId),
        // Market benchmark rows carry no orgId, so the org cascade skips them;
        // clear them too or every reset would duplicate the pseudo-market.
        prisma.benchmarkPoint.deleteMany({ where: { isOwn: false } }),
      ]);
    }
    const orgId = await seedDemo(prisma);
    console.log(`demo reset: wiped org ${admin?.orgId ?? '(none found)'}, reseeded as ${orgId}`);
    return { ok: true, orgId };
  });
}
