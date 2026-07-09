import { describe, expect, it } from 'vitest';
import {
  formatDelta,
  formatMoney,
  formatMoneyFull,
  formatPct,
  formatPp,
  formatRent,
  formatSigned,
  lettingsRollup,
  penceToPounds,
  portfolioRollup,
  poundsToPence,
  salesRollup,
} from '../src/index.js';

describe('salesRollup (§11)', () => {
  const units = [
    { appraisedValue: 300_000, agreedValue: 310_000, status: 'COMPLETED' as const, depositHeld: 31_000 },
    { appraisedValue: 300_000, agreedValue: 295_000, status: 'EXCHANGED' as const, depositHeld: 29_500 },
    { appraisedValue: 280_000, agreedValue: 285_000, status: 'RESERVED' as const, depositHeld: 5_000 },
    { appraisedValue: 280_000, agreedValue: null, status: 'AVAILABLE' as const, depositHeld: null },
  ];
  const r = salesRollup(units);
  it('GDV realised counts EXCHANGED+', () => {
    expect(r.gdvRealised).toBe(605_000);
    expect(r.gdvAppraised).toBe(1_160_000);
  });
  it('deposits held counts RESERVED+', () => {
    expect(r.depositsHeld).toBe(65_500);
  });
  it('sales rate = sold / total', () => {
    expect(r.salesRate).toBe(0.5);
  });
});

describe('lettingsRollup', () => {
  const r = lettingsRollup([
    { ervPcm: 1_500, agreedRentPcm: 1_475, status: 'OCCUPIED', arrears: 0 },
    { ervPcm: 1_400, agreedRentPcm: 1_400, status: 'OCCUPIED', arrears: 700 },
    { ervPcm: 1_600, agreedRentPcm: null, status: 'AVAILABLE', arrears: 0 },
  ]);
  it('rent roll = occupied agreed × 12', () => {
    expect(r.rentRollAnnual).toBe((1_475 + 1_400) * 12);
  });
  it('void rate and arrears', () => {
    expect(r.voidRate).toBeCloseTo(1 / 3, 10);
    expect(r.arrears).toBe(700);
  });
});

describe('portfolioRollup', () => {
  const deals = [
    { gdv: 4_000_000, forecastProfit: 800_000, equityRequired: 1_500_000, probability: 60, stage: 'APPRAISAL' },
    { gdv: 2_000_000, forecastProfit: 400_000, equityRequired: 700_000, probability: 90, stage: 'CONSTRUCTION' },
    { gdv: 3_000_000, forecastProfit: 500_000, equityRequired: 900_000, probability: 100, stage: 'COMPLETED' },
  ];
  const r = portfolioRollup(deals);
  it('weighted GDV excludes completed', () => {
    expect(r.weightedGdv).toBe(4_000_000 * 0.6 + 2_000_000 * 0.9);
    expect(r.pipelineGdv).toBe(6_000_000);
    expect(r.activeCount).toBe(2);
  });
});

describe('en-GB formatting (true minus, abbreviations)', () => {
  it('money abbreviation', () => {
    expect(formatMoney(1_240_000)).toBe('£1.24m');
    expect(formatMoney(625_000)).toBe('£625k');
    expect(formatMoney(-24_000)).toBe('−£24k');
  });
  it('full money', () => {
    expect(formatMoneyFull(625_000)).toBe('£625,000');
    expect(formatMoneyFull(-1_500)).toBe('−£1,500');
  });
  it('rent pcm', () => {
    expect(formatRent(1_475)).toBe('£1,475 pcm');
  });
  it('percent', () => {
    expect(formatPct(0.25, 0)).toBe('25%');
    expect(formatPct(0.075)).toBe('7.5%');
    expect(formatPct(-0.031)).toBe('−3.1%');
  });
  it('delta and pp', () => {
    expect(formatDelta(26_000)).toBe('+£26k');
    expect(formatDelta(-24_000)).toBe('−£24k');
    expect(formatDelta(0)).toBe('—');
    expect(formatPp(4)).toBe('+4pp');
    expect(formatPp(-2)).toBe('−2pp');
  });
  it('signed full', () => {
    expect(formatSigned(-406_711)).toBe('−£406,711');
  });
  it('pence conversion round-trips', () => {
    expect(poundsToPence(1234.56)).toBe(123_456);
    expect(penceToPounds(123_456n)).toBe(1234.56);
    expect(penceToPounds(poundsToPence(406_711.36))).toBeCloseTo(406_711.36, 10);
  });
});
