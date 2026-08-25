import { readFileSync, readdirSync, statSync } from 'node:fs';
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
 * So two checks, because "not in the entry" was not the whole property:
 *   the entry carries neither library;
 *   no ROUTE chunk is heavy, whatever put the weight there.
 *
 * Against the built artefact, not the source: the question is what Rollup
 * emitted, and a dynamic import can still be hoisted by a static reference
 * somewhere else.
 */
const HEAVY = ['exceljs', 'leaflet'];

/**
 * A route chunk is fetched to show a screen, so its size is what the user waits
 * on. 400K against a current worst case of ~150K: loose enough that ordinary
 * growth does not trip it, tight enough that a library landing in one does.
 */
const ROUTE_CHUNK_BUDGET_KB = 400;

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

const failures = [];

let initialBytes = 0;
for (const file of initial) {
  const body = readFileSync(resolve(assets, file), 'utf8');
  initialBytes += Buffer.byteLength(body);
  for (const lib of HEAVY) if (carries(body, lib)) failures.push(`${lib} is in the initial chunk ${file}`);
}

const chunks = readdirSync(assets).filter((f) => f.endsWith('.js'));
const routeChunks = chunks.filter((f) => routes.some((r) => f.startsWith(`${r}-`)));
if (routeChunks.length < 5) {
  console.error(`check-bundle: matched only ${routeChunks.length} route chunks — naming has changed`);
  process.exit(2);
}
for (const file of routeChunks) {
  const size = kb(statSync(resolve(assets, file)).size);
  if (size > ROUTE_CHUNK_BUDGET_KB) {
    failures.push(`route chunk ${file} is ${size}K, over the ${ROUTE_CHUNK_BUDGET_KB}K budget`);
  }
}

if (failures.length) {
  console.error('check-bundle: FAILED');
  for (const f of failures) console.error(`  ${f}`);
  console.error('\n  The usual cause is a static `import` of something meant to arrive on demand.');
  console.error('  Use `await import(...)` at the point of use, so it gets a chunk of its own.');
  process.exit(1);
}

const biggestRoute = routeChunks
  .map((f) => [f, kb(statSync(resolve(assets, f)).size)])
  .sort((a, b) => b[1] - a[1])[0];
console.log(`check-bundle: initial JS ${kb(initialBytes)}K, free of ${HEAVY.join(' and ')}.`);
console.log(`  largest of ${routeChunks.length} route chunks: ${biggestRoute[0]} at ${biggestRoute[1]}K (budget ${ROUTE_CHUNK_BUDGET_KB}K)`);
