import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, chmod } from 'node:fs/promises';
import { join, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseDeclarations } from '../dist/declarations.js';
import { discover } from '../dist/discovery.js';
import { scan } from '../dist/scan.js';
import { planFix } from '../dist/fix.js';
import { applyEdits } from '../dist/write.js';
import { toSarif } from '../dist/report.js';
import { project, db, fixtureNow } from './helpers.mjs';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
test('continued FROM instructions are detected and fixes preserve their physical lines', async (t) => {
  const content = ['FROM --platform=linux/amd64 \\', '  node:24.22.0-slim AS app', ''].join('\r\n');
  const root = await project(t, { Dockerfile: content });
  const report = await scan(root, db, undefined, '24.22.1', fixtureNow);
  assert.equal(report.declarations.length, 1);
  assert.equal(report.declarations[0].declaration.line, 2);
  const plan = await planFix(root, report);
  await applyEdits(root, plan.edits);
  assert.equal(await readFile(join(root, 'Dockerfile'), 'utf8'), content.replace('24.22.0', '24.22.1'));
});
test('Docker escape directives and comments between continued lines are handled', () => {
  const input = ['# escape=`', 'FROM --platform=windows/amd64 `', '# ignored', '  node:24.22.0', ''].join('\n');
  assert.equal(parseDeclarations('Dockerfile', input)[0].value, '24.22.0');
});
test('Docker heredoc bodies never become editable FROM declarations', () => {
  const input = ['FROM node:24.22.1', 'RUN <<EOF', 'FROM node:24.22.0', 'EOF', 'FROM node:26.12.1', ''].join('\n');
  assert.deepEqual(parseDeclarations('Dockerfile', input).map((entry) => entry.value), ['24.22.1', '26.12.1']);
});
test('case-insensitive filenames accepted by discovery are parsed consistently', () => {
  assert.equal(parseDeclarations('PACKAGE.JSON', '{"engines":{"node":"24.22.0"}}')[0].value, '24.22.0');
  assert.equal(parseDeclarations('.NVMRC', '24.22.0\n')[0].value, '24.22.0');
});
test('incomplete scans are marked unsuccessful in SARIF even when CVEs are also found', async (t) => {
  const root = await project(t, { 'package.json': '{bad', '.nvmrc': '24.22.0\n' });
  const report = await scan(root, db, undefined, '24.22.0', fixtureNow);
  assert.equal(report.exitCode, 1);
  assert.equal(toSarif(report).runs[0].invocations[0].executionSuccessful, false);
});
test('project lifecycle scripts and discovered manager shims are never executed', async (t) => {
  const root = await project(t, {
    'package.json': '{"engines":{"node":"24.22.0"},"scripts":{"postinstall":"exit 99","pretest":"exit 99"}}',
    fnm: '#!/bin/sh\nexit 99\n',
  });
  await chmod(join(root, 'fnm'), 0o755);
  const result = spawnSync(process.execPath, [cli, 'fix', '--path', root, '--dry-run', '--json'], {
    encoding: 'utf8', timeout: 15_000, env: { ...process.env, PATH: `${root}${delimiter}${process.env.PATH ?? ''}` },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).remediation.applied, []);
  assert.match(await readFile(join(root, 'package.json'), 'utf8'), /postinstall/);
});
test('discovery stops at the entry budget and reports incomplete traversal', async (t) => {
  const root = await project(t, { 'a/package.json': '{}', 'b/package.json': '{}', 'c/package.json': '{}' });
  const result = await discover(root, { files: 2, depth: 30, bytes: 1024 });
  assert.ok(result.diagnostics.some((message) => /File limit/.test(message)));
});
test('version output matches package metadata', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const result = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), pkg.version);
});

test('bounded file reads reject oversize data and directories while preserving UTF-8', async (t) => {
  const { readLimitedText } = await import('../dist/io.js');
  const root = await project(t, { data: 'é'.repeat(100), oversized: 'x'.repeat(1025) });
  assert.equal(await readLimitedText(join(root, 'data'), 200), 'é'.repeat(100));
  await assert.rejects(readLimitedText(join(root, 'oversized'), 1024), /size limit/);
  await assert.rejects(readLimitedText(root, 1024), /regular file/);
});
test('oversized version declarations fail closed instead of accumulating in reports', async (t) => {
  const root = await project(t, { '.nvmrc': '24'.repeat(300) });
  const report = await scan(root, db, undefined, '24.22.1', fixtureNow);
  assert.equal(report.incomplete, true);
  assert.equal(report.declarations.length, 0);
  assert.equal(report.exitCode, 2);
});
test('quoted heredoc text does not hide following base images', () => {
  const input = ['RUN echo "<<EOF"', 'FROM node:24.22.0', ''].join('\n');
  assert.equal(parseDeclarations('Dockerfile', input)[0].value, '24.22.0');
});
test('split image tokens are detected but require manual fixes', async (t) => {
  const root = await project(t, { Dockerfile: ['FROM node:24.\\', '22.0', ''].join('\n') });
  const report = await scan(root, db, undefined, '24.22.1', fixtureNow);
  assert.equal(report.declarations[0].assessment.recommended, '24.22.1');
  const plan = await planFix(root, report);
  assert.equal(plan.edits.length, 0);
  assert.ok(plan.manual.some((message) => /split/.test(message)));
});
test('data files cannot block the scanner through a FIFO', { skip: process.platform === 'win32' }, async (t) => {
  const { readLimitedText } = await import('../dist/io.js');
  const root = await project(t);
  const fifo = join(root, 'pipe');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  await assert.rejects(readLimitedText(fifo, 1024), /regular file/);
});
test('directory depth limits remain inconclusive', async (t) => {
  const root = await project(t, { 'a/b/package.json': '{"engines":{"node":"24.22.0"}}' });
  const discovery = await discover(root, { files: 20_000, depth: 0, bytes: 1024 });
  assert.equal(discovery.declarations.length, 0);
  assert.ok(discovery.diagnostics.some((message) => /Depth limit/.test(message)));
});
test('malformed advisory JSON is rejected within the file limit', async (t) => {
  const { loadDatabase, MAX_BYTES } = await import('../dist/database.js');
  const root = await project(t, { data: '{malformed' });
  await assert.rejects(loadDatabase(join(root, 'data')));
  await writeFile(join(root, 'data'), 'x'.repeat(MAX_BYTES + 1));
  await assert.rejects(loadDatabase(join(root, 'data')), /size limit/);
});
