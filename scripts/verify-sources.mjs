import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const facts = JSON.parse(await readFile(new URL('../test/fixtures/official-facts.json', import.meta.url), 'utf8'));
const db = JSON.parse(await readFile(new URL('../data/advisories.json', import.meta.url), 'utf8'));
const base = 'https://raw.githubusercontent.com/nodejs/nodejs.org/main/apps/site/pages/en/blog/';
for (const source of facts.sources) {
  const url = new URL(source.url);
  if (url.protocol !== 'https:' || url.hostname !== 'nodejs.org') throw Error('Unexpected research source');
  const path = url.pathname.replace('/en/blog/', '').replace(/\/$/, '');
  const response = await fetch(`${base}${path}.md`, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw Error(`Source unavailable: ${source.url} (${response.status})`);
  const text = await response.text();
  if (createHash('sha256').update(text).digest('hex') !== source.sha256) throw Error(`Source changed; review required: ${source.url}`);
  if (path.startsWith('vulnerability/')) {
    const ids = [...text.matchAll(/^## .*?\((CVE-\d+-\d+)\) - \((high|medium|low|critical)\)/gm)].map((match) => ({ id: match[1], severity: match[2] }));
    if (JSON.stringify(ids) !== JSON.stringify(db.advisories[0].issues.map(({ id, severity }) => ({ id, severity })))) throw Error('Advisory CVEs or severity differ');
  }
  process.stdout.write(`Verified source: ${source.url}\n`);
}
const schedule = await fetch(db.scheduleSource, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
if (!schedule.ok) throw Error('Release schedule unavailable');
const lifecycle = await schedule.json();
for (const line of db.lifecycle) {
  if (lifecycle[`v${line.major}`]?.end !== line.end) throw Error(`Release lifecycle changed for ${line.major}`);
}
process.stdout.write('Verified lifecycle schedule.\n');
