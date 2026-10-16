import { TRPCError } from '@trpc/server';
import type { AppraisalInputDto, Extraction } from '@apex/types';

/** IDs record continuity, not source accuracy. Missing legacy links stay missing. */
export function assertExtractionUnitLinks(input: AppraisalInputDto, original: Array<{ label: string; extractionUnitId?: string }>) {
  const known = new Set(original.flatMap(unit => unit.extractionUnitId ? [unit.extractionUnitId] : []));
  const seen = new Set<string>();
  // Scope is the flat accommodation schedule; phased schedules have no extraction links.
  for (const unit of input.units) {
    const id = unit.extractionUnitId;
    if (!id) continue;
    if (!known.has(id) || seen.has(id)) throw new TRPCError({
      code: 'BAD_REQUEST', message: 'An extracted unit link is unknown or duplicated. Reload the appraisal or run extraction again before saving.',
    });
    seen.add(id);
  }
}

type UnitValues = { label: string; count: number; area: number; value: number };
type UnitComparisonRow = { originalRow: number | null; savedRow: number | null; original: UnitValues | null; saved: UnitValues | null; changed: boolean | null };
/** Match unique recorded IDs only. Names, ordering and similar values are not identity. */
export function compareExtractionUnits(original: Extraction['units'], input: Pick<AppraisalInputDto, 'units' | 'phases'>) {
  const rows: UnitComparisonRow[] = [];
  if (input.phases?.length) return { state: 'phased' as const, rows };
  const originalCounts = new Map<string, number>();
  const savedCounts = new Map<string, number>();
  for (const unit of original) if (unit.extractionUnitId) originalCounts.set(unit.extractionUnitId, (originalCounts.get(unit.extractionUnitId) ?? 0) + 1);
  for (const unit of input.units) if (unit.extractionUnitId) savedCounts.set(unit.extractionUnitId, (savedCounts.get(unit.extractionUnitId) ?? 0) + 1);
  const matched = new Set<number>();
  original.forEach((unit, index) => {
    const before = { label: unit.label, count: unit.count, area: unit.area, value: unit.value };
    const id = unit.extractionUnitId;
    const savedIndex = id && originalCounts.get(id) === 1 && savedCounts.get(id) === 1 ? input.units.findIndex(u => u.extractionUnitId === id) : -1;
    const current = input.units[savedIndex];
    const after = current ? { label: current.label, count: current.count, area: current.area, value: current.cap } : null;
    if (current) matched.add(savedIndex);
    rows.push({ originalRow: index + 1, savedRow: current ? savedIndex + 1 : null, original: before, saved: after,
      changed: after ? before.label !== after.label || before.count !== after.count || before.area !== after.area || before.value !== after.value : null });
  });
  input.units.forEach((unit, index) => {
    if (!matched.has(index)) rows.push({ originalRow: null, savedRow: index + 1, original: null,
      saved: { label: unit.label, count: unit.count, area: unit.area, value: unit.cap }, changed: null });
  });
  return { state: 'available' as const, rows };
}
