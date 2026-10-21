# Security policy

Nodfix is a new security utility. Version 0.1.x is the supported development line. It has automated tests but has not received an independent security audit.

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/appdever01/nodfix/security/advisories/new). Include affected versions, reproduction steps, impact and any suggested fix. Avoid posting sensitive exploit details in a public issue. Response times are not guaranteed.

For vulnerabilities in Node.js itself, follow the [Node.js security policy](https://nodejs.org/en/security/).

## Trust and boundaries

Scans run offline. No telemetry, secret collection, runtime installation, package lifecycle execution or remote script execution is part of the scanner. Remediation prints manager commands without running them. Manager discovery checks executable filenames in PATH and the presence of nvm.sh in NVM_DIR. Those values are not included in reports or transmitted.

Project files are untrusted input. The scanner only reads supported version declaration files, skips symlinks and common generated/dependency directories, and limits traversal and file sizes. Scan diagnostics and unknown versions prevent a passing verification result. Scan a stable checkout you control. Filesystem checks and per-file atomic replacement reduce accidental overwrites; they are not a sandbox against a hostile process concurrently replacing directories.

Fixes require --yes or interactive approval, preserve major versions, refuse hardlinks and symlinks, keep exclusive .nodfix-backup copies, and detect changed files before replacement. Changes are atomic per file, not transactional across multiple files. If a later file fails, earlier changes remain and are listed on stderr. Inspect the backups and report before retrying. Backups may contain existing project metadata; protect them as you protect the original files.

Advisory updates accept only commit-pinned HTTPS URLs from this repository, reject redirects, require a separately trusted SHA-256 digest, enforce size and time limits, validate the schema, and reject older revisions. A hash authenticates data only when its expected value comes from a trusted channel. It is not a signature from Node.js. Local --database files are trusted operator input and schema-validated. A modified local database or compromised maintainer account can produce misleading findings.

A passing result is limited to the selected advisory and inspected declarations. It does not certify deployment state, image contents, platform vendor backports, all installed runtimes, dependencies, exploitability or future vulnerabilities. Rebuild containers, restart processes and verify on each deployed environment using your normal release process.
