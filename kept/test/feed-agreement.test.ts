import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { seedUpdates } from '../src/lib/seed';
import { readFeed } from '../src/lib/policy-feed';

/**
 * The bundled fallback and the feed that is actually served have to say the
 * same thing.
 *
 * `seed.ts` exists so a first launch with no signal is not an empty Watch tab,
 * and it carries the SAME update ids as `public/policy-feed.json` on purpose,
 * so a merge replaces each one rather than showing it twice. The texts were
 * free to drift, and the consequence is small but silly: an update reads one
 * way before the feed lands and another way after, on the tab whose whole
 * point is telling you what changed.
 *
 * Everything but `changedOn` — the seed's dates are deliberately relative to
 * the day the app is opened, so a fresh install looks current.
 */
const TODAY = new Date(2026, 7, 28);

const served = readFeed(JSON.parse(readFileSync(new URL('../public/policy-feed.json', import.meta.url), 'utf8')));
const bundled = seedUpdates(TODAY);

describe('the bundled feed and the served one', () => {
  it('both parse', () => {
    expect(served).not.toBeNull();
    expect(served!.length).toBeGreaterThan(0);
    expect(bundled.length).toBeGreaterThan(0);
  });

  it('cover the same updates', () => {
    expect([...bundled.map((u) => u.id)].sort()).toEqual([...served!.map((u) => u.id)].sort());
  });

  it.each(bundled.map((u) => [u.id, u] as const))('say the same thing about %s', (id, mine) => {
    const theirs = served!.find((u) => u.id === id)!;
    const compare = ({ changedOn, ...rest }: typeof mine) => rest;
    expect(compare(mine)).toEqual(compare(theirs));
  });
});
