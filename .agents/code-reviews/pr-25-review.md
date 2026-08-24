# Code review — PR #25

## Summary

PR #25 implements the intended four public questionnaire compatibility routes with strong token checks, optimistic
revisions, journaled DynamoDB transactions, and acknowledged frontend saves. The implementation is well tested and
the application/foundation validation reproduces the documented baseline. One public projection currently exposes
CPA-only audit data, however, and the committed PR diff also fails whitespace validation. Changes are requested
before human approval.

## Findings by severity

### Critical

None.

### High

None.

### Medium

1. **The public Submission projection exposes CPA-only audit entries** —
   `backend/api/contracts/public-questionnaire.ts:172`.

   `PUBLIC_SUBMISSION_FIELDS` includes `cpa_audit_log`, so every successful public `getClientByToken` response can
   disclose internal CPA audit entries, including staff email/name, actions, and timestamps, to a questionnaire-link
   holder. Neither public questionnaire nor signing code reads this field, and the intended boundary is a minimal,
   UI-required token-scoped projection.

   **Fix:** remove `cpa_audit_log` from the public allowlist, add a regression assertion proving it is absent, and
   audit the remaining allowlisted fields for other CPA-only metadata.

### Low

1. **The committed PR diff fails whitespace validation** —
   `.agents/plans/preserve-public-questionnaire-persistence-resume.md:81` and
   `.agents/reports/preserve-public-questionnaire-persistence-resume-report.md:3` (representative locations).

   `git diff --check origin/main...HEAD` reports six committed whitespace errors: five trailing-whitespace lines and
   one extra blank line at EOF. The PR description states that diff hygiene passed, but the command previously
   checked only the clean working tree rather than the committed PR range.

   **Fix:** remove the reported trailing spaces/EOF blank line and validate the committed range with
   `git diff --check origin/main...HEAD`.

## Validation

| Check | Result | Notes |
| --- | --- | --- |
| Node/npm | Pass | Node 20.17.0 / npm 10.8.2 |
| `npm ci` | Pass | 1,054 packages; inherited peer/engine/deprecation warnings and 31 audit findings |
| Application tests | Pass | 8 files / 90 tests |
| Foundation/backend/tooling tests | Pass | 22 files / 150 tests |
| Foundation typecheck | Pass | Clean |
| Foundation lint | Pass | Clean |
| Touched frontend lint | Pass | Clean |
| Production build | Pass | Vite build completed |
| SST contract verifier | Pass | Test-stage contract verified |
| Full application typecheck | Baseline fail | 178 inherited diagnostics; zero in touched paths |
| Full application lint | Baseline fail | 21 inherited errors; touched-path lint is clean |
| Codex-layer validation | Pass | 31 skills / 6 custom agents |
| `git diff --check origin/main...HEAD` | Fail | Six committed Markdown whitespace errors |
| AWS deployment/live verification | Not run | Review performed no deployment or AWS mutation; PR records an earlier read-only diff |

## What is good

- The four public routes are explicitly enumerated and fail closed; all CPA routes remain JWT scoped.
- Archived/tokenless clients are rejected, tokens are compared through fixed-length digests, and projections omit
  the client token itself.
- Conditional active guards, acknowledged revisions, and journaled transactions prevent first-save duplication and
  stale whole-object overwrites without retrying semantic conflicts.
- The browser transport preserves structured non-2xx bodies, and questionnaire/signing navigation now uses only
  acknowledged Submission state.
- Focused tests cover authorization, cross-client/year isolation, transaction conflicts, template seeding races,
  revisions, signing persistence, completion transitions, and route inventory.

## Recommendation

**Request changes.** Remove the CPA audit-log disclosure and committed whitespace errors, add the projection
regression assertion, then rerun focused/foundation validation and the committed-range diff check. After fixes, run
`piv-review-pr 25` again before human approval.
