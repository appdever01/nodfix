import { createInterface } from 'node:readline/promises';
import { realpath } from 'node:fs/promises';
import { planFix, publicPlan } from './fix.js';
import { applyEdits } from './write.js';
import { detectManagers, upgradeCommands } from './managers.js';
import { runScan, emit, type Options } from './options.js';
import { terminalSafe } from './report.js';

export async function fixCommand(options: Options): Promise<void> {
  if (options.format === 'sarif') throw new Error('Use text or JSON for fix plans; SARIF is supported by scan and verify');
  if (options.interactive && (options.ci || options.json || options.format === 'json' || !process.stdin.isTTY || !process.stdout.isTTY)) throw new Error('--interactive requires a text terminal without --ci');
  const root = await realpath(options.path);
  const report = await runScan({ ...options, path: root }, 'fix');
  const plan = await planFix(root, report);
  const managers = await detectManagers();
  const target = report.runtime.assessment.recommended;
  const commands = target ? managers.flatMap((manager) => upgradeCommands(manager, target)) : [];
  const preview = plan.edits.flatMap((edit) => edit.changes.map((change) => `${edit.file}:${change.line}: ${change.from} -> ${change.to}`));
  const lines = [
    'Proposed declaration changes:', ...(preview.length ? preview : ['No automatic declaration changes.']),
    ...plan.manual.map((message) => `Manual: ${message}`),
    ...(target ? [`Local runtime upgrade target: ${target}`, ...(commands.length ? commands.map((command) => `Run manually: ${command}`) : ['Download a supported runtime from https://nodejs.org/en/download'])] : []),
    'Runtime commands are suggestions only. No runtime manager or installer is executed.',
  ];
  let approved = options.yes === true;
  if (options.interactive && !approved && !options.dryRun && plan.edits.length) {
    process.stdout.write(`${lines.map(terminalSafe).join('\n')}\n`);
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try { approved = (await input.question('Apply these changes and create .nodfix-backup files? [y/N] ')).trim().toLowerCase() === 'y'; }
    finally { input.close(); }
  }
  const applied: string[] = [];
  if (approved && !options.dryRun) {
    if (report.incomplete) throw new Error('Resolve incomplete discovery before applying fixes');
    await applyEdits(root, plan.edits, (file) => {
      applied.push(file);
      process.stderr.write(`Updated ${terminalSafe(file)}; backup: ${terminalSafe(file)}.nodfix-backup\n`);
    });
  }
  const after = applied.length ? await runScan({ ...options, path: root }, 'fix') : report;
  const mode = options.dryRun ? 'dry-run' : approved ? 'approved' : 'approval-required';
  emit(after, options, { mode, ...publicPlan(plan), applied, managers, commands },
    [...lines, `Mode: ${mode}`, ...(applied.length ? [`Updated: ${applied.join(', ')}`, 'Restart with the upgraded runtime, then run nodfix verify.'] : ['Use --yes or --interactive to approve configuration changes.'])].map(terminalSafe).join('\n'));
}
