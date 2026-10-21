import semver from 'semver';
import type { Advisory, Database, Issue } from './schema.js';

export interface Assessment {
  value: string;
  status: 'patched' | 'vulnerable' | 'potentially-vulnerable' | 'eol' | 'unknown';
  issues: Issue[];
  recommended: string | null;
  reason: string;
}
export function assess(value: string, advisory: Advisory, db: Database, now = new Date()): Assessment {
  const base = { value, issues: [] as Issue[], recommended: null };
  if (!value.trim() || value.length > 512) return { ...base, status: 'unknown', reason: 'Missing or oversized version declaration.' };
  const exact = semver.valid(value);
  const range = semver.validRange(value);
  if (!range || (exact && semver.prerelease(exact))) {
    return { ...base, status: 'unknown', reason: 'Unresolved alias, malformed version, or prerelease; inspect manually.' };
  }
  if (exact) {
    const major = semver.major(exact);
    const lifecycle = db.lifecycle.find((line) => line.major === major);
    if (lifecycle && now >= new Date(`${lifecycle.end}T00:00:00Z`)) {
      return { ...base, status: 'eol', reason: `Node.js ${major} is end-of-life; choose a supported release line.` };
    }
    const line = advisory.lines.find((item) => item.major === major);
    if (!line) return { ...base, status: 'unknown', reason: 'Release line is not covered by this advisory.' };
    const issues = advisory.issues.filter((issue) => issue.affectedMajors.includes(major));
    return semver.lt(exact, line.fixed)
      ? { ...base, status: 'vulnerable', issues, recommended: line.fixed, reason: 'Before the security release on an affected major; conservative assessment, introduction versions unspecified upstream.' }
      : { ...base, status: 'patched', reason: 'Meets the selected advisory security release; this is not a claim of general security.' };
  }
  const affected = advisory.lines.filter((line) => semver.intersects(range, `>=${line.major}.0.0 <${line.fixed}`));
  if (affected.length) {
    const majors = new Set(affected.map((line) => line.major));
    return { ...base, status: 'potentially-vulnerable',
      recommended: affected.length === 1 ? affected[0]!.fixed : null,
      issues: advisory.issues.filter((issue) => issue.affectedMajors.some((major) => majors.has(major))),
      reason: 'Declaration permits versions before a security release; it does not establish the installed version.' };
  }
  const supported = advisory.lines.filter((line) => {
    const lifecycle = db.lifecycle.find((item) => item.major === line.major);
    return lifecycle && now < new Date(`${lifecycle.end}T00:00:00Z`);
  }).map((line) => `>=${line.fixed} <${line.major + 1}.0.0`).join(' || ');
  if (supported && semver.subset(range, supported)) {
    return { ...base, status: 'patched', reason: 'Every stable version allowed by this declaration meets the selected advisory.' };
  }
  return { ...base, status: 'unknown', reason: 'Declaration includes end-of-life, uncovered, or unresolved versions.' };
}
