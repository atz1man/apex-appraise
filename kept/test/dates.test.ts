import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, fmtDate, fromISODate, relativeAgo, startOfDay, toISODate } from '../src/lib/dates';

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
