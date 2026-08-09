import { describe, expect, it } from 'vitest';
import { aggregateExposure, postcodeArea, type ExposurePosition } from '../src/index.js';

const pos = (over: Partial<ExposurePosition> & { name: string; facility: number }): ExposurePosition => ({
  dealId: over.name,
  assetType: 'RESIDENTIAL',
  region: 'BH',
  stage: 'CONSTRUCTION',
  gdv: over.facility * 2,
  totalCost: over.facility * 1.5,
  equity: over.facility * 0.4,
  drawn: 0,
  ...over,
});

describe('postcodeArea', () => {
  it('collapses a district to the market it belongs to', () => {
    // BH15 and BH17 are the same market and will move together; a lender does not
    // want them counted as two diversifications
    expect(postcodeArea('BH15 1AA')).toBe('BH');
    expect(postcodeArea('BH17 7AA')).toBe('BH');
    expect(postcodeArea('sw1a 2aa')).toBe('SW');
    expect(postcodeArea('E1 6AN')).toBe('E');
  });

  it('says Unknown rather than guessing', () => {
    expect(postcodeArea(null)).toBe('Unknown');
    expect(postcodeArea('')).toBe('Unknown');
    expect(postcodeArea('12345')).toBe('Unknown');
  });
});

describe('aggregateExposure', () => {
  it('reports an empty book without dividing by zero', () => {
    const e = aggregateExposure([]);
    expect(e.totals).toMatchObject({ deals: 0, facility: 0, utilisation: 0, loanToGdv: 0 });
    expect(e.largest).toBeNull();
  });

  it('sums the book and states how much of the facility is actually drawn', () => {
    const e = aggregateExposure([
      pos({ name: 'A', facility: 1_000_000, drawn: 400_000 }),
      pos({ name: 'B', facility: 1_000_000, drawn: 100_000 }),
    ]);
    expect(e.totals.facility).toBe(2_000_000);
    expect(e.totals.drawn).toBe(500_000);
    expect(e.totals.undrawn).toBe(1_500_000);
    expect(e.totals.utilisation).toBeCloseTo(0.25, 10);
    expect(e.totals.loanToGdv).toBeCloseTo(0.5, 10);
  });

  it('does not report negative undrawn when a deal has overrun its facility', () => {
    // a real situation, and "−£200k undrawn" would read as a rounding fault
    const e = aggregateExposure([pos({ name: 'Overrun', facility: 1_000_000, drawn: 1_200_000 })]);
    expect(e.totals.undrawn).toBe(0);
    expect(e.totals.utilisation).toBeGreaterThan(1);
  });

  it('finds the worst concentration across dimensions, not per dimension', () => {
    // spread across regions and types, but one scheme is most of the money —
    // a per-dimension table would have shown three comfortable-looking rows
    const e = aggregateExposure([
      pos({ name: 'Whale', facility: 8_000_000, region: 'BH', assetType: 'RESIDENTIAL' }),
      pos({ name: 'Minnow 1', facility: 1_000_000, region: 'SW', assetType: 'INDUSTRIAL' }),
      pos({ name: 'Minnow 2', facility: 1_000_000, region: 'M', assetType: 'COMMERCIAL' }),
    ]);
    expect(e.largest).toMatchObject({ dimension: 'deal', key: 'Whale' });
    expect(e.largest!.share).toBeCloseTo(0.8, 10);
  });

  it('catches a concentration that no single deal reveals', () => {
    // four modest schemes, all in one town: every deal looks small, the region
    // does not
    const e = aggregateExposure([
      pos({ name: 'A', facility: 2_000_000, region: 'BH', assetType: 'RESIDENTIAL' }),
      pos({ name: 'B', facility: 2_000_000, region: 'BH', assetType: 'INDUSTRIAL' }),
      pos({ name: 'C', facility: 2_000_000, region: 'BH', assetType: 'COMMERCIAL' }),
      pos({ name: 'D', facility: 2_000_000, region: 'SW', assetType: 'MIXED_USE' }),
    ]);
    expect(e.largest).toMatchObject({ dimension: 'region', key: 'BH' });
    expect(e.largest!.share).toBeCloseTo(0.75, 10);
    expect(e.byRegion[0]).toMatchObject({ key: 'BH', deals: 3 });
  });

  it('orders positions and groups by size, because that is the reading order', () => {
    const e = aggregateExposure([
      pos({ name: 'Small', facility: 500_000 }),
      pos({ name: 'Large', facility: 5_000_000 }),
      pos({ name: 'Medium', facility: 2_000_000 }),
    ]);
    expect(e.positions.map((p) => p.name)).toEqual(['Large', 'Medium', 'Small']);
  });

  it('adds up to the deals it summarises', () => {
    const positions = [pos({ name: 'A', facility: 1_234_567 }), pos({ name: 'B', facility: 7_654_321 })];
    const e = aggregateExposure(positions);
    // a portfolio total that disagreed with its parts would be worse than none
    expect(e.byAssetType.reduce((a, g) => a + g.facility, 0)).toBe(e.totals.facility);
    expect(e.byRegion.reduce((a, g) => a + g.share, 0)).toBeCloseTo(1, 10);
  });
});
