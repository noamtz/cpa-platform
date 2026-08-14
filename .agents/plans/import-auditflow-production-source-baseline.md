# Feature: Import AuditFlow production source and lock the parity baseline

This plan targets source commit 5920c779cc49d6502bdbb2aad56e40845778fc9c. The implementation agent must repeat the drift checks before changing files. Preserve names, paths, dependencies, and product behavior; this is a controlled bootstrap, not cleanup.

## Feature Description

Copy the tracked production AuditFlow application from the read-only C:\Users\ntzur\workspace-antigravity\auditflow repository into cpa-platform, while preserving this repository's GitHub Project, Codex, agent, and tooling layer. Pin the import to an immutable Git commit, make it auditable at the file/blob level, and validate it against an identical disposable extraction so import regressions can be separated from source failures.

## User Story

As the AuditFlow product owner, I want the exact production source captured in the migration repository so that AWS migration work can proceed without risking the working Base44 repository or accidentally changing the product baseline.

## Problem Statement

The production application and parity evidence live in another repository, while cpa-platform contains the rewrite planning/tooling. A recursive filesystem copy would include ignored/generated state, could overwrite repository controls, would not prove source revision, and could activate legacy deployment automation in the wrong repository.

## Solution Statement

Create a standard-library Python importer that archives an exact commit to temporary staging, classifies every tracked path using an explicit disposition policy, rejects unexpected collisions/unsupported Git features, and verifies copied bytes against source blob IDs. Commit a machine-readable manifest and human-readable baseline report. Preserve destination AI/tooling, merge ignore rules and README deliberately, exclude obsolete source Antigravity rules, and repository-guard the copied PDF workflows. Run identical application checks under Node 20 in disposable source staging and the destination; record failures without fixing unrelated source defects.

## Out of Scope / Non-Goals

