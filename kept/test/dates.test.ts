import { describe, expect, it } from 'vitest';
import { addDays, addMonths, daysBetween, fmtDate, fmtDateNear, fromISODate, relativeAgo, startOfDay, toISODate } from '../src/lib/dates';

/**
 * This suite runs under TZ=America/New_York on purpose (see package.json).
 * In UTC or London, a date parsed as UTC midnight still lands on the right
 * calendar day, so the bug these tests exist to catch would pass unnoticed.
 */
describe('day arithmetic', () => {
  it('counts calendar boundaries, not elapsed hours', () => {
    const late = new Date(2026, 7, 1, 23, 50);
    const early = new Date(2026, 7, 2, 0, 5);
    expect(daysBetween(late, early)).toBe(1);
  });

  it('survives a spring DST transition', () => {
    // 29 March 2026 is the UK spring-forward; the US one is 8 March. Either
    // way one of these "days" is 23 hours long, and a truncating divide loses it.
    const before = new Date(2026, 2, 1);
    const after = new Date(2026, 3, 1);
    expect(daysBetween(before, after)).toBe(31);
  });

  it('survives an autumn DST transition', () => {
    const before = new Date(2026, 9, 1);
    const after = new Date(2026, 10, 1);
    expect(daysBetween(before, after)).toBe(31);
  });

  it('is negative for a date already past', () => {
    expect(daysBetween(new Date(2026, 7, 10), new Date(2026, 7, 3))).toBe(-7);
  });

  it('parses a stored ISO date as local midnight, not UTC', () => {
    // The whole point: west of Greenwich, Date('2026-08-28') is 27 August.
    const d = fromISODate('2026-08-28');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(28);
  });

  it('round-trips a date through ISO', () => {
    const d = new Date(2026, 0, 5);
    expect(fromISODate(toISODate(d)).getTime()).toBe(startOfDay(d).getTime());
  });

  it('adds days across a month boundary', () => {
    expect(toISODate(addDays(new Date(2026, 0, 30), 3))).toBe('2026-02-02');
  });

  it('formats day-first, as en-GB writes it', () => {
    // Asserting the ORDER, not the exact abbreviation: en-GB renders
    // September as "Sept" and CLDR has changed such spellings before. The
    // regression that would actually mislead a UK user is US ordering.
    expect(fmtDate(new Date(2026, 7, 5))).toBe('5 Aug');
    expect(fmtDate(new Date(2026, 8, 5))).toMatch(/^5 Sep/);
  });
});

describe('addMonths — the unit warranties are quoted in', () => {
  it('adds a plain month', () => {
    expect(toISODate(addMonths(new Date(2026, 0, 15), 1))).toBe('2026-02-15');
  });

  it('clamps to the end of a shorter month rather than overflowing', () => {
    // The naive setMonth(m + 1) turns 31 January into 3 March, handing someone
    // two days of cover they do not have.
    expect(toISODate(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-28');
  });

  it('lands on 29 February in a leap year', () => {
    expect(toISODate(addMonths(new Date(2028, 0, 31), 1))).toBe('2028-02-29');
  });

  it('crosses years', () => {
    expect(toISODate(addMonths(new Date(2026, 7, 16), 24))).toBe('2028-08-16');
    expect(toISODate(addMonths(new Date(2026, 7, 16), 120))).toBe('2036-08-16');
  });

  it('goes backwards too', () => {
    expect(toISODate(addMonths(new Date(2026, 0, 15), -2))).toBe('2025-11-15');
  });
});

describe('relativeAgo', () => {
  const today = new Date(2026, 7, 28);
  it.each([
    [0, 'today'],
    [1, 'yesterday'],
    [2, '2d ago'],
    [6, '6d ago'],
    [7, '1w ago'],
    [21, '3w ago'],
    [30, '1mo ago'],
    [200, '6mo ago'],
    [400, '1y ago'],
  ])('renders %i days back as "%s"', (back, expected) => {
    expect(relativeAgo(addDays(today, -back), today)).toBe(expected);
  });
});

describe('fmtDateNear — the year, only when it earns its space', () => {
  const today = new Date(2026, 7, 28);

  it('leaves the year off for a date this year', () => {
    expect(fmtDateNear(new Date(2026, 1, 14), today)).toBe('14 Feb');
  });

  it('adds the year for one that is not', () => {
    // IKEA's 365-day window: "bought 14 Feb · return by 14 Feb" reads as the
    // same day when it is twelve months apart.
    expect(fmtDateNear(new Date(2027, 1, 14), today)).toBe('14 Feb 2027');
  });

  it('adds the year for a date in the past too', () => {
    expect(fmtDateNear(new Date(2025, 11, 3), today)).toBe('3 Dec 2025');
  });
});
