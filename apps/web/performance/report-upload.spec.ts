import { expect, test } from '@playwright/test';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

// Disposable-stack exercise: no model calls or external data providers.
test('parallel uploads retain exact bytes and busy PDF requests recover', async ({ request, baseURL }, info) => {
  test.setTimeout(120_000);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(new URL(baseURL!).hostname);
  const tenants: { name: string; token: string; dealId: string; reportToken: string }[] = [];
  const samples: { operation: string; status: number; ms: number }[] = [];
  let verified = false;
  const rpc = async (route: string, input: unknown, token = '') => {
    const r = await request.post(`/trpc/${route}`, { timeout: 10_000, maxRedirects: 0,
      headers: { authorization: `Bearer ${token}` }, data: { json: input } });
    expect(r.status(), route).toBe(200);
    const body = await r.json(); expect(body.error).toBeUndefined();
    return body.result.data.json;
  };
  const settle = async <T,>(jobs: Promise<T>[]) => {
    const results = await Promise.allSettled(jobs);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    return results.map(r => (r as PromiseFulfilledResult<T>).value);
  };
  const measured = async <T,>(operation: string, job: () => Promise<T & { status(): number }>) => {
    const start = performance.now(); let status = 0;
    try { const response = await job(); status = response.status(); return response; }
    finally { samples.push({ operation, status, ms: performance.now() - start }); }
  };
  try {
    for (let n = 0; n < 2; n++) {
      const name = `Contention ${randomUUID().replaceAll('-', '')}`;
      const account = await rpc('org.register', { orgName: name, name: 'Synthetic Owner', email: `${randomUUID()}@example.test`, password: randomUUID() });
      const t = { name, token: account.token, dealId: '', reportToken: '' }; tenants.push(t);
      const deal = await rpc('deals.create', { name, address: 'Synthetic site', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' }, t.token);
      t.dealId = deal.id;
      await rpc('appraisal.save', { dealId: t.dealId, input: {
        units: [{ label: 'Synthetic flats', count: n + 2, area: 750, cap: 400 }], efficiency: 85,
        trades: [{ label: 'Build', rate: 110 }], profFeePct: 11, contingencyPct: 5, otherCosts: [],
        finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
        site: { mode: 'residual', landFixed: 0, acqPct: 6.8 }, disposal: { agentPct: 1.5, legalPct: 0.5 }, targetProfitOnGdvPct: 20,
      } }, t.token);
      t.reportToken = (await rpc('appraisal.downloadToken', { kind: 'appraisal', dealId: t.dealId }, t.token)).token;
    }
    const fixture = await readFile(new URL('../../api/test/fixtures/auto-appraisal/revision-pack.pdf', import.meta.url));
    const uploads = await settle(Array.from({ length: 6 }, async (_, index) => {
      const t = tenants[index % 2];
      // PDF comments after EOF make each small synthetic upload byte-distinct.
      const bytes = Buffer.concat([fixture, Buffer.from(`\n% synthetic upload ${index}\n`)]);
      const r = await measured('upload', () => request.post('/uploads/document', {
        timeout: 15_000, maxRedirects: 0, headers: { authorization: `Bearer ${t.token}` },
        multipart: { dealId: t.dealId, category: 'Planning', file: { name: 'Same name.pdf', mimeType: 'application/pdf', buffer: bytes } },
      }));
      expect(r.status()).toBe(200);
      const stored = await r.json();
      expect(stored.url).toMatch(/^\/uploads\/files\/[^/?]+$/);
      const download = await measured('download', () => request.get(stored.url, { timeout: 10_000, maxRedirects: 0, headers: { authorization: `Bearer ${t.token}` } }));
      expect(download.status()).toBe(200);
      const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
      expect(hash(await download.body())).toBe(hash(bytes));
      const foreign = await measured('foreign-download', () => request.get(stored.url, { timeout: 10_000, maxRedirects: 0, headers: { authorization: `Bearer ${tenants[(index + 1) % 2].token}` } }));
      expect(foreign.status()).toBe(404);
      return stored.url as string;
    }));
    expect(new Set(uploads).size).toBe(6);
    const pdf = async (index: number) => {
      const t = tenants[index % 2];
      const r = await measured('pdf', () => request.get(`/reports/${t.dealId}/appraisal.pdf`, {
        params: { t: t.reportToken }, timeout: 65_000, maxRedirects: 0,
      }));
      expect([200, 503]).toContain(r.status());
      if (r.status() === 503) {
        expect(r.headers()['retry-after']).toBe('5');
        expect((await r.json()).error).toMatch(/busy.*try again/i);
      } else {
        expect(r.headers()['content-type']).toContain('application/pdf');
        expect(r.headers()['content-disposition']).toContain(t.name);
        const bytes = await r.body();
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
        expect(bytes.subarray(-30).toString()).toContain('%%EOF');
      }
      return r.status();
    };
    const statuses = await settle(Array.from({ length: 6 }, (_, i) => pdf(i)));
    expect(statuses).toContain(200);
    expect(statuses).toContain(503);
    // All burst jobs have completed; capacity must now be available to each tenant.
    for (let i = 0; i < tenants.length; i++) expect(await pdf(i)).toBe(200);
    verified = true;
  } finally {
    const cleanup = await Promise.allSettled(tenants.map(t => rpc('org.deleteWorkspace', { confirmName: t.name }, t.token)));
    const file = info.outputPath('report-upload.json');
    await writeFile(file, JSON.stringify({ profile: 'report-upload-v1', verified: verified && cleanup.every(r => r.status === 'fulfilled'),
      cleanup: cleanup.map(r => r.status), samples,
      limits: 'Two synthetic tenants; six small same-name PDF uploads and six concurrent report requests followed by two sequential retries. No PDF text/visual comparison, large scans, sustained load, cost or production SLO evidence. Workspace records erased; disposable stack volume teardown removes remaining fixture bytes.' }, null, 2));
    await info.attach('report-upload', { path: file, contentType: 'application/json' });
    for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
  }
});
