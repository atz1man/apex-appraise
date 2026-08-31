import { TRPCError } from '@trpc/server';

/**
 * Refusing a write built on a copy somebody else has already changed.
 *
 * Three procedures need this now — appraisal.save, inspections.save and
 * sales.upsertUnit — and each writes EVERY field of the row, so without a check
 * the second save wipes the first with no version, no conflict and nothing in
 * the history to say it happened.
 *
 * Defined once, for the reason trpc.ts states about the guards it owns: "a rule
 * repeated in forty places is forty chances to forget it — and the one that gets
 * forgotten is always the one that mattered." The first two were hand-written
 * and had already drifted into two different refusal wordings.
 *
 * The stamp is DEMANDED rather than checked-when-present. An optional token
 * silently reopens the hole for whichever caller forgets next, and the person it
 * costs is whoever's afternoon disappears without anyone noticing.
 *
 * Compared to the millisecond, which is what Prisma's @updatedAt records. Two
 * saves inside the same millisecond still race; that window is far shorter than
 * a person, and the consequence there is only the behaviour this replaces.
 */
export async function assertUnchanged(opts: {
  /** what the row is, in the words the person reading the message would use */
  what: string;
  /** the stamp the row carries now */
  current: Date;
  /** the stamp the caller says they loaded */
  expected: Date | undefined;
  /**
   * Who touched it last, when that is known — a name makes the message
   * actionable. A thunk rather than a value because looking it up is another
   * query, and it is only worth making on the refusal: eagerly resolving it
   * would put an extra round trip on every ordinary save to say something only
   * a conflict ever prints.
   */
  lastActor?: () => Promise<string | null | undefined>;
  /** what the caller should do, in the terms of this screen */
  advice: string;
}): Promise<void> {
  if (!opts.expected) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Saving an existing ${opts.what} needs expectedUpdatedAt — the stamp of the one you loaded.`,
    });
  }
  if (opts.current.getTime() === opts.expected.getTime()) return;
  const by = opts.lastActor ? await opts.lastActor() : null;
  throw new TRPCError({
    code: 'CONFLICT',
    message: `This ${opts.what} was saved${by ? ` by ${by}` : ''} after you opened it. ${opts.advice}`,
  });
}

/**
 * Prisma's code for a transaction the database aborted to keep it serialisable —
 * SQLSTATE 40001.
 */
export const SERIALISATION_FAILURE = 'P2034';

/**
 * Run a serialisable transaction, and try again when the database throws it out.
 *
 * Postgres does not block the loser of a serialisable conflict; it aborts one of
 * the transactions with 40001. The code that first needed this read that abort as
 * proof of a real race and turned it into "somebody else saved the first version
 * a moment ago" — which is true when there WAS somebody else, and wrong the rest
 * of the time. Serialisable Snapshot Isolation is conservative on purpose: it
 * aborts on the possibility of a cycle, not on a proven one, so two transactions
 * that never touched the same row abort each other under load. The contract
 * Postgres offers is that 40001 means retry, and an application that does not is
 * choosing to fail instead.
 *
 * Found in CI rather than by reading. A browser test created a deal of its own,
 * saved the first appraisal on it, and was told somebody else had got there
 * first — on an id no other test had ever seen. There was no other transaction
 * that could have raced it, so the abort cannot have been a real conflict.
 *
 * Retrying is safe because of what the transaction does, not because of what
 * this function does. The read that decides "nobody else has one" happens INSIDE
 * the transaction, so a retry takes a fresh snapshot: if a genuine winner
 * committed in the meantime the retry sees the row and refuses properly. A retry
 * therefore cannot produce the second current row the serialisable level exists
 * to prevent — the invariant is held by the re-read, and the abort was only ever
 * the signal to take it again.
 *
 * Bounded, and short. This sits in front of a person waiting for a save, so the
 * budget is a few milliseconds of jitter rather than a real backoff — enough to
 * let the winner commit, not enough to be felt. When the attempts run out the
 * error is passed on unchanged, and the caller turns it into whatever refusal it
 * was already going to give.
 */
export async function retryOnSerialisationFailure<T>(
  run: () => Promise<T>,
  opts: { attempts?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const nap = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      /**
       * Only the database's own abort is retried. A TRPCError thrown from inside
       * the transaction is this application refusing on purpose — a real race,
       * a stale stamp — and repeating it would turn a considered "no" into four
       * of them.
       */
      const code = (e as { code?: unknown } | null)?.code;
      if (attempt >= attempts || code !== SERIALISATION_FAILURE) throw e;
      // a little jitter, so two aborted callers do not line up and abort again
      await nap(5 + Math.floor(Math.random() * 20));
    }
  }
}
