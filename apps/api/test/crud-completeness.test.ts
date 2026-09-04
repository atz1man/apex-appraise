import { describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';

/**
 * If a firm can create it, a firm can take it back.
 *
 * Measured across the whole router: FIVE entities had a create-shaped mutation
 * and nothing that removed one.
 *
 *   comparables  upsert                — no remove
 *   scenarios    upsert                — no remove
 *   photos       add                   — no remove
 *   tasks        create, toggle        — no remove
 *   deals        create, update, setStage — no remove
 *
 * Beside them, `sales` and `investors` have `deleteUnit`, `deleteTenancy`,
 * `delete`, `removeHolding` and `deleteCashflow`. So deleting properly is this
 * product's own convention, and those five were omissions rather than a stance.
 *
 * What made them matter is what the only available alternative WAS. A
 * comparable could be withdrawn only by overwriting it with a different
 * property — while the row went on carrying weight in the supported £/ft² a Red
 * Book valuation is defended with. A task could be retired only by ticking it,
 * which is a claim that the work happened. And a site photo, uploaded from a
 * phone by whoever was standing on site, could not be taken down at all.
 *
 * This asks the question of the real router rather than of anybody's memory, so
 * the sixth one fails here instead of being found by a customer who cannot undo
 * something.
 */

const CREATES = /^(create|add|upsert|invite|new|import|issue|mint|record)[A-Z]?/;
const REMOVES = /^(delete|remove|revoke|withdraw|archive|clear|cancel|void|detach)[A-Z]?/;

/**
 * Routers that create something a firm is not meant to remove, each with the
 * reason. A new entry needs one, and it should be a fact about the DOMAIN
 * rather than about how much work the delete would be.
 */
const NO_REMOVAL: Record<string, string> = {
  appraisal:
    'a version is the record of what somebody signed. `restore` supersedes rather than erases, and an approved version is immutable by `approved-immutable`. Deleting one would be deleting the audit.',
  auth: 'creates sessions and reset tokens, both of which expire on their own; `logout` is not a delete of a row a firm owns.',
  benchmarks:
    'contributing is reversible by withdrawing consent, which removes every point the firm has ever contributed — `setContribution({ enabled: false })`. There is nothing to delete one by one.',
  billing: 'creates a Stripe checkout session, which is Stripe’s row and not ours to remove.',
  deals:
    'RESERVED, not settled. A deal is the root of appraisals, documents, units, tenancies, photos, tasks and holdings, and one carrying a signed Red Book valuation is a professional record. Whether that is a delete, an archive, or a delete refused once anything is approved is a decision for the firm rather than for this sweep — and it is the one entity of the five left open on purpose.',
  documents: 'a data room holds what was disclosed. `expect` creates a placeholder, and the upload routes own the files.',
  engagement: 'has `withdraw` and `deleteDraft`; matched here only because `issue` is create-shaped.',
  inspections: 'one record per deal, replaced by `save` rather than accumulated.',
  integrations: 'has `disconnect`; matched here only because `saveCredentials` is create-shaped.',
  sitePack: 'creates nothing of its own — it imports comparables, which `comparables.remove` takes back out.',
  xero: 'a connection is removed through `integrations.disconnect`; the rest of this router syncs.',
};

const routers = () => {
  const procs = Object.entries(
    (appRouter as unknown as { _def: { procedures: Record<string, { _def: { type: string } }> } })._def.procedures,
  );
  const by = new Map<string, { creates: string[]; removes: string[] }>();
  for (const [full, p] of procs) {
    if (p._def.type !== 'mutation') continue;
    const [r, ...rest] = full.split('.');
    const name = rest.join('.');
    const e = by.get(r!) ?? { creates: [], removes: [] };
    if (CREATES.test(name)) e.creates.push(name);
    if (REMOVES.test(name)) e.removes.push(name);
    by.set(r!, e);
  }
  return by;
};

describe('what a firm can create, a firm can remove', () => {
  it('walks the real router, not a list', () => {
    const by = routers();
    expect(by.size).toBeGreaterThan(15);
    // the ones that already did it right, and are the reason the others read as omissions
    expect(by.get('sales')!.removes).toEqual(expect.arrayContaining(['deleteUnit', 'deleteTenancy']));
    expect(by.get('investors')!.removes.length).toBeGreaterThan(0);
  });

  it('the four this sweep was written for now have one', () => {
    const by = routers();
    for (const r of ['comparables', 'scenarios', 'photos', 'tasks']) {
      expect(by.get(r)!.removes, `${r} can create and not remove`).not.toEqual([]);
    }
  });

  it('every router that creates can also remove, or says in writing why not', () => {
    const gaps: string[] = [];
    for (const [name, e] of routers()) {
      if (!e.creates.length || e.removes.length) continue;
      if (NO_REMOVAL[name]) continue;
      gaps.push(`${name}: creates [${e.creates.join(', ')}] and removes nothing`);
    }
    expect(
      gaps,
      `a firm can create these and never take them back. Add a removal, or an entry to NO_REMOVAL with a reason:\n  ${gaps.join('\n  ')}`,
    ).toEqual([]);
  });

  it('an exemption cannot outlive the router it names', () => {
    // the failure mode of every hand-kept list: a reason for something that has
    // moved on, still passing, still read as considered
    const by = routers();
    for (const name of Object.keys(NO_REMOVAL)) {
      expect(by.has(name), `NO_REMOVAL names ${name}, which is not a router any more`).toBe(true);
      expect(NO_REMOVAL[name]!.length, `${name}'s exemption is not a reason`).toBeGreaterThan(40);
    }
  });

  it('finds what it is meant to find', () => {
    // the shapes it must catch, and the ones it must not
    expect(CREATES.test('upsert')).toBe(true);
    expect(CREATES.test('add')).toBe(true);
    expect(CREATES.test('createDeal')).toBe(true);
    expect(REMOVES.test('remove')).toBe(true);
    expect(REMOVES.test('deleteUnit')).toBe(true);
    expect(REMOVES.test('removeHolding')).toBe(true);
    // `advanceMilestone` is not a create and `toggle` is not a remove — a task
    // ticked is a claim the work happened, which is exactly what this is about
    expect(CREATES.test('advanceMilestone')).toBe(false);
    expect(REMOVES.test('toggle')).toBe(false);
    expect(REMOVES.test('setStage')).toBe(false);
  });
});
