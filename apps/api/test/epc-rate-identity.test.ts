import { afterEach, describe, expect, it, vi } from 'vitest';
import { analysedPsf, SQFT_PER_SQM } from '@apex/appraisal-engine';
import { fetchEpc, matchPsf, type EpcRecord, type SoldPrice } from '../src/opendata.js';

const sold: SoldPrice = {
  address: 'Flat 2, 12 Test Street, Bournemouth', postcode: 'BH8 8EW', price: 425000,
  date: '2026-02-01', propertyType: 'flat-maisonette', newBuild: false, estateType: 'leasehold', source: 'HM Land Registry',
};
const epc: EpcRecord = {
  address: sold.address, postcode: sold.postcode, certificateNumber: 'certificate-a', floorAreaSqm: 65,
  rating: 'C', propertyType: 'Flat', inspectionDate: '2025-01-01', source: 'EPC Register',
};

afterEach(() => vi.unstubAllGlobals());

describe('sale and EPC identity', () => {
  it('uses the shared engine only after exact address and postcode identity', () => {
    expect(matchPsf(sold, [{ ...epc, address: ' flat 2  12 test street, bournemouth ', postcode: 'bh88ew' }])).toBe(analysedPsf(sold.price, epc.floorAreaSqm * SQFT_PER_SQM));
  });

  it.each([
    ['same house number on another street', { address: 'Flat 2, 12 Other Street, Bournemouth' }],
    ['flat number confused with a house number', { address: '2 Test Street, Bournemouth' }],
    ['another flat in the building', { address: 'Flat 3, 12 Test Street, Bournemouth' }],
    ['same address in another postcode', { postcode: 'BH8 8EX' }],
    ['a postcode not supplied by an old record', { postcode: undefined }],
    ['incomplete address with no town', { address: 'Flat 2, 12 Test Street' }],
    ['non-finite floor area', { floorAreaSqm: Number.POSITIVE_INFINITY }],
  ])('leaves the rate unknown for %s', (_reason, changes) => {
    expect(matchPsf(sold, [{ ...epc, ...changes }])).toBeNull();
  });

  it('refuses ambiguous certificates even when the first one looks usable', () => {
    expect(matchPsf(sold, [epc, { ...epc, certificateNumber: 'certificate-b', floorAreaSqm: 80 }])).toBeNull();
    expect(matchPsf(sold, [epc, { ...epc, certificateNumber: 'certificate-b' }])).toBeNull();
  });

  it('does not print a rate from an invalid sale price', () => {
    expect(matchPsf({ ...sold, price: Number.NaN }, [epc])).toBeNull();
    expect(matchPsf({ ...sold, price: 0 }, [epc])).toBeNull();
  });

  it('retains certificate and postcode identity from the EPC search', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify({ data:
      url.includes('/certificate?') ? { total_floor_area: 65 }
        : url.includes('/non-domestic/') ? []
          : [{ certificateNumber: 'certificate-a', postcode: 'BH8 8EW', addressLine1: 'Flat 2', addressLine2: '12 Test Street', addressLine3: 'Bournemouth' }],
    }))));
    const result = await fetchEpc('BH8 8EW', { key: 'test-fixture-token' });
    expect(result.status).toBe('ok');
    expect(result.records[0]).toMatchObject({ postcode: 'BH8 8EW', certificateNumber: 'certificate-a', floorAreaSqm: 65 });
    expect(matchPsf(sold, result.records)).toBe(analysedPsf(sold.price, 65 * SQFT_PER_SQM));
  });
});
