import { constants } from 'node:fs';
import { open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Edit } from './fix.js';

export async function applyEdits(root: string, edits: Edit[], onApplied: (file: string) => void = () => {}): Promise<string[]> {
  const canonicalRoot = await realpath(root);
  const applied: string[] = [];
  for (const edit of edits) {
    const file = resolve(canonicalRoot, edit.file);
    const local = relative(canonicalRoot, file);
    if (local.startsWith('..') || isAbsolute(local) || await realpath(file) !== file || await realpath(dirname(file)) !== dirname(file)) throw new Error('Unsafe edit path');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    try {
      if (!info.isFile() || info.nlink !== 1 || await handle.readFile('utf8') !== edit.before) throw new Error('File changed or is not a regular unlinked file');
    } finally { await handle.close(); }
    const backup = `${file}.nodfix-backup`;
    const backupHandle = await open(backup, 'wx', info.mode & 0o777);
    try { await backupHandle.writeFile(edit.before); } finally { await backupHandle.close(); }
    const temporary = `${file}.${randomBytes(12).toString('hex')}.tmp`;
    try {
      const output = await open(temporary, 'wx', info.mode & 0o777);
      try { await output.writeFile(edit.after); } finally { await output.close(); }
      if (await realpath(file) !== file || await readFile(file, 'utf8') !== edit.before) throw new Error('Concurrent modification; fix aborted');
      await rename(temporary, file);
      applied.push(edit.file);
      onApplied(edit.file);
    } finally { await rm(temporary, { force: true }); }
  }
  return applied;
}
