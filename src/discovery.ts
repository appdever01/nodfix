import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseDeclarations, type Declaration } from './declarations.js';

export const DISCOVERY_LIMITS = { files: 20_000, depth: 30, bytes: 1024 * 1024 };
const ignored = new Set(['node_modules', '.git', '.hg', '.svn', '.next', 'dist', 'build', 'coverage', 'vendor', '.openai', '.local']);
export interface Discovery { root: string; declarations: Declaration[]; diagnostics: string[] }
export async function discover(directory: string): Promise<Discovery> {
  const root = await realpath(directory);
  const result: Discovery = { root, declarations: [], diagnostics: [] };
  let count = 0;
  let exceeded = false;
  async function walk(path: string, depth: number): Promise<void> {
    if (depth > DISCOVERY_LIMITS.depth) { result.diagnostics.push(`Depth limit: ${relative(root, path)}`); return; }
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.endsWith('.nodfix-backup')) continue;
      count++;
      if (count > DISCOVERY_LIMITS.files) {
        if (!exceeded) result.diagnostics.push('File limit exceeded; scan incomplete.');
        exceeded = true;
        return;
      }
      if (entry.isSymbolicLink()) {
        result.diagnostics.push(`Skipped symlink: ${relative(root, join(path, entry.name))}`);
        continue;
      }
      if (entry.isDirectory() && !ignored.has(entry.name)) {
        try { await walk(join(path, entry.name), depth + 1); } catch { result.diagnostics.push(`Unreadable directory: ${relative(root, join(path, entry.name))}`); }
      }
      if (!entry.isFile() || !(/^(\.nvmrc|\.node-version|package\.json|Dockerfile(?:\..+)?|.+\.Dockerfile)$/i.test(entry.name))) continue;
      const full = join(path, entry.name);
      const display = relative(root, full).replaceAll('\\', '/');
      try {
        const info = await lstat(full);
        if (info.size > DISCOVERY_LIMITS.bytes) throw new Error('size');
        result.declarations.push(...parseDeclarations(display, await readFile(full, 'utf8')));
      } catch { result.diagnostics.push(`Cannot parse or read declaration: ${display}`); }
    }
  }
  await walk(root, 0);
  return result;
}
