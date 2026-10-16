import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { computeAppraisal } from '@apex/appraisal-engine';

// A bounded HTTP workload, not simulated browser users or a production capacity claim.
test('concurrent workspaces preserve appraisals and tenant boundaries', async ({ request, baseURL }, info) => {
  const origin = new URL(baseURL!);
  expect(['localhost', '127.0.0.1', '[::1]']).toContain(origin.hostname);
  const tenants: { name: string; token: string; dealId: string }[] = [];
  const samples: { concurrency: number; route: string; ms: number; status: number }[] = [];
  const phases: { concurrency: number; elapsedMs: number; requests: number }[] = [];
  let concurrency = 0;
  let verified = false;
  const call = async (route: string, input: unknown, token = '', mutation = false, expectedStatus = 200) => {
    const start = performance.now();
    let status = 0;
    try {
      const response = await request.fetch(`/trpc/${route}`, {
        method: mutation ? 'POST' : 'GET', timeout: 10_000, maxRedirects: 0,
        headers: { authorization: token ? `Bearer ${token}` : '', 'content-type': 'application/json' },
        ...(mutation ? { data: { json: input } } : { params: { input: JSON.stringify({ json: input }) } }),
      });
      status = response.status();
      const body = await response.json();
      // Synthetic local fixtures only. Retain refusal code/message, never tokens,
      // request inputs or the full response, so conflicts can be diagnosed.
      const refusal = body.error?.json;
      expect(status, `${route}: ${refusal?.data?.code ?? 'no error code'} — ${refusal?.message ?? 'no error message'}`).toBe(expectedStatus);
      if (expectedStatus === 200) {
        expect(body.error, route).toBeUndefined();
        expect(body.result?.data, route).toBeDefined();
        return body.result.data.json;
      }
      expect(body.error?.json?.data?.code, route).toBe('NOT_FOUND');
    } finally {
      if (concurrency) samples.push({ concurrency, route, ms: performance.now() - start, status });
    }
  };
  try {
    for (let n = 0; n < 3; n++) {
      const name = `Load fixture ${randomUUID()}`;
      const registered = await call('org.register', {
        orgName: name, name: 'Synthetic Load Owner', email: `${randomUUID()}@example.test`, password: randomUUID(),
      }, '', true);
      const tenant = { name, token: registered.token, dealId: '' };
      tenants.push(tenant); // Include partial setup in cleanup.
      const deal = await call('deals.create', {
        name, address: 'Synthetic load fixture', assetType: 'RESIDENTIAL', stage: 'APPRAISAL',
      }, tenant.token, true);
      tenant.dealId = deal.id;
    }
    for (const level of [1, 3]) {
      concurrency = level;
      const start = performance.now();
      const before = samples.length;
      // allSettled drains every worker before cleanup, including on assertion failure.
      const workers = await Promise.allSettled(tenants.slice(0, level).map(async (tenant, index) => {
        for (let round = 0; round < 50; round++) {
          const input = {
            units: [{ label: 'Synthetic flats', count: 4, area: 750, cap: 400 + index * 10 + round }],
            efficiency: 85, trades: [{ label: 'Build', rate: 110 }], profFeePct: 11, contingencyPct: 5, otherCosts: [],
            finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' as const },
            site: { mode: 'residual' as const, landFixed: 0, acqPct: 6.8 },
            disposal: { agentPct: 1.5, legalPct: 0.5 }, targetProfitOnGdvPct: 20,
          };
          const listing = await call('deals.list', {}, tenant.token);
          expect(listing.deals.map((d: { id: string }) => d.id)).toEqual([tenant.dealId]);
          const saved = await call('appraisal.save', { dealId: tenant.dealId, input, asNewVersion: true }, tenant.token, true);
          const current = await call('appraisal.getCurrent', tenant.dealId, tenant.token);
          expect(current.id).toBe(saved.id);
          expect(current.result).toMatchObject(computeAppraisal(input));
          await call('deals.get', tenants[(index + 1) % tenants.length].dealId, tenant.token, false, 404);
        }
      }));
      phases.push({ concurrency: level, elapsedMs: performance.now() - start, requests: samples.length - before });
      for (const worker of workers) if (worker.status === 'rejected') throw worker.reason;
    }
    expect(samples).toHaveLength(800);
    verified = true;
  } finally {
    concurrency = 0;
    const cleanup = await Promise.allSettled(tenants.map(t => call('org.deleteWorkspace', { confirmName: t.name }, t.token, true)));
    const summary = phases.map(phase => ({ ...phase,
      requestsPerSecond: phase.requests / (phase.elapsedMs / 1000),
      routes: [...new Set(samples.map(s => s.route))].map(route => {
        const rows = samples.filter(s => s.concurrency === phase.concurrency && s.route === route);
        const times = rows.map(s => s.ms).sort((a, b) => a - b);
        return { route, count: rows.length, p50Ms: times[Math.ceil(times.length * .5) - 1], p95Ms: times[Math.ceil(times.length * .95) - 1], maxMs: times.at(-1), statuses: rows.reduce<Record<string, number>>((out, s) => { out[s.status] = (out[s.status] ?? 0) + 1; return out; }, {}) };
      }),
    }));
    const artifact = { profile: 'workspace-http-v1', timestamp: new Date().toISOString(), node: process.version,
      limits: '3 synthetic workspaces, 1 then 3 closed-loop workers, 50 rounds each; no think time, AI, uploads, PDF, saturation or infrastructure cost measurement; elevated CI rate limits; no production SLO claim',
      verified: verified && cleanup.every(r => r.status === 'fulfilled'), cleanup: cleanup.map(r => r.status), phases: summary, samples };
    const file = info.outputPath('workspace-load.json');
    await writeFile(file, JSON.stringify(artifact, null, 2));
    await info.attach('workspace-load', { path: file, contentType: 'application/json' });
    for (const result of cleanup) if (result.status === 'rejected') throw result.reason;
  }
});
