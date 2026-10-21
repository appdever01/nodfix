import type { Report, Finding } from './scan.js';

export function terminalSafe(text: string): string {
  return Array.from(text, (character) => {
    const code = character.codePointAt(0)!;
    return code <= 31 || (code >= 127 && code <= 159) || /[\u202a-\u202e\u2066-\u2069]/.test(character) ? '?' : character;
  }).join('');
}
export function formatText(report: Report): string {
  const rows = [
    'Nodfix', '',
    `Advisory: ${report.advisory.id} (revision ${report.advisory.revision})`,
    `Node.js: ${report.runtime.assessment.value}`,
    `Local runtime: ${report.runtime.assessment.status.toUpperCase()}`,
    report.runtime.assessment.reason,
  ];
  for (const finding of [report.runtime, ...report.declarations]) {
    const { assessment, declaration } = finding;
    if (declaration) rows.push('', `${declaration.file}:${declaration.line} [${declaration.kind}] ${assessment.value}: ${assessment.status.toUpperCase()}`);
    if (assessment.recommended) rows.push(`Recommended: ${assessment.recommended}`);
    for (const issue of assessment.issues) rows.push(`  [${issue.severity.toUpperCase()}] ${issue.id}: ${issue.summary}`);
  }
  rows.push('', ...report.warnings.map((text) => `Warning: ${text}`), ...report.diagnostics.map((text) => `Review: ${text}`));
  if (report.exitCode !== 0) rows.push('', 'Run nodfix fix --dry-run for a remediation plan.');
  rows.push(`Result: ${report.exitCode === 0 ? 'meets selected advisory within checked scope' : 'action or review required'} (exit ${report.exitCode})`);
  return rows.map(terminalSafe).join('\n');
}
export function toSarif(report: Report): unknown {
  const findings: Finding[] = [report.runtime, ...report.declarations];
  const issues = [...new Map(findings.flatMap((f) => f.assessment.issues).map((i) => [i.id, i])).values()];
  const results = findings.flatMap((finding) => {
    const ids = finding.assessment.issues.length ? finding.assessment.issues.map((i) => i.id) : finding.assessment.status !== 'patched' ? ['NODFIX-REVIEW'] : [];
    return ids.map((id) => ({
      ruleId: id,
      level: finding.assessment.status === 'unknown' ? 'warning' : 'error',
      message: { text: `${finding.declaration?.file ?? 'Executing Node.js runtime'}: ${finding.assessment.value}. ${finding.assessment.reason}${finding.assessment.recommended ? ` Upgrade to ${finding.assessment.recommended}.` : ''}` },
      ...(finding.declaration ? { locations: [{ physicalLocation: { artifactLocation: { uri: finding.declaration.file.split('/').map(encodeURIComponent).join('/') }, region: { startLine: finding.declaration.line } } }] } : {}),
    }));
  });
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json', version: '2.1.0',
    runs: [{ tool: { driver: { name: 'nodfix', informationUri: 'https://github.com/appdever01/nodfix',
      rules: [...issues.map((i) => ({ id: i.id, shortDescription: { text: i.summary }, helpUri: report.advisory.source,
        properties: { 'security-severity': ({ low: '3.0', medium: '6.0', high: '8.0', critical: '9.0' } as const)[i.severity] } })),
        { id: 'NODFIX-REVIEW', shortDescription: { text: 'Runtime requires manual review' } }] } },
      invocations: [{ executionSuccessful: report.exitCode !== 2, toolExecutionNotifications: [...report.warnings, ...report.diagnostics].map((message) => ({ level: 'warning', message: { text: message } })) }],
      properties: { scope: report.scope, advisory: report.advisory, exitCode: report.exitCode }, results }],
  };
}
