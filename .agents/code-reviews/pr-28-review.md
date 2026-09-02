# PR #28 review — Complete CPA workflow and template parity

**PR:** https://github.com/noamtz/cpa-platform/pull/28

**State:** Open

**Reviewed:** 2026-09-02

## Remediation status

All four agent-fix findings were resolved on 2026-09-02. PDF-template update and archive now require the
browser-observed revision and reject stale writes with a reload conflict; generic entity mutations no longer admit
workflow-owned fields; orphan reset uses a dedicated guarded and journaled CPA endpoint; malformed PDF base-file
references are rejected with 400 before service dispatch; and the live verifier derives its scoped CPA-route count
from the enforced contract. Regression coverage was added for each boundary.

Post-fix validation passes `npm test` (108 tests), `npm run test:foundation` (259 tests), `npm run test:pdf` (22
tests), foundation typecheck/lint, production build, the SST foundation contract verifier, the Codex-layer validator,
and `git diff --check`. Full frontend typecheck remains at the documented 145-diagnostic baseline and full lint
remains at the documented five-error baseline. The initial verdict and findings below are retained as the historical
review record; the PR is ready for a fresh review after this remediation commit is pushed.

## Summary

Verdict: request changes. The AWS-only migration is well structured, the protected route inventory is coherent, and
the full targeted validation matrix passes. One High-severity concurrency defect remains: PDF-template update and
archive requests do not carry the browser's expected revision, so a stale editor can silently overwrite or archive a
newer save. Two Medium contract gaps allow lifecycle invariants or HTTP error semantics to be bypassed, and one Low
verifier summary value is stale.

## Issue counts

| Severity | Unresolved |
| --- | ---: |
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 1 |

## Review routing

### AGENT FIXES

1. **High — Require a browser-supplied revision for PDF-template update and archive.**
   `backend/api/contracts/templates.ts:85`, `backend/api/services/templates.ts:296`, and
   `backend/api/services/templates.ts:324` currently let the service re-read the latest record and condition against
   that same server-read `_version`. If two CPAs open version 1, one saves version 2, and the stale editor saves next,
   the second request writes version 3 and silently replaces version 2 instead of returning 409. Require an expected
   revision in update/archive input, compare it with the loaded record before mutation, send the loaded revision from
   `src/pages/PdfTemplateEditor.jsx:498`, and add stale-update plus stale-archive no-mutation tests.

2. **Medium — Close generic entity PATCH bypasses around server-owned lifecycle operations.**
   `backend/api/contracts/entities.ts:22`, `backend/api/contracts/entities.ts:25`, and
   `backend/api/contracts/entities.ts:105` still admit direct Client tax-year/status and Submission `cpa_status`
   writes. Those routes update one record at a time through `backend/api/routes/entities.ts:97`, bypassing the new
   paired status and tax-year transactions; `src/components/dashboard/EditClientModal.jsx:26` actively sends a tax
   year through this generic path. Restrict generic mutation fields, route tax-year/status changes through
   `CpaWorkflowService`, and preserve the intentional orphan reset through a dedicated server-validated operation.

3. **Medium — Map malformed PDF file references to the required 400 response.**
   `backend/api/contracts/templates.ts:38` validates the broad pdfme shape but not the `basePdf` URI format, while
   `backend/api/services/files.ts:680` lets `resolveStoredFileReference()` throw a plain error. A value such as
   `https://example.test/file.pdf` therefore passes ingress validation and becomes an unhandled 500 instead of the
   API contract's 400 for invalid input. Validate the reference format in the template contract or translate the
   resolver failure to `badRequest`, then add create/update route tests proving 400 and zero journal mutation.

4. **Low — Derive the live-verifier CPA route count from the contract.**
   `tooling/verify_sst_foundation.mjs:1374` still reports `cpaRoutesScoped: 14` even though the verifier now checks 34
   protected CPA routes. Derive the summary value from the scoped contract route set and cover the reported result so
   deployment evidence cannot drift from the enforced inventory.

### HUMAN DECIDES

None.

### HUMAN READS

- `backend/api/services/cpa-workflows.ts:217` — review the Submission, Client, active-guard, and ChangeJournal
  transaction used by CPA-assisted saves; this is the primary data-integrity boundary.
