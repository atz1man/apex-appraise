import { zExtraction } from '@apex/types';
import { describe, expect, it } from 'vitest';
import { reviewedUnits, reviewedScheme, schemeAssumptions } from './extraction-review';
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
    expect(reviewedUnits(result, [{ ...result[0], area: 850 }])[0].source).toBe(result[0].source);
  });
  it.each([{ count: 1.5 }, { area: NaN }, { value: -2 }, { label: '  ' }])(
    'refuses invalid corrections %j',
    (patch) => {
      expect(() => reviewedUnits(original, [{ ...original[0], ...patch }])).toThrow(/Unit 1/);
    },
  );
});

describe('scheme assumption review', () => {
  const extraction = zExtraction.parse({ units: original, sample: true, planningNotes: 'Check conditions' });
  it('preserves source limitations and applies reviewed assumptions without mutating the original', async () => {
    const draft = schemeAssumptions(extraction, 105);
    draft.buildPerSqft = 125;
    draft.efficiency = 85;
    draft.s106 = 32000;
    draft.finance.rate = 9;
    const result = await reviewedScheme(extraction, draft);
    expect(result.buildPerSqft).toBe(125);
    expect(result.extraction).toMatchObject({ efficiency: 85, s106: 32000, finance: { rate: 9 }, sample: true, planningNotes: 'Check conditions', units: original });
    expect(extraction.finance.rate).toBe(7.5);
    expect(extraction.efficiency).toBe(90);
  });
  it.each([
    { buildPerSqft: 0 }, { efficiency: 0 }, { efficiency: 121 },
    { asking: -1 }, { cilPerSqm: Infinity }, { s106: -1 },
    { profFee: 51 }, { contingency: -1 }, { targetProfit: 61 },
    { acq: 31 }, { agent: 11 }, { legal: NaN },
  ])('refuses an invalid scheme assumption %j', async patch => {
    await expect(reviewedScheme(extraction, { ...schemeAssumptions(extraction, 105), ...patch })).rejects.toThrow();
  });
  it.each([{ period: 1.5 }, { period: 61 }, { sales: 0 }, { sales: 25 }, { ltc: 101 }, { rate: 41 }, { arrFee: 11 }])('refuses invalid finance %j', async patch => {
    const draft = schemeAssumptions(extraction, 105);
    draft.finance = { ...draft.finance, ...patch };
    await expect(reviewedScheme(extraction, draft)).rejects.toThrow();
  });
});
