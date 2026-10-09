import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `AGENTS.md` keeps its promises.
 *
 * Codex CLI, Copilot and Cursor read `AGENTS.md` at the repo root by
 * convention, the way Claude Code reads `CLAUDE.md`. So the moment that file
 * exists, a second agent's first act in this codebase is to believe it — and an
 * onboarding document that names a command which does not run, or a guard which
 * no longer exists, is worse than no document: the reader stops looking. That
 * is the same argument `security-headers` records about two files claiming a
 * protection nothing enforced.
 *
 * THE RULE IS NOT PRESENCE, it is that every CHECKABLE claim resolves. Three
 * kinds, and each has a way of going quietly wrong:
 *
 *  - a COMMAND, which rots when a package script is renamed;
 *  - a GUARD NAME in the index table, which rots when a sweep is renamed or
 *    folded into another file — and the index is exactly where that is
 *    invisible, because a stale row still reads as authoritative;
 *  - a PATH, which rots when a file moves.
 *
 * NOT PROVEN, and said rather than implied: that `AGENTS.md` does not DUPLICATE
 * the rules it is supposed to point at. No matcher reads two documents and
 * decides whether one restates the other, and the length check below is a proxy
 * and nothing more — it would catch a wholesale copy and would miss a paragraph
 * paraphrased. The reason duplication matters is in `AGENTS.md`'s own opening
 * and in `trpc.ts`: a rule written twice is one edit from meaning two things.
 */

const ROOT = new URL('../../../', import.meta.url).pathname;
const AGENTS = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8');

/** Every test file in the repo, by basename before the first dot. */
const guardNames = (): Set<string> => {
  const dirs = [
    'apps/api/test',
    'apps/web/src/lib',
    'apps/web/e2e',
    'packages/appraisal-engine/test',
    'packages/appraisal-engine/src',
    'packages/mcp-server/test',
  ];
  const out = new Set<string>();
  for (const d of dirs) {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) continue;
    for (const f of readdirSync(abs)) {
      if (!/\.(test|spec)\.tsx?$/.test(f)) continue;
      out.add(f.replace(/\.(test|spec)\.tsx?$/, ''));
      out.add(f); // the table may name a spec by its full filename
    }
  }
  return out;
};

