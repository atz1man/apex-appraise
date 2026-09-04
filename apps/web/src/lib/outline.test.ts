import { describe, expect, it } from 'vitest';
import { firstSkippedHeading } from './outline';

describe('firstSkippedHeading', () => {
  it('names the first heading that steps down more than one level', () => {
    // Settings as measured: h1 then fourteen h3s and no h2
    expect(firstSkippedHeading([1, 3, 3, 3])).toEqual({ index: 1, from: 1, to: 3 });
    // the cost monitor: the skip is the first panel, not the h2 that follows
    expect(firstSkippedHeading([1, 3, 3, 3, 2, 3, 2])).toEqual({ index: 1, from: 1, to: 3 });
  });

  it('accepts one level at a time', () => {
    expect(firstSkippedHeading([1, 2, 3, 3, 2, 3])).toBeNull();
    expect(firstSkippedHeading([1, 2, 2, 2])).toBeNull();
  });

  /** Coming back UP is a new section beginning, whatever the distance. */
  it('lets a heading climb any number of levels', () => {
    expect(firstSkippedHeading([1, 2, 3, 4, 2])).toBeNull();
    expect(firstSkippedHeading([1, 2, 3, 4, 1])).toBeNull();
  });

  /** Where the outline STARTS is the h1 rule's business, not this one's. */
  it('does not judge the first heading', () => {
    expect(firstSkippedHeading([3, 4])).toBeNull();
    expect(firstSkippedHeading([2])).toBeNull();
    expect(firstSkippedHeading([])).toBeNull();
  });

  it('reports a two-level skip as one skip, at its position', () => {
    expect(firstSkippedHeading([1, 2, 5])).toEqual({ index: 2, from: 2, to: 5 });
  });
});
