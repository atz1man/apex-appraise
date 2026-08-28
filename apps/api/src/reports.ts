import type { FastifyInstance } from 'fastify';
import { currentAppraisal } from './current-appraisal.js';
import jwt from 'jsonwebtoken';
import { chromium, type Browser, type Page } from 'playwright';
import { JWT_SECRET, prisma } from './context.js';
import { recordAudit } from './audit.js';
import { SHARE_REFUSAL_MESSAGE, hashShareToken, shareRefusal } from './share.js';
import { verifyDownloadToken, type DownloadKind } from './download-token.js';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:5273';

/**
 * Wait for the document's typography to settle before printing it.
 *
 * The report fonts use `display=swap`, which renders text in a fallback face
 * first and swaps when the webfont lands. Nothing waited for that, so a PDF
 * could be — and intermittently was — printed mid-swap: a client-facing
 * valuation in the wrong typeface, with different metrics and therefore
 * different pagination from the same report viewed on screen. It showed up
 * first as an A4 overflow that reproduced on one machine and not another,
 * which is exactly what a font race looks like from the outside.
 *
 * The fonts came from Google until self-hosting took that third party out from
 * between this renderer and the typeface of a signed valuation. Same-origin and
 * preloaded, the swap window is now short enough to be hard to catch — which is
 * an argument for keeping this wait, not for removing it. A race that fires once
 * a quarter on a document carrying a RICS registration is worse than one that
 * fires daily, because nobody is looking when it does.
 *
 * Returns whether the intended faces are actually in use, so a render that fell
 * back is recorded rather than shipped silently. It does NOT block the PDF: a
 * valuation in a substitute typeface is cosmetically wrong, not factually wrong,
 * and refusing to produce it would be the worse trade for the person waiting.
 */
async function typographySettled(page: Page): Promise<{ loaded: boolean; missing: string[] }> {
  try {
    return await page.evaluate(async () => {
      await document.fonts.ready;
      const wanted = ['Schibsted Grotesk', 'JetBrains Mono'];
      const missing = wanted.filter((f) => !document.fonts.check(`12px "${f}"`));
      return { loaded: missing.length === 0, missing };
    });
  } catch {
    // never let a typography check be the reason a report fails to render
    return { loaded: true, missing: [] };
  }
}


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
      const type = await typographySettled(page);
      if (!type.loaded) req.log.warn({ missing: type.missing }, 'report rendered in fallback typeface');
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
    // a short-lived token for the RENDERER only; it never leaves this process
    const renderToken = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '2m' });
    const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
    try {
      await context.addInitScript(
        ([t, p]: string[]) => {
          localStorage.setItem('apex_token', t);
          localStorage.setItem('apex_principal', p);
        },
        [renderToken, JSON.stringify({ userId: user.id, name: user.name, initials: user.initials, role: user.role, principalType: 'internal' })],
      );
      const page = await context.newPage();
      await page.goto(`${WEB_URL}/portfolio/pack`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.a4-page', { timeout: 15_000 });
      await page.emulateMedia({ media: 'print' });
      const type = await typographySettled(page);
      if (!type.loaded) req.log.warn({ missing: type.missing }, 'report rendered in fallback typeface');
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
        const appraisal = await currentAppraisal(prisma.appraisal, dealId, user.orgId);
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
      // a short-lived token for the RENDERER only; it never leaves this process
      const renderToken = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '2m' });
      const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
      try {
        await context.addInitScript(
          ([t, p]: string[]) => {
            localStorage.setItem('apex_token', t);
            localStorage.setItem('apex_principal', p);
          },
          [renderToken, JSON.stringify({ userId: user.id, name: user.name, initials: user.initials, role: user.role, principalType: 'internal' })],
        );
        const page = await context.newPage();
        const route = kind === 'appraisal' ? 'report' : kind === 'engagement' ? 'engagement/document' : 'redbook';
        await page.goto(`${WEB_URL}/deal/${dealId}/${route}`, { waitUntil: 'networkidle' });
        await page.waitForSelector('.a4-page', { timeout: 15_000 });
        await page.emulateMedia({ media: 'print' });
        const type = await typographySettled(page);
        if (!type.loaded) req.log.warn({ missing: type.missing }, 'report rendered in fallback typeface');
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
