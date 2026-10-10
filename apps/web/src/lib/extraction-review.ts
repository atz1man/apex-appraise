import type { Extraction } from '@apex/types';

/** Keep model citations distinct from the reviewer's corrections. No calculations here. */
export function reviewedUnits(original: Extraction['units'], draft: Extraction['units']): Extraction['units'] {
  if (!draft.length || draft.length !== original.length) throw new Error('Review every extracted unit.');
  return draft.map((unit, index) => {
    if (
      !unit.label.trim() ||
      !Number.isInteger(unit.count) ||
      unit.count <= 0 ||
      !Number.isFinite(unit.area) ||
      unit.area <= 0 ||
      !Number.isFinite(unit.value) ||
      unit.value <= 0
    ) {
      throw new Error(`Unit ${index + 1}: enter a name, positive whole count, area and value.`);
    }
    const before = original[index];
    const changed =
      unit.label !== before.label ||
      unit.count !== before.count ||
      unit.area !== before.area ||
      unit.value !== before.value;
    return {
      ...unit,
      source: changed && !before.source.startsWith('User-corrected input. Previous source: ')
        ? `User-corrected input. Previous source: ${before.source}` : before.source,
      conf: changed ? 'low' : before.conf,
    };
  });
}
