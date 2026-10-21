#!/usr/bin/env node
import { Command, CommanderError } from 'commander';
import { resolve } from 'node:path';
import { fetchDatabase, cacheDatabase } from './database.js';
import { commonOptions, runScan, emit, type Options } from './options.js';
import { fixCommand } from './fix-command.js';
import { terminalSafe } from './report.js';

const program = new Command();
program.name('nodfix').description('Scan the executing Node.js runtime and project declarations against reviewed official advisories').version('0.1.0').exitOverride();
for (const command of ['scan', 'verify']) {
  commonOptions(program.command(command).description(command === 'scan' ? 'Scan local runtime and declarations' : 'Verify the local runtime against the selected advisory'))
    .action(async (options: Options) => { emit(await runScan(options, command), options); });
}
commonOptions(program.command('fix').description('Preview or approve project declaration updates; never installs a runtime'))
  .option('--dry-run', 'preview without writing')
  .option('--yes', 'approve the listed automatic project declaration updates')
  .option('--interactive', 'ask for explicit approval in a terminal')
  .action(fixCommand);
program.command('advisories').description('Manage reviewed advisory data')
  .command('update').description('Download commit-pinned data and verify a trusted SHA-256 digest')
  .requiredOption('--url <url>', 'commit-pinned raw GitHub database URL')
  .requiredOption('--sha256 <digest>', 'SHA-256 obtained from a trusted independent source')
  .requiredOption('--output <file>', 'local cache file (use with --database on subsequent scans)')
  .action(async (options: { url: string; sha256: string; output: string }) => {
    const db = await fetchDatabase(options.url, options.sha256);
    await cacheDatabase(db, resolve(options.output));
    process.stdout.write(`Verified advisory revision ${db.revision} saved. Use --database ${terminalSafe(options.output)} for offline scans.\n`);
  });
try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) process.exitCode = 0;
  else {
    const message = error instanceof Error ? error.message : 'Unexpected failure';
    if (process.argv.includes('--json') || process.argv.includes('json') || process.argv.includes('--format=json')) process.stdout.write(`${JSON.stringify({ schemaVersion: 1, error: message, exitCode: 2 })}\n`);
    else process.stderr.write(`Nodfix: ${terminalSafe(message)}\n`);
    process.exitCode = 2;
  }
}
