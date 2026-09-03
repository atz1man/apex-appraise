import { postcodeArea } from '@apex/appraisal-engine';

/**
 * Where in the United Kingdom a scheme is — the ONE table.
 *
 * It exists because the same question was being answered in four places, by
 * four different lists, and three of them defaulted to the South West when they
 * did not know:
 *
 *   - `benchmark-feed.ts`  a regex over the ADDRESS TEXT matching Dorset,
 *                          Hampshire, the West Country, London, and a handful
 *                          of home counties — `?? 'South West'` for everything
 *                          else.
 *   - `opendata.ts`        `HPI_REGION_SLUGS`, which knows all twelve real
 *                          regions, and `?? 'south-west'` for an unknown one.
 *   - `Benchmarking.tsx`   four regions offered in the cohort picker.
 *   - and the pool itself, which stores whatever string it is handed.
 *
 * Measured against the feed as it stood, over sixteen addresses: fourteen were
 * filed as SOUTH WEST, including Manchester, Leeds, Birmingham, Sheffield,
 * Liverpool, Newcastle, Derby, Edinburgh, Cardiff, Belfast, Sydney, San
 * Francisco — and a deal with no address at all. "Midlands" was offered as a
 * cohort and could never be produced by the feed, so every Midlands scheme
 * silently inflated the South West median instead.
 *
 * That matters more here than a mislabelled row usually would. The benchmark
 * pool is SHARED: its medians are read by other firms as market evidence, and a
 * Birmingham scheme's £/ft² filed under the South West is a wrong number in
 * somebody else's appraisal.
 *
 * So the rule is the one `postcodeArea` already follows two packages away, and
 * which the feed did not: SAY YOU DO NOT KNOW. Every function here answers null
 * rather than guessing, and a deal that cannot be placed contributes nothing.
 */

export interface UkRegion {
  /** how the pool, the cohort picker and the audit trail all name it */
  name: string;
  /** the region slug in HM Land Registry's UK House Price Index */
  hpiSlug: string;
  /**
   * The postcode areas that fall in it — the letters before the first digit,
   * which is what `postcodeArea()` returns.
   *
   * DELIBERATELY INCOMPLETE. An area that straddles two regions is left out
   * rather than assigned to the one it mostly falls in, because the whole point
   * of this table is that a figure is filed where it belongs or not at all.
   * Left out on purpose: the Greater London boundary (BR, CR, DA, EN, HA, IG,
   * KT, RM, SM, TW, UB, WD), PE across the East of England and the East
   * Midlands, HP across the South East and the East, SY across the West
   * Midlands and Wales, and CH across the North West and Wales.
   */
  postcodeAreas: readonly string[];
}

export const UK_REGIONS: readonly UkRegion[] = [
  { name: 'London', hpiSlug: 'london', postcodeAreas: ['E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC'] },
  { name: 'South East', hpiSlug: 'south-east', postcodeAreas: ['BN', 'CT', 'GU', 'ME', 'MK', 'OX', 'PO', 'RG', 'RH', 'SL', 'SO', 'TN'] },
  { name: 'South West', hpiSlug: 'south-west', postcodeAreas: ['BA', 'BH', 'BS', 'DT', 'EX', 'GL', 'PL', 'SN', 'SP', 'TA', 'TQ', 'TR'] },
  { name: 'East of England', hpiSlug: 'east-of-england', postcodeAreas: ['AL', 'CB', 'CM', 'CO', 'IP', 'LU', 'NR', 'SG', 'SS'] },
  { name: 'West Midlands', hpiSlug: 'west-midlands', postcodeAreas: ['B', 'CV', 'DY', 'HR', 'ST', 'TF', 'WR', 'WS', 'WV'] },
  { name: 'East Midlands', hpiSlug: 'east-midlands', postcodeAreas: ['DE', 'LE', 'LN', 'NG', 'NN'] },
  { name: 'Yorkshire and The Humber', hpiSlug: 'yorkshire-and-the-humber', postcodeAreas: ['BD', 'DN', 'HD', 'HG', 'HU', 'HX', 'LS', 'S', 'WF', 'YO'] },
  { name: 'North West', hpiSlug: 'north-west', postcodeAreas: ['BB', 'BL', 'CA', 'CW', 'FY', 'L', 'LA', 'M', 'OL', 'PR', 'SK', 'WA', 'WN'] },
  { name: 'North East', hpiSlug: 'north-east', postcodeAreas: ['DH', 'DL', 'NE', 'SR', 'TS'] },
  { name: 'Wales', hpiSlug: 'wales', postcodeAreas: ['CF', 'LD', 'LL', 'NP', 'SA'] },
  { name: 'Scotland', hpiSlug: 'scotland', postcodeAreas: ['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE'] },
  { name: 'Northern Ireland', hpiSlug: 'northern-ireland', postcodeAreas: ['BT'] },
] as const;

