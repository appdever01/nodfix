import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import semver from 'semver';
import type { Report } from './scan.js';

export interface Edit { file: string; before: string; after: string; changes: { from: string; to: string; line: number }[] }
export interface Plan { edits: Edit[]; manual: string[] }
export async function planFix(root: string, report: Report): Promise<Plan> {
  const plan: Plan = { edits: [], manual: [] };
  if (report.advisory.stale) {
    plan.manual.push('Refresh stale advisory data before changing declarations.');
    return plan;
  }
  for (const finding of report.declarations) {
    const declaration = finding.declaration!;
    const target = finding.assessment.recommended;
    if (finding.assessment.status === 'patched') continue;
    if (!target || (declaration.kind === 'engines' && !semver.valid(declaration.value)) || declaration.image?.includes('@')) {
      plan.manual.push(`${declaration.file}:${declaration.line}: review ${declaration.value}; ranges, digest pins, aliases, and unsupported majors require a manual decision.`);
      continue;
    }
    let edit = plan.edits.find((item) => item.file === declaration.file);
    if (!edit) {
      const before = await readFile(resolve(root, declaration.file), 'utf8');
      edit = { file: declaration.file, before, after: before, changes: [] };
      plan.edits.push(edit);
    }
    const newline = edit.before.includes('\r\n') ? '\r\n' : '\n';
    if (declaration.pointer) {
      const pkg: Record<string, unknown> = JSON.parse(edit.after) as Record<string, unknown>;
      const section = pkg[declaration.pointer];
      if (!section || typeof section !== 'object' || !('node' in section) || section.node !== declaration.value) throw new Error('Declaration changed during fix planning');
      section.node = target;
      const indent = edit.before.match(/\n([\t ]+)"/)?.[1] ?? '  ';
      edit.after = JSON.stringify(pkg, null, indent).replaceAll('\n', newline) + (edit.before.endsWith('\n') ? newline : '');
    } else if (declaration.kind === 'docker') {
      const lines = edit.after.split(/\r?\n/);
      const line = lines[declaration.line - 1]!;
      const image = declaration.image!;
      const updated = image.replace(/:([^:]+)$/, (_full, tag: string) => `:${tag.replace(/^v?\d+(?:\.\d+){0,2}/, target)}`);
      if (updated === image) { plan.manual.push(`${declaration.file}:${declaration.line}: update image manually.`); continue; }
      lines[declaration.line - 1] = line.replace(image, updated);
      edit.after = lines.join(newline);
    } else {
      edit.after = edit.after.replace(declaration.value, declaration.value.startsWith('v') ? `v${target}` : target);
    }
    edit.changes.push({ from: declaration.value, to: target, line: declaration.line });
  }
  plan.edits = plan.edits.filter((edit) => edit.before !== edit.after);
  return plan;
}
export function publicPlan(plan: Plan): { edits: { file: string; changes: Edit['changes'] }[]; manual: string[] } {
  return { edits: plan.edits.map(({ file, changes }) => ({ file, changes })), manual: plan.manual };
}
