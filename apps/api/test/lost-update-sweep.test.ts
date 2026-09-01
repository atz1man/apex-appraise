import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { appRouter } from '../src/router.js';

/**
 * Every mutation that writes back a row somebody was holding.
 *
 * This branch has now found the same defect SIX times, each by hand, each fixed
 * where it was found: the appraisal workfile (`b39f174`), the phone/desk
 * inspection handoff (`81c398b`), the sales drawer (`a48b7b3`), the terms of
 * engagement (`a4b516d`), the firm's standing wording (`7a64140`), and the cost
 * monitor's contractor dropdown (`7dd1415`). The shape is always the same: a
 * screen loads a row, holds it, and posts every field back — so the second
 * writer silently restores whatever the first changed.
 *
 * Six is enough. This walks the real router and requires every procedure that
 * can update an existing row to have answered the question one of two ways.
 *
 * **A stamp.** Take `expectedUpdatedAt` and call `assertUnchanged`, which
 * refuses a write built on a copy somebody else has already changed.
 *
 * **Patch semantics.** Make every value field optional and write only what was
 * supplied, so there is nothing held to clobber. Better where it applies — a
 * stamp DETECTS the collision and asks the user to reload, while a patch means
 * two people editing different columns both simply land.
 *
 * A default on a patchable field silently undoes the second: zod materialises
 * the key, so a "partial" write carries it after all. Measured — adding
 * `.default(0)` to one comparable adjustment reverted another valuer's
 * adjustment to zero, which is the original defect exactly. So this checks for
 * that too.
 */

