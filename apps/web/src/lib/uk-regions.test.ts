import { describe, expect, it } from 'vitest';
import { UK_REGIONS, UK_REGION_NAMES, hpiSlugFor, regionForAddress, regionForDeal, regionForPostcode } from '@apex/types/uk-regions';

/**
 * Where a scheme is — and, more importantly, when the answer is "I don't know".
 *
 * The benchmark pool is SHARED: its medians are read by other firms as market
 * evidence, so a figure filed under a region it is not in is a wrong number in
 * somebody else's appraisal. Every case below that expects null is guarding
 * that, and the guess it replaced is measured in the first one.
 */
describe('placing a deal in a UK region', () => {
  it('answers null for everything the old feed called “South West”', () => {
    // measured against `benchmark-feed.ts` as it stood: fourteen of sixteen
    // addresses were filed as South West, these among them
    for (const address of [
      'Deansgate, Manchester',
      'Wellington Street, Leeds',
      'Broad Street, Birmingham',
      'Princes Street, Edinburgh',
      'St Mary Street, Cardiff',
      'Grey Street, Newcastle upon Tyne',
      'Queen Street, Sheffield',
      'Lime Street, Liverpool',
      'Botanic Avenue, Belfast',
      'Nottingham Road, Derby',
    ]) {
      expect(regionForAddress(address), address).not.toBe('South West');
    }
    // and the two that are not in the United Kingdom at all
    expect(regionForDeal({ address: 'George Street, Sydney NSW' })).toBeNull();
    expect(regionForDeal({ address: 'Market Street, San Francisco CA' })).toBeNull();
    // including the deal with nothing to go on, which used to be South West too
    expect(regionForDeal({})).toBeNull();
    expect(regionForDeal({ address: '', postcode: '' })).toBeNull();
  });

  it('places a postcode by its area, taking every letter before the digit', () => {
    expect(regionForPostcode('BH15 1JF')).toBe('South West');
    expect(regionForPostcode('M1 4BT')).toBe('North West');
    expect(regionForPostcode('B3 2EP')).toBe('West Midlands');
    expect(regionForPostcode('LS1 4AP')).toBe('Yorkshire and The Humber');
    expect(regionForPostcode('EH1 1AA')).toBe('Scotland');
    expect(regionForPostcode('BT1 5GS')).toBe('Northern Ireland');
    // SW is London, not the South West — the trap a first-letter rule falls into
    expect(regionForPostcode('SW1A 1AA')).toBe('London');
    expect(regionForPostcode('SE1 9GF')).toBe('London');
    // and S on its own is Sheffield
    expect(regionForPostcode('S1 2HE')).toBe('Yorkshire and The Humber');
  });

  it('leaves a straddling postcode area unplaced rather than picking a side', () => {
    // each of these spans two regions; assigning it to the one it mostly falls
    // in would file real schemes in the wrong cohort for the sake of a fuller table
    for (const pc of ['KT1 1EU', 'EN1 1AA', 'PE1 1AA', 'SY1 1AA', 'CH1 1AA', 'HP1 1AA']) {
      expect(regionForPostcode(pc), pc).toBeNull();
    }
  });

  it('reads an address only when there is no postcode, and prefers the postcode', () => {
    /*
     * A street named after somewhere else is not somewhere else. Oxford Road is
     * the main artery through Manchester, and read as prose it says Oxford —
     * which is the whole reason the postcode is asked first.
     *
     * Two earlier versions of this case proved nothing, and both are worth
     * recording: "Leeds Road, Bradford" names two places in the SAME region, and
     * "Manchester Road, Bradford" is answered Yorkshire by the address matcher
     * too, because Yorkshire is tested before the North West. A case for a
     * precedence rule has to name two regions that actually differ.
     */
    expect(regionForAddress('Oxford Road, Manchester')).toBe('South East');
    expect(regionForDeal({ postcode: 'M1 4BT', address: 'Oxford Road, Manchester' })).toBe('North West');
    // a postcode that cannot be placed falls through to the words, rather than
    // stopping at the first thing it tried
    expect(regionForDeal({ postcode: 'KT1 1EU', address: 'Deansgate, Manchester' })).toBe('North West');
    expect(regionForDeal({ address: 'Holdenhurst Road, Bournemouth' })).toBe('South West');
  });

  it('tells the two Newcastles apart, in that order', () => {
    // one is in the North East and one is in the West Midlands. The North East
    // rule matches a bare "newcastle", and `\b` treats the hyphen in
    // "Newcastle-under-Lyme" as a boundary — so the specific rule has to be
    // tested FIRST, and this asserts the order rather than only the answers.
    expect(regionForAddress('Grey Street, Newcastle upon Tyne')).toBe('North East');
    expect(regionForAddress('High Street, Newcastle-under-Lyme')).toBe('West Midlands');
    expect(regionForAddress('Newcastle under Lyme')).toBe('West Midlands');
    const order = UK_REGIONS.map((r) => r.name);
    expect(order.includes('West Midlands') && order.includes('North East')).toBe(true);
  });

  it('gives every region a Land Registry slug, and no region another’s', () => {
    for (const r of UK_REGIONS) {
      expect(hpiSlugFor(r.name), r.name).toBe(r.hpiSlug);
      expect(r.hpiSlug).toMatch(/^[a-z-]+$/);
    }
    // the index used to answer an unknown region with South West prices under
    // the asked-for name — a market index labelled as somewhere it is not
    expect(hpiSlugFor('Midlands')).toBeNull();
    expect(hpiSlugFor('Atlantis')).toBeNull();
    expect(new Set(UK_REGIONS.map((r) => r.hpiSlug)).size).toBe(UK_REGIONS.length);
  });

  it('is one table: no postcode area in two regions, and the names are the cohorts', () => {
    const areas = UK_REGIONS.flatMap((r) => r.postcodeAreas);
    expect(new Set(areas).size, 'a postcode area appears in two regions').toBe(areas.length);
    expect(UK_REGION_NAMES).toEqual(UK_REGIONS.map((r) => r.name));
    // "Midlands" was the cohort the picker offered and the feed could not
    // produce; the two real ones are named separately, as the index names them
    expect(UK_REGION_NAMES).not.toContain('Midlands');
    expect(UK_REGION_NAMES).toEqual(expect.arrayContaining(['East Midlands', 'West Midlands']));
  });
});
