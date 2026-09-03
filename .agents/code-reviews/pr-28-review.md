# PR #28 re-review — Complete CPA workflow and template parity

**PR:** https://github.com/noamtz/cpa-platform/pull/28

**Head:** `206d896636e617c1da41a10bdab20f4fcc6d29ec`

**State:** Open

**Reviewed:** 2026-09-02

## Remediation status

Resolved on 2026-09-03. Edit Client now sends one revision-aware request containing the profile changes and optional
tax-year change. The server validates the complete input, preserves status when the year is unchanged, derives status
when it changes, and commits one conditional Client update with one journal change. Failed validation, stale browser
revisions, active-submission conflicts, and conditional-write conflicts therefore produce no partial profile/tax-year
mutation; the modal also clears its saving state and presents a Hebrew retry message on failure.

Post-fix validation passes 108 application tests, 263 foundation tests, 22 PDF tests, foundation typecheck/lint, the
production build, SST contract verification, Codex-layer validation, runtime Base44 scanning, and diff hygiene. The
documented frontend baselines remain unchanged at 145 type diagnostics and five lint errors. Nothing was deferred;
the PR is ready for a fresh review, while the human simultaneous-editor and authorized live checks remain outstanding.

## Summary

Initial verdict: request changes. The four findings from the initial review are resolved, and the protected route,
concurrency, validation, and verifier contracts are synchronized. One new Medium-severity acceptance mismatch remains:
the Edit Client form splits one logical save across two independent mutations, so a failure in the second request can
leave a partially applied edit. This conflicts with the plan's lifecycle guarantee that a logical action cannot
partially succeed.

## Initial issue counts

| Severity | Initially unresolved |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 0 |

## Review routing

### AGENT FIXES

1. **Resolved — atomic Edit Client save.** `src/components/dashboard/EditClientModal.jsx:27` now sends one combined
   request to `backend/api/services/cpa-workflows.ts:484`, which validates the browser revision and commits the profile,
   optional tax year, derived status, and journal evidence as one conditional mutation.

### HUMAN DECIDES

None.

### HUMAN READS

- `backend/api/services/cpa-workflows.ts:484` — review the combined Client details mutation and its status derivation.
- `backend/api/contracts/cpa-workflows.ts:41` — review the strict allowed profile, tax-year, and revision contract.
- `backend/api/contracts/entities.ts:202` — review the additive Client revision projection used for concurrency.

### HUMAN TESTS

- `src/components/dashboard/EditClientModal.jsx:27` — edit profile and tax year together, then force a stale revision
  and confirm the UI requests a refresh without partially changing either value.
- `src/pages/PdfTemplateEditor.jsx:538` — exercise two simultaneous PDF-template editors and confirm stale update and
  archive requests do not overwrite newer state.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:79` — with explicit authorization and valid AWS
  credentials, run the disposable test-stage two-user acceptance matrix.

### FYI

- `.agents/reports/complete-cpa-workflow-template-parity-report.md:52` — local validation still uses Node 24.13.0
  because Node 20.17.0 could not be activated in the current Windows shell.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:64` — the inherited 145 type diagnostics and five
  lint errors remain unchanged by this remediation.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md:77` — SST preview remains blocked by invalid cached
  AWS credentials; no cloud mutation was made.

## Issues by severity

### Critical

None.

### High

None.

### Medium

1. **Make Edit Client a single atomic server-owned mutation.**
   `src/components/dashboard/EditClientModal.jsx:28` commits the tax-year/status workflow before
   `src/components/dashboard/EditClientModal.jsx:33` sends the profile PATCH. If the first request succeeds and the
   second fails because of a network interruption, validation error, or concurrent write, the modal reports no
   successful save while the tax year and derived status have already changed. The error path also leaves `saving`
   true, and retrying can repeat the workflow against stale component props. Add one server-owned operation that
   accepts the allowed profile fields and optional tax year, derives status, and commits the complete Client change
   under one version condition and journal entry. Add a regression test proving a rejected combined edit makes no
   partial mutation.

### Low

None.

## Previous findings

All four initial findings are resolved:

- PDF-template update and archive require the browser-observed revision and reject stale writes without journaling.
- Generic Client/Submission PATCH contracts reject workflow-owned fields, and orphan reset is a guarded, journaled
  CPA operation.
- Malformed PDF base-file references return 400 before create/update service dispatch.
- Live verifier evidence derives the scoped CPA-route count from the enforced 36-route contract.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | DOCUMENTED DEVIATION — Node 24.13.0 / npm 11.6.2; project requires Node 20.17.0 |
| `npm ci` | PASS — 1,055 packages installed; inherited warnings; 35 audit findings |
| `npm test` | PASS — 12 files / 108 tests |
| `npm run test:foundation` | PASS — 35 files / 259 tests |
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
| `npm run sst:diff:test` | OPERATIONAL BLOCK — invalid cached AWS token and Windows SST temp-log path bug; no cloud mutation |
| Authorized deploy/live acceptance | NOT RUN — explicit owner authorization and valid credentials required |

## What is good

- `backend/api/services/templates.ts` now combines caller-observed revisions with conditional DynamoDB writes, so a
  stale PDF-template editor cannot overwrite or archive newer state.
- `backend/api/services/cpa-workflows.ts` and the matching route inventories keep workflow-owned state behind guarded,
  journaled operations, including the new orphan-status reset.
- `backend/api/contracts/templates.ts` rejects invalid external base-file references at ingress, preserving the 400
  contract and preventing mutation dispatch.
- `tooling/verify_sst_foundation.mjs` reports the same protected route count it enforces, with regression coverage.
- The complete application, foundation, and PDF test suites pass after a clean dependency installation.

## Recommendation

The original recommendation was request changes. The split Edit Client save has now been replaced by one atomic
server operation with no-partial-mutation coverage and the validation gate has passed. Re-run the PR review; after a
clean verdict, a human should perform the simultaneous-editor smoke test and the explicitly authorized test-stage
acceptance before merging.
