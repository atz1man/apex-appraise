import { TRPCError } from '@trpc/server';

/**
 * Assert that a record belongs to the caller's organisation before writing to it.
 *
 * The bug this exists to prevent shipped five times, always in the same shape: a
 * procedure checks that the DEAL the caller named belongs to them, and then
 * updates a record by an id the caller also supplied. Those are two independent
 * inputs, and validating the first says nothing about the second — so a caller
 * could name their own deal and any other organisation's record id, and the write
 * went through.
 *
 * Prisma's `update` takes a unique where-clause, which for these models means the
 * primary key alone. There is no way to add `orgId` to it, so ownership has to be
 * established as its own step. Doing it through one named helper means the check
 * is greppable and its absence is visible in review.
 *
 * Returns the row, because callers usually need it (and having it in hand removes
 * the temptation to load it twice).
 */
export async function assertOwned<T>(
  model: { findFirst: (args: { where: { id: string; orgId: string } }) => Promise<T | null> },
  id: string,
  orgId: string,
): Promise<T> {
  const row = await model.findFirst({ where: { id, orgId } });
  // NOT_FOUND, not FORBIDDEN: "you may not touch this" confirms the record exists,
  // which is itself something a caller from another organisation should not learn.
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row;
}
