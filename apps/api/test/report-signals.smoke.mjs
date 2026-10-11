import { spawn } from 'node:child_process';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Runs separately from Vitest in the built API image, where Chromium is installed.
// Keep an HTTP listener alive to reproduce the API process remaining available
// after Playwright has closed the renderer in response to a signal.
for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
  test(`API process honours ${signal} after rendering a PDF`, { timeout: 30_000 }, async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import http from 'node:http';
      import { getReportBrowser } from './src/report-browser.ts';
      const server = http.createServer((req, res) => res.end('ready'));
      server.listen(0, '127.0.0.1');
      const browser = await getReportBrowser();
      const page = await browser.newPage();
      await page.setContent('<h1>Report shutdown regression</h1>');
      const pdf = await page.pdf();
      if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error('PDF not rendered');
      await page.close();
      process.send('rendered');
    `], { cwd: new URL('..', import.meta.url), stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const exited = once(child, 'close');
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timers = [];
    const deadline = (ms, message) => new Promise((_, reject) => {
      timers.push(setTimeout(() => reject(new Error(message)), ms));
    });
    try {
      await Promise.race([
        once(child, 'message'),
        exited.then(() => { throw new Error(`Renderer exited before readiness: ${stderr}`); }),
        deadline(20_000, 'Renderer did not become ready'),
      ]);
      child.kill(signal);
      const result = await Promise.race([
        exited,
        deadline(3_000, `${signal} was swallowed after PDF rendering`),
      ]);
      assert.deepEqual(result, [null, signal]);
    } finally {
      timers.forEach(clearTimeout);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await exited;
    }
  });
}
