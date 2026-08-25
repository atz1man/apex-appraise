import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * What a page costs before it can show anything.
 *
 * CLAUDE.md states the rule — "Heavy deps (exceljs, leaflet) must stay
 * lazy-loaded (dynamic import) — never in the main bundle" — and nothing
 * enforced it. It holds today, and the numbers are worth keeping: the entry is
 * ~292K, ExcelJS is 920K in a chunk of its own that arrives when somebody
 * exports a workbook, and the Development Appraisal route is 85K.
 *
 * Writing `import ExcelJS from 'exceljs'` for convenience does not break the
 * stated rule as written — the entry stays clean, because that module is only
 * reached from a React.lazy route. It moves the megabyte into the ROUTE chunk
 * instead: Development Appraisal goes from 85K to 1003K, and the dedicated
 * exceljs chunk disappears. Everyone who opens an appraisal now pays for an
 * export they may never run. Measured, both ways, before this file was written.
 *
 * That was two checks — the entry carries neither library, and no ROUTE chunk is
 * heavy — and it was still not the whole property. Leaflet got past both. It was
 * imported statically by SiteMap, which was imported statically by Comparables
 * and the Site Pack, so Rollup put it in a SHARED chunk: not the entry, not a
 * route chunk, invisible to both checks, and downloaded in full the moment
 * either route opened. Comparables cost 174K to show a 12K screen, and did so
 * even when it had no geocoded comparables and the map would never draw.
 *
 * What a user waits on is not a file. It is a chunk plus everything that chunk
 * STATICALLY imports, transitively, minus what the entry already paid for. So
 * that is what is measured. Dynamic imports are excluded by construction —
 * `import("./x.js")` is not an import statement — which is exactly right: a
 * dynamic boundary is the thing that makes weight optional.
 *
 * Three checks:
 *   the entry closure carries no heavy library;
 *   no ROUTE closure carries one either — it has to arrive by dynamic import;
 *   no route closure exceeds the budget, which catches the next heavy thing
 *   nobody thought to list.
 *
 * And a fourth, because a budget only catches the gross case. Importing the
 * plan catalogue through the @apex/types barrel put 58K of zod into a shared
 * chunk that Settings and Benchmarking both pulled — real weight, for four
 * string constants, and nowhere near any ceiling. So sizes are also compared
 * against a checked-in baseline: growth beyond the tolerance fails until
 * somebody runs --update and commits the new number, which turns "the bundle
 * got bigger" from something nobody notices into a line in a diff.
 *
 * Against the built artefact, not the source: the question is what Rollup
 * emitted, and a dynamic import can still be hoisted by a static reference
 * somewhere else.
 */
const HEAVY = ['exceljs', 'leaflet'];

/**
 * What a route costs on top of the entry, following its static imports.
 *
 * 250K against a current worst case of 113K (Development Appraisal). The old
 * 400K was set against a worst case measured the wrong way; Comparables-with-
 * Leaflet was 174K and would have sailed under it. Loose enough for ordinary
 * growth, tight enough that a 150K library landing in a route's closure trips.
 */
const ROUTE_CLOSURE_BUDGET_KB = 250;

/**
 * How much a route may grow before someone has to say so out loud.
 *
 * 25K is about the smallest step that is definitely a LIBRARY and not a screen
 * getting a new panel. Tight enough to have caught the 58K of zod; loose enough
 * that ordinary feature work does not send people to this file.
 */
const GROWTH_TOLERANCE_KB = 25;

const web = process.cwd();
const dist = resolve(web, 'dist');
const assets = resolve(dist, 'assets');

const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
const initial = [...html.matchAll(/(?:src|href)="\/assets\/([A-Za-z0-9_.-]+\.js)"/g)].map((m) => m[1]);
if (initial.length === 0) {
  console.error('check-bundle: no entry scripts in dist/index.html — has the build changed shape?');
  process.exit(2);
}

/** Route names, from the lazy() imports that define them. */
const app = readFileSync(resolve(web, 'src/App.tsx'), 'utf8');
const routes = [...app.matchAll(/lazy\(\(\)\s*=>\s*import\('\.\/routes\/([A-Za-z0-9_]+)'\)\)/g)].map((m) => m[1]);
if (routes.length < 5) {
  console.error(`check-bundle: found only ${routes.length} lazy routes in App.tsx — the pattern has moved`);
  process.exit(2);
}

const kb = (bytes) => Math.round(bytes / 1024);
/** A mention of the library itself, not of a chunk FILENAME that contains its name. */
const carries = (body, lib) =>
  new RegExp(`\\b${lib}\\b`, 'i').test(body.replace(new RegExp(`${lib}[A-Za-z0-9_.-]*\\.js`, 'gi'), ''));

const chunks = readdirSync(assets).filter((f) => f.endsWith('.js'));

