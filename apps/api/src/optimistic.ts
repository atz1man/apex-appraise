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
