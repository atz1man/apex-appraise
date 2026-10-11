import { TRPCError } from '@trpc/server';

/** One budget for connection, response headers and body consumption; no automatic retry. */
export async function withModelDeadline<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(90_000);
  try {
    const result = await request(signal);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    if (signal.aborted) throw new TRPCError({
      code: 'TIMEOUT',
      message: 'The AI request timed out. Try again; no successful result was recorded.',
    });
    throw error;
  }
}
