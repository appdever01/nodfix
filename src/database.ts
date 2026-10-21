import { readFile, mkdir, rename, rm, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { databaseSchema, type Database } from './schema.js';

export const MAX_BYTES = 2 * 1024 * 1024;
export async function loadDatabase(path?: string): Promise<Database> {
  const buffer = await readFile(path ?? new URL('../data/advisories.json', import.meta.url));
  if (buffer.length > MAX_BYTES) throw new Error('Advisory database exceeds size limit');
  return databaseSchema.parse(JSON.parse(buffer.toString('utf8')));
}
export async function fetchDatabase(url: string, expectedHash: string, fetcher: typeof fetch = fetch): Promise<Database> {
  const source = new URL(url);
  if (source.protocol !== 'https:' || source.username || source.password || source.port || source.hostname !== 'raw.githubusercontent.com' || !/^\/appdever01\/nodfix\/[a-f0-9]{40}\/data\/advisories\.json$/.test(source.pathname) || source.search || source.hash) {
    throw new Error('Use a commit-pinned HTTPS advisory URL from appdever01/nodfix');
  }
  if (!/^[a-f0-9]{64}$/i.test(expectedHash)) throw new Error('A trusted SHA-256 digest is required');
  const response = await fetcher(source, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !response.body) throw new Error(`Advisory download failed: HTTP ${response.status}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > MAX_BYTES) throw new Error('Advisory download exceeds size limit');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = Buffer.concat(chunks);
  if (createHash('sha256').update(bytes).digest('hex') !== expectedHash.toLowerCase()) throw new Error('Advisory integrity check failed');
  return databaseSchema.parse(JSON.parse(bytes.toString('utf8')));
}
export async function cacheDatabase(db: Database, destination: string): Promise<void> {
  const current = await loadDatabase();
  let previous: Database | undefined;
  try { previous = await loadDatabase(destination); } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const minimum = Math.max(current.revision, previous?.revision ?? 0);
  if (db.revision < minimum || Date.parse(db.reviewedAt) < Date.parse(current.reviewedAt) || (previous && Date.parse(db.reviewedAt) < Date.parse(previous.reviewedAt))) throw new Error('Advisory rollback rejected');
  if (Date.parse(db.expiresAt) <= Date.now() || Date.parse(db.reviewedAt) > Date.now() + 300_000) throw new Error('Advisory is expired or future-dated');
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomBytes(12).toString('hex')}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(`${JSON.stringify(db, null, 2)}\n`); } finally { await handle.close(); }
    await rename(temporary, destination);
  } finally { await rm(temporary, { force: true }); }
}
