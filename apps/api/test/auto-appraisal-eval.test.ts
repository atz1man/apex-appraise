import { describe, expect, it } from 'vitest';
import { cases, grade } from '../scripts/auto-appraisal-eval.js';
const correct = () => ({ cases: cases.map(c => ({ id: c.id, asking: c.asking, s106: c.s106, units: c.units.map(u => ({ ...u, source: c.id })) })) });
describe('Codex extraction evaluation discriminates incorrect results', () => {
  it('accepts complete stated inputs and explicit missingness', () => expect(grade(correct()).every(r => r.passed)).toBe(true));
  it('rejects missing and duplicate case identities', () => {
    const output = correct(); output.cases[0]!.id = output.cases[1]!.id;
    expect(() => grade(output)).toThrow(/identity/);
    expect(() => grade({ cases: [] })).toThrow(/fixture/);
  });
  it('rejects missing source citations and unexpected computed outputs', () => {
    const output = correct() as any;
    delete output.cases[0].units[0].source;
    output.cases[1].gdv = 123456;
    expect(grade(output).filter(c => !c.passed).map(c => c.id)).toEqual(['explicit', 'missing-value']);
  });
  it('catches injected unit counts', () => {
    const output = correct(); output.cases.find(c => c.id === 'injected-instruction')!.units[0]!.count = 900;
    expect(grade(output).find(c => c.id === 'injected-instruction')!.passed).toBe(false);
  });
  it('catches fabricated unit prices in incomplete evidence', () => {
    const output = correct(); output.cases.find(c => c.id === 'missing-value')!.units.push({ label: 'flat', count: 4, area: 800, value: 0, source: 'missing-value' });
    expect(grade(output).find(c => c.id === 'missing-value')!.passed).toBe(false);
  });
  it('does not let defaulted money hide invented raw evidence', () => {
    const output = correct(); output.cases.find(c => c.id === 'empty-evidence')!.asking = 0;
    expect(grade(output).find(c => c.id === 'empty-evidence')!.passed).toBe(false);
  });
  it('catches stale source revisions and swapped area/value fields', () => {
    const output = correct(); output.cases.find(c => c.id === 'revision')!.units[0]!.count = 20;
    output.cases[0]!.units[0]!.area = 450;
    expect(grade(output).filter(c => !c.passed).map(c => c.id)).toEqual(['explicit', 'revision']);
  });
  it('rejects numerically correct schedules assigned to the wrong property types', () => {
    const output = correct();
    const mixed = output.cases.find(c => c.id === 'mixed-schedule')!;
    [mixed.units[0]!.label, mixed.units[1]!.label] = [mixed.units[1]!.label, mixed.units[0]!.label];
    expect(grade(output).find(c => c.id === mixed.id)!.passed).toBe(false);
  });
  it.each(['', '   ', 'units', 'flat houses'])('rejects ambiguous or missing property type: %j', label => {
    const output = correct(); output.cases[0]!.units[0]!.label = label;
    expect(grade(output)[0]!.passed).toBe(false);
  });
  it('accepts descriptive labels, singular types and reordered rows without losing identity', () => {
    const output = correct();
    output.cases[0]!.units[0]!.label = 'Schedule A FLAT';
    const mixed = output.cases.find(c => c.id === 'mixed-schedule')!;
    mixed.units[0]!.label = 'Block A flats'; mixed.units[1]!.label = 'Block B house';
    mixed.units.reverse(); output.cases.reverse();
    expect(grade(output).every(c => c.passed)).toBe(true);
  });
  it.each(['not-explicit', 'explicit-other', 'another-case: mentions explicit'])('rejects substring-only source identity: %s', source => {
    const output = correct(); output.cases[0]!.units[0]!.source = source;
    expect(grade(output)[0]!.passed).toBe(false);
  });
  it('rejects invented top-level financial output', () => {
    expect(() => grade({ ...correct(), gdv: 123456 })).toThrow();
  });
});
