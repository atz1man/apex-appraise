import { beforeAll, describe, expect, it } from 'vitest';
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
beforeAll(async () => { resetDatabase(); T = await makeTenant('SourceReview'); }, 180_000);
const fresh = async () => {
  const deal = await prisma.deal.create({ data: { orgId: T.orgId, name: 'Source review', address: 'Test', postcode: 'BH1 1AA', assetType: 'RESIDENTIAL', stage: 'APPRAISAL' } });
  return { dealId: deal.id, api: callerFor(T.principal) };
};
const document = (dealId: string, orgId = T.orgId) => prisma.document.create({ data: { orgId, dealId, name: 'Schedule.xlsx', ext: 'xlsx', category: 'Cost plans', sizeBytes: 100n, url: '/uploads/files/test-source.xlsx' } });
describe('durable source input review', () => {
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
  it('leaves legacy appraisals explicitly unreviewed', async () => {
    const { dealId, api } = await fresh(); await api.appraisal.save({ dealId, input });
    expect((await api.appraisal.getCurrent(dealId))?.sourceReview).toBeNull();
  });
});
