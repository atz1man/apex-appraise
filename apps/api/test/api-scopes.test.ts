import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * A permission you can grant and nothing consumes.
 *
 * The public API has a scope system — keys carry "read" or "read,write", and
 * api-keys.ts says write is deliberately opt-in. It is well built. It just had
 * nothing on the other end: every route under /api/v1 is a GET asking for the
 * read scope, and none has ever asked for write.
 *
 * The settings screen offered an "Allow writes" checkbox all the same. A firm
 * ticking it granted a permission no endpoint consumes and went away believing
 * they held a key that could change their data — finding out during the
 * integration, which is the worst moment to discover the API cannot do the
 * thing its own UI offered.
 *
 * So the two are held in step, in BOTH directions: the UI must not offer a
 * scope the API cannot honour, and the API must not start honouring one the UI
 * gives nobody a way to grant.
 */

const api = readFileSync(new URL('../src/public-api.ts', import.meta.url), 'utf8');
const settings = readFileSync(
  new URL('../../web/src/components/settings-integrations.tsx', import.meta.url),
  'utf8',
);

/** Routes that demand the write scope before doing anything. */
const routesRequiringWrite = () => [...api.matchAll(/hasScope\(principal,\s*'write'\)/g)].length;

/** Whether the key dialog gives an admin any way to grant it. */
const uiOffersWrite = () => /checked=\{write\}|setWrite\(true\)/.test(settings);

describe('the write scope', () => {
  it('is read from the files it is meant to keep in step', () => {
    // a regex matching nothing would make both assertions below vacuous
    expect(api, 'not looking at the public API').toContain('/api/v1/deals');
    expect(settings, 'not looking at the API keys panel').toContain('createApiKey');
    expect([...api.matchAll(/hasScope\(principal,\s*'read'\)/g)].length).toBeGreaterThan(3);
  });

  it('is offered only when something requires it', () => {
    if (routesRequiringWrite() === 0) {
      expect(
        uiOffersWrite(),
        'the key dialog offers "Allow writes" but no /api/v1 route asks for the write scope — ' +
          'a firm can grant a permission nothing consumes',
      ).toBe(false);
    } else {
      expect(
        uiOffersWrite(),
        'a route now requires the write scope and the key dialog gives nobody a way to grant it',
      ).toBe(true);
    }
  });

  it('still exists as a concept, because the endpoints are the missing half', () => {
    // not deleted: hasScope and the stored "read,write" are correct and stay,
    // so re-offering the checkbox is a one-line change when a write route lands
    expect(readFileSync(new URL('../src/api-keys.ts', import.meta.url), 'utf8')).toContain("'write'");
  });
});
