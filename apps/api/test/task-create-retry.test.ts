import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
let tenant: Tenant;
beforeAll(async () => { resetDatabase(); tenant = await makeTenant('Retry task'); });
const request = () => ({ createRequestId: randomUUID(), dealId: tenant.dealId, title: 'Review roof', aspect: 'Field inspection' });
it('returns one task for simultaneous requests and later retries without moving the default deadline', async () => {
  const input = request();
  const caller = callerFor(tenant.principal);
  const rows = await Promise.all(Array.from({ length: 5 }, () => caller.tasks.create(input)));
  expect(new Set(rows.map(row => row.id)).size).toBe(1);
  expect(await prisma.task.count({ where: { createRequestId: input.createRequestId } })).toBe(1);
  const replay = await caller.tasks.create(input);
  expect(replay.due).toEqual(rows[0]!.due);
});
it('retains the committed evidence and edits after source changes', async () => {
  const inspection = await prisma.inspection.create({ data: { orgId: tenant.orgId, dealId: tenant.dealId, rooms: JSON.stringify([{ name: 'Roof', notes: 'Crack', condition: 2 }]), approachWeights: '{}' } });
  const input = { ...request(), inspectionSource: { inspectionId: inspection.id, updatedAt: inspection.updatedAt.toISOString(), roomIndex: 0 } };
  const caller = callerFor(tenant.principal);
  const first = await caller.tasks.create(input);
  await prisma.inspection.update({ where: { id: inspection.id }, data: { rooms: '[]', updatedAt: new Date('2030-01-01') } });
  await prisma.task.update({ where: { id: first.id }, data: { title: 'Already reviewed', done: true } });
  const replay = await caller.tasks.create(input);
  expect(replay.id).toBe(first.id);
  expect(replay.title).toBe('Already reviewed');
  expect(replay.done).toBe(true);
  expect(replay.inspectionEvidence).toBe(first.inspectionEvidence);
});
it('refuses changed payloads under one identity without writing', async () => {
  const input = request(); const caller = callerFor(tenant.principal);
  const first = await caller.tasks.create(input);
  await expect(caller.tasks.create({ ...input, title: 'Different request' })).rejects.toMatchObject({ code: 'CONFLICT' });
  expect((await prisma.task.findUniqueOrThrow({ where: { id: first.id } })).title).toBe(input.title);
  expect(await prisma.task.count({ where: { createRequestId: input.createRequestId } })).toBe(1);
});
it('scopes retry identity to the workspace and refuses a foreign project', async () => {
  const input = request(); const first = await callerFor(tenant.principal).tasks.create(input);
  const other = await makeTenant('Other retry');
  await expect(callerFor(other.principal).tasks.create(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const separate = await callerFor(other.principal).tasks.create({ ...input, dealId: other.dealId });
  expect(separate.id).not.toBe(first.id);
});
it('keeps legacy callers without identities independent', async () => {
  const { createRequestId: _, ...input } = request();
  const caller = callerFor(tenant.principal);
  expect((await caller.tasks.create(input)).id).not.toBe((await caller.tasks.create(input)).id);
});
it('does not reserve a refused request', async () => {
  const input = { ...request(), assigneeId: 'missing' };
  await expect(callerFor(tenant.principal).tasks.create(input)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(await prisma.task.count({ where: { createRequestId: input.createRequestId } })).toBe(0);
});

it('refuses another actor reusing the same workspace identity', async () => {
  const input = request(); await callerFor(tenant.principal).tasks.create(input);
  const user = await prisma.user.create({ data: { orgId: tenant.orgId, name: 'Second owner', email: 'second-retry@example.test', password: 'x', initials: 'SO', role: 'ADMIN', principalType: 'internal' } });
  await expect(callerFor({ ...tenant.principal, userId: user.id, name: user.name, initials: user.initials }).tasks.create(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await prisma.task.count({ where: { createRequestId: input.createRequestId } })).toBe(1);
});
