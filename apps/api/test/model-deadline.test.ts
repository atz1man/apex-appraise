import http from 'node:http';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withModelDeadline, MODEL_NETWORK_TIMEOUT_MS } from '../src/model-deadline.js';
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
afterEach(() => vi.restoreAllMocks());

describe('the model network deadline', () => {
  it.each(['headers', 'body'] as const)('aborts a real HTTP request stalled at %s', async stage => {
    let received = false;
    const server = http.createServer((_req, res) => {
      received = true;
      if (stage === 'body') { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"incomplete":'); }
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address() as { port: number };
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
      expect(ms).toBe(90_000);
      return realTimeout(200);
    });
    try {
      await expect(withModelDeadline(async signal => {
        const response = await fetch(`http://127.0.0.1:${address.port}`, { signal });
        return response.json();
      })).rejects.toMatchObject({ code: 'TIMEOUT', message: expect.stringContaining('Try again') });
      expect(received).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('preserves successful results and unrelated errors', async () => {
    await expect(withModelDeadline(async () => ({ answer: 'ready' }))).resolves.toEqual({ answer: 'ready' });
    const error = new Error('provider rejected the request');
    await expect(withModelDeadline(async () => { throw error; })).rejects.toBe(error);
  });
  it('does not accept a result returned after an aborted request', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    await expect(withModelDeadline(async () => { controller.abort(); return 'late'; })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});


it('keeps the tRPC proxy response window longer than the model deadline', () => {
  const config = readFileSync(new URL('../../../infra/nginx.conf.template', import.meta.url), 'utf8');
  const block = config.match(/location \/trpc\/ \{([\s\S]*?)\n  \}/)?.[1];
  const seconds = Number(block?.match(/proxy_read_timeout (\d+)s;/)?.[1]);
  expect(seconds * 1000).toBeGreaterThan(MODEL_NETWORK_TIMEOUT_MS);
});
