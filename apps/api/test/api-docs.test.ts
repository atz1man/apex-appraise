import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_MEANING, WEBHOOK_RETRY_SCHEDULE_SECONDS } from '@apex/types/api';
import { RETRY_DELAYS, WEBHOOK_EVENTS as DELIVERED_EVENTS } from '../src/webhook-delivery.js';

/**
 * The documentation against the thing it documents.
 *
 * /api/v1 answers a discovery document that names a documentation page. For as
 * long as the API has existed that name was a hardcoded fly.dev hostname —
 * ours, handed to every integrator of every self-hosted deployment — pointing at
 * a route the app did not serve. So the first thing anybody does after finding
 * the API was follow a link to nothing.
 *
 * The page exists now, which is the easy half. This is the half that keeps it
 * true: a route added to the API and not written down is a route nobody uses,
 * and a route written down and not served is worse — somebody builds against it.
 */

const API = resolve(new URL('..', import.meta.url).pathname, 'src/public-api.ts');
const DOCS = resolve(new URL('..', import.meta.url).pathname, '../../apps/web/src/routes/ApiDocs.tsx');
const APP = resolve(new URL('..', import.meta.url).pathname, '../../apps/web/src/App.tsx');

const apiSource = readFileSync(API, 'utf8');
const docsSource = readFileSync(DOCS, 'utf8');

/** Every path the server actually registers under /api/v1. */
const registered = [...apiSource.matchAll(/app\.get<?[^>]*>?\(\s*'(\/api\/v1[^']*)'/g)].map((m) => m[1]!);

/** Every path the page prints in its endpoint table. */
const documented = [...docsSource.matchAll(/path: '(\/api\/v1[^']*)'/g)].map((m) => m[1]!);

describe('the endpoint table', () => {
  it('is reading a real router and a real page', () => {
    // both greps must find something, or everything below passes vacuously
    expect(registered.length, 'no routes matched — public-api.ts has changed shape').toBeGreaterThanOrEqual(4);
    expect(documented.length, 'no endpoints matched — the docs table has changed shape').toBeGreaterThanOrEqual(4);
  });

  it('documents every route the API serves', () => {
    const undocumented = registered.filter((p) => !documented.includes(p));
    expect(undocumented, `served but not written down: ${undocumented.join(', ')}`).toEqual([]);
  });

  it('serves every route it documents', () => {
    // the worse direction: somebody builds against a path that answers 404
    const imaginary = documented.filter((p) => !registered.includes(p));
    expect(imaginary, `written down but not served: ${imaginary.join(', ')}`).toEqual([]);
  });
});

describe('the address the API hands out', () => {
  it('is derived from this deployment, not from ours', () => {
    expect(apiSource).not.toContain('fly.dev');
    expect(apiSource).toContain('${APP_URL()}/docs/api');
  });

  it('is a route the app serves', () => {
    expect(readFileSync(APP, 'utf8')).toContain('path="/docs/api"');
  });
});

describe('the webhook reference', () => {
  it('renders the server\'s own list rather than a copy of it', () => {
    /**
     * Asked this way round on purpose. Grepping the page for each event name
     * fails on a page that MAPS the shared constant — which is the correct
     * implementation, and the one that cannot drift. So what is checked is that
     * the page reads the constant, and that the descriptions beside it are
     * exhaustive: an event removed from the list would otherwise leave an orphan
     * sentence, and one added would render with no description at all.
     */
    expect(docsSource).toContain("from '@apex/types/api'");
    expect(docsSource).toContain('WEBHOOK_EVENTS.map');
    expect(docsSource).toContain('WEBHOOK_EVENT_MEANING[event]');
    expect(Object.keys(WEBHOOK_EVENT_MEANING).sort()).toEqual([...WEBHOOK_EVENTS].sort());
    for (const event of WEBHOOK_EVENTS) {
      expect(WEBHOOK_EVENT_MEANING[event], `${event} has no description`).toBeTruthy();
    }
  });

  it('sends the same list it publishes, not a copy that agrees today', () => {
    /**
     * Reference equality, deliberately. Comparing the two arrays by VALUE passes
     * on a second hardcoded list, which is what was there before this commit and
     * what a careless revert would put back — I reverted it myself with a stray
     * `git checkout` while writing these tests, and every assertion here stayed
     * green. Identity is the only form of this question that cannot be fooled.
     */
    expect(DELIVERED_EVENTS).toBe(WEBHOOK_EVENTS);
  });

  it('states the retry schedule the deliverer actually uses', () => {
    // "retried a few times" is not something an integrator can build against,
    // and a schedule copied by hand is a schedule that will be wrong
    expect([...WEBHOOK_RETRY_SCHEDULE_SECONDS]).toEqual(RETRY_DELAYS);
  });

  it('gives the signature construction, not just its name', () => {
    // HMAC-SHA256 over "<t>.<body>" — a receiver told only "we sign it" signs
    // the body alone, and every delivery they ever got stays valid for ever
    expect(docsSource).toContain('HMAC-SHA256');
    expect(docsSource).toContain('<t>.<body>');
    expect(docsSource).toContain('timingSafeEqual');
  });
});
