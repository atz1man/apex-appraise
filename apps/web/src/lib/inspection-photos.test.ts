import { describe, expect, it } from 'vitest';
import { canSend, pendingWarning, savedPhotoIds, shotTally, type Shot } from './inspection-photos';

const shot = (over: Partial<Shot> = {}): Shot => ({ localId: 'l1', url: 'blob:x', state: 'saved', photoId: 'p1', ...over });

describe('savedPhotoIds', () => {
  it('names only what the server holds', () => {
    expect(
      savedPhotoIds([
        shot({ localId: 'a', photoId: 'p1' }),
        shot({ localId: 'b', state: 'uploading', photoId: undefined }),
        shot({ localId: 'c', state: 'failed', photoId: undefined }),
        shot({ localId: 'd', photoId: 'p2' }),
      ]),
    ).toEqual(['p1', 'p2']);
  });

  /**
   * The whole point of the state check. `inspections.save` verifies every id
   * against `SitePhoto` and refuses the entire save when one is missing, so a
   * single optimistic id would lose the eleven photographs that did upload along
   * with the one that did not.
   */
  it('ignores an id on a shot the server has not confirmed', () => {
    expect(savedPhotoIds([shot({ state: 'uploading', photoId: 'p9' })])).toEqual([]);
    expect(savedPhotoIds([shot({ state: 'failed', photoId: 'p9' })])).toEqual([]);
  });

  it('files one id once, however many times a retry succeeded', () => {
    expect(savedPhotoIds([shot({ localId: 'a', photoId: 'p1' }), shot({ localId: 'b', photoId: 'p1' })])).toEqual(['p1']);
  });

  it('is empty for a room nobody photographed', () => {
    expect(savedPhotoIds([])).toEqual([]);
  });
});

describe('shotTally', () => {
  it('counts the three states apart', () => {
    expect(
      shotTally([shot(), shot({ localId: 'b', state: 'uploading' }), shot({ localId: 'c', state: 'failed' }), shot({ localId: 'd', photoId: 'p3' })]),
    ).toEqual({ saved: 2, uploading: 1, failed: 1 });
  });
});

describe('canSend', () => {
  it('waits for an upload in flight — sending now files a record missing it', () => {
    expect(canSend([shot({ state: 'uploading' })])).toBe(false);
  });

  /**
   * And does NOT wait for a failure. A phone with no signal must not be able to
   * trap a day's work on the device; the record then says how many photographs it
   * has rather than how many were taken, which is the honest difference.
   */
  it('allows a send with a failed upload, because the alternative traps the work', () => {
    expect(canSend([shot({ state: 'failed' })])).toBe(true);
  });

  it('allows a send when everything is filed, and when nothing was taken', () => {
    expect(canSend([shot()])).toBe(true);
    expect(canSend([])).toBe(true);
  });
});

describe('pendingWarning', () => {
  it('says nothing when there is nothing to say', () => {
    expect(pendingWarning([])).toBeNull();
    expect(pendingWarning([shot()])).toBeNull();
  });

  it('names an upload in flight before it names a failure, because that one resolves itself', () => {
    const both = [shot({ localId: 'a', state: 'uploading' }), shot({ localId: 'b', state: 'failed' })];
    expect(pendingWarning(both)).toMatch(/still uploading/);
  });

  it('tells a surveyor what sending without a photograph means', () => {
    expect(pendingWarning([shot({ state: 'failed' })])).toMatch(/will not name it/);
    expect(pendingWarning([shot({ localId: 'a', state: 'failed' }), shot({ localId: 'b', state: 'failed' })])).toMatch(
      /2 photographs.*will not name them/,
    );
  });

  /** Singular and plural both read, because this one is read under pressure. */
  it('counts in words that agree', () => {
    expect(pendingWarning([shot({ state: 'uploading' })])).toContain('1 photograph still');
    expect(pendingWarning([shot({ localId: 'a', state: 'uploading' }), shot({ localId: 'b', state: 'uploading' })])).toContain(
      '2 photographs still',
    );
  });
});
