/**
 * Money is stored in integer PENCE. Return windows are short but refunds are
 * summed across a whole list ("£1,247.31 still returnable"), and a float
 * pound is not safe to add repeatedly — 0.1 + 0.2 shows up as a penny of
 * drift on a screen whose entire promise is telling people what they are owed.
 */
export type Pence = number;

export function toPence(pounds: number): Pence {
  return Math.round(pounds * 100);
}

export function fromPence(p: Pence): number {
  return p / 100;
}

/** "£89.00" — always two decimals, as every amount in the design shows. */
export function money(p: Pence): string {
  const neg = p < 0;
  const abs = Math.abs(p);
  const pounds = Math.floor(abs / 100);
  const pennies = String(abs % 100).padStart(2, '0');
  return `${neg ? '-' : ''}£${pounds.toLocaleString('en-GB')}.${pennies}`;
}

/** "£1.4k" style is deliberately absent — people want the exact figure. */
export function sumPence(values: readonly Pence[]): Pence {
  return values.reduce((a, b) => a + b, 0);
}
