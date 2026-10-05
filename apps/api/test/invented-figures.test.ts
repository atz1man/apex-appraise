import { beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_CONNECTORS, INTEGRATION_PROVIDERS, type IntegrationProvider } from '@apex/types';
import { appRouter } from '../src/router.js';
import { callerFor, makeTenant, prisma, resetDatabase, type Tenant } from './harness.js';

/**
 * A figure nobody supplied is named as a sample, or it is refused.
 *
 * `integrations.sync` fabricated. With no credentials it wrote a comparable at
 * `basePsf: 212` — address "PriceHubble AVM estimate", meta "Automated valuation
 * cross-check · 80% confidence band" — straight onto a valuer's evidence file, in
 * production, with nothing in the row marking it as invented and nothing in the
 * product distinguishing it from a sold price. A comparable's £/ft² is what the
 * supported rate is built from and what the valuation rests on, so that number
 * could reach a signed Red Book opinion under somebody's name.
 *
 * `demo-mode.ts` was written for exactly this hazard and says so in its own doc
 * comment — "a sample extraction can be saved into a real appraisal, carrying
 * unit values and citations" — and the one place in this server that fabricated a
 * COMPARABLE never consulted it. The absence of a credential is not consent; a
 * firm that has deployed and not yet pasted an API key is in that state on day
 * one.
 *
 * Two more things the same branch did. EPC created a Document row for a
 * certificate PDF with `sizeBytes: 180_000n` and no file behind it — "a portal
 * never offers a document it cannot open", one layer up, since the data room
 * listed it and a plot could be shared with it. And `connect` set
 * `status: 'CONNECTED'`, `lastSync: new Date()` for any of the ten provider names
 * with no handshake at all, so the screen read "Connected · Synced just now" for
 * four providers nothing in this codebase can contact.
 */

/* --------------------------- the sweep --------------------------- */

const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '');

/**
 * A money-shaped field assigned a LITERAL, which is a figure the server chose
 * rather than one a caller sent.
 *
 * `0` is excluded and the exclusion is a rule rather than a convenience: a cost
 * package opening at `spent: 0` invents nothing — a scheme that has not started
 * has spent nothing, and that is a fact about the scheme. Every other literal is
 * somebody's guess at a price.
 */
const MONEY_FIELD = /\b(basePsf|pricePence|budget|spent|psf|rate|cap|gdv|valuePence|rent|amount|price)\s*:\s*(-?[0-9][0-9_.]*)/g;

const inventedFigures = (src: string): string[] => {
  const clean = strip(src);
  const out: string[] = [];
  for (const m of clean.matchAll(MONEY_FIELD)) {
    if (Number(m[2]!.replace(/_/g, '')) === 0) continue;
    out.push(m[0]!);
  }
  return out;
};

/**
 * The two ways a figure the server chose is allowed to exist.
 *
 * gated   it sits behind `demoFallbacksAllowed()`, which is a DECISION the
 *         deployment took — `NODE_ENV !== 'production' || DEMO_MODE === '1'` —
 *         rather than the absence of a credential, which is not consent.
 * named   the rows it writes say SAMPLE in their own text, so a person reading
 *         the table it lands in cannot mistake it for evidence. `org.loadSampleDeal`
 *         is this one: the deal is called "Sample — Kingfisher Wharf" and every
 *         unit's source is "Sample scheme". A button that says sample, writing
 *         rows that say sample, is not a fabrication passed off as real.
 */
