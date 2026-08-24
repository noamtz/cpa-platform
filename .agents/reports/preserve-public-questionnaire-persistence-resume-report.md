# Implementation Report — Preserve public questionnaire persistence and resume behavior

**Plan**: `.agents/plans/preserve-public-questionnaire-persistence-resume.md`
**Branch**: `feature/preserve-public-questionnaire-persistence-resume`
**Status**: COMPLETE — implementation, local validation, and the authorized read-only test-stage preview pass

## Summary

Implemented the four exact public questionnaire compatibility functions on the SST/AWS boundary with strict
client-token authorization, token-free projections, current-year Submission scoping, authenticated template reads,
conditional default-template seeding, optimistic revisions, and atomic Submission/Client/ChangeJournal writes. The
browser retains the existing public routes, Hebrew/RTL UI, FIFO save queue, resume rules, template behavior, and
signing workflow while carrying each acknowledged Submission revision and stopping navigation after rejected saves.

The infrastructure contract now exposes only the four named unauthenticated-at-Gateway function paths and keeps all
fourteen CPA routes Cognito/JWT scoped. No file upload, file signing, PDF rendering/generation, CPA template
administration, deployment, public cutover, or production action was added.

## Tasks completed

- Revalidated issues #7, #6, and #1, the owner acceptance comment, current Wiki PRD/architecture, official AWS/SST
  transaction and routing constraints, repository contracts, source functions, current call sites, and branch state.
- Generalized ChangeJournal commits to a privacy-safe `actorId` while preserving CPA user IDs and existing journal
  semantics → `backend/api/services/change-journal.ts`, `backend/api/services/entities.ts`,
  `backend/api/services/users.ts` (UPDATE).
- Added strict public request/data/persistence/projection contracts, JSON byte bounds, revision constraints, safe
  error codes, and QuestionnaireTemplate journal evidence → `backend/api/contracts/public-questionnaire.ts`,
  `backend/api/contracts/change-journal.ts`, `backend/api/contracts/entities.ts` (CREATE/UPDATE).
- Added indexed QuestionnaireTemplate ID/latest-active access without scans →
  `backend/api/repositories/questionnaire-template.ts` (CREATE).
- Added token authorization, redaction, active current-year lookup, scoped historical templates, conditional default
  seed/race reread, lazy active guard creation, versioned updates, Client transitions, and atomic journal coordination
  → `backend/api/services/public-questionnaire.ts` (CREATE).
- Added four explicit public function routes, safe reload error serialization, runtime dependency composition, and
  fail-closed public/protected route inventories → `backend/api/routes/public-questionnaire.ts`,
  `backend/api/handler.ts`, `backend/api/core/http.ts` (CREATE/UPDATE).
- Added the four unauthenticated SST route contracts, QuestionnaireTemplate table environment link, JSON contract,
  contract tests, and verifier checks while retaining the stable resource inventory → `infra/sst/contracts.ts`,
  `infra/sst/application.ts`, `infra/sst/foundation-contract.json`,
  `infra/sst/__tests__/contracts.test.ts`, `tooling/verify_sst_foundation.mjs` (UPDATE).
- Added the named-function browser transport with exact same-origin path, no Cognito header, complete non-2xx body
  preservation, and structured throwing mode → `src/api/function-client.js` (CREATE).
- Added acknowledged revision handling to queued questionnaire saves and signing-state persistence, including the
  return-value navigation guard → `src/pages/ClientQuestionnaire.jsx`, `src/pages/PdfSignIframeOverlay.jsx`,
  `src/components/questionnaire/QuestionStep.jsx` (UPDATE).

## Tests added

- `backend/api/__tests__/public-questionnaire-contracts.test.ts` — strict credentials/data, malformed/wrong-shape
  and oversized JSON, server-owned field rejection, completion metadata, revision rules, redaction, and projections.
- `backend/api/__tests__/questionnaire-template-repository.test.ts` — exact Get, descending `byVersion`, inactive-page
  skipping, and corrupt-row handling.
