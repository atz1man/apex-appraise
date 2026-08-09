import { buildSpendProfile } from './engine.js';
import type { SpendProfileKey } from './types.js';

/**
 * Spend against programme, and spend against WORKS.
 *
 * These are two different questions and only one of them is the lender's.
 *
 * Money drawn ahead of the spend curve is ambiguous on its own: the job may be
 * running early, or it may be running over. Nothing about a date tells you which,
 * so a panel that reports only "8% ahead of programme" is inviting the reader to
 * guess — and they will guess wrong in whichever direction they already believed.
 *
 * Spend against works is unambiguous, and it is what a monitoring surveyor
 * certifies: at 45% complete the appraisal allows 45% of the construction budget,
 * so drawing 60% is an overspend regardless of what the calendar says.
 */

export interface DrawdownInput {
  /** construction incl. fees and contingency — what the cost packages cover */
  constructionTotal: number;
  periodMonths: number;
  profile: SpendProfileKey;
  /** whole months since the programme started; clamped into the build period */
  monthsElapsed: number;
  /** committed or certified to date */
  actualToDate: number;
  /** works complete, 0–100, from cost monitoring */
  progressPct: number;
}

export type DrawdownStatus = 'not started' | 'on budget' | 'overspending' | 'underspending';

export interface DrawdownResult {
  monthsElapsed: number;
  /** share of the build period elapsed, 0–1 */
  timeElapsedPct: number;
  /** what the spend curve says should have been drawn by now */
  expectedByProgramme: number;
  /** what the works completed entitle a draw of */
  expectedByProgress: number;
  actualToDate: number;
  /** actual less what the WORKS justify — the figure a surveyor argues about */
  varianceOnProgress: number;
  /** actual less what the calendar expects; context, not a verdict */
  varianceOnProgramme: number;
  status: DrawdownStatus;
}

/** ±5%: below that, the difference is measurement, not a finding. */
const TOLERANCE = 0.05;

export function spendAgainstProgramme(input: DrawdownInput): DrawdownResult {
  const months = Math.max(1, Math.round(input.periodMonths));
  const elapsed = Math.max(0, Math.min(months, Math.round(input.monthsElapsed)));
  const weights = buildSpendProfile(months, input.profile);
  const cumulativeWeight = weights.slice(0, elapsed).reduce((a, w) => a + w, 0);

  const progress = Math.max(0, Math.min(100, input.progressPct)) / 100;
  const expectedByProgramme = input.constructionTotal * cumulativeWeight;
  const expectedByProgress = input.constructionTotal * progress;

  const varianceOnProgress = input.actualToDate - expectedByProgress;
  const varianceOnProgramme = input.actualToDate - expectedByProgramme;

  let status: DrawdownStatus;
  if (elapsed === 0 && input.actualToDate === 0) {
    status = 'not started';
  } else if (input.constructionTotal <= 0) {
    // no budget to measure against; claiming "on budget" would be a statement
    // about nothing
    status = 'not started';
  } else if (Math.abs(varianceOnProgress) <= input.constructionTotal * TOLERANCE) {
    status = 'on budget';
  } else {
    status = varianceOnProgress > 0 ? 'overspending' : 'underspending';
  }

  return {
    monthsElapsed: elapsed,
    timeElapsedPct: elapsed / months,
    expectedByProgramme,
    expectedByProgress,
    actualToDate: input.actualToDate,
    varianceOnProgress,
    varianceOnProgramme,
    status,
  };
}

/**
 * Whole months between two dates, floored at zero.
 *
 * Floored because a programme that has not started yet has zero elapsed months,
 * not a negative number of them — and a negative would quietly invert every
 * comparison downstream.
 */
export function monthsBetween(from: { year: number; month: number }, to: Date): number {
  const months = (to.getUTCFullYear() - from.year) * 12 + (to.getUTCMonth() + 1 - from.month);
  return Math.max(0, months);
}