/**
 * The chunks an emitted chunk pulls in before it can run.
 *
 * Rollup writes static dependencies as real import statements and dynamic ones
 * as `import("./x.js")`. The `(` is what separates them, and both patterns below
 * refuse it, so a lazy boundary is never counted as weight the user waits on.
 */
const staticImports = (file) => {
  const body = readFileSync(resolve(assets, file), 'utf8');
  const found = new Set();
  const patterns = [
    /(?:^|[;\s}])import\s*(?:[^"'()]*?from\s*)?"\.\/([A-Za-z0-9_.-]+\.js)"/g,
    /(?:^|[;\s}])import\s*"\.\/([A-Za-z0-9_.-]+\.js)"/g,
  ];
  for (const re of patterns) for (const m of body.matchAll(re)) found.add(m[1]);
  return [...found];
};

const closureOf = (seeds) => {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !chunks.includes(file)) continue;
    seen.add(file);
    queue.push(...staticImports(file));
  }
  return seen;
};

const bytesOf = (files) => [...files].reduce((total, f) => total + statSync(resolve(assets, f)).size, 0);

const failures = [];

const entryClosure = closureOf(initial);
for (const file of entryClosure) {
  const body = readFileSync(resolve(assets, file), 'utf8');
  for (const lib of HEAVY) if (carries(body, lib)) failures.push(`${lib} is in the initial closure, via ${file}`);
}

const routeChunks = chunks.filter((f) => routes.some((r) => f.startsWith(`${r}-`)));
if (routeChunks.length < 5) {
  console.error(`check-bundle: matched only ${routeChunks.length} route chunks — naming has changed`);
  process.exit(2);
}

/** Only what this route adds: the entry's chunks are already on the page. */
const measured = routeChunks
  .map((file) => {
    const extra = [...closureOf([file])].filter((f) => !entryClosure.has(f));
    return { file, kb: kb(bytesOf(extra)), chunks: extra };
  })
  .sort((a, b) => b.kb - a.kb);

for (const route of measured) {
  if (route.kb > ROUTE_CLOSURE_BUDGET_KB) {
    failures.push(`route ${route.file} pulls ${route.kb}K over ${route.chunks.length} chunks, past the ${ROUTE_CLOSURE_BUDGET_KB}K budget`);
  }
  for (const file of route.chunks) {
    const body = readFileSync(resolve(assets, file), 'utf8');
    for (const lib of HEAVY) {
      if (carries(body, lib)) failures.push(`${lib} arrives with route ${route.file} (in ${file}) — it must be a dynamic import`);
    }
  }
}

/**
 * The baseline. Keyed by ROUTE NAME, because filenames carry a content hash and
 * would churn on every build.
 */
const BASELINE = resolve(web, 'scripts/bundle-baseline.json');
const nameOf = (file) => routes.find((r) => file.startsWith(`${r}-`));
// sorted by NAME, not by size: a baseline that reorders itself makes every diff
// unreadable and hides the one number that actually moved
const current = { entryKb: kb(bytesOf(entryClosure)), routes: {} };
for (const route of [...measured].sort((a, b) => nameOf(a.file).localeCompare(nameOf(b.file)))) {
  current.routes[nameOf(route.file)] = route.kb;
}

if (process.argv.includes('--update')) {
  writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`check-bundle: baseline written — entry ${current.entryKb}K, ${measured.length} routes. Commit it.`);
  process.exit(0);
}

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
} catch {
  console.error(`check-bundle: no baseline at ${BASELINE}. Run \`node scripts/check-bundle.mjs --update\` and commit it.`);
  process.exit(2);
}

if (current.entryKb > baseline.entryKb + GROWTH_TOLERANCE_KB) {
  failures.push(`the initial closure grew ${current.entryKb - baseline.entryKb}K to ${current.entryKb}K (baseline ${baseline.entryKb}K)`);
}
for (const [name, size] of Object.entries(current.routes)) {
  const was = baseline.routes[name];
  // a NEW route has nothing to compare against; the budget above still applies
  if (was === undefined) continue;
  if (size > was + GROWTH_TOLERANCE_KB) {
    failures.push(`route ${name} grew ${size - was}K to ${size}K (baseline ${was}K)`);
  }
}

if (failures.length) {
  console.error('check-bundle: FAILED');
  for (const f of [...new Set(failures)]) console.error(`  ${f}`);
  console.error('\n  The usual cause is a static `import` of something meant to arrive on demand.');
  console.error('  Use `await import(...)` or React.lazy at the point of use, so it gets a chunk of its own.');
  console.error('  If the growth is intended, run `node scripts/check-bundle.mjs --update` and commit the baseline.');
  process.exit(1);
}

console.log(`check-bundle: initial closure ${kb(bytesOf(entryClosure))}K, free of ${HEAVY.join(' and ')}.`);
const worst = measured[0];
console.log(
  `  heaviest of ${measured.length} routes: ${worst.file} pulls ${worst.kb}K over ${worst.chunks.length} chunks (budget ${ROUTE_CLOSURE_BUDGET_KB}K)`,
);