- `backend/api/services/templates.ts:171` — review atomic questionnaire version allocation/deactivation and its
  guarded history semantics.
- `backend/api/services/files.ts:614` — review token-scoped template-file and PDF-template authorization, especially
  the distinction between public questionnaire references and CPA access.

### HUMAN TESTS

- `src/pages/PdfTemplateEditor.jsx:498` — after remediation, exercise two simultaneous editors and confirm stale
  update and stale archive both return a reload conflict without overwriting the newer record.
- `src/components/dashboard/EditClientModal.jsx:26` — after remediation, exercise tax-year selection, orphan reset,
  and paired `ready_for_ira`/`reviewed` transitions and confirm Client/Submission state cannot diverge.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:79` — with explicit owner authorization and valid
  AWS credentials, run the test-stage deploy/live two-user acceptance matrix before merge or release.

### FYI

- `.agents/reports/complete-cpa-workflow-template-parity-report.md:52` — Node 20.17.0 could not be activated locally;
  this review reproduced validation under Node 24.13.0 and treats the required Node version as an outstanding gate.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:64` — the 145 frontend type diagnostics and five
  lint errors are documented inherited/generated baseline failures, not new findings in this PR.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:77` — the SST diff remains blocked by invalid AWS
  credentials; the fresh review reproduced that failure and made no cloud mutation.

## Findings by severity

### Critical

None.

### High

- `backend/api/services/templates.ts:296` — stale PDF-template update/archive requests overwrite newer state because
  no client revision participates in optimistic concurrency. See AGENT FIXES item 1.

### Medium

- `backend/api/contracts/entities.ts:52` — generic Client/Submission mutations can bypass the new atomic lifecycle
  services. See AGENT FIXES item 2.
- `backend/api/services/files.ts:680` — malformed caller-controlled file references normalize to 500 instead of 400.
  See AGENT FIXES item 3.

### Low

- `tooling/verify_sst_foundation.mjs:1374` — emitted live evidence retains the obsolete scoped-route count. See
  AGENT FIXES item 4.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | DOCUMENTED DEVIATION — Node 24.13.0 / npm 11.6.2; project requires Node 20.17.0 |
| `npm ci` | PASS — 1,055 packages installed; inherited warnings; 35 audit findings |
| `npm test` | PASS — 12 files / 108 tests |
| `npm run test:foundation` | PASS — 35 files / 252 tests |
| `npm run test:pdf` | PASS — 3 files / 22 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run build` | PASS |
| Foundation contract verifier | PASS — exact seven-table/two-bucket/application/PDF/auth inventory |
| Codex-layer validator | PASS — 31 skills / 6 custom agents |
| `git diff --check origin/main...HEAD` | PASS |
| `npm run typecheck` | KNOWN BASELINE — exit 2 / 145 diagnostics; committed report records reduction from 233 |
| `npm run lint` | KNOWN BASELINE/GENERATED — exit 1 / five errors; three `.sst` bundles and two untouched files |
| `npm run sst:diff:test` | OPERATIONAL BLOCK — invalid cached AWS token; no cloud mutation |
| Authorized deploy/live acceptance | NOT RUN — explicit owner authorization and valid credentials required |

## What is good

- `infra/sst/contracts.ts:155` and `backend/api/handler.ts:55` keep the protected/public route inventories explicit
  and consistently scoped, including the legacy-shaped but Cognito-protected CPA save route.
- `backend/api/services/cpa-workflows.ts:217` uses conditional transactional business writes and immutable journal
  entries for CPA save, restore/swap, and paired status changes.
- `backend/api/services/files.ts:624` restricts public PDF-template access to the authenticated client's referenced
  questionnaire template and denies archived templates.
- `src/pages/CpaFillQuestionnaire.jsx:142` serializes saves, advances the server-issued revision, and halts navigation
  on conflicts instead of hiding rejected writes.
- `src/api/base44Client.js:1` is now an AWS-only compatibility facade with explicit failures for unmigrated dormant
  agents rather than a fallback path.

## Recommendation

Request changes. Fix the stale PDF-template concurrency path before merge, close the generic lifecycle and invalid
file-reference gaps in the same remediation pass, update the verifier summary, then rerun the full local validation
matrix. The natural next step is `piv-fix-review-findings .agents/code-reviews/pr-28-review.md`.
