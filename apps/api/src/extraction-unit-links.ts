import { TRPCError } from '@trpc/server';
import type { AppraisalInputDto } from '@apex/types';

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