type Proc = { _def: { type: 'query' | 'mutation'; inputs?: z.ZodTypeAny[]; resolver?: unknown } };
const procedures = () => (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures;

const mutations = () => Object.entries(procedures()).filter(([, p]) => p._def.type === 'mutation');

/** does the resolver update an existing row of any model? */
const updatesARow = (src: string) => /prisma\.\w+\.(update|updateMany|upsert)\(/.test(src);

const unwrap = (schema: z.ZodTypeAny | undefined): z.ZodTypeAny | undefined => {
  const def = (schema as unknown as { _def: Record<string, any> })?._def;
  if (!def) return undefined;
  if (['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(def.typeName)) return unwrap(def.innerType);
  if (def.typeName === 'ZodEffects') return unwrap(def.schema);
  return schema;
};

/** the fields a caller could be merely HOLDING — ids and stamps are not */
const heldFields = (schema: z.ZodTypeAny | undefined): Array<[string, z.ZodTypeAny]> => {
  const s = unwrap(schema);
  const def = (s as unknown as { _def: Record<string, any> })?._def;
  if (def?.typeName !== 'ZodObject') return [];
  // ids and the stamp only. Anything else is a judgement, and a judgement
  // belongs in HOLDS_NOTHING where somebody has to write it down — not hidden
  // in the walker where it would quietly exempt whole procedures.
  return Object.entries(def.shape() as Record<string, z.ZodTypeAny>).filter(
    ([k]) => !/^(id|.*Id|expectedUpdatedAt)$/.test(k),
  );
};

const isOptional = (f: z.ZodTypeAny) => {
  const t = (f as unknown as { _def: { typeName: string } })._def.typeName;
  return t === 'ZodOptional' || t === 'ZodNullable' || t === 'ZodDefault';
};
const hasDefault = (f: z.ZodTypeAny) => {
  const def = (f as unknown as { _def: Record<string, any> })._def;
  if (def.typeName === 'ZodDefault') return true;
  if (def.typeName === 'ZodOptional' || def.typeName === 'ZodNullable') return hasDefault(def.innerType);
  return false;
};

/**
 * Procedures that update a row but hold nothing, each with the reason.
 *
 * The bar is that the caller cannot be carrying a stale copy of anything — it
 * sends a decision, a token, or values it has just typed with nothing loaded
 * behind them. A new entry is a judgement somebody has to write down, which is
 * the point: all six defects above were a judgement nobody made.
 */
const HOLDS_NOTHING: Record<string, string> = {
  'auth.ssoComplete':
    'an authorisation code and the state that was minted with it — received during the flow, never read off a row.',
  'auth.resetPassword':
    'a reset token from the emailed link and a password typed into the box beside it.',
  'auth.changePassword':
    'the current and new passwords, both typed now. Nothing was loaded to go stale.',
  'engagement.sign':
    'a signing token from the client’s link, the name they type, and the box they tick.',
  'bank.complete':
    'a PSD2 consent code and its state, exchanged with the provider during the call.',
  'xero.complete':
    'an OAuth code and its state, exchanged with Xero during the call.',
  'integrations.saveCredentials':
    'a provider name and the key an admin pastes, validated against the live upstream before it is stored. The key is never returned, so it cannot have been loaded.',
  'autoAppraisal.extract':
    'notes pasted now and document ids. Its defaults are inputs to the extraction it runs, not columns of a row being written back.',
};

describe('the sweep itself', () => {
  it('finds the procedures that update a row, from the real resolvers', () => {
    const writers = mutations().filter(([, p]) => updatesARow(String(p._def.resolver ?? '')));
    expect(writers.length, 'no row-updating mutation was found — the walk is broken').toBeGreaterThan(30);
  });

  it('has no stale entries', () => {
    const writers = new Set(
      mutations().filter(([, p]) => updatesARow(String(p._def.resolver ?? ''))).map(([path]) => path),
    );
    const stale = Object.keys(HOLDS_NOTHING).filter((p) => !writers.has(p));
    expect(stale, `declared as holding nothing, but they no longer update a row: ${stale.join(', ')}`).toEqual([]);
    const unreasoned = Object.entries(HOLDS_NOTHING).filter(([, why]) => why.trim().length < 25);
    expect(unreasoned.map(([p]) => p), 'an entry needs a reason, not a placeholder').toEqual([]);
  });
});

describe('every mutation that writes back a row somebody was holding', () => {
  it('either takes a stamp or is a patch', () => {
    const failures: string[] = [];

    for (const [path, p] of mutations()) {
      const src = String(p._def.resolver ?? '');
      if (!updatesARow(src) || path in HOLDS_NOTHING) continue;

      const held = heldFields(p._def.inputs?.[0]);
      if (!held.length) continue;

      const stamped = /assertUnchanged\(/.test(src);
      if (stamped) continue;

      /**
       * A default is checked FIRST, and regardless of how much is held.
       *
       * Zod materialises a defaulted key, so a field that looks optional is
       * present in every parsed input and the "partial" write carries it after
       * all. Measured: `.default(0)` on one comparable adjustment reverted
       * another valuer's adjustment to zero — the original defect exactly.
       * Checking it after the size test below would skip it on precisely the
       * procedures a default makes unsafe, because a default also makes the
       * field read as optional.
       */
      /**
       * Into nested objects as well. `deals.update` and the registers take
       * `{ id, patch: { … } }`, and a default on a member of `patch` is the
       * same defect one level down — zod materialises it, the "partial" write
       * carries it, and a colleague's contact name goes back to ''. The
       * top-level check alone let exactly that through; measured, by adding
       * `.default('')` to `investors.update`'s patch and watching this pass.
       */
      const defaultedWithin = (f: z.ZodTypeAny): string[] => {
        const inner = unwrap(f);
        const d = (inner as unknown as { _def: Record<string, any> })?._def;
        if (d?.typeName !== 'ZodObject') return [];
        return Object.entries(d.shape() as Record<string, z.ZodTypeAny>)
          .filter(([, v]) => hasDefault(v))
          .map(([k]) => k);
      };
      const defaulted = held.flatMap(([k, f]) => (hasDefault(f) ? [k] : defaultedWithin(f).map((m) => `${k}.${m}`)));
      if (defaulted.length) {
        failures.push(
          `${path}: patch-shaped, but ${defaulted.join(', ')} carry a default — zod materialises those, `
            + 'so the write is a whole-row write again',
        );
        continue;
      }

      /**
       * One held VALUE cannot clobber a value you did not touch.
       *
       * The defect is always writing back values the caller never changed, so a
       * procedure that writes exactly one writes the thing the user actually
       * did. Two administrators renaming a workspace is last-write-wins, and
       * that is what renaming means; two administrators saving a five-field
       * form is one of them losing four they never looked at.
       *
       * Values, not fields. `engagement.save` holds ONE field — `terms` — and
       * nineteen values inside it, which is the largest instance of this defect
       * on the branch. Counting fields let it through; measured, by removing its
       * stamp and watching this pass.
       */
      const weight = (f: z.ZodTypeAny): number => {
        const inner = unwrap(f);
        const d = (inner as unknown as { _def: Record<string, any> })?._def;
        if (d?.typeName !== 'ZodObject') return 1;
        /**
         * Only the REQUIRED members. A nested object whose every member is
         * optional IS a patch — `deals.update` sends exactly the keys that
         * changed, which is the shape the rest of this class was moved to, and
         * counting its five optional members would have flagged the one
         * procedure that had this right from the start.
         */
        return Object.values(d.shape() as Record<string, z.ZodTypeAny>).filter((v) => !isOptional(v)).length;
      };
      const required = held.filter(([, f]) => !isOptional(f));
      const heldValues = required.reduce((n, [, f]) => n + weight(f), 0);
      if (heldValues <= 1) continue;

      failures.push(
        `${path}: writes back ${heldValues} held value(s) with no stamp `
          + `(${required.map(([k]) => k).join(', ')}) — so a caller must send values it was merely holding`,
      );
    }

    expect(
      failures,
      'Take expectedUpdatedAt and call assertUnchanged, or make every value field optional and write only what was '
        + `supplied. If the caller genuinely holds nothing, add it to HOLDS_NOTHING with the reason.\n  ${failures.join('\n  ')}`,
    ).toEqual([]);
  });
});
