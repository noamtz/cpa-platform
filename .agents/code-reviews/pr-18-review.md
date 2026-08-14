# Code review — PR #18

**Historical verdict:** Request changes

**Resolution:** Findings addressed in commit `fad5635`; retained as the review record for PR
[#18](https://github.com/noamtz/cpa-platform/pull/18).

## Summary

PR #18 successfully imports the pinned AuditFlow production baseline and preserves byte identity for the
mechanically copied product files. The workflow guards, importer safety checks, application tests, build, and Codex
validation are strong. The initial review found that committed-manifest verification failed from a clean PR
checkout and that the AI-layer contained an inconsistent implementation-plan storage contract.

## Findings by severity

### Critical

None.

### High

1. **Committed provenance verification could not succeed after the import was committed** —
   `tooling/import_auditflow_source.py:419`, `tooling/import_auditflow_source.py:485`,
   `tooling/import_auditflow_source.py:501`; reproduction at `docs/migration/auditflow-source-baseline.md:110`.

   `build_manifest()` recorded the destination's current `HEAD` as `destination.baseCommit` and the executing Git
   version, while `compare_manifest()` required full JSON equality. The committed manifest recorded the pre-import
   commit, so a clean checkout failed verification even though all imported bytes were present. A later Git upgrade
   could also invalidate equality through `source.gitVersion`.

   **Resolution:** Fixed in `fad5635`. Immutable source evidence is now compared separately from observational
   destination/Git metadata, with a regression test covering verification after advancing destination `HEAD`.

### Medium

1. **Implementation-plan storage had conflicting canonical contracts** —
   `.agents/skills/piv-plan-implementation/SKILL.md`, `.github/project-documents.json`, and
   `.agents/references/github-project-documents.md`.

   The planner wrote `.agents/plans/*.md`, while the Project contract declared tracker issue bodies canonical.

   **Resolution:** Fixed in `fad5635` and further calibrated in this cleanup. Plans and agent working reports are
   versioned repository files; Issues/Project hold actionable work; the Wiki holds PRDs and architecture; PR review
   discussion stays on the PR.

### Low

None.

## Validation at review time

| Check | Result | Notes |
| --- | --- | --- |
| Node/npm | Pass | Node 20.17.0, npm 10.8.2 |
| `npm ci` | Pass | 913 packages; inherited dependency/audit warnings |
| `npm test` | Pass | 3 files, 67 tests |
| `npm run typecheck` | Baseline fail | Exit 2, exactly 233 documented inherited diagnostics |
| `npm run lint` | Baseline fail | Exit 1, exactly 23 documented inherited errors |
| `npm run build` | Pass | Vite production build completed |
| Importer unit tests | Pass | 9/9 at review time; post-commit regression added afterward |
| Codex layer | Pass | 31 skills, 6 custom agents |
| Source integrity | Pass | Source clean at pinned commit `5920c779cc49d6502bdbb2aad56e40845778fc9c` |
| Applied manifest verification | Fail at review time | Fixed and revalidated in `fad5635` |

## What was good

- All 174 `copy-exact` product blobs independently matched the pinned source; the three adapted workflows contained
  only the intended repository guard.
- Legacy deployment and rollback jobs were disabled in `noamtz/cpa-platform`.
- The importer failed closed on dirty trees, commit drift, path collisions/escapes, unsupported modes, attributes,
  LFS, and unexpected destination changes.
- Tests, build, source integrity, and AI-layer validation reproduced the implementation report's substantive
  baseline results.
- The plan and implementation report documented the intentional Node invocation, line-ending handling, workflow
  adaptation, and inherited type/lint failures.

## Related

- Pull request: [#18](https://github.com/noamtz/cpa-platform/pull/18)
- Implementation issue: [#3](https://github.com/noamtz/cpa-platform/issues/3)
- Implementation report: `.agents/reports/import-auditflow-production-source-baseline-report.md`
- Migrated legacy review container: [#19](https://github.com/noamtz/cpa-platform/issues/19)