- Not included: SST/AWS resources (#4), Base44 data/file export (#5), or cutover work.
- Not included: replacing Base44, changing APIs/auth/uploads/PDFs/UI/routes/dependencies, or fixing source defects.
- Not included: importing source Git history or making a write, fetch, install, build, cleanup, or worktree operation inside the source repository.
- Not changing: src/components/ui/, Hebrew/RTL behavior, public questionnaire access, Sentry behavior, or production deployment.

## Feature Metadata

**Feature Type**: Refactor / repository bootstrap
**Estimated Complexity**: Medium implementation complexity; high provenance and operational-safety importance
**Primary Systems Affected**: Git layout, application source/config, GitHub Actions, operating instructions, Node validation, Codex tooling
**Dependencies**: Git, Python 3.11+ standard library, Node 20.17.0, npm lockfile install, Windows PowerShell/NVM

## Related Work

**Implements**: [#3](https://github.com/noamtz/cpa-platform/issues/3) · **Epic**: [#1](https://github.com/noamtz/cpa-platform/issues/1)

**Back-references**:

- [Canonical PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration) — executable code is authoritative and the source remains recoverable.
- [Canonical architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration) — mandates the separate minimal-change workspace and excludes source history/generated output.
- [Architecture tracker #2](https://github.com/noamtz/cpa-platform/issues/2) — approved direction inherited by later tickets.

**Forward-references**:

- #4 and #5 are unblocked only after this baseline is accepted.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — read before implementing

Destination:

- AGENTS.md lines 5, 33–50 — source-location, architecture, and validation statements that become local after import.
- .agents/references/auditflow-rewrite-target.md lines 1–9 — accepted source-integrity/parity boundary.
- .agents/references/github-project-documents.md — preserve Wiki/Project artifact handling.
- .github/project-documents.json lines 1–38 — fixed repository/Project identity; never replace.
- .gitignore lines 1–6 — destination-specific configuration, Codex-log, and Python ignores.
- README.md lines 1–37 — keep Project/Codex setup while making AuditFlow primary.
- tooling/configure_github_project.py lines 1–20 and 60–87 — Python standard-library and subprocess error pattern.
- tooling/validate_codex_layer.py lines 14–20 and 149 onward — destination health gate.

Authoritative read-only source:

- package.json lines 1–15 and 90–109 — exact scripts and tool versions.
- package-lock.json — lockfile v3; import unchanged and use npm ci.
- .gitignore lines 1–56 — Node/build/editor/Terraform/Lambda/Base44-local/SST rules to merge.
- .agents/AGENTS.md lines 1–99 — parity evidence only; exclude obsolete Antigravity/Base44 operational mandates.
- .github/workflows/deploy-lambda.yml lines 3–8 and 21–33 — automatic main-branch deploy risk.
- .github/workflows/deploy-lambda-prod.yml lines 3–20 and 23–41 — manual production deployment evidence.
- .github/workflows/rollback-prod.yml lines 3–22 and 24–34 — manual legacy rollback evidence.
- vite.config.js lines 1–18 and 29–38 — existing Base44 plugin/POC behavior; copy unchanged.
- vitest.config.js lines 1–10 — characterization-test pattern.
- jsconfig.json lines 1–20 — current partial type-check scope; do not broaden.
- eslint.config.js lines 7–59 — current lint scope; do not improve here.
- src/App.jsx lines 36–89 — public/CPA route composition.
- src/api/base44Client.js line 1 onward — later compatibility seam; copy unchanged.
- src/lib/__tests__/questionnaire-steps.test.js line 24 onward, questionnaire-template.test.js line 33 onward, and submission-compat.test.js line 30 onward — existing tests.
- lambda/pdf-generator/build.sh line 20 onward — destructive output behavior; never run in source.
- docs/user-journeys/05-traceability-ledger.md line 1 onward — parity discovery evidence.

### Current facts to reverify

- Source local HEAD and remote main: 5920c779cc49d6502bdbb2aad56e40845778fc9c.
- Source tree: 3b917168ac82d871be3fe08e503388b7eae06ff8.
- Source: 184 tracked files and 1,909,064 Git-blob bytes.
- No attributes file, submodule, gitlink, symlink, LFS entry, or case collision found.
- Exact destination collisions: .gitignore and README.md only.
- Destination plan base: c1ffd081872460affcfc7da93d10ac24ea2e3379; implementation must start from a clean branch containing it.

If any fact changes, stop before copying and amend the plan/manifest rather than silently changing the baseline.

### New Files to Create

- tooling/import_auditflow_source.py — dry-run-first staging/import/disposition/blob-verification tool.
- tooling/tests/test_import_auditflow_source.py — temporary-repository unit tests.
- docs/migration/auditflow-source-manifest.json — per-path mode/blob/size/destination/disposition/verification.
- docs/migration/auditflow-source-baseline.md — provenance, policy, validation comparison, and reproduction record.

### Relevant Documentation

- [Git archive description](https://git-scm.com/docs/git-archive#_description) — immutable commit export.
- [Git archive attributes](https://git-scm.com/docs/git-archive#_attributes) — block transformations from export-ignore/export-subst.
- [Git ls-tree](https://git-scm.com/docs/git-ls-tree#_description) — enumerate exact commit path/mode/blob/size.
- [Git hash-object](https://git-scm.com/docs/git-hash-object#_description) — raw byte verification with --no-filters.
- [Git diff --no-index](https://git-scm.com/docs/git-diff#Documentation/git-diff.txt---no-index) — independent filesystem comparison.
- [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/#description) — locked install without manifest rewrite; replaces installed dependencies.
- [npm lifecycle order](https://docs.npmjs.com/cli/using-npm/scripts/#life-cycle-operation-order) — understand install/build side effects.

### Patterns to Follow

**Naming:** Python tooling uses lower snake case and root-relative Path; imported application casing stays exact.

**Errors:** Mirror tooling/configure_github_project.py:60-87: capture subprocess output, inspect return codes, raise diagnostic errors. Fail closed on mismatch.

**Importer:** Inspection/dry-run is default. Writes require --apply, exact commit, clean destination, and an allowlisted disposition for every source path.

**Disposition policy for the captured 184 files:**

- copy-exact: 177 non-colliding paths initially land at the same relative path.
- adapt-after-copy: three workflow files receive only a repository guard.
- merge: .gitignore keeps destination rules and adds source runtime/build/infrastructure rules; keep the committed sample-configuration exception after broad patterns.
- exclude: source README.md and five source .agents/** files.
- preserve-destination: root AGENTS.md, destination README, .agents/**, .codex/**, .archon/**, tooling/**, and .github/project-documents.json.

Final accounting after workflow adaptation: 174 exact, 3 adapted, 1 merged, 6 excluded. Derive and assert counts rather than relying only on constants.

**Workflow guard:** add this job condition to each copied deployment/rollback workflow: github.repository equals noamtz/auditflow. It is false in cpa-platform, so merging the baseline cannot deploy the old stack. Include a comment pointing to #9.

**Avoid:** recursive working-tree copy; fetch/checkout/install/build/cleanup/worktree creation in source; ignored files; source history; wholesale destination replacement; lint fixes; upgrades; product refactors; active legacy deploys from this repository.

---

## IMPLEMENTATION PLAN

### Phase 1: Provenance and guardrail

Revalidate identity/drift and implement/test the importer. Produce a complete dry-run disposition report before copying.

### Phase 2: Disposable source baseline

**Depends on:** Phase 1.

Archive the exact commit outside both repositories, install under Node 20, and capture all four validation results without fixing failures.

### Phase 3: Import and repository reconciliation

**Depends on:** Phase 2.

Apply approved paths, verify blobs, guard workflows, merge root configuration deliberately, and generate provenance artifacts.

### Phase 4: Destination parity validation

**Depends on:** Phase 3.

Run the identical checks in the destination, compare outcomes, validate the AI layer, inspect the full diff, and prove source HEAD/status are unchanged.

---

## STEP-BY-STEP TASKS

### 1. INSPECT both baselines

- **IMPLEMENT**: Confirm destination origin/clean HEAD, source local HEAD/clean status, and remote source main using git ls-remote—never fetch into source.
- **IMPLEMENT**: NUL-safe commit inventory; check attributes, LFS, gitlinks, symlinks, case collisions, and overlaps.
- **GOTCHA**: Source drift requires a plan amendment.
- **VALIDATE**: git remote get-url origin; git status --short; git -C C:\Users\ntzur\workspace-antigravity\auditflow status --short; git ls-remote git@github.com:noamtz/auditflow.git refs/heads/main
- **SATISFIES**: AC 2, 3, 4, 7.

### 2. CREATE tooling/import_auditflow_source.py

- **IMPLEMENT**: Add inspect, stage, apply; default non-writing. Use git archive, git ls-tree -r -z --long, resolved-path containment, explicit dispositions, and raw git hash-object --no-filters checks.
- **IMPLEMENT**: Reject dirty destination, unexpected collision/path, transformations, LFS, gitlink, symlink, case collision, path escape, or commit mismatch before copying. Never delete destination paths or write source metadata.
- **PATTERN**: tooling/configure_github_project.py:60-87.
- **VALIDATE**: python tooling/import_auditflow_source.py inspect --source C:\Users\ntzur\workspace-antigravity\auditflow --destination . --expected-commit 5920c779cc49d6502bdbb2aad56e40845778fc9c
- **SATISFIES**: AC 2, 3, 4, 7.

### 3. CREATE importer tests

- **IMPLEMENT**: Temporary fixture repos cover exact hashes, dispositions, default dry-run, apply, dirty destination, collision, drift, case collision, symlink/gitlink/attribute rejection, no deletion, and source immutability.
- **GOTCHA**: Never use the real source in unit tests.
- **VALIDATE**: python -m unittest discover -s tooling/tests -p test_import_auditflow_source.py -v
- **SATISFIES**: AC 2, 3, 4, 7.

### 4. STAGE and validate the pinned source

- **IMPLEMENT**: Extract exact commit to a fresh temporary directory outside both repositories. Switch to Node 20.17.0; run npm ci, npm test, npm run typecheck, npm run lint, npm run build. Capture versions, exit codes, and normalized diagnostics.
- **GOTCHA**: install/build output and possible typecheck emission are allowed only in staging/destination; do not fix failures here.
- **VALIDATE**: git -C C:\Users\ntzur\workspace-antigravity\auditflow status --short; git -C C:\Users\ntzur\workspace-antigravity\auditflow rev-parse HEAD
- **SATISFIES**: AC 2, 5, 7.

### 5. APPLY approved paths

- **IMPLEMENT**: Import 177 approved non-colliding paths; emit a manifest entry for every source path with source metadata, destination/disposition, and verification result.
- **GOTCHA**: No recursive copy; do not overwrite root control files or destination AI/tooling.
- **VALIDATE**: python tooling/import_auditflow_source.py inspect --source C:\Users\ntzur\workspace-antigravity\auditflow --destination . --expected-commit 5920c779cc49d6502bdbb2aad56e40845778fc9c --verify-applied
- **SATISFIES**: AC 1–4, 7.

### 6. UPDATE copied workflows

- **IMPLEMENT**: Add only the repository guard/comment to all three jobs; retain names, regions, commands, and triggers.
- **GOTCHA**: test deploy currently triggers on a main push touching Lambda; guard before any push.
- **VALIDATE**: Select-String across all three workflow files for noamtz/auditflow.
- **SATISFIES**: AC 1, 2, 6, 7.

### 7. UPDATE .gitignore, README.md, AGENTS.md

- **IMPLEMENT**: Merge/dedupe ignore categories and preserve exception ordering.
- **IMPLEMENT**: Describe AuditFlow first in README, retain Project/Codex setup, and add Node 20, locked install, four checks, and baseline link; omit old Base44-builder publishing text.
- **IMPLEMENT**: Update AGENTS lines 5, 37, 42, 50 so app paths/checks are local and the approved SST direction is acknowledged; preserve external source provenance and specialized contracts.
- **VALIDATE**: python tooling/validate_codex_layer.py; git check-ignore node_modules dist .sst sst-env.d.ts
- **SATISFIES**: AC 1, 3, 6.

### 8. CREATE manifest and report

- **IMPLEMENT**: JSON contains source remote/commit/tree/Git version, counts/bytes, and every path disposition/verification; omit temporary machine paths and sensitive runtime values.
- **IMPLEMENT**: Markdown records source/destination revisions, policy, excluded/adapted paths, both validation runs, differences, and reproduction commands.
- **VALIDATE**: python -m json.tool docs/migration/auditflow-source-manifest.json; run importer inspect with --manifest and --verify-applied.
- **SATISFIES**: AC 3, 4, 5, 7.

### 9. VALIDATE destination parity

- **IMPLEMENT**: Same Node/npm and commands as staging. Compare each outcome; fix only import/config-induced differences and record identical failures as pre-existing.
- **VALIDATE**: npm test; npm run typecheck; npm run lint; npm run build
- **SATISFIES**: AC 1, 5.

### 10. VERIFY source/destination integrity

- **IMPLEMENT**: Recheck source HEAD/status; ensure ignored output is untracked, destination controls remain, workflow guards exist, manifest closes, and product additions retain source blob identity. Restore prior Node version.
- **VALIDATE**: git diff --check; python tooling/validate_codex_layer.py; source git status and rev-parse HEAD.
- **SATISFIES**: all ACs.

---

## TESTING STRATEGY

### Unit Tests

Python unittest with temporary Git repositories: commit resolution, NUL-safe paths, dispositions, exact blobs, collision/containment, dry-run/apply, unsupported modes/features, no deletion, source immutability.

### Integration Tests

Inspect/stage real source read-only; apply/verify destination. Run identical Node/npm commands in source staging and destination and compare outcome class plus normalized diagnostics.

### Edge Cases

Remote drift; dirty source; new destination collision; attributes/LFS/submodule/symlink/case drift; CRLF raw-hash changes; accidental workflow deployment; inherited typecheck emission/failure; build configuration gaps; ignored npm/build output; pre-existing validation failure.

---

## VALIDATION COMMANDS

### Level 1: Syntax and policy

- python -m unittest discover -s tooling/tests -p test_import_auditflow_source.py -v
- python -m json.tool docs/migration/auditflow-source-manifest.json
- python tooling/validate_codex_layer.py
- git diff --check

### Level 2: Tests

- npm test

### Level 3: Static/build

- npm run typecheck
- npm run lint
- npm run build

Run the four application commands first in disposable source staging and then destination under Node 20.17.0 after npm ci; record exit codes independently.

### Level 4: Integrity

- Run importer inspect with source, destination, expected commit, committed manifest, and --verify-applied.
- Confirm source git status and HEAD.
- Inspect destination git status.

### Level 5: Manual review

Verify all 184 dispositions, destination control files, workflow guards, absence of tracked machine/build output, blob-identical product additions, and source-vs-destination baseline classification.

---

## ACCEPTANCE CRITERIA

- [ ] Complete tracked application baseline needed to build/test is present: src, Base44 evidence, docs, PDF Lambda, Terraform reference, POC, assets, manifests, configs.
- [ ] Source HEAD/status/tracked files/working bytes are unchanged before versus after.
- [ ] Source history and ignored dependencies, caches, build output, infrastructure state/plans, local metadata, and sensitive machine configuration are not imported.
- [ ] Manifest identifies immutable remote/commit/tree and accounts for every tracked path with verified disposition.
- [ ] Source-stage and destination results exist for tests, typecheck, lint, build; differences are resolved or proven pre-existing.
- [ ] Project/Codex/tooling remains functional and AI-layer validation passes.
- [ ] Importer is dry-run-first, tested, repeatable, and independently verifies the result.
- [ ] Copied workflows cannot deploy from noamtz/cpa-platform.
- [ ] No product behavior, dependency version, UI, runtime API, or data contract changes intentionally.

---

## COMPLETION CHECKLIST

- [ ] Drift checks pass and branch contains c1ffd08 or merged equivalent.
- [ ] Importer tests pass before real copy.
- [ ] Disposable source validation recorded.
- [ ] Manifest accounting closes.
- [ ] Workflow guards present before push.
- [ ] Destination validation compared to source.
- [ ] AI-layer/diff checks pass.
- [ ] Source integrity reverified.
- [ ] Report contains no sensitive values/business data.
- [ ] Owner/reviewer confirms baseline evidence before closing #3.

---

## OPEN QUESTIONS / ASSUMPTIONS

- Source 5920c77 remains local and remote main; drift blocks and requires amendment.
- Implementation branch includes destination c1ffd08; do not branch from older main and lose Project/Wiki workflow work.
- Legacy workflows are evidence only until #9, so guards are required.
- Tracked dormant/POC files remain because premature pruning has no parity value.
- No critical product question remains. Preserving source history or enabling legacy deploys here would change scope/architecture and requires owner direction.

## NOTES

The import is mechanically large but narrow. Review blob identity and documented divergences rather than raw line count. Keep provenance/import work separate from later AWS commits so migration diffs remain clean.

Confidence for one-pass implementation: **9/10**, conditional on unchanged source/destination bases.

## AMENDMENTS

None.

---

**Artifact type:** Implementation plan
**Related:** [ticket #3](https://github.com/noamtz/cpa-platform/issues/3), [epic #1](https://github.com/noamtz/cpa-platform/issues/1), [PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration), [architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)
**Last updated:** 2026-08-13
