/**
 * Who signs a report: the valuer the terms of engagement name, and nobody else.
 *
 * `engagement.get` answers with SAVED terms when the deal has them and with an
 * unsaved DRAFT when it does not, and the draft is prefilled for the form —
 * `valuerName` is whoever is signed in and `valuerReg` is the firm's house
 * default, which on the demo workspace reads "MRICS · RICS Registered Valuer
 * no. 1148207". Both reports read the valuer off that answer without asking
 * which kind it was. Measured: 8 of 12 deals on the workspace had no saved
 * terms, and the Red Book cover and signature block for every one of them
 * named the signed-in user as the valuer, with that registration number under
 * their name — a different valuer for each person who opened the page, and a
 * chartered status nobody had claimed for them.
 *
 * So a valuer is named only from terms that were saved. Where there are none,
 * the report says so and prints no credentials: an unsigned valuation is a
 * fixable state and a falsely signed one is not.
 */
export type TermsLike =
  | { saved?: boolean | null; valuerName?: string | null; valuerReg?: string | null }
  | null
  | undefined;

export type Valuer = { named: true; name: string; reg: string } | { named: false; name: ''; reg: '' };

export function valuerFrom(toe: TermsLike): Valuer {
  if (!toe?.saved) return { named: false, name: '', reg: '' };
  const name = toe.valuerName?.trim() ?? '';
  const reg = toe.valuerReg?.trim() ?? '';
  return name ? { named: true, name, reg } : { named: false, name: '', reg: '' };
}
