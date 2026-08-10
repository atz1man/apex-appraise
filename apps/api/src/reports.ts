import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { chromium, type Browser } from 'playwright';
import { JWT_SECRET, prisma } from './context.js';
import { recordAudit } from './audit.js';
import { SHARE_REFUSAL_MESSAGE, hashShareToken, shareRefusal } from './share.js';
import { verifyDownloadToken, type DownloadKind } from './download-token.js';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5273';

let browserPromise: Promise<Browser> | null = null;
// CHROMIUM_PATH lets the Docker image use the system chromium (apk) instead of
// Playwright's downloaded browser. Launch failures surface as a graceful 501.
const getBrowser = () => {
  browserPromise ??= chromium
    .launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
    .catch((e) => {
      browserPromise = null;
      throw e;
    });
  return browserPromise;
};

/**
 * Server-rendered PDF reports (Appraisal + Red Book). Renders the same React
 * report routes in headless chromium and prints to A4 — one source of truth for
 * layout, no duplicated document templates. Auth via a short-lived token in the
 * query string (browsers can't attach headers to downloads).
 */
const KIND_LABEL: Record<string, string> = {
  appraisal: 'Appraisal report',
  redbook: 'Red Book valuation',
  engagement: 'Terms of engagement',
};

export function registerReports(app: FastifyInstance) {
  /**
   * A shared report, for someone with no account.
   *
   * Serves the PDF and nothing else — no data API, no app shell, no session. The
   * document is rendered as the colleague who created the link, which is the
   * identity that was entitled to it; the recipient never holds credentials of
   * any kind.
   */
  app.get<{ Params: { token: string } }>('/shared/:token.pdf', async (req, reply) => {
    // never indexed, never cached by an intermediary: a valuation is not public
    // just because its URL is unguessable
    reply.header('x-robots-tag', 'noindex, nofollow, noarchive');
    reply.header('cache-control', 'private, no-store');

    const share = await prisma.reportShare.findUnique({ where: { tokenHash: hashShareToken(req.params.token) } });
    // an unknown token and a dead one get the same answer: whether a link ever
    // existed is not something the holder of a guess is entitled to learn
    if (!share || shareRefusal(share)) return reply.code(404).send({ error: SHARE_REFUSAL_MESSAGE });

    const creator = await prisma.user.findUnique({ where: { id: share.createdById } });
    if (!creator || creator.orgId !== share.orgId) return reply.code(404).send({ error: SHARE_REFUSAL_MESSAGE });
    const deal = await prisma.deal.findFirst({ where: { id: share.dealId, orgId: share.orgId } });
    if (!deal) return reply.code(404).send({ error: SHARE_REFUSAL_MESSAGE });

    let browser: Browser;
    try {
      browser = await getBrowser();
    } catch (e) {
      req.log.error(e, 'chromium unavailable for shared report');
      return reply.code(503).send({ error: 'This report cannot be produced right now — please try again shortly.' });
    }
    // a short-lived token for the RENDERER only; it never leaves this process
    const renderToken = jwt.sign({ sub: creator.id }, JWT_SECRET, { expiresIn: '2m' });
    const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
    try {
      await context.addInitScript(
        ([t, p]: string[]) => {
          localStorage.setItem('apex_token', t);
          localStorage.setItem('apex_principal', p);
        },
        [renderToken, JSON.stringify({ userId: creator.id, name: creator.name, initials: creator.initials, role: creator.role, principalType: 'internal' })],
      );
      const page = await context.newPage();
      const route = share.kind === 'redbook' ? 'redbook' : 'report';
      await page.goto(`${WEB_URL}/deal/${share.dealId}/${route}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.a4-page', { timeout: 15_000 });
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });

      await prisma.reportShare.update({
        where: { id: share.id },
        data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
      });
      await recordAudit(prisma, {
        orgId: share.orgId,
        dealId: share.dealId,
        actor: 'Shared link',
        action: 'a shared report link was opened',
        target: `${deal.name} — ${share.kind}`,
        ip: req.ip,
      });

      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'inline; filename="report.pdf"');
      return reply.send(pdf);
    } finally {
      await context.close();
    }
  });

  /**
   * The portfolio funding pack — a whole-book document, so it hangs off the org
   * rather than a deal. Same renderer as the per-deal reports: one source of
   * truth, so the pack cannot drift from what the screen shows.
   */
  app.get<{ Querystring: { t?: string } }>('/reports/portfolio/funding-pack.pdf', async (req, reply) => {
    const token = req.query.t;
    if (!token) return reply.code(401).send({ error: 'token required' });
    const claim = verifyDownloadToken(token, { kind: 'portfolio' });
    if (!claim) return reply.code(401).send({ error: 'invalid or expired download token' });
    const user = await prisma.user.findUnique({ where: { id: claim.userId } });
    // internal only: the pack is the whole book, and a portal login is scoped to
    // one position within it
    if (!user || user.principalType !== 'internal') return reply.code(403).send({ error: 'forbidden' });

    let browser: Browser;
    try {
      browser = await getBrowser();
    } catch (e) {
      req.log.error(e, 'chromium unavailable for PDF rendering');
      return reply.code(501).send({ error: 'PDF rendering unavailable on this server — use Print / Save PDF instead.' });
    }
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
      await page.goto(`${WEB_URL}/portfolio/pack`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.a4-page', { timeout: 15_000 });
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true });
      await recordAudit(prisma, {
        orgId: user.orgId,
        userId: user.id,
        actor: user.name,
        action: 'generated PDF',
        target: 'Portfolio funding pack',
        ip: req.ip,
      });
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', 'inline; filename="portfolio-funding-pack.pdf"');
      return reply.send(pdf);
    } finally {
      await context.close();
    }
  });

  app.get<{ Params: { dealId: string; kind: string }; Querystring: { t?: string } }>(
    '/reports/:dealId/:kind.pdf',
    async (req, reply) => {
      const { dealId, kind } = req.params;
      if (kind !== 'appraisal' && kind !== 'redbook' && kind !== 'engagement')
        return reply.code(404).send({ error: 'unknown report' });
      const token = req.query.t;
      if (!token) return reply.code(401).send({ error: 'token required' });
      /**
       * A DOWNLOAD token, not a session token. This URL ends up in browser
       * history and access logs; what it carries must be worth as little as
       * possible if it is found there.
       */
      const claim = verifyDownloadToken(token, { kind: kind as DownloadKind, dealId });
      if (!claim) return reply.code(401).send({ error: 'invalid or expired download token' });
      const userId = claim.userId;
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user || user.principalType !== 'internal') return reply.code(403).send({ error: 'forbidden' });
      const deal = await prisma.deal.findFirst({ where: { id: dealId, orgId: user.orgId } });
      if (!deal) return reply.code(404).send({ error: 'deal not found' });

      /**
       * A valuation report needs something to value. Without a current appraisal
       * the page renders no sheets, the renderer waits fifteen seconds for one and
       * the request dies as a 500 — which tells the user their server is broken
       * when the truth is that the deal has no appraisal yet.
       */
      if (kind === 'appraisal' || kind === 'redbook') {
        const appraisal = await prisma.appraisal.findFirst({ where: { dealId, orgId: user.orgId, isCurrent: true } });
        if (!appraisal) {
          return reply.code(409).send({
            error: `${deal.name} has no saved appraisal yet — run or save one, then the ${KIND_LABEL[kind]} can be produced.`,
          });
        }
      }

      let browser: Browser;
      try {
        browser = await getBrowser();
      } catch (e) {
        req.log.error(e, 'chromium unavailable for PDF rendering');
        return reply.code(501).send({
          error: 'PDF rendering unavailable on this server — use the in-app Print / Save PDF button instead.',
        });
      }
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
        const route = kind === 'appraisal' ? 'report' : kind === 'engagement' ? 'engagement/document' : 'redbook';
        await page.goto(`${WEB_URL}/deal/${dealId}/${route}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.a4-page', { timeout: 15_000 });
        await page.emulateMedia({ media: 'print' });
        const pdf = await page.pdf({ format: 'A4', printBackground: true });
        await prisma.activityEvent.create({
          data: { orgId: user.orgId, dealId, actor: user.name, action: 'generated PDF', target: `${KIND_LABEL[kind]} — ${deal.name}` },
        });
        // header values must be Latin-1 — keep the filename strictly ASCII
        const filename = `${deal.name.replace(/[^\w ]/g, '').trim()} - ${KIND_LABEL[kind]}.pdf`;
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
