# PR #46 review

## Summary

PR #46 fixes the ZIP worker's maintenance settlement path. The worker now has the table-scoped DynamoDB permissions required by its transaction, and a retry of an already-terminal ZIP job resolves any still-active maintenance intent without rebuilding the archive. No critical, high, medium, or low issues remain at head `62a81fb`.

## Findings by severity

- Critical: 0
- High: 0
- Medium: 0
- Low: 0

## Review routing

### AGENT FIXES

- Resolved: a terminal ZIP retry previously returned before settling its maintenance intent. The retry-safe settlement path and regression test now cover this at `backend/api/workers/zip-download.ts:164` and `backend/api/__tests__/zip-download.test.ts:209`.

### HUMAN READS

- Confirm the terminal-job path only resolves the deterministic `zip-job:<jobId>` activity and never recreates the archive at `backend/api/workers/zip-download.ts:164`.
- Confirm the new DynamoDB actions remain scoped to the ChangeJournal table through the existing grant at `infra/sst/application.ts:164` and the action list at `infra/sst/contracts.ts:496`.

### HUMAN TESTS

- After the protected enabled-mode deployment, request a fresh ZIP in the test UI and confirm it becomes downloadable and does not remain in a loading state. The automated live probe will also verify the ZIP signature and resolved maintenance status.

### HUMAN DECIDES

- None.

### FYI

- The temporary test intents created while diagnosing the cleanup failure were explicitly settled; the maintenance active counter returned to zero before this review.

## Validation

| Check | Result |
| --- | --- |
| Frontend tests | PASS — 168 tests |
| Foundation tests | PASS — 413 tests |
| Frontend type check | PASS |
| Foundation type check | PASS |
| Frontend lint | PASS |
| Foundation lint | PASS |
| Frontend build | PASS |
| Foundation contract verifier | PASS |
| Fresh-eyes code review | PASS — no remaining high-confidence findings |
| Required GitHub check | Pending at the time this report was written; must pass before merge |

## What is good

The permission addition matches the exact DynamoDB primitives used inside the settlement transaction and remains table-scoped. The recovery path is idempotent: it settles only an ACTIVE intent and does not repeat ZIP generation. The contract JSON, verifier, and tests all pin the intended least-privilege behavior.

## Recommendation

Approve after the required GitHub check passes. Then merge, run the protected enabled-mode deployment, and repeat the focused live ZIP probe.
