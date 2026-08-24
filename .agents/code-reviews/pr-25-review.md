# Code review — PR #25 (final rerun)

## Summary

PR #25 establishes a strong public questionnaire compatibility boundary with token-scoped access, optimistic
revisions, atomic journaled mutations, explicit routes, and recoverable acknowledged saves. All prior review
findings are resolved. A fresh deployment-path review found one remaining build-time configuration defect that
prevents every migrated public function call in the SST-hosted application.

## Findings by severity

### Critical

None.

### High

1. **The SST-hosted questionnaire cannot call any migrated public function because its app-ID input is absent** —
   `src/api/function-client.js:25` and `infra/sst/application.ts:103`.

   `postPublicFunction` defaults `appId` from a Vite build variable and throws when it is missing. The committed SST
   `StaticSite` environment supplies Cognito and API values but not that app-ID value, and the test deployment
   workflow does not inject it either. Vite therefore builds the SST-hosted application with this value undefined,
   so lookup, save, resume, and signing-state persistence fail before `fetch` runs.

   **Fix:** make the compatibility path segment available in versioned SST build configuration as a required public
   value, or make the AWS-only public client use a stable opaque compatibility segment without depending on a
   Base44 build variable. Add a build/deployment contract regression proving the emitted migrated-public path is
   usable without local-only configuration.

### Medium

None.

### Low

None.

## Resolved findings from prior reviews

- `cpa_audit_log` and `alert_sent` are excluded from the public Submission projection with regression coverage.
- The committed PR range passes `git diff --check origin/main...HEAD`.
- `createRecoverableSaveQueue` keeps a handled shared tail while returning the individual save promise. Transport
  failures produce a non-blocking error toast and `false`, later saves still dispatch, and navigation waits for the
  real acknowledgement. The focused rejection/retry regression test passes.

## Validation

| Check | Result | Notes |
| --- | --- | --- |
| Node/npm | Pass | Node 20.17.0 / npm 10.8.2 |
| `npm ci` | Pass | 1,054 packages; inherited peer/engine/deprecation warnings and 31 audit findings |
| Application tests | Pass | 9 files / 91 tests |
| Foundation/backend/tooling tests | Pass | 22 files / 150 tests |
| Foundation typecheck | Pass | Clean |
| Foundation lint | Pass | Clean |
| Changed-file lint | Pass | Clean |
| Production build | Pass | Vite build completed, but does not assert the missing runtime path value |
| SST contract verifier | Pass | Test-stage infrastructure inventory verified |
| Full application typecheck | Baseline fail | 178 inherited diagnostics; zero in changed files |
| Full application lint | Baseline fail | 21 inherited errors; changed-file lint is clean |
| Codex-layer validation | Pass | 31 skills / 6 custom agents |
| `git diff --check origin/main...HEAD` | Pass | Clean committed PR range |
| AWS deployment/live verification | Not run | Review performed no deployment or AWS mutation |

## What is good

- All three earlier findings are now correctly resolved and regression-covered.
- Public routes remain exact and fail closed, while CPA routes remain Cognito/JWT scoped.
- Token validation, cross-client/year isolation, active guards, revision checks, and atomic ChangeJournal writes are
  thoughtfully implemented and tested.
- The recoverable queue preserves FIFO ordering and acknowledgement-gated navigation without leaving an unhandled
  rejection or forcing a page reload after a transient transport failure.
- The implementation otherwise remains within the plan's bounded migration scope.

## Recommendation

**Request changes.** Remove the SST build's hidden dependency on the unavailable app-ID build input and add a
contract test for the deployed public-function path. Then run
`piv-fix-review-findings .agents/code-reviews/pr-25-review.md` and rerun this PR review before human approval.
