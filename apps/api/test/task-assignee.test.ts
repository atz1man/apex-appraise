import { beforeAll, describe, expect, it } from 'vitest';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * Who a task can be given to.
 *
 * The assignee pickers on the appraisal and the cost monitor were the demo
 * firm's initials — `['AO', 'DW', 'MV', 'PA']` and `['AO', 'DW', 'MV']`, spelled
 * out in the component — and `tasks.create` defaulted the assignee to `'AO'`,
 * as did the column. Measured on a fresh tenant whose only member is its
 * owner: every task raised without naming anybody was assigned to "AO", a
 * person who does not exist in that firm, and the picker offered three more
 * who do not either. The Calendar had already been cured of the same list
 * ("the team is the workspace's real members"); the two pickers were not.
 *
 * A task is now assigned to a MEMBER: the default is whoever raised it, and
 * initials nobody in the firm has are refused rather than stored as a name
 * that will never resolve.
 */
let T: Tenant;
let other: Tenant;

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Tasks');
  other = await makeTenant('Elsewhere');
}, 60_000);

describe('a task’s assignee', () => {
  it('defaults to the person raising it, not to the demo firm’s founder', async () => {
    const t = (await callerFor(T.principal).tasks.create({ dealId: T.dealId, title: 'Chase the QS', aspect: 'Costs' } as never)) as { assignee: string };
    expect(t.assignee).toBe(T.principal.initials);
    expect(t.assignee, 'the fixture’s owner must not happen to share the demo founder’s initials').not.toBe('AO');
  });

  it('may be any member of the firm', async () => {
    const colleague = await prisma.user.create({
      data: { orgId: T.orgId, email: 'zq@tasks.test', password: 'x', name: 'Zed Quill', initials: 'ZQ', role: 'ANALYST', principalType: 'internal' },
    });
    await prisma.user.create({ data: { orgId: other.orgId, email: 'zq@elsewhere.test', password: 'x', name: 'Other Zed', initials: 'ZQ', role: 'ANALYST', principalType: 'internal' } });
    const t = (await callerFor(T.principal).tasks.create({ dealId: T.dealId, title: 'Check the title', aspect: 'Legal', assignee: 'ZQ' } as never)) as { assignee: string };
    expect(t.assignee).toBe('ZQ');
    await prisma.user.delete({ where: { id: colleague.id } });
  });

  it('refuses initials nobody in the firm has — including another firm’s member and the demo founder', async () => {
    await prisma.user.create({
      data: { orgId: other.orgId, email: 'xx@elsewhere.test', password: 'x', name: 'Xavier X', initials: 'XX', role: 'ANALYST', principalType: 'internal' },
    });
    for (const initials of ['AO', 'XX', 'ZZ']) {
      await expect(
        callerFor(T.principal).tasks.create({ dealId: T.dealId, title: 'Nobody', aspect: 'Costs', assignee: initials } as never),
        `${initials} was accepted as an assignee`,
      ).rejects.toThrow(/not a member/i);
    }
  });

  it('cannot be a portal login', async () => {
    await prisma.user.create({
      data: { orgId: T.orgId, email: 'lp@tasks.test', password: 'x', name: 'An LP', initials: 'LP', role: 'VIEWER', principalType: 'investor' },
    });
    await expect(
      callerFor(T.principal).tasks.create({ dealId: T.dealId, title: 'Not theirs', aspect: 'Costs', assignee: 'LP' } as never),
    ).rejects.toThrow(/not a member/i);
  });
});

