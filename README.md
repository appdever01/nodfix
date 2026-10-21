# Nodfix

Check your Node.js version against official security advisories and see what needs updating.

Nodfix scans your running runtime and project version declarations, recommends a patched release within the same major, and updates supported pins after approval.

[npm package](https://www.npmjs.com/package/nodfix) · [Report a security issue](https://github.com/appdever01/nodfix/security/advisories/new) · [MIT license](LICENSE)

## Quickstart

Requires Node.js 22.13.0 or later.

```sh
npx nodfix scan
```

If the scan finds an affected version, preview the suggested changes:

```sh
npx nodfix fix --dry-run
```

Review the plan, then approve it in your terminal:

```sh
npx nodfix fix --interactive
```

Install the recommended Node.js release using your runtime manager, then check again:

```sh
npx nodfix verify
```

Nodfix prints upgrade commands for nvm, fnm, Volta, asdf and mise. You run those commands yourself. The CLI cannot patch the Node.js binary, restart your app or replace a running container.

You can also install it with `npm install --global nodfix` and use `nodfix` directly. The first `npx` installation needs network access; scans run offline after installation.

## What gets checked

| Source | What Nodfix reads |
| --- | --- |
| Running Node.js process | The version of the binary executing Nodfix |
| `.nvmrc` and `.node-version` | Project runtime declarations |
| `package.json` | `engines.node` and `volta.node` |
| Dockerfiles | Official Node image tags in `FROM` instructions, including continued lines |

The scan walks nested projects and workspaces. It reports unresolved aliases, prereleases and uncovered versions for manual review. Docker image digests are not inspected, and custom images or Node.js installations inside `RUN` commands are outside detection.

A passing result applies to the selected advisory and the files that were checked. Verify inside each deployment environment after upgrading. A changed version file does not establish which runtime is running in production.

## Commands

| Command | Result |
| --- | --- |
| `scan` | Assess the local runtime and project declarations |
| `fix` | Show a plan; update supported declarations after approval |
| `verify` | Rescan the runtime and check declaration consistency |
| `advisories update` | Download and verify a separately versioned advisory database |

Use `--path` to scan another project:

```sh
npx nodfix scan --path /path/to/project
```

For scripts and CI, choose JSON or SARIF output:

```sh
npx nodfix scan --json --ci
npx nodfix verify --json > verification.json
npx nodfix scan --format sarif > nodfix.sarif
```

`scan`, `fix` and `verify` accept `--path`, `--database`, `--advisory`, `--json`, `--format`, `--ci` and `--offline`. SARIF is available for `scan` and `verify`; `fix` supports text and JSON. `--ci` prevents interactive approval. Run `npx nodfix --help` for the command list.

### Exit codes

| Exit | Meaning |
| --- | --- |
| 0 | All checked versions/declarations meet the selected advisory; no blocking diagnostics; data is fresh |
| 1 | Vulnerable or potentially vulnerable versions, or an end-of-life runtime, were found |
| 2 | Inconclusive assessment, stale data, inconsistent declarations, incomplete discovery, invalid input or an operational failure |

If findings and uncertainty coexist, exit 1 takes precedence. Read `diagnostics` and `incomplete` in the JSON report as well as the exit code. Incomplete scans are marked unsuccessful in SARIF.

## Applying fixes

`fix` previews changes by default. Use `--interactive` to review and approve the plan, or `--yes` to approve automatic configuration updates without a prompt. `--dry-run` prevents writes even when combined with `--yes`.

Automatic fixes preserve major versions and Docker image suffixes. They cover single-major nvm/fnm declarations, Volta pins and exact engines pins. Broad ranges, aliases, digest pins, split image tokens and major migrations need manual review.

Changed files get a `.nodfix-backup`. Existing backups, concurrent edits, symlinks, hardlinks and incomplete discovery block writes. JSON files may be reformatted. Changes are atomic per file; if a later update fails, earlier changes remain and are listed on stderr. Review backups before retrying, then rebuild and redeploy where needed. See [SECURITY.md](SECURITY.md) for the file-write safeguards.

## October 2026 advisory

The bundled data comes from the [official October 21, 2026 advisory](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), its linked release notes and the [Node.js release schedule](https://github.com/nodejs/Release#release-schedule).

| Release line | Security release | CVEs listed for that line |
| --- | --- | --- |
| 22.x | [22.23.4](https://nodejs.org/en/blog/release/v22.23.4/) | 7 |
| 24.x | [24.22.1](https://nodejs.org/en/blog/release/v24.22.1/) | 8 |
| 26.x | [26.12.1](https://nodejs.org/en/blog/release/v26.12.1/) | 10 |

The advisory lists four high, three medium and three low severity CVEs. [data/advisories.json](data/advisories.json) records the IDs, affected majors and sources. Severity follows the main advisory.

Upstream does not give precise introduction versions. Nodfix checks earlier stable versions conservatively; these are not verified exact vulnerability intervals. Ranges that allow affected versions are potentially vulnerable. End-of-life releases are flagged separately without unconfirmed CVE assignments. Vendor backports need review.

## Advisory updates

Advisory data can be updated without publishing a new CLI version. Obtain a reviewed commit ID and SHA-256 digest through a trusted channel, then:

```sh
npx nodfix advisories update \
  --url "https://raw.githubusercontent.com/appdever01/nodfix/<40-character-commit>/data/advisories.json" \
  --sha256 "<trusted-64-character-digest>" \
  --output .nodfix-cache/advisories.json
npx nodfix scan --database .nodfix-cache/advisories.json --offline
```

Replace the placeholders with reviewed values. Updates require a commit-pinned HTTPS URL from this repository and a trusted digest, reject redirects and rollbacks, and validate the schema before writing. A failed update preserves the previous cache. Local `--database` files are trusted operator input; a SHA-256 digest is not a Node.js signature.

Reviews expire after 30 days. Stale data cannot produce a passing result, and a fresh review does not guarantee that no newer advisory exists. Data has a versioned schema and revision. The last entry is selected by default; `--advisory october-2026` selects that advisory explicitly. Checks are scoped to the selection. Upstream ingestion is manual.

<details>
<summary>Scan limits and skipped paths</summary>

Traversal stops at 20,000 entries and 30 directory levels. Declaration files are limited to 1 MiB, version values and image references to 512 characters, and advisory databases to 2 MiB. Advisory downloads time out after 10 seconds. Oversized or unreadable declarations make the scan incomplete.

Reads and traversal are bounded. Skipped directories: `node_modules`, `.git`, `.hg`, `.svn`, `.next`, `dist`, `build`, `coverage`, `vendor`, `.openai`, `.local`. Symlinks and Nodfix backups are skipped. `.gitignore` is not interpreted. Scan a stable checkout you control.

</details>

## CI use

Pin the CLI version in your pipeline:

```sh
npx --yes nodfix@0.1.1 scan --ci --json > nodfix.json
```

Keep the scanner's exit code when uploading reports. A vulnerable scan exits 1, so configure report artifacts to upload after failures too.

A [GitHub composite action](action.yml) is also available; pin it to a reviewed full SHA. The configured Windows, Linux and macOS matrix has not executed. External consumer pipelines remain unverified.

<details>
<summary>GitLab CI example</summary>

```yaml
runtime-security:
  image: node:24.22.1-bookworm
  script:
    - npx --yes nodfix@0.1.1 scan --ci --json > nodfix.json
  artifacts:
    when: always
    paths: [nodfix.json]
```

</details>

Dependabot checks npm dependencies and Actions. Renovate can maintain its supported runtime declarations alongside Nodfix. This package does not provide a vulnerability feed for either service.

## Development

```sh
git clone https://github.com/appdever01/nodfix.git
cd nodfix
npm ci --ignore-scripts
npm run check
npm run smoke:pack
npm audit
npm audit signatures
npm run verify:sources
```

To run the checkout after building, use `node dist/cli.js scan --path /path/to/project`.

`check` runs TypeScript, lint and offline tests, with at most two test files running at once. `smoke:pack` installs and exercises a tarball in a temporary project. Tests leave your installed runtime untouched. `verify:sources` contacts official Node.js sources; changed fingerprints require review.

Commander handles commands, Zod validates input and SemVer compares versions. Advisory transport, discovery, assessment, reports and file writes are separate modules. The CLI makes no subprocess calls, executes no project scripts and collects no telemetry. Manager discovery checks PATH and NVM_DIR locally. Reports use schema version 1; text output strips terminal controls.

<details>
<summary>Release checklist</summary>

1. Review the advisory, release notes, lifecycle dates and fingerprints. Increment the data revision for advisory changes.
2. Run the checks above. Inspect `npm pack --dry-run` and test the installed artifact.
3. Run cross-platform CI. Releases 0.1.0 and 0.1.1 have maintainer approval for local validation while hosted CI is unavailable; the matrix remains unverified.
4. Check package contents, version, license, reporting and maintainer access. Exclude credentials, caches and internal guidance.
5. Obtain release authorization and publish using an approved method. Provenance needs separate setup; publishing is not automatic.
6. Verify registry integrity and a fresh-cache `npx nodfix` installation.

</details>

## Security and license

Nodfix has not received an independent audit. A passing scan does not certify dependency, container or production security. npm audits identify known dependency advisories; they cannot rule out unknown vulnerabilities.

Use [private security reporting](https://github.com/appdever01/nodfix/security/advisories/new) for this package and the [Node.js security policy](https://nodejs.org/en/security/) for Node.js itself. [SECURITY.md](SECURITY.md) describes the trust boundaries and disclosure process.

This project is independent of the Node.js project. Released under the [MIT license](LICENSE).