- `backend/api/__tests__/public-questionnaire-service.test.ts` — token/link failures, current-year lookup, template
  scope/default seed race, lazy create/guard, cross-client/year/replaced IDs, stale and first-save conflicts,
  sequential revisions, authorized template metadata, signing JSON, completion, and all Client status transitions.
- `backend/api/__tests__/public-questionnaire-routes.test.ts` — exact public route keys, Cognito bypass at Gateway,
  request IDs, strict rejection, safe 409 reload body, and unknown-function failure.
- `src/api/__tests__/function-client.test.js` — exact path/body/header, success, complete 409 body, structured errors,
  malformed bodies, and named-function allowlist.
- Existing ChangeJournal, EntityService, UserService, CPA route, questionnaire-step/template/submission compatibility,
  and SST contract tests were extended or retained as regressions.

## Validation results

- Node toolchain: PASS using Node `20.17.0` and npm `10.8.2` explicitly.
- `npm ci`: PASS; inherited peer/engine/deprecation and audit warnings remain.
- Focused browser/helper tests: PASS — 4 files / 72 tests.
- Focused public questionnaire tests: PASS — 4 files / 52 tests.
- Full application tests: PASS — 8 files / 90 tests.
- Full foundation/backend/tooling tests: PASS — 22 files / 150 tests.
- Foundation typecheck and lint: PASS.
- Touched frontend lint: PASS, including `QuestionStep.jsx` in addition to the plan's named paths.
- Production build: PASS.
- SST contract verifier: PASS — seven tables, two buckets, one Router/API/Lambda/Cognito foundation, four exact
  public questionnaire paths, and fourteen scoped CPA paths.
- Full application typecheck: inherited failure remains but improves from the accepted issue #6 count of 196 to
  178 diagnostics; zero touched-path diagnostics.
- Full application lint: inherited failure remains but improves from 23 to 21 errors; zero touched-path errors.
- Codex-layer validation: PASS — 31 skills and 6 custom agents.
- `git diff --check`: PASS; informational Git for Windows future line-ending warnings only.
- AWS identity preflight: PASS — the refreshed `ntz-taxflow` SSO profile matches the repository's expected AWS
  account and `il-central-1` region and can inspect the account-level OIDC provider.
- `npm run sst:diff:test`: PASS — the preview adds only the four public questionnaire routes and their API
  Gateway integrations/permissions, updates the shared Lambda code and QuestionnaireTemplate environment link,
  and refreshes static-site assets. Preview-only builder/code objects are replaced ephemerally; no table, bucket,
  Cognito pool, or other stateful resource is replaced or deleted.
- Test deployment/live verifier/manual fixture exercise: NOT RUN; no deployment or AWS data mutation was authorized.

## Deviations from the plan

- The plan anticipated a return-value stale-save guard; implementing it required a narrow update to
  `QuestionStep.jsx` so its save-before-sign navigation uses the acknowledged Submission and stops only on an
  explicit `false` result. CPA-mode callers that return `undefined` retain their previous navigation behavior.
- Behavior-neutral local component aliases and three unused-import removals were added only to satisfy the plan's
  zero touched-path lint/type diagnostic requirement without editing generated UI primitives.
- The repository plan's recommended `auditflow-deploy` profile was not configured on this machine. After confirming
  the intended account mapping, the owner refreshed the existing `ntz-taxflow` SSO profile and the preview used
  that profile explicitly. No deployment, live verification, or data mutation was attempted.

## Issues encountered

- A repository safety hook correctly blocked recursive cleanup of a temporary Wiki clone; revalidation continued in
  a new unique temporary directory without deleting anything.
- A secret-scanning hook produced false positives on one synthetic repository-test patch; the same non-sensitive
  test was applied in smaller reviewed edits.
- The SST preview emitted a non-fatal Windows temporary-log cleanup warning after loading the correct existing
  bootstrap; synthesis and the complete 150-resource diff still exited successfully.
- Issues #8/#9/#10 still own private files, PDF routing/rendering, and CPA template/workflow parity, so full public
  questionnaire/signing acceptance and Router cutover remain intentionally blocked on those slices.
