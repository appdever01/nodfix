import { z } from 'zod';
import semver from 'semver';

const version = z.string().refine((value) => semver.valid(value) === value && !semver.prerelease(value), 'Expected stable canonical SemVer');
const officialUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password &&
    (url.hostname === 'nodejs.org' || (url.hostname === 'raw.githubusercontent.com' && url.pathname.startsWith('/nodejs/')));
}, 'Expected official Node.js source');
const lineSchema = z.object({
  major: z.number().int().positive(),
  fixed: version,
  source: officialUrl,
}).strict().refine((line) => semver.major(line.fixed) === line.major, 'Fixed version must match release line');
const issueSchema = z.object({
  id: z.string().regex(/^CVE-\d{4}-\d{4,}$/),
  summary: z.string().min(1).max(300),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  affectedMajors: z.array(z.number().int().positive()).min(1),
}).strict();
export const databaseSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  reviewedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  scheduleSource: officialUrl,
  lifecycle: z.array(z.object({ major: z.number().int().nonnegative(), end: z.iso.date() }).strict()).min(1),
  advisories: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    published: z.iso.date(),
    source: officialUrl,
    rangePolicy: z.literal('conservative-major-before-fixed'),
    lines: z.array(lineSchema).min(1),
    issues: z.array(issueSchema).min(1),
  }).strict()).min(1),
}).strict().superRefine((db, ctx) => {
  const unique = (values: (string | number)[]) => new Set(values).size === values.length;
  if (Date.parse(db.expiresAt) <= Date.parse(db.reviewedAt) || !unique(db.advisories.map((a) => a.id)) || !unique(db.lifecycle.map((l) => l.major))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid dates or duplicate identities' });
  }
  for (const advisory of db.advisories) {
    if (!unique(advisory.lines.map((l) => l.major)) || !unique(advisory.issues.map((i) => i.id)) || advisory.lines.some((l) => !db.lifecycle.some((item) => item.major === l.major)) || advisory.issues.some((i) => i.affectedMajors.some((major) => !advisory.lines.some((l) => l.major === major)))) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate or missing advisory release line' });
    }
  }
});
export type Database = z.infer<typeof databaseSchema>;
export type Advisory = Database['advisories'][number];
export type Issue = Advisory['issues'][number];
