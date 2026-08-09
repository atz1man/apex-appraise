import type { AppraisalInput } from './types.js';

/**
 * What changed between two versions of an appraisal.
 *
 * The question this answers is the first one asked in any valuation review, and
 * the one a PI insurer asks afterwards: the build rate moved from £150 to £120 —
 * who moved it, and what did it do to the answer?
 *
 * It diffs the ENGINE INPUTS rather than database columns. Those are the terms a
 * valuer argues in, and they do not change when storage does. It is also derived
 * entirely from the two versions themselves — there is no change log to fall out
 * of step with the data, because a diff computed from the data cannot lie about
 * the data.
 */

export type ChangeKind = 'changed' | 'added' | 'removed';

export interface FieldChange {
  /** dotted path, e.g. "finance.ratePct" or "trades.Piling & basement" */
  path: string;
  /** how a valuer would say it */
  label: string;
  kind: ChangeKind;
  before: number | string | null;
  after: number | string | null;
  /** how to render the values: a rate, a percentage, money in £, a count, or free text */
  unit: 'pct' | 'money' | 'psf' | 'months' | 'number' | 'text';
}

export interface AppraisalDiff {
  changes: FieldChange[];
  /** true when the two versions carry identical inputs */
  identical: boolean;
}

interface ScalarSpec {
  path: string;
  label: string;
  unit: FieldChange['unit'];
  get: (i: AppraisalInput) => number | undefined;
}

/**
 * The scalars worth reporting, in the order a reviewer reads them: what we build,
 * what it costs, how it is funded, what it sells for.
 */
const SCALARS: ScalarSpec[] = [
  { path: 'efficiency', label: 'Efficiency (NIA:GIA)', unit: 'pct', get: (i) => i.efficiency },
  { path: 'profFeePct', label: 'Professional fees', unit: 'pct', get: (i) => i.profFeePct },
  { path: 'contingencyPct', label: 'Contingency', unit: 'pct', get: (i) => i.contingencyPct },
  { path: 'finance.ltcPct', label: 'Loan to cost', unit: 'pct', get: (i) => i.finance.ltcPct },
  { path: 'finance.ratePct', label: 'Finance rate', unit: 'pct', get: (i) => i.finance.ratePct },
  { path: 'finance.periodMonths', label: 'Build programme', unit: 'months', get: (i) => i.finance.periodMonths },
  { path: 'finance.salesMonths', label: 'Sales period', unit: 'months', get: (i) => i.finance.salesMonths },
  { path: 'finance.arrangementFeePct', label: 'Arrangement fee', unit: 'pct', get: (i) => i.finance.arrangementFeePct },
  { path: 'finance.absorptionUnitsPerMonth', label: 'Absorption', unit: 'number', get: (i) => i.finance.absorptionUnitsPerMonth },
  { path: 'site.landFixed', label: 'Fixed land price', unit: 'money', get: (i) => i.site.landFixed },
  { path: 'site.acqPct', label: 'Acquisition costs', unit: 'pct', get: (i) => i.site.acqPct },
  { path: 'disposal.agentPct', label: 'Agent fee', unit: 'pct', get: (i) => i.disposal.agentPct },
  { path: 'disposal.legalPct', label: 'Legal fee', unit: 'pct', get: (i) => i.disposal.legalPct },
  { path: 'targetProfitOnGdvPct', label: 'Target profit on GDV', unit: 'pct', get: (i) => i.targetProfitOnGdvPct },
];

const near = (a?: number, b?: number) => {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  // a rate stored as 7.5 and re-entered as 7.50000001 is not a change anyone made
  return Math.abs(a - b) < 1e-9;
};

