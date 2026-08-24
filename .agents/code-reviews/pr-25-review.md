# Code review — PR #25 merge gate

## Summary

PR #25 is ready from both code-review and deployment-gate perspectives. The public questionnaire boundary is
strongly scoped, all prior code findings are resolved, the complete local validation reproduces the accepted
baseline without changed-file regressions, and the PR branch successfully deployed to the shared `test` stage. The
live foundation verifier passed after replacing a one-off Environment exception with a reusable PR merge-ref rule.

## Findings by severity

### Critical

None.

### High

None.

### Medium

None.

### Low

None.

## Resolved findings

- The public Submission projection excludes CPA audit and internal notification fields, with regression coverage.
- The committed PR range is whitespace-clean.
- The recoverable save queue preserves FIFO acknowledgement behavior after a transport rejection and surfaces a
  retryable error without advancing.
- Migrated AWS public calls use the stable `auditflow` compatibility segment without local build configuration.
- The GitHub `test` Environment previously allowed `main` and one exact historical PR merge ref, so PR #25 was
  rejected before a runner started. The policy now allows `main` and the narrow reusable
  `refs/pull/*/merge` pattern. PR #25 then passed validation, preview, deployment, and live verification; the obsolete
  one-off PR policy was removed.

## Validation

| Check | Result | Notes |
| --- | --- | --- |
| Node/npm | Pass | Node 20.17.0 / npm 10.8.2 |
| `npm ci` | Pass | 1,054 packages; inherited dependency warnings and 31 audit findings |
| Application tests | Pass | 9 files / 92 tests |
| Foundation/backend/tooling tests | Pass | 22 files / 150 tests |
| Foundation typecheck | Pass | Clean |
| Foundation lint | Pass | Clean |
| Changed-file lint | Pass | Clean |
| Production build | Pass | Vite build completed |
| SST contract verifier | Pass | Test-stage infrastructure inventory verified |
| Full application typecheck | Baseline fail | 178 inherited diagnostics; zero in changed files |
| Full application lint | Baseline fail | 21 inherited errors; changed-file lint is clean |
| Codex-layer validation | Pass | 31 skills / 6 custom agents |
| `git diff --check origin/main...HEAD` | Pass | Clean committed PR range |
| GitHub `Deploy SST test` check | Pass | PR merge ref admitted by the protected test Environment |
| SST preview and deployment | Pass | PR #25 deployed to the shared `test` stage |
| Live foundation verification | Pass | Deployed test-stage resources satisfy the foundation contract |

## What is good

- No material PR-code findings remain after the fresh full-file review.
- Public routes are exact and fail closed; CPA routes remain Cognito/JWT scoped.
- Token/resource authorization, redacted projections, optimistic revisions, active guards, and atomic journaled
  writes are coherent and well covered.
- Save/retry/navigation behavior and the stable AWS compatibility path have focused regressions.
- The test Environment now supports pre-merge acceptance while still rejecting arbitrary feature-branch refs and
  keeping production policy untouched.

## Recommendation

**Approve.** PR #25 is mergeable, its test deployment and live verification pass, and no unresolved review findings
remain. A human can now perform acceptance testing on the shared `test` stage and merge when satisfied.
