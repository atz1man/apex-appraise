import { describe, expect, it } from 'vitest';
import { googleStaticMapUrl, parseStaticMapRequest, signGoogleUrl } from '../src/staticmap.js';

/**
 * The signing and the parameter discipline, which are the two things that can
 * be wrong in a way nobody notices.
 *
 * A wrong signature is rejected by Google with a 403 and no explanation of
 * which half was wrong. An over-permissive parser is worse: it works, and it
 * spends the workspace's quota on whatever anyone asks for, signed with our
 * secret so it looks like ours.
 */

describe('signGoogleUrl', () => {
  /**
   * The secret is base64url and must be decoded to BYTES before it is used as
   * an HMAC key. Signing with the printable characters instead produces a
   * plausible-looking signature that Google rejects — this is the case that
   * catches that, using Google's own documented example pair.
   */
  it('signs with the decoded secret, not its printable form', () => {
    /**
     * Google's own worked example, and it is pinned to the VALUE on purpose.
     *
     * The first version of this test asserted only that a signature was
     * present, contained no `+` or `/`, was deterministic, and differed
     * between paths. Every one of those is true of a signature computed with
     * the WRONG key — mutation testing confirmed it: replacing the decoded
     * key with the printable secret passed all twelve tests. A signature test
     * that does not compare the signature is decoration.
     *
     * With the printable secret this same input yields
     * `KNkZz9_9izkuxN07-YYYsLtPdhI=`, which Google answers with a 403 and no
     * indication of which half was wrong.
     */
    const signed = signGoogleUrl(
      '/maps/api/geocode/json?address=New+York&client=clientID',
      'vNIXE0xscrmjlyV-12Nj_BvUPaw=',
    );
    expect(signed).toBe(
      '/maps/api/geocode/json?address=New+York&client=clientID&signature=chaRF2hTJKOScPr-RQCEhZbSzIE=',
    );
  });

  it('signs the path, so a different request is a different signature', () => {
    const secret = 'vNIXE0xscrmjlyV-12Nj_BvUPaw=';
    const a = signGoogleUrl('/maps/api/staticmap?size=1x1', secret);
    const b = signGoogleUrl('/maps/api/staticmap?size=2x2', secret);
    expect(a).not.toBe(b);
  });

  /**
   * Signing is OPTIONAL — a key alone works, and the secret only raises the
   * unsigned request limit. An operator with a key and no secret must get a
   * usable URL rather than one signed with the empty string, which Google
   * would reject.
   */
  it('returns the url unchanged when no secret is configured', () => {
    expect(signGoogleUrl('/maps/api/staticmap?size=1x1', '')).toBe('/maps/api/staticmap?size=1x1');
  });
});

describe('parseStaticMapRequest', () => {
  const pins = '50.7,-1.9,1;50.71,-1.91,0';

  it('reads pins, size and map type', () => {
    const r = parseStaticMapRequest({ pins, w: '600', h: '300', maptype: 'satellite' })!;
    expect(r.markers).toEqual([
      { lat: 50.7, lng: -1.9, subject: true },
      { lat: 50.71, lng: -1.91, subject: false },
    ]);
    expect(r.width).toBe(600);
    expect(r.height).toBe(300);
    expect(r.maptype).toBe('satellite');
  });

  /** Everything reaching Google is rebuilt from validated numbers. */
  it('refuses coordinates that are not on the earth', () => {
    expect(parseStaticMapRequest({ pins: '91,0,1' })).toBeNull();
    expect(parseStaticMapRequest({ pins: '0,181,1' })).toBeNull();
    expect(parseStaticMapRequest({ pins: 'nowhere,0,1' })).toBeNull();
  });

  it('refuses a request with nothing to plot', () => {
    expect(parseStaticMapRequest({ pins: '' })).toBeNull();
    expect(parseStaticMapRequest({})).toBeNull();
  });

  it('refuses a zoom outside the projection', () => {
    expect(parseStaticMapRequest({ pins, zoom: '99' })).toBeNull();
    expect(parseStaticMapRequest({ pins, zoom: '-1' })).toBeNull();
    expect(parseStaticMapRequest({ pins, zoom: '17' })?.zoom).toBe(17);
  });

  /**
   * Clamped rather than refused: a caller asking for a larger image than
   * Google will serve is asking for something reasonable, and a broken map is
   * a worse answer than a smaller one.
   */
  it('clamps the size to what Google will serve', () => {
    const r = parseStaticMapRequest({ pins, w: '4000', h: '4000' })!;
    expect(r.width).toBe(640);
    expect(r.height).toBe(640);
  });

  it('falls back to roadmap for a map type Google does not have', () => {
    expect(parseStaticMapRequest({ pins, maptype: 'wormhole' })?.maptype).toBe('roadmap');
  });

  /** An unbounded marker list is somebody else's image, billed to this workspace. */
  it('refuses more markers than a map can carry', () => {
    const many = Array.from({ length: 41 }, (_, i) => `50.${i},-1.9,0`).join(';');
    expect(parseStaticMapRequest({ pins: many })).toBeNull();
  });
});

describe('googleStaticMapUrl', () => {
  const req = parseStaticMapRequest({ pins: '50.7,-1.9,1;50.71,-1.91,0' })!;

  it('marks the subject apart from the comparables', () => {
    const url = googleStaticMapUrl(req, 'test-key');
    expect(url).toContain('markers=color%3A0x14503b%7Clabel%3AS%7C50.7%2C-1.9');
    expect(url).toContain('markers=color%3A0x3fd894%7Csize%3Asmall%7C50.71%2C-1.91');
  });

  /**
   * No `center` and no `zoom` unless asked: given markers alone Google frames
   * them, which is what a comparables map wants — every pin in view without
   * computing a bounding box the projection would then disagree with.
   */
  it('lets Google frame the pins when no zoom is given', () => {
    const url = googleStaticMapUrl(req, 'test-key');
    expect(url).not.toContain('center=');
    expect(url).not.toContain('zoom=');
  });

  it('renders at 2x, because the printed documents do', () => {
    expect(googleStaticMapUrl(req, 'test-key')).toContain('scale=2');
  });
});
