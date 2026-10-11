import { beforeAll, expect, it, vi } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';
let tenant: Tenant;
beforeAll(async () => { resetDatabase(); tenant = await makeTenant('Task edits'); });
async function fixture() {
  const task = await callerFor(tenant.principal).tasks.create({ dealId: tenant.dealId, title: 'Inspect roof', aspect: 'Field inspection', due: '2030-03-31' });
  return { id: task.id, title: 'Review roof report', assignee: task.assignee, due: '2030-10-27', expected: { title: task.title, assignee: task.assignee, assigneeId: task.assigneeId, due: task.due!.toISOString(), done: task.done } };
}
it('edits in place, preserves project/status and records both states', async () => {
  const input = await fixture();
  await callerFor(tenant.principal).tasks.update(input);
  expect(await prisma.task.findUniqueOrThrow({ where: { id: input.id } })).toMatchObject({ title: input.title, assignee: input.assignee, due: new Date(input.due), dealId: tenant.dealId, done: false, aspect: 'Field inspection' });
  const event = await prisma.activityEvent.findFirstOrThrow({ where: { orgId: tenant.orgId, action: 'updated a task' }, orderBy: { at: 'desc' } });
  expect(JSON.parse(event.target)).toMatchObject({ before: input.expected, after: { title: input.title, due: input.due } });
});
it('leaves an unchanged timestamp intact and explicitly clears a deadline', async () => {
  const input = await fixture();
  await callerFor(tenant.principal).tasks.update({ ...input, due: undefined });
  let task = await prisma.task.findUniqueOrThrow({ where: { id: input.id } });
  expect(task.due!.toISOString()).toBe(input.expected.due);
  await callerFor(tenant.principal).tasks.update({ ...input, due: null, expected: { ...input.expected, title: task.title } });
  task = await prisma.task.findUniqueOrThrow({ where: { id: input.id } });
  expect(task.due).toBeNull();
});
it.each(['title', 'assignee', 'due', 'done'] as const)('refuses a stale %s snapshot without an edit audit event', async field => {
  const input = await fixture();
  const data = { title: 'Colleague title', assignee: 'ZZ', due: new Date('2031-01-01'), done: true };
  await prisma.task.update({ where: { id: input.id }, data: { [field]: data[field] } });
  const before = await prisma.task.findUniqueOrThrow({ where: { id: input.id } });
  const events = await prisma.activityEvent.count({ where: { orgId: tenant.orgId, action: 'updated a task' } });
  await expect(callerFor(tenant.principal).tasks.update(input)).rejects.toMatchObject({ code: 'CONFLICT' });
  expect(await prisma.task.findUniqueOrThrow({ where: { id: input.id } })).toEqual(before);
  expect(await prisma.activityEvent.count({ where: { orgId: tenant.orgId, action: 'updated a task' } })).toBe(events);
});
it('allows only one edit from competing copies of the same snapshot', async () => {
  const input = await fixture();
  const results = await Promise.allSettled([callerFor(tenant.principal).tasks.update(input), callerFor(tenant.principal).tasks.update({ ...input, title: 'Other editor' })]);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: 'CONFLICT' });
});
it('refuses foreign tasks and read-only users', async () => {
  const input = await fixture();
  const other = await makeTenant('Other task editor');
  await expect(callerFor(other.principal).tasks.update(input)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(callerFor({ ...tenant.principal, role: 'VIEWER' }).tasks.update(input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('rejects invalid days, blank titles and unknown or ambiguous assignees', async () => {
  const input = await fixture();
  for (const patch of [{ due: '2030-02-31' }, { title: '  ' }, { assignee: 'XX' }]) {
    await expect(callerFor(tenant.principal).tasks.update({ ...input, ...patch })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
  for (let i = 0; i < 2; i++) await prisma.user.create({ data: { orgId: tenant.orgId, name: 'Shared initials', initials: 'AB', email: `edit-${i}@example.test`, password: 'x', role: 'ANALYST', principalType: 'internal' } });
  await expect(callerFor(tenant.principal).tasks.update({ ...input, assignee: 'AB' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect((await prisma.task.findUniqueOrThrow({ where: { id: input.id } })).title).toBe(input.expected.title);
});
it('rolls the edit back if the audit cannot be stored', async () => {
  const input = await fixture();
  const transact = prisma.$transaction.bind(prisma);
  const spy = vi.spyOn(prisma, '$transaction').mockImplementation(((callback: any) => transact(async tx => {
    const create = vi.spyOn(tx.activityEvent, 'create').mockRejectedValue(new Error('audit unavailable'));
    try { return await callback(tx); } finally { create.mockRestore(); }
  })) as typeof prisma.$transaction);
  try { await expect(callerFor(tenant.principal).tasks.update(input)).rejects.toThrow('audit unavailable'); } finally { spy.mockRestore(); }
  expect((await prisma.task.findUniqueOrThrow({ where: { id: input.id } })).title).toBe(input.expected.title);
});
