/**
 * What kind of asset a deal is — the ONE table.
 *
 * A file of its own, exported as `@apex/types/asset-classes` and re-exported
 * through the barrel, for the reason `plan.ts` gives: the browser needs this
 * and `index.ts` is a wall of zod, so importing the taxonomy through the barrel
 * would ship 58 kB of zod to every screen that wants to print "Mixed-use".
 *
 * It exists because the four asset types were spelled out in SIX places, each a
 * hand-kept list, and none of them knew about the others:
 *
 *   - `web/src/lib/auto-defaults.ts`   ASSET_LABEL     "Mixed use"
 *   - `web/src/routes/Board.tsx`       FILTERS         "Mixed-use"
 *   - `web/src/routes/Benchmarking.tsx` USE_CLASSES    "Mixed-use"
 *   - `web/src/routes/RedBookReport.tsx` assetLabel    "Mixed-use"  + a use-class table
 *   - `ui-tokens/src/tokens.ts`        assetTypeTag    the chip colours
 *   - and four more screens that had no table at all and derived a label from
 *     the ENUM NAME: `type.replace('_', '-')`, `.replace('_', ' / ')`. That
 *     works for exactly the codes it was written against — one underscore, and
 *     a name that reads acceptably in capitals. `CO_LIVING` renders as
 *     "CO-LIVING"; a two-underscore code would keep the second underscore.
 *     A label derived from a database value is not a label, it is a coincidence.
 *
 * So adding an asset class used to be nine edits, and the count is the point:
 * the operated classes below (build-to-rent, student, co-living, care homes,
 * hotels) are ONE entry each here, and every surface follows.
 *
 * The four original codes keep their exact stored values and their exact
 * colours, so no existing row, chip or report moves.
 */

export interface AssetClass {
  /** the value stored on `Deal.assetType` and `BenchmarkPoint.useClass` */
  code: string;
  /** what a person calls it, sentence case: card filters, forms, prose */
  label: string;
  /** the mono chip on a deal card — short, upper case, no underscores */
  tag: string;
  /** how a valuation certificate names the property type */
  reportLabel: string;
  /**
   * England & Wales planning use class, as a certificate states it. The Town and
   * Country Planning (Use Classes) Order 1987 as amended in 2020; the operated
   * classes are where this stops being obvious, so each carries its reasoning.
   */
  useClass: string;
  /**
   * Which chip colour family it takes. Grouping by family rather than giving
   * every class its own hue is deliberate: the chip's TEXT already says which
   * class it is, and nine hues on one board is noise. The colour says which
   * kind of thing it is, and the reader learns four, not nine.
   */
  family: AssetFamily;
  /**
   * The value is a capitalisation of an operating income, not the sale of what
   * gets built. True for every operated class and false for the four
   * development classes — a development scheme may still carry a held element
   * (the demo's Northgate does), which is why this is about where the value
   * COMES from rather than whether a rent roll is allowed.
   */
  incomeLed: boolean;
  /**
   * Where a held element starts, before anybody types anything: the rent-roll
   * line's name and the all-risks yield. Assumptions, not facts — the same
   * standing as `HOUSE_ASSUMPTIONS` in the web app's auto-defaults, and for the
   * same reason: they are what a valuer would type first, and typing "Let space
   * @ 7%" on a care home is not a starting point, it is a correction.
   *
   * Every class has one, including the development classes, because a
   * development scheme can take on a held element too. Theirs is exactly what
   * the appraisal screen hard-coded before this table existed, so no figure on
   * any existing scheme moves.
   */
  startingIncome: { lineLabel: string; yieldPct: number };
}

export type AssetFamily = 'industrial' | 'residential' | 'commercial' | 'mixed';

/**
 * Development classes first, then the operated ones, and that order is what
 * every filter and dropdown renders — a firm that builds and sells sees its own
 * work at the top.
 */
