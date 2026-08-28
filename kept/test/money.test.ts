import { describe, expect, it } from 'vitest';
import { fromPence, money, sumPence, toPence } from '../src/lib/money';

describe('money', () => {
  it('always shows two decimals', () => {
    expect(money(8900)).toBe('£89.00');
    expect(money(6499)).toBe('£64.99');
    expect(money(0)).toBe('£0.00');
    expect(money(5)).toBe('£0.05');
  });

  it('groups thousands', () => {
    expect(money(140000)).toBe('£1,400.00');
  });

  it('renders a negative amount with the sign outside the symbol', () => {
    expect(money(-1250)).toBe('-£12.50');
  });

  it('converts pounds to pence without float drift', () => {
    expect(toPence(24.98)).toBe(2498);
    expect(toPence(0.1) + toPence(0.2)).toBe(30);
    expect(fromPence(2498)).toBe(24.98);
  });

  it('sums a list exactly — the reason amounts are integers at all', () => {
    const items = Array.from({ length: 100 }, () => toPence(0.1));
    expect(money(sumPence(items))).toBe('£10.00');
  });
});
