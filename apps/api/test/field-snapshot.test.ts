import { beforeAll, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
let tenant: Tenant;
beforeAll(async () => { resetDatabase(); tenant = await makeTenant('Version field evidence'); });
const input = (cap: number) => ({
  units: [{ label: '2-bed apartments', count: 10, area: 750, cap }],
  efficiency: 85,
  trades: [{ label: 'Superstructure', rate: 110 }],
  profFeePct: 11,
  contingencyPct: 5,
  otherCosts: [],
  finance: { ltcPct: 60, ratePct: 7.5, periodMonths: 18, salesMonths: 4, arrangementFeePct: 1.5, spendProfile: 'scurve' },
  site: { mode: 'residual', landFixed: 0, acqPct: 6.8 },
  disposal: { agentPct: 1.5, legalPct: 0.5 },
  targetProfitOnGdvPct: 20,
});

async function taskFixture() {
  const caller = callerFor(tenant.principal);
  const task = await caller.tasks.create({ dealId: tenant.dealId, title: 'Check roof', aspect: 'Field inspection' });
  const listed = (await caller.tasks.list({ dealId: tenant.dealId })).find(row => row.id === task.id)!;
  return { caller, task, ref: { id: task.id, version: listed.evidenceVersion } };
}
it('pins server task data to a named version and preserves it through edits and restores', async () => {
  const { caller, task, ref } = await taskFixture();
  const saved = await caller.appraisal.save({ dealId: tenant.dealId, input: input(420), asNewVersion: true, label: 'Field basis', fieldTasks: [ref] } as never);
  const before = await caller.appraisal.getCurrent(tenant.dealId);
  expect(before?.fieldSnapshot?.tasks).toEqual([{ id: task.id, title: 'Check roof', done: false, inspectionEvidence: null }]);
  await caller.tasks.toggle({ id: task.id, done: true });
  expect((await caller.appraisal.getCurrent(tenant.dealId))?.fieldSnapshot).toEqual(before?.fieldSnapshot);
  await caller.appraisal.save({ dealId: tenant.dealId, input: input(430), expectedUpdatedAt: saved.updatedAt } as never);
  expect((await caller.appraisal.getCurrent(tenant.dealId))?.fieldSnapshot).toEqual(before?.fieldSnapshot);
  await caller.appraisal.save({ dealId: tenant.dealId, input: input(440), asNewVersion: true, label: 'No capture' } as never);
  expect((await caller.appraisal.getCurrent(tenant.dealId))?.fieldSnapshot).toBeNull();
  await caller.appraisal.restore({ dealId: tenant.dealId, versionId: saved.id });
  expect((await caller.appraisal.getCurrent(tenant.dealId))?.fieldSnapshot).toEqual(before?.fieldSnapshot);
});
it('refuses changed, foreign, duplicate or unreadable tasks without creating a version', async () => {
  const { caller, task, ref } = await taskFixture();
  const before = await prisma.appraisal.count();
  const save = (refs: typeof ref[]) => caller.appraisal.save({ dealId: tenant.dealId, input: input(420), asNewVersion: true, fieldTasks: refs } as never);
  await expect(caller.appraisal.save({ dealId: tenant.dealId, input: input(420), fieldTasks: [ref] } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  const anotherDeal = await prisma.deal.create({ data: { orgId: tenant.orgId, name: 'Other snapshot project', address: 'Synthetic', assetType: 'RESIDENTIAL' } });
  await expect(caller.appraisal.save({ dealId: anotherDeal.id, input: input(420), asNewVersion: true, fieldTasks: [ref] } as never)).rejects.toMatchObject({ code: 'CONFLICT' });
  await expect(save([ref, ref])).rejects.toMatchObject({ code: 'CONFLICT' });
  await caller.tasks.toggle({ id: task.id, done: true });
  await expect(save([ref])).rejects.toMatchObject({ code: 'CONFLICT' });
  const other = await makeTenant('Foreign snapshot');
  await expect(callerFor(other.principal).appraisal.save({ dealId: other.dealId, input: input(420), asNewVersion: true, fieldTasks: [ref] } as never)).rejects.toMatchObject({ code: 'CONFLICT' });
  await prisma.task.update({ where: { id: task.id }, data: { inspectionEvidence: '{broken' } });
  const fresh = (await caller.tasks.list({ dealId: tenant.dealId })).find(row => row.id === task.id)!;
  await expect(save([{ id: task.id, version: fresh.evidenceVersion }])).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  expect(await prisma.appraisal.count()).toBe(before);
});
it('records server-owned captured observations and reports corrupt version snapshots honestly', async () => {
  const { caller, task } = await taskFixture();
  const evidence = { version: 1, inspectionId: 'historical-inspection', sourceUpdatedAt: '2030-01-01T00:00:00.000Z', capturedAt: '2030-01-01T00:00:00.000Z', roomIndex: 0, room: { name: 'Roof', notes: 'Crack', condition: 2 } };
  await prisma.task.update({ where: { id: task.id }, data: { inspectionEvidence: JSON.stringify(evidence) } });
  const fresh = (await caller.tasks.list({ dealId: tenant.dealId })).find(row => row.id === task.id)!;
  const saved = await caller.appraisal.save({ dealId: tenant.dealId, input: input(420), asNewVersion: true, fieldTasks: [{ id: task.id, version: fresh.evidenceVersion, notes: 'forged' }] } as never);
  expect((await caller.appraisal.getCurrent(tenant.dealId))?.fieldSnapshot?.tasks[0].inspectionEvidence).toEqual(evidence);
  await prisma.appraisal.update({ where: { id: saved.id }, data: { fieldSnapshot: '{broken' } });
  expect(await caller.appraisal.getCurrent(tenant.dealId)).toMatchObject({ fieldSnapshot: null, fieldSnapshotState: 'unreadable' });
});
