import fs from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { readBoundedFile } from '../src/bounded-file.js';
let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'apex-bounded-file-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
afterEach(() => vi.restoreAllMocks());

it('returns the exact bytes for a small file and an exact fit', async () => {
  const data = Buffer.from([0, 255, 128, 42]); const file = join(dir, 'exact');
  await writeFile(file, data);
  expect(await readBoundedFile(file, 10)).toEqual(data);
  expect(await readBoundedFile(file, 4)).toEqual(data);
});
it('reads only the budget plus one byte of a large file and closes the descriptor', async () => {
  const file = join(dir, 'large'); await writeFile(file, Buffer.alloc(2 * 1024 * 1024, 7));
  const original = fs.createReadStream; let opened: fs.ReadStream | undefined;
  const spy = vi.spyOn(fs, 'createReadStream').mockImplementation((path, options) => {
    opened = original(path, options); return opened;
  });
  expect(await readBoundedFile(file, 4096)).toBeNull();
  expect(spy).toHaveBeenCalledOnce();
  expect(opened!.bytesRead).toBe(4097);
  expect(opened!.destroyed).toBe(true);
  if (!opened!.closed) await new Promise<void>(resolve => opened!.once('close', () => resolve()));
  expect(opened!.closed).toBe(true);
});
it('distinguishes an empty file from any data when the remaining budget is zero', async () => {
  const file = join(dir, 'empty'); await writeFile(file, '');
  expect(await readBoundedFile(file, 0)).toEqual(Buffer.alloc(0));
  await writeFile(file, 'x'); expect(await readBoundedFile(file, 0)).toBeNull();
});
it('propagates storage failure rather than claiming a successful empty source', async () => {
  await expect(readBoundedFile(join(dir, 'missing'), 100)).rejects.toThrow();
});
it('refuses invalid budgets before opening a file', async () => {
  for (const budget of [-1, 0.5, Infinity, NaN]) await expect(readBoundedFile('unused', budget)).rejects.toThrow(RangeError);
});
