# PR #23 Review — Cognito CPA compatibility and atomic journaling

## Summary

The PR implements the intended AWS-backed CPA compatibility slice with fail-closed Cognito authorization,
index-backed repositories, atomic ChangeJournal writes, and a bounded Base44 coexistence seam. No Critical or High
defects were found. Validation passes relative to the repository's recorded migration baseline, and the deployed
issuer/managed-login correction is represented in both tests and live verification. The two non-blocking
compatibility gaps found during review were corrected with focused regression tests.

**Recommendation: APPROVE.**

| Severity | Open | Resolved |
| --- | ---: | ---: |
| Critical | 0 | 0 |
| High | 0 | 0 |
| Medium | 0 | 1 |
| Low | 0 | 1 |

## AGENT FIXES

1. **Resolved (Medium) — expose the readiness-agent methods used by the retained component.**
   The original [`src/api/base44Client.js:50`](../../src/api/base44Client.js#L50) mapping exported `subscribe`,
   `get`, and `add`, while
   [`src/components/dashboard/SubmissionReadinessChat.jsx:13`](../../src/components/dashboard/SubmissionReadinessChat.jsx#L13)
   calls `subscribeToConversation`, `getConversation`, and `addMessage`. The component is not currently mounted by
   another tracked component, so this was not a present top-level crash, but the documented readiness allowlist was
   unusable when the component is restored. The facade now forwards the three exact names at
   [`src/api/base44Client.js:51`](../../src/api/base44Client.js#L51), with the regression test at
   [`src/api/__tests__/base44-client.test.js:93`](../../src/api/__tests__/base44-client.test.js#L93).

2. **Resolved (Low) — accept the existing batch Drive payload before returning the controlled deferral.**
   The original [`backend/api/contracts/entities.ts:153`](../../backend/api/contracts/entities.ts#L153) contract
   accepted an array of string
   IDs, but [`src/components/dashboard/SyncAllDriveButton.jsx:21`](../../src/components/dashboard/SyncAllDriveButton.jsx#L21)
   sends `{ submission_id, client_id }` objects. The schema now accepts the exact bounded legacy object shape at
   [`backend/api/contracts/entities.ts:147`](../../backend/api/contracts/entities.ts#L147), and
   [`backend/api/__tests__/deferred-integrations.test.ts:69`](../../backend/api/__tests__/deferred-integrations.test.ts#L69)
   proves it reaches `501 FEATURE_NOT_IMPLEMENTED` without an outbound request.

## HUMAN READS

- **Authorization boundary:** [`backend/api/auth/cpa-context.ts:27`](../../backend/api/auth/cpa-context.ts#L27)
  independently enforces gateway scope, verified access-token scope, Cognito subject linkage, and the local admin
  role after API Gateway's scoped authorizer.
- **Atomic rollback evidence:** [`backend/api/services/change-journal.ts:203`](../../backend/api/services/change-journal.ts#L203)
  constructs the conditional cursor update, business mutations, and immutable journal records for one transaction.
- **Compatibility cut line:** [`src/api/base44Client.js:17`](../../src/api/base44Client.js#L17) is the load-bearing seam
  that prevents migrated AWS failures from falling back to Base44 while retaining only approved deferred surfaces.

## HUMAN TESTS

- Complete the temporary-password callback, reload/session restore, and managed logout flow described at
  [`.agents/reports/implement-cognito-core-cpa-compatibility-report.md:111`](../reports/implement-cognito-core-cpa-compatibility-report.md#L111).
- Exercise a second invited CPA and authorized Client/Submission/User mutations, then inspect ordered journal
  evidence through [`backend/api/services/change-journal.ts:240`](../../backend/api/services/change-journal.ts#L240).
- After the facade fix, exercise a readiness conversation starting at
  [`src/components/dashboard/SubmissionReadinessChat.jsx:13`](../../src/components/dashboard/SubmissionReadinessChat.jsx#L13).

## FYI

- The documented SST 3.19.3 refresh-token rotation compatibility step remains intentional and idempotently verified;
  see [`.agents/reports/implement-cognito-core-cpa-compatibility-report.md:92`](../reports/implement-cognito-core-cpa-compatibility-report.md#L92).
- Full application typecheck reports 196 inherited diagnostics versus the recorded 233 baseline, with zero in
  PR-touched frontend paths; the baseline is recorded at
  [`docs/migration/auditflow-source-baseline.md:54`](../../docs/migration/auditflow-source-baseline.md#L54).
- Full tracked-source lint reproduces the 23-error baseline with zero errors in changed paths. A 24th diagnostic seen
  by unqualified `eslint .` comes from an ignored generated `.sst/artifacts` bundle, not committed code; the expected
  baseline is recorded at [`docs/migration/auditflow-source-baseline.md:55`](../../docs/migration/auditflow-source-baseline.md#L55).
- `npm audit` currently reports 31 advisories, including a critical advisory against the pre-existing direct `jspdf`
  dependency at [`package.json:80`](../../package.json#L80). None of the new Cognito/DynamoDB/OIDC dependencies is in
  the Critical/High advisory set; dependency security debt should be handled separately from this PR.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | PASS — Node 20.17.0, npm 10.8.2 |
| `npm ci` | PASS — documented peer/engine warnings; 1,054 packages installed |
| `npm test` | PASS — 7 files / 85 tests |
| `npm run test:foundation` | PASS — 18 files / 92 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run build` | PASS |
| `npm run typecheck` | BASELINE — 196 inherited diagnostics; zero in changed frontend scope |
| `npm run lint` | BASELINE — 23 tracked-source errors; zero in changed scope |
| Foundation contract verifier | PASS — exact test inventory and OIDC contract |
| Exact dependency pins | PASS |
| Codex-layer validation | PASS — 31 skills / 6 custom agents |
| Codebase-search self-test | PASS |
| `git diff --check origin/main...HEAD` | PASS |

## What is good

- API Gateway and Lambda authorization are independently fail-closed.
- Client, Submission, and User mutations share one atomic business/journal transaction with bounded cursor retries.
- Migrated facade operations do not use catch-based Base44 fallback.
- Infrastructure contracts preserve the expected private resources, scoped routes, stage policy, and live verifier.
- Tests cover auth, routing, validation, repositories, transaction composition, browser auth, HTTP retry, and facade
  behavior at appropriate seams.

## Recommendation

Approve PR #23. Both review findings are resolved with focused regression coverage and full validation. The human
acceptance items remain required before issue #6 is closed.
