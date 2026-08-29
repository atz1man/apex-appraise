/*
 * Say what a sweep learned, even when it does not finish.
 *
 * Every sweep here gathers findings as it goes and prints them at the end, so
 * a step that THREW printed nothing at all — not the crash in a form anyone
 * could act on, and not the checks that had already run.
 *
 * Measured, on a real defect: breaking the returning-visitor screen so the
 * welcome comes back every launch brought onboarding up over the receipts
 * list, and `smoke` died eleven lines later on a row it could no longer see.
 * The whole output was `locator.click: Timeout 30000ms exceeded ... at
 * smoke.mjs:250`. Forty checks had already run, one of them had already
 * failed, and it named the defect exactly. None of that reached the screen.
 *
 * A crash is a failure of the RUN. It is not a reason to throw away what the
 * run found on its way there.
 */
export function reportOnCrash(report) {
  for (const ev of ['uncaughtException', 'unhandledRejection']) {
    process.on(ev, (e) => report(e instanceof Error ? e : new Error(String(e ?? ev))));
  }
}

/** The line printed under the findings when a run stopped early. */
export function sayCrash(crash) {
  console.log(`\n✗ the run did not finish: ${String(crash?.message ?? crash).split('\n')[0]}`);
  console.log('  (the checks above are what it managed to ask before it stopped)');
}
