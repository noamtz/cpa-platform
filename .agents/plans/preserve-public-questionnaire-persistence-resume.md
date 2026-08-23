# Feature: Preserve public questionnaire persistence and resume behavior

The following plan is complete, but implementation must first revalidate issue #7, the accepted issue #6 contracts,
the canonical Wiki architecture, and the current codebase. Pay special attention to existing field names, the direct
function URL shape, and the distinction between observable Base44 compatibility and source-side security defects.
Do not implement product redesign or broaden this slice into files, PDF rendering, or CPA template administration.

## Feature Description

Move the public questionnaire's client lookup, questionnaire-template reads, lazy Submission creation, serialized
answer saves, resume state, completion transition, and signing-record persistence to the existing SST/AWS
compatibility layer. Keep the current `/questionnaire` and `/questionnaire/sign` screens, Hebrew copy, RTL layout,
navigation, direct `/api/apps/{appId}/functions/{name}` calls, stringified legacy fields, and refresh behavior.

The AWS implementation must strengthen the unsafe source boundary where issue #7 explicitly requires it: archived
clients do not retain a usable public link, a valid token for one client cannot read or mutate another client's
submission, server-owned identity fields cannot be overwritten through `data`, and concurrent/stale writers fail
with a reload-safe 409 instead of silently losing newer answers. Every successful Submission or Client mutation is
committed atomically with ordered ChangeJournal evidence.

## User Story

As a taxpayer using a questionnaire link,
I want my answers, progress, completion state, and signed-form records to save and resume reliably,
so that moving AuditFlow to AWS does not change how I complete my annual questionnaire or lose my work.

## Problem Statement

The public questionnaire still calls Base44 service-role functions for its core state. The current source provides
the visible experience but trusts caller-controlled identifiers and fields, has no transactional uniqueness or
stale-write guard, and updates Submission and Client separately. Issue #6 supplied the AWS router, indexed
repositories, optimistic `_version` fields, and atomic ChangeJournal coordinator, but it intentionally left all
direct public function URLs to downstream slices. Without issue #7, valid client links cannot safely load or save
against AWS, the public flow cannot be tested through the target facade, and rapid or cross-session writes can
overwrite newer state.

## Solution Statement

Add four explicit unauthenticated-at-Gateway compatibility routes whose service layer authenticates every request
with `client_id + token`: `getClientByToken`, `getActiveTemplate`, `getTemplateById`, and
`updateClientSubmission`. Add a strict public-questionnaire contract, a QuestionnaireTemplate repository, public
response projections, and a domain service that:

1. treats missing/archived clients and invalid tokens as unusable links without logging or returning tokens;
2. resolves only the caller's active current-tax-year submission and scopes historical template reads to that
   submission;
3. validates and size-bounds stringified `responses` and `signed_pdfs` while preserving them unchanged at rest;
4. lazily creates at most one active Submission per `(client_id, tax_year)` using the existing active-guard item;
5. uses the submission `_version` as an opaque optimistic revision so stale browser sessions receive 409/reload;
6. commits Submission, conditional Client status/activity changes, the active guard, and journal entries in one
   `TransactWriteItems` operation; and
7. preserves the browser's FIFO promise queue and completion/signing semantics with no visible UI or copy change.

Keep the exact legacy URL shape as the browser seam, enumerate each route in SST and the Lambda handler, and do not
add a catch-all function proxy or Base44 fallback. The API Gateway routes are intentionally `authorization: "none"`;
the public service's token/resource checks are the authorization boundary.

## Out of Scope / Non-Goals

- Not included: `uploadFile`, `getSignedPdfUrl`, private S3 object handling, or ZIP downloads; issue #8 owns private
  files. Existing file references inside `responses` remain opaque and are preserved.
- Not included: `getPdfTemplateById`, `getTemplateFileUrl`, PDF render/generate parity, or PDF Lambda cutover; issue
  #9 owns the PDF/signing pipeline. This slice persists the active sign page's resulting `signed_pdfs` record only.
- Not included: CPA template create/update/version-history routes, `cpaSaveSubmission`, or dashboard template
  migration; issue #10 owns broader CPA/template workflow parity.
