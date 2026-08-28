import { describe, expect, it } from 'vitest';
import { parseReceiptText } from '../src/lib/parse';
import { sharedTextFrom } from '../src/lib/share';

const q = (s: string) => new URLSearchParams(s);

describe('receiving a shared order email', () => {
  it('is nothing when no share params are present', () => {
    expect(sharedTextFrom(q(''))).toBeNull();
    expect(sharedTextFrom(q('embed=1'))).toBeNull();
  });

  it('takes the body when that is all that was sent', () => {
    expect(sharedTextFrom(q('text=Your+Apple+order'))).toBe('Your Apple order');
  });

  it('keeps the subject, where the shop name usually is', () => {
    const text = sharedTextFrom(q('title=Your+Zara+order&text=Total+%C2%A334.99'))!;
    expect(text).toContain('Zara');
    expect(text).toContain('£34.99');
  });

  it('folds all three parts together', () => {
    expect(sharedTextFrom(q('title=A&text=B&url=https%3A%2F%2Fc'))).toBe('A\nB\nhttps://c');
  });

  it('does not repeat a part the sharing app sent twice', () => {
    // Android commonly sends the same string as both text and url; a doubled
    // total is exactly what confuses a parser looking for the largest amount.
    expect(sharedTextFrom(q('text=Total+%C2%A3129.00&url=Total+%C2%A3129.00'))).toBe('Total £129.00');
  });

  it('ignores empty and whitespace-only parts', () => {
    expect(sharedTextFrom(q('title=+++&text=Currys+%C2%A389'))).toBe('Currys £89');
  });

  it('hands the parser something it can actually read', () => {
    const shared = sharedTextFrom(q('title=Your+Currys+order&text=Total+%C2%A389.00+%C2%B7+16+Aug'))!;
    const out = parseReceiptText(shared, new Date(2026, 7, 28));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.value.store).toBe('Currys');
      expect(out.value.amount).toBe(8900);
      expect(out.value.purchasedOn).toBe('2026-08-16');
    }
  });
});
