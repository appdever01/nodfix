import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { project, freshDatabase } from './helpers.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
function run(root, args) {
  return spawnSync(process.execPath, [cli, ...args, '--path', root], { encoding: 'utf8', timeout: 15_000 });
}
async function database(root) {
  const file = join(root, 'test-advisories.json');
  await writeFile(file, JSON.stringify(freshDatabase()));
  return file;
}
test('real CLI returns machine-readable vulnerable scan and verification reports', async (t) => {
  const root = await project(t, { '.nvmrc': '24.22.0\n' });
  const db = await database(root);
  for (const command of ['scan', 'verify']) {
    const result = run(root, [command, '--json', '--ci', '--offline', '--database', db]);
    assert.equal(result.status, 1, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.command, command);
    assert.equal(report.declarations[0].assessment.recommended, '24.22.1');
    assert.equal(report.scope, 'Local executing runtime and project version declarations only');
  }
});
test('dry-run and missing approval do not mutate files; --yes applies only configuration', async (t) => {
  const root = await project(t, { '.nvmrc': '24.22.0\n' });
  const db = await database(root);
  for (const flags of [['--dry-run', '--yes'], []]) {
    const result = run(root, ['fix', '--json', '--database', db, ...flags]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(await readFile(join(root, '.nvmrc'), 'utf8'), '24.22.0\n');
    assert.equal(JSON.parse(result.stdout).remediation.applied.length, 0);
  }
  const result = run(root, ['fix', '--json', '--yes', '--database', db]);
  assert.ok([0, 1, 2].includes(result.status), result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(await readFile(join(root, '.nvmrc'), 'utf8'), '24.22.1\n');
  assert.equal(await readFile(join(root, '.nvmrc.nodfix-backup'), 'utf8'), '24.22.0\n');
  assert.equal(report.runtime.assessment.value, process.version);
  assert.deepEqual(report.remediation.applied, ['.nvmrc']);
});
test('invalid inputs, missing database and non-TTY interaction fail with exit 2', async (t) => {
  const root = await project(t);
  for (const args of [['scan', '--database', join(root, 'missing')], ['scan', '--format', 'invalid'], ['fix', '--interactive', '--ci'], ['scan', '--advisory', 'missing'], ['scan', '--unknown']]) {
    const result = run(root, [...args, '--json']);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout).exitCode, 2);
  }
});
test('CLI emits SARIF and help without executing runtime managers', async (t) => {
  const root = await project(t, { '.nvmrc': '24.22.0\n' });
  const db = await database(root);
  const result = run(root, ['scan', '--format', 'sarif', '--database', db]);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).version, '2.1.0');
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /advisories/);
});

test('operationally incomplete discovery blocks approved edits', async (t) => {
  const root = await project(t, { '.nvmrc': '24.22.0\n', 'package.json': '{bad' });
  const db = await database(root);
  const result = run(root, ['fix', '--yes', '--json', '--database', db]);
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).error, /incomplete/);
  assert.equal(await readFile(join(root, '.nvmrc'), 'utf8'), '24.22.0\n');
});
