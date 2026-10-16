import { describe, expect, it } from 'vitest';
import { compareExtractionUnits } from '../src/extraction-unit-links.js';
const original = [
  { extractionUnitId: 'a', label: 'Flat', count: 2, area: 500, value: 300, conf: 'low' as const, source: 'Notes' },
  { extractionUnitId: 'b', label: 'Flat', count: 1, area: 600, value: 400, conf: 'med' as const, source: 'Notes' },
];
const saved = original.map(u => ({ extractionUnitId: u.extractionUnitId, label: u.label, count: u.count, area: u.area, cap: u.value }));
describe('recorded unit comparisons', () => {
  it('follows unique IDs through renamed and reordered rows without treating reordering as a value change', () => {
    const result = compareExtractionUnits(original, { units: [{ ...saved[1], label: 'Renamed', area: 700 }, saved[0]] });
    expect(result.rows[0]).toMatchObject({ originalRow: 1, savedRow: 2, changed: false });
    expect(result.rows[1]).toMatchObject({ originalRow: 2, savedRow: 1, changed: true, original: { area: 600 }, saved: { label: 'Renamed', area: 700 } });
  });
  it('does not pair matching names/values without IDs or unknown IDs', () => {
    const legacy = original.map(({ extractionUnitId, ...unit }) => unit);
    const result = compareExtractionUnits(legacy, { units: saved });
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every(row => row.changed === null)).toBe(true);
    expect(compareExtractionUnits(original, { units: [{ ...saved[0], extractionUnitId: 'unknown' }] }).rows).toHaveLength(3);
  });
  it('leaves duplicate original or saved identities unmatched rather than picking the first', () => {
    for (const result of [compareExtractionUnits([original[0], original[0]], { units: [saved[0]] }), compareExtractionUnits([original[0]], { units: [saved[0], saved[0]] })]) {
      expect(result.rows).toHaveLength(3);
      expect(result.rows.every(row => row.changed === null)).toBe(true);
    }
  });
  it('detects each changed input, including zero, and preserves unmatched originals and new saved rows', () => {
    for (const patch of [{ label: '' }, { count: 0 }, { area: 0 }, { cap: 0 }]) expect(compareExtractionUnits([original[0]], { units: [{ ...saved[0], ...patch }] }).rows[0].changed).toBe(true);
    const result = compareExtractionUnits(original, { units: [saved[1], { label: 'New', count: 1, area: 100, cap: 200 }] });
    expect(result.rows[0]).toMatchObject({ originalRow: 1, saved: null, changed: null });
    expect(result.rows[2]).toMatchObject({ savedRow: 2, original: null, changed: null });
    expect(compareExtractionUnits([], { units: [] }).rows).toEqual([]);
  });
  it('does not compare the inactive flat schedule of a phased appraisal', () => {
    expect(compareExtractionUnits(original, { units: saved, phases: [{ name: 'Phase', start: 1, buildMonths: 12, salesMonths: 3, units: [] }] })).toEqual({ state: 'phased', rows: [] });
  });
});
