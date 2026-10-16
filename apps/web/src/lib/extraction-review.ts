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

/** Review assumptions against the same bounds the saved appraisal accepts. */
export type SchemeAssumptions = Pick<Extraction,
  'efficiency' | 'profFee' | 'contingency' | 'finance' | 'targetProfit' | 'asking' |
  'cilPerSqm' | 's106' | 'agent' | 'legal' | 'acq'> & { buildPerSqft: number };

export function schemeAssumptions(extraction: Extraction, buildPerSqft: number): SchemeAssumptions {
  const { efficiency, profFee, contingency, finance, targetProfit, asking, cilPerSqm, s106, agent, legal, acq } = extraction;
  return { efficiency, profFee, contingency, finance: { ...finance }, targetProfit, asking, cilPerSqm, s106, agent, legal, acq, buildPerSqft };
}

export async function reviewedScheme(original: Extraction, draft: SchemeAssumptions) {
  // Load the shared validators only when applying a review, not with the route.
  const { zAppraisalInput } = await import('@apex/types');
  const appraisal = zAppraisalInput.shape;
  const schemeRules = {
    efficiency: appraisal.efficiency,
    profFee: appraisal.profFeePct,
    contingency: appraisal.contingencyPct,
    targetProfit: appraisal.targetProfitOnGdvPct,
    asking: appraisal.site.shape.landFixed,
    cilPerSqm: appraisal.site.shape.landFixed,
    s106: appraisal.site.shape.landFixed,
    agent: appraisal.disposal.shape.agentPct,
    legal: appraisal.disposal.shape.legalPct,
    acq: appraisal.site.shape.acqPct,
    buildPerSqft: appraisal.site.shape.landFixed.positive(),
  };
  const financeRules = {
    ltc: appraisal.finance.shape.ltcPct,
    rate: appraisal.finance.shape.ratePct,
    period: appraisal.finance.shape.periodMonths.int(),
    sales: appraisal.finance.shape.salesMonths.int(),
    arrFee: appraisal.finance.shape.arrangementFeePct,
  };

  const labels = {
    efficiency: 'NIA / GIA efficiency', profFee: 'Professional fees', contingency: 'Contingency',
    targetProfit: 'Target profit on GDV', asking: 'Asking land price', cilPerSqm: 'CIL rate',
    s106: 'S106', agent: 'Agent fees', legal: 'Legal fees', acq: 'Acquisition costs', buildPerSqft: 'Build cost',
    ltc: 'Senior debt LTC', rate: 'Annual interest rate', period: 'Build period months',
    sales: 'Sales period months', arrFee: 'Arrangement fee',
  };
  for (const key of Object.keys(schemeRules) as Array<keyof typeof schemeRules>) {
    const result = schemeRules[key].finite().safeParse(draft[key]);
    if (!result.success) throw new Error(`${labels[key]}: ${result.error.issues[0].message}`);
  }
  for (const key of Object.keys(financeRules) as Array<keyof typeof financeRules>) {
    const result = financeRules[key].finite().safeParse(draft.finance[key]);
    if (!result.success) throw new Error(`${labels[key]}: ${result.error.issues[0].message}`);
  }
  const { buildPerSqft, ...assumptions } = draft;
  // Retain sample disclosure, planning text and unit citations. No model call or arithmetic.
  return { extraction: { ...original, ...assumptions, finance: { ...assumptions.finance } }, buildPerSqft };
}
