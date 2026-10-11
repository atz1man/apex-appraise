import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookup } from 'node:dns/promises';
import { OutboundUrlError, publicHttpsFetch, publicHttpsLookup } from '../src/outbound.js';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
const dns = vi.mocked(lookup);
const publicAnswer = [{ address: '93.184.216.34', family: 4 }];
const privateAnswer = [{ address: '127.0.0.1', family: 4 }];

afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

function socketLookup(all: boolean) {
  return new Promise((resolve, reject) => {
    publicHttpsLookup('receiver.example', { all }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

describe('the address the socket actually uses', () => {
  it('returns the checked public address for a single-address socket', async () => {
    dns.mockResolvedValueOnce(publicAnswer);
    await expect(socketLookup(false)).resolves.toEqual({ address: '93.184.216.34', family: 4 });
    expect(dns).toHaveBeenCalledTimes(1);
  });

  it('returns checked IPv4 and IPv6 answers for automatic family selection', async () => {
    const answers = [...publicAnswer, { address: '2606:4700:4700::1111', family: 6 }];
    dns.mockResolvedValueOnce(answers);
    await expect(socketLookup(true)).resolves.toEqual({ address: answers, family: undefined });
  });

  it('refuses a mixed public/private answer before any address reaches the socket', async () => {
    dns.mockResolvedValueOnce([...publicAnswer, ...privateAnswer]);
    await expect(socketLookup(true)).rejects.toBeInstanceOf(OutboundUrlError);
  });

  it('fails closed when connection-time DNS has no answers', async () => {
    dns.mockResolvedValueOnce([]);
    await expect(socketLookup(false)).rejects.toBeInstanceOf(OutboundUrlError);
    dns.mockRejectedValueOnce(new Error('DNS unavailable'));
    await expect(socketLookup(false)).rejects.toThrow('DNS unavailable');
  });
});

describe('real fetch uses the guarded socket lookup', () => {
  it('blocks DNS rebinding after a successful public preflight', async () => {
    dns.mockResolvedValueOnce(publicAnswer).mockResolvedValueOnce(privateAnswer);
    const error = await publicHttpsFetch('https://rebind.example/hook', {
      method: 'POST', body: 'confidential deal figures', signal: AbortSignal.timeout(1000),
    }).catch((e: unknown) => e) as Error & { cause?: unknown };
    expect(error).toBeInstanceOf(TypeError);
    expect(error.cause).toBeInstanceOf(OutboundUrlError);
    expect(dns).toHaveBeenCalledTimes(2);
  });

  it('also blocks rebinding after preflight could not resolve the name', async () => {
    dns.mockRejectedValueOnce(new Error('temporary DNS failure')).mockResolvedValueOnce(privateAnswer);
    const error = await publicHttpsFetch('https://late-answer.example/hook', {
      signal: AbortSignal.timeout(1000),
    }).catch((e: unknown) => e) as Error & { cause?: unknown };
    expect(error.cause).toBeInstanceOf(OutboundUrlError);
    expect(dns).toHaveBeenCalledTimes(2);
  });

  it('refuses private literals which bypass socket lookup entirely', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(publicHttpsFetch('https://[::ffff:127.0.0.1]/hook')).rejects.toBeInstanceOf(OutboundUrlError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the hostname, payload and headers, and refuses redirect overrides', async () => {
    dns.mockResolvedValueOnce(publicAnswer);
    const fetch = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    await publicHttpsFetch('https://receiver.example/hook', {
      method: 'POST', body: 'payload', headers: { 'apex-signature': 'signature' }, redirect: 'follow',
    });
    expect(fetch).toHaveBeenCalledWith('https://receiver.example/hook', expect.objectContaining({
      method: 'POST', body: 'payload', headers: { 'apex-signature': 'signature' }, redirect: 'manual',
      dispatcher: expect.anything(),
    }));
  });
});
