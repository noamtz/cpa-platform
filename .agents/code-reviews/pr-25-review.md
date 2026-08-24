# Code review — PR #25 (rerun)

## Summary

PR #25 implements the intended public questionnaire compatibility boundary with strict token authorization,
optimistic revisions, atomic journaled mutations, explicit fail-closed routes, and acknowledged frontend saves. The
previous public projection disclosure and committed whitespace failures are resolved. A fresh review found one
remaining save-queue recovery defect that can prevent all subsequent saves after a transient transport failure.

## Findings by severity

### Critical

None.

### High

None.

### Medium

1. **A transient transport failure permanently disables subsequent questionnaire saves** —
   `src/pages/ClientQuestionnaire.jsx:222` and `src/pages/ClientQuestionnaire.jsx:255`.

   `thisSave` rejects when `postPublicFunction` fails at the transport layer, and that rejected promise is assigned
   back to `saveQueue.current`. Every later `saveQueue.current.then(...)` then short-circuits without issuing a new
   request. The current click also receives an unhandled rejection instead of a recoverable UI error, so the user
   cannot retry or persist later answers without reloading the page.

   **Fix:** keep `thisSave` as the promise returned to the individual caller, but make the queue tail recover from
   rejection (for example, assign a handled derivative to `saveQueue.current`) and surface the failed save through
   the existing error state. Add a regression test proving that after the first transport rejects, a second save is
   dispatched and navigation occurs only after that second request succeeds.

### Low

None.

## Resolved findings from the prior review

- `cpa_audit_log` and the internal `alert_sent` notification flag are absent from the public Submission projection,
  with explicit regression assertions.
- `git diff --check origin/main...HEAD` is clean; the previously reported Markdown whitespace errors are gone.

## Validation

| Check | Result | Notes |
| --- | --- | --- |
| Node/npm | Pass | Node 20.17.0 / npm 10.8.2 |
| `npm ci` | Pass | 1,054 packages; inherited peer/engine/deprecation warnings and 31 audit findings |
| Application tests | Pass | 8 files / 90 tests |
| Foundation/backend/tooling tests | Pass | 22 files / 150 tests |
| Foundation typecheck | Pass | Clean |
| Foundation lint | Pass | Clean |
| Changed-file lint | Pass | 27 changed code files clean |
| Production build | Pass | Vite build completed |
| SST contract verifier | Pass | Test-stage contract verified |
| Full application typecheck | Baseline fail | 178 inherited diagnostics; zero in changed files |
| Full application lint | Baseline fail | 21 inherited errors; changed-file lint is clean |
| Codex-layer validation | Pass | 31 skills / 6 custom agents |
| `git diff --check origin/main...HEAD` | Pass | Clean committed PR range |
| AWS deployment/live verification | Not run | Review performed no deployment or AWS mutation; PR records an earlier read-only diff |

## What is good

- Public routing is explicit and fail-closed, while CPA routes remain Cognito/JWT scoped.
- Token validation, cross-client/year isolation, active-submission guards, revision checks, and journaled atomic
  transactions provide a strong persistence boundary.
- Public projections now exclude both CPA audit entries and internal notification state.
- Frontend navigation uses acknowledged Submission state, and the focused tests cover authorization, conflicts,
  template races, completion, signing persistence, and exact route inventory.
- The updated committed range is clean and the implementation remains within the plan's stated migration slice.

## Recommendation

**Request changes.** Recover the save-queue tail after transport rejection, surface the individual failure, and add
the retry regression test. Then run `piv-fix-review-findings .agents/code-reviews/pr-25-review.md` and rerun this PR
review before human approval.