/** Compare two label-keyed collections, reporting added, removed and changed lines. */
function diffByLabel<T>(
  before: T[],
  after: T[],
  opts: {
    prefix: string;
    labelOf: (t: T) => string;
    valueOf: (t: T) => number;
    unit: FieldChange['unit'];
    describe: string;
  },
): FieldChange[] {
  const out: FieldChange[] = [];
  const b = new Map(before.map((x) => [opts.labelOf(x), opts.valueOf(x)]));
  const a = new Map(after.map((x) => [opts.labelOf(x), opts.valueOf(x)]));
  // union, preserving the order a reader would scan: existing lines first, then new
  for (const [label, bv] of b) {
    const path = `${opts.prefix}.${label}`;
    if (!a.has(label)) {
      out.push({ path, label: `${opts.describe} — ${label}`, kind: 'removed', before: bv, after: null, unit: opts.unit });
    } else if (!near(bv, a.get(label))) {
      out.push({ path, label: `${opts.describe} — ${label}`, kind: 'changed', before: bv, after: a.get(label)!, unit: opts.unit });
    }
  }
  for (const [label, av] of a) {
    if (!b.has(label)) {
      out.push({
        path: `${opts.prefix}.${label}`,
        label: `${opts.describe} — ${label}`,
        kind: 'added',
        before: null,
        after: av,
        unit: opts.unit,
      });
    }
  }
  return out;
}

export function compareAppraisals(before: AppraisalInput, after: AppraisalInput): AppraisalDiff {
  const changes: FieldChange[] = [];

  for (const s of SCALARS) {
    const b = s.get(before);
    const a = s.get(after);
    if (near(b, a)) continue;
    changes.push({
      path: s.path,
      label: s.label,
      kind: b === undefined ? 'added' : a === undefined ? 'removed' : 'changed',
      before: b ?? null,
      after: a ?? null,
      unit: s.unit,
    });
  }

  // Units: the revenue side. A unit's value to the scheme is count × area × £/ft²,
  // but a reviewer wants to see WHICH of those moved, so report the rate and the
  // count separately rather than a single derived total.
  changes.push(
    ...diffByLabel(before.units, after.units, {
      prefix: 'units.cap',
      labelOf: (u) => u.label,
      valueOf: (u) => u.cap,
      unit: 'psf',
      describe: 'Unit value',
    }),
    ...diffByLabel(before.units, after.units, {
      prefix: 'units.count',
      labelOf: (u) => u.label,
      valueOf: (u) => u.count,
      unit: 'number',
      describe: 'Unit count',
    }),
    ...diffByLabel(before.trades, after.trades, {
      prefix: 'trades',
      labelOf: (t) => t.label,
      valueOf: (t) => t.rate,
      unit: 'psf',
      describe: 'Trade',
    }),
    ...diffByLabel(before.otherCosts, after.otherCosts, {
      prefix: 'otherCosts',
      labelOf: (o) => o.label,
      valueOf: (o) => o.amount,
      unit: 'money',
      describe: 'Other cost',
    }),
  );

  // Phasing and the rent roll are reported as presence changes: their internals
  // are large, and "the scheme was rephased" is the fact a reviewer needs before
  // deciding to look. Overstating detail here would bury the scalars above.
  const phaseCount = (i: AppraisalInput) => i.phases?.length ?? 0;
  if (phaseCount(before) !== phaseCount(after)) {
    changes.push({
      path: 'phases',
      label: 'Phases',
      kind: 'changed',
      before: phaseCount(before),
      after: phaseCount(after),
      unit: 'number',
    });
  }
  const rentLines = (i: AppraisalInput) => i.income?.lines.length ?? 0;
  if (rentLines(before) !== rentLines(after)) {
    changes.push({
      path: 'income.lines',
      label: 'Rent roll lines',
      kind: 'changed',
      before: rentLines(before),
      after: rentLines(after),
      unit: 'number',
    });
  }
  const yieldOf = (i: AppraisalInput) => i.income?.yieldPct;
  if (!near(yieldOf(before), yieldOf(after))) {
    changes.push({
      path: 'income.yieldPct',
      label: 'All-risks yield',
      kind: yieldOf(before) === undefined ? 'added' : yieldOf(after) === undefined ? 'removed' : 'changed',
      before: yieldOf(before) ?? null,
      after: yieldOf(after) ?? null,
      unit: 'pct',
    });
  }

  return { changes, identical: changes.length === 0 };
}
