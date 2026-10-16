import { describe, expect, it } from 'vitest';
import { extractedAssumptionOrigins, sampleAssumptionOrigins, userChangedOrigins, changedAssumptionFields } from '@apex/types/assumption-origins';

describe('assumption origin, not inferred confidence', () => {
  it('distinguishes absent, null and zero before defaults, including partial finance', () => {
    const origins = extractedAssumptionOrigins({ efficiency: null, asking: 0, profFee: 11, finance: { rate: 0, ltc: null } });
    expect(origins).toMatchObject({ efficiency: 'application-default', asking: 'model-supplied', profFee: 'model-supplied',
      'finance.rate': 'model-supplied', 'finance.ltc': 'application-default', 'finance.period': 'application-default', buildPerSqft: 'run-setting' });
    expect(extractedAssumptionOrigins({ finance: null })['finance.rate']).toBe('application-default');
    expect(extractedAssumptionOrigins({ assumptionOrigins: { efficiency: 'model-supplied' } }).efficiency).toBe('application-default');
  });
  it('retains sample limitations and marks only changed assumptions as user corrections', () => {
    const before = { efficiency: 90, finance: { rate: 7.5, ltc: 60 }, buildPerSqft: 105 };
    const after = { ...before, finance: { ...before.finance, rate: 9 }, buildPerSqft: 125 };
    const original = sampleAssumptionOrigins();
    const corrected = userChangedOrigins(original, changedAssumptionFields(before, after));
    expect(corrected['finance.rate']).toBe('user-entered');
    expect(corrected.efficiency).toBe('worked-example');
    expect(original['finance.rate']).toBe('worked-example');
    expect(userChangedOrigins(undefined, ['finance.rate', 'invented'])).toEqual({ 'finance.rate': 'user-entered' });
  });
});
