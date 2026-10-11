import { expect, it } from 'vitest';
import { expectedReviewSources, reviewSourcesChanged } from './review-source-versions';

it('includes manually referenced sources alongside extracted sources without duplicate stamps', () => {
  expect(expectedReviewSources([{ id: 'extracted', version: 'a' }], [
    { documentId: 'manual', version: 'b' }, { documentId: 'manual', version: 'b' },
    { documentId: 'extracted', version: 'a' },
  ])).toEqual([{ id: 'extracted', version: 'a' }, { id: 'manual', version: 'b' }]);
});
it('does not replace an older review stamp when another reference sees a newer version', () => {
  const expected = expectedReviewSources([{ id: 'source', version: 'old' }], [{ documentId: 'source', version: 'new' }]);
  expect(expected).toHaveLength(2);
  expect(reviewSourcesChanged(expected, [{ id: 'source', version: 'new' }])).toBe(true);
});
it('detects changed and removed references while accepting unchanged versions', () => {
  const expected = expectedReviewSources([], [{ documentId: 'reference', version: 'old' }]);
  expect(reviewSourcesChanged(expected, [{ id: 'reference', version: 'new' }])).toBe(true);
  expect(reviewSourcesChanged(expected, [])).toBe(true);
  expect(reviewSourcesChanged(expected, [{ id: 'reference', version: 'old' }])).toBe(false);
});
it('keeps unavailable list state unknown and supports legacy references without versions', () => {
  expect(reviewSourcesChanged([{ id: 'source', version: 'old' }], undefined)).toBe(false);
  expect(expectedReviewSources([{ id: 'legacy' }], [{ documentId: 'legacy-reference' }])).toEqual([]);
  expect(reviewSourcesChanged([{ id: 'legacy' }], [])).toBe(false);
});
it('clearing a reference removes its expected version without affecting extracted sources', () => {
  expect(expectedReviewSources([{ id: 'extracted', version: 'a' }], [])).toEqual([{ id: 'extracted', version: 'a' }]);
  expect(expectedReviewSources([], [])).toEqual([]);
});
