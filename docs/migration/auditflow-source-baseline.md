# AuditFlow production source baseline

## Provenance

The application baseline was imported from `git@github.com:noamtz/auditflow.git` at immutable commit
`5920c779cc49d6502bdbb2aad56e40845778fc9c` (tree
`3b917168ac82d871be3fe08e503388b7eae06ff8`). Local source `HEAD` and remote `main` matched before staging and
after destination validation. The source working tree remained clean throughout.

The destination import started from `noamtz/cpa-platform` commit
`5995f25b380c658539a35fb827d82ea4b5a6ba64` on branch `docs/wiki-artifact-workflow`; the required plan base
`c1ffd081872460affcfc7da93d10ac24ea2e3379` is an ancestor. Git 2.37.0 for Windows was used for inventory,
archive, and raw-blob verification.

## Import policy and accounting

The pinned tree contains 184 tracked files and 1,909,064 Git-blob bytes. The complete per-path evidence is in
[`auditflow-source-manifest.json`](auditflow-source-manifest.json).

| Disposition | Count | Treatment |
| --- | ---: | --- |
| `copy-exact` | 174 | Copied from a command-local `core.autocrlf=false` Git archive and verified against the source blob ID. |
| `adapt-after-copy` | 3 | Copied exactly, then given only the repository guard described below. |
| `merge` | 1 | Source runtime/build/infrastructure ignore rules were deduplicated into the preserved destination `.gitignore`. |
| `exclude` | 6 | Obsolete source instructions and source README were not imported. |

The excluded paths are:

- `README.md`
- `.agents/AGENTS.md`
- `.agents/skills/debug-lambda/SKILL.md`
- `.agents/skills/deploy-lambda/SKILL.md`
- `.agents/skills/migration-checklist/SKILL.md`
- `.agents/skills/terraform-infra/SKILL.md`

The adapted paths are:

- `.github/workflows/deploy-lambda.yml`
- `.github/workflows/deploy-lambda-prod.yml`
- `.github/workflows/rollback-prod.yml`

Each copied workflow retains its original name, triggers, regions, commands, and deployment settings. Its only
adaptation is a comment referring to issue #9 and the job condition
`github.repository == 'noamtz/auditflow'`. That condition is false in `noamtz/cpa-platform`, so the legacy
workflows cannot deploy from this repository.

Destination `AGENTS.md`, `README.md`, `.agents/**`, `.codex/**`, `.archon/**`, `tooling/**`, and
`.github/project-documents.json` were preserved. The README and operating instructions were then deliberately
updated to make the local AuditFlow baseline primary and to acknowledge the approved SST v3 target architecture.

## Validation baseline

Both runs used Node 20.17.0 and npm 10.8.2. The source run used a fresh disposable extraction outside both Git
repositories; the destination run followed a separate `npm ci`. Generated dependencies and build output were not
tracked.

| Command | Disposable source | Destination | Comparison |
| --- | --- | --- | --- |
| `npm ci` | exit 0; 913 packages installed | exit 0; 913 packages installed | Same outcome and dependency warnings. |
| `npm test` | exit 0; 3 files, 67 tests passed | exit 0; 3 files, 67 tests passed | Normalized logs identical. |
| `npm run typecheck` | exit 2; 233 TypeScript diagnostics | exit 2; 233 TypeScript diagnostics | Normalized logs identical; pre-existing source failure. |
| `npm run lint` | exit 1; 23 errors, 0 warnings | exit 1; 23 errors, 0 warnings | Normalized logs identical; pre-existing source failure. |
| `npm run build` | exit 0 | exit 0 | Output identical after removing shell wrapper line-number noise. |

`npm ci` also reported the source lockfile's existing peer/engine warnings, 26 audit findings, and a Node-engine
warning from `pdfjs-dist`; installation still completed. No dependency, product code, lint, or typecheck cleanup was
performed because this change locks the production baseline rather than altering it.

The repository-specific validation also passed:

- Importer unit suite: 9 tests passed at import; the post-merge Windows portability regression expands the suite
  to 11 passing tests.
- Codex layer: 31 skills and 6 custom agents valid.
- Manifest JSON parsed and all 184 final dispositions independently reverified.
- Workflow guards and imported ignore rules were present.

## Reproduction

Inspect without writing:

```powershell
python tooling/import_auditflow_source.py inspect `
  --source C:\Users\ntzur\workspace-antigravity\auditflow `
  --destination . `
  --expected-commit 5920c779cc49d6502bdbb2aad56e40845778fc9c
```

Create a new disposable source extraction, switch to Node 20.17.0, and run the application baseline:

```powershell
$stagePath = Join-Path ([IO.Path]::GetTempPath()) ("auditflow-source-" + [guid]::NewGuid())
python tooling/import_auditflow_source.py stage `
  --source C:\Users\ntzur\workspace-antigravity\auditflow `
  --expected-commit 5920c779cc49d6502bdbb2aad56e40845778fc9c `
  --output $stagePath
nvm use 20.17.0
Push-Location $stagePath
npm ci
npm test
npm run typecheck
npm run lint
npm run build
Pop-Location
```

On this machine NVM could not replace the system Node symlink without elevation, so the installed Node 20.17.0
and npm executables were invoked directly instead. The active system Node version remained 24.13.0.

Verify the committed manifest and applied bytes:

```powershell
python -m json.tool docs/migration/auditflow-source-manifest.json
python tooling/import_auditflow_source.py inspect `
  --source C:\Users\ntzur\workspace-antigravity\auditflow `
  --destination . `
  --expected-commit 5920c779cc49d6502bdbb2aad56e40845778fc9c `
  --manifest docs/migration/auditflow-source-manifest.json `
  --verify-applied
```

Committed-manifest verification compares immutable evidence: repository identities, the pinned source commit/tree
and inventory, disposition counts, and every per-file blob verification. The manifest retains the Git version,
destination branch, and pre-import destination commit as provenance observations, but later commits, branch
checkouts, or Git upgrades do not invalidate otherwise identical import evidence. Destination verification hashes
the path-aware canonical content that Git would commit, so clean LF and CRLF worktrees reproduce the same blob
evidence; source archive verification remains byte-exact with Git filters disabled.

## Result

The destination contains the complete tracked production application baseline needed for later migration work.
Product additions remain source-blob identical except for the three documented workflow guards; the merged ignore
file and preserved destination controls are explicitly accounted for. Source and destination validation have the
same outcome classes and normalized diagnostics.
