const { setTimeout: delay } = require('node:timers/promises');

async function readResponse(url, timeoutMs) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`${url.pathname}: expected HTTP 200, received ${response.status}`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error(`${url.pathname}: response exceeds 2 MiB check budget`);
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return { type: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), text: Buffer.concat(chunks).toString('utf8') };
}

/** Public, read-only serving checks; no accounts, payments or provider requests. */
async function checkServing(base, { timeoutMs = 10_000 } = {}) {
  const origin = new URL(base);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Supply a plain HTTP(S) origin without credentials, path or query');
  }
  const login = await readResponse(new URL('/login', origin), timeoutMs);
  if (login.type !== 'text/html' || !/<div\b[^>]*\bid=["']root["'][^>]*>/i.test(login.text)) throw new Error('/login: expected the application HTML entry');
  const assets = [];
  for (const match of login.text.matchAll(/<script\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\btype=["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (src) assets.push({ path: src, kind: 'script' });
  }
  if (!assets.length) throw new Error('/login: missing module entry script');
  for (const match of login.text.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (!/\brel=["']stylesheet["']/i.test(tag)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (href) assets.push({ path: href, kind: 'style' });
  }
  if (assets.length > 20) throw new Error('/login: too many entry assets');
  for (const asset of assets) {
    const url = new URL(asset.path, origin);
    if (url.origin !== origin.origin || url.username || url.password || !url.pathname.startsWith('/assets/')) throw new Error('/login: entry assets must use this origin and /assets/');
    const content = await readResponse(url, timeoutMs);
    const expected = asset.kind === 'script' ? ['text/javascript', 'application/javascript'] : ['text/css'];
    if (!expected.includes(content.type) || !content.text.trim() || /^\s*<(?:!doctype|html)\b/i.test(content.text)) throw new Error(`${url.pathname}: invalid ${asset.kind} response`);
  }
  const ready = await readResponse(new URL('/ready', origin), timeoutMs);
  let status;
  try { status = JSON.parse(ready.text); } catch { throw new Error('/ready: expected JSON readiness evidence'); }
  if (ready.type !== 'application/json' || status?.ok !== true || status?.service !== 'apex-api' || status?.checks?.database?.ok !== true) throw new Error('/ready: API and database readiness not confirmed');
  return { login: 'passed', entryAssets: assets.length, api: 'passed', database: 'passed' };
}
module.exports = { checkServing };

if (require.main === module) (async () => {
  for (let attempt = 1; ; attempt++) {
    try { console.log(JSON.stringify(await checkServing(process.argv[2]))); return; }
    catch (error) {
      if (attempt === 3) throw error;
      console.error(`Serving check attempt ${attempt} failed: ${error.message}`);
      await delay(2000);
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
