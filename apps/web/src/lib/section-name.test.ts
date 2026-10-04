import { describe, expect, it } from 'vitest';
import { isUnnamedSection, unnamedSections, type SectionHeader } from './section-name';

const header = (h: Partial<SectionHeader>): SectionHeader => ({ text: '', heading: false, control: false, ...h });

describe('isUnnamedSection', () => {
  /** The thirteen, in the shape the browser measured them. */
  it('reports a name that sits in no heading', () => {
    expect(isUnnamedSection(header({ text: 'Construction cost health' }))).toBe(true);
    expect(isUnnamedSection(header({ text: 'Debt exposure' }))).toBe(true);
  });

  it('accepts a name that is a heading', () => {
    expect(isUnnamedSection(header({ text: 'Evidence quality', heading: true }))).toBe(false);
  });

  /**
   * The appraisal's phase panel: its header IS the field that renames the
   * phase. Wrapping a text box in a heading names nothing.
   */
  it('accepts an editable header, which is not a name', () => {
    expect(isUnnamedSection(header({ text: 'Phase 1', control: true }))).toBe(false);
  });

  /** A panel with no title at all — every skeleton in this app — is not a defect. */
  it('says nothing about a card with no header text', () => {
    expect(isUnnamedSection(header({ text: '' }))).toBe(false);
    expect(isUnnamedSection(header({ text: '   \n ' }))).toBe(false);
  });

  /** A heading beside a control is still a heading. */
  it('accepts a header that is both named and editable', () => {
    expect(isUnnamedSection(header({ text: 'Rent roll', heading: true, control: true }))).toBe(false);
  });
});

describe('unnamedSections', () => {
  it('names every offender on a screen, not the first', () => {
    const screen = [
      header({ text: 'Everything on this deal', heading: true }),
      header({ text: 'Construction cost health' }),
      header({ text: 'Sales health' }),
      header({ text: '' }),
    ];
    expect(unnamedSections(screen).map((h) => h.text)).toEqual(['Construction cost health', 'Sales health']);
  });

  it('is empty on a screen whose cards all name themselves', () => {
    expect(unnamedSections([header({ text: 'Register', heading: true })])).toEqual([]);
  });
});
