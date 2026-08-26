import { describe, expect, it } from 'vitest';
import { shapeCharges } from '../src/companieshouse.js';

/**
 * "Charges · N outstanding of M", on the Site Pack.
 *
 * A charge is a lender's security over a company's assets. Someone deciding
 * whether to buy land from a counterparty reads this line to learn how much of
 * what that company owns is already pledged, so understating it is the one
 * direction of error that matters.
 *
 * `total` came from the API's own `total_count` — the true figure. `outstanding`
 * was counted inside `chargeItems`, which is the SIX the panel lists. So the two
 * halves of one sentence were measured against different populations, and a
 * company with twenty charges could never report more than six outstanding
 * however many it had.
 *
 * `companieshouse.ts` had no test of its own; it was one of three API modules
 * with none.
 */

const charge = (status: string, i = 0) => ({
  status,
  classification: { description: `Fixed charge ${i}` },
  created_on: '2024-01-01',
  persons_entitled: [{ name: 'A Lender plc' }],
});

describe('counting what is still charged', () => {
  it('counts every charge the API returned, not only the handful the panel lists', () => {
    const items = [
      ...Array.from({ length: 12 }, (_, i) => charge('outstanding', i)),
      ...Array.from({ length: 8 }, (_, i) => charge('fully-satisfied', i)),
    ];
    const out = shapeCharges({ total_count: 20, items });
    expect(out.total).toBe(20);
    expect(out.outstanding, 'the count stopped at the six the panel shows').toBe(12);
    // the panel still lists a handful; that is presentation, not the count
    expect(out.items).toHaveLength(6);
  });

  it('treats a part-satisfied charge as still charged, because it is', () => {
    const out = shapeCharges({
      total_count: 3,
      items: [charge('outstanding'), charge('part-satisfied'), charge('fully-satisfied')],
    });
    expect(out.outstanding).toBe(2);
  });

  it('says when it has not seen every charge, rather than quietly reporting a floor', () => {
    /**
     * If the register holds more charges than one page returned, a count over
     * what arrived is a minimum and not the answer. The screen has to be able to
     * say so — an understated number presented as exact is the defect, and
     * replacing one truncation with another would only move it.
     */
    const partial = shapeCharges({ total_count: 140, items: Array.from({ length: 100 }, () => charge('outstanding')) });
    expect(partial.outstanding).toBe(100);
    expect(partial.complete, 'reported a partial count as though it were the whole register').toBe(false);

    const whole = shapeCharges({ total_count: 4, items: Array.from({ length: 4 }, () => charge('outstanding')) });
    expect(whole.complete).toBe(true);
  });

  it('falls back to what it can see when the API sends no total', () => {
    const out = shapeCharges({ items: [charge('outstanding'), charge('fully-satisfied')] });
    expect(out.total).toBe(2);
    expect(out.outstanding).toBe(1);
    expect(out.complete).toBe(true);
  });

  it('reports nothing charged as nothing, not as unknown', () => {
    const out = shapeCharges({ total_count: 0, items: [] });
    expect(out).toMatchObject({ total: 0, outstanding: 0, complete: true });
    expect(out.items).toEqual([]);
  });
});
