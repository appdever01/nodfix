import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { detectManagers, upgradeCommands } from '../dist/managers.js';
import { toSarif, formatText, terminalSafe } from '../dist/report.js';
import { scan } from '../dist/scan.js';
import { db, fixtureNow, project } from './helpers.mjs';

test('detects manager files without executing them, including Windows extensions', async (t) => {
  const root = await project(t, { 'nvm.sh': 'never execute', 'fnm': 'never execute', 'volta': 'never execute', 'mise.cmd': 'never execute', 'asdf.exe': 'never execute' });
  await chmod(join(root, 'fnm'), 0o755);
  await chmod(join(root, 'volta'), 0o755);
  const posix = await detectManagers({ NVM_DIR: root, PATH: root }, 'linux');
  assert.deepEqual(posix, ['nvm', 'fnm', 'volta']);
  const windows = await detectManagers({ PATH: root }, 'win32');
  assert.deepEqual(windows, ['fnm', 'volta', 'asdf', 'mise']);
  assert.deepEqual(await detectManagers({ PATH: join(root, 'missing') }), []);
});
test('upgrade suggestions preserve the selected version and reject injection', () => {
  for (const manager of ['nvm', 'fnm', 'volta', 'asdf', 'mise']) {
    assert.ok(upgradeCommands(manager, '24.22.1').every((command) => command.includes('24.22.1')));
    assert.throws(() => upgradeCommands(manager, '24.22.1; rm -rf /'), /Invalid/);
  }
});
test('SARIF has CVE rules, relative artifact paths and runtime scope', async (t) => {
  const root = await project(t, { '.nvmrc': '24.22.0\n' });
  const report = await scan(root, db, undefined, '24.22.0', fixtureNow);
  const sarif = toSarif(report);
  assert.equal(sarif.version, '2.1.0');
  assert.ok(sarif.runs[0].results.some((result) => result.locations?.[0].physicalLocation.artifactLocation.uri === '.nvmrc'));
  const rules = new Set(sarif.runs[0].tool.driver.rules.map((rule) => rule.id));
  assert.ok(sarif.runs[0].results.every((result) => rules.has(result.ruleId)));
  assert.match(formatText(report), /Local runtime: VULNERABLE/);
  assert.match(sarif.runs[0].properties.scope, /Local/);
});
test('terminal output strips control sequences and bidirectional overrides', () => {
  assert.equal(terminalSafe('evil\u001b[31m\n\u202e'), 'evil?[31m??');
});

test('inconclusive SARIF findings use the Nodfix review rule', async (t) => {
  const root = await project(t);
  const report = await scan(root, db, undefined, '28.0.0', fixtureNow);
  const sarif = toSarif(report);
  assert.equal(sarif.runs[0].results[0].ruleId, 'NODFIX-REVIEW');
  assert.equal(sarif.runs[0].invocations[0].executionSuccessful, false);
});
