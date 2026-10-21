import type { Command } from 'commander';
import { loadDatabase } from './database.js';
import { scan, type Report } from './scan.js';
import { formatText, toSarif } from './report.js';

export interface Options {
  path: string;
  database?: string;
  advisory?: string;
  json?: boolean;
  format: 'text' | 'json' | 'sarif';
  ci?: boolean;
  offline?: boolean;
  yes?: boolean;
  interactive?: boolean;
  dryRun?: boolean;
}
export function commonOptions(command: Command): Command {
  return command
    .option('--path <directory>', 'project or monorepo root', '.')
    .option('--database <file>', 'use a validated local advisory database (including a cached update)')
    .option('--advisory <id>', 'select a bundled advisory; defaults to last database entry')
    .option('--json', 'write a JSON report')
    .option('--format <format>', 'text, json, or sarif', 'text')
    .option('--ci', 'disable prompts for CI')
    .option('--offline', 'explicit offline mode (scans never make network requests)');
}
export async function runScan(options: Options, command: string): Promise<Report> {
  if (!['text', 'json', 'sarif'].includes(options.format)) throw new Error('Format must be text, json, or sarif');
  if (options.json && options.format === 'sarif') throw new Error('Choose --json or --format sarif');
  const database = await loadDatabase(options.database);
  const report = await scan(options.path, database, options.advisory);
  report.command = command;
  return report;
}
export function emit(report: Report, options: Options, extra?: unknown, text?: string): void {
  const output = options.json || options.format === 'json'
    ? JSON.stringify(extra ? { ...report, remediation: extra } : report, null, 2)
    : options.format === 'sarif' ? JSON.stringify(toSarif(report), null, 2)
      : formatText(report) + (text ? `\n\n${text}` : '');
  process.stdout.write(`${output}\n`);
  process.exitCode = report.exitCode;
}
