import { describe, expect, it } from 'vitest';
import { reviewedUnits } from './extraction-review';
const original = [
  { label: 'Apartment', count: 2, area: 750, value: 400, source: 'Schedule.xlsx, Units!C4', conf: 'high' as const },
];
describe('extraction review provenance', () => {
  it('preserves unedited source evidence without promoting confidence', () => {
    expect(reviewedUnits(original, structuredClone(original))).toEqual(original);
  });
  it('labels a correction separately from the original evidence', () => {
    const result = reviewedUnits(original, [{ ...original[0], area: 800 }]);
    expect(result[0]).toMatchObject({
      area: 800,
      conf: 'low',
      source: 'User-corrected input. Previous source: Schedule.xlsx, Units!C4',
    });
    expect(original[0].area).toBe(750);
  });
  it.each([{ count: 1.5 }, { area: NaN }, { value: -2 }, { label: '  ' }])(
    'refuses invalid corrections %j',
    (patch) => {
      expect(() => reviewedUnits(original, [{ ...original[0], ...patch }])).toThrow(/Unit 1/);
    },
  );
});
