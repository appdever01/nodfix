# Nodfix

An offline Node.js runtime security scanner with guided, consent-based remediation.

Nodfix checks the executing Node.js binary and project version declarations against reviewed official advisories. It recommends security releases within the same major, prints runtime-manager commands, and can update project pins after approval. It never patches the Node.js binary or runs an installer.

**Status:** initial 0.1.0 MVP. Not independently audited. This project is independent of the Node.js project.

## Quickstart

Requires Node.js 22.13.0 or later to run the CLI. Use a supported, patched release for development. Older runtime declarations are still assessed; the tool does not execute alternate installed binaries.

```sh
npx nodfix scan
npx nodfix fix --dry-run
npx nodfix fix --interactive
npx nodfix verify --json
```

The npm package's repository must point to `appdever01/nodfix`. For a permanent command, use `npm install --global nodfix`.

## Run from source

```sh
git clone https://github.com/appdever01/nodfix.git
cd nodfix
npm ci --ignore-scripts
npm run build
node dist/cli.js scan --path /path/to/project
node dist/cli.js fix --path /path/to/project --dry-run
node dist/cli.js verify --path /path/to/project --json
```

After building, `npm install --global .` installs the source checkout's `nodfix` command locally.

## October 2026 advisory

The bundled database was researched on October 21, 2026 using the [official security advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), its three linked security release notes, and the [Node.js release schedule](https://github.com/nodejs/Release#release-schedule).

| Release line | Security release | CVEs listed for that line |
| --- | --- | --- |
| 22.x | [22.23.4](https://nodejs.org/en/blog/release/v22.23.4/) | 7 |
| 24.x | [24.22.1](https://nodejs.org/en/blog/release/v24.22.1/) | 8 |
| 26.x | [26.12.1](https://nodejs.org/en/blog/release/v26.12.1/) | 10 |

The main advisory lists four high, three medium and three low severity CVEs. Exact IDs, summaries, affected majors and source URLs are in [data/advisories.json](data/advisories.json). The main advisory's severity takes precedence where release notes group multiple CVEs under a single severity.

Upstream identifies affected release lines without precise introduction versions. Nodfix conservatively flags earlier stable versions on those majors as vulnerable, with an explicit explanation. These checks are **not verified exact vulnerability intervals**. Ranges that permit earlier versions are reported as potentially vulnerable. Known end-of-life versions are reported separately without inventing CVE applicability. Custom vendor backports and prereleases require manual review.

A passing result means the selected advisory's release threshold is met within the checked scope. It does not establish production security, dependency security or absence of later vulnerabilities.

## Commands and reports

```sh
nodfix scan --path . --offline
nodfix scan --json --ci
nodfix scan --format sarif > nodfix.sarif
nodfix scan --advisory october-2026
nodfix verify --json > verification.json
nodfix fix --dry-run
nodfix fix --yes
```

`scan`, `fix` and `verify` accept `--path`, `--database`, `--advisory`, `--json`, `--format`, `--ci` and `--offline`. `fix` supports text and JSON; SARIF is available for scan and verify. All scans are offline by default. `--ci` disables interactive approval.

| Exit | Meaning |
| --- | --- |
| 0 | All checked versions/declarations meet the selected advisory; no blocking diagnostics; data is fresh |
| 1 | Vulnerable or potentially vulnerable versions, or an end-of-life runtime, were found |
| 2 | Inconclusive assessment, stale data, inconsistent declarations, incomplete discovery, invalid input or an operational failure |

When findings and uncertainty coexist, exit 1 takes precedence. Always inspect diagnostics and the `incomplete` field as well as the exit code. `verify` uses the same checks and emits a machine-readable report with `--json`; a configuration edit alone cannot confirm runtime remediation.

Nodfix recursively discovers `.nvmrc`, `.node-version`, `package.json` engines and Volta pins, `Dockerfile`, `Dockerfile.*` and `*.Dockerfile`, including nested workspace projects. It reads official Node image tags and multistage FROM instructions. Unresolved image variables and aliases remain inconclusive. Custom images and Node installations performed by RUN commands are outside detection. Digest contents are not inspected.

Traversal skips symlinks, its own backups, dependency folders and common generated directories: `node_modules`, `.git`, `.hg`, `.svn`, `.next`, `dist`, `build`, `coverage`, `vendor`, `.openai`, `.local`. It does not interpret `.gitignore`. Limits are 20,000 entries, 30 directory levels and 1 MiB per declaration file; exceeding them creates an incomplete result.

### What fix can change

`fix` previews changes by default. `--dry-run` always prevents writes, including with `--yes`. `--interactive` displays the plan and asks for approval; `--yes` explicitly approves automatic declaration edits without prompting.

Automatic updates cover single-major nvm/fnm declarations, exact Volta and engines pins, and numeric official Docker tags while retaining their image suffix. Broad engines ranges, unresolved aliases, digest pins and major migrations require a manual decision. Existing majors are preserved. JSON package files retain fields, indentation and newline style, but may be reformatted.

Every changed file gets an exclusive `.nodfix-backup` beside it. Existing backups, changed files, symlinks, hardlinks and incomplete discovery block writes. Inspect backups before removing them to permit future updates. Updates are atomic per file; an error can leave earlier approved files updated, with each written path reported on stderr.

Manager detection covers nvm, fnm, Volta, asdf and mise. Suggestions are printed without execution. Fixes do not restart applications, rebuild images, modify a running container or deploy to production. Run the suggested upgrade in your own terminal, rebuild and redeploy where needed, then run `verify` inside the target environment.

## Advisory updates without a CLI release

Advisory JSON is independently versioned using `schemaVersion` and monotonic `revision`. New reviewed data can be committed to `data/advisories.json` without changing the package version. The latest advisory defaults to the last database entry; use `--advisory` to select another. Assessments are scoped to that selected advisory, not cumulative across every historical record.

Obtain a commit ID and SHA-256 digest through a trusted channel, then:

```sh
nodfix advisories update \
  --url "https://raw.githubusercontent.com/appdever01/nodfix/<40-character-commit>/data/advisories.json" \
  --sha256 "<trusted-64-character-digest>" \
  --output .nodfix-cache/advisories.json
nodfix scan --database .nodfix-cache/advisories.json --offline
```

Downloads require a commit-pinned HTTPS URL in this repository, reject redirects, time out after 10 seconds and are limited to 2 MiB. The digest and strict schema are checked before caching. Older revisions, older review timestamps, expired updates and future-dated reviews are rejected. Failed updates retain the previous cache. Cached data is only used when explicitly selected through `--database`.

Bundled reviews expire after 30 days; stale data cannot produce a passing scan. This freshness limit is a review policy, not proof that no newer advisory exists. The project has no automatic upstream vulnerability ingestion or advisory availability guarantee.

## CI and dependency automation

GitHub Actions can use the composite action from source, even before npm publication. Pin it to a reviewed full commit SHA:

```yaml
steps:
  - uses: actions/checkout@v6
  - uses: actions/setup-node@v6
    with:
      node-version: '24.22.1'
  - uses: appdever01/nodfix@<reviewed-full-commit-sha>
    with:
      path: .
      format: json
```

The action installs its locked build dependencies with lifecycle scripts disabled, compiles the CLI and scans the runner runtime. It does not verify a separate production environment. For SARIF upload workflows, retain the scanner's exit code, upload the report even after findings, then fail the job with the original code. SARIF reports include warnings, scope, execution status and per-CVE results.

GitLab CI before npm publication can build a reviewed source checkout:

```yaml
runtime-security:
  image: node:24.22.1-bookworm
  script:
    - git clone https://github.com/appdever01/nodfix.git /tmp/nodfix
    - git -C /tmp/nodfix checkout "$NODFIX_COMMIT"
    - npm ci --ignore-scripts --prefix /tmp/nodfix
    - npm run build --prefix /tmp/nodfix
    - node /tmp/nodfix/dist/cli.js scan --path "$CI_PROJECT_DIR" --json --ci > nodfix.json
  artifacts:
    when: always
    paths: [nodfix.json]
```

Set `NODFIX_COMMIT` to a reviewed full SHA. These examples are provided for integration; external consumer pipelines have not been executed here. The repository's CI matrix tests Windows, macOS and Linux against the three security releases.

Dependabot is configured for npm dependencies and Actions. Dependabot and Renovate can maintain their supported runtime and Docker declarations alongside Nodfix. Nodfix does not register as a vulnerability feed for those services or update their databases. Review digest changes and rebuild images through the normal release process.

## Development and architecture

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
npm run verify:sources
```

`verify:sources` makes network requests to official Node.js sources and compares current source fingerprints and advisory facts with the research fixture. A changed upstream page requires human review. The regular test suite uses offline fixtures, mocked fetch responses and temporary projects; it never changes the developer's Node.js installation. Test-file concurrency is capped at two.

The TypeScript code separates schema validation and database transport, declaration discovery, SemVer assessment, report generation, remediation planning and guarded file writes. Commander handles the CLI boundary. Zod validates advisory data and package declaration shapes. SemVer handles versions and range intersection. There are no subprocess calls in the shipped CLI.

JSON reports contain the local runtime, each declaration's assessment, source revision, timestamps, scope, warnings, diagnostics and exit code. Text output strips terminal controls from untrusted paths and values. SARIF maps findings to CVE rules and relative source locations. Advisory and report formats are versioned at schema version 1.

## Release checklist

Version 0.1.0 has maintainer approval to release using local validation while hosted CI is unavailable. The cross-platform matrix has not executed for this release. This exception does not represent a passing CI result.

- Review the advisory, linked releases, source fingerprints, lifecycle dates and conservative range policy against official sources. Increment the advisory revision for data changes.
- Run `npm ci --ignore-scripts`, `npm run check`, `npm run verify:sources` and the full cross-platform CI matrix. Resolve every required failure.
- Create and install an npm tarball in a clean temporary project. Smoke-test both command output and scan/fix/verify behavior.
- Inspect `npm pack --dry-run` and staged paths. Exclude local guidance, internal notes, caches, credentials and development artifacts.
- Confirm npm name ownership and maintainer access, review the version, license, repository links and security reporting configuration.
- Configure trusted publishing/provenance or an approved maintainer publishing method. Publish only after explicit release authorization. No automatic publishing workflow is enabled.
- Verify the registry artifact, integrity and a clean `npx nodfix` installation. Publishing the package is a separate action from pushing this repository.

See [SECURITY.md](SECURITY.md) for reporting vulnerabilities and detailed trust boundaries. MIT licensed.
