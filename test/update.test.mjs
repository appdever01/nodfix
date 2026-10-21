import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fetchDatabase, cacheDatabase, MAX_BYTES } from '../dist/database.js';
import { db, project, freshDatabase } from './helpers.mjs';

const url = `https://raw.githubusercontent.com/appdever01/nodfix/${'a'.repeat(40)}/data/advisories.json`;
const bytes = JSON.stringify(db);
const hash = createHash('sha256').update(bytes).digest('hex');
const mock = async () => new Response(bytes);
test('downloads only commit-pinned trusted repository data with verified digest', async () => {
  const result = await fetchDatabase(url, hash, async (source, options) => {
    assert.equal(String(source), url);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return mock();
  });
  assert.deepEqual(result, db);
});
test('network failure, invalid digest, HTTP errors, oversized and invalid data fail closed', async () => {
  await assert.rejects(fetchDatabase(url, hash, async () => { throw Error('offline'); }), /offline/);
  await assert.rejects(fetchDatabase(url, '0'.repeat(64), mock), /integrity/);
  await assert.rejects(fetchDatabase(url, hash, async () => new Response('missing', { status: 404 })), /HTTP 404/);
  await assert.rejects(fetchDatabase(url, hash, async () => new Response('x'.repeat(MAX_BYTES + 1))), /size/);
  const invalid = '{"schemaVersion":1}';
  await assert.rejects(fetchDatabase(url, createHash('sha256').update(invalid).digest('hex'), async () => new Response(invalid)));
});
test('rejects alternate hosts, scripts, mutable branches, URL credentials and query strings before network access', async () => {
  for (const source of ['http://localhost/a', 'https://evil.test/a', 'https://raw.githubusercontent.com/other/repo/a/data/advisories.json', url.replace('a'.repeat(40), 'main'), `${url}?redirect=1`, url.replace('https://', 'https://user:pass@')]) {
    await assert.rejects(fetchDatabase(source, hash, async () => { assert.fail('Network must not run'); }), /commit-pinned/);
  }
  await assert.rejects(fetchDatabase(url, 'garbage', mock), /SHA-256/);
});
test('cache rejects rollbacks, expired updates and future timestamps without corrupting previous data', async (t) => {
  const root = await project(t);
  const file = join(root, 'cache.json');
  const fresh = freshDatabase();
  fresh.revision = 2;
  await cacheDatabase(fresh, file);
  const before = await readFile(file, 'utf8');
  await assert.rejects(cacheDatabase({ ...fresh, revision: 1 }, file), /rollback/);
  await assert.rejects(cacheDatabase({ ...fresh, expiresAt: '2020-01-01T00:00:00Z' }, file), /expired/);
  await assert.rejects(cacheDatabase({ ...fresh, reviewedAt: '2099-01-01T00:00:00Z' }, file), /future/);
  assert.equal(await readFile(file, 'utf8'), before);
  await writeFile(file, 'invalid');
  await assert.rejects(cacheDatabase(fresh, file));
  assert.equal(await readFile(file, 'utf8'), 'invalid');
});
