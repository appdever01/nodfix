import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assess } from '../dist/assessment.js';
import { databaseSchema } from '../dist/schema.js';
import { advisory, db, fixtureNow } from './helpers.mjs';

const check = (value) => assess(value, advisory, db, fixtureNow);
test('bundled facts match researched official release fixtures', async () => {
  const facts = JSON.parse(await readFile(new URL('./fixtures/official-facts.json', import.meta.url), 'utf8'));
  assert.deepEqual(advisory.lines.map((l) => l.fixed), facts.fixes);
  assert.deepEqual(advisory.issues.map(({ id, severity, affectedMajors }) => ({ id, severity, affectedMajors })), facts.issues);
  assert.equal(facts.issues.length, 10);
  assert.equal(facts.issues.filter((i) => i.severity === 'high').length, 4);
});
for (const [value, fixed, count] of [['22.23.3', '22.23.4', 7], ['24.22.0', '24.22.1', 8], ['26.12.0', '26.12.1', 10], ['v26.7.0', '26.12.1', 10]]) {
  test(`flags pre-patch ${value} with correct CVEs`, () => {
    const result = check(value);
    assert.equal(result.status, 'vulnerable');
    assert.equal(result.recommended, fixed);
    assert.equal(result.issues.length, count);
    assert.match(result.reason, /conservative/);
  });
}
for (const value of ['22.23.4', '24.22.1', '26.12.1', '26.12.2', 'v24.22.1', '24.22.1+vendor']) {
  test(`recognizes patched ${value} for selected advisory`, () => assert.equal(check(value).status, 'patched'));
}
for (const value of ['18.20.8', '20.19.0', '23.0.0', '25.0.0']) {
  test(`flags EOL ${value} without inventing individual CVEs`, () => {
    assert.equal(check(value).status, 'eol');
    assert.deepEqual(check(value).issues, []);
  });
}
for (const value of ['garbage', 'lts/*', 'node', 'latest', '26.12.1-rc.1', '27.0.0', '999.0.0', '']) {
  test(`keeps unresolved ${JSON.stringify(value)} inconclusive`, () => assert.equal(check(value).status, 'unknown'));
}
test('ranges are declaration risks rather than evidence of installed versions', () => {
  for (const value of ['24', '24.x', '^24.0.0', '~24.22.0', '>=22', '*', '22 || 24']) assert.equal(check(value).status, 'potentially-vulnerable');
  for (const value of ['^24.22.1', '>=24.22.1 <25', '>=22.23.4 <23 || >=26.12.1 <27']) assert.equal(check(value).status, 'patched');
  for (const value of ['>=26.12.1', '>=28', '20']) assert.equal(check(value).status, 'unknown');
});
test('lifecycle expiry overrides previously patched versions', () => {
  assert.equal(assess('22.23.4', advisory, db, new Date('2027-05-01')).status, 'eol');
});
test('database rejects malformed, foreign, duplicate and inconsistent advisory data', () => {
  for (const mutate of [
    (copy) => { copy.schemaVersion = 2; },
    (copy) => { copy.advisories[0].lines[0].fixed = '24.22.1'; },
    (copy) => { copy.advisories[0].source = 'https://evil.test/advisory'; },
    (copy) => { copy.advisories[0].issues[0].id = 'CVE-fake'; },
    (copy) => { copy.advisories[0].issues[0].affectedMajors = [99]; },
    (copy) => { copy.advisories[0].issues.push(copy.advisories[0].issues[0]); },
    (copy) => { copy.expiresAt = copy.reviewedAt; },
  ]) {
    const copy = structuredClone(db);
    mutate(copy);
    assert.equal(databaseSchema.safeParse(copy).success, false);
  }
});
