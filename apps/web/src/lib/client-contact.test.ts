import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_FACING } from './page-title';

/**
 * A screen a client reads shows no contact detail that is not in the record.
 *
 * The buyer portal's contact card was typed into the page: "Sarah Reeve · Sales
 * progressor — your point of contact through to completion", initials SR,
 * `mailto:sales@apexappraise.co.uk`, `tel:+441202555555`. Nobody of that name
 * exists; the address is the SOFTWARE VENDOR's rather than the developer's; and
 * 555555 is the UK fictional-number range. A buyer who has reserved a plot and
 * paid a deposit was handed a made-up person, an inbox at the wrong company and
 * a number that does not ring — and if they emailed it, their question about
 * their own house purchase arrived at a software firm with no account to look up.
 *
 * The INVESTOR portal beside it already did this properly (`investors.myContact`
 * — "the real administrator at the managing firm"), so the convention existed and
 * this one screen was left with the design mock still in it. That is what makes a
 * rule worth writing rather than a fix worth making: the right pattern was two
 * files away and nothing noticed the difference.
 *
 * The screens are `CLIENT_FACING` out of `page-title.ts` — the same set that
 * decides which tabs carry no product suffix, for the same reason ("the product
 * is ours, what the client looks at is theirs"). Read from there rather than
 * copied, so a fourth client-facing screen is covered the day it is added.
 *
 * What this canNOT see, and it is the larger half: an invented NAME. "Sarah
 * Reeve" is a string like any other, and no static rule separates a fabricated
 * person from a legitimate label. A contact DETAIL is matchable because its
 * shape is a protocol, so that is what the rule asks about — and in practice the
 * invented person and the invented mailto arrived together, which is the usual
 * way a design mock survives into a product.
 */

const SRC = join(__dirname, '..');
const APP = readFileSync(join(SRC, 'App.tsx'), 'utf8');

/**
 * Route pattern → component → file, read here rather than imported.
 *
 * This is the FOURTH local reader of `App.tsx`'s route table —
 * `route-reachable`, `page-title` and `screen-heading` each have their own — and
 * that is the convention rather than an oversight: what must not be copied is
 * the ANSWER (which routes exist), and none of these keeps one. Each asks a
 * different question of the same source, so each reads the shape it needs.
 * Importing `screen-heading.test.ts` for its exported helpers was the first
 * attempt and it re-ran that file's seven tests inside this one, which inflates
 * a count and double-reports a failure.
 */
const screensWithFiles = (): Array<{ route: string; file: string }> => {
  const files = Object.fromEntries(
    [...APP.matchAll(/const (\w+) = lazy\(\(\) => import\('\.\/routes\/(\w+)'\)/g)].map((m) => [m[1]!, `${m[2]}.tsx`]),
  );
  // `<Protected portal="buyer">` wraps both portals and carries props, so the
  // wrapper is skipped rather than matched — it has no file of its own
  return [...APP.matchAll(/<Route\s+path="([^"]+)"\s+element=\{(?:<Protected\b[^>]*>)?<([A-Za-z]+)/g)]
    .map((m) => ({ route: m[1]!, file: files[m[2]!] ?? '' }))
    .filter((s) => !!s.file);
};

const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * `tel:` or `mailto:` followed by a LITERAL rather than an interpolation.
 *
 * `href={`mailto:${contact.email}`}` is an address out of the record and is
 * exactly what the fix does; `href="mailto:sales@…"` is one somebody typed. The
 * distinction is the `${`, which is why the matcher reads what follows the colon
 * instead of looking for the scheme alone.
 *
 * Comments become blank space first, or this file's own explanation of the defect
 * registers as the defect — `route-reachable` and `announcements` each learned
 * that after a sweep passed on the strength of its own prose.
 */
const HARDCODED = /\b(tel|mailto):(?!\$\{)([^"'`\s}]+)/g;

const hardcodedContacts = (src: string): string[] =>
  [...stripComments(src).matchAll(HARDCODED)].map((m) => `${m[1]}:${m[2]}`);

/** Client-facing route pattern → its source file. */
const clientScreens = () => screensWithFiles().filter((s) => CLIENT_FACING.has(s.route));

describe('a client-facing screen names nobody it has not been told about', () => {
  it('finds the client-facing screens, from the real route table', () => {
    const screens = clientScreens();
    expect(
      screens.map((s) => s.route).sort(),
      'the client-facing set and the route table have drifted apart',
    ).toEqual([...CLIENT_FACING].sort());
    for (const s of screens) expect(s.file, `${s.route} resolves to no file`).toBeTruthy();
  });

  it('shows no telephone number or email address that was typed into the page', () => {
    const offenders = clientScreens().flatMap(({ route, file }) => {
      const src = readFileSync(join(SRC, 'routes', file), 'utf8');
      return hardcodedContacts(src).map((c) => `${route} (${file}): ${c}`);
    });
    expect(
      offenders,
      'A client reads these screens. A contact detail here is a promise about who answers, so it comes from the '
        + `record — the deal's owner, the firm's administrator — or it is not shown.\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  describe('the matcher itself', () => {
    it('finds a typed-in number and a typed-in address', () => {
      expect(hardcodedContacts('<a href="tel:+441202555555">')).toEqual(['tel:+441202555555']);
      expect(hardcodedContacts('<a href="mailto:sales@apexappraise.co.uk">')).toEqual([
        'mailto:sales@apexappraise.co.uk',
      ]);
    });

    /** The whole distinction: an address out of the record is the fix, not the defect. */
    it('leaves an address read out of the record alone', () => {
      expect(hardcodedContacts('<a href={`mailto:${data.contact.person.email}`}>')).toEqual([]);
    });

    it('does not read this file’s own account of the defect as the defect', () => {
      expect(hardcodedContacts('// it was mailto:sales@apexappraise.co.uk and tel:+441202555555\nconst x = 1;')).toEqual([]);
      expect(hardcodedContacts('/** `tel:+441202555555` is the fictional range */')).toEqual([]);
    });
  });

  /**
   * The marketing page keeps its own address and SHOULD: `Landing.tsx` is the
   * vendor's own surface, where hello@apexappraise.co.uk is the right inbox and
   * the only one. It is not client-facing in this rule's sense — a firm's client
   * never reads it — which is why the rule keys on `CLIENT_FACING` rather than
   * on "any page with a mailto".
   */
  it('leaves the vendor’s own marketing page alone', () => {
    const landing = readFileSync(join(SRC, 'routes', 'Landing.tsx'), 'utf8');
    expect(hardcodedContacts(landing).length, 'the one legitimate site has gone, so this proves nothing').toBeGreaterThan(0);
    expect(clientScreens().map((s) => s.file)).not.toContain('Landing.tsx');
  });
});
