import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { assertUnchanged, retryOnSerialisationFailure } from '../src/optimistic.js';

/**
 * The shared stamp check, on its own.
 *
 * The three procedures that use it each prove it against a real row; this
 * proves the properties none of them can see from the outside — chiefly that
 * looking up who touched the row last costs nothing on the ordinary save.
 */

const at = (ms: number) => new Date(ms);

describe('assertUnchanged', () => {
  it('lets a save through when the stamps agree', async () => {
    await expect(assertUnchanged({ what: 'thing', current: at(1_000), expected: at(1_000), advice: 'Reload.' })).resolves.toBeUndefined();
  });

  it('demands the stamp rather than treating its absence as agreement', async () => {
    // an optional token would silently reopen the hole for whichever caller
    // forgets next, and a caller that forgets has no idea it is overwriting
    await expect(
      assertUnchanged({ what: 'inspection', current: at(1_000), expected: undefined, advice: 'Reload.' }),
    ).rejects.toThrow(/needs expectedUpdatedAt/);
  });

  it('refuses either direction, not just a stamp that is older', async () => {
    // a clock that went backwards, or a caller replaying a stamp from a row it
    // never loaded, is still not the row in front of it
    await expect(assertUnchanged({ what: 'thing', current: at(2_000), expected: at(1_000), advice: 'Reload.' })).rejects.toThrow(/after you opened it/);
    await expect(assertUnchanged({ what: 'thing', current: at(1_000), expected: at(2_000), advice: 'Reload.' })).rejects.toThrow(/after you opened it/);
  });

  it('names who touched it last, and says what to do about it', async () => {
    await expect(
      assertUnchanged({
        what: 'inspection',
        current: at(2_000),
        expected: at(1_000),
        lastActor: async () => 'Priya Raman',
        advice: 'Reload to see the current notes before saving yours.',
      }),
    ).rejects.toThrow('This inspection was saved by Priya Raman after you opened it. Reload to see the current notes before saving yours.');
  });

  it('does not look up that name on a save that succeeds', async () => {
    // the lookup is another round trip, and it exists to print a sentence only
    // a refusal ever shows. Every ordinary save paying for it is the kind of
    // cost a refactor adds quietly and nobody measures.
    let asked = 0;
    await assertUnchanged({
      what: 'thing',
      current: at(1_000),
      expected: at(1_000),
      lastActor: async () => {
        asked += 1;
        return 'Nobody';
      },
      advice: 'Reload.',
    });
    expect(asked).toBe(0);
  });

  it('says nothing about a name it could not find', async () => {
    // an unattributed row must not read "was saved by null"
    await expect(
      assertUnchanged({ what: 'plot', current: at(2_000), expected: at(1_000), lastActor: async () => null, advice: 'Reload.' }),
    ).rejects.toThrow(/^This plot was saved after you opened it\./);
  });
});

/**
 * A serialisable transaction the database threw out, and what that means.
 *
 * Postgres does not block the loser of a serialisable conflict; it aborts one
 * with SQLSTATE 40001, which Prisma reports as P2034. `appraisal.save` read that
 * abort as proof somebody else had saved the first version of the appraisal.
 * That is true when there WAS somebody else and wrong the rest of the time:
 * Serialisable Snapshot Isolation aborts on the possibility of a cycle rather
 * than a proven one, so two saves on two unrelated deals abort each other under
 * load.
 *
 * Found by CI, not by reading. A browser test created a deal of its own, saved
 * the first appraisal on it, and was told somebody else had got there first — on
 * an id no other test had ever seen. No transaction existed that could have
 * raced it, so the abort cannot have been a real conflict.
 */
describe('a transaction the database aborted to stay serialisable', () => {
  const p2034 = () => Object.assign(new Error('write conflict'), { code: 'P2034' });
  /**
   * Yields to the event loop rather than returning instantly.
   *
   * A no-op sleep makes the retry loop hot, so a version of this helper with no
   * attempt bound starves the timers and vitest's own timeout never fires — the
   * run hangs instead of failing, which is the worst way for a test to catch
   * something. Measured: driving that mutation with `async () => {}` hung the
   * suite until it was killed from outside.
   */
  const noSleep = () => new Promise<void>((r) => setImmediate(r));

  it('takes it again rather than passing the abort on', async () => {
    let calls = 0;
    const out = await retryOnSerialisationFailure(async () => {
      calls++;
      if (calls < 3) throw p2034();
      return 'saved';
    }, { sleep: noSleep });
    expect(out).toBe('saved');
    expect(calls).toBe(3);
  });

  it('gives up eventually rather than retrying for ever', { timeout: 5_000 }, async () => {
    let calls = 0;
    await expect(
      retryOnSerialisationFailure(async () => {
        calls++;
        throw p2034();
      }, { attempts: 4, sleep: noSleep }),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(calls).toBe(4);
  });

  /**
   * The half that keeps the invariant. A refusal thrown from INSIDE the
   * transaction is this application saying no on purpose — a real race, a stale
   * stamp — and repeating it would turn one considered refusal into four
   * attempts at the same write.
   */
  it('never retries a refusal the application made itself', async () => {
    let calls = 0;
    await expect(
      retryOnSerialisationFailure(async () => {
        calls++;
        throw new TRPCError({ code: 'CONFLICT', message: 'Somebody else saved the first version' });
      }, { sleep: noSleep }),
    ).rejects.toThrow(/first version/);
    expect(calls, 'a deliberate CONFLICT was retried as though it were contention').toBe(1);
  });

  it('does not retry an ordinary fault either', async () => {
    let calls = 0;
    await expect(
      retryOnSerialisationFailure(async () => {
        calls++;
        throw new Error('the database is on fire');
      }, { sleep: noSleep }),
    ).rejects.toThrow(/on fire/);
    expect(calls).toBe(1);
  });

  it('does not sleep at all when the first attempt works', async () => {
    let slept = 0;
    const out = await retryOnSerialisationFailure(async () => 'fine', { sleep: async () => { slept++; } });
    expect(out).toBe('fine');
    expect(slept).toBe(0);
  });
});
