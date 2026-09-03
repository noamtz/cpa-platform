# PR #28 final re-review — Complete CPA workflow and template parity

**PR:** https://github.com/noamtz/cpa-platform/pull/28

**Head:** `478110846fe1bffd65771de6cd118e09d4ec5ecd`

**State:** Open

**Reviewed:** 2026-09-03

## Remediation status

Resolved on 2026-09-03. `src/lib/cpa-fill.js` now requests only `is_archived:false` submissions and defensively
selects the first non-archived result. `src/pages/CpaFillQuestionnaire.jsx` uses that helper instead of taking index
zero from unfiltered year history. The archived-first-plus-active regression and all-active-missing case both pass.

Post-fix validation passes 110 application tests, 263 foundation tests, 22 PDF tests, foundation typecheck/lint, the
production build, SST contract verification, Codex-layer validation, runtime Base44 scanning, and diff hygiene. The
documented frontend baselines remain unchanged at 145 type diagnostics and five lint errors. Nothing was deferred;
the PR is ready for a fresh review, while the human and owner-authorized live checks remain outstanding.

## Summary

Initial verdict: request changes. The atomic Client-details remediation is correct and all earlier findings remain
resolved. The Medium-severity CPA-assisted questionnaire selection defect found in this review is also resolved by
filtering for active submissions and defensively rejecting archived results.

## Initial issue counts

| Severity | Initially unresolved |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |

## Review routing

### AGENT FIXES

1. **Resolved — select only the active Submission for CPA fill.**
   `src/pages/CpaFillQuestionnaire.jsx:76` queries by client/year without `is_archived:false`, then line 77 selects
   the first result. If an archived row sorts first, `backend/api/services/cpa-workflows.ts:235` rejects the next save
   as archived and reload repeats the same selection. Filter the query to active records, choose defensively, and add
   a regression test containing archived and active submissions for the same client/year.

### HUMAN DECIDES

None.

### HUMAN READS

- `backend/api/services/cpa-workflows.ts:217` — review CPA save ownership, revision, guard, and journal coordination.
- `backend/api/services/cpa-workflows.ts:484` — review the new atomic Client profile/tax-year mutation.
- `backend/api/services/files.ts:614` — review public and CPA PDF-template file authorization boundaries.

### HUMAN TESTS

- `src/pages/CpaFillQuestionnaire.jsx:76` — after remediation, load a client/year with archived history plus one active
  Submission and confirm CPA fill resumes and saves the active record.
- `src/pages/PdfTemplateEditor.jsx:538` — use two simultaneous editors and verify stale update/archive requests return
  reload conflicts without replacing newer state.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:79` — with explicit authorization and valid AWS
  credentials, run the disposable test-stage two-user acceptance matrix.

### FYI

- `.agents/reports/complete-cpa-workflow-template-parity-report.md:52` — validation used Node 24.13.0 because required
  Node 20.17.0 could not be activated in the current Windows shell.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:64` — the inherited 145 type diagnostics and five
  lint errors remain unchanged and are not introduced by this PR.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:77` — SST preview remains blocked by invalid cached
  AWS credentials and the Windows SST temp-log path bug; no cloud mutation occurred.

## Issues by severity

### Critical

None.

### High

None.

### Medium

None remaining. The archived Submission selection defect is resolved; see AGENT FIXES item 1.

### Low

None.

## Previous findings

The earlier findings remain resolved:

- PDF-template update/archive requires caller-observed revisions and rejects stale mutations.
- Generic lifecycle fields are restricted; orphan reset and Client details use guarded, journaled operations.
- Edit Client profile and optional tax-year changes now commit as one revision-aware conditional mutation.
- Malformed PDF base-file references return 400 before service dispatch.
- Live verifier evidence derives the scoped CPA-route count from the enforced 36-route contract.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | DOCUMENTED DEVIATION — Node 24.13.0 / npm 11.6.2; project requires Node 20.17.0 |
| `npm ci` | PASS at current lockfile — 1,055 packages; inherited warnings; 35 audit findings |
| `npm test` | PASS — 13 files / 110 tests |
| `npm run test:foundation` | PASS — 35 files / 263 tests |
| `npm run test:pdf` | PASS — 3 files / 22 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run build` | PASS |
| Foundation contract verifier | PASS |
| Runtime Base44 scan | PASS — no runtime/package/config matches |
| Codex-layer validator | PASS — 31 skills / 6 custom agents |
| `git diff --check origin/main...HEAD` | PASS |
| `npm run typecheck` | KNOWN BASELINE — 145 diagnostics, matching the committed report |
| `npm run lint` | KNOWN BASELINE/GENERATED — five errors, matching the committed report |
| `npm run sst:diff:test` | OPERATIONAL BLOCK — invalid cached AWS token and Windows SST temp-log bug; no cloud mutation |
| Authorized deploy/live acceptance | NOT RUN — explicit owner authorization and valid credentials required |

## What is good

- `backend/api/services/cpa-workflows.ts:484` implements the combined Client edit as one caller-revision-aware,
  conditional, journaled mutation and preserves status when the year is unchanged.
- Route allowlists, SST contracts, the foundation JSON, and verifier evidence remain synchronized at 36 protected
  CPA routes.
- PDF-template concurrency, malformed reference validation, and workflow-owned field restrictions remain correctly
  enforced with negative tests.
- `src/pages/CpaFillQuestionnaire.jsx:109` retains serialized saves and advances the server-issued Submission revision
  only after successful writes.
- All executable application, foundation, and PDF tests pass, as do build and task-specific checks.

## Recommendation

The original recommendation was request changes. CPA-fill loading now restricts and defensively selects the active
Submission, the archived-plus-active regression is covered, and the validation gate passes. Re-run the PR review;
after a clean verdict, a human should perform the two-editor and owner-authorized test-stage acceptance checks before
merging.
