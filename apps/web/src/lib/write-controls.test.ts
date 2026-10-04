import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exemptProcedure, mutatingHandlers, writeControls } from './write-controls';

/**
 * Every control that fires a write says so, so a view-only member sees it
 * greyed out with the reason rather than pressing it and being refused.
 *
 * Measured before this existed, signed in as a VIEWER on the demo workspace
 * and walking every route: no screen failed and the "View only" chip was on
 * every one of them — the API rule and the chip both held. And 42 of the 110
 * controls that fire a mutation a viewer may not run were live, among them
 * every destructive one:
 * "Advance stage →" on all ten pipeline cards and on the overview, every
 * "Remove" on comparables and scenarios, every "Complete task" and "Delete
 * task" on the calendar, the appraisal's own Save and the terms' Save. Not one
 * was a `Button`; they are raw elements the `writes` prop cannot reach, which
 * is why "per-site marking" had no site to go to. `writeAttrs()` is the spread
 * that reaches them, and this sweep is what makes the marking complete rather
 * than 62-and-counting.
 *
 * Exempt by RULE, not by list: a control is left alone when every procedure it
 * fires is one the server lets a viewer run (`VIEWER_MAY_RUN`, read from the
 * same file the tRPC link reads) or sits on a portal router no member of the
 * firm can be a principal for. So the password, reset and sign-in forms, the
 * client's signature and the buyer's reservation are not reported — and if
 * `auth.changePassword` ever leaves the allowlist, its form is reported the
 * same day.
 */

