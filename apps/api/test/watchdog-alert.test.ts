import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
const script = fileURLToPath(new URL('../../../infra/watchdog.sh', import.meta.url));
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture(previous?: string) {
  const root = mkdtempSync(join(tmpdir(), 'watchdog-')); roots.push(root);
  const bin = join(root, 'bin'), state = join(root, 'monitor.state'); mkdirSync(bin);
  if (previous) writeFileSync(state, previous);
  writeFileSync(join(root, 'alerts'), '');
  // No network: execute the actual watchdog with a fake curl boundary.
  writeFileSync(join(bin, 'curl'), `#!/bin/bash
set -eu
if [[ "$*" = *'-X POST'* ]]; then
  while [ "$#" -gt 0 ]; do
    if [ "$1" = '-d' ]; then shift; printf '%s\\n' "$1" >> "$FIXTURE_ROOT/alerts"; fi
    shift
  done
  [ "$ALERT_FAIL" != 1 ]; exit $?
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then shift; printf '%s' "$READY_BODY" > "$1"; fi
  shift
done
printf '%s' "$HTTP_CODE"
exit "$CURL_EXIT"
`, { mode: 0o755 });
  return {
    run(code: string, fails = false, webhook = true, body = JSON.stringify({ service: 'apex-api', ok: true, checks: { database: { ok: true } } }), curlExit = 0) {
      const result = spawnSync('bash', [script, 'https://fixture.invalid'], {
        encoding: 'utf8', timeout: 10_000,
        env: { PATH: `${bin}:/usr/bin:/bin`, STATE_FILE: state, FIXTURE_ROOT: root,
          HTTP_CODE: code, READY_BODY: body, CURL_EXIT: String(curlExit), ALERT_FAIL: fails ? '1' : '0', ...(webhook ? { ALERT_WEBHOOK: 'https://alert.invalid' } : {}) },
      });
      expect(result.error).toBeUndefined();
      return { ...result, state: existsSync(state) ? readFileSync(state, 'utf8').trim() : undefined,
        alerts: readFileSync(join(root, 'alerts'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
    },
  };
}
describe('watchdog alert delivery', () => {
  it('alerts on an initial outage and suppresses later duplicate alerts', () => {
    const f = fixture();
    const first = f.run('503');
    expect(first.status).toBe(1);
    expect(first.alerts).toHaveLength(1);
    expect(first.alerts[0].text).toContain('PlotMerit is DOWN');
    expect(f.run('503').alerts).toHaveLength(1);
  });
  it('retries a failed outage notification before acknowledging the state', () => {
    const f = fixture('up');
    const failed = f.run('503', true);
    expect(failed.status).not.toBe(0);
    expect(failed.state).toBe('up');
    const retried = f.run('503');
    expect(retried.alerts).toHaveLength(2);
    expect(retried.state).toBe('down');
    expect(f.run('503').alerts).toHaveLength(2);
  });
  it('retries a failed recovery notification and exits unsuccessfully while delivery is broken', () => {
    const f = fixture('down');
    const failed = f.run('200', true);
    expect(failed.status).not.toBe(0);
    expect(failed.state).toBe('down');
    const recovered = f.run('200');
    expect(recovered.status).toBe(0);
    expect(recovered.alerts).toHaveLength(2);
    expect(recovered.alerts[1].text).toContain('PlotMerit is back');
    expect(recovered.state).toBe('up');
  });
  it('establishes an initially healthy baseline without sending an alert', () => {
    const result = fixture().run('200');
    expect(result.status).toBe(0);
    expect(result.state).toBe('up');
    expect(result.alerts).toEqual([]);
  });
  it('retains readiness exit status without a configured webhook', () => {
    const f = fixture();
    expect(f.run('503', false, false).status).toBe(1);
    const up = f.run('200', false, false);
    expect(up.status).toBe(0);
    expect(up.state).toBe('up');
    expect(up.alerts).toEqual([]);
  });
});


it('retries and recovers through real curl and a loopback HTTP webhook', async () => {
  const root = mkdtempSync(join(tmpdir(), 'watchdog-http-')); roots.push(root);
  const state = join(root, 'state'); writeFileSync(state, 'up');
  let ready = false, failDelivery = true;
  const alerts: string[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/ready') {
      // A proxy may rewrite the status; the body must still govern readiness.
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ service: 'apex-api', ok: ready, checks: { database: { ok: ready } } }));
    } else if (req.url === '/alert' && req.method === 'POST') {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        alerts.push(body);
        res.writeHead(failDelivery ? 503 : 200); res.end();
      });
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  const url = `http://127.0.0.1:${address.port}`;
  const run = async () => {
    try {
      await promisify(execFile)('bash', [script, url], { timeout: 10_000,
        env: { PATH: '/usr/bin:/bin', STATE_FILE: state, ALERT_WEBHOOK: `${url}/alert` } });
      return 0;
    } catch (error) { return (error as { code: number }).code; }
  };
  try {
    expect(await run()).toBe(1);
    expect(readFileSync(state, 'utf8').trim()).toBe('up');
    failDelivery = false;
    expect(await run()).toBe(1);
    expect(readFileSync(state, 'utf8').trim()).toBe('down');
    expect(await run()).toBe(1);
    expect(alerts).toHaveLength(2);
    ready = true;
    expect(await run()).toBe(0);
    expect(alerts).toHaveLength(3);
    expect(JSON.parse(alerts[0]).text).toContain('PlotMerit is DOWN');
    expect(JSON.parse(alerts[2]).text).toContain('PlotMerit is back');
    expect(readFileSync(state, 'utf8').trim()).toBe('up');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});


describe('watchdog readiness evidence', () => {
  it.each([
    '{"service":"apex-api","ok":false,"checks":{"database":{"ok":false}}}',
    '{"service":"apex-api","ok":true}',
    '{"service":"apex-api","ok":true,"checks":{"database":{"ok":false}}}',
    '{"service":"apex-api","ok":"true","checks":{"database":{"ok":true}}}',
    '<html>"service":"apex-api"</html>',
    '{"service":"apex-api",',
  ])('refuses HTTP 200 without positive structured readiness: %s', body => {
    const result = fixture('up').run('200', false, false, body);
    expect(result.status).toBe(1);
    expect(result.state).toBe('down');
  });
  it('accepts whitespace-formatted readiness evidence', () => {
    const body = JSON.stringify({ service: 'apex-api', ok: true, checks: { database: { ok: true } } }, null, 2);
    expect(fixture().run('200', false, false, body).status).toBe(0);
  });
  it('refuses a transfer failure even when curl received HTTP 200 and a positive body', () => {
    const result = fixture('up').run('200', false, false, undefined, 28);
    expect(result.status).toBe(1);
    expect(result.state).toBe('down');
  });
});
