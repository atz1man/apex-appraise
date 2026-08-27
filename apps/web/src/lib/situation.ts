/**
 * What the "Situation & locality" panel of a Red Book report may state.
 *
 * The panel was fixed prose, printed identically for every property. Measured
 * on the demo workspace, one signed valuation of a deal with no inspection on
 * file said all four of these:
 *
 *   page 2  "No inspection is recorded for this property."
 *   page 3  "...no adverse environmental factors were noted on inspection."
 *   page 3  "the site is identified as Flood Zone 1 (low risk)"
 *   page 7  "the property is not in an area of material flood risk"  (assumed)
 *
 * The first two contradict each other outright: the certificate discloses that
 * nobody attended, and two pages later the report reports what was seen there.
 * The second two contradict each other in the more dangerous direction — the
 * declaration page correctly says flood risk is ASSUMED, while page 3 says the
 * zone was IDENTIFIED, which is a statement that somebody looked it up. Nobody
 * had; "Flood Zone 1 (low risk)" was a literal in the component.
 *
 * The distinction this draws, and the reason the rest of the paragraph stays:
 * an opinion the valuer signs for ("occupier demand in the immediate locality
 * is considered good") is theirs to hold and is attributed to them on the page.
 * A named Environment Agency classification, and a finding from an inspection,
 * are facts about the world that a reader would reasonably believe somebody
 * established. Those are the two this stops asserting.
 *
 * The product does hold real flood data — `sitePack.get` fetches the
 * Environment Agency and planning.data.gov.uk — but it is live open data behind
 * a four-second deadline, and this report has to render offline and print. So
 * this states the position the declaration page already takes rather than
 * blocking a signed document on a third-party fetch.
 */

export function situationStatement(input: { address: string | null; inspectedOn: string | null }): string {
  const { address, inspectedOn } = input;
  const place = address?.trim() ? `at ${address.trim()}` : 'on the subject site';

  /**
   * Referred to the general assumptions rather than restated, so there is one
   * statement of the position in the document instead of two that can drift
   * apart — which is how the contradiction above arose in the first place.
   */
  const environmental =
    'Flood risk, contamination and ground stability have not been investigated for this report and are covered by the general assumptions set out below.';

  /**
   * The same signal the certificate's "Inspection date" panel reads, so the two
   * pages cannot disagree about whether anybody attended — which is the whole
   * defect.
   */
  const seen = inspectedOn
    ? `The property was inspected on ${inspectedOn}.`
    : 'No inspection is recorded for this property, so nothing has been observed on site.';

  return [
    `The property occupies an established position ${place}.`,
    'Local amenities and arterial transport links are within convenient reach, and occupier demand in the immediate locality is considered good.',
    "The surrounding pattern of use is consistent with the subject's class.",
    environmental,
    seen,
  ].join(' ');
}