it('refuses an ambiguous pair of internal members without creating a task', async () => {
  const tenant = await makeTenant('Ambiguous');
  for (const [index, name] of ['Alex Baker', 'Amelia Brown'].entries()) {
    await prisma.user.create({ data: { orgId: tenant.orgId, email: `ab-${index}@ambiguous.test`, password: 'x', name, initials: 'AB', principalType: 'internal', role: 'ANALYST' } });
  }
  const before = await prisma.task.count({ where: { orgId: tenant.orgId } });
  await expect(callerFor(tenant.principal).tasks.create({ dealId: tenant.dealId, title: 'Inspect roof', aspect: 'Field inspection', assignee: 'AB' })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  expect(await prisma.task.count({ where: { orgId: tenant.orgId } })).toBe(before);
});

describe('task due dates preserve the chosen calendar day', () => {
  it.each(['2030-02-31', '2030-02-29', '2030-04-31', '2030-13-01', 'not-a-date', '03/04/2030', '2030-03-31T23:00:00-07:00'])('refuses %s without writing a task', async due => {
    const before = await prisma.task.count({ where: { orgId: T.orgId } });
    await expect(callerFor(T.principal).tasks.create({ dealId: T.dealId, title: 'Review inspection', aspect: 'Field inspection', due })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await prisma.task.count({ where: { orgId: T.orgId } })).toBe(before);
  });

  it.each(['2028-02-29', '2030-03-31', '2030-10-27'])('stores %s unchanged at UTC midnight', async due => {
    const task = await callerFor(T.principal).tasks.create({ dealId: T.dealId, title: 'Review inspection', aspect: 'Field inspection', due });
    const saved = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(saved.due?.toISOString()).toBe(`${due}T00:00:00.000Z`);
  });

  it.each([undefined, ''])('retains the seven-day default for %s', async due => {
    const before = Date.now();
    const task = await callerFor(T.principal).tasks.create({ dealId: T.dealId, title: 'Review inspection', aspect: 'Field inspection', due });
    expect(task.due!.getTime()).toBeGreaterThanOrEqual(before + 7 * 86400e3);
    expect(task.due!.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86400e3);
  });
});

it('uses stable IDs for colleagues sharing initials and refuses stale same-initial reassignment', async () => {
  const tenant = await makeTenant('Stable ownership');
  const colleagues = [];
  for (const [i, name] of ['Alex Baker', 'Amelia Brown'].entries()) {
    colleagues.push(await prisma.user.create({ data: { orgId: tenant.orgId, email: `stable-${i}@example.test`, password: 'x', name, initials: 'AB', principalType: 'internal', role: 'ANALYST' } }));
  }
  const task = await callerFor(tenant.principal).tasks.create({ dealId: tenant.dealId, title: 'Inspect roof', aspect: 'Field inspection', assigneeId: colleagues[0]!.id });
  expect(task).toMatchObject({ assignee: 'AB', assigneeId: colleagues[0]!.id });
  const expected = { title: task.title, assignee: task.assignee, assigneeId: task.assigneeId, due: task.due!.toISOString(), done: task.done };
  await callerFor(tenant.principal).tasks.update({ id: task.id, title: task.title, assigneeId: colleagues[1]!.id, expected });
  await expect(callerFor(tenant.principal).tasks.update({ id: task.id, title: 'Stale title', assigneeId: colleagues[0]!.id, expected })).rejects.toMatchObject({ code: 'CONFLICT' });
  await prisma.user.update({ where: { id: colleagues[1]!.id }, data: { name: 'Amelia Jones', initials: 'AJ' } });
  const saved = (await callerFor(tenant.principal).tasks.list({ dealId: tenant.dealId })).find(row => row.id === task.id)!;
  expect(saved.assigneeId).toBe(colleagues[1]!.id);
  expect(saved.assignee).toBe('AB'); // immutable display snapshot, not identity
  await prisma.user.delete({ where: { id: colleagues[1]!.id } });
  expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBe(colleagues[1]!.id);
  await expect(callerFor(tenant.principal).tasks.create({ dealId: tenant.dealId, title: 'Removed colleague', aspect: 'General', assigneeId: colleagues[1]!.id })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
});

it('refuses foreign and portal member IDs without falling back to initials', async () => {
  const portal = await prisma.user.create({ data: { orgId: T.orgId, email: 'portal-id@example.test', password: 'x', name: 'Investor', initials: 'IP', role: 'VIEWER', principalType: 'investor' } });
  for (const assigneeId of [other.userId, portal.id, 'missing-member']) {
    await expect(callerFor(T.principal).tasks.create({ dealId: T.dealId, title: 'Wrong member', aspect: 'General', assigneeId, assignee: T.principal.initials })).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  }
});

it('keeps legacy assignments unresolved until an explicit edit selects a member', async () => {
  const legacy = await prisma.task.create({ data: { orgId: T.orgId, dealId: T.dealId, title: 'Legacy task', aspect: 'Field inspection', assignee: T.principal.initials } });
  expect((await callerFor(T.principal).tasks.list({ dealId: T.dealId })).find(row => row.id === legacy.id)?.assigneeId).toBeNull();
  await callerFor(T.principal).tasks.update({ id: legacy.id, title: legacy.title, assigneeId: T.userId, expected: { title: legacy.title, assignee: legacy.assignee, assigneeId: null, due: null, done: false } });
  expect((await prisma.task.findUniqueOrThrow({ where: { id: legacy.id } })).assigneeId).toBe(T.userId);
});
