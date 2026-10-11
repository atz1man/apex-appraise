import { TRPCError } from '@trpc/server';

export const MODEL_NETWORK_TIMEOUT_MS = 90_000;

/** One budget for connection, response headers and body consumption; no automatic retry. */
export async function withModelDeadline<T>(request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(MODEL_NETWORK_TIMEOUT_MS);
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
