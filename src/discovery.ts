import { opendir, realpath } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseDeclarations, type Declaration } from './declarations.js';
import { readLimitedText } from './io.js';

export const DISCOVERY_LIMITS = { files: 20_000, depth: 30, bytes: 1024 * 1024 };
const ignored = new Set(['node_modules', '.git', '.hg', '.svn', '.next', 'dist', 'build', 'coverage', 'vendor', '.openai', '.local']);
export interface Discovery { root: string; declarations: Declaration[]; diagnostics: string[] }
export async function discover(directory: string, limits: Readonly<typeof DISCOVERY_LIMITS> = DISCOVERY_LIMITS): Promise<Discovery> {
  const root = await realpath(directory);
  const result: Discovery = { root, declarations: [], diagnostics: [] };
  let count = 0;
  let exceeded = false;
  async function walk(path: string, depth: number): Promise<void> {
    if (exceeded) return;
    if (depth > limits.depth) { result.diagnostics.push(`Depth limit: ${relative(root, path)}`); return; }
    for await (const entry of await opendir(path)) {
      if (++count > limits.files) {
        exceeded = true;
        result.diagnostics.push('File limit exceeded; scan incomplete.');
        return;
      }
      if (entry.name.endsWith('.nodfix-backup')) continue;
      if (entry.isSymbolicLink()) {
        result.diagnostics.push(`Skipped symlink: ${relative(root, join(path, entry.name))}`);
        continue;
      }
      if (entry.isDirectory() && !ignored.has(entry.name)) {
        try { await walk(join(path, entry.name), depth + 1); } catch { result.diagnostics.push(`Unreadable directory: ${relative(root, join(path, entry.name))}`); }
        if (exceeded) return;
      }
      if (!entry.isFile() || !(/^(\.nvmrc|\.node-version|package\.json|Dockerfile(?:\..+)?|.+\.Dockerfile)$/i.test(entry.name))) continue;
      const full = join(path, entry.name);
      const display = relative(root, full).replaceAll('\\', '/');
      try {
        result.declarations.push(...parseDeclarations(display, await readLimitedText(full, limits.bytes)));
      } catch { result.diagnostics.push(`Cannot parse or read declaration: ${display}`); }
    }
  }
  await walk(root, 0);
  result.declarations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  result.diagnostics.sort();
  return result;
}
