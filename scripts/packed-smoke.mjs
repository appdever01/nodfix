import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'nodfix-pack-'));
const npm = process.env.npm_execpath;
if (!npm) throw Error('Run with npm run smoke:pack');
function command(args, expected = 0) {
  const result = spawnSync(process.execPath, [npm, ...args], { encoding: 'utf8', timeout: 60_000 });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(result.status), `${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
try {
  const packed = JSON.parse(command(['pack', '--ignore-scripts', '--json', '--pack-destination', root]))[0];
  const paths = packed.files.map((file) => file.path);
  assert.ok(paths.includes('dist/cli.js') && paths.includes('data/advisories.json'));
  assert.ok(!paths.some((path) => /(^|\/)(src|test|\.local|\.openai|node_modules)(\/|$)|AGENTS\.md|CLAUDE\.md|CODEX\.md/.test(path)));
  const install = join(root, 'install');
  command(['install', '--prefix', install, '--ignore-scripts', '--no-audit', '--no-fund', join(root, packed.filename)]);
  const project = join(root, 'project');
  await mkdir(project);
  await writeFile(join(project, '.nvmrc'), '24.22.0\n');
  for (const mode of ['scan', 'verify']) {
    const report = JSON.parse(command(['exec', '--prefix', install, '--offline', '--', 'nodfix', mode, '--path', project, '--json'], 1));
    assert.equal(report.declarations[0].assessment.recommended, '24.22.1');
  }
  command(['exec', '--prefix', install, '--offline', '--', 'nodfix', 'fix', '--path', project, '--dry-run', '--yes', '--json'], 1);
  assert.equal(await readFile(join(project, '.nvmrc'), 'utf8'), '24.22.0\n');
  const fixed = JSON.parse(command(['exec', '--prefix', install, '--offline', '--', 'nodfix', 'fix', '--path', project, '--yes', '--json'], [0, 1, 2]));
  assert.deepEqual(fixed.remediation.applied, ['.nvmrc']);
  assert.equal(await readFile(join(project, '.nvmrc'), 'utf8'), '24.22.1\n');
  assert.equal(await readFile(join(project, '.nvmrc.nodfix-backup'), 'utf8'), '24.22.0\n');
  process.stdout.write(`Packed CLI installation and scan/fix/verify smoke passed (${packed.filename}).\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
