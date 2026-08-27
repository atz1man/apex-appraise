/**
 * AI-use disclosure — the single register of every place a language model
 * touches a valuation, and the words used to describe it to a client.
 *
 * RICS professional standards require valuers to be transparent about whether
 * and how AI was used on an instruction. Apex derives that statement from the
 * audit trail instead of asking anyone to remember: every AI touchpoint writes
 * an ActivityEvent under AI_ACTOR, and only those events reach the report.
 *
 * Adding a new AI feature? Write the ActivityEvent and add it here, or it will
 * be used without being disclosed.
 */

export const AI_ACTOR = 'AI Development Director';

export interface AiTouchpoint {
  key: string;
  /** must match the ActivityEvent action written by the procedure */
  action: string;
  /**
   * The function that actually calls the model.
   *
   * The line above — "add it here, or it will be used without being
   * disclosed" — was the only thing standing between a new AI feature and an
   * undisclosed one, and this codebase's whole discipline is that an
   * instruction is not a guard. `ai-disclosure-provenance.test.ts` sweeps the
   * source for every call to the Anthropic API and requires each one to sit
   * inside a function named here, so a fifth model call cannot be added
   * without a fifth disclosure.
   */
  drafter: string;
  label: string;
  purpose: string;
}

export const AI_TOUCHPOINTS: AiTouchpoint[] = [
  {
    key: 'extraction',
    drafter: 'extractFromNotes',
    action: 'extracted scheme from',
    label: 'Document extraction',
    purpose:
      'read uploaded documents and proposed appraisal inputs (accommodation, areas, rates and costs). Every monetary figure was recomputed by the deterministic appraisal engine and accepted by the valuer.',
  },
  {
    key: 'narrative',
    drafter: 'draftNarrativeSections',
    action: 'drafted Red Book narrative for',
    label: 'Report narrative',
    purpose:
      'drafted the market commentary, valuation rationale and risk commentary reproduced in this report, working from figures the engine had already computed.',
  },
  {
    key: 'dataroom',
    drafter: 'answerFromWorkfile',
    action: 'asked the workfile about',
    label: 'Data-room questions',
    purpose:
      'answered questions about documents held in the deal data room. No valuation figure is derived from it.',
  },
  {
    key: 'scenarioRisk',
    drafter: 'draftRiskCommentary',
    action: 'drafted scenario risk commentary for',
    label: 'Scenario risk commentary',
    purpose:
      'compared scheme options on risk. The resilient option is selected deterministically from engine output, not by the model.',
  },
];

/** The standing statement — true of every Apex valuation, AI used or not. */
export const AI_STANDING_STATEMENT =
  'No artificial intelligence system computed, adjusted or approved any figure in this valuation. All monetary outputs are produced by the deterministic Apex Appraise engine from inputs accepted by the valuer, who retains full professional responsibility for the valuation and its conclusions.';

export const AI_NONE_STATEMENT =
  'No artificial intelligence was used in the preparation of this valuation.';
