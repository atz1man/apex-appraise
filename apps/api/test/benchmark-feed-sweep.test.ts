import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appRouter } from '../src/router.js';

/**
 * Every path that makes a figure the firm's committed position feeds the pool.
 *
 * `benchmark-feed.ts` is called from approval and from completion. That is a
 * fact about two resolvers today, and the third — a bulk approval, a public
 * API route that approves, a stage change written somewhere new — would be
 * written by somebody who has not read the feed. So this walks the real
 * resolvers, classifies each by what it WRITES, and refuses an approval or a
 * completion path that does not call the feed.
 */

type Proc = { _def: { type: 'query' | 'mutation'; resolver?: unknown } };
const procedures = () => (appRouter as unknown as { _def: { procedures: Record<string, Proc> } })._def.procedures;
const src = (p: Proc) => String(p._def.resolver ?? '');


import { approves, completes } from './classifiers.js';

const API_ROOT = resolve(new URL('..', import.meta.url).pathname);
const feedSource = () => readFileSync(resolve(API_ROOT, 'src/benchmark-feed.ts'), 'utf8');

describe('the sweep itself', () => {
  it('finds the approval path and the completion path from the real resolvers', () => {
    const muts = Object.entries(procedures()).filter(([, p]) => p._def.type === 'mutation');
    const a = muts.filter(([, p]) => approves(src(p))).map(([path]) => path);
    const c = muts.filter(([, p]) => completes(src(p))).map(([path]) => path);
    expect(a, 'the classifier no longer sees appraisal.review — the walk is broken').toContain('appraisal.review');
    expect(c, 'the classifier no longer sees deals.setStage — the walk is broken').toContain('deals.setStage');
  });

  it('finds what it is meant to find', () => {
    // an approval path written without the feed, and a completion path likewise
    const rogueApprove = "async () => { await ctx.prisma.appraisal.updateMany({ where: { id }, data: { reviewStatus: 'approved' } }); }";
    const rogueComplete = "async () => { await ctx.prisma.deal.update({ where: { id }, data: { stage: 'COMPLETED' } }); }";
    expect(approves(rogueApprove) && !/feedApproved\(/.test(rogueApprove)).toBe(true);
    expect(completes(rogueComplete) && !/feedOutturn\(/.test(rogueComplete)).toBe(true);
    // and a read that merely selects the stage is not a completion path
    expect(completes("async () => ctx.prisma.deal.findMany({ select: { stage: true } })")).toBe(false);
    // a submission mentions "approved" in its refusal and writes in_review — not an approval path
    const submit = "async () => { if (v.reviewStatus === \"approved\") throw x; await ctx.prisma.appraisal.update({ where: { id }, data: { reviewStatus: \"in_review\" } }); }";
    expect(approves(submit)).toBe(false);
    // the real shape, written through a variable, still is one
    expect(approves("async () => { const status = d ? \"approved\" : \"changes_requested\"; await ctx.prisma.appraisal.updateMany({ where: { id }, data: { reviewStatus: status } }); }")).toBe(true);
    // a destructure that DISCARDS the status from a snapshot is not a write of it
    expect(approves("async () => { const { reviewStatus: _rs, ...rest } = snap; await ctx.prisma.appraisal.update({ where: { id }, data: { ...rest, isCurrent: true } }); }")).toBe(false);
  });
});

describe('every path into the pool', () => {
  it('every procedure that can approve a version feeds it to the pool', () => {
    const missing = Object.entries(procedures())
      .filter(([, p]) => p._def.type === 'mutation' && approves(src(p)) && !/feedApproved\(/.test(src(p)))
      .map(([path]) => path);
    expect(missing, `these can approve a version and never feed the benchmark pool: ${missing.join(', ')}`).toEqual([]);
  });

  it('every procedure that can complete a scheme feeds its out-turn', () => {
    const missing = Object.entries(procedures())
      .filter(([, p]) => p._def.type === 'mutation' && completes(src(p)) && !/feedOutturn\(/.test(src(p)))
      .map(([path]) => path);
    expect(missing, `these can mark a scheme completed and never feed its out-turn: ${missing.join(', ')}`).toEqual([]);
  });

  it('opting in backfills through the same feed', () => {
    expect(src(procedures()['benchmarks.setContribution']!)).toMatch(/backfill\(/);
  });

  it('the manual button reads the latest APPROVED version, not the current row', () => {
    const s = src(procedures()['benchmarks.contribute']!);
    expect(s).toMatch(/latestApproved\(/);
    expect(s, 'the button contributes whatever the current row holds again').not.toMatch(/currentAppraisal\(/);
  });
});

describe('the feed', () => {
  const body = (name: string) => {
    const s = feedSource();
    const at = s.indexOf(`function ${name}(`);
    expect(at, `${name} not found in benchmark-feed.ts`).toBeGreaterThanOrEqual(0);
    return s.slice(at, s.indexOf('\nexport ', at + 1) === -1 ? undefined : s.indexOf('\nexport ', at + 1));
  };

  it('checks consent on every event, not only at the button', () => {
    for (const fn of ['feedApproved', 'feedOutturn']) {
      expect(body(fn), `${fn} does not ask whether the firm consented`).toMatch(/consentsToBenchmarks\(/);
    }
  });

  it('refuses anything but an approved version', () => {
    expect(body('feedApproved')).toMatch(/reviewStatus !== 'approved'/);
  });

  it('replaces only the metrics it is writing, so approval and completion do not erase each other', () => {
    expect(body('replacePoints')).toMatch(/metric:\s*\{\s*in:/);
  });
});
