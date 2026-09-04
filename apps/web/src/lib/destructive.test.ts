import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { destructiveSites, gateFor } from './destructive';

/**
 * Nothing this product destroys goes on one click.
 *
 * Measured over every `remove`/`delete` mutation the browser calls: 14 controls,
 * FOUR of which fired immediately. What makes those four omissions rather than a
 * design choice is that the other ten already ask, in three different ways the
 * product had settled on:
 *
 *   confirm      row-level — a comparable, a task, a photo, a unit, a tenancy,
 *                a scenario
 *   arm          panel-level — a member, an investor, a contractor: the control
 *                appears only after another arms it, with a Cancel beside it
 *   typed-name   once, for deleting the workspace, which is the only control
 *                that ends everything at once
 *
 * A firm learns from ten controls that removing asks first, and then loses its
 * single sign-on configuration to one click. The four:
 *
 *   org.deleteWebhook        a customer's system stops receiving events
 *   org.deleteSso            every member who signs in through the provider
 *                            loses that route in — and `enforced` may mean
 *                            there is no password to fall back on
 *   investors.removeHolding  an investor's position in a deal
 *   investors.deleteCashflow a capital call or a distribution: a financial record
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

const allSites = () =>
  sources(WEB_SRC).flatMap((f) => destructiveSites(f.replace(`${WEB_SRC}/`, ''), readFileSync(f, 'utf8')));

describe('destructive controls', () => {
  it('all ask before they destroy', () => {
    const ungated = allSites().filter((s) => s.gate === 'none');
    expect(
      ungated.map((s) => `${s.file}:${s.line} — ${s.procedure}`),
      'these destroy a record on a single click, while ten controls beside them ask first',
    ).toEqual([]);
  });

  /**
   * A sweep over an empty list passes in silence. This is what says it is
   * reading the real thing — and the count is deliberately a floor rather than
   * an equality, so adding a properly-gated control does not fail the build.
   */
  it('finds the destructive controls it is meant to be checking', () => {
    const sites = allSites();
    expect(sites.length).toBeGreaterThanOrEqual(14);
    expect(sites.map((s) => s.procedure)).toContain('org.deleteWorkspace');
    expect(sites.map((s) => s.procedure)).toContain('comparables.remove');
  });
});

describe('gateFor', () => {
  const at = (src: string) => {
    const lines = src.split('\n');
    return gateFor(lines, lines.findIndex((l) => l.includes('.mutate(')));
  };

  it('reads a row-level confirm', () => {
    expect(at(`onClick={() => {\n  if (confirm('sure?')) remove.mutate(id);\n}}`)).toBe('confirm');
  });

  /**
   * The ordering that took a second pass. Six row-level sites write the guard
   * and the call on ONE line — `if (confirm(…)) x.mutate(…)` — which the
   * typed-name rule also matches. Tested first, they classify as confirm;
   * tested second, all six were reported as typed-name gates and the file's own
   * output became a fiction while its total stayed right.
   */
  it('calls a one-line confirm a confirm, not a typed-name gate', () => {
    expect(at(`if (confirm('go?')) remove.mutate({ id });`)).toBe('confirm');
  });

  it('reads a typed-name gate', () => {
    expect(at(`if (confirmName.trim() === org?.name) destroy.mutate({ confirmName });`)).toBe('typed-name');
  });

  it('reads an arm, by the Cancel standing beside it', () => {
    expect(at(`<Button onClick={() => remove.mutate({ id })}>Remove</Button>\n<Button onClick={() => setArmed(false)}>Cancel</Button>`)).toBe('arm');
  });

  it('reads a bare control as ungated', () => {
    expect(at(`<Button onClick={() => remove.mutate({ id })}>Remove</Button>`)).toBe('none');
  });
});

describe('destructiveSites', () => {
  /**
   * `settings-integrations.tsx` binds `remove` twice — once in the webhooks
   * panel, once in the SSO panel. A plain name→procedure map let the second
   * overwrite the first, so a webhook endpoint was reported as an SSO
   * configuration: the right count under the wrong name, which is the worse of
   * the two failures, because somebody reads the name.
   */
  it('attributes a call to the nearest binding above it, not the last one in the file', () => {
    const src = [
      "const remove = trpc.org.deleteWebhook.useMutation();",
      "<Button onClick={() => { if (confirm('x')) remove.mutate({ id }); }}>Remove</Button>",
      "const remove = trpc.org.deleteSso.useMutation();",
      "<Button onClick={() => { if (confirm('y')) remove.mutate(); }}>Remove</Button>",
      '',
    ].join('\n');
    const sites = destructiveSites('two-panels.tsx', src);
    expect(sites.map((s) => s.procedure)).toEqual(['org.deleteWebhook', 'org.deleteSso']);
  });

  it('reports nothing for a file with no destructive mutation in it', () => {
    expect(destructiveSites('x.tsx', "const save = trpc.appraisal.save.useMutation();\nsave.mutate(v);\n")).toEqual([]);
  });
});