- Not included: production data import/reconciliation (#11), rollback replay (#12), analytics (#13), or public
  production cutover (#15).
- Not changing: questionnaire screen composition, Hebrew copy, RTL styling, progress/selector behavior, file upload
  UI, PDF UI, signing audit-record shape, Sentry behavior, or Cognito's bypass for `/questionnaire*` routes.
- Not changing: completed submissions load their stored template, while in-progress submissions use the latest
  active template, as the executable source currently does.
- Not fixing unrelated source defects. The stale-save navigation guard may be made return-value based only as needed
  to prevent a rejected AWS save from advancing; no other questionnaire behavior cleanup belongs here.
- Not removing `@base44/sdk` or the `getActiveTemplate` facade allowlist yet. CPA callers still use that allowlist
  until issue #10; the new public direct routes themselves must never fall back to Base44.
- Not cutting the SST Router over publicly. The architecture forbids public cutover while file/PDF/template routes
  owned by #8-#10 are incomplete.

## Feature Metadata

**Feature Type**: New Capability / migration compatibility slice  
**Estimated Complexity**: High  
**Primary Systems Affected**: public React questionnaire/signing orchestration, direct function compatibility URLs,
Lambda routing/contracts, Client/Submission/QuestionnaireTemplate repositories, atomic ChangeJournal service, SST
route/runtime contracts, characterization and backend contract tests  
**Dependencies**: accepted issue #6 implementation; existing React 18/Vite/Vitest stack; SST 3.19.3; Node 20.17.0;
AWS SDK v3 `@aws-sdk/lib-dynamodb` 3.1116.0; Zod 3.24.2. No new runtime dependency is required.

## Related Work

**Implements**: [Issue #7](https://github.com/noamtz/cpa-platform/issues/7) · **Epic**:
[Issue #1](https://github.com/noamtz/cpa-platform/issues/1) · **PRD**:
[AuditFlow Platform Migration](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration) ·
**Architecture**:
[AuditFlow Platform Migration](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- [`.agents/plans/implement-cognito-core-cpa-compatibility.md`](./implement-cognito-core-cpa-compatibility.md) -
  Issue #6 established the single Lambda, strict routes, Dynamo repositories, optimistic `_version`, active
  Submission guard, compatibility facade, and ChangeJournal transaction contract consumed here.
- [`.agents/reports/implement-cognito-core-cpa-compatibility-report.md`](../reports/implement-cognito-core-cpa-compatibility-report.md) -
  Deployment/test evidence and the explicit handoff that direct function URLs remain downstream-owned.
- [Issue #6](https://github.com/noamtz/cpa-platform/issues/6) - Closed after human acceptance on 2026-08-24;
  satisfies issue #7's planning gate.
- [Issue #4 plan](./establish-sst-serverless-aws-foundation.md) - Defines the seven-table/two-bucket foundation,
  same-origin Router, and test-stage contract verifier.

**Forward-references**:

- [Issue #8](https://github.com/noamtz/cpa-platform/issues/8) - Adds private file upload/read/ZIP routes needed for
  a complete public questionnaire exercise on SST.
- [Issue #9](https://github.com/noamtz/cpa-platform/issues/9) - Adds PDF template/file/render/signing parity; consumes
  the `signed_pdfs` persistence contract delivered here.
- [Issue #10](https://github.com/noamtz/cpa-platform/issues/10) - Migrates CPA questionnaire/template management and
  can then remove the remaining `getActiveTemplate` Base44 facade allowlist.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` - Repository boundaries, validation requirements, read-only provenance rule, and staged migration
  status.
- `.agents/references/auditflow-api-security-contracts.md` - Public routes are open at the router but every client
  data operation validates `client_id + token`; preserve `{ error }` and 400/403/404/409/500 behavior.
- `.agents/references/auditflow-submission-compatibility.md` - `responses`, `signed_pdfs`, and `cpa_audit_log` remain
  JSON-encoded strings; legacy flat fields remain readable.
- `.agents/references/auditflow-questionnaire-parity.md` - Preserve the promise queue, first-unanswered resume rule,
  `step_completed` race guard, and PDF completion rules.
- `.agents/references/auditflow-frontend-conventions.md` - JavaScript/JSX, `@/*`, page/component/lib placement, Hebrew
  RTL, and generated-UI restrictions.
- `src/App.jsx` (lines 37-73) - `/questionnaire` and `/questionnaire/sign` bypass Cognito and route to the current
  page/signing components; keep this boundary unchanged.
- `src/pages/ClientQuestionnaire.jsx` (lines 21-84) - Query-token inputs, public-page token clearing, local state,
  save queue, and the exact direct function POST transport.
- `src/pages/ClientQuestionnaire.jsx` (lines 86-181) - Parallel client/template load; completed-template pinning;
  in-progress current-template behavior; response filtering; resume selection.
- `src/pages/ClientQuestionnaire.jsx` (lines 185-272) - Signing-return merge, latest Submission ID ref, serialized
  saves, archive reload flag, save-before-advance, and client-generated completion timestamp.
- `src/pages/ClientQuestionnaire.jsx` (lines 315-526) - Progress, selector, QuestionStep wiring, signed-record display,
  sign navigation state, and completion edit behavior that must remain visually identical.
- `src/pages/PdfSignIframeOverlay.jsx` (lines 14-26, 255-310, 523-565) - The active signing route loads client state,
  uses downstream PDF/file routes, writes a stringified `signed_pdfs` replacement through
  `updateClientSubmission`, and returns router state.
- `src/components/questionnaire/QuestionStep.jsx` (lines 13-153, 379-478) - Builds the complete stringified responses
  object, preserves files/text/options, awaits parent saves, and gates PDF/question navigation.
- `src/lib/questionnaire-steps.js` (lines 9-97) - Pure build/resume/status state machine; do not move these rules into
  the backend.
- `src/lib/submission-compat.js` (lines 39-125) - Legacy/new response decoding and PDF-aware progress semantics.
- `src/lib/questionnaire-template.js` (lines 7-219) - Current browser default, active-step sorting, and tolerant
  template parsing. Do not silently replace its UI fallback content.
- `src/lib/__tests__/questionnaire-steps.test.js` (lines 24-241) - Characterization cases for fresh/resume/race/PDF
  state and step-status behavior.
- `src/lib/__tests__/questionnaire-template.test.js` (lines 33-201) - Current template condition/order/fallback tests.
- `base44/functions/getClientByToken/entry.ts` (lines 6-30) - Source response/error shape and current-year active
  Submission selection; strengthen archived-client and token handling per issue AC.
- `base44/functions/getActiveTemplate/entry.ts` (lines 3-130) - Latest-active/version sorting, parsed `steps`, and
  first-use default creation behavior.
- `base44/functions/getTemplateById/entry.ts` (lines 5-30) - Historical-template response projection and errors;
  add client-token/submission scope in AWS.
- `base44/functions/updateClientSubmission/entry.ts` (lines 6-70) - Lazy create/update, stale-archive 409 body,
  Client status/activity behavior, completion flag, and response shape. Its absent ownership/schema/transaction
  checks are evidence to correct, not behavior to copy.
- `base44/entities/Client.jsonc` (lines 17-24, 39-63) - Token/year/status/activity/archive source fields.
- `base44/entities/Submission.jsonc` (lines 97-148) - Resume, completion, template, JSON-string, signing, and archive
  fields.
- `base44/entities/QuestionnaireTemplate.jsonc` (lines 5-26) - Version/active/stringified-step source shape.
- `backend/api/contracts/entities.ts` (lines 18-42, 73-115, 175-181) - Persisted Zod contracts, strict CPA ingress,
  and existing public projection that must not be reused for a public Client because it retains `token`.
- `backend/api/repositories/dynamo.ts` (lines 23-110) - Direct-get/indexed-query validation, pagination, filtering,
  and bounded evaluation pattern.
- `backend/api/repositories/client.ts` (lines 16-43) - Direct Client lookup by ID for token authorization.
- `backend/api/repositories/submission.ts` (lines 16-67) - `byClientYear` access pattern and active/archive filtering
  seam.
- `backend/api/services/entities.ts` (lines 34-59, 121-152, 171-240) - Conditional version writes, journal commits,
  and the existing active-submission guard item to reuse for public lazy creation.
- `backend/api/services/change-journal.ts` (lines 35-49, 115-160, 162-268) - CPA-coupled actor input, deterministic
  idempotency token, cursor conflict retry, business conflict mapping, and transaction construction.
- `backend/api/contracts/change-journal.ts` (lines 17-50) - Journal entity-type and actor evidence contract; extend
  only for QuestionnaireTemplate default creation if that compatibility branch is retained.
- `backend/api/routes/entities.ts` (lines 30-109) - Strict parse/service/JSON route registration pattern.
- `backend/api/handler.ts` (lines 34-58, 68-109, 119-177) - Dependency composition, explicit route allowlist,
  authenticated wrapper, safe error normalization, and privacy-safe logging.
- `infra/sst/contracts.ts` (lines 34-111, 131-226) - QuestionnaireTemplate `byVersion` GSI and exact API route
  inventory/authorization contract.
- `infra/sst/application.ts` (lines 21-57, 59-92) - Same-origin API, Lambda environment/linking, authorizer, and
  route materialization. Keep CORS disabled.
- `infra/sst/foundation-contract.json` - Machine-readable route/table contract mirrored by foundation tests and the
  verifier.
- `backend/api/__tests__/entity-service.test.ts` - Deterministic service dependencies and transaction assertions.
- `backend/api/__tests__/change-journal-service.test.ts` - Cursor retry, atomic actions, cancellation mapping, and
  journal evidence patterns.
- `backend/api/__tests__/core-cpa-routes.test.ts` - Event/dependency injection and explicit route authorization tests.
- `infra/sst/__tests__/contracts.test.ts` - Stable inventory, explicit authorization, and JSON contract parity.
- `docs/migration/auditflow-source-baseline.md` (lines 51-67) - Known full-app baseline: tests/build pass; source
  typecheck and lint already fail. New/touched paths must be clean and aggregate diagnostics must not regress.

### New Files to Create

- `backend/api/contracts/public-questionnaire.ts` - Strict request/data/template contracts, size-bounded JSON-string
  validators, response projections, and public actor/revision types.
- `backend/api/repositories/questionnaire-template.ts` - ID lookup and descending `byVersion` latest-active query.
- `backend/api/services/public-questionnaire.ts` - Token authorization, template reads/default compatibility, active
  Submission lookup, lazy create/update, optimistic conflict handling, and atomic Client/Submission/journal changes.
- `backend/api/routes/public-questionnaire.ts` - Four explicitly named compatibility route registrations.
- `backend/api/__tests__/public-questionnaire-contracts.test.ts` - Boundary validation and projection/redaction tests.
- `backend/api/__tests__/questionnaire-template-repository.test.ts` - Dynamo command, ordering, filtering, parse-failure
  tests.
- `backend/api/__tests__/public-questionnaire-service.test.ts` - Authorization, ownership, template, transition,
  atomicity, conflict, ordering, and legacy-string tests.
- `backend/api/__tests__/public-questionnaire-routes.test.ts` - Handler route keys, status/body compatibility, and
  confirmation that Cognito is not the public authorization boundary.
- `src/api/function-client.js` - Small testable transport for the existing direct function URL shape and full
  non-2xx body preservation; no Base44 SDK dependency or fallback.
- `src/api/__tests__/function-client.test.js` - Exact path/body and error-body behavior.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [DynamoDB `TransactWriteItems`](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html)
  - Specific sections: action limits, same-item restriction, conditions, `ClientRequestToken`, and transaction errors.
  - Why: Submission, Client, active guard, cursor, and journal entries must commit atomically; put the version guard
    on the write action rather than adding a same-key `ConditionCheck`.
- [DynamoDB optimistic locking](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/BestPractices_OptimisticLocking.html)
  - Specific section: version comparison and conditional failure.
  - Why: `_version` is the opaque browser revision; stale sessions must fail rather than overwrite.
- [DynamoDB transaction best practices](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
  - Specific sections: ACID behavior, idempotency, conflict/capacity behavior, and retry guidance.
  - Why: distinguish retryable cursor/transport conflicts from semantic Submission conflicts.
- [DynamoDB `CancellationReason`](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CancellationReason.html)
  - Specific section: cancellation reasons correspond to transaction-item order.
  - Why: retain correct cursor-versus-business conflict mapping when the business action count expands.
- [SST v3 `ApiGatewayV2.route`](https://sst.dev/docs/component/aws/apigatewayv2/#route)
  - Specific section: route registration and default `auth: false`.
  - Why: all four public compatibility paths must be explicit and reviewable, never a catch-all proxy.
- [SST v3 authorizers](https://sst.dev/docs/component/aws/apigatewayv2/#addauthorizer)
  - Specific section: JWT authorizer attachment.
  - Why: confirms public function paths deliberately differ from CPA routes; every CPA route remains JWT-scoped.
- [API Gateway HTTP API JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
  - Specific section: Gateway validation and Lambda claims.
  - Why: do not route public link tokens through Cognito or weaken the existing CPA authorizer.

### Patterns to Follow

**Naming Conventions:** TypeScript backend modules use kebab-case filenames and named exports; React pages remain
PascalCase default exports; pure browser helpers live under `src/api/` or `src/lib/`. Use current legacy field names
(`client_id`, `submission_id`, `step_completed`, `completed_at`, `template_id`, `template_version`, `signed_pdfs`)
at the compatibility boundary.

**Strict ingress, permissive persistence:** Mirror `backend/api/contracts/entities.ts`: `.strict()` public request
objects, bounded strings/numbers, and `.passthrough()` persisted records so imported Base44 metadata and legacy flat
fields survive. Validate that `responses` decodes to an object and `signed_pdfs` decodes to an array, but store the
original strings without normalization.

**Error Handling:** Route bodies use `parseJsonBody`; domain failures throw `ApiError`; the handler produces
`{ error: message, ...(code) }`. Preserve the special stale body by extending the safe error response mechanism to
carry `{ reload: true }` for 409 without returning arbitrary details. Missing credentials are 400; invalid token is
403; missing/archived client and missing authorized resource are 404 where source/AC requires; archived, replaced,
or stale-version Submission writes are 409 with a stable error code and `reload: true`; unexpected stored-data/AWS
failures are 500.

**Logging Pattern:** Keep `handler.ts:159-172`: request ID, error name, and generic message only. Never log request
bodies, client tokens, answers, signatures, filenames, template contents, or full DynamoDB cancellation payloads.

**Public authorization and projection:** Resolve Client by the body `client_id`, require a non-empty stored token,
compare token digests with constant-time semantics, reject archived Client records, and derive every other ID/year
from that record. Return only UI-required Client fields; omit `token`, `record_type`, `_version`, and any future
internal metadata. Return Submission `_version` only as an opaque save revision if using the plan's minimal
optimistic-concurrency shape; never accept caller ownership/year/archive fields inside `data`.

**Atomic write pattern:** Reuse the active guard key `!ACTIVE#{client_id}#{tax_year}` and the journal service. A new
save transaction contains conditional Submission create + conditional guard create + any necessary conditional
Client update + cursor + journal entries. An existing save contains conditional Submission version update + any
necessary Client update + cursor + journal entries. Do not place a `ConditionCheck` and write against the same key.
No successful business write may exist without its journal entries.

**Save ordering:** Keep the browser `saveQueue.current.then(...)` and latest Submission ID/version refs. Each save
sends the last acknowledged `_version`; the backend increments it and returns the new revision. Same-tab writes are
FIFO. A second tab with an older revision receives a semantic 409/reload; the backend does not merge or retry stale
whole-response JSON over newer state.

**Template behavior:** Query `QuestionnaireTemplate` by `record_type="QuestionnaireTemplate"`, descending version,
and select the latest active record. Parse `steps` for the response but do not rewrite stored strings. Preserve the
source's no-template default compatibility using a conditional deterministic seed and journal entry, then reread
after a create race. Keep completed-submission historical lookup scoped to the authenticated client's returned
Submission and return only `id`, `version`, parsed `steps`, and `created_at`.

---

## IMPLEMENTATION PLAN

### Phase 1: Shared mutation and public-boundary foundation

Generalize the ChangeJournal commit actor from a CPA-only object to an explicit privacy-safe actor ID, then define
the strict public questionnaire and template contracts. Preserve all issue #6 behavior through focused regression
tests before adding a public writer.

### Phase 2: Public questionnaire domain implementation

**Depends on:** Phase 1 (journal actor and strict schemas)

Add the QuestionnaireTemplate repository and public service. Implement token authorization, redaction, active
submission/template reads, conditional default-template creation, lazy Submission creation, versioned updates,
status transitions, and multi-entity journaled transactions.

### Phase 3: Direct compatibility routing and SST integration

**Depends on:** Phase 2 (service contracts and dependencies)

Register only the four named function paths in the Lambda and SST contracts, inject the template table name, retain
Cognito on all existing CPA routes, and extend foundation contract/verifier tests without changing resource counts.

### Phase 4: Browser integration and parity characterization

**Depends on:** Phase 3 (final request/response contract)

Centralize the existing direct-function transport, pass client credentials to template reads, carry the opaque
Submission revision through queued saves and the active signing route, and make rejected saves stop navigation.
Keep every rendered component and user-facing string unchanged.

### Phase 5: Validation and authorized test-stage acceptance

**Depends on:** Phases 1-4

Run focused/full application and foundation gates, compare inherited failures with the migration baseline, preview
the SST diff, and—only with explicit deployment/data-mutation authorization—exercise synthetic public fixtures in
test. Do not cut the production Router over.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. REVALIDATE issue, dependency, architecture, source, and branch state

- **IMPLEMENT**: Re-read issue #7, closed dependency #6 and its acceptance comment, epic #1, Wiki PRD/architecture,
  this plan, relevant references, current `origin/main`, issue #6 report, and all direct function call sites. Confirm
  the production-source repository remains read-only and the working branch is a new feature branch.
- **GOTCHA**: If issue #6 contracts, issue #7 acceptance criteria, architecture, or active public route changed after
  2026-08-24, amend this plan before implementation. Do not plan from stale Wiki clones.
- **VALIDATE**: `git remote get-url origin; git status --short; git branch --show-current`
- **SATISFIES**: Planning gate and all ACs by preventing implementation drift.

### 2. REFACTOR `backend/api/services/change-journal.ts` and existing mutation callers

- **IMPLEMENT**: Replace the CPA-only `JournalCommitInput.actor` dependency with a minimal explicit `actorId` (or an
  equivalently narrow shared actor contract). Update EntityService/UserService call sites to pass the existing CPA
  user ID unchanged; preserve journal schema, hashes, sequence, operation grouping, idempotency token, conflict
  indexing, and retry behavior.
- **PATTERN**: `backend/api/services/change-journal.ts:35-49,153-268`; existing callers in
  `backend/api/services/entities.ts:101-151,219-240`.
- **GOTCHA**: Never use/log the public token as `actor_id`. Public saves will use a stable value such as
  `public-client:{client.id}`. Keep cancellation-reason indexes aligned after adding business actions.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/change-journal-service.test.ts backend/api/__tests__/entity-service.test.ts backend/api/__tests__/user-service.test.ts`
- **SATISFIES**: AC #3, #4, #5, #6 (all public mutations can be journaled without fabricating a CPA actor).

### 3. CREATE `backend/api/contracts/public-questionnaire.ts` and contract tests

- **IMPLEMENT**: Define strict schemas for all four request bodies; bounded JSON-string validators for `responses`
  (object) and `signed_pdfs` (array); allowlisted questionnaire data; `completed`; optional/new-save versus required
  existing-save revision semantics; persisted QuestionnaireTemplate shape; public Client/Submission/template
  projections; and safe error codes. Require completion timestamp/template metadata when `completed=true`.
- **PATTERN**: `backend/api/contracts/entities.ts:1-115` for strict ingress/passthrough persisted records and
  `base44/entities/Submission.jsonc:97-148` for retained field names.
- **GOTCHA**: Do not accept `client_id`, `tax_year`, `is_archived`, `_version`, IDs, timestamps, `record_type`, status,
  or creator metadata inside `data`. Preserve valid input strings byte-for-byte; reject malformed/oversized JSON
  before any DynamoDB call. Keep optional revision support only if required for old cached bundles during atomic
  deployment, and document that only versioned callers receive multi-session stale-write protection.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/public-questionnaire-contracts.test.ts`
- **SATISFIES**: AC #3, #4, #5, #6.

### 4. CREATE `backend/api/repositories/questionnaire-template.ts` and repository tests

- **IMPLEMENT**: Add direct ID lookup and descending `byVersion` query for the latest `is_active=true` template.
  Validate records with the persisted template schema; exhaust/filter enough pages to skip inactive high versions;
  expose table/client only as needed by the domain service's conditional default seed.
- **PATTERN**: `backend/api/repositories/submission.ts:16-67` and `backend/api/repositories/dynamo.ts:36-110`.
- **GOTCHA**: Do not scan. The GSI partition key is `record_type`; `is_active` is post-filtered. Do not parse or
  normalize `steps` in the repository.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/questionnaire-template-repository.test.ts`
- **SATISFIES**: AC #1, #2, #6.

### 5. CREATE read/auth/template behavior in `backend/api/services/public-questionnaire.ts`

- **IMPLEMENT**: Add constant-time token authorization with explicit missing-token rejection and archived-client
  rejection; return a token-free public Client plus only the active current-year Submission. Implement latest-active
  template response parsing/default-seed compatibility and completed Submission historical lookup scoped to the
  authorized Submission/template ID.
- **PATTERN**: `base44/functions/getClientByToken/entry.ts:6-28`,
  `base44/functions/getActiveTemplate/entry.ts:108-127`, and
  `base44/functions/getTemplateById/entry.ts:5-27` for observable success/error shapes.
- **GOTCHA**: The source accepts any supplied token when the stored token is empty and exposes the Client token;
  do not copy either defect. Treat missing/empty stored tokens as invalid. A token for Client A must not turn
  arbitrary template IDs into a public enumeration surface. Default creation is a mutation and must be conditional
  and journaled; on a create race, reread the winner rather than emitting 500.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/public-questionnaire-service.test.ts -t "lookup|token|archived|template|redact"`
- **SATISFIES**: AC #1, #2, #4, #6, #7.

### 6. ADD atomic lazy-create/update/transition behavior to `backend/api/services/public-questionnaire.ts`

- **IMPLEMENT**: For a new save, resolve the authorized Client/year and active template, construct the Submission
  with server-owned ID/ownership/year/template/default archive/version/timestamps, claim the existing active guard,
  conditionally update Client only when source status/activity semantics require it, and commit all business actions
  plus journal entries atomically. For an existing save, verify ID ownership/year/archive, require/check the last
  acknowledged `_version`, allow only the validated questionnaire patch, increment version/time, and commit the
  Submission plus any Client transition and journal entries in one transaction.
- **PATTERN**: `backend/api/services/entities.ts:34-59,171-240` for conditional writes/guard; source
  `updateClientSubmission:27-67` for archive/status behavior; `ClientQuestionnaire:220-270` for caller fields.
- **GOTCHA**: A provided missing/archived/replaced/cross-client Submission ID must never fall through to create.
  Return a non-enumerating 409/reload contract for stale resource/revision. Do not retry a semantic Submission
  version conflict by applying stale whole-response JSON over the new record. Preserve client-generated
  `completed_at`; ordinary in-progress saves update Client activity only when the source would. Keep
  `signed_pdfs` and `responses` strings unchanged in storage and journal evidence.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/public-questionnaire-service.test.ts`
- **SATISFIES**: AC #2, #3, #4, #5, #6.

### 7. CREATE `backend/api/routes/public-questionnaire.ts` and UPDATE `backend/api/handler.ts`

- **IMPLEMENT**: Register exact route keys
  `POST /apps/{appId}/functions/getClientByToken`, `getActiveTemplate`, `getTemplateById`, and
  `updateClientSubmission`; parse with Zod; preserve response envelopes; and wire public service dependencies in
  runtime composition. Refactor the misleading CPA-only handler allowlist into explicit public and protected sets.
  Public routes bypass `resolveCpaActor` but never bypass service token checks.
- **PATTERN**: `backend/api/routes/entities.ts:30-109`, `backend/api/handler.ts:43-58,68-109,119-177`, and
  `backend/api/core/http.ts:13-48`.
- **GOTCHA**: Do not accept arbitrary function names and do not proxy unknown paths. Preserve 409
  `{ error, reload: true }` safely; generic handler details must not leak. Existing CPA route keys must remain
  fail-closed and dual-verified.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/public-questionnaire-routes.test.ts backend/api/__tests__/core-cpa-routes.test.ts backend/api/__tests__/auth.test.ts backend/api/__tests__/router.test.ts`
- **SATISFIES**: AC #1, #4, #6.

### 8. UPDATE `infra/sst/contracts.ts`, `infra/sst/application.ts`, and `infra/sst/foundation-contract.json`

- **IMPLEMENT**: Enumerate the four legacy-shaped paths with `authorization: "none"`; inject
  `QUESTIONNAIRE_TEMPLATE_TABLE_NAME`; retain the same Lambda/table links and same-origin CORS-disabled Router;
  mirror exact routes/auth in the JSON contract and adjust foundation tests/verifier expectations. Keep resource
  inventory counts unchanged.
- **PATTERN**: `infra/sst/contracts.ts:131-226`, `infra/sst/application.ts:21-92`, and
  `infra/sst/__tests__/contracts.test.ts`.
- **GOTCHA**: SST routes are unauthenticated by default, so the four-path list itself is a security boundary. Assert
  every pre-existing `/cpa/*` route remains `cognito-jwt` with `auditflow-api/cpa`. Do not enable cross-origin CORS
  or add bucket access for this slice.
- **VALIDATE**: `npm run test:foundation; node tooling/verify_sst_foundation.mjs --mode contract --stage test`
- **SATISFIES**: AC #1, #4, #6, #7.

### 9. CREATE `src/api/function-client.js` and its focused tests

- **IMPLEMENT**: Extract the current same-origin POST transport into a dependency-injectable helper that builds
  `/api/apps/{appId}/functions/{name}`, sends JSON, safely parses JSON, and makes status plus the complete body
  available so callers can preserve either ClientQuestionnaire's reload-body behavior or the sign page's throwing
  behavior. Restrict production callers to named functions; no Base44 SDK or fallback.
- **PATTERN**: `src/pages/ClientQuestionnaire.jsx:71-84` and `src/pages/PdfSignIframeOverlay.jsx:14-26`.
- **GOTCHA**: Do not send Cognito Authorization headers on public links. Do not put `client_id` or token in logs,
  browser storage, or error telemetry. Preserve the compatibility path even if the `{appId}` segment is opaque to
  AWS routing.
- **VALIDATE**: `npx vitest run src/api/__tests__/function-client.test.js`
- **SATISFIES**: AC #1, #4, #6, #7.

### 10. UPDATE `src/pages/ClientQuestionnaire.jsx` for authenticated templates and revisioned FIFO saves

- **IMPLEMENT**: Use the shared function client; send `client_id + token` to both template endpoints; track the
  latest returned Submission ID and `_version` in refs; include the acknowledged version on queued existing saves;
  update both refs from each response; and return an explicit save result so archive/version 409 prevents next or
  completion navigation. Preserve current load parallelism, state helpers, copy, markup, class names, scroll, and
  completion timestamp generation.
- **PATTERN**: `ClientQuestionnaire:86-181,214-272`; `questionnaire-steps.js:40-68`.
- **GOTCHA**: Do not debounce or parallelize the queue: executable code contains FIFO serialization, not a separate
  questionnaire debounce. Do not persist the load-time filtering of removed response keys; the current source only
  filters local display state. Completed submissions stay historical-template pinned; in-progress submissions keep
  current-active behavior.
- **VALIDATE**: `npx vitest run src/api/__tests__/function-client.test.js src/lib/__tests__/questionnaire-steps.test.js src/lib/__tests__/questionnaire-template.test.js`
- **SATISFIES**: AC #1, #2, #3, #5, #7.

### 11. UPDATE `src/pages/PdfSignIframeOverlay.jsx` signing-state save integration

- **IMPLEMENT**: Use the shared function client for migrated functions, retain downstream PDF/file endpoints, send
  the loaded Submission revision with `signed_pdfs`, capture the server-returned Submission/version, and return that
  acknowledged record through router state. Keep required-field checks, PDF generation/upload, audit record,
  `pdf_inputs` stripping, 2-second success delay, and all visible behavior unchanged.
- **PATTERN**: `PdfSignIframeOverlay:255-310,428-438,474-565`.
- **GOTCHA**: Do not claim or reroute `getPdfTemplateById`, `getTemplateFileUrl`, `uploadFile`, `/render-pages`, or
  `/generate-pdf`; #8/#9 own them. A failed/stale signing-state save must not show done or navigate as if persisted.
- **VALIDATE**: `npx eslint src/pages/ClientQuestionnaire.jsx src/pages/PdfSignIframeOverlay.jsx src/api/function-client.js src/api/__tests__/function-client.test.js --quiet; npm run build`
- **SATISFIES**: AC #2, #3, #4, #5, #7.

### 12. ADD complete contract, concurrency, and characterization coverage

- **IMPLEMENT**: Complete tests for missing/invalid/archived links; Client token redaction; current-year active-only
  lookup; completed historical template; current active in-progress template; malformed/oversized JSON; cross-client
  and cross-year IDs; archived/replaced ID 409/reload; first-save race; stale revision; sequential revisions;
  conditional Client status/activity behavior; completion timestamp; stringified signing record; default-template
  seed race; transaction/journal atomicity; exact direct paths; and unchanged resume/PDF completion helpers.
- **PATTERN**: `questionnaire-steps.test.js:24-241`, `entity-service.test.ts`,
  `change-journal-service.test.ts`, and `core-cpa-routes.test.ts`.
- **GOTCHA**: Assert no business write occurs on every rejection. Simulate concurrency at the service/transaction
  boundary; do not claim that DynamoDB transaction action order serializes saves. Assert cancellation reasons by
  action index and verify semantic conflicts are not retried as cursor conflicts.
- **VALIDATE**: `npm test; npm run test:foundation`
- **SATISFIES**: AC #1-#7.

### 13. VALIDATE full repository and SST contract health

- **IMPLEMENT**: Run the required Node 20.17.0 install/test/typecheck/lint/build/foundation gates, targeted lint for
  touched frontend files, contract verifier, Codex-layer validator (the plan is an AI-layer artifact), and diff
  hygiene. Compare full-app inherited failures to `docs/migration/auditflow-source-baseline.md`; require zero new
  diagnostics and zero touched-path diagnostics rather than pretending the legacy baseline is clean.
- **GOTCHA**: Do not fix unrelated baseline lint/typecheck failures. Do not run deploy/live verification without
  explicit AWS authorization and named-identity preflight.
- **VALIDATE**: `npm ci; npm test; npm run typecheck; npm run lint; npm run build; npm run test:foundation; npm run typecheck:foundation; npm run lint:foundation; node tooling/verify_sst_foundation.mjs --mode contract --stage test; python tooling/validate_codex_layer.py; git diff --check`
- **SATISFIES**: AC #1-#7 and repository validation policy.

### 14. PREVIEW and, only when authorized, prove the test-stage public contract

- **IMPLEMENT**: Run the named AWS identity preflight and `sst diff`/contract checks. With explicit authorization,
  deploy test, verify live inventory/routes, seed disposable token-safe Client/template fixtures through approved
  tooling, and exercise: fresh link/lazy create; first-unanswered refresh; second-session stale conflict; rapid FIFO
  saves; archived Client; archived/replaced Submission; cross-client ID; completion; and a synthetic
  `signed_pdfs` save. Read back DynamoDB business records and ordered journal entries without printing tokens or
  answers. Remove/retain fixtures only through the approved test-data process.
- **GOTCHA**: No production action, DNS change, Base44 write, or public Router cutover is authorized by this plan.
  Full file upload and PDF signing on SST remain blocked on #8/#9; record that dependency rather than weakening
  acceptance or adding those routes here.
- **VALIDATE**: `npm run sst:diff:test; node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json`
- **SATISFIES**: AC #2, #3, #4, #5, #6.

---

## TESTING STRATEGY

### Unit Tests

- Contract schemas: valid legacy strings, malformed JSON, wrong top-level JSON types, size bounds, unknown fields,
  server-owned fields, completion requirements, new-versus-existing revision constraints.
- Token/auth projection: missing Client, archived Client, empty stored token, mismatch, constant-time helper edge
  lengths, valid token, and no token/internal metadata in output.
- Template repository/service: descending version, inactive higher versions, pagination, exact ID, invalid stored
  JSON, authorized historical scope, no-template conditional seed, and create race reread.
- Mutation service: deterministic IDs/clocks, new Submission defaults, active guard, expected `_version`, Client
  transition/no-op rules, journal changes, and exact response projection.
- Browser transport: exact compatibility path, POST JSON, successful body, 409 body with `reload`, malformed error
  body, and no authorization header.
- Existing pure helpers: keep all questionnaire-step/template/submission-compat tests green.

### Integration / Contract Tests

- Invoke the composed Lambda handler with API Gateway v2 events for all four exact route keys.
- Prove public routes do not call Cognito verification and still reject invalid client tokens in the service.
- Prove every `/cpa/*` route remains Cognito scoped and no unknown function name is registered.
- Assert transaction actions include version/active-guard/Client conditions plus cursor and correct journal entries;
  inject cancellation reasons to distinguish cursor retry from stale Submission 409.
- Simulate two first saves and two same-version existing saves: exactly one semantic write wins, the loser receives
  reload-safe conflict, and no duplicate active Submission/journal gap is accepted.

### Manual / Authorized Test-Stage Validation

1. Open a synthetic valid link with no Submission; answer a non-file step; refresh and confirm the same Submission,
   first-unanswered step, template, answer, and progress.
2. Queue rapid sequential changes in one tab; confirm returned versions increase and the last acknowledged answer is
   stored. Open a second session from an older version; confirm its write is rejected and reload resumes newest data.
3. Archive/replace the active Submission while the page is open; confirm the next save displays the existing reload
   screen and does not advance.
4. Try invalid token, archived Client, Client A token plus Submission B ID, cross-year ID, unknown template ID, and
   arbitrary `data.client_id/is_archived`; confirm no data/journal mutation and no resource/token disclosure.
5. Complete a questionnaire; confirm `completed_at`, final step, template fields, Client `completed`, activity, and
   two-record journal operation. Refresh and confirm the historical template/done screen.
6. Submit a representative stringified signing record through the active route contract; confirm exact persistence,
   new version, resume recognition, and no false success on a stale conflict. Full PDF/file exercise waits for #8/#9.

### Edge Cases

- Missing, empty, wrong, and URL-encoded tokens; Client token absent in migrated data.
- Archived Client with an otherwise active Submission; archived/missing/replaced supplied Submission.
- Multiple historical/archived submissions and a single active current-year record.
- Two concurrent first saves; two stale sessions; retryable journal-cursor collision versus semantic version conflict.
- Active template changes between page load and save; completed historical template removed/malformed.
- No active template and two concurrent default-seed reads.
- `responses` as legacy flat fields only; valid empty object; malformed/oversized string; file references retained.
- `signed_pdfs` empty/malformed/oversized; replacement of one step; incomplete and complete records; explicit PDF no.
- Client already `in_progress`, `completed`, `ready_for_ira`, or `reviewed` when public save occurs.
- Completion request missing timestamp/template metadata; repeated completion; ordinary edit after completion.
- Network/JSON failure in one queue item; ensure no later save is reported successful without a real backend response.
- WhatsApp WKWebView with unavailable localStorage; public link must remain outside Cognito.

---

## VALIDATION COMMANDS

Use Node 20.17.0. Full-app typecheck/lint are inherited-failure comparisons; foundation and touched-path checks must
pass cleanly.

### Level 1: Syntax & Style

```powershell
npm run typecheck:foundation
npm run lint:foundation
npx eslint src/pages/ClientQuestionnaire.jsx src/pages/PdfSignIframeOverlay.jsx src/api/function-client.js src/api/__tests__/function-client.test.js --quiet
python tooling/validate_codex_layer.py
git diff --check
```

### Level 2: Unit Tests

```powershell
npx vitest run src/api/__tests__/function-client.test.js src/lib/__tests__/questionnaire-steps.test.js src/lib/__tests__/questionnaire-template.test.js src/lib/__tests__/submission-compat.test.js
npx vitest run --config vitest.foundation.config.js backend/api/__tests__/public-questionnaire-contracts.test.ts backend/api/__tests__/questionnaire-template-repository.test.ts backend/api/__tests__/public-questionnaire-service.test.ts backend/api/__tests__/public-questionnaire-routes.test.ts
```

### Level 3: Full and Integration Tests

```powershell
npm ci
npm test
npm run test:foundation
node tooling/verify_sst_foundation.mjs --mode contract --stage test
npm run build
```

### Level 4: Baseline Comparison

```powershell
npm run typecheck
npm run lint
```

Compare with `docs/migration/auditflow-source-baseline.md` and the accepted issue #6 report. No touched path may add
a diagnostic; aggregate known failures must not increase.

### Level 5: AWS Preview / Authorized Live Validation

```powershell
npm run sst:diff:test
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json
```

The live command runs only after an explicitly authorized test deployment and named AWS identity preflight.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1 — UI/navigation parity:** Every currently reachable public questionnaire step still renders and
  navigates with unchanged screen structure, Hebrew copy, RTL styling, progress, selector, and sign navigation.
- [ ] **AC #2 — Resume/template parity:** A valid link returns only its current-year active Submission, refresh and
  a second session resume at the correct state using responses/signed records/`step_completed`, completed submissions
  use their stored template, and in-progress submissions retain current-active source behavior.
- [ ] **AC #3 — Save ordering/conflicts:** Same-tab saves remain FIFO and carry monotonically acknowledged revisions;
  rapid edits do not lose a later acknowledged answer; stale/multi-session writes fail 409/reload without mutation.
- [ ] **AC #4 — Public isolation:** Missing/invalid tokens, archived Clients, archived/replaced Submissions,
  cross-client/cross-year IDs, arbitrary template IDs, and server-owned field injection cannot read or mutate another
  resource. Tokens are neither returned nor logged.
- [ ] **AC #5 — Completion/signing state:** `completed`, Client status/activity, client-generated `completed_at`, final
  step, template metadata, and stringified `signed_pdfs` preserve current semantics and commit atomically with journal
  evidence; rejected saves never show false completion.
- [ ] **AC #6 — AWS facade evidence:** Existing characterization tests pass and new contracts cover token ownership,
  save ordering, first-save uniqueness, stale/archive conflicts, resume, templates, transitions, and journal atomicity
  through exact AWS compatibility route keys.
- [ ] **AC #7 — No intentional product change:** No visual/copy change, unrelated refactor, new Base44 dependency,
  catch-all proxy, or premature file/PDF/CPA-template migration is introduced.
- [ ] Foundation typecheck/lint/tests, touched frontend lint, build, contract verifier, Codex-layer validation, and diff
  hygiene pass; inherited full-app failures do not regress.
- [ ] Any test-stage deploy/live exercise has explicit authorization; no production cutover is performed.

---

## COMPLETION CHECKLIST

- [ ] Dependency/architecture drift check completed and recorded.
- [ ] All tasks completed in order and each task's focused validation passed immediately.
- [ ] Public request/projection contracts are strict, size-bounded, and token-safe.
- [ ] Every successful public mutation is atomic with ordered ChangeJournal evidence.
- [ ] Exact four direct compatibility paths exist; unknown functions and all unauthenticated CPA paths fail closed.
- [ ] FIFO, revision, archive, cross-client, completion, and signing-state tests pass.
- [ ] Existing questionnaire characterization tests and production build pass.
- [ ] Foundation tests/typecheck/lint and contract verifier pass.
- [ ] Full typecheck/lint comparison shows no new/touched-path diagnostics.
- [ ] Manual test-stage checks completed if authorized, with sensitive values withheld.
- [ ] No file/PDF/template-admin scope was absorbed and no public/production cutover occurred.
- [ ] Implementation report records validation, remaining #8/#9/#10 blockers, and any plan amendments.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Assumption (inherited, not open):** Issue #6 is accepted. GitHub issue #6 is closed with owner acceptance dated
  2026-08-24 even though its repository report still records an earlier partial gate; the tracker is authoritative
  for the dependency gate and implementation must re-read both.
- **Assumption:** “Debounced/queued saves” in issue #7 refers to the executable FIFO promise queue. No questionnaire
  debounce exists in the current reachable code, so this plan does not invent one.
- **Assumption:** “Pinned template version after refresh” means the executable completed-submission behavior.
  In-progress submissions intentionally load the latest active template. Changing that rule would be a product
  behavior decision and requires an issue/architecture amendment.
- **Assumption:** The special 409 body may use `submission_archived` for archived/replaced IDs and a distinct stable
  `submission_conflict` code for stale revisions, with `reload: true` in both cases. The existing UI copy remains the
  generic questionnaire-updated screen.
- **Assumption:** Returning Submission `_version` to the token-authenticated caller as an opaque revision is an
  additive compatibility field, not user-visible product change. If reviewers reject exposing `_version`, use an
  equivalent opaque top-level revision token and carry it through router state; do not drop stale-write protection.
- **Assumption:** The source's default-template-on-first-read branch remains reachable compatibility behavior. Its
  AWS version must be conditional and journaled. If migration/import guarantees a template before any route can be
  invoked and the owner explicitly removes that branch, amend the plan rather than returning an undocumented shape.
- **No critical unresolved question:** The issue, accepted architecture, source behavior, and existing issue #6
  contracts are sufficient for implementation. Any request to include uploads/PDF routes changes ticket scope and
  should be deferred to #8/#9.

## NOTES (open canvas)

The main security/consistency boundary is deliberately layered:

```text
public URL (no Cognito)
  -> exact API Gateway compatibility route
  -> strict body parser
  -> Client ID lookup + constant-time token check + archive check
  -> derive Client year / active Submission / authorized template
  -> conditional business writes + active guard + ChangeJournal in one transaction
  -> token-free public projection + opaque next revision
```

The source's client queue solves ordering within one mounted page, not across tabs. DynamoDB transactions alone do
not solve stale whole-object overwrites: a late request can read the newest row and still carry an old `responses`
string. The acknowledged revision makes that semantic difference explicit. The server must not automatically retry
a failed Submission version guard. Only the ChangeJournal cursor conflict and transport-safe identical transaction
retry belong in the existing retry path.

The active guard and Submission share a table but use distinct keys, so both can participate in one transaction.
For a create, the guard prevents two first saves from creating two active submissions. For an update, the Submission
write's own version `ConditionExpression` provides optimistic locking. Do not add a separate `ConditionCheck` for the
same Submission key because DynamoDB forbids two transaction actions targeting one item.

Public template reads are authenticated even though templates are global because the architecture requires
`client_id + token` on public questionnaire operations and because historical template IDs should not become an
enumeration API. CPA callers remain on their existing staged compatibility path until issue #10; this is why the
Base44 facade allowlist cannot shrink fully in #7 even though the public direct route is migrated.

**Confidence score:** 8.5/10 for one-pass implementation. The existing issue #6 seams are strong and the endpoint
surface is bounded. The primary risks are transaction conflict classification as business-action indexes grow,
default-template first-read mutation, and coordinating the opaque revision through signing router state without
changing visible behavior. Each has an explicit contract and focused test in this plan.

## AMENDMENTS

<!-- Append-only after initial approval/execution. -->

