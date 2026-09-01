import { describe, expect, it } from 'vitest';
import { HOUSE_ASSUMPTIONS, manualDefaultsFor, manualIsRunnable } from './auto-defaults';

const parkstone = { name: 'Parkstone Mews', address: 'Ashley Cross, Poole', postcode: 'BH14 0JW', assetType: 'RESIDENTIAL' };

describe('the manual form starts from the deal, not from the demo scheme', () => {
  it('names the deal and its address and asset type', () => {
    const m = manualDefaultsFor(parkstone);
    expect(m.scheme).toBe('Parkstone Mews');
    expect(m.address).toBe('Ashley Cross, Poole, BH14 0JW');
    expect(m.assetType).toBe('Residential');
  });

  it('carries no fact about any scheme: no units, no asking price, no planning obligations', () => {
    const m = manualDefaultsFor(parkstone);
    expect(m.units).toEqual([]);
    expect(m.asking).toBe(0);
    expect(m.cilPerSqm).toBe(0);
    expect(m.s106).toBe(0);
    expect(m.planningStatus).toBe('');
    // and nowhere in it the demo scheme
    expect(JSON.stringify(m)).not.toMatch(/Northgate|Holdenhurst|Trade counter|B8 warehouse|Mezzanine/);
  });

  it('keeps the house assumptions, which are assumptions and not facts', () => {
    const m = manualDefaultsFor(parkstone);
    expect(m.efficiency).toBe(HOUSE_ASSUMPTIONS.efficiency);
    expect(m.targetProfit).toBe(HOUSE_ASSUMPTIONS.targetProfit);
    expect(m.finance).toEqual(HOUSE_ASSUMPTIONS.finance);
    // a copy, not the shared object
    m.finance.ltc = 1;
    expect(HOUSE_ASSUMPTIONS.finance.ltc).toBe(60);
  });

  it('is blank, not the demo scheme, before the deal has loaded', () => {
    const m = manualDefaultsFor(null);
    expect(m.scheme).toBe('');
    expect(m.address).toBe('');
    expect(JSON.stringify(m)).not.toMatch(/Northgate/);
  });

  it('spells an unknown asset type as it is rather than dropping it', () => {
    expect(manualDefaultsFor({ ...parkstone, assetType: 'LEISURE' }).assetType).toBe('LEISURE');
    expect(manualDefaultsFor({ ...parkstone, postcode: null }).address).toBe('Ashley Cross, Poole');
  });
});

describe('a scheme can be run', () => {
  it('only once a unit has a count, an area and a value', () => {
    expect(manualIsRunnable({ units: [] })).toBe(false);
    expect(manualIsRunnable({ units: [{ label: 'Flat', count: 1, area: 0, value: 400 }] })).toBe(false);
    expect(manualIsRunnable({ units: [{ label: 'Flat', count: 1, area: 700, value: 0 }] })).toBe(false);
    expect(manualIsRunnable({ units: [{ label: 'Flat', count: 0, area: 700, value: 400 }] })).toBe(false);
    expect(manualIsRunnable({ units: [{ label: '', count: 1, area: 700, value: 400 }] })).toBe(true);
  });
});
