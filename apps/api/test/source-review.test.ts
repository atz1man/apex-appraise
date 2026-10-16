import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../src/context.js';
import { issueExtractionReceipt, verifyExtractionReceipt, receiptComparison } from '../src/extraction-receipt.js';
import { sourceVersion } from '../src/source-version.js';
import { documentBlocks } from '../src/routers/appraisal.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
const input = {
  units: [{ label: 'Apartments', count: 4, area: 750, cap: 400, source: 'Schedule.xlsx, Units!B4' }],
  efficiency: 85, trades: [{ label: 'Build', rate: 110 }], profFeePct: 11, contingencyPct: 5, otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' as const },
  site: { mode: 'residual' as const, landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 }, targetProfitOnGdvPct: 20,
};
const acknowledgement = { accepted: true as const, documentIds: [] as string[], sample: false, omissions: [{ name: 'Schedule.xlsx', reason: 'Sheet 11 omitted' }] };
let T: Tenant;
afterEach(() => vi.unstubAllEnvs());
beforeAll(async () => { resetDatabase(); T = await makeTenant('SourceReview'); }, 180_000);
const fresh = async () => {
  const deal = await prisma.deal.create({ data: { orgId: T.orgId, name: 'Source review', address: 'Test', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' } });
  return { dealId: deal.id, api: callerFor(T.principal) };
};
const document = (dealId: string, orgId = T.orgId) => prisma.document.create({ data: { orgId, dealId, name: 'Schedule.xlsx', ext: 'xlsx', category: 'Cost plans', sizeBytes: 100n, url: '/uploads/files/test-source.xlsx' } });
describe('durable source input review', () => {
  it('retains bounded reported assumption origins and leaves legacy origins unknown', async () => {
    const { dealId, api } = await fresh();
    const saved = await api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, assumptionOrigins: { efficiency: 'application-default', 'finance.rate': 'user-entered' } } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.assumptionOrigins).toEqual({ efficiency: 'application-default', 'finance.rate': 'user-entered' });
    await api.appraisal.save({ dealId, input: { ...input, efficiency: 80 }, expectedUpdatedAt: saved.updatedAt });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview).toMatchObject({ inputsUnchanged: false, assumptionOrigins: { efficiency: 'application-default' } });
    const other = await fresh();
    await api.appraisal.save({ dealId: other.dealId, input, sourceReview: acknowledgement });
    expect((await api.appraisal.getCurrent(other.dealId))?.sourceReview?.assumptionOrigins).toBeUndefined();
    await expect(api.appraisal.save({ dealId: other.dealId, input, sourceReview: { ...acknowledgement, assumptionOrigins: { efficiency: 'verified' } } } as never)).rejects.toThrow();
  });
  it('pins the server fingerprint and refuses a changed fingerprint despite identical metadata', async () => {
    const { dealId, api } = await fresh(); const doc = await document(dealId);
    const hash = 'a'.repeat(64);
    await prisma.document.update({ where: { id: doc.id }, data: { sha256: hash } });
    await api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [doc.id], sha256: 'forged' } } as never);
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.documents[0]).toMatchObject({ sha256: hash, status: 'unchanged' });
    await prisma.document.update({ where: { id: doc.id }, data: { sha256: 'b'.repeat(64) } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.documents[0]).toMatchObject({ sha256: hash, status: 'changed', url: null });
  });
  it('refuses invalid database fingerprints before committing an unreadable review', async () => {
    const { dealId, api } = await fresh(); const doc = await document(dealId);
    await prisma.document.update({ where: { id: doc.id }, data: { sha256: 'not-a-sha256' } });
    await expect(api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [doc.id] } })).rejects.toThrow(/invalid upload fingerprint/);
    expect(await api.appraisal.getCurrent(dealId)).toBeNull();
  });
  it('reads pre-fingerprint reviews without inventing a historical fingerprint', async () => {
    const { dealId, api } = await fresh(); const doc = await document(dealId);
    const saved = await api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [doc.id] } });
    const row = await prisma.appraisal.findUniqueOrThrow({ where: { id: saved.id } });
    const legacy = JSON.parse(row.sourceReview!); delete legacy.documents[0].sha256;
    await prisma.appraisal.update({ where: { id: saved.id }, data: { sourceReview: JSON.stringify(legacy) } });
    await prisma.document.update({ where: { id: doc.id }, data: { sha256: 'c'.repeat(64) } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.documents[0]).toMatchObject({ sha256: null, status: 'unchanged' });
  });
  it('stamps authenticated identity and persisted inputs, ignoring caller identity claims', async () => {
    const { dealId, api } = await fresh(); const doc = await document(dealId);
    await api.appraisal.save({ dealId, input, source: 'ai', sourceReview: { ...acknowledgement, documentIds: [doc.id], reviewerName: 'Imposter', reviewedAt: '2000-01-01' } } as never);
    const saved = await api.appraisal.getCurrent(dealId);
    expect(saved?.sourceReview).toMatchObject({ reviewerName: T.principal.name, inputsUnchanged: true, sample: false, omissions: acknowledgement.omissions });
    expect(saved?.sourceReview?.reviewedAt).not.toContain('2000-01-01');
    expect(saved?.sourceReview?.documents[0]).toMatchObject({ id: doc.id, name: doc.name, status: 'unchanged' });
    expect(saved?.sourceReview?.documents[0].url).toContain('?t=');
    expect(JSON.stringify(saved?.sourceReview)).not.toContain('storagePath');
  });
  it('keeps historical acknowledgement but marks it stale after an ordinary edit', async () => {
    const { dealId, api } = await fresh();
    const saved = await api.appraisal.save({ dealId, input, sourceReview: acknowledgement });
    await api.appraisal.save({ dealId, input: { ...input, efficiency: 80 }, expectedUpdatedAt: saved.updatedAt });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.inputsUnchanged).toBe(false);
  });
  it('detects input changes made outside the save route', async () => {
    const { dealId, api } = await fresh();
    const saved = await api.appraisal.save({ dealId, input, sourceReview: acknowledgement });
    await prisma.appraisal.update({ where: { id: saved.id }, data: { units: JSON.stringify([{ ...input.units[0], cap: 500 }]) } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.inputsUnchanged).toBe(false);
  });
  it('does not carry acknowledgement into a new unreviewed version', async () => {
    const { dealId, api } = await fresh();
    const saved = await api.appraisal.save({ dealId, input, sourceReview: acknowledgement });
    await api.appraisal.save({ dealId, input, asNewVersion: true });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview).toBeNull();
    expect((await prisma.appraisal.findUniqueOrThrow({ where: { id: saved.id } })).sourceReview).not.toBeNull();
  });
  it('refuses foreign workspace, sibling deal and missing sources without saving', async () => {
    const { dealId, api } = await fresh();
    const other = await makeTenant('OtherSource'); const foreign = await document(other.dealId, other.orgId);
    const sibling = await fresh(); const siblingDoc = await document(sibling.dealId);
    for (const id of [foreign.id, siblingDoc.id, 'missing']) {
      await expect(api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [id] } })).rejects.toThrow(/reviewed source is unavailable/);
    }
    expect(await api.appraisal.getCurrent(dealId)).toBeNull();
  });
  it('retains snapshots while refusing links to changed or removed sources', async () => {
    const { dealId, api } = await fresh(); const doc = await document(dealId);
    await api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [doc.id] } });
    await prisma.document.update({ where: { id: doc.id }, data: { name: 'Revised.xlsx' } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.documents[0]).toMatchObject({ name: 'Schedule.xlsx', status: 'changed', url: null });
    await prisma.document.delete({ where: { id: doc.id } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.documents[0]).toMatchObject({ name: 'Schedule.xlsx', status: 'missing', url: null });
  });
  it('requires explicit acceptance and records worked-example origin', async () => {
    const { dealId, api } = await fresh();
    await expect(api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, accepted: false } } as never)).rejects.toThrow();
    await api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, sample: true } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.sample).toBe(true);
  });
  it('distinguishes absent reviews from unreadable stored records', async () => {
    const { dealId, api } = await fresh(); await api.appraisal.save({ dealId, input });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReviewState).toBe('absent');
    await prisma.appraisal.updateMany({ where: { dealId }, data: { sourceReview: '{broken' } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReviewState).toBe('unreadable');
  });
  it('persists structured references with the accepted unit label', async () => {
    const { dealId, api } = await fresh(); const doc = await document(dealId);
    await prisma.document.update({ where: { id: doc.id }, data: { ext: 'pdf' } });
    await api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [doc.id], references: [{ unitIndex: 0, documentId: doc.id, page: 2, locator: 'Drawing A102 revision C' }] } });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.references[0]).toMatchObject({ unitLabel: 'Apartments', page: 2, locator: 'Drawing A102 revision C' });
  });
  it('refuses references outside reviewed sources, invalid units and PDF pages on spreadsheets', async () => {
    const { dealId, api } = await fresh(); const doc = await document(dealId);
    const valid = { unitIndex: 0, documentId: doc.id, page: null, locator: 'Costs!B4' };
    for (const bad of [{ ...valid, documentId: 'missing' }, { ...valid, unitIndex: 99 }, { ...valid, page: 1 }, { ...valid, locator: '' }]) {
      await expect(api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [doc.id], references: [bad] } })).rejects.toThrow(/Each input reference/);
    }
  });
  it('flags superseded reviewed sources, excludes them from extraction and records an undoable revision link', async () => {
    const { dealId, api } = await fresh(); const earlier = await document(dealId); const later = await document(dealId);
    await prisma.document.update({ where: { id: later.id }, data: { addedAt: new Date(+earlier.addedAt + 1000) } });
    await api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [earlier.id] } });
    await api.documents.setRevision({ documentId: earlier.id, toId: later.id, expected: null });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.documents[0]).toMatchObject({ status: 'superseded', url: null });
    const blocks = await documentBlocks(prisma, T.orgId, [earlier.id]);
    expect(blocks.used).toEqual([]); expect(blocks.skipped[0].reason).toMatch(/Superseded/);
    await expect(api.appraisal.save({ dealId, input, asNewVersion: true, sourceReview: { ...acknowledgement, documentIds: [earlier.id] } })).rejects.toThrow(/source is unavailable/);
    expect(await prisma.activityEvent.count({ where: { dealId, action: 'recorded a superseding document revision' } })).toBe(1);
    await api.documents.setRevision({ documentId: earlier.id, toId: null, expected: later.id });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.documents[0].status).toBe('unchanged');
  });
  it('refuses revision cycles, foreign replacements, viewers and stale edits', async () => {
    const { dealId, api } = await fresh(); const earlier = await document(dealId); const later = await document(dealId);
    await prisma.document.update({ where: { id: later.id }, data: { addedAt: new Date(+earlier.addedAt + 1000) } });
    const other = await makeTenant('RevisionOther'); const foreign = await document(other.dealId, other.orgId);
    await expect(api.documents.setRevision({ documentId: earlier.id, toId: foreign.id, expected: null })).rejects.toThrow();
    await expect(api.documents.setRevision({ documentId: later.id, toId: earlier.id, expected: null })).rejects.toThrow(/later uploaded/);
    await expect(api.documents.setRevision({ documentId: earlier.id, toId: earlier.id, expected: null })).rejects.toThrow(/later uploaded/);
    await expect(callerFor({ ...T.principal, role: 'VIEWER' }).documents.setRevision({ documentId: earlier.id, toId: later.id, expected: null })).rejects.toThrow();
    await api.documents.setRevision({ documentId: earlier.id, toId: later.id, expected: null });
    await expect(api.documents.setRevision({ documentId: earlier.id, toId: null, expected: null })).rejects.toThrow(/revision link changed/);
  });

});

