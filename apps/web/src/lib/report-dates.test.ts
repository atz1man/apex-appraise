import { describe, expect, it } from 'vitest';
import { reportDates } from './report-dates';

/**
 * What a valuation report is allowed to say about dates.
 *
 * All three of these were the moment the file was opened, so the demo
 * workspace's Red Book — whose accepted terms state 30 June 2026 and which has
 * no inspection on file — printed 25 August 2026 as its valuation date, its
 * inspection date and the date under the valuer's signature.
 */

const d = (iso: string) => new Date(iso);

describe('the date the report carries', () => {
  it('is when the version was signed off, not when it is read', () => {
    const r = reportDates({
      appraisal: { updatedAt: d('2026-08-25T09:00:00Z'), reviewStatus: 'approved', reviewedAt: d('2026-06-30T11:00:00Z') },
      now: d('2027-01-01T00:00:00Z'),
    });
    expect(r.report).toBe('30 June 2026');
    expect(r.signedOff).toBe(true);
  });

  it('falls back to the version’s own last save, so printing twice gives the same document', () => {
    const src = { appraisal: { updatedAt: d('2026-06-30T11:00:00Z'), reviewStatus: 'draft', reviewedAt: null } };
    expect(reportDates({ ...src, now: d('2026-07-01T00:00:00Z') }).report).toBe('30 June 2026');
    expect(reportDates({ ...src, now: d('2027-03-14T00:00:00Z') }).report).toBe('30 June 2026');
  });

  it('does not treat a reviewed-then-reopened version as signed', () => {
    // changes_requested carries a reviewedAt too — it is a decision, not a signature
    const r = reportDates({
      appraisal: { updatedAt: d('2026-08-25T09:00:00Z'), reviewStatus: 'changes_requested', reviewedAt: d('2026-06-30T11:00:00Z') },
    });
    expect(r.report).toBe('25 August 2026');
    expect(r.signedOff).toBe(false);
  });
});

describe('the valuation date', () => {
  it('is the one the client agreed in the terms of engagement', () => {
    const r = reportDates({
      appraisal: { updatedAt: d('2026-08-25T09:00:00Z') },
      terms: { valuationDate: d('2026-06-30T00:00:00Z') },
    });
    expect(r.valuation).toBe('30 June 2026');
    // and it is NOT the report date — the two are different facts
    expect(r.report).toBe('25 August 2026');
  });

  it('falls back to the report date, which is what the terms themselves say', () => {
    // clause 7 prints "The date of the report, unless otherwise agreed in
    // writing" when no date is set, so the fallback is the firm's own rule
    const r = reportDates({ appraisal: { updatedAt: d('2026-08-25T09:00:00Z') }, terms: { valuationDate: null } });
    expect(r.valuation).toBe('25 August 2026');
    expect(r.valuation).toBe(r.report);
  });
});

describe('the inspection date', () => {
  it('is the day somebody attended', () => {
    const r = reportDates({ inspection: { inspectedAt: d('2026-05-14T08:30:00Z') } });
    expect(r.inspection).toBe('14 May 2026');
  });

  it('is null when nobody has, so the page can say so instead of inventing one', () => {
    // "an unsigned valuation is a fixable state and a falsely signed one is
    // not" — the page's own rule for the valuer's name. A date asserting a
    // professional attended a property is the same kind of claim.
    expect(reportDates({ appraisal: { updatedAt: d('2026-08-25T09:00:00Z') } }).inspection).toBeNull();
  });

  it('never falls back to today', () => {
    const r = reportDates({ appraisal: { updatedAt: d('2026-08-25T09:00:00Z') }, now: d('2026-08-25T09:00:00Z') });
    expect(r.inspection).not.toBe(r.report);
    expect(r.inspection).toBeNull();
  });
});

describe('the reader’s timezone', () => {
  it('does not move a date that was entered as a day', () => {
    // a date input stores UTC midnight; formatted in a negative offset that is
    // the previous day. Measured in a browser before this: 30 June rendered as
    // 29 June to a client in New York.
    const r = reportDates({ terms: { valuationDate: '2026-06-30' }, appraisal: { updatedAt: d('2026-06-30T00:00:00Z') } });
    expect(r.valuation).toBe('30 June 2026');
  });

  it('dates a report produced just after midnight BST to that day', () => {
    // 00:30 BST on 5 August is 23:30 UTC on the 4th — a UK firm would say the
    // 5th, which is why this is Europe/London and not UTC
    const r = reportDates({ appraisal: { updatedAt: d('2026-08-04T23:30:00Z') } });
    expect(r.report).toBe('5 August 2026');
  });
});
