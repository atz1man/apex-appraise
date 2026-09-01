import { describe, expect, it } from 'vitest';
import { valuerFrom } from './valuer';

/**
 * The boundary is `saved`. A draft carries a perfectly good-looking name and
 * registration — the signed-in user's and the firm's house default — which is
 * exactly why the guard has to be on the kind of answer, not on the fields.
 */
describe('valuerFrom', () => {
  const draft = { saved: false, valuerName: 'Arthur O.', valuerReg: 'MRICS · RICS Registered Valuer no. 1148207' };

  it('names nobody from an unsaved draft, however complete the draft looks', () => {
    expect(valuerFrom(draft)).toEqual({ named: false, name: '', reg: '' });
    // and the same draft with `saved` flipped is the only difference that matters
    expect(valuerFrom({ ...draft, saved: true })).toEqual({ named: true, name: 'Arthur O.', reg: 'MRICS · RICS Registered Valuer no. 1148207' });
  });

  it('names the valuer the saved terms name', () => {
    expect(valuerFrom({ saved: true, valuerName: ' Dana Whitlock MRICS ', valuerReg: ' 1234567 ' })).toEqual({
      named: true,
      name: 'Dana Whitlock MRICS',
      reg: '1234567',
    });
  });

  it('treats saved terms with a blank name as unsigned, and a blank registration as no credentials', () => {
    expect(valuerFrom({ saved: true, valuerName: '   ', valuerReg: '1234567' })).toEqual({ named: false, name: '', reg: '' });
    expect(valuerFrom({ saved: true, valuerName: 'Dana Whitlock', valuerReg: null })).toEqual({ named: true, name: 'Dana Whitlock', reg: '' });
  });

  it('names nobody while the terms have not loaded', () => {
    expect(valuerFrom(undefined)).toEqual({ named: false, name: '', reg: '' });
    expect(valuerFrom(null)).toEqual({ named: false, name: '', reg: '' });
    expect(valuerFrom({ valuerName: 'Arthur O.' })).toEqual({ named: false, name: '', reg: '' });
  });
});
