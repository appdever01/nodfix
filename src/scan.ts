import semver from 'semver';
import { assess, type Assessment } from './assessment.js';
import { discover } from './discovery.js';
import type { Declaration } from './declarations.js';
import type { Database } from './schema.js';

export interface Finding { declaration: Declaration | null; assessment: Assessment }
export interface Report {
  schemaVersion: 1;
  command: string;
  generatedAt: string;
  advisory: { id: string; source: string; revision: number; reviewedAt: string; stale: boolean };
  scope: string;
  runtime: Finding;
  declarations: Finding[];
  warnings: string[];
  diagnostics: string[];
  incomplete: boolean;
  exitCode: number;
}
export async function scan(root: string, db: Database, id?: string, runtime = process.version, now = new Date()): Promise<Report> {
  const advisory = id ? db.advisories.find((a) => a.id === id) : db.advisories.at(-1);
  if (!advisory) throw new Error('Selected advisory not found');
  const discovery = await discover(root);
  const stale = now >= new Date(db.expiresAt) || now.getTime() + 300_000 < Date.parse(db.reviewedAt);
  const runtimeFinding = { declaration: null, assessment: assess(runtime, advisory, db, now) };
  const declarations = discovery.declarations.map((declaration) => {
    const assessment = assess(declaration.value, advisory, db, now);
    if (declaration.kind === 'docker' && declaration.image?.includes('@') && assessment.status === 'patched') {
      assessment.status = 'unknown';
      assessment.reason = 'The image digest content was not inspected; a version tag cannot establish its runtime.';
    }
    return { declaration, assessment };
  });
  const warnings = ['Only the executing Node.js binary and discovered project declarations were checked. Production, containers, other installed binaries, and custom backports were not verified.'];
  if (stale) warnings.push('Advisory review is stale or future-dated; update trusted advisory data before relying on a passing result.');
  if (declarations.some((f) => f.declaration?.kind === 'docker')) warnings.push('Rebuild Docker images and redeploy; a tag or Dockerfile change does not replace running containers.');
  const diagnostics = [...discovery.diagnostics];
  for (const finding of declarations) {
    const declaration = finding.declaration!;
    const bounded = declaration.value.length <= 512;
    const exact = bounded ? semver.valid(declaration.value) : null;
    const range = bounded && declaration.value.trim() ? semver.validRange(declaration.value) : null;
    if (range && semver.valid(runtime) && !semver.satisfies(runtime, range)) {
      diagnostics.push(`Runtime does not satisfy ${declaration.file}:${declaration.line} (${declaration.value}).`);
    }
    if (exact && semver.valid(runtime) && semver.neq(exact, runtime)) warnings.push(`Different exact runtime pin in ${declaration.file}:${declaration.line}.`);
  }
  const findings = [runtimeFinding, ...declarations];
  const vulnerable = findings.some((f) => ['vulnerable', 'potentially-vulnerable', 'eol'].includes(f.assessment.status));
  const unknown = findings.some((f) => f.assessment.status === 'unknown');
  return {
    schemaVersion: 1, command: 'scan', generatedAt: now.toISOString(),
    advisory: { id: advisory.id, source: advisory.source, revision: db.revision, reviewedAt: db.reviewedAt, stale },
    scope: 'Local executing runtime and project version declarations only',
    runtime: runtimeFinding, declarations, warnings, diagnostics, incomplete: discovery.diagnostics.length > 0,
    exitCode: vulnerable ? 1 : unknown || stale || diagnostics.length ? 2 : 0,
  };
}
