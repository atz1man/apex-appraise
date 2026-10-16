/** Input lineage labels, never a statement of source accuracy or professional approval. */
export const ASSUMPTION_FIELDS = {
  buildPerSqft: 'Build cost £ per sq ft', efficiency: 'NIA / GIA efficiency %',
  asking: 'Asking land price £', cilPerSqm: 'CIL £ per sq m', s106: 'S106 £',
  profFee: 'Professional fees %', contingency: 'Contingency %', targetProfit: 'Target profit on GDV %',
  acq: 'Acquisition costs %', agent: 'Agent fees %', legal: 'Legal fees %',
  'finance.ltc': 'Senior debt LTC %', 'finance.rate': 'Annual interest rate %',
  'finance.period': 'Build period months', 'finance.sales': 'Sales period months',
  'finance.arrFee': 'Arrangement fee %',
} as const;
export type AssumptionField = keyof typeof ASSUMPTION_FIELDS;
export const ASSUMPTION_ORIGINS = ['model-supplied', 'application-default', 'user-entered', 'run-setting', 'worked-example', 'unknown'] as const;
export type AssumptionOrigin = typeof ASSUMPTION_ORIGINS[number];
export type AssumptionOrigins = Partial<Record<AssumptionField, AssumptionOrigin>>;
export const ORIGIN_LABELS: Record<AssumptionOrigin, string> = {
  'model-supplied': 'Model-supplied — not verified',
  'application-default': 'Application default — not supplied by the model',
  'user-entered': 'User-entered or corrected — not verified',
  'run-setting': 'Run setting — not extracted from documents',
  'worked-example': 'Worked example — not project evidence',
  unknown: 'Origin not recorded',
};

/** Call before schema defaults erase missing/null values. Zero is supplied. */
export function extractedAssumptionOrigins(raw: unknown): AssumptionOrigins {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const finance = record.finance && typeof record.finance === 'object' ? record.finance as Record<string, unknown> : {};
  return Object.fromEntries((Object.keys(ASSUMPTION_FIELDS) as AssumptionField[]).map(key => {
    const value = key.startsWith('finance.') ? finance[key.slice(8)] : record[key];
    return [key, key === 'buildPerSqft' ? 'run-setting' : value == null ? 'application-default' : 'model-supplied'];
  })) as AssumptionOrigins;
}
export function sampleAssumptionOrigins(): AssumptionOrigins {
  return Object.fromEntries(Object.keys(ASSUMPTION_FIELDS).map(key => [key, key === 'buildPerSqft' ? 'run-setting' : 'worked-example'])) as AssumptionOrigins;
}
export function userChangedOrigins(origins: AssumptionOrigins | undefined, changed: string[]): AssumptionOrigins {
  const next = { ...origins };
  for (const key of changed) if (Object.prototype.hasOwnProperty.call(ASSUMPTION_FIELDS, key)) next[key as AssumptionField] = 'user-entered';
  return next;
}

export function changedAssumptionFields(before: object, after: object): AssumptionField[] {
  const value = (input: object, key: string): unknown => {
    const row = input as Record<string, unknown>;
    return key.startsWith('finance.') ? (row.finance as Record<string, unknown> | undefined)?.[key.slice(8)] : row[key];
  };
  return (Object.keys(ASSUMPTION_FIELDS) as AssumptionField[]).filter(key => value(before, key) !== value(after, key));
}
