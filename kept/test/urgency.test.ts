import { describe, expect, it } from 'vitest';
import { heroCount, urgency } from '../src/lib/urgency';

describe('urgency ladder', () => {
  it('calls the last day "today"', () => {
    expect(urgency(0).label).toBe('today ⚠');
    expect(urgency(0).level).toBe('critical');
  });

  it('uses the singular for one day', () => {
    expect(urgency(1).label).toBe('1 day ⚠');
  });

  it('is critical up to and including 3 days', () => {
    expect(urgency(3).level).toBe('critical');
    expect(urgency(4).level).toBe('soon');
  });

  it('honours a widened urgent threshold', () => {
    expect(urgency(10, 7).level).toBe('relaxed');
    expect(urgency(10, 14).level).toBe('soon');
  });

  it('reports a closed window rather than negative days', () => {
    const u = urgency(-3);
    expect(u.level).toBe('expired');
    expect(u.label).toBe('window closed');
    expect(u.label).not.toContain('-');
  });
});

describe('hero count', () => {
  it('names the last day instead of printing zero', () => {
    expect(heroCount(0).count).toBe('Today');
  });

  it('uses the singular for one day', () => {
    expect(heroCount(1)).toEqual({ count: '1', word: 'day left to return your' });
  });

  it('speaks in the past tense once the window has closed', () => {
    expect(heroCount(-1).count).toBe('Gone');
  });
});