export const ASSET_CLASSES = [
  {
    code: 'INDUSTRIAL',
    label: 'Industrial',
    tag: 'INDUSTRIAL',
    reportLabel: 'Industrial / trade',
    useClass: 'B2 / B8',
    family: 'industrial',
    incomeLed: false,
    startingIncome: { lineLabel: 'Let space', yieldPct: 7 },
  },
  {
    code: 'RESIDENTIAL',
    label: 'Residential',
    tag: 'RESIDENTIAL',
    reportLabel: 'Residential dwelling',
    useClass: 'C3 — Dwelling',
    family: 'residential',
    incomeLed: false,
    startingIncome: { lineLabel: 'Let space', yieldPct: 7 },
  },
  {
    code: 'COMMERCIAL',
    label: 'Commercial',
    tag: 'COMMERCIAL',
    reportLabel: 'Commercial',
    useClass: 'E — Commercial',
    family: 'commercial',
    incomeLed: false,
    startingIncome: { lineLabel: 'Let space', yieldPct: 7 },
  },
  {
    code: 'MIXED_USE',
    label: 'Mixed-use',
    tag: 'MIXED-USE',
    reportLabel: 'Mixed-use',
    useClass: 'Sui generis',
    family: 'mixed',
    incomeLed: false,
    startingIncome: { lineLabel: 'Let space', yieldPct: 7 },
  },

  // ---- Operated assets: held and run, valued on the income they throw off ----
  {
    code: 'BTR',
    label: 'Build to rent',
    tag: 'BTR',
    reportLabel: 'Build-to-rent residential',
    // Purpose-built rented flats are dwellinghouses like any other; what makes
    // them BTR is the covenant and the management, not the use class.
    useClass: 'C3 — Dwelling',
    family: 'residential',
    incomeLed: true,
    startingIncome: { lineLabel: 'Apartments', yieldPct: 4.25 },
  },
  {
    code: 'STUDENT',
    label: 'Student accommodation',
    tag: 'STUDENT',
    reportLabel: 'Purpose-built student accommodation',
    // PBSA at scale falls outside C3 and C4 and is consented as sui generis;
    // only a small shared house would be C4.
    useClass: 'Sui generis',
    family: 'residential',
    incomeLed: true,
    startingIncome: { lineLabel: 'Study bedrooms', yieldPct: 5.25 },
  },
  {
    code: 'CO_LIVING',
    label: 'Co-living',
    tag: 'CO-LIVING',
    reportLabel: 'Co-living scheme',
    // Large-format co-living is neither C3 nor C4 — it is consented as sui
    // generis, which is why it gets its own class rather than sitting under
    // residential.
    useClass: 'Sui generis',
    family: 'residential',
    incomeLed: true,
    startingIncome: { lineLabel: 'Co-living rooms', yieldPct: 5 },
  },
  {
    code: 'CARE_HOME',
    label: 'Care home',
    tag: 'CARE-HOME',
    reportLabel: 'Care home',
    useClass: 'C2 — Residential institution',
    family: 'commercial',
    incomeLed: true,
    startingIncome: { lineLabel: 'Beds', yieldPct: 6 },
  },
  {
    code: 'HOTEL',
    label: 'Hotel',
    tag: 'HOTEL',
    reportLabel: 'Hotel',
    useClass: 'C1 — Hotel',
    family: 'commercial',
    incomeLed: true,
    startingIncome: { lineLabel: 'Keys', yieldPct: 7 },
  },
] as const satisfies readonly AssetClass[];

export type AssetType = (typeof ASSET_CLASSES)[number]['code'];

/**
 * The stored codes, in table order. Derived rather than written out, so the
 * zod enum, the database comment and every dropdown cannot disagree with the
 * table above. The cast is the one zod needs — `z.enum` wants a non-empty
 * tuple and `.map` cannot prove the table is non-empty.
 */
export const ASSET_TYPES = ASSET_CLASSES.map((c) => c.code) as unknown as readonly [AssetType, ...AssetType[]];

const BY_CODE = new Map<string, AssetClass>(ASSET_CLASSES.map((c) => [c.code, c]));

/**
 * The class a stored code names, or undefined.
 *
 * Undefined rather than a default, on purpose. Every caller here has somewhere
 * honest to fall back to — the raw code, an em dash, the neutral chip — and a
 * lookup that silently answered INDUSTRIAL (which the chip table did) prints a
 * confident wrong label for a code nobody has added yet.
 */
export function assetClass(code: string | null | undefined): AssetClass | undefined {
  return code == null ? undefined : BY_CODE.get(code);
}

/** The label for a code, falling back to the code itself so nothing renders blank. */
export function assetLabel(code: string | null | undefined): string {
  return assetClass(code)?.label ?? code ?? '';
}

/** True when the value comes from capitalising an income rather than selling units. */
export function isIncomeLed(code: string | null | undefined): boolean {
  return assetClass(code)?.incomeLed ?? false;
}
