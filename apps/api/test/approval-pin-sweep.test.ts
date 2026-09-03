import { describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';
import { approves } from './classifiers.js';

/**
 * Every path that approves a version pins it.
 *
 * `appraisal.review` writes the pin in the same statement as the status. That
 * is a fact about one resolver; a bulk approval or a public route that approves
 * would be written by somebody who has not read `approval-pin.ts`, and a
 * version approved without a pin is a signed figure nothing can ever verify.
 */
type Proc = { _def: { type: 'query' | 'mutation'; resolver?: unknown } };
const procedures = () => (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures;
const src = (p: Proc) => String(p._def.resolver ?? '');

describe('the sweep itself', () => {
  it('finds the approval path from the real resolvers', () => {
    const a = Object.entries(procedures()).filter(([, p]) => p._def.type === 'mutation' && approves(src(p))).map(([path]) => path);
    expect(a, 'the classifier no longer sees appraisal.review — the walk is broken').toContain('appraisal.review');
  });

  it('finds what it is meant to find', () => {
    const rogue = "async () => { await ctx.prisma.appraisal.updateMany({ where: { id }, data: { reviewStatus: \"approved\", reviewedAt: new Date() } }); }";
    expect(approves(rogue) && !/pinFor\(/.test(rogue) && !/approvalPin/.test(rogue)).toBe(true);
  });
});

describe('every approval', () => {
  it('records which engine signed it, and what the figures were', () => {
    const missing = Object.entries(procedures())
      .filter(([, p]) => p._def.type === 'mutation' && approves(src(p)))
      .filter(([, p]) => !/pinFor\(/.test(src(p)) || !/approvalPin/.test(src(p)))
      .map(([path]) => path);
    expect(missing, `these can approve a version without pinning it: ${missing.join(', ')}`).toEqual([]);
  });

  it('writes the pin in the same statement as the status', () => {
    // the status write and the pin are one updateMany, not two round trips
    const s = src(procedures()['appraisal.review']!);
    const call = /prisma\.appraisal\.updateMany\(([\s\S]{0,900}?)\)\s*;/.exec(s)?.[1] ?? '';
    expect(call).toMatch(/reviewStatus:/);
    expect(call).toMatch(/approvalPin/);
  });
});
