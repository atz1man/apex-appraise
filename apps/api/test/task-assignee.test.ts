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
