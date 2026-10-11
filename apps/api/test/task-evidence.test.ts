import { beforeAll, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
let tenant: Tenant;
beforeAll(async () => { resetDatabase(); tenant = await makeTenant('Evidence task'); });
async function fixture() {
  const inspection = await prisma.inspection.create({ data: { orgId: tenant.orgId, dealId: tenant.dealId, rooms: JSON.stringify([{ name: 'Empty room', notes: '', condition: 0, photos: [] }, { name: 'Roof', notes: 'Crack above entrance', condition: 2, photos: ['photo-reference-not-copied'] }]), approachWeights: '{}', updatedAt: new Date('2030-01-01T12:00:00Z') } });
  const input = { dealId: tenant.dealId, title: 'Review roof', aspect: 'Field inspection', inspectionSource: { inspectionId: inspection.id, updatedAt: inspection.updatedAt.toISOString(), roomIndex: 1 } };
  return { inspection, input };
}
it('captures server-owned evidence and preserves it through source and task edits', async () => {
  const { inspection, input } = await fixture();
  const task = await callerFor(tenant.principal).tasks.create({ ...input, inspectionEvidence: 'forged', inspectionSource: { ...input.inspectionSource, notes: 'forged' } } as never);
  const original = task.inspectionEvidence;
  expect(JSON.parse(original!)).toMatchObject({ version: 1, inspectionId: inspection.id, sourceUpdatedAt: input.inspectionSource.updatedAt, roomIndex: 1, room: { name: 'Roof', notes: 'Crack above entrance', condition: 2 } });
  expect(original).not.toContain('forged');
  expect(original).not.toContain('photo-reference');
  await prisma.inspection.update({ where: { id: inspection.id }, data: { rooms: '[]', updatedAt: new Date('2030-01-02T12:00:00Z') } });
  await callerFor(tenant.principal).tasks.update({ id: task.id, title: 'Corrected follow-up title', assigneeId: tenant.userId, expected: { title: task.title, assignee: task.assignee, assigneeId: task.assigneeId, due: task.due!.toISOString(), done: task.done } });
  expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).inspectionEvidence).toBe(original);
  const listed = (await callerFor(tenant.principal).tasks.list({ dealId: tenant.dealId })).find(row => row.id === task.id)!;
  expect(listed.inspectionEvidence?.room.notes).toBe('Crack above entrance');
});
it('refuses changed source stamps without creating a task', async () => {
  const { inspection, input } = await fixture();
  await prisma.inspection.update({ where: { id: inspection.id }, data: { updatedAt: new Date('2030-01-02T12:00:00Z') } });
  const before = await prisma.task.count();
  await expect(callerFor(tenant.principal).tasks.create(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await prisma.task.count()).toBe(before);
});
it('refuses another project or workspace inspection', async () => {
  const { inspection, input } = await fixture();
  const other = await makeTenant('Foreign evidence');
  const anotherDeal = await prisma.deal.create({ data: { orgId: tenant.orgId, name: 'Another project', address: 'Synthetic', assetType: 'RESIDENTIAL' } });
  const before = await prisma.task.count();
  await expect(callerFor(tenant.principal).tasks.create({ ...input, dealId: anotherDeal.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(callerFor(other.principal).tasks.create({ ...input, dealId: other.dealId, inspectionSource: { ...input.inspectionSource, inspectionId: inspection.id } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await prisma.task.count()).toBe(before);
});
it.each([0, 999])('refuses an empty or absent observation at index %s', async roomIndex => {
  const { input } = await fixture();
  const before = await prisma.task.count();
  await expect(callerFor(tenant.principal).tasks.create({ ...input, inspectionSource: { ...input.inspectionSource, roomIndex } })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(await prisma.task.count()).toBe(before);
});
it('leaves ordinary and legacy tasks without fabricated inspection evidence', async () => {
  const task = await callerFor(tenant.principal).tasks.create({ dealId: tenant.dealId, title: 'General task', aspect: 'General' });
  expect(task.inspectionEvidence).toBeNull();
  expect((await callerFor(tenant.principal).tasks.list({ dealId: tenant.dealId })).find(row => row.id === task.id)?.inspectionEvidence).toBeNull();
});
