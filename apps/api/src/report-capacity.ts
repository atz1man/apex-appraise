import type { Browser, BrowserContext } from 'playwright';

// Per API process, deliberately no unbounded queue of confidential PDF jobs.
const MAX_ACTIVE_REPORTS = 2;
const RENDER_DEADLINE_MS = 60_000;
let active = 0;
let publicActive = 0;

export class ReportRenderUnavailable extends Error {
  constructor(message: string) {
    super(message);
  }
}

/** Bound contexts and the entire print job, including fonts and PDF generation. */
export async function withReportContext<T>(
  browser: Browser,
  render: (context: BrowserContext) => Promise<T>,
  options: { publicShare?: boolean } = {},
): Promise<T> {
  // Public links may occupy one slot; a customer's download retains capacity.
  if (active >= MAX_ACTIVE_REPORTS || (options.publicShare && publicActive >= 1))
    throw new ReportRenderUnavailable('Report rendering is busy — please try again shortly.');
  active++;
  if (options.publicShare) publicActive++;
  let context: BrowserContext | undefined;
  let expired = false;
  let released = false;
  let cleanup: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadlineError = new ReportRenderUnavailable('This report took too long to render — please try again shortly.');
  const release = () => {
    if (released) return;
    released = true;
    active--;
    if (options.publicShare) publicActive--;
  };
  const close = () =>
    (cleanup ??= (async () => {
      try {
        await context!.close();
      } catch {
        // A context which cannot close must not leak unlimited replacements. The
        // shared browser disconnect handler retires this renderer for the next job.
        await browser.close();
      }
      release();
    })());
  const work = (async () => {
    try {
      context = await browser.newContext({
        viewport: { width: 900, height: 1200 },
      });
      if (expired) throw deadlineError;
      return await render(context);
    } finally {
      if (context) await close();
      else release();
    }
  })();
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(deadlineError);
      // Reclaim a successfully closed context even if application work never
      // settles. A pending context creation still holds its slot until arrival.
      // If neither context nor browser closes, retain the slot until recovery.
      if (context) void close().catch(() => {});
    }, RENDER_DEADLINE_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
