import { describe, expect, it } from 'vitest';
import { workingDeal } from './working-deal';

const deal = (id: string, stage: string, probability: number, lastWorkedAt: string | Date) => ({ id, stage, probability, lastWorkedAt, name: id });

describe('workingDeal', () => {
  it('is the live deal worked most recently, not the highest probability — a finished scheme sits at 100', () => {
    // the demo workspace with the name pin removed, as measured
    const deals = [
      deal('Parkstone Mews', 'COMPLETED', 100, '2026-09-01T23:29:19.866Z'),
      deal('Northgate Trade & Industrial Park', 'CONSTRUCTION', 100, '2026-09-01T23:29:19.846Z'),
      deal('Harbour Reach', 'CONSTRUCTION', 100, '2026-09-01T23:29:19.849Z'),
      deal('Old Brewery Quarter', 'SALES_LETTING', 100, '2026-09-01T23:29:19.864Z'),
    ];
    expect(workingDeal(deals)?.id).toBe('Old Brewery Quarter');
    // and once the seed's audit trail lands on Northgate, Northgate — on its merits
    deals[1].lastWorkedAt = '2026-09-01T23:29:20.100Z';
    expect(workingDeal(deals)?.id).toBe('Northgate Trade & Industrial Park');
  });

  it('prefers the deal touched today at 25% to the one touched yesterday at 90%', () => {
    const deals = [
      deal('Elm Grove', 'ACQUISITION', 90, '2026-09-01T09:00:00Z'),
      deal('Southbourne Grove', 'SOURCING', 25, '2026-09-02T09:00:00Z'),
    ];
    expect(workingDeal(deals)?.id).toBe('Southbourne Grove');
    expect(workingDeal([...deals].reverse())?.id).toBe('Southbourne Grove');
  });

  it('never chooses a finished scheme while an unfinished one exists, however recently it was looked at', () => {
    const deals = [
      deal('Closed', 'COMPLETED', 100, '2026-09-02T12:00:00Z'),
      deal('Open', 'APPRAISAL', 40, '2026-08-01T12:00:00Z'),
    ];
    expect(workingDeal(deals)?.id).toBe('Open');
  });

  it('answers with the latest finished scheme where the firm has nothing else', () => {
    const deals = [deal('Older', 'COMPLETED', 100, '2026-01-01T00:00:00Z'), deal('Newer', 'COMPLETED', 100, '2026-06-01T00:00:00Z')];
    expect(workingDeal(deals)?.id).toBe('Newer');
  });

  it('never consults a name', () => {
    const deals = [
      { ...deal('a', 'APPRAISAL', 50, '2026-09-01T00:00:00Z'), name: 'Northgate Trade & Industrial Park' },
      { ...deal('b', 'APPRAISAL', 50, '2026-09-02T00:00:00Z'), name: 'Zebra Yard' },
    ];
    expect(workingDeal(deals)?.name).toBe('Zebra Yard');
  });

  it('breaks a tie on time by probability, then by id, whichever order the rows arrive in', () => {
    const t = '2026-09-01T23:29:19.850Z';
    const deals = [deal('b', 'OFFER', 55, t), deal('a', 'OFFER', 55, t), deal('c', 'APPRAISAL', 60, t)];
    expect(workingDeal(deals)?.id).toBe('c');
    expect(workingDeal([...deals].reverse())?.id).toBe('c');
    const tied = [deal('b', 'OFFER', 55, t), deal('a', 'OFFER', 55, t)];
    expect(workingDeal(tied)?.id).toBe('a');
    expect(workingDeal([...tied].reverse())?.id).toBe('a');
  });

  it('reads a Date and an ISO string alike', () => {
    const deals = [deal('iso', 'APPRAISAL', 50, '2026-09-02T00:00:00Z'), deal('date', 'APPRAISAL', 50, new Date('2026-09-02T00:00:01Z'))];
    expect(workingDeal(deals)?.id).toBe('date');
  });

  it('has no answer for no deals', () => {
    expect(workingDeal([])).toBeUndefined();
    expect(workingDeal(undefined)).toBeUndefined();
  });
});
