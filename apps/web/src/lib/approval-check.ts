import { formatMoneyFull } from '@apex/appraisal-engine';

/**
 * What a report says about a signed figure, in one sentence.
 *
 * An approved version now carries a pin — the engine that signed it, a hash of
 * its inputs and the headline figures to the penny — and the API re-derives it
 * on request (`appraisal.verifyApproved`). The reports are rendered from the
 * inputs with whatever engine ships today, so the sentence under the signature
 * has three honest forms and no fourth:
 *
 *   verified    — same engine, same inputs, same figures to the penny
 *   unverified  — approved before pins existed; the figures shown were never
 *                 checked against the signed record, and the document says so
 *                 rather than printing a verification it did not perform
 *   drift       — the engine or the inputs have changed since approval, and the
 *                 Market Value shown is not the one that was signed. Names both
 *                 figures, because the reader's next question is "by how much".
 *
 * Lifted out of the two report components so the boundaries can be tested: a
 * changed engine with unchanged figures is still "verified" for the reader
 * (the number they hold is the number that was signed), and changed inputs on
 * a signed row are named as such rather than blamed on the engine.
 */
export interface VerificationLike {
  engineVersion: { pinned: string; current: string; same: boolean };
  inputsUnchanged: boolean;
  figuresMatch: boolean;
  drift: Array<{ key: string; pinned: number; now: number }>;
  pinned: Record<string, number>;
  now: Record<string, number>;
}

export type ApprovalCheck = { tone: 'verified' | 'unverified' | 'drift'; text: string };

export function approvalCheck(v: VerificationLike | null | undefined, approved: boolean): ApprovalCheck | null {
  if (!approved) return null;
  // still loading: say nothing rather than something provisional
  if (v === undefined) return null;
  if (v === null) {
    return {
      tone: 'unverified',
      text: 'Approved before figures were pinned to an engine version. The figures shown are recomputed and have not been verified against the signed record.',
    };
  }
  if (v.figuresMatch) {
    // a bumped engine that produces the same pennies is a verification, not a warning
    return { tone: 'verified', text: `Figures verified against the approved record · engine ${v.engineVersion.pinned}` };
  }
  const cause = !v.inputsUnchanged
    ? 'The inputs of this approved version have changed since it was signed'
    : v.engineVersion.same
      ? 'The figures no longer match the approved record'
      : `The calculation engine has changed since this version was approved (${v.engineVersion.pinned} → ${v.engineVersion.current})`;
  const mv = v.drift.find((d) => d.key === 'marketValue');
  const detail = mv
    ? `Approved record: Market Value ${formatMoneyFull(mv.pinned)}. Recomputed now: ${formatMoneyFull(mv.now)}.`
    : `Market Value is unchanged at ${formatMoneyFull(v.pinned.marketValue ?? 0)}; ${v.drift.map((d) => d.key).join(', ')} moved.`;
  return { tone: 'drift', text: `${cause}. ${detail} Re-approve before this report is issued.` };
}
