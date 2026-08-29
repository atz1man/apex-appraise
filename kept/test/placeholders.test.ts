import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedReceipts } from '../src/lib/seed';

/**
 * An example in an empty field must not also be a row in the list.
 *
 * The Add screen's item box read "Wool-blend overcoat" — which is the seeded
 * Zara receipt, sitting three taps away on the very same install. Greyed
 * placeholder text in a form the app has just filled in for you reads as
 * something the app filled in: on a fresh install the person is looking at a
 * suggestion and a receipt with the same name and no way to tell which one
 * they are being shown.
 *
 * Walks the screens rather than a list of known placeholders, so a new form
 * borrowing the seed's wording is caught the day it is written.
 */
const SCREENS = join(__dirname, '..', 'src', 'app', 'screens');
const TODAY = new Date(2026, 7, 28);

const placeholders = (): { file: string; text: string }[] => {
  const out: { file: string; text: string }[] = [];
  for (const file of readdirSync(SCREENS).filter((f) => f.endsWith('.tsx'))) {
    const src = readFileSync(join(SCREENS, file), 'utf8');
    for (const m of src.matchAll(/placeholder="([^"]+)"/g)) out.push({ file, text: m[1] });
  }
  return out;
};

describe('form placeholders', () => {
  it('finds the placeholders it is meant to be checking', () => {
    // A sweep over nothing passes silently, reporting success for a question
    // it never asked.
    expect(placeholders().length).toBeGreaterThanOrEqual(5);
  });

  it('never borrows the wording of a receipt the app itself creates', () => {
    const seeded = new Set(seedReceipts(TODAY).flatMap((r) => [r.item.toLowerCase(), r.store.toLowerCase()]));
    const clashes = placeholders().filter((p) =>
      p.text
        .split(/[·…]/)
        .map((part) => part.trim().toLowerCase())
        .some((part) => seeded.has(part)),
    );
    expect(clashes).toEqual([]);
  });
});