export const UK_REGION_NAMES: readonly string[] = UK_REGIONS.map((r) => r.name);

const BY_AREA = new Map<string, string>(UK_REGIONS.flatMap((r) => r.postcodeAreas.map((a) => [a, r.name] as const)));

/**
 * The region a postcode falls in, or null.
 *
 * Through `postcodeArea()`, which is the engine's, so the letters-before-the-
 * first-digit rule is not written down twice. "BH15 1JF" → "BH" → South West;
 * "SW1A 1AA" → "SW" → London, and not the South West, because the rule takes
 * every letter before the digit rather than the first one.
 */
export function regionForPostcode(postcode: string | null | undefined): string | null {
  if (!postcode) return null;
  const area = postcodeArea(postcode);
  return area === 'Unknown' ? null : (BY_AREA.get(area) ?? null);
}

/**
 * The region an address NAMES, or null.
 *
 * A narrow fallback for a deal with no postcode, and narrow is the point: it
 * matches city and county names, and a city that is not on the list answers
 * null rather than the nearest guess. The order matters where a name appears
 * inside another — "Newcastle upon Tyne" is the North East and "Newcastle-
 * under-Lyme" is the West Midlands, so the more specific pattern is tested
 * first.
 */
const BY_NAME: ReadonlyArray<readonly [RegExp, string]> = [
  [/\blondon\b/i, 'London'],
  [/\b(brighton|canterbury|guildford|maidstone|milton keynes|oxford|portsmouth|reading|slough|southampton|tunbridge)\b/i, 'South East'],
  [/\b(bath|bournemouth|bristol|christchurch|dorchester|dorset|exeter|gloucester|plymouth|poole|salisbury|somerset|swindon|taunton|torquay|truro|wimborne|ringwood|devon|cornwall)\b/i, 'South West'],
  [/\b(cambridge|chelmsford|colchester|ipswich|luton|norwich|st albans|southend)\b/i, 'East of England'],
  [/\bnewcastle[- ]under[- ]lyme\b/i, 'West Midlands'],
  [/\b(birmingham|coventry|dudley|hereford|stoke[- ]on[- ]trent|telford|walsall|wolverhampton|worcester)\b/i, 'West Midlands'],
  [/\b(derby|leicester|lincoln|northampton|nottingham)\b/i, 'East Midlands'],
  [/\b(bradford|doncaster|halifax|huddersfield|hull|harrogate|leeds|sheffield|wakefield|york)\b/i, 'Yorkshire and The Humber'],
  [/\b(blackburn|blackpool|bolton|carlisle|crewe|lancaster|liverpool|manchester|oldham|preston|stockport|warrington|wigan)\b/i, 'North West'],
  [/\b(durham|darlington|gateshead|middlesbrough|newcastle|sunderland)\b/i, 'North East'],
  [/\b(cardiff|newport|swansea|wrexham|wales)\b/i, 'Wales'],
  [/\b(aberdeen|dundee|edinburgh|glasgow|inverness|perth|stirling|scotland)\b/i, 'Scotland'],
  [/\b(belfast|londonderry)\b/i, 'Northern Ireland'],
];

export function regionForAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  return BY_NAME.find(([re]) => re.test(address))?.[1] ?? null;
}

/**
 * Where a deal is: its postcode if it has one, the words of its address if not,
 * and null when neither says.
 *
 * Postcode FIRST because it is structured and an address is prose — "Wellington
 * Street, Leeds" and "Leeds Road, Bradford" name the same city and mean
 * different regions, and only one of them is where the scheme is.
 */
export function regionForDeal(deal: { postcode?: string | null; address?: string | null }): string | null {
  return regionForPostcode(deal.postcode) ?? regionForAddress(deal.address);
}

/** The UKHPI slug for a region name, or null — never another region's. */
export function hpiSlugFor(region: string): string | null {
  return UK_REGIONS.find((r) => r.name === region)?.hpiSlug ?? null;
}
