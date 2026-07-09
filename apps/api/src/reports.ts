import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { chromium, type Browser } from 'playwright';
import { JWT_SECRET, prisma } from './context.js';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5273';

let browserPromise: Promise<Browser> | null = null;
const getBrowser = () => (browserPromise ??= chromium.launch({ headless: true }));

/**
 * Server-rendered PDF reports (Appraisal + Red Book). Renders the same React
 * report routes in headless chromium and prints to A4 — one source of truth for
 * layout, no duplicated document templates. Auth via a short-lived token in the
 * query string (browsers can't attach headers to downloads).
 */
export function registerReports(app: FastifyInstance) {
  app.get<{ Params: { dealId: string; kind: string }; Querystring: { t?: string } }>(
    '/reports/:dealId/:kind.pdf',
    async (req, reply) => {
      const { dealId, kind } = req.params;
      if (kind !== 'appraisal' && kind !== 'redbook') return reply.code(404).send({ error: 'unknown report' });
      const token = req.query.t;
      if (!token) return reply.code(401).send({ error: 'token required' });
      let userId: string;
      try {
        userId = (jwt.verify(token, JWT_SECRET) as { sub: string }).sub;
      } catch {
        return reply.code(401).send({ error: 'invalid token' });
      }
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.principalType !== 'internal') return reply.code(403).send({ error: 'forbidden' });
      const deal = await prisma.deal.findFirst({ where: { id: dealId, orgId: user.orgId } });
      if (!deal) return reply.code(404).send({ error: 'deal not found' });

      const browser = await getBrowser();
      const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
      try {
        await context.addInitScript(
          ([t, p]: string[]) => {
            localStorage.setItem('apex_token', t);
            localStorage.setItem('apex_principal', p);
          },
          [token, JSON.stringify({ userId: user.id, name: user.name, initials: user.initials, role: user.role, principalType: 'internal' })],
        );
        const page = await context.newPage();
        const route = kind === 'appraisal' ? 'report' : 'redbook';
        await page.goto(`${WEB_URL}/deal/${dealId}/${route}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.a4-page', { timeout: 15_000 });
        await page.emulateMedia({ media: 'print' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true });
        await prisma.activityEvent.create({
          data: { orgId: user.orgId, dealId, actor: user.name, action: 'generated PDF', target: `${kind === 'appraisal' ? 'Appraisal report' : 'Red Book report'} — ${deal.name}` },
        });
        // header values must be Latin-1 — keep the filename strictly ASCII
        const filename = `${deal.name.replace(/[^\w ]/g, '').trim()} - ${kind === 'appraisal' ? 'Appraisal report' : 'Red Book valuation'}.pdf`;
        reply
          .header('content-type', 'application/pdf')
          .header('content-disposition', `attachment; filename="${filename}"`)
          .send(pdf);
      } finally {
        await context.close();
      }
    },
  );
}
