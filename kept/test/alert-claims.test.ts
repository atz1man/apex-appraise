import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No surface may promise an alert that arrives while the app is closed.
 *
 * `notify.ts` states the platform's actual contract: a web app cannot wake
 * itself, Notification Triggers never shipped, and Periodic Background Sync
 * is one engine's and at its discretion — so alerts are computed when kept is
 * opened or brought back to the foreground, and nothing else is honest.
 *
 * The onboarding was corrected for exactly this claim ("you get pinged before
 * either runs out") and the correction stopped there. The landing hero went on
 * saying "pings you before either clock runs out" and the features grid went
 * on offering "a heads-up when something must go back this week" — on the page
 * someone reads BEFORE installing, which is the one place the promise is load
 * bearing.
 *
 * The rule, deliberately narrow: a sentence may say the app tells you
 * something, as long as it says when. Copy that names the trigger passes;
 * copy that leaves it to the reader's imagination does not.
 */
const FILES = [
  ...readdirSync(join(__dirname, '..', 'src', 'app', 'screens')).map((f) => join('src', 'app', 'screens', f)),
  join('src', 'landing', 'Landing.tsx'),
  join('src', 'landing', 'ticker.ts'),
];

/** "pings you", "we'll remind you", "notifies you" — a delivery, unqualified. */
const PROMISE = /\b(?:pings?|notif(?:y|ies)|remind(?:s)?|alerts?|wakes?|tells?|warns?|nudges?)\s+you\b/i;
/** What makes it true: the moment it happens is named. */
const QUALIFIED = /\bopen\b|\bcome back\b|\breturn to\b|\blaunch\b|\bforeground\b/i;

function copyLines(): { file: string; line: number; text: string }[] {
  const out: { file: string; line: number; text: string }[] = [];
  for (const rel of FILES) {
    if (!rel.endsWith('.ts') && !rel.endsWith('.tsx')) continue;
    // Tolerant of a renamed file, so the count check below reports "I cannot
    // read what I mean to read" rather than the whole suite dying on ENOENT.
    let src: string;
    try {
      src = readFileSync(join(__dirname, '..', rel), 'utf8');
    } catch {
      continue;
    }
    src.split('\n').forEach((text, i) => {
      const t = text.trim();
      // Comments explain the rule and quote the copy it banned, so reading
      // them would make this test fail on its own explanation.
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
      out.push({ file: rel, line: i + 1, text });
    });
  }
  return out;
}

describe('what the app promises about alerts', () => {
  it('is reading the files it means to read', () => {
    const lines = copyLines();
    expect(lines.length).toBeGreaterThan(500);
    expect(new Set(lines.map((l) => l.file)).size).toBe(FILES.length);
  });

  it('never promises delivery without saying when it happens', () => {
    const unqualified = copyLines()
      .filter((l) => PROMISE.test(l.text) && !QUALIFIED.test(l.text))
      .map((l) => `${l.file}:${l.line} ${l.text.trim().slice(0, 90)}`);
    expect(unqualified).toEqual([]);
  });
});