/** The fenced ```bash block(s), as lines, comments and prose stripped. */
const commandLines = (md: string): string[] =>
  (md.match(/```bash\n([\s\S]*?)```/g) ?? [])
    .flatMap((b) => b.replace(/```bash\n|```/g, '').split('\n'))
    .map((l) => l.replace(/#.*$/, '').trim())
    .filter(Boolean);

/** Backticked guard names out of the index table's right-hand column only. */
const indexedGuards = (md: string): string[] => {
  const rows = md.split('\n').filter((l) => l.startsWith('| ') && l.split('|').length >= 4);
  const names: string[] = [];
  for (const row of rows) {
    const right = row.split('|')[2] ?? '';
    for (const m of right.matchAll(/`([^`]+)`/g)) {
      const raw = m[1]!;
      // skip prose-in-backticks that is plainly not a test name
      if (/\s/.test(raw) || raw.startsWith('--')) continue;
      names.push(raw);
    }
  }
  return names;
};

const scriptsOf = (pkgRelDir: string): Record<string, string> => {
  const p = join(ROOT, pkgRelDir, 'package.json');
  if (!existsSync(p)) return {};
  return (JSON.parse(readFileSync(p, 'utf8')).scripts ?? {}) as Record<string, string>;
};

/** workspace name -> directory, read from the real packages rather than assumed. */
const workspaceDirs = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const d of ['apps/api', 'apps/web', 'packages/appraisal-engine', 'packages/types', 'packages/ui-tokens', 'packages/mcp-server']) {
    const p = join(ROOT, d, 'package.json');
    if (existsSync(p)) out[JSON.parse(readFileSync(p, 'utf8')).name as string] = d;
  }
  return out;
};

describe('AGENTS.md', () => {
  it('exists, and hands the rules to CLAUDE.md rather than restating them', () => {
    expect(AGENTS).toContain('CLAUDE.md');
    /**
     * A proxy, not a proof. A wholesale copy of CLAUDE.md would approach its
     * length; this says AGENTS.md is a fraction of it, which is what a pointer
     * plus an index looks like. See the file header for what this cannot see.
     */
    const claude = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    expect(AGENTS.length, 'AGENTS.md is approaching CLAUDE.md’s size — is it restating the rules?')
      .toBeLessThan(claude.length / 2);
  });

  it('names only commands that exist', () => {
    const roots = scriptsOf('.');
    const dirs = workspaceDirs();
    const bad: string[] = [];

    for (const line of commandLines(AGENTS)) {
      // pnpm --filter <workspace> <script>
      for (const m of line.matchAll(/pnpm\s+--filter\s+(\S+)\s+([a-z:]+)/g)) {
        const [, ws, script] = m;
        const dir = dirs[ws!];
        if (!dir) { bad.push(`${line} → no workspace named ${ws}`); continue; }
        if (!(script! in scriptsOf(dir))) bad.push(`${line} → ${ws} has no "${script}" script`);
      }
      // bare `pnpm <script>` / `pnpm a && pnpm b`, excluding pnpm's own verbs
      for (const m of line.matchAll(/(?:^|&&\s*)pnpm\s+([a-z][a-z:]*)(?:\s|$)/g)) {
        const script = m[1]!;
        if (['install', 'add', 'run', 'exec', 'dlx'].includes(script)) continue;
        if (!(script in roots)) bad.push(`${line} → root package.json has no "${script}" script`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('names only guards that exist, so the index cannot go stale in silence', () => {
    const known = guardNames();
    const indexed = indexedGuards(AGENTS);
    expect(indexed.length, 'the guard index was not parsed — has the table changed shape?')
      .toBeGreaterThan(20);
    const missing = indexed.filter((g) => {
      const bare = g.replace(/^(apps\/web\/|apps\/api\/)?(e2e\/|test\/)?/, '').replace(/\.(test|spec)\.tsx?$/, '');
      return !known.has(g) && !known.has(bare);
    });
    expect(missing, 'AGENTS.md points at guards that no longer exist').toEqual([]);
  });

  it('names only repo paths that exist', () => {
    const paths = [...AGENTS.matchAll(/`([a-zA-Z0-9_./@-]+\/[a-zA-Z0-9_./-]+\.(?:ts|tsx|md|json|toml))`/g)]
      .map((m) => m[1]!)
      .filter((p) => !p.startsWith('/') && !p.includes('~'));
    /**
     * A floor, not a target. It is here so a parser that silently stops
     * matching cannot pass this test by finding nothing — set from what the
     * document actually carries (3) rather than guessed at, which is the rule
     * `graphics-contrast` records about its own mark counts. The real proof
     * that the matcher works is the planted case below, not this number, so do
     * not pad the prose to raise it.
     */
    expect(paths.length, 'no repo paths parsed out — has the prose changed?').toBeGreaterThanOrEqual(3);
    const missing = [...new Set(paths)].filter((p) => !existsSync(join(ROOT, p)));
    expect(missing, 'AGENTS.md references files that are not there').toEqual([]);
  });

  /**
   * A sweep over nothing passes in silence — the rule `CLAUDE.md` states about
   * every guard in this repository. These run the same three parsers over
   * planted text and must report each fault.
   */
  describe('what it is meant to find', () => {
    it('catches a command whose script does not exist', () => {
      const planted = '```bash\npnpm --filter @apex/appraisal-engine fly-to-the-moon\n```';
      const dirs = workspaceDirs();
      const bad: string[] = [];
      for (const line of commandLines(planted)) {
        for (const m of line.matchAll(/pnpm\s+--filter\s+(\S+)\s+([a-z:-]+)/g)) {
          const [, ws, script] = m;
          if (!(script! in scriptsOf(dirs[ws!]!))) bad.push(script!);
        }
      }
      expect(bad).toEqual(['fly-to-the-moon']);
    });

    it('catches a root script that does not exist', () => {
      const roots = scriptsOf('.');
      const bad = commandLines('```bash\npnpm deploy-everything\n```')
        .flatMap((l) => [...l.matchAll(/(?:^|&&\s*)pnpm\s+([a-z][a-z:-]*)(?:\s|$)/g)].map((m) => m[1]!))
        .filter((s) => !['install', 'add', 'run', 'exec', 'dlx'].includes(s) && !(s in roots));
      expect(bad).toEqual(['deploy-everything']);
    });

    it('catches an index row pointing at a guard that was deleted', () => {
      const planted = '| if you are… | …this fails you |\n|---|---|\n| doing a thing | `no-such-sweep` |';
      const known = guardNames();
      expect(indexedGuards(planted).filter((g) => !known.has(g))).toEqual(['no-such-sweep']);
    });

    it('catches a path that has moved', () => {
      const planted = 'see `apps/api/src/does-not-exist.ts` for why';
      const paths = [...planted.matchAll(/`([a-zA-Z0-9_./@-]+\/[a-zA-Z0-9_./-]+\.(?:ts|tsx|md|json|toml))`/g)].map((m) => m[1]!);
      expect(paths.filter((p) => !existsSync(join(ROOT, p)))).toEqual(['apps/api/src/does-not-exist.ts']);
    });
  });
});
