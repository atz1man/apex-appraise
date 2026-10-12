import { beforeAll, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
let tenant: Tenant;
beforeAll(async () => { resetDatabase(); tenant = await makeTenant('Task status'); });
async function task() { return callerFor(tenant.principal).tasks.create({ dealId: tenant.dealId, title: 'Inspect roof', aspect: 'Field inspection' }); }
it.each([true, false])('repeating an explicit status %s does not reverse it or change task contents', async done => {
  const row = await task(); const caller = callerFor(tenant.principal);
  await prisma.task.update({ where: { id: row.id }, data: { done: !done } });
  await Promise.all(Array.from({ length: 4 }, () => caller.tasks.toggle({ id: row.id, done })));
  const saved = await caller.tasks.toggle({ id: row.id, done });
  expect(saved).toEqual({ ...row, done });
});
it('refuses foreign, missing, viewer and portal task writes', async () => {
  const row = await task(); const foreign = await makeTenant('Foreign status');
  await expect(callerFor(foreign.principal).tasks.toggle({ id: row.id, done: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(callerFor(tenant.principal).tasks.toggle({ id: 'missing', done: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(callerFor({ ...tenant.principal, role: 'VIEWER' }).tasks.toggle({ id: row.id, done: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(callerFor(tenant.investorPrincipal).tasks.toggle({ id: row.id, done: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect((await prisma.task.findUniqueOrThrow({ where: { id: row.id } })).done).toBe(false);
});
it('preserves the legacy bare-ID contract', async () => {
  const row = await task(); const caller = callerFor(tenant.principal);
  expect((await caller.tasks.toggle(row.id)).done).toBe(true);
  expect((await caller.tasks.toggle(row.id)).done).toBe(false);
});