const sanctioned = (src: string) => {
  const clean = strip(src);
  return /demoFallbacksAllowed\(/.test(clean) || /\bSample\b|\bSAMPLE\b/.test(clean);
};

type Proc = { _def: { type: 'query' | 'mutation'; resolver?: unknown } };
const procedures = () =>
  Object.entries((appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures);

describe('nothing this server invents reaches a figure unmarked', () => {
  it('reads the real resolvers, not a grep of the files', () => {
    const all = procedures();
    expect(all.length, 'the router walk is broken').toBeGreaterThan(100);
    for (const [path, p] of all) expect(typeof p._def.resolver, `${path} has no resolver`).toBe('function');
  });

  /** A sweep that matches nothing passes in silence. These are the real sites. */
  it('finds the procedures that choose a figure themselves', () => {
    const found = procedures()
      .filter(([, p]) => inventedFigures(String(p._def.resolver ?? '')).length > 0)
      .map(([path]) => path);
    expect(found, 'the known fabricators have moved or gone').toContain('org.loadSampleDeal');
    expect(found).toContain('integrations.sync');
  });

  it('every one of them is either gated or named a sample', () => {
    const loose = procedures()
      .filter(([, p]) => inventedFigures(String(p._def.resolver ?? '')).length > 0)
      .filter(([, p]) => !sanctioned(String(p._def.resolver ?? '')))
      .map(([path, p]) => `${path}: ${[...new Set(inventedFigures(String(p._def.resolver ?? '')))].join(', ')}`);
    expect(
      loose,
      'A figure this server chose is either behind demoFallbacksAllowed() — a decision the deployment took — or '
        + `written into rows that say SAMPLE. The absence of a credential is not consent.\n  ${loose.join('\n  ')}`,
    ).toEqual([]);
  });

  describe('the matcher itself', () => {
    it('finds an invented rate', () => {
      expect(inventedFigures('await prisma.comparable.create({ data: { basePsf: 212 } });')).toEqual(['basePsf: 212']);
    });

    /**
     * The one exclusion, and why it is a rule. A plan opening at nothing spent
     * is a fact about a scheme that has not started, not a guess at a price —
     * and without this the two cost procedures are permanent false positives,
     * which is how a sweep's list stops being read.
     */
    it('does not call a zero initialisation an invented figure', () => {
      expect(inventedFigures('data: { budget, spent: 0 }')).toEqual([]);
    });

    it('does not read a comment about a rate as a rate', () => {
      expect(inventedFigures('// the old branch wrote basePsf: 212 here\nconst x = 1;')).toEqual([]);
    });

    it('counts a gate, and a sample name, as sanction — and nothing else', () => {
      expect(sanctioned('if (!demoFallbacksAllowed()) throw x;')).toBe(true);
      expect(sanctioned("address: 'SAMPLE — Unit 4'")).toBe(true);
      expect(sanctioned("address: 'Unit 4, Roundways Trade Park'")).toBe(false);
      // a comment promising a sample is not a row that says so
      expect(sanctioned('/** these are Sample rows */\naddress: x')).toBe(false);
    });
  });
});

/* --------------------- driven through the product --------------------- */

let T: Tenant;
const caller = () => callerFor(T.principal);
const was = process.env.NODE_ENV;
const DEMO = process.env.DEMO_MODE;

const inProduction = <T,>(fn: () => Promise<T>) =>
  (async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_MODE;
    try {
      return await fn();
    } finally {
      if (was === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = was;
      if (DEMO === undefined) delete process.env.DEMO_MODE;
      else process.env.DEMO_MODE = DEMO;
    }
  })();

beforeAll(async () => {
  resetDatabase();
  T = await makeTenant('Invented');
}, 120_000);

describe('a provider this server cannot contact cannot be connected', () => {
  it('refuses each of the four, and says what does the job instead', async () => {
    const none = INTEGRATION_PROVIDERS.filter((p) => !INTEGRATION_CONNECTORS[p].connects);
    expect(none, 'the table claims a connector for everything, which was the defect').not.toHaveLength(0);
    for (const provider of none) {
      await expect(
        caller().integrations.connect(provider as never),
        `${provider} was connected with nothing behind it`,
      ).rejects.toThrow(/has no connector on this server/);
    }
    expect(await prisma.integrationConnection.count({ where: { orgId: T.orgId } })).toBe(0);
  });

  it('still connects every provider there IS a connector for', async () => {
    const live = INTEGRATION_PROVIDERS.filter((p) => INTEGRATION_CONNECTORS[p].connects);
    expect(live.length, 'nothing is connectable, so the refusal above proves nothing').toBeGreaterThanOrEqual(5);
    for (const provider of live) await caller().integrations.connect(provider as never);
    expect(await prisma.integrationConnection.count({ where: { orgId: T.orgId, status: 'CONNECTED' } })).toBe(live.length);
  });

  /**
   * The table is not allowed to claim a connector in prose alone. Every provider
   * marked `connects` names where its data arrives, and every one that does not
   * names what the firm should use instead — because a card reading "not
   * available" with no alternative is a dead end, and in each case this product
   * already does the job.
   */
  it('says, for every provider, either what it feeds or what to use instead', () => {
    for (const provider of INTEGRATION_PROVIDERS) {
      const c = INTEGRATION_CONNECTORS[provider as IntegrationProvider];
      if (c.connects) expect(c.feeds.length, `${provider} claims a connector and names no outcome`).toBeGreaterThan(10);
      else expect(c.instead.length, `${provider} is a dead end with no alternative`).toBeGreaterThan(40);
    }
  });
});

describe('a sync writes real rows or none', () => {
  let dealId = '';

  beforeAll(async () => {
    dealId = T.dealId;
    await prisma.deal.update({ where: { id: dealId }, data: { postcode: '' } });
  });

  /** The whole defect, at the procedure. */
  it('refuses to invent comparables in production rather than filing figures nobody can source', async () => {
    await inProduction(async () => {
      await expect(caller().integrations.sync({ provider: 'HM Land Registry', dealId } as never)).rejects.toThrow(
        /no postcode|Nothing has been added/i,
      );
    });
    expect(
      await prisma.comparable.count({ where: { dealId } }),
      'a comparable was invented onto a deal in production',
    ).toBe(0);
  });

  /**
   * And in a demo it still works, because a feature that cannot be exercised is
   * a feature nobody tests — but every row it writes says so in the ADDRESS, not
   * only at the end of a meta string, since the address is the column the
   * comparables table leads with.
   */
  it('marks every sample row it does write, in the column the table leads with', async () => {
    const res = (await caller().integrations.sync({ provider: 'HM Land Registry', dealId } as never)) as {
      created: string;
    };
    expect(res.created).toMatch(/SAMPLE/);
    const comps = await prisma.comparable.findMany({ where: { dealId } });
    expect(comps.length).toBeGreaterThan(0);
    for (const c of comps) {
      expect(c.address, `an invented comparable reads as evidence: ${c.address}`).toMatch(/SAMPLE/);
      expect(c.meta).toMatch(/not evidence/);
    }
  });

  /**
   * EPC's branch is gone rather than gated: it wrote a Document row for a
   * certificate PDF that did not exist, so the data room listed a file the
   * viewer could not open and a plot could be shared with it. The records are
   * live on the site pack and the sync added nothing but the dangling row.
   */
  it('does not offer a sync for a provider whose sync was a document with no file', async () => {
    await expect(caller().integrations.sync({ provider: 'EPC Register', dealId } as never)).rejects.toThrow(
      /does not sync onto a deal/,
    );
    expect(await prisma.document.count({ where: { dealId, name: { contains: 'EPC certificate' } } })).toBe(0);
  });

  it('refuses a sync for a provider with no connector at all', async () => {
    await expect(caller().integrations.sync({ provider: 'PriceHubble AVM', dealId } as never)).rejects.toThrow(
      /has no connector on this server/,
    );
  });

  /** Nothing in the table may claim a sync without a branch behind it. */
  it('has a branch for every provider the table says syncs', async () => {
    const syncing = INTEGRATION_PROVIDERS.filter((p) => {
      const c = INTEGRATION_CONNECTORS[p as IntegrationProvider];
      return c.connects && c.syncs;
    });
    expect(syncing).toEqual(['HM Land Registry']);
  });
});
