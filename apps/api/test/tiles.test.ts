import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signDownloadToken } from '../src/download-token.js';
import { __resetTileCache, registerTiles } from '../src/tiles.js';

/**
 * The map used to point the browser at tile.openstreetmap.org, which handed a
 * public tile server the IP address of every valuer and the coordinates of every
 * site they opened — the last third-party request on any page, under a privacy
 * notice that says "Nobody else."
 *
 * Serving tiles ourselves only helps if the proxy is not itself a liability: an
 * open one would let anyone spend a tile server's bandwidth under our name,
 * which is the abuse OSM's usage policy exists to prevent.
 */

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function makeApp() {
  const app = Fastify();
  registerTiles(app);
  return app;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  __resetTileCache();
  fetchMock = vi.fn(async () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const tileToken = () => signDownloadToken({ sub: 'user-1', kind: 'tiles' });

describe('the tile proxy', () => {
  it('serves a tile to someone signed in, and never reveals who asked', async () => {
    const app = makeApp();
    const res = await app.inject({ method: 'GET', url: `/tiles/12/2048/1362.png?t=${tileToken()}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');

    // the upstream sees US: one identified caller, which is what the policy asks
    // for and what a browser could never send
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String((init.headers as Record<string, string>)['user-agent'])).toMatch(/ApexAppraise/);
  });

  it('refuses an unauthenticated caller, so it is not an open relay', async () => {
    const app = makeApp();
    expect((await app.inject({ method: 'GET', url: '/tiles/12/2048/1362.png' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/tiles/12/2048/1362.png?t=nonsense' })).statusCode).toBe(401);
    expect(fetchMock, 'an unauthorised request still reached the tile server').not.toHaveBeenCalled();
  });

  /**
   * A session token is a twelve-hour credential for a whole account; a tile token
   * can fetch map squares. Accepting the former here would be the hole
   * download-token.ts was written to close, reopened through a new door.
   */
  it('refuses a token minted for something else', async () => {
    const app = makeApp();
    const fileToken = signDownloadToken({ sub: 'user-1', kind: 'file', key: 'x' });
    expect((await app.inject({ method: 'GET', url: `/tiles/12/2048/1362.png?t=${fileToken}` })).statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('only real tile coordinates reach the upstream', async () => {
    const app = makeApp();
    const t = tileToken();
    for (const url of [
      `/tiles/99/1/1.png?t=${t}`, // beyond max zoom
      `/tiles/1/9/9.png?t=${t}`, // outside the grid at that zoom
      `/tiles/-1/0/0.png?t=${t}`,
      `/tiles/1.5/0/0.png?t=${t}`,
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(400);
    }
    expect(fetchMock, 'a bogus coordinate was passed upstream').not.toHaveBeenCalled();
  });

  /**
   * The cache is the part that makes proxying defensible rather than merely
   * private: N viewers of one postcode must not become N requests to a service
   * run on donations.
   */
  it('asks the tile server once however many people look', async () => {
    const app = makeApp();
    const t = tileToken();
    const first = await app.inject({ method: 'GET', url: `/tiles/12/2048/1362.png?t=${t}` });
    const second = await app.inject({ method: 'GET', url: `/tiles/12/2048/1362.png?t=${t}` });
    expect(first.headers['x-tile-cache']).toBe('miss');
    expect(second.headers['x-tile-cache']).toBe('hit');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // and the browser is told it need not ask again either
    expect(String(second.headers['cache-control'])).toContain('immutable');
  });

  it('reports an upstream failure rather than inventing a picture', async () => {
    const app = makeApp();
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 429 }));
    const res = await app.inject({ method: 'GET', url: `/tiles/12/2048/1362.png?t=${tileToken()}` });
    expect(res.statusCode).toBe(502);
    expect(res.body).toBe('');
  });

  it('survives a tile server that never answers', async () => {
    const app = makeApp();
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await app.inject({ method: 'GET', url: `/tiles/12/2048/1362.png?t=${tileToken()}` })).statusCode).toBe(502);
  });
});
