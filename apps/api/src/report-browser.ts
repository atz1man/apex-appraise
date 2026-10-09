import { chromium, type Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

/** Share a renderer, but never keep a dead Chromium process cached indefinitely. */
export function getReportBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const attempt: Promise<Browser> = chromium
      .launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
      .then(browser => {
        browser.on('disconnected', () => {
          if (browserPromise === attempt) browserPromise = null;
        });
        return browser;
      })
      .catch(error => {
        if (browserPromise === attempt) browserPromise = null;
        throw error;
      });
    browserPromise = attempt;
  }
  return browserPromise;
}
