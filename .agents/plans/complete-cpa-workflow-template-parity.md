# Feature: Complete CPA workflow and template parity

The following plan is complete, but implementation must first revalidate issue #10, the merged dependency state,
the canonical Wiki architecture, installed dependency APIs, and the active branch diff. Pay particular attention to
the existing persistence field names, Base44-shaped response wrappers, private-file ownership rules, and route
inventories; this ticket completes the last active runtime compatibility allowlist and must not reintroduce a
Base44 fallback.

## Feature Description

Complete the AWS migration of every reachable CPA-facing dashboard, client lifecycle, questionnaire-template,
PDF-template, version-history, and CPA-assisted questionnaire action. The implementation will add authenticated,
strictly validated, journaled AWS services for questionnaire version activation/history, PDF-template lifecycle,
CPA-assisted saves, tax-year selection, submission restore conflict resolution, and paired CPA status transitions.
Existing React pages keep their Hebrew copy, RTL layout, route hierarchy, and interaction model by calling these
services through the retained `base44`-shaped compatibility facade.

This is also the final active application-runtime Base44 boundary. Once the PDF-template and questionnaire calls are
AWS-backed, remove the Base44 SDK and Vite plugin, leave the unmounted readiness-agent feature unimplemented as the
architecture requires, and serve the existing brand images locally. Public questionnaire and signing operations
continue using the token-scoped routes and private S3/PDF services delivered by issues #7-#9.

## User Story

As a CPA using AuditFlow
I want to manage clients, submissions, questionnaire versions, PDF templates, and assisted questionnaire completion
through the familiar interface
So that I can perform my complete current workflow on AWS without losing history, audit evidence, or signing behavior.

## Problem Statement

Issues #6-#9 migrated authentication, core entity access, public questionnaire persistence, private files/ZIPs, and
the PDF renderer, but issue #10's CPA workflow seams remain incomplete. `PdfTemplate` CRUD and CPA active-template
reads still delegate to Base44; QuestionnaireEditor and VersionHistory call unimplemented authenticated functions;
`CpaFillQuestionnaire` sends a legacy browser token to an unregistered `cpaSaveSubmission` path; and multi-record
restore/status actions execute independent browser mutations that can partially succeed under the target's active
submission invariant. Consequently, the UI is present but several reachable CPA actions cannot work after the AWS
cutover, and the remaining Base44 packages cannot be removed.

## Solution Statement

1. Add strict template and CPA-workflow contracts, repository accessors, and conditional transaction helpers on top
   of the existing DynamoDB/ChangeJournal boundary.
2. Introduce a `TemplateService` for questionnaire history/activation and PDF-template CRUD/archive. Use an internal
   questionnaire active/version guard to make version allocation, old-version deactivation, new-version creation,
   and journal entries one atomic operation. Treat the existing PDF editor's delete action as a soft archive while
   keeping archived templates out of normal lists and public signing reads.
3. Introduce a `CpaWorkflowService` for assisted saves and the multi-record dashboard operations. It will derive CPA
   audit identity from the linked Cognito `User`, preserve JSON-string fields, enforce active client/year ownership,
   return an opaque revision for queued saves, and update Submission, Client, active guard, and ChangeJournal in one
   transaction where the logical action spans records.
4. Register exact Cognito-scoped routes in the shared API Lambda and SST route contract. Continue to expose the
   currently direct `cpaSaveSubmission` compatibility path, but call it through the authenticated HTTP client.
5. Replace raw/legacy frontend calls with facade methods, preserve the SDK-style `{ data: ... }` function response,
   make save/conflict handling stop navigation on a rejected write, and reuse the completed private-file and PDF
   clients without changing page structure.
6. Remove `@base44/sdk`, `@base44/vite-plugin`, the Vite plugin configuration, and remote Base44 brand-media URLs;
   keep migration/provenance tooling and the read-only `base44/` evidence directory intact.

## Out of Scope / Non-Goals

- Not included: production data import, legacy private-file enablement, reconciliation, or migration evidence; issue
  #11 owns those gates. The SST test stage remains synthetic-only with both legacy readers pinned off.
