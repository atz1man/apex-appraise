import { describe, expect, it } from 'vitest';
import { nextFocus } from './focus-trap';

/** The ring, as element stand-ins: what matters is identity and order. */
const ring = ['first', 'middle', 'last'];

describe('nextFocus', () => {
  it('leaves the middle of the ring to the browser', () => {
    // a trap that moves focus on every Tab is a trap that will eventually
    // disagree with the browser about what is focusable, and lose
    expect(nextFocus(ring, 'middle', false)).toBeNull();
    expect(nextFocus(ring, 'middle', true)).toBeNull();
  });

  it('wraps forwards off the end', () => {
    expect(nextFocus(ring, 'last', false)).toBe('first');
  });

  it('wraps backwards off the start', () => {
    expect(nextFocus(ring, 'first', true)).toBe('last');
  });

  it('does not wrap the end it is not at', () => {
    expect(nextFocus(ring, 'last', true)).toBeNull();
    expect(nextFocus(ring, 'first', false)).toBeNull();
  });

  /**
   * The case that matters most. Focus outside the ring is somebody who has
   * already lost their cursor behind a backdrop — the dialog just opened and
   * focus is still on the button that opened it, or something removed the
   * element that had it. Pulling focus back in is the whole point.
   */
  it('pulls focus back in when it is not in the ring at all', () => {
    expect(nextFocus(ring, 'somewhere-else', false)).toBe('first');
    expect(nextFocus(ring, 'somewhere-else', true)).toBe('last');
    expect(nextFocus(ring, null, false)).toBe('first');
    expect(nextFocus(ring, null, true)).toBe('last');
  });

  it('says nothing about a dialog with nothing focusable in it', () => {
    // a bare message with no controls: there is nowhere to send Tab, and
    // sending it anywhere would be worse than letting it leave
    expect(nextFocus([], null, false)).toBeNull();
    expect(nextFocus([], 'anything', true)).toBeNull();
  });

  it('handles a ring of one, where both ends are the same element', () => {
    expect(nextFocus(['only'], 'only', false)).toBe('only');
    expect(nextFocus(['only'], 'only', true)).toBe('only');
  });
});
