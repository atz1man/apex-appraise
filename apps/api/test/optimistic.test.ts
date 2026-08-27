import { describe, expect, it } from 'vitest';
import { assertUnchanged } from '../src/optimistic.js';

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
