import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { loadDatabase } from '../dist/database.js';

export const fixtureNow = new Date('2026-10-22T00:00:00Z');
export const db = await loadDatabase();
export const advisory = db.advisories[0];
export async function project(t, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'nodfix-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }
  return root;
}
export function freshDatabase() {
  return { ...structuredClone(db), reviewedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() };
}
