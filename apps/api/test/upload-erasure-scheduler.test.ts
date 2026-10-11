import type { PrismaClient } from '@prisma/client';
import { afterEach, expect, it, vi } from 'vitest';
import { startUploadErasure } from '../src/upload-erasure.js';

afterEach(() => vi.useRealTimers());
it('drains on startup and every minute without overlap, then stops', async () => {
  vi.useFakeTimers();
  let finish!: (jobs: never[]) => void;
  const findMany = vi.fn().mockImplementationOnce(() => new Promise<never[]>(resolve => { finish = resolve; })).mockResolvedValue([]);
  const db = { uploadErasure: { findMany } } as unknown as PrismaClient;
  const onError = vi.fn();
  const stop = startUploadErasure(db, vi.fn(), onError);
  expect(findMany).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(findMany).toHaveBeenCalledTimes(1);
  finish([]);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(findMany).toHaveBeenCalledTimes(2);
  stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(findMany).toHaveBeenCalledTimes(2);
  expect(onError).not.toHaveBeenCalled();
});

it('reports database failures and tries again on the next tick', async () => {
  vi.useFakeTimers();
  const findMany = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
  const onError = vi.fn();
  const stop = startUploadErasure({ uploadErasure: { findMany } } as unknown as PrismaClient, vi.fn(), onError);
  try {
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(2);
  } finally { stop(); }
});