it.each(['name', 'fingerprint', 'storage'] as const)('refuses a source %s change between review preparation and save', async change => {
  const { dealId, api } = await fresh(); const doc = await document(dealId);
  const listed = (await api.documents.list({ dealId })).documents[0];
  await prisma.document.update({ where: { id: doc.id }, data:
    change === 'name' ? { name: 'Changed.xlsx' } : change === 'fingerprint' ? { sha256: 'b'.repeat(64) } : { url: '/uploads/files/replaced.xlsx' },
  });
  await expect(api.appraisal.save({ dealId, input, sourceReview: {
    ...acknowledgement, documentIds: [doc.id], expectedSources: [{ id: doc.id, version: listed.version }],
  } })).rejects.toMatchObject({ code: 'CONFLICT', message: expect.stringContaining('changed since this review was prepared') });
  expect(await api.appraisal.getCurrent(dealId)).toBeNull();
});

it('keeps source stamps stable across extraction status and sharing changes and accepts an unchanged review', async () => {
  const { dealId, api } = await fresh(); const doc = await document(dealId);
  const before = (await api.documents.list({ dealId })).documents[0];
  await prisma.document.update({ where: { id: doc.id }, data: { extraction: 'EXTRACTED', investorVisible: true } });
  const after = (await api.documents.list({ dealId })).documents[0];
  expect(after.version).toBe(before.version);
  await api.appraisal.save({ dealId, input, sourceReview: {
    ...acknowledgement, documentIds: [doc.id], expectedSources: [{ id: doc.id, version: before.version }],
  } });
  expect((await api.appraisal.getCurrent(dealId))?.sourceReview?.documents[0]).toMatchObject({ name: doc.name, status: 'unchanged' });
});

