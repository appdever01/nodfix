import { open } from 'node:fs/promises';
import { constants } from 'node:fs';

export async function readLimitedText(path: string | URL, limit: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Expected a regular file');
    if (info.size > limit) throw new Error('File exceeds size limit');
    const buffer = Buffer.alloc(Math.min(64 * 1024, limit + 1));
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, limit + 1 - total), null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > limit) throw new Error('File exceeds size limit');
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
    return Buffer.concat(chunks, total).toString('utf8');
  } finally { await handle.close(); }
}
