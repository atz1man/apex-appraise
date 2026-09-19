/**
 * A card that shows its name shows it to everyone.
 *
 * Every screen in this product is built from cards, and a card's header row
 * carries the section's name. Whether that name is a HEADING decides whether
 * a screen reader can find the section at all: "next heading" and the heading
 * list are the main way around an unfamiliar page, and a name rendered as a
 * styled `<span>` is, to that reader, not a name but a run of text somewhere
 * inside the page.
 *
 * Measured in the browser, signed in, over every route: THIRTEEN sections
 * showed a name that was in no heading. Five on the deal overview (the screen
 * a deal opens on), four on Comparables, and one each on the Pipeline board,
 * Scenarios, Benchmarking and the appraisal's result panel. Three of the
 * thirteen were the whole of a screen's outline below its `h1`, so a reader
 * jumping by heading found the page title and then nothing at all.
 *
 * `Panel`'s half of this is now the COMPILER's: its `title` is typed `string`
 * and it renders the heading itself, so a node title is a build error naming
 * the prop. What no type can see is a card built by hand — three of the
 * thirteen were `<section className="… bg-surface …">` written out in a route,
 * never touching the primitive. This is the rule for those, and it keeps
 * watching `Panel` too, because a guard that only covers the half already
 * covered is not a guard.
 *
 * WHAT IT DOES NOT REACH, on purpose: a card that lays its header out in some
 * other shape. `e2e/headings.spec.ts` finds a card's header row by the layout
 * both `Panel` and the hand-built cards use (a flex row that spaces its name
 * and its controls apart), because the alternative — "the first text in the
 * card" — reports a card whose body simply begins with a sentence, and a rule
 * that is wrong about ordinary markup gets an exemption list and then gets
 * ignored.
 */
export interface SectionHeader {
  /** The visible text of the header row, trimmed. */
  text: string;
  /** Is that text a heading, or inside one? */
  heading: boolean;
  /**
   * Does the row hold an editable control rather than a name?
   *
   * The appraisal's phase panels are titled by the field that RENAMES the
   * phase. A heading wrapped round a text box names nothing — the box is
   * named by its own `aria-label` — so an editable header is not a missing
   * heading, it is a different thing.
   */
  control: boolean;
}

/** A card showing a name that no heading carries. */
export function isUnnamedSection(header: SectionHeader): boolean {
  return header.text.trim() !== '' && !header.heading && !header.control;
}

/** Every card on a screen whose visible name is in no heading. */
export function unnamedSections(headers: readonly SectionHeader[]): SectionHeader[] {
  return headers.filter(isUnnamedSection);
}