it('refuses expected sources omitted from the reviewed deal without disclosing foreign identity', async () => {
  const { dealId, api } = await fresh(); const doc = await document(dealId);
  const source = (await api.documents.list({ dealId })).documents[0];
  await expect(api.appraisal.save({ dealId, input, sourceReview: {
    ...acknowledgement, expectedSources: [{ id: doc.id, version: source.version }],
  } })).rejects.toMatchObject({ code: 'CONFLICT' });
  const other = await makeTenant('Review foreign stamp'); const foreign = await document(other.dealId, other.orgId);
  await expect(api.appraisal.save({ dealId, input, sourceReview: {
    ...acknowledgement, documentIds: [doc.id], expectedSources: [{ id: foreign.id, version: source.version }],
  } })).rejects.toMatchObject({ code: 'CONFLICT', message: 'A source changed since this review was prepared. Refresh source documents and check the affected references or extract again.' });
  expect(await api.appraisal.getCurrent(dealId)).toBeNull();
});


describe('server-issued extraction receipts', () => {
  it('retains original outputs after corrections and rejects tampering, other tenants and session signatures', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { api, dealId } = await fresh();
    const extracted = await api.autoAppraisal.extract({ notes: 'Synthetic worked example for receipt test', buildPerSqft: 105 });
    const token = extracted.extractionReceipt;
    const receipt = verifyExtractionReceipt(token, T.orgId);
    expect(receipt.extraction).toEqual(extracted.extraction);
    expect(receipt.mode).toBe('worked-example');
    const comparison = receiptComparison({ ...receipt, assumptionOrigins: {}, extraction: {
      ...receipt.extraction, efficiency: 91, asking: 0, profFee: 3, contingency: 4, targetProfit: 5,
      acq: 6, agent: 7, legal: 8, finance: { ltc: 9, rate: 10, period: 11, sales: 12, arrFee: 1 },
    } }, { ...input, efficiency: 91, site: { ...input.site, landFixed: 0, acqPct: 16 },
      profFeePct: 13, contingencyPct: 14, targetProfitOnGdvPct: 15,
      disposal: { agentPct: 17, legalPct: 18 },
      finance: { ltcPct: 19, ratePct: 20, periodMonths: 21, salesMonths: 22, arrangementFeePct: 2 },
    });
    expect(comparison.map(r => [r.field, r.originalValue, r.savedValue, r.changed])).toEqual([
      ['efficiency', 91, 91, false], ['asking', 0, 0, false], ['profFee', 3, 13, true],
      ['contingency', 4, 14, true], ['targetProfit', 5, 15, true], ['acq', 6, 16, true],
      ['agent', 7, 17, true], ['legal', 8, 18, true], ['finance.ltc', 9, 19, true],
      ['finance.rate', 10, 20, true], ['finance.period', 11, 21, true],
      ['finance.sales', 12, 22, true], ['finance.arrFee', 1, 2, true],
    ]);
    expect(comparison.every(r => r.originalOrigin === 'Origin not recorded')).toBe(true);

    expect(JSON.stringify(jwt.decode(token))).not.toContain('Synthetic worked example for receipt test');
    expect(() => jwt.verify(token, JWT_SECRET)).toThrow();
    expect(() => verifyExtractionReceipt(jwt.sign(receipt, JWT_SECRET), T.orgId)).toThrow(/invalid or expired/);
    const other = await makeTenant('Other receipt workspace');
    expect(() => verifyExtractionReceipt(token, other.orgId)).toThrow(/invalid or expired/);
    await expect(callerFor(other.principal).appraisal.save({ dealId: other.dealId, input, sourceReview: { ...acknowledgement, extractionReceipt: token } })).rejects.toThrow(/invalid or expired/);
    const pieces = token.split('.');
    pieces[1] = Buffer.from(JSON.stringify({ ...receipt, mode: 'model' })).toString('base64url');
    await expect(api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, extractionReceipt: pieces.join('.') } })).rejects.toThrow(/invalid or expired/);
    expect(extracted.extraction.units.length).toBeGreaterThan(1);
    const unitIds = extracted.extraction.units.map(u => u.extractionUnitId);
    expect(unitIds.every(id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id))).toBe(true);
    expect(new Set(unitIds).size).toBe(unitIds.length);
    const whatIf = await api.autoAppraisal.whatIf({ extraction: extracted.extraction, buildPerSqft: 105, prompt: 'interest rate 9%' });
    expect(whatIf.extraction.units.map(u => u.extractionUnitId)).toEqual(unitIds);
    const withoutLinks = { ...extracted.extraction, units: extracted.extraction.units.map(({ extractionUnitId, ...unit }) => unit) };
    expect(await api.autoAppraisal.compute({ extraction: extracted.extraction, buildPerSqft: 105 })).toEqual(await api.autoAppraisal.compute({ extraction: withoutLinks, buildPerSqft: 105 }));
    const originalUnits = extracted.extraction.units.map(u => ({ extractionUnitId: u.extractionUnitId, label: u.label, count: u.count, area: u.area, cap: u.value, source: u.source }));
    await expect(api.appraisal.save({ dealId, input: { ...input, units: [originalUnits[0], originalUnits[0]] }, sourceReview: { ...acknowledgement, extractionReceipt: token } })).rejects.toThrow(/duplicated/);
    await expect(api.appraisal.save({ dealId, input: { ...input, units: originalUnits } })).rejects.toThrow(/unknown/);
    const otherRun = await api.autoAppraisal.extract({ notes: 'Another synthetic run' });
    expect(otherRun.extraction.units.map(u => u.extractionUnitId).some(id => unitIds.includes(id))).toBe(false);
    await expect(api.appraisal.save({ dealId, input: { ...input, units: [{ ...originalUnits[0], extractionUnitId: otherRun.extraction.units[0].extractionUnitId }] }, sourceReview: { ...acknowledgement, extractionReceipt: token } })).rejects.toThrow(/unknown/);
    const saved = await api.appraisal.save({ dealId, input: { ...input, units: originalUnits }, sourceReview: { ...acknowledgement, sample: false, extractionReceipt: token } });
    const review = (await api.appraisal.getCurrent(dealId))!.sourceReview!;
    expect(review.originalExtractedUnits).toEqual(extracted.extraction.units);
    expect(review.extractionComparison).toHaveLength(13);
    expect(review.extractionComparison).toContainEqual(expect.objectContaining({ field: 'efficiency', originalValue: extracted.extraction.efficiency, savedValue: input.efficiency }));
    expect(review.extractionComparison?.map(r => r.field)).not.toContain('cilPerSqm');
    expect(review).toMatchObject({ sample: true, omissions: [], extractionReceipt: { id: receipt.id, outputHash: receipt.outputHash } });
    const stored = JSON.parse((await prisma.appraisal.findUniqueOrThrow({ where: { id: saved.id } })).sourceReview!);
    expect(stored.extractionReceipt.extraction).toEqual(extracted.extraction);
    expect(stored.extractionReceipt.buildPerSqft).toBe(105);
    await api.appraisal.save({ dealId, input: { ...input, efficiency: 80, units: [...originalUnits].reverse().map((u, i) => ({ ...u, label: `Renamed current unit ${i + 1}`, area: 999 })) }, expectedUpdatedAt: saved.updatedAt });
    const laterReview = (await api.appraisal.getCurrent(dealId))?.sourceReview;
    expect(laterReview?.originalExtractedUnits).toEqual(extracted.extraction.units);
    expect((await api.appraisal.getCurrent(dealId))?.input.units.map(u => u.extractionUnitId)).toEqual([...unitIds].reverse());
    expect(laterReview).toMatchObject({ inputsUnchanged: false, extractionReceipt: { id: receipt.id } });
    expect(laterReview?.extractionComparison).toContainEqual(expect.objectContaining({ field: 'efficiency', originalValue: extracted.extraction.efficiency, savedValue: 80, changed: true }));
    expect(() => verifyExtractionReceipt(jwt.sign(receipt, 'untrusted', { expiresIn: -1 }), T.orgId)).toThrow();
    vi.useFakeTimers();
    try { vi.setSystemTime(Date.now() + 8 * 86400000); expect(() => verifyExtractionReceipt(token, T.orgId)).toThrow(/expired/); }
    finally { vi.useRealTimers(); }
  });
  it('requires every receipt source to remain in the reviewed deal at its issued version', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { api, dealId } = await fresh();
    const extracted = await api.autoAppraisal.extract({ notes: 'Synthetic worked example for source receipt' });
    const doc = await document(dealId);
    const receipt = verifyExtractionReceipt(extracted.extractionReceipt, T.orgId);
    const token = issueExtractionReceipt({ ...receipt, notes: '', sourceDocuments: [{ id: doc.id, name: doc.name, version: sourceVersion(doc) }] });
    await expect(api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, extractionReceipt: token } })).rejects.toThrow(/source changed/i);
    await prisma.document.update({ where: { id: doc.id }, data: { name: 'Replaced schedule' } });
    await expect(api.appraisal.save({ dealId, input, sourceReview: { ...acknowledgement, documentIds: [doc.id], extractionReceipt: token } })).rejects.toThrow(/source changed/i);
  });
});
