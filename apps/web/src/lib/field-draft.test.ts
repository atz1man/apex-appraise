import { describe, it, expect } from 'vitest';
import { fieldDraftContent, fieldDraftKey, parseFieldDraft } from './field-draft';
const draft = { rooms: [{ name: 'Exterior', condition: 3, notes: 'Damp', photos: ['photo'] }], weights: { salesComparison: 60, cost: 20, income: 20 }, value: null, held: '2026-10-19T10:00:00.000Z' };
describe('field device draft boundaries', () => {
  it('preserves original concurrency stamp and evidence', () => expect(parseFieldDraft(JSON.stringify(draft))).toEqual(draft));
  it('separates people and projects, including delimiter characters', () => {
    expect(fieldDraftKey('a:b', 'c')).not.toBe(fieldDraftKey('a', 'b:c'));
    expect(fieldDraftKey('a', 'c')).not.toBe(fieldDraftKey('b', 'c'));
    expect(fieldDraftKey('a', 'c')).not.toBe(fieldDraftKey('a', 'd'));
  });
  it.each([null, {}, { ...draft, held: 'bad' }, { ...draft, rooms: [{ ...draft.rooms[0], condition: 8 }] }, { ...draft, weights: { cost: 20 } }, { ...draft, value: -1 }, { ...draft, rooms: [{ ...draft.rooms[0], photos: [2] }] }])('refuses malformed recovery data %j', bad => expect(() => parseFieldDraft(JSON.stringify(bad))).toThrow());
  it('compares editable content independently of the concurrency stamp', () => {
    expect(fieldDraftContent(draft)).toBe(fieldDraftContent({ ...draft }));
    expect(fieldDraftContent(draft)).not.toBe(fieldDraftContent({ ...draft, rooms: [] }));
  });
});
