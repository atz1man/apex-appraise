const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { checkServing } = require('./check-serving.cjs');
const html = '<div id="root"></div><script type="module" crossorigin src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">';
const ready = JSON.stringify({ ok: true, service: 'apex-api', checks: { database: { ok: true } } });
async function fixture(t, overrides = {}) {
  const paths = [];
  const routes = {
    '/login': [200, 'text/html', html],
    '/assets/app.js': [200, 'text/javascript', 'console.log("ready");'],
    '/assets/app.css': [200, 'text/css', 'body { color: black; }'],
    '/ready': [200, 'application/json', ready], ...overrides,
  };
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    const route = routes[req.url] ?? [404, 'text/plain', 'missing'];
    if (typeof route === 'function') return route(req, res);
    res.writeHead(route[0], { 'Content-Type': route[1] }); res.end(route[2]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}`, paths };
}

test('checks the real HTML entry, scripts, styles and explicit database readiness', async t => {
  const { url, paths } = await fixture(t);
  assert.deepEqual(await checkServing(url), { login: 'passed', entryAssets: 2, api: 'passed', database: 'passed' });
  assert.deepEqual(paths, ['/login', '/assets/app.js', '/assets/app.css', '/ready']);
});
test('rejects generic HTML returned with HTTP 200 at login', async t => {
  const { url } = await fixture(t, { '/login': [200, 'text/html', '<h1>Unavailable</h1>'] });
  await assert.rejects(checkServing(url), /application HTML entry/);
});
test('rejects a SPA fallback masquerading as readiness', async t => {
  const { url } = await fixture(t, { '/ready': [200, 'text/html', html] });
  await assert.rejects(checkServing(url), /JSON readiness/);
});
test('rejects HTTP 200 readiness with a failed database', async t => {
  const { url } = await fixture(t, { '/ready': [200, 'application/json', JSON.stringify({ ok: true, service: 'apex-api', checks: { database: { ok: false } } })] });
  await assert.rejects(checkServing(url), /readiness not confirmed/);
});
test('rejects a missing hashed entry asset', async t => {
  const { url } = await fixture(t, { '/assets/app.js': [404, 'text/plain', 'missing'] });
  await assert.rejects(checkServing(url), /expected HTTP 200/);
});
for (const [name, type, body] of [['HTML fallback', 'text/javascript', '<!doctype html><html>fallback</html>'], ['wrong MIME', 'text/html', 'console.log(1)'], ['empty script', 'text/javascript', '']]) {
  test(`rejects ${name} instead of JavaScript`, async t => {
    const { url } = await fixture(t, { '/assets/app.js': [200, type, body] });
    await assert.rejects(checkServing(url), /invalid script response/);
  });
}
test('does not follow redirects', async t => {
  const { url, paths } = await fixture(t, { '/login': (_req, res) => { res.writeHead(302, { Location: '/redirected-login' }); res.end(); }, '/redirected-login': [200, 'text/html', html] });
  await assert.rejects(checkServing(url));
  assert.deepEqual(paths, ['/login']);
});
test('does not request entry assets from another origin', async t => {
  const { url, paths } = await fixture(t, { '/login': [200, 'text/html', html.replace('/assets/app.js', 'http://127.0.0.1:1/assets/app.js')] });
  await assert.rejects(checkServing(url), /this origin/);
  assert.deepEqual(paths, ['/login']);
});
test('bounds response bytes', async t => {
  const { url } = await fixture(t, { '/assets/app.js': [200, 'text/javascript', 'x'.repeat(2 * 1024 * 1024 + 1)] });
  await assert.rejects(checkServing(url), /check budget/);
});
test('times out a response that stalls after sending headers', { timeout: 5000 }, async t => {
  const { url } = await fixture(t, { '/login': (_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write('<div'); } });
  await assert.rejects(checkServing(url, { timeoutMs: 100 }));
});

test('bounds the caller even when a transport never settles after abort', { timeout: 1000 }, async t => {
  t.mock.method(globalThis, 'fetch', () => new Promise(() => {}));
  await assert.rejects(checkServing('http://127.0.0.1', { timeoutMs: 25 }), /response deadline exceeded/);
});
