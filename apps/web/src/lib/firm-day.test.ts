import { describe, expect, it } from 'vitest';
import { daysBetween, firmDayKey, firmDayLabel, firmToday, groupByDue, keyOf, viewOf } from './firm-day';

/**
 * A task due date is a calendar date. The picker sends `2026-06-30`, the API
 * stores `new Date('2026-06-30')` = `2026-06-30T00:00:00.000Z`, and the screen
 * used to read it back with the reader's own clock:
 *
 *     TZ=Europe/London     grid renders on 2026-06-30   overdue? false
 *     TZ=America/New_York  grid renders on 2026-06-29   overdue? true
 *
 * These tests are written so that the answers are the same wherever they run —
 * the suite is executed a second time under TZ=America/Los_Angeles, which is the
 * only thing that actually proves the reader's clock is out of it.
 */

const STORED = (day: string) => new Date(day); // exactly what tasks.create does

describe('the day a stored date falls on', () => {
  it('is the day the user picked, in British Summer Time', () => {
    expect(firmDayKey(STORED('2026-06-30'))).toBe('2026-06-30');
  });

  it('is the day the user picked, in GMT', () => {
    expect(firmDayKey(STORED('2026-01-15'))).toBe('2026-01-15');
  });

  it('follows the firm’s clock across midnight, not the reader’s', () => {
    // 00:30 BST on the 5th — paper.tsx settled this case for the documents:
    // "a report produced at 00:30 BST on the 5th is dated the 5th"
    expect(firmDayKey(new Date('2026-08-04T23:30:00.000Z'))).toBe('2026-08-05');
    // and in winter the same instant-of-day is still the 4th
    expect(firmDayKey(new Date('2026-01-04T23:30:00.000Z'))).toBe('2026-01-04');
  });

  it('labels it in the same timezone it was bucketed by', () => {
    expect(firmDayLabel(STORED('2026-06-30'))).toBe('Tue 30 Jun');
  });
});

describe('counting days', () => {
  /**
   * These two are BOUNDARY coverage, not a discriminating guard, and the
   * difference is worth writing down. I first wrote them as "unmoved by the
   * clocks going forward/back" and mutated `daysBetween` to divide milliseconds
   * instead — it survived. It had to: both arguments are date-only keys, which
   * `new Date` parses as UTC midnight, so no British clock change is ever inside
   * the subtraction and the two implementations agree on every valid input.
   *
   * They earn their place by catching a future change of SHAPE — a version
   * taking `Date` objects, or building them with `new Date(y, m, d)` in local
   * time, would fail these the moment a span crossed a clock change. They do
   * not prove the current one is DST-safe; the key type is what does that.
   */
  it('counts calendar days across a British clock change', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('counts across a month and a year boundary', () => {
    expect(daysBetween('2026-01-30', '2026-02-02')).toBe(3);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    // 2028 is a leap year
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('is negative for a day already gone', () => {
    expect(daysBetween('2026-06-30', '2026-06-29')).toBe(-1);
    expect(daysBetween('2026-06-30', '2026-06-30')).toBe(0);
  });
});

describe('the month grid', () => {
  it('builds a key from its own integers, with no Date in the way', () => {
    expect(keyOf(2026, 6, 30)).toBe('2026-06-30');
    expect(keyOf(2026, 1, 1)).toBe('2026-01-01');
  });

  it('opens on the month today belongs to', () => {
    expect(viewOf('2026-06-30')).toEqual({ y: 2026, m: 5 });
    expect(viewOf('2026-01-01')).toEqual({ y: 2026, m: 0 });
  });
});

describe('what the board calls late', () => {
  const on = (day: string) => ({ done: false, due: STORED(day), id: day });
  const today = '2026-06-30';

  it('does not call a task due today overdue', () => {
    // the defect, stated as the user met it: west of Greenwich this task was
    // bucketed to the 29th and every open task due today read as late
    const g = groupByDue([on('2026-06-30')], today);
    expect(g.overdue).toEqual([]);
    expect(g.dueToday.map((t) => t.id)).toEqual(['2026-06-30']);
  });

  it('sorts the buckets by how far away the day is', () => {
    const g = groupByDue(
      [on('2026-07-20'), on('2026-06-28'), on('2026-07-03'), on('2026-06-29'), on('2026-07-01')],
      today,
    );
    expect(g.overdue.map((t) => t.id)).toEqual(['2026-06-28', '2026-06-29']);
    expect(g.thisWeek.map((t) => t.id)).toEqual(['2026-07-01', '2026-07-03']);
    expect(g.later.map((t) => t.id)).toEqual(['2026-07-20']);
  });

  it('puts the seventh day in this week and the eighth in later', () => {
    const g = groupByDue([on('2026-07-07'), on('2026-07-08')], today);
    expect(g.thisWeek.map((t) => t.id)).toEqual(['2026-07-07']);
    expect(g.later.map((t) => t.id)).toEqual(['2026-07-08']);
  });

  it('does not call a task with no due date late', () => {
    const g = groupByDue([{ done: false, due: null, id: 'someday' }], today);
    expect(g.overdue).toEqual([]);
    expect(g.later.map((t) => t.id)).toEqual(['someday']);
  });

  it('keeps finished work out of every open bucket', () => {
    const g = groupByDue([{ done: true, due: STORED('2026-06-01'), id: 'old' }], today);
    expect(g.overdue).toEqual([]);
    expect(g.done.map((t) => t.id)).toEqual(['old']);
  });
});

describe('today', () => {
  it('is read in the firm’s timezone', () => {
    // 23:30 UTC on 4 August is already the 5th in London
    expect(firmToday(new Date('2026-08-04T23:30:00.000Z'))).toBe('2026-08-05');
  });
});