- Not included: reverse migration/rollback replay (#12), PostHog (#13), release-readiness parity gates (#14), or
  production cutover/DNS/Base44 retirement (#15).
- Not included: Google Drive or Telegram integration. Their existing controls remain visible and return the current
  controlled `Not implemented` response without contacting either service.
- Not included: Bedrock, a readiness-agent backend, or making `SubmissionReadinessChat` reachable. The canonical
  architecture explicitly classifies that component as dormant.
- Not included: physical deletion of archived PDF-template objects or submission files. Versioned S3 data remains
  available for rollback; permanent deletion is a separate lifecycle decision.
- Not included: the dormant `deleteSubmissionWithFiles` and unscoped public `getActivePdfTemplates` functions. No
  reachable caller uses them; public signing stays restricted to a template referenced by the authorized client's
  questionnaire.
- Not changing: public questionnaire navigation/autosave semantics, PDF renderer behavior, generated shadcn/Radix
  primitives, Hebrew copy, RTL structure, Sentry configuration, the Terraform PDF endpoints, or the provenance-only
  source repository.
- Not normalizing: `Submission.responses`, `signed_pdfs`, `cpa_audit_log`, legacy flat fields, IDs, timestamps, or
  imported metadata. Compatibility transformations remain behind the API boundary.

## Feature Metadata

**Feature Type**: Enhancement / migration-completion capability
**Estimated Complexity**: High
**Primary Systems Affected**: React CPA pages and compatibility facade; shared TypeScript API Lambda; DynamoDB
QuestionnaireTemplate/PdfTemplate/Submission/Client repositories; ChangeJournal; SST API route contracts; private S3
template-file integration
**Dependencies**: Closed/merged issues #6, #7, #8, and #9; React 18/Vite; SST 3.19.3; AWS SDK v3 3.1116.0; Zod
3.24.2; pdfme 6.1.1 at the root; existing private-file and PDF services. Issue #11 is not a dependency for local or
synthetic-only test-stage acceptance, but remains the hard gate for legacy-file reads and production cutover.

## Related Work

**Implements**: [issue #10](https://github.com/noamtz/cpa-platform/issues/10)  ·  **Epic**:
[issue #1](https://github.com/noamtz/cpa-platform/issues/1)  ·  **Architecture**:
[Architecture — AuditFlow Platform Migration](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- `.agents/plans/implement-cognito-core-cpa-compatibility.md` and its report - reuse Cognito actor resolution,
  Base44-shaped facade, strict entity routes, and atomic ChangeJournal coordination; it explicitly defers the
  template, assisted-save, and multi-record lifecycle work to #10.
- `.agents/plans/preserve-public-questionnaire-persistence-resume.md` and its report - reuse active submission guards,
  template projection, optimistic conflict mapping, default-template seeding, and completed-submission pinning.
- `.agents/plans/implement-private-s3-files-zip-downloads.md` and its report - reuse private template upload/read,
  upload receipts, S3 ownership validation, and resource-scoped public PDF-template access.
- `.agents/plans/prove-sst-pdf-generation-signing-parity.md` and its report - preserve the verified same-origin SST
  PDF endpoint, browser signing flow, synthetic-only stage restrictions, and legacy rollback selector.
- [PR #26](https://github.com/noamtz/cpa-platform/pull/26) - private S3 and ZIP implementation merged into `main`.
- [PR #27](https://github.com/noamtz/cpa-platform/pull/27) - PDF generation/signing parity and live synthetic
  acceptance merged into `main`.

**Forward-references**:

- Issue #11 imports/reconciles the Base44 snapshot and later enables verified legacy-file reads.
- Issues #12-#15 consume the completed compatibility boundary for rollback proof, analytics, readiness, and cutover.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

#### Canonical decisions and delivery state

- `.agents/references/auditflow-api-security-contracts.md` - exact public/CPA authorization and
  `{ error: message }` 400/401/403/404/409/500 response contract.
- `.agents/references/auditflow-submission-compatibility.md` - JSON-string and legacy flat-field preservation.
- `.agents/references/auditflow-questionnaire-parity.md` - serialized saves, resume guard, and PDF-step completion.
- `.agents/references/auditflow-pdf-pipeline.md` - server PDF boundary, lazy browser tooling, and fixed-height pdfme
  container requirement.
- `.agents/references/auditflow-aws-operations.md` - exact test/production stage, deployment, and authorization rules.
- `.agents/references/auditflow-frontend-conventions.md` - JSX structure, naming, RTL, Hebrew copy, generated UI, lint.
- `README.md` (lines 37-50, 65-107) - current hybrid facade, synthetic-only file mode, command order, and deployment
  authorization boundary.
- `docs/migration/pdf-parity-runbook.md` (lines 1-77 and browser matrix after line 105) - mandatory local PDF gates
  and owner-run render/sign/upload/resume/reopen acceptance flow.
- `docs/migration/auditflow-source-baseline.md` (lines 53-62) - accepted imported frontend typecheck/lint failures;
  touched paths may add no diagnostics.

#### Source behavior and reachable frontend

- `base44/functions/saveQuestionnaireTemplate/entry.ts` (lines 7-48) - nonempty step validation, deactivation,
  version increment, string encoding, creation timestamp, and response shape to preserve atomically.
- `base44/functions/getAllTemplateVersions/entry.ts` (lines 15-27) - descending 100-version history projection.
- `base44/functions/getActiveTemplate/entry.ts` (lines 108-127) - latest-active selection and default seed behavior.
- `base44/functions/getTemplateById/entry.ts` (lines 5-27) - historical template response and 400/404 behavior.
- `base44/functions/cpaSaveSubmission/entry.ts` (lines 7-83) - CPA auth, client/year lookup, audit record, create/update,
  template selection, client status/last-activity transition, and response shape.
- `base44/entities/QuestionnaireTemplate.jsonc` (lines 1-27), `PdfTemplate.jsonc` (lines 1-23),
  `Submission.jsonc` (lines 5-152), and `Client.jsonc` (lines 5-68) - retained source fields and enums.
- `src/components/dashboard/QuestionnaireEditor.jsx` (lines 73-93, 580-665, 730-767) - PDF-template selection,
  active-template load, whole-list ordered save, non-removable defaults, and Hebrew feedback.
- `src/components/dashboard/VersionHistory.jsx` (lines 19-66, 99-136) - history/detail request shapes, read-only UI,
  `he-IL` formatting, and status/count display.
- `src/pages/PdfTemplateEditor.jsx` (lines 42-60, 78-115, 476-506, 546-623) - auth, list/edit, private base-PDF
  upload/read, pdfme JSON/field mapping, save/update, and user-visible delete interaction.
- `src/pages/CpaFillQuestionnaire.jsx` (lines 37-107, 109-203, 231-374) - CPA load/template/resume, FIFO save queue,
  audit save payload, completion, PDF exemption/undo, and unchanged RTL UI.
- `src/pages/CpaDashboard.jsx` (lines 31-93, 103-152) - auth, three-way load, current-year active submission join,
  status precedence, and route/layout behavior.
- `src/components/dashboard/ClientRow.jsx` (lines 131-181, 202-225, 639-779, 801-820) - private file/ZIP seam,
  year change, archive/restore conflict, orphan-status reset, Drive deferral, and paired workflow statuses.
- `src/pages/ClientsPage.jsx` (lines 27-53, 227-278) - client archive/restore and archived submission conflict flow.
- `src/components/dashboard/AddSubmissionModal.jsx` (lines 16-49) - new-year validation and client year/status update;
  intentionally does not create a Submission until the first save.
- `src/components/dashboard/RestoreSubmissionDialog.jsx` (lines 1-73) - exact conflict choices and Hebrew date/copy.
- `src/components/dashboard/SubmissionReadinessChat.jsx` (lines 1-49) and `src/App.jsx` (lines 43-87) - prove the
  agent component is unmounted while all issue #10 pages are reachable and protected.
- `src/pages/PdfSignIframeOverlay.jsx` and `src/App.jsx` (lines 24-60) - the production-mounted signing route and the
  exact distinction between that iframe flow, the unmounted legacy signer, and DEV-only mobile/canvas/test POCs.
- `src/components/questionnaire/PdfSignStepWrapper.jsx` (lines 16-46, 80-143) - currently unrendered wrapper evidence
  for scoped PDF-template lookup, per-step `signed_pdfs` replacement, and public versus CPA auth contexts.

#### Existing AWS patterns and integration seams

- `backend/api/auth/cpa-context.ts` (lines 11-62) - fail-closed Cognito/linkage/admin actor resolution; extend the
  linked actor with the stored User name/email needed for audit evidence, never browser-supplied identity.
- `backend/api/contracts/entities.ts` (lines 18-115, 168-180) - strict mutable fields, permissive persisted records,
  source enums, and current internal-field projection.
- `backend/api/contracts/public-questionnaire.ts` (lines 49-128, 131-194) - bounded JSON schemas, revisions,
  QuestionnaireTemplate persisted schema, and safe public projections.
- `backend/api/repositories/questionnaire-template.ts` (lines 9-38) - injected repository and `byVersion` query.
- `backend/api/repositories/pdf-template.ts` (lines 5-39) - permissive PDF-template persisted validation and direct get.
- `backend/api/repositories/submission.ts` (lines 12-75) - exact get, indexed client/year query, guard-row filtering,
  and bounded created-date query.
- `backend/api/services/change-journal.ts` (lines 40-46, 147-170, 256-370) - action limits, conditional-conflict
  mapping, cursor retry, idempotency token, and atomic transaction assembly.
- `backend/api/services/entities.ts` (lines 34-59, 79-153, 171-242) - conditional Put/update helpers, timestamps,
  projections, journal snapshots, and the current active Submission guard behavior.
- `backend/api/services/public-questionnaire.ts` (lines 180-210, 234-299, 340-498) - active guard, reload conflict,
  default template race, completed-template pinning, and atomic Submission+Client+journal mutation blueprint.
- `backend/api/services/files.ts` (lines 175-230, 614-644, 663-817) - extraction of template file references,
  token-scoped PDF-template authorization, CPA signed reads, upload-receipt/ownership validation, and the transitional
  mirror implementation that must not become a self-versioning loop after AWS owns PdfTemplate CRUD.
- `backend/api/routes/entities.ts` (lines 30-109) and `backend/api/routes/public-questionnaire.ts` - authenticated
  wrapper, strict body parsing, path extraction, and JSON response pattern.
- `backend/api/handler.ts` (lines 43-87, 97-177, 188-251) - dependency composition, fail-closed exact route sets,
  shared router registration, and privacy-safe error logging.
- `src/api/http-client.js` (lines 25-61), `aws-client.js` (lines 15-96), `base44Client.js` (lines 20-57), and
  `function-client.js` (lines 1-64) - authenticated refresh/retry transport, entity facade, remaining legacy allowlist,
  and separate unauthenticated public-function client.
- `src/api/file-client.js` (lines 73-187) - completed private upload/read/mirror/ZIP helpers; reuse the upload/read
  portions and remove the active editor's transitional mirror dependency.
- `infra/sst/contracts.ts` (lines 35-40, 46-123, 155-299) - route type, existing GSIs, and exact route inventory.
- `infra/sst/application.ts` (lines 62-106, 157-190, 203-223) - one shared Lambda, Cognito authorizer/scopes,
  same-origin `/api` rewrite, and frontend environment.

#### Test patterns

- `backend/api/__tests__/entity-service.test.ts` (lines 39-127) - injected clocks/IDs/repositories, transaction
  inspection, journal assertions, not-found, and active-guard tests.
- `backend/api/__tests__/public-questionnaire-service.test.ts` (lines 151-356, 408-579) - default/template races,
  pinning, create/update guard conflicts, revisions, archived/cross-client rejection, timestamps, and client changes.
- `backend/api/__tests__/core-cpa-routes.test.ts` (lines 13-207) - Gateway event fixtures, auth-before-validation,
  request/actor mapping, response projections, and no-mutation negative cases.
- `backend/api/__tests__/auth.test.ts` (lines 54-130) - Gateway scope, JWT, linked-user, and admin authorization order.
- `backend/api/__tests__/questionnaire-template-repository.test.ts` (lines 20-60) and
  `pdf-template-repository.test.ts` (lines 17-42) - query pagination/get and malformed-row behavior.
- `backend/api/__tests__/files-service.test.ts` and `files-routes.test.ts` - private template ownership, public scoped
  lookup, mirror conflict, strict routing, and signed URL negative cases.
- `backend/api/__tests__/change-journal-service.test.ts` (lines 32-267) and
  `change-journal-contract.test.ts` (lines 11-122) - all-or-nothing evidence, action bounds, retry, and PdfTemplate
  snapshots.
- `infra/sst/__tests__/contracts.test.ts` (lines 201-299, 398-413) and `tooling/verify_sst_foundation.mjs` - exact
  route count/list/scope and synthetic-only legacy-reader assertions.
- `src/api/__tests__/aws-client.test.js`, `base44-client.test.js`, and `function-client.test.js` - exact client paths,
  legacy delegation currently expected, no-fallback behavior, and public/auth transport separation.
- `src/lib/__tests__/questionnaire-save-queue.test.js`, `questionnaire-steps.test.js`,
  `questionnaire-template.test.js`, `submission-compat.test.js`, and `pdf-api.test.js` - frontend behavioral baseline.

### New Files to Create

- `backend/api/contracts/templates.ts` - strict CPA questionnaire/PDF-template request schemas, persisted projections,
  limits, and archive/version error codes.
- `backend/api/contracts/cpa-workflows.ts` - assisted-save, tax-year, paired status, and restore-conflict contracts.
- `backend/api/services/templates.ts` - atomic questionnaire version activation/history and journaled PdfTemplate
  lifecycle, including private-reference validation orchestration.
- `backend/api/services/cpa-workflows.ts` - CPA-assisted save and atomic dashboard lifecycle operations.
- `backend/api/routes/templates.ts` - Cognito-scoped questionnaire/PDF-template route registration.
- `backend/api/routes/cpa-workflows.ts` - Cognito-scoped assisted-save/year/status/restore routes.
- `backend/api/__tests__/template-service.test.ts` - deterministic service/transaction/version/archive coverage.
- `backend/api/__tests__/template-routes.test.ts` - exact auth, parsing, projection, error, and dispatch coverage.
- `backend/api/__tests__/cpa-workflow-service.test.ts` - assisted-save/audit/revision/lifecycle transaction coverage.
- `backend/api/__tests__/cpa-workflow-routes.test.ts` - compatibility path and protected workflow route coverage.
- `public/brand-image.jpg` and `public/favicon.ico` - byte-preserving local copies of the existing public brand assets.

### Existing Files to Update

- `backend/api/auth/cpa-context.ts`, `backend/api/contracts/entities.ts`, and
  `backend/api/contracts/public-questionnaire.ts` - audit identity, shared field limits/types, exact
  `QuestionnaireTemplate.created_by_email`, and revision projection.
- `backend/api/repositories/{questionnaire-template,pdf-template,submission}.ts` - bounded history/list/accessors and
  guard-aware lookup.
- `backend/api/services/files.ts` - expose/reuse private-reference validation without a second PdfTemplate mutation;
  active/public reads must reject archived templates.
- `backend/api/routes/entities.ts`, `backend/api/handler.ts` - compose/register the new services and exact route sets.
- `infra/sst/contracts.ts`, `infra/sst/foundation-contract.json`, `infra/sst/__tests__/contracts.test.ts`, and
  `tooling/verify_sst_foundation.mjs` - exact authenticated route inventory and live/contract output counts.
- `src/api/aws-client.js`, `src/api/base44Client.js`, and their tests - AWS-only PdfTemplate/functions/workflows and
  Base44 SDK-shaped `{ data }` function results.
- `src/components/dashboard/{QuestionnaireEditor,VersionHistory,ClientRow}.jsx`,
  `src/pages/{CpaFillQuestionnaire,PdfTemplateEditor,ClientsPage}.jsx`, and
  `src/components/dashboard/AddSubmissionModal.jsx` - protected calls, queued save failures, atomic workflow methods,
  and removal of repeated file mirroring.
- `src/components/questionnaire/PdfSignStepWrapper.jsx` and any active signer call sites that still omit
  `client_id + token` from public template lookups - use the existing scoped function client; never weaken the API.
  Harden `PdfSignCanvasOverlay.jsx` too if DEV POCs remain supported, without treating it as production reachability.
- `vite.config.js`, `package.json`, and `package-lock.json` - remove Base44 runtime/plugin dependencies while retaining
  React/Vite behavior and the development POC proxy if still used.
- `src/lib/app-params.js` - remove after its sole runtime consumer (`base44Client.js`) becomes AWS-only; replace any
  remaining `VITE_BASE44_*` function-path use with the constant AWS compatibility path/client.
- `index.html`, `public/manifest.json`, `src/pages/{CpaDashboard,CpaFillQuestionnaire,ClientQuestionnaire}.jsx`, and
  `src/components/questionnaire/WelcomeStep.jsx` - point existing visuals to local brand assets with no layout/copy
  change.
- `README.md`, `AGENTS.md`, and focused existing test files - record the AWS-only facade and actual delivery status.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [DynamoDB transaction APIs](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-apis)
  - Specific section: `TransactWriteItems` atomicity, 100-item/4 MB limits, idempotency, and GSI propagation.
  - Why: template activation, paired statuses, restores, and CPA saves must couple all business and journal writes.
- [DynamoDB condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html#Expressions.ConditionExpressions.ConditionalPut)
  - Specific section: conditional Put/update behavior.
  - Why: guards against duplicate active versions, stale revisions, and competing restore/status actions.
- [DynamoDB global secondary indexes](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html#GSI)
  - Specific section: key/projection and eventual-consistency constraints.
  - Why: the existing `byVersion`/`byCreatedDate` indexes support bounded history/listing, but must not be trusted as
    the concurrency authority immediately after a mutation.
- [SST Dynamo global indexes](https://sst.dev/docs/component/aws/dynamo/#globalindexes) and
  [SST ApiGatewayV2 add routes](https://sst.dev/docs/component/aws/apigatewayv2/#add-routes)
  - Why: keep index/route additions in the existing SST component contract and shared Lambda.
- [SST Function resource linking](https://sst.dev/docs/component/aws/function/#link-resources)
  - Why: confirm the new services use the already-linked tables/buckets rather than a new deployment boundary.
- [AWS S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html#using-presigned-url)
  and [SST Bucket linking](https://sst.dev/docs/component/aws/bucket/#link-the-bucket-to-a-resource)
  - Why: PDF base bytes remain bearer URLs scoped by exact method, headers, caller, record reference, and role lifetime.
- [pdfme template shape](https://pdfme.com/docs/getting-started#template) and
  [pdfme plugin registry](https://pdfme.com/docs/custom-schemas#using-schemas-from-pdfmeschemas)
  - Why: round-trip `basePdf + schemas + fieldMapping` without changing supported schema plugins between Designer and
    Lambda. The root is pinned to 6.1.1 while the Lambda lock may resolve 6.1.6; test the stored contract rather than
    assuming package equivalence.

### Patterns to Follow

**Naming Conventions:** PascalCase React pages/components with default exports; kebab-case pure helpers; TypeScript
backend classes named by domain (`TemplateService`, `CpaWorkflowService`); Zod schemas use `<operation>Schema`;
routes/services/repositories stay in their existing folders. Do not edit `src/components/ui/`.

**Conditional/journal mutation pattern:** mirror `EntityService` and `PublicQuestionnaireService`; build the entire
next record, condition on the persisted `_version` or missing guard, and submit business actions plus one before/after
change per mutated business record to the existing coordinator:

```ts
await journal.commit({
  actorId: actor.userId,
  requestId,
  operationId,
  businessActions: [conditionalUpdate(tableName, after, before._version)],
  changes: [{ entityType: "Submission", entityKey: before.id, operationType: "update", before, after }],
});
```

Do not pre-read and then issue independent writes. The GSI is eventually consistent; the strongly addressed guard
and conditional transaction decide version/activation conflicts.

**Route pattern:** use the shared `authenticated` wrapper and `parseJsonBody`; resolve IDs from path parameters and
return the existing `jsonResponse` shape. Every new route must appear in `infra/sst/contracts.ts`, the handler's exact
allowlist, the registered router, the contract JSON, tests, and the live verifier.

```ts
router.register("POST /cpa/...", authenticated(async (event, actor) =>
  jsonResponse(200, await service.operation(actor, event.requestContext.requestId,
    parseJsonBody(event, operationSchema))),
));
```

**Function facade pattern:** authenticated `base44.functions.invoke(name, payload)` returns `{ data: body }` so
existing `.data.template`, `.data.connected`, and Drive-result access remains valid. Entity methods return bare
records/arrays. Public questionnaire/signing routes continue through `function-client.js` without an Authorization
header. An AWS error is final and must never fall back to Base44.

**Questionnaire version pattern:** store an internal, non-entity guard item at a fixed primary key containing the
current active template ID/version. Initialize it conditionally from the current active/default template when absent;
then save by conditionally replacing the guard, deactivating exactly the guarded prior record, creating version + 1,
and journaling both QuestionnaireTemplate changes. Reject inconsistent/multiple-active imported state rather than
partially repairing it; issue #11 owns import reconciliation.

**PDF-template lifecycle pattern:** parse and validate `template_json` as bounded JSON but preserve its serialized
bytes/shape in storage. Extract the `basePdf` file reference, authorize the completed upload receipt/owner/purpose via
the existing file-service helper, and write `template_json`, `file_reference`, name, active flag, timestamps, and
version once in the PdfTemplate mutation. Do not call the transitional mirror after each AWS create/update: using the
same record's `_version` as `source_version` would generate a self-incrementing loop.

**Error Handling:** use `ApiError` helpers and safe public messages. Invalid input is 400; missing/archived resources
are 404; invalid CPA auth is 401/403; stale revisions, conditional races, active-version conflicts, and restore
conflicts are 409. Assisted-save archive/replacement conflicts include `reload: true`; the UI reloads/stops navigation.
Unexpected failures log only request ID and normalized class, never tokens, names, answers, template JSON, file
references, signed URLs, or journal snapshots.

**Logging Pattern:** retain `handler.ts`'s aggregate failure log. No new success/body logging is needed. Tests use
synthetic IDs and contents only.

**Compatibility constraints:** expose `revision` as an additive CPA Submission projection while keeping `_version`
internal for Client/Submission. PdfTemplate CPA projections may retain `_version` because the existing SDK-shaped
editor/file seam already requires that metadata. Server-owned CPA audit email/name comes only from the linked User.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts, repository capabilities, and concurrency guards

Define bounded request/persistence/projection contracts, add CPA audit identity to the resolved actor, and extend the
three repositories with only the indexed/strong reads required by the feature. Establish the internal questionnaire
active/version guard and reusable conditional action builders without changing UI behavior.

**Tasks:**

- Add template and CPA-workflow Zod schemas with source enums/JSON limits and strict unknown-field rejection.
- Add bounded questionnaire history and active/list/get PdfTemplate repository methods using current GSIs.
- Add a safe `revision` projection for CPA Submission reads and persisted audit/template fields.
- Add/characterize guard initialization and conditional conflict behavior before service integration.

### Phase 2: Journaled template services and protected routes

**Depends on:** Phase 1.

Implement atomic questionnaire version activation/history and PDF-template list/create/update/archive. Reuse private
file receipt/object validation so one PdfTemplate business mutation owns both JSON and file pointer. Register and
test exact Cognito-scoped routes in the shared Lambda and SST contract.

**Tasks:**

- Implement active/history/detail/save questionnaire operations and atomic single-active version advancement.
- Implement active-only PDF lists, detail, create, update, archive, and public archived rejection.
- Preserve completed Submission template pins; new/in-progress saves resolve the current guarded active template.
- Register protected routes, dependencies, route scopes, contract inventories, and verifier assertions.

### Phase 3: CPA-assisted save and dashboard lifecycle transactions

**Depends on:** Phase 1 and the template selection API from Phase 2.

Implement authenticated CPA save with serialized audit data, optimistic revision, active client/year guard, and
Client status/last_activity updates. Add server-owned tax-year selection, atomic restore-with-conflict swap, and paired
ready/reviewed transitions so one user action cannot leave Client and Submission out of sync.

**Tasks:**

- Add exact protected `cpaSaveSubmission` compatibility routing with actor-derived audit identity.
- Add revision-aware FIFO save responses/conflicts and preserve template selection/pinning.
- Add journaled tax-year, restore/swap, and paired status operations with server-side relationship validation.
- Retain generic single-record archive/client update paths where they already express one logical mutation.

### Phase 4: Frontend facade and workflow integration

**Depends on:** Phases 2 and 3.

Map every remaining reachable template/workflow call to AWS while preserving current component structure and visible
behavior. Use the authenticated HTTP client for CPA functions and the token-scoped public client for signing.

**Tasks:**

- Replace QuestionnaireEditor/VersionHistory raw fetches and legacy active-template calls with protected facade calls.
- Migrate PdfTemplate entity CRUD to AWS and remove repeated mirror calls after AWS-owned writes.
- Migrate CPA-assisted saves to the Cognito transport, carry revisions, stop navigation on conflict, and use the
  completed Submission's pinned template.
- Replace browser `Promise.all` multi-record lifecycle updates with atomic workflow endpoints.
- Ensure every active public PDF lookup includes `client_id + token + template_id`; CPA mode uses protected reads.

### Phase 5: Remove the final Base44 runtime boundary and preserve static visuals

**Depends on:** Phase 4.

Remove the SDK/plugin only after tests prove the legacy method map is empty. Localize the exact existing public brand
assets and update runtime references. Leave provenance code/data and migration export tooling unchanged.

**Tasks:**

- Make `base44Client.js` AWS-only, with no catch-based or readiness-agent fallback.
- Remove Base44 packages and Vite plugin configuration; keep ordinary React/Vite and local POC behavior.
- Add local brand image/favicon bytes and replace all production/runtime `media.base44.com` references.
- Update README/AGENTS migration status without claiming issue #11 or production readiness.

### Phase 6: Regression, full validation, and gated synthetic acceptance

**Depends on:** Phases 1-5.

Run focused frontend/backend tests after each task, then the complete local suites and read-only SST diff. Deployment,
test users/data, and live browser acceptance occur only under separate explicit owner authorization and remain
synthetic-only with legacy reads disabled.

**Tasks:**

- Complete the AC-traced unit, route, transaction, security, facade, and characterization matrix.
- Run Node 20.17.0 full validation and compare inherited frontend diagnostics with the recorded baseline.
- Inspect the test-stage diff for route-only/Lambda/site asset changes and no stateful replacement.
- If explicitly authorized, deploy the complete test stage and execute the CPA/template/PDF/manual negative matrix.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. REVALIDATE issue, architecture, dependency evidence, branch, and protected boundaries

- **READ**: issue #10, epic #1, the Wiki PRD/architecture, issues/reports #6-#9, all six AuditFlow reference contracts,
  current `main`, and the active branch diff.
- **VERIFY**: issues #6-#9 remain merged/closed and the source repository is unchanged/read-only. Confirm the #9
  live synthetic acceptance and #11 legacy-read gate are still current.
- **GOTCHA**: Issue closure does not authorize production actions. Do not interpret the current test deployment as
  permission to deploy this change, create users, seed DynamoDB, or enable legacy reads.
- **VALIDATE**: `git status --short --branch; git log --oneline --decorate -20; python tooling/github.py issue view 10 --repo noamtz/cpa-platform --json number,title,body,state,url`
- **SATISFIES**: AC #1-#7 planning and scope traceability.

### 2. CREATE strict template and CPA-workflow contracts; UPDATE shared persisted/projection contracts

- **CREATE**: `backend/api/contracts/templates.ts` and `backend/api/contracts/cpa-workflows.ts`.
- **UPDATE**: `backend/api/contracts/entities.ts` and `backend/api/contracts/public-questionnaire.ts` only enough to
  share the canonical persisted Submission/QuestionnaireTemplate shapes and expose an additive CPA `revision`.
- **IMPLEMENT**: bounded IDs/names/timestamps, nonempty questionnaire step array with required `id/title/question`,
  bounded JSON strings, source response/status enums, version/history projection, PDF create/update/archive inputs,
  CPA save input (`client_id`, optional submission/revision, step/data/completed), tax-year input, paired workflow
  status input, and restore conflict input.
- **IMPLEMENT**: add optional persisted `created_by_email` to QuestionnaireTemplate and require the protected history
  projection to return it (with a safe fallback for imported rows that predate it), because VersionHistory renders
  that exact field.
- **PATTERN**: `backend/api/contracts/public-questionnaire.ts:49-128` for strict inputs/JSON bounds and
  `contracts/entities.ts:31-115` for permissive legacy persisted reads plus strict mutations.
- **GOTCHA**: Do not accept `created_by`, timestamps, `_version`, CPA email/name, file keys, Client status, or template
  identity as authoritative browser fields. Preserve `responses`, `signed_pdfs`, and `cpa_audit_log` as strings.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/entity-contracts.test.ts backend/api/__tests__/public-questionnaire-contracts.test.ts backend/api/__tests__/change-journal-contract.test.ts`
- **SATISFIES**: AC #2, #4, #6, #7.

### 3. UPDATE CPA actor identity and repository access patterns

- **UPDATE**: `backend/api/auth/cpa-context.ts`, User repository test fixtures, and
  `backend/api/repositories/{questionnaire-template,pdf-template,submission}.ts` plus focused tests.
- **IMPLEMENT**: resolve stored User email/full name into immutable `CpaActor`; add strongly addressed questionnaire
  guard get, bounded descending history/latest-version queries, active-only/all PdfTemplate list by `byCreatedDate`,
  and exact active client/year Submission lookup that always skips guard rows.
- **PATTERN**: `backend/api/repositories/dynamo.ts` query helper and current repository tests; `cpa-context.ts:27-62`
  authorizes Gateway scope/JWT/link/admin before returning actor context.
- **GOTCHA**: A GSI is eventually consistent and cannot establish mutation correctness. Use it for display/history;
  use primary-key guard reads and conditional transaction writes for activation. Do not add an index unless existing
  `byVersion`/`byCreatedDate` cannot execute an evidenced access pattern.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/auth.test.ts backend/api/__tests__/questionnaire-template-repository.test.ts backend/api/__tests__/pdf-template-repository.test.ts backend/api/__tests__/submission-repository.test.ts`
- **SATISFIES**: AC #1, #2, #4, #7.

### 4. CREATE atomic questionnaire-template history and activation service

- **CREATE**: questionnaire operations in `backend/api/services/templates.ts` and their cases in
  `backend/api/__tests__/template-service.test.ts`.
- **IMPLEMENT**: read active template, list at most 100 versions descending, read exact historical version, and save
  a new version. Initialize a fixed guard conditionally when absent; save must condition on that guard/prior record,
  deactivate the guarded active record, create version + 1 with JSON steps/creator/timestamps, replace the guard, and
  journal both QuestionnaireTemplate changes in the same `ChangeJournalService.commit`.
- **IMPLEMENT**: persist `created_by_email` from `CpaActor.email` on the new version and return it unchanged in the
  source-compatible history projection; never accept it from the request body.
- **IMPLEMENT**: coordinate the existing default seed in `PublicQuestionnaireService` with the same guard contract so
  a concurrent public first load and CPA save cannot produce two active version-1 records.
- **PATTERN**: `public-questionnaire.ts:234-278` for seed-race reread; `entities.ts:34-59` for conditional actions;
  `change-journal.ts:256-370` for all-or-nothing mutation and 409 mapping.
- **GOTCHA**: Do not reproduce the source's independent deactivate/create writes. Respect the 100-action/4 MB
  transaction and journal limits. If imported state has multiple active templates or cannot fit a bounded repair,
  fail closed and surface reconciliation to #11 instead of partially changing it.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/template-service.test.ts backend/api/__tests__/public-questionnaire-service.test.ts backend/api/__tests__/change-journal-service.test.ts`
- **SATISFIES**: AC #1, #2, #6, #7.

### 5. ADD journaled PdfTemplate lifecycle integrated with private-file validation

- **UPDATE**: `backend/api/services/templates.ts`, `backend/api/services/files.ts`, and corresponding template/file
  service tests.
- **IMPLEMENT**: active-only list/detail, create, update, and archive. Preserve exact `template_json`; validate it as
  a pdfme template without rewriting it; extract `basePdf` `{__type:"file_uri",value}`; verify the completed upload
  receipt, `application/pdf` purpose/owner metadata, and allowed template/pending prefix before the database mutation.
  Store `file_reference` with the same journaled PdfTemplate write.
- **IMPLEMENT**: archive by setting `is_active:false`, `updated_date`, and `_version + 1`; keep the UI's delete result
  shape and hide archived templates from normal editor/questionnaire lists. Make public `getPdfTemplateById` and
  template file reads return 404 for archived/unreferenced records.
- **REFACTOR**: make the transitional file mirror helper reusable for validated legacy/import evidence but remove it
  from active AWS CRUD. Do not update PdfTemplate twice or feed its `_version` back into `source_version`.
- **PATTERN**: `files.ts:663-817` for receipt/S3 ownership validation and conditional journal behavior;
  `PdfTemplateEditor.jsx:575-598` for exact stored pdfme/fieldMapping shape.
- **GOTCHA**: Do not accept a caller-supplied arbitrary S3 key/URL. Do not delete versioned bytes on archive. Do not
  expose a public all-active endpoint; token-scoped signing authorizes the exact referenced template.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/template-service.test.ts backend/api/__tests__/files-service.test.ts backend/api/__tests__/files-contract.test.ts backend/api/__tests__/pdf-template-repository.test.ts`
- **SATISFIES**: AC #1, #2, #3, #6, #7.

### 6. CREATE protected template routes and synchronize SST/handler inventories

- **CREATE**: `backend/api/routes/templates.ts` and `backend/api/__tests__/template-routes.test.ts`.
- **UPDATE**: `backend/api/handler.ts`, `infra/sst/contracts.ts`, `infra/sst/foundation-contract.json`,
  `infra/sst/__tests__/contracts.test.ts`, and `tooling/verify_sst_foundation.mjs`.
- **IMPLEMENT**: exact Cognito-scoped CPA routes for questionnaire active/history/detail/save and PDF-template
  list/detail/create/update/archive. Inject repositories/journal/file validation through the existing composition root.
- **PATTERN**: `routes/entities.ts:30-109`, `application.ts:157-183`, and exact existing route assertions.
- **GOTCHA**: Keep the single Lambda/API. Every route gets `auditflow-api/cpa`; no catch-all route and no anonymous
  admin route. Update route totals/status output everywhere, including any stale verifier count label.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/template-routes.test.ts backend/api/__tests__/auth.test.ts backend/api/__tests__/router.test.ts infra/sst/__tests__/contracts.test.ts && node tooling/verify_sst_foundation.mjs --mode contract --stage test`
- **SATISFIES**: AC #1, #2, #3, #6, #7.

### 7. CREATE revision-aware CPA-assisted submission save

- **CREATE**: assisted-save logic in `backend/api/services/cpa-workflows.ts` and deterministic coverage in
  `backend/api/__tests__/cpa-workflow-service.test.ts`.
- **IMPLEMENT**: authorize linked CPA actor; load nonarchived Client; derive current tax year; resolve the exact active
  Submission by supplied ID/client/year or create one with the current guarded template; parse prior audit log
  fail-soft; append `{cpa_email,cpa_name,step_id|null,timestamp,action:"fill"|"complete"}`; preserve provided bounded
  questionnaire fields; update Client `last_activity` and `status`; create/update active guard as needed; journal
  Submission and Client in one transaction; return `{submission, audit_entry}` with additive `revision`.
- **IMPLEMENT**: for an existing completed Submission, preserve its stored `template_id/template_version`; for a new
  or in-progress Submission, server-select the active guarded template. Ignore conflicting browser template metadata.
- **PATTERN**: `public-questionnaire.ts:340-498` for create/update/guard/client transaction and reload conflicts;
  source `cpaSaveSubmission:27-83` for audit/status response behavior.
- **GOTCHA**: Reject missing, archived, replaced, cross-client, cross-year, or stale submissions with 404/409 and no
  journal entry. Do not repeat the source quirk of updating an arbitrary first archived submission; the target active
  guard and issue conflict requirements take precedence as an intentional security/consistency hardening.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/cpa-workflow-service.test.ts backend/api/__tests__/public-questionnaire-service.test.ts backend/api/__tests__/entity-service.test.ts backend/api/__tests__/change-journal-service.test.ts`
- **SATISFIES**: AC #1, #2, #4, #6, #7.

### 8. ADD atomic tax-year, restore-conflict, and paired workflow-status operations

- **UPDATE**: `backend/api/services/cpa-workflows.ts` and its service tests.
- **IMPLEMENT**:
  - Tax-year selection validates the year, reads the target year's Submission, and writes Client `tax_year` plus
    `status = target.cpa_status || "pending"` in one journaled Client mutation.
  - Restore without conflict conditionally unarchives the selected Submission and installs its active guard.
  - Restore with `conflicting_submission_id` verifies both records share client/year and expected archive states,
    archives the current active record, unarchives the selected record, replaces the guard, and journals both in one
    transaction. A changed/missing conflict returns 409/reload.
  - Status transition verifies Client/Submission relationship/current year and atomically writes both
    `ready_for_ira` or both `reviewed`, with two journal entries under one operation.
- **PATTERN**: `EntityService.updateSubmission:171-242` for guard state; ClientRow/ClientsPage conflict dialog behavior
  for visible choices; `ChangeJournalService.commit` for one operation/multiple entities.
- **GOTCHA**: Do not trust the browser to name unrelated records or set asymmetric statuses. Preserve the
  keep-existing conflict choice as no mutation. Single Submission archive and single Client archive/restore may keep
  using existing strict PATCH routes because each is already one journaled logical mutation.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/cpa-workflow-service.test.ts backend/api/__tests__/entity-service.test.ts backend/api/__tests__/submission-repository.test.ts`
- **SATISFIES**: AC #1, #4, #6, #7.

### 9. CREATE protected CPA workflow routes including the compatibility save path

- **CREATE**: `backend/api/routes/cpa-workflows.ts` and `backend/api/__tests__/cpa-workflow-routes.test.ts`.
- **UPDATE**: `backend/api/handler.ts`, SST route contracts/JSON/tests/verifier from Task 6.
- **IMPLEMENT**: register the existing direct
  `POST /apps/{appId}/functions/cpaSaveSubmission` path with Cognito JWT/scope, plus explicit protected tax-year,
  restore, and paired-status routes. Compose `CpaWorkflowService` with Client/Submission/Template repositories and
  journal. Return exact Base44-compatible success and safe error bodies.
- **PATTERN**: `core-cpa-routes.test.ts:13-207` for event/auth/request-ID assertions and
  `public-questionnaire-routes.test.ts` for compatibility function route shapes.
- **GOTCHA**: Although its URL is legacy-shaped, `cpaSaveSubmission` belongs in the protected CPA route set, not the
  anonymous public-function set. API Gateway authorization must run before body parsing/service calls.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/cpa-workflow-routes.test.ts backend/api/__tests__/core-cpa-routes.test.ts backend/api/__tests__/auth.test.ts infra/sst/__tests__/contracts.test.ts && node tooling/verify_sst_foundation.mjs --mode contract --stage test`
- **SATISFIES**: AC #1, #4, #6, #7.

### 10. UPDATE AWS client and compatibility facade to expose all protected operations

- **UPDATE**: `src/api/aws-client.js`, `src/api/base44Client.js`,
  `src/api/__tests__/aws-client.test.js`, and `src/api/__tests__/base44-client.test.js`.
- **IMPLEMENT**: AWS PdfTemplate list/create/update/archive entity methods; protected function mappings for active
  questionnaire template, history/detail/save, CPA save, tax year, restore, and paired status. Encode path IDs and
  use `createHttpClient` so Cognito refresh/retry applies. Wrap function results as `{ data: body }`; keep entity
  results bare. Add a protected CPA PDF-template get/list method where CPA callers must not use public credentials.
- **REMOVE**: all legacy delegation and catch-based fallback from the runtime facade. An unsupported/dormant function
  throws the controlled local `Not implemented`/unsupported error and performs no external request.
- **PATTERN**: `aws-client.js:15-96` and `http-client.js:25-61`.
- **GOTCHA**: Keep `function-client.js` unauthenticated and token-scoped for public pages. Do not attach a Cognito
  token to public function calls or use `localStorage.base44_access_token` as authentication. Public pages may retain
  the current removal of stale Base44 session keys as backwards-safe cleanup.
- **VALIDATE**: `npx vitest run src/api/__tests__/aws-client.test.js src/api/__tests__/base44-client.test.js src/api/__tests__/http-client.test.js src/api/__tests__/function-client.test.js`
- **SATISFIES**: AC #1, #2, #3, #4, #6, #7.

### 11. UPDATE questionnaire editor, history, and PDF-template editor integrations

- **UPDATE**: `QuestionnaireEditor.jsx`, `VersionHistory.jsx`, and `PdfTemplateEditor.jsx`.
- **IMPLEMENT**: replace raw admin function fetches with protected facade calls and preserve response parsing/toasts,
  version display, zero-based step reorder behavior, default-step disable rule, and read-only history. Use AWS
  PdfTemplate active list/CRUD. On create/update, upload the private base PDF first, then make one template mutation
  that stores/validates its reference; do not call the transitional mirror after load/save.
- **IMPLEMENT**: keep the current delete confirmation/toast but map it to archive so it disappears from normal lists
  and becomes unavailable to new signing flows. Existing completed submissions remain able to resolve a previously
  pinned questionnaire version, but an archived PDF template must not be newly selected.
- **PATTERN**: current component UI/layout and `file-client.js:73-163` for direct private upload/signed read.
- **GOTCHA**: Preserve pdfme container height and lazy load. Round-trip binary/reference `basePdf`, schemas, and
  `fieldMapping`; do not save a schema plugin unsupported by the Lambda. Avoid orphaning an uploaded object on a
  failed database write; return a safe reconciliation signal and rely on versioned lifecycle cleanup rather than
  silently deleting evidence.
- **VALIDATE**: `npx eslint src/components/dashboard/QuestionnaireEditor.jsx src/components/dashboard/VersionHistory.jsx src/pages/PdfTemplateEditor.jsx src/api/aws-client.js src/api/base44Client.js --quiet --no-error-on-unmatched-pattern && npx vitest run src/api/__tests__/aws-client.test.js src/api/__tests__/base44-client.test.js src/lib/__tests__/questionnaire-template.test.js src/lib/__tests__/pdf-api.test.js`
- **SATISFIES**: AC #1, #2, #3, #5, #6, #7.

### 12. UPDATE CPA-assisted questionnaire integration and pinning/conflict behavior

- **UPDATE**: `src/pages/CpaFillQuestionnaire.jsx` and focused frontend characterization tests/helpers as needed.
- **IMPLEMENT**: remove raw Base44 token/fetch; call protected CPA active/detail/save methods; on load use the completed
  Submission's pinned template and otherwise active; retain active-step/year/osek filtering and first-unanswered
  resume. Carry acknowledged `revision` in the save queue, update it only on success, and stop/reload rather than move
  forward when the API returns a 409 reload conflict.
- **IMPLEMENT**: preserve exact CPA exemption/undo record shapes, audit display, completion time, serialized responses,
  scroll/navigation, and saving indicator. Await completion before rendering the done screen so a failed final save
  is not shown as complete.
- **PATTERN**: `ClientQuestionnaire.jsx` plus `questionnaire-save-queue.js` for acknowledged FIFO writes and
  `public-questionnaire.ts:408-498` for pinning/revision semantics.
- **GOTCHA**: The source advanced optimistically and swallowed a non-OK save; preserving data/audit integrity and the
  ticket's conflict behavior requires the minimal navigation guard already used by the migrated public flow. Do not
  expose CPA identity in the payload.
- **VALIDATE**: `npx eslint src/pages/CpaFillQuestionnaire.jsx --quiet --no-error-on-unmatched-pattern && npx vitest run src/lib/__tests__/questionnaire-save-queue.test.js src/lib/__tests__/questionnaire-steps.test.js src/lib/__tests__/questionnaire-template.test.js src/lib/__tests__/submission-compat.test.js`
- **SATISFIES**: AC #1, #2, #4, #5, #6, #7.

### 13. UPDATE dashboard/client lifecycle callers to use atomic workflows

- **UPDATE**: `ClientRow.jsx`, `ClientsPage.jsx`, and `AddSubmissionModal.jsx`.
- **IMPLEMENT**: replace ClientRow/AddSubmissionModal direct tax-year/status pair with server-owned tax-year selection;
  replace both restore `Promise.all` paths with the atomic restore endpoint; replace both Client+Submission status
  `Promise.all` paths with paired status endpoint. Keep confirmations, prompts, conflict dialog choices, toasts,
  refresh timing, archive actions, orphan-status reset, file/ZIP controls, and visual status precedence unchanged.
- **IMPLEMENT**: verify the Drive button and Settings controls surface the controlled AWS `Not implemented` result
  with loading cleared; do not change copy or contact Drive/Telegram.
- **PATTERN**: current component behavior at the cited line ranges and existing generic single-record entity facade.
- **GOTCHA**: Server validation, not the browser query, is authoritative for conflict IDs/client/year/status. Do not
  merge client archive with submission archive or create a Submission in AddSubmissionModal; first save still creates.
- **VALIDATE**: `npx eslint src/components/dashboard/ClientRow.jsx src/pages/ClientsPage.jsx src/components/dashboard/AddSubmissionModal.jsx src/pages/Settings.jsx --quiet --no-error-on-unmatched-pattern && npm test`
- **SATISFIES**: AC #1, #4, #5, #6, #7.

### 14. FIX remaining scoped public PDF-template call sites without weakening authorization

- **UPDATE**: the production-mounted `PdfSignIframeOverlay.jsx` as required, and retained non-production callers that
  call `getPdfTemplateById` with only `template_id`: the currently unrendered `PdfSignStepWrapper.jsx`, unmounted
  legacy `PdfSignPage.jsx`, DEV-only `PdfSignPageMobile.jsx`, `PdfSignCanvasOverlay.jsx`, and `PdfSignTest.jsx`, plus
  `PdfFormStep.jsx` where the legacy app ID is still passed into base-PDF resolution.
- **IMPLEMENT**: public callers pass `client_id`, token, and template ID to `loadPublicPdfTemplate`; authenticated CPA
  tooling uses the protected CPA read method. Preserve per-step signed record replacement, required fields, field
  mapping, incomplete/exempt paths, upload-before-save order, and same-origin SST render/generate endpoint.
- **PATTERN**: `FileService.authorizedPublicPdfTemplate:629-644`, `function-client.js:63-64`, and the already verified
  `PdfSignIframeOverlay` transport.
- **GOTCHA**: Do not restore source's unauthenticated arbitrary template lookup or make the unmounted/DEV harness
  routes production reachable. Production acceptance is required for the iframe route only; retained POCs get
  contract/static coverage and may require explicit synthetic credentials. Never hard-code real tokens.
- **VALIDATE**: `npx eslint src/components/questionnaire/PdfFormStep.jsx src/components/questionnaire/PdfSignStepWrapper.jsx src/pages/PdfSignPage.jsx src/pages/PdfSignPageMobile.jsx src/pages/PdfSignCanvasOverlay.jsx src/pages/PdfSignIframeOverlay.jsx src/pages/PdfSignTest.jsx --quiet --no-error-on-unmatched-pattern && npm run test:pdf && npx vitest run src/api/__tests__/function-client.test.js src/api/__tests__/file-client.test.js src/lib/__tests__/pdf-api.test.js`
- **SATISFIES**: AC #1, #3, #5, #7.

### 15. REMOVE Base44 runtime packages/plugin and LOCALIZE brand assets

- **UPDATE**: `vite.config.js`, `package.json`, `package-lock.json`, `index.html`, `public/manifest.json`, all runtime
  `media.base44.com` image callers, `README.md`, and `AGENTS.md` status.
- **REMOVE**: `src/lib/app-params.js` and its facade test mocks once its only consumer is gone; remove remaining
  `VITE_BASE44_*` and `BASE44_LEGACY_SDK_IMPORTS` runtime configuration/call-site dependencies. Retain public-route
  `localStorage.removeItem("base44_access_token")` cleanup where it prevents stale legacy auth state from leaking
  into a token-based journey; cleanup-only key removal is not a network/runtime dependency.
- **CREATE**: `public/brand-image.jpg` and `public/favicon.ico` from the exact currently referenced public bytes;
  record only safe hashes/dimensions in validation evidence.
- **REMOVE**: `@base44/sdk`, `@base44/vite-plugin`, plugin options/notifiers, legacy runtime initialization, and the
  readiness-agent facade delegation. Retain `base44/` source evidence and `tooling/base44_export_bridge.ts` because
  migration tooling is not part of the browser/runtime bundle.
- **PATTERN**: architecture Compatibility Boundary and Data Model decisions; retain `@vitejs/plugin-react` and all
  non-Base44 Vite configuration.
- **GOTCHA**: `rg @base44` is expected to keep documentation/provenance/export-tool hits. The pass condition is no
  browser build/runtime import, plugin, network URL, or bundled dependency. Do not delete migration evidence.
- **VALIDATE**: `npm ci; npm run build; rg -n "@base44|media\.base44\.com|https?://[^ ]*base44\.|VITE_BASE44|BASE44_LEGACY" src/api src/pages src/components src/lib index.html public vite.config.js package.json; if ($LASTEXITCODE -eq 0) { exit 1 } elseif ($LASTEXITCODE -ne 1) { exit $LASTEXITCODE }`
- **SATISFIES**: AC #1, #3, #5.

### 16. ADD the complete AC-traced regression and authorization matrix

- **UPDATE/CREATE**: all new tests above plus existing auth, handler, entity, public questionnaire, file, facade,
  foundation contract, questionnaire helper, and PDF tests.
- **IMPLEMENT**: prove success and no-mutation failure for:
  - Questionnaire versions: validation, order, history count, one active, default/save race, concurrent save,
    monotonic version, exact `created_by_email`, journal entries, completed pinning, and in-progress active selection.
  - PdfTemplate: list/create/update/archive, exact JSON/reference round-trip, receipt/ownership, archived public denial,
    unreferenced/cross-client denial, mutation conflict, no mirror loop, and journal snapshots.
  - CPA save: actor identity, first create, existing update, malformed prior audit log, FIFO revisions, completion,
    timestamps/status, pinned/current template choice, active guard collision, archived/replaced/cross-client/year/stale
    conflicts, 401/403/400/404/409/500, and zero journal on rejection.
  - Lifecycle: year derivation, simple restore, changed/missing conflict, two-record swap, paired ready/reviewed status,
    condition races, exact before/after journal entries, and no partial writes.
  - Frontend: exact paths/methods/wrappers/encoding, Cognito refresh, no Base44 fallback, save navigation guard,
    public token credentials, and unchanged questionnaire/status helper behavior.
- **GOTCHA**: Use invented records/content only. Assert logs do not contain names, tokens, answers, template JSON,
  filenames, object refs, signed URLs, or journal payloads. Do not assert deployment/live success from unit fakes.
- **VALIDATE**: `npm test && npm run test:foundation && npm run test:pdf`
- **SATISFIES**: AC #1-#7.

### 17. RUN full local validation and inspect the read-only test-stage diff

- **RUN**: Node 20.17.0 clean install; frontend/foundation tests; both typechecks/lints; build; contract verifier;
  Codex-layer validator; source-manifest verifier if touched asset/provenance checks require it; and diff whitespace.
- **COMPARE**: full frontend typecheck/lint against `docs/migration/auditflow-source-baseline.md` and the latest merged
  reports. Existing unrelated diagnostics may remain, but no new diagnostic may occur in a touched path.
- **INSPECT**: `npm run sst:diff:test` for shared Lambda code, protected routes, and static asset changes only. A table,
  bucket, Cognito, PDF function, permissions-boundary, Terraform, production, or legacy-read-mode replacement/change
  is a hard stop unless explicitly explained by an already approved contract change.
- **VALIDATE**: `npm ci; npm test; npm run typecheck; npm run lint; npm run build; npm run test:foundation; npm run typecheck:foundation; npm run lint:foundation; npm run test:pdf; node tooling/verify_sst_foundation.mjs --mode contract --stage test; python tooling/validate_codex_layer.py; git diff --check; npm run sst:diff:test`
- **SATISFIES**: AC #1-#7.

### 18. PERFORM owner-authorized synthetic test-stage acceptance and record aggregate evidence

- **PRECONDITION**: obtain explicit authorization for this exact deployment, synthetic data/users, and live browser
  exercise. Without it, record the gate as not run; local completion remains honest and does not imply live acceptance.
- **RUN**: deploy the complete test stage, run the live foundation verifier, and use disposable synthetic Client,
  Submission, questionnaire versions, PDF templates/files, and both authorized/unauthorized actor cases.
- **VERIFY**: editor version save/history/activation; completed pinning/new active selection; PDF template create/edit/
  archive and private base load; CPA fill/resume/exemption/completion/audit; tax-year switch; submission archive/simple
  restore/conflict keep/swap; ready/reviewed transitions; Drive/Telegram controlled deferrals; desktop render/sign/
  upload/save/refresh/reopen. If mobile signing is rechecked, report the actual browser context only.
- **NEGATIVE**: anonymous/wrong-scope CPA routes, arbitrary/cross-client template, archived submission/template, stale
  revision, concurrent activation/restore, and legacy references all fail without signed URLs or partial writes.
- **CLEANUP**: archive/remove only the exact synthetic fixtures through journaled supported paths; do not enable legacy
  reads or touch production/Base44/Terraform/DNS.
- **VALIDATE**: `npm run sst:deploy:test; node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json`
- **SATISFIES**: AC #1-#7 live acceptance.

---

## TESTING STRATEGY

### Unit Tests

- Contract tests parse every accepted source-shaped request and reject missing, unknown, oversized, wrong-type, and
  server-owned fields before repositories/S3/journal are called.
- Repository tests use fake AWS SDK commands to assert exact table/index/key/limit/order/filter expressions, guard-row
  exclusion, pagination, archived filtering, and malformed persisted row failure.
- Template service tests inject clock/ID/operation IDs and inspect every transaction action and journal change.
  Concurrent activation simulates conditional cancellation and proves one winner, one active record, and no duplicate
  version. Default seed/save concurrency uses the same guard.
- PdfTemplate tests validate exact serialized round-trip, owned/pending reference receipts and metadata, no arbitrary
  URI, no repeated mirror version loop, soft archive, active-only lists, and public 404 after archive.
- CPA workflow tests inject actor/repositories/journal. Assert exact audit entry, fail-soft old log, revision changes,
  status/time behavior, active guard, pinned template, multi-record operations, and all-or-nothing conflict behavior.
- Frontend API tests inject auth/fetch and assert paths, URL encoding, Authorization separation, one refresh retry,
  `{ data }` wrapping, bare entity results, and no Base44 call/import/fallback.

### Integration Tests

- Build the assembled handler with fake dependencies and dispatch exact API Gateway v2 events for every new protected
  route. Assert API Gateway/JWT scope is required, actor resolution precedes body parsing, request IDs reach journal
  operations, and unknown/anonymous paths fail closed.
- Exercise questionnaire save → active read → history/detail → completed Submission pinned read → new/in-progress active
  read as one service-level journey.
- Exercise PDF upload completion → template create → editor signed read → questionnaire step reference → token-scoped
  public metadata/base read → archive denial without returning a raw reference.
- Exercise CPA first save → sequential edit → completion → dashboard status → year switch → archive/restore conflict,
  comparing Client/Submission/guard/journal state after each action.
- Run existing public questionnaire, private files/ZIP, PDF renderer/parity, auth/entity, and frontend helper suites as
  regressions; issue #10 must not weaken already accepted #6-#9 behavior.

### Edge Cases

- Empty steps; missing id/title/question; duplicate step IDs; disabled default steps; 100-version boundary; invalid or
  oversized JSON; multiple/import-corrupt active templates; missing/stale guard; simultaneous default seed and save.
- PdfTemplate blank name; malformed template; unsupported pdfme schema; base64 versus file URI; missing upload receipt;
  wrong content type/purpose/owner; pending versus exact template prefix; create/update race; archive twice; archived
  template still referenced by a completed Submission; orphaned uploaded bytes after failed DB write.
- Missing/archived Client; missing/archived/replaced/cross-client/cross-year Submission; stale revision; two browsers
  editing; malformed existing audit JSON; completion without required metadata; CPA identity fields in payload;
  simultaneous public and CPA save.
- Invalid/non-integer year; target year with/without historical Submission; restore conflict disappears/changes;
  restore target already active; mismatched Client/year IDs; paired status invoked from wrong prior state; journal
  conditional conflict after pre-read.
- Expired/missing JWT; access token without scope; unlinked/duplicate/non-admin User; anonymous call to legacy-shaped
  CPA save; token-scoped public caller requesting unrelated/archived PDF template.
- Drive/Telegram calls, network errors, and controlled 501 response leave spinner/loading state consistent and perform
  no connector request.
- Hebrew/emoji filenames, labels, template names, date display, RTL layout, narrow/mobile signing, slow upload, PDF
  request >30 seconds, response >6 MB, and refresh/reopen after save.

---

## VALIDATION COMMANDS

Use Node `20.17.0`. Run commands from the repository root. Full frontend lint/typecheck have an accepted imported
baseline; their pass condition for this ticket is no new count/class and zero diagnostics in touched paths.

### Level 1: Syntax & Style

```powershell
node --version
npm ci
npm run typecheck
npm run lint
npm run typecheck:foundation
npm run lint:foundation
git diff --check
```

### Level 2: Unit Tests

```powershell
npm test
npm run test:foundation
npm run test:pdf
```

Focused during implementation:

```powershell
npx vitest run --config vitest.foundation.config.js backend/api/__tests__/template-service.test.ts backend/api/__tests__/template-routes.test.ts backend/api/__tests__/cpa-workflow-service.test.ts backend/api/__tests__/cpa-workflow-routes.test.ts backend/api/__tests__/auth.test.ts backend/api/__tests__/change-journal-service.test.ts backend/api/__tests__/files-service.test.ts
npx vitest run src/api/__tests__/aws-client.test.js src/api/__tests__/base44-client.test.js src/api/__tests__/function-client.test.js src/api/__tests__/file-client.test.js src/lib/__tests__/questionnaire-save-queue.test.js src/lib/__tests__/questionnaire-steps.test.js src/lib/__tests__/questionnaire-template.test.js src/lib/__tests__/submission-compat.test.js src/lib/__tests__/pdf-api.test.js
```

### Level 3: Integration, Build, and Contract Tests

```powershell
npm run build
node tooling/verify_sst_foundation.mjs --mode contract --stage test
python tooling/validate_codex_layer.py
npm run sst:diff:test
```

Inspect the diff for no stateful replacement, no production/Terraform/DNS change, exact protected scopes, and both
legacy reader environment values remaining `false`.

### Level 4: Manual Validation

Without deployment, run the Vite application against an explicitly selected synthetic/local backend and verify:

1. Questionnaire editor loads, edits, reorders, disables defaults, selects active PDF templates, saves a new version,
   and history/detail show the correct active marker, count, creator, and `he-IL` date.
2. A completed Submission stays on its prior questionnaire version; an in-progress/new workflow uses the new active.
3. PDF editor creates, reloads, edits, and archives a template; base PDF and mapping round-trip; archived templates
   disappear and are not selectable.
4. CPA fill resumes, saves sequentially, records CPA badges/audit, exempts/undoes PDF steps, completes, reloads, and
   handles a forced stale/archive conflict without false navigation.
5. Dashboard year/status/archive/restore/conflict actions retain exact dialogs/toasts/navigation and never expose a
   partial Client/Submission state.
6. Drive/Telegram controls remain visible and report `Not implemented`; no external integration request occurs.
7. Network inspection of the production-mounted iframe signer shows only same-origin AWS compatibility/PDF routes,
   private signed S3 URLs, and existing approved external IP/PDF fallbacks; no Base44 SDK/API/storage/media request
   occurs. Do not report unmounted legacy or DEV-only signer POCs as production acceptance.

### Level 5: Owner-Authorized Live Validation

Only after explicit approval:

```powershell
npm run sst:deploy:test
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json
```

Run the Task 18 synthetic matrix and the PDF runbook. Retain aggregate timings/status/counts only. Do not print or
commit user email, client token, answers, tax data, filenames, signatures, internal references, endpoints with signed
queries, journal snapshots, or AWS identifiers.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1 — Reachable CPA parity:** authenticated CPAs can perform every currently reachable dashboard, client,
  questionnaire-template editor/history, PDF-template editor, and CPA-assisted questionnaire action through AWS.
- [ ] **AC #2 — Version/pinning parity:** questionnaire saves validate and create exactly one monotonically increasing
  active version atomically; history is descending/read-only; completed existing Submissions retain their template
  ID/version while new/in-progress work uses the current active version.
- [ ] **AC #3 — PDF-template/signing parity:** PDF templates can be listed, created, read, updated, and archived with
  exact pdfme JSON and private S3 base references; active/scoped lookup, SST rendering/generation, upload, save,
  refresh/resume, and reopen paths pass without arbitrary template/file exposure.
- [ ] **AC #4 — Lifecycle/audit parity:** status, tax-year, client/submission archive, simple restore, conflict keep/swap,
  timestamp, CPA audit, revision, and completion behavior match executable source behavior except the explicitly
  documented atomic/security hardening; no logical multi-record action can partially succeed.
- [ ] **AC #5 — UI parity:** existing route structure, Hebrew copy, RTL layout, generated UI primitives, navigation,
  dialogs, toasts, loading states, and status precedence remain unchanged except platform-required auth/conflict handling.
- [ ] **AC #6 — Journal completeness:** every successful Client, Submission, QuestionnaireTemplate, and PdfTemplate
  mutation produces sufficient ordered before/after ChangeJournal evidence in the same DynamoDB transaction; rejected
  operations write no journal entry. File upload receipts retain their existing evidence.
- [ ] **AC #7 — Test/security coverage:** characterization, repository, service, route, facade, authorization,
  transaction-race, negative ownership, log-redaction, infrastructure-contract, and existing #6-#9 regression tests pass.
- [ ] No active browser/runtime Base44 SDK, Vite plugin, API, storage/media URL, connector, agent, or fallback remains;
  provenance and migration tooling remain available.
- [ ] Full local validation passes subject only to the recorded untouched frontend baseline, with zero touched-path
  diagnostics; the read-only SST diff contains no unauthorized stateful or production change.
- [ ] Live/deployment acceptance is reported as either explicitly authorized and passed with disposable synthetic data,
  or honestly not run; no production readiness is claimed before issues #11-#15.

---

## COMPLETION CHECKLIST

- [ ] Issue/epic/Wiki/dependency state revalidated and feature branch created from current `main`.
- [ ] Strict contracts, actor audit identity, projections, repositories, and guards implemented.
- [ ] Questionnaire version/history/activation and PdfTemplate lifecycle implemented and journaled.
- [ ] CPA save, tax-year, restore/swap, and paired status workflows implemented atomically.
- [ ] All routes registered with exact Cognito scope and contract/verifier inventories synchronized.
- [ ] Frontend facade and callers migrated with correct public-versus-CPA auth and no fallback.
- [ ] Base44 runtime packages/plugin/media references removed; brand visuals served locally.
- [ ] Each task's focused validation passed immediately.
- [ ] Full frontend/foundation/PDF suites, build, contract verifier, Codex validator, and diff check completed.
- [ ] Inherited lint/typecheck baseline compared and no touched-path regression added.
- [ ] Read-only SST test diff inspected and safe.
- [ ] Manual/local behavior matrix completed.
- [ ] Any live test deployment/fixture/browser matrix performed only with explicit approval and aggregate evidence.
- [ ] Acceptance criteria checked, code reviewed, implementation report written, and plan/report committed on the
  feature branch with the implementation.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Resolved assumption — soft delete:** issue #10 explicitly says PDF-template archive. Keep the current delete
  button/copy but map the operation to `is_active:false`, hide archived templates from normal lists, and retain bytes
  for rollback. If the owner instead requires irreversible record/file deletion, that materially changes the plan and
  requires a lifecycle/rollback decision before implementation.
- **Resolved assumption — CPA archived save hardening:** the Base44 function can select/update the first archived
  client/year Submission. The AWS implementation rejects archived/replaced records with 409/reload because the
  canonical active guard, ticket conflict requirement, and authorization architecture prohibit reviving one through
  an ordinary save. This is a documented security/consistency hardening, not a silent parity claim.
- **Resolved assumption — no anonymous active PDF list:** no reachable frontend calls `getActivePdfTemplates`.
  Questionnaire/PDF editors use protected lists; public signing requests an exact template with client token and
  pinned questionnaire authorization. Adding a public all-active list would weaken the approved boundary.
- **Resolved assumption — no new table/index/framework:** the existing entity tables, GSIs, native router, Zod, AWS
  SDK, and ChangeJournal are sufficient. The questionnaire active/version guard is an internal item in the existing
  QuestionnaireTemplate table, analogous to the Submission active guard.
- **Assumption — function wrapper normalization:** all authenticated facade function calls should resolve to
  `{ data: body }`, matching current SDK callers and fixing current Drive result parsing. If tests reveal a reachable
  caller expecting the unwrapped AWS body, adapt that caller explicitly rather than create per-error fallback logic.
- **Assumption — Base44 brand bytes are publicly retrievable at implementation time:** copy and verify the currently
  referenced bytes. If unavailable, recover them from an owner-approved source; do not substitute a redesigned logo.
- **Open operational gate:** issue #6's report recorded a broader authenticated two-user exercise as deferred even
  though the issue is closed. Issue #10's owner-authorized live checkpoint should include the real assembled Cognito
  session/second-user authorization scenarios using synthetic business data, or explicitly record their continued
  deferral before claiming live CPA acceptance.
- **No critical product decision is required to begin implementation.** A request for hard deletion, anonymous PDF
  listing, a new database/index, normalization of legacy fields, or production/legacy-read actions changes scope and
  must be resolved explicitly.

## NOTES (open canvas)

### Data and mutation flow

```text
CPA component
  -> AWS-only compatibility facade
  -> same-origin /api route + Cognito access token
  -> Gateway JWT scope + linked admin User
  -> strict Zod contract
  -> repository pre-read / relationship validation
  -> one conditional DynamoDB transaction
       business record(s) + active guard + ordered ChangeJournal entry/entries
  -> Base44-compatible projection / { data } wrapper
  -> existing Hebrew/RTL UI refresh
```

Public signing remains separate:

```text
client_id + token + submission/template context
  -> anonymous-at-Gateway compatibility route
  -> server-side client/submission/pinned-template authorization
  -> resource-derived short-lived S3 URL or scoped PDF metadata
```

### Why the plan does not reuse the transitional PDF mirror as the CRUD service

Issue #8 had to mirror a Base44-owned PdfTemplate into AWS and therefore used the source record `_version` as a
monotonic `source_version`. After issue #10 moves the source record itself to AWS, a mirror call that updates that same
record increments `_version`; the next load sends the new `_version`, causing another mirror write indefinitely. The
correct final seam validates the upload reference and stores `template_json + file_reference` in the one AWS-owned
PdfTemplate mutation. Keep the old mirror capability only for bounded migration/import reconciliation, not ordinary UI.

### Transaction sizing and consistency

Ordinary operations are small: questionnaire save changes two template records plus one guard and two journal
entries; CPA save changes one Submission, optionally one Client/guard, and matching journal entries; restore swap
changes two Submissions, one guard, and two journal entries. All are comfortably below the 100-action/4 MB DynamoDB
limit if template/audit JSON bounds are enforced. History/list GSIs are for display only; guard/version/record
conditions provide serialization. A conditional conflict is observable 409, never a retry that silently overwrites a
user's newer work.

### Reviewability and split decision

Keep issue #10 as one compatibility-boundary ticket because template selection, CPA save pinning, PDF-template file
ownership, facade removal, and lifecycle acceptance share the same route/journal/UI seams. Implement it as focused
commits matching Phases 1-5 so each concern can be reviewed independently. If code plus tests materially exceeds the
ticket's 1,200-1,800 line estimate or a single phase grows beyond a reviewable change, stop before that phase and
create dependency-ordered child work items rather than submitting one opaque diff; keep the final Base44 removal
dependent on all children.

### Confidence score

**8/10 for one-pass implementation.** The authentication, repository, journal, private-file, public questionnaire,
PDF, and SST seams are implemented and well tested. Remaining risk is concentrated in atomic template guard
initialization against imported/default data, refactoring transitional PdfTemplate mirroring without weakening file
ownership, and frontend conflict behavior across simultaneous public/CPA sessions. The plan makes each a focused
contract/service test before UI integration and keeps live deployment behind explicit authorization.

## AMENDMENTS