const WEB_SRC = join(__dirname, '..');

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (p.endsWith('.tsx') && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const allSites = () => sources(WEB_SRC).flatMap((f) => writeControls(f.replace(`${WEB_SRC}/`, ''), readFileSync(f, 'utf8')));

describe('write controls', () => {
  it('every control that fires a mutation a viewer may not run is marked', () => {
    const unmarked = allSites().filter((s) => !s.marked && !s.exempt);
    expect(
      unmarked.map((s) => `${s.file}:${s.line} <${s.tag}> fires ${s.procedures.join(', ')} via ${s.via}`),
      'a view-only member can press these and be refused afterwards — add `writes` to a <Button>, or spread {...writeAttrs()} on a raw element',
    ).toEqual([]);
  });

  /**
   * A sweep over an empty list passes in silence. The floor is the count on
   * the day it was written; the three named are the ones the viewer walk found
   * live, on three different screens, in three different shapes.
   */
  it('finds the controls it is meant to be checking', () => {
    const sites = allSites();
    expect(sites.length).toBeGreaterThanOrEqual(119);
    const key = (s: { file: string; procedures: string[] }) => `${s.file.split('/').pop()} ${s.procedures.join(',')}`;
    const keys = sites.map(key);
    expect(keys).toContain('Board.tsx deals.setStage');
    expect(keys).toContain('Calendar.tsx tasks.remove');
    expect(keys).toContain('Comparables.tsx comparables.remove');
    expect(keys).toContain('DevelopmentAppraisal.tsx appraisal.save');
    // and it resolves every binding: a `?.` here is a mutation whose declaration it could not find
    expect(sites.flatMap((s) => s.procedures).filter((p) => p.startsWith('?.'))).toEqual([]);
  });

  it('exempts what the server lets a viewer through, and the buyer portal, by rule', () => {
    const sites = allSites();
    const exempt = sites.filter((s) => s.exempt).flatMap((s) => s.procedures);
    expect(exempt).toContain('auth.changePassword');
    expect(exempt).toContain('auth.requestPasswordReset');
    expect(exempt).toContain('buyer.sign');
    expect(exempt).not.toContain('deals.setStage');
    expect(exemptProcedure('auth.login')).toBe(true);
    expect(exemptProcedure('engagement.sign')).toBe(true);
    expect(exemptProcedure('engagement.save')).toBe(false);
    expect(exemptProcedure('portalAccess.inviteBuyer')).toBe(false);
  });
});

describe('the matcher', () => {
  const bind = `const remove = trpc.tasks.remove.useMutation();\nconst request = trpc.auth.requestPasswordReset.useMutation();\n`;
  const one = (src: string) => writeControls('x.tsx', bind + src);

  it('reads a mutation in the tag itself, past the `>` inside an arrow function', () => {
    const [s] = one(`<button disabled={remove.isPending} onClick={() => { if (confirm('sure?')) remove.mutate(id); }}>x</button>`);
    expect(s).toMatchObject({ tag: 'button', procedures: ['tasks.remove'], marked: false, exempt: false, line: 3 });
  });

  it('accepts writeAttrs on a raw element and `writes` on a Button', () => {
    expect(one(`<button disabled={remove.isPending} {...writeAttrs('Delete')} onClick={() => remove.mutate(id)}>x</button>`)[0].marked).toBe(true);
    expect(one(`<Button writes onClick={() => remove.mutate(id)}>x</Button>`)[0].marked).toBe(true);
    expect(one(`<Button onClick={() => remove.mutate(id)}>x</Button>`)[0].marked).toBe(false);
    // `writes` has to be an attribute, not a word inside another one
    expect(one(`<Button title="writes nothing" onClick={() => remove.mutate(id)}>x</Button>`)[0].marked).toBe(false);
  });

  /**
   * The case the first pass missed: "Add comp" calls `addComp`, which calls
   * `upsert.mutate` three lines up. A matcher that only read the tag reported
   * the comparables screen clean.
   */
  it('follows a handler declared in the same file', () => {
    const src = `  const addComp = () =>\n    remove.mutate({ id });\n  const close = () => setOpen(false);\n  return <><Button onClick={addComp}>Add</Button><Button onClick={() => close()}>x</Button></>;`;
    const sites = one(src);
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ via: 'addComp', procedures: ['tasks.remove'], marked: false });
    expect([...mutatingHandlers(bind + src).keys()]).toEqual(['addComp']);
  });

  /**
   * The mutant that survived the first version: a declaration with a blank
   * line above it. `\s*` capturing the indent swallowed the newline, the body
   * scan ended on the declaration's own line, and the real "Add comp" — three
   * lines under a blank one, like most handlers in this tree — read as clean.
   */
  it('reads a handler that sits under a blank line, and one whose parameter is typed', () => {
    const src = `  };\n\n  const addComp = () =>\n    remove.mutate({ id });\n\n  const submitWeek = (contractorId: string) => {\n    remove.mutate({ contractorId });\n  };\n  return <><Button onClick={addComp}>Add</Button><Button onClick={() => submitWeek(c.id)}>Log week</Button></>;`;
    expect([...mutatingHandlers(bind + src).keys()]).toEqual(['addComp', 'submitWeek']);
    expect(one(src).map((s) => s.via)).toEqual(['addComp', 'submitWeek']);
  });

  it('judges a form by its submit control', () => {
    const form = (btn: string) => one(`<form onSubmit={(e) => { e.preventDefault(); remove.mutate(id); }}>\n${btn}\n</form>`);
    expect(form(`<Button writes type="submit">Save</Button>`)[0]).toMatchObject({ tag: 'form', marked: true });
    expect(form(`<Button type="submit">Save</Button>`)[0]).toMatchObject({ tag: 'form', marked: false });
    expect(form(`<Button writes>Not the submit</Button>`)[0]).toMatchObject({ tag: 'form', marked: false });
  });

  it('exempts a control whose every procedure a viewer may run', () => {
    expect(one(`<Button onClick={() => request.mutate({ email })}>Send</Button>`)[0]).toMatchObject({ exempt: true, procedures: ['auth.requestPasswordReset'] });
    expect(one(`<Button onClick={() => { request.mutate({ email }); remove.mutate(id); }}>Both</Button>`)[0].exempt).toBe(false);
  });

  it('takes the nearest binding above the call', () => {
    const src = `const remove = trpc.org.deleteWebhook.useMutation();\n<button onClick={() => remove.mutate(a)}>1</button>\nconst remove = trpc.org.deleteSso.useMutation();\n<button onClick={() => remove.mutate(b)}>2</button>`;
    expect(writeControls('x.tsx', src).map((s) => s.procedures[0])).toEqual(['org.deleteWebhook', 'org.deleteSso']);
  });

  it('ignores a mutation named only in a comment, and keeps the line numbers', () => {
    const src = `{/* remove.mutate( is what the old one did */}\n<button onClick={() => remove.mutate(id)}>x</button>`;
    const sites = one(src);
    expect(sites).toHaveLength(1);
    expect(sites[0].line).toBe(4);
  });
});
