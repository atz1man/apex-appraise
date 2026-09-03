/**
 * What a jurisdiction calls things.
 *
 * This product was written for UK development valuation and its vocabulary is
 * UK vocabulary throughout — GDV, all-risks yield, SDLT, CIL, ft². Most of that
 * is simply what the words are; some of it is wrong outside these islands, and
 * the difference matters to a reader who has to trust the document.
 *
 * SCOPE, deliberately narrow: this changes WORDS and UNITS. It does not change
 * money — every figure stays in pounds — and it does not change arithmetic. The
 * engine's SDLT bands are England & Northern Ireland statute and stay exactly
 * that; what a region can say is that the local duty is called something else
 * and that this product does not compute it (`landTaxModelled`). Relabelling a
 * UK-band figure "stamp duty" and letting an Australian valuer read it as their
 * own would be worse than not offering the region at all.
 *
 * Its own module, and its own export path, for the reason `plan.ts` gives: the
 * browser needs it on every screen that prints an area, and the barrel is a
 * wall of zod.
 */

export const REGIONS = ['GB', 'US', 'AU'] as const;
export type Region = (typeof REGIONS)[number];

/** The unit floor areas are quoted in. Money never changes; this does. */
export type AreaUnit = 'ft²' | 'm²';

export interface RegionProfile {
  code: Region;
  /** how the setting names it to whoever is choosing */
  label: string;
  areaUnit: AreaUnit;
  terms: {
    /** the total the scheme is worth on completion */
    gdv: string;
    gdvLong: string;
    /** the rate an income is capitalised at */
    yield: string;
    allRisksYield: string;
    exitYield: string;
    /** the rent after voids, non-recoverables and deductions */
    netRent: string;
    /** duty on the land purchase */
    landTax: string;
    /** the infrastructure charge levied per square metre of new floorspace */
    infraLevy: string;
    /** the negotiated planning obligation alongside it */
    planningObligation: string;
  };
  /**
   * Whether the product's own band table IS the law here.
   *
   * True only for GB, where `sdltCommercial` implements the England & NI
   * non-residential slice bands. Everywhere else the acquisition duty is real
   * but this product does not model it, and a screen showing the figure has to
   * say so rather than print a UK number under a local name.
   */
  landTaxModelled: boolean;
  /**
   * Whether RICS Red Book wording applies as written.
   *
   * The valuation certificate quotes VPS 4 and names a RICS Registered Valuer.
   * That is a claim about a professional standard, so a region this product has
   * not written a certificate for says false and the report says which standard
   * it was drafted under. Only GB is true today; nothing in this change makes a
   * US or Australian certificate, and pretending otherwise on a signed document
   * is the one mistake here that could not be walked back.
   */
  redBook: boolean;
}

export const REGION_PROFILES: Record<Region, RegionProfile> = {
  GB: {
    code: 'GB',
    label: 'United Kingdom',
    areaUnit: 'ft²',
    terms: {
      gdv: 'GDV',
      gdvLong: 'Gross development value',
      yield: 'Yield',
      allRisksYield: 'All-risks yield',
      exitYield: 'Exit yield',
      netRent: 'Net rent (NOI)',
      landTax: 'SDLT',
      infraLevy: 'CIL',
      planningObligation: 'S106',
    },
    landTaxModelled: true,
    redBook: true,
  },
  US: {
    code: 'US',
    label: 'United States',
    areaUnit: 'ft²',
    terms: {
      // "GDV" is not a term of art in the US; the total a scheme sells for is
      // the sellout, and the rate an income capitalises at is the cap rate.
      gdv: 'Gross sellout',
      gdvLong: 'Gross sellout value',
      yield: 'Cap rate',
      allRisksYield: 'Going-in cap rate',
      exitYield: 'Exit cap rate',
      netRent: 'Net operating income (NOI)',
      landTax: 'Transfer tax',
      infraLevy: 'Impact fees',
      planningObligation: 'Development agreement',
    },
    landTaxModelled: false,
    redBook: false,
  },
  AU: {
    code: 'AU',
    label: 'Australia',
    // The one region where the unit changes. Australian practice quotes floor
    // areas and rates in square metres, without exception.
    areaUnit: 'm²',
    terms: {
      // Australian valuation vocabulary is UK-descended but not UK: the total
      // is the gross realisation, and the exit yield is the terminal yield.
      gdv: 'GRV',
      gdvLong: 'Gross realisation value',
      yield: 'Yield',
      allRisksYield: 'Adopted yield',
      exitYield: 'Terminal yield',
      netRent: 'Net income',
      landTax: 'Stamp duty',
      infraLevy: 'Developer contributions',
      planningObligation: 'Planning agreement',
    },
    landTaxModelled: false,
    redBook: false,
  },
};

/**
 * The profile for a stored code, falling back to the United Kingdom.
 *
 * A default rather than undefined, unlike the asset taxonomy, and the asymmetry
 * is deliberate: an unknown asset class has an honest fallback (print the code)
 * whereas a screen still has to print SOME unit, and the product's whole
 * vocabulary is UK. A workspace that has never chosen has chosen the UK.
 */
export function regionProfile(code: string | null | undefined): RegionProfile {
  return REGION_PROFILES[(code ?? '') as Region] ?? REGION_PROFILES.GB;
}

export const DEFAULT_REGION: Region = 'GB';
