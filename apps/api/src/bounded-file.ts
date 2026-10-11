import fs from 'node:fs';

/** Read at most the remaining budget plus one overflow byte, never the entire
 * oversized upload. The stream is closed on success, overflow and read failure. */
export async function readBoundedFile(filePath: string, maxBytes: number): Promise<Buffer | null> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('Invalid file byte budget');
  const chunks: Buffer[] = [];
  let size = 0;
  // end is inclusive: the extra byte distinguishes an exact fit from overflow.
  const stream = fs.createReadStream(filePath, { end: maxBytes });
  for await (const chunk of stream) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > maxBytes) return null;
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}
