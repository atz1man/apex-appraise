/**
 * The model to name in an AI-use disclosure, or nothing.
 *
 * `model` records what produced the narrative currently in the report, and two
 * of its values are not models: 'template' for the deterministic sections, and
 * 'demo' — the value that meant the same thing before the field recorded
 * provenance rather than configuration. Rows written then are still in the
 * database and must not print "(model: demo)" in a signed valuation.
 */
const NOT_A_MODEL = new Set(['demo', 'template', '']);

export const namedModel = (model: string | null | undefined): string | '' =>
  model && !NOT_A_MODEL.has(model) ? ` (model: ${model})` : '';
