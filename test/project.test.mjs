import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, link } from 'node:fs/promises';
import { join } from 'node:path';
import { discover } from '../dist/discovery.js';
import { parseDeclarations } from '../dist/declarations.js';
import { scan } from '../dist/scan.js';
import { planFix } from '../dist/fix.js';
import { applyEdits } from '../dist/write.js';
import { db, fixtureNow, project } from './helpers.mjs';

test('discovers monorepos, workspaces, Volta, managers and multistage Dockerfiles', async (t) => {
  const root = await project(t, {
    '.nvmrc': 'v24.22.0\n', '.node-version': '22.23.3\n',
    'package.json': JSON.stringify({ workspaces: ['packages/*'], engines: { node: '^24.0.0' }, volta: { node: '24.22.0' } }),
    'packages/api/package.json': JSON.stringify({ engines: { node: '22.23.3' } }),
    'packages/web/Dockerfile': 'FROM --platform=linux/amd64 node:26.12.0-alpine AS build\nFROM docker.io/library/node:24.22.0-slim\nFROM build AS final\n',
    'node_modules/ignored/package.json': '{bad', 'dist/package.json': '{bad',
  });
  const result = await discover(root);
  assert.equal(result.declarations.length, 7);
  assert.deepEqual(result.diagnostics, []);
  const report = await scan(root, db, undefined, '24.22.0', fixtureNow);
  assert.equal(report.exitCode, 1);
  assert.ok(report.warnings.some((message) => /Rebuild Docker/.test(message)));
});
test('Docker variable tags stay unknown and digests retain their tag version', () => {
  const entries = parseDeclarations('Dockerfile', 'FROM node:${NODE_VERSION}\nFROM node@sha256:abc123\nFROM node:24.22.0@sha256:abc123\nFROM example.com/node:24.22.0\nFROM node:26.12.1-rc.1\n');
  assert.deepEqual(entries.map((entry) => entry.value), ['node:${NODE_VERSION}', 'latest', '24.22.0', '26.12.1-rc.1']);
});
test('parse failures and stale data never produce passing reports', async (t) => {
  const root = await project(t, { 'package.json': '{ invalid' });
  const result = await scan(root, db, undefined, '24.22.1', fixtureNow);
  assert.equal(result.exitCode, 2);
  assert.equal(result.diagnostics.length, 1);
  const empty = await project(t);
  const stale = await scan(empty, db, undefined, '24.22.1', new Date('2026-12-01'));
  assert.equal(stale.exitCode, 2);
  assert.equal(stale.advisory.stale, true);
});
test('verify scope succeeds only for covered local runtime and consistent declarations', async (t) => {
  const root = await project(t, { '.nvmrc': '24.22.1\n', 'package.json': '{"engines":{"node":"^24.22.1"}}' });
  assert.equal((await scan(root, db, undefined, '24.22.1', fixtureNow)).exitCode, 0);
  const mismatch = await scan(root, db, undefined, '26.12.1', fixtureNow);
  assert.equal(mismatch.exitCode, 2);
  assert.ok(mismatch.diagnostics.length > 0);
  await assert.rejects(scan(root, db, 'missing', '26.12.1', fixtureNow), /not found/);
});
test('fix preserves majors, Docker suffixes, CRLF, package fields and is idempotent', async (t) => {
  const pkg = '{\r\n  "private": true,\r\n  "volta": {"node":"24.22.0"},\r\n  "engines": {"node":"^24.0.0"}\r\n}\r\n';
  const root = await project(t, { '.nvmrc': 'v24.22.0\r\n', '.node-version': '22.23.3\n', 'package.json': pkg, 'Dockerfile': 'FROM node:26.12.0-alpine\r\n' });
  const report = await scan(root, db, undefined, '24.22.0', fixtureNow);
  const plan = await planFix(root, report);
  assert.equal(plan.edits.length, 4);
  assert.equal(plan.manual.length, 1);
  await applyEdits(root, plan.edits);
  assert.equal(await readFile(join(root, '.nvmrc'), 'utf8'), 'v24.22.1\r\n');
  assert.equal(await readFile(join(root, '.nvmrc.nodfix-backup'), 'utf8'), 'v24.22.0\r\n');
  assert.equal(await readFile(join(root, '.node-version'), 'utf8'), '22.23.4\n');
  assert.equal(await readFile(join(root, 'Dockerfile'), 'utf8'), 'FROM node:26.12.1-alpine\r\n');
  const after = await readFile(join(root, 'package.json'), 'utf8');
  assert.ok(after.includes('\r\n'));
  assert.deepEqual(JSON.parse(after), { private: true, volta: { node: '24.22.1' }, engines: { node: '^24.0.0' } });
  assert.equal((await planFix(root, await scan(root, db, undefined, '24.22.1', fixtureNow))).edits.length, 0);
});
test('digest-pinned Docker images and EOL declarations require manual remediation', async (t) => {
  const root = await project(t, { 'Dockerfile': 'FROM node:24.22.0@sha256:abc123\n', '.nvmrc': '20.0.0\n' });
  const plan = await planFix(root, await scan(root, db, undefined, '24.22.0', fixtureNow));
  assert.equal(plan.edits.length, 0);
  assert.equal(plan.manual.length, 2);
});
test('concurrent modifications, existing backups, traversal and hardlinks are refused', async (t) => {
  const root = await project(t, { '.nvmrc': '24.22.0\n' });
  const edit = { file: '.nvmrc', before: '24.22.0\n', after: '24.22.1\n', changes: [] };
  await writeFile(join(root, '.nvmrc'), '22.0.0\n');
  await assert.rejects(applyEdits(root, [edit]), /changed/);
  await writeFile(join(root, '.nvmrc'), edit.before);
  await writeFile(join(root, '.nvmrc.nodfix-backup'), 'keep');
  await assert.rejects(applyEdits(root, [edit]), /EEXIST/);
  assert.equal(await readFile(join(root, '.nvmrc.nodfix-backup'), 'utf8'), 'keep');
  await assert.rejects(applyEdits(root, [{ ...edit, file: '../escape' }]), /Unsafe/);
  await link(join(root, '.nvmrc'), join(root, '.node-version'));
  await assert.rejects(applyEdits(root, [edit]), /regular/);
});
test('symlinks are skipped and cannot be fixed', { skip: process.platform === 'win32' }, async (t) => {
  const external = await project(t, { '.nvmrc': '24.22.0\n' });
  const root = await project(t);
  await symlink(join(external, '.nvmrc'), join(root, '.nvmrc'));
  const discovery = await discover(root);
  assert.equal(discovery.declarations.length, 0);
  assert.ok(discovery.diagnostics.some((message) => /symlink/.test(message)));
  await assert.rejects(applyEdits(root, [{ file: '.nvmrc', before: '24.22.0\n', after: '24.22.1\n', changes: [] }]), /Unsafe/);
});

test('patched Docker tags with digests and variable base images remain inconclusive', async (t) => {
  const root = await project(t, { 'Dockerfile': 'FROM node:24.22.1@sha256:abc123\nFROM ${BASE_IMAGE}\n' });
  const report = await scan(root, db, undefined, '24.22.1', fixtureNow);
  assert.equal(report.exitCode, 2);
  assert.equal(report.declarations.length, 2);
  assert.ok(report.declarations.every((finding) => finding.assessment.status === 'unknown'));
});
test('oversized and malformed declarations mark discovery incomplete and block CLI fixes', async (t) => {
  const root = await project(t, { '.nvmrc': 'x'.repeat(1024 * 1024 + 1), 'package.json': '{"engines":{"node":22}}' });
  const report = await scan(root, db, undefined, '24.22.1', fixtureNow);
  assert.equal(report.incomplete, true);
  assert.equal(report.exitCode, 2);
  assert.equal(report.diagnostics.length, 2);
});
