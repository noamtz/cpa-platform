# Feature: Implement private S3 files and ZIP downloads

The following plan is complete, but implementation must first revalidate issue #8, its accepted #6/#7 dependencies,
the canonical Wiki architecture, and the current codebase. Pay special attention to the existing compatibility names,
record shapes, and file-reference formats. Import from the established modules rather than creating parallel auth,
HTTP, routing, repository, or journaling layers.

Do not implement a product redesign, expose arbitrary-object signing, proxy a file body through API Gateway/Lambda,
or perform a production deployment/data migration in this slice.

## Feature Description

Replace AuditFlow's remaining Base44 file runtime with private, versioned S3 storage while retaining the current
questionnaire upload controls, PDF/template file flows, CPA file previews, and batch-download interaction. Browser
uploads use short-lived, server-scoped presigned S3 `PUT` URLs and a completion call; authorized reads use
resource-derived short-lived S3 `GET` URLs. CPA batch downloads create an asynchronous ZIP job, stream a complete
archive into the existing temporary-output bucket, and return a short-lived result URL without carrying source or
archive bytes through the API Lambda.

The implementation preserves both new opaque `private://files/...` references and imported legacy private
references. Public routes authorize the current `client_id + token` and resolve the object from the active
client/submission/template; CPA routes require both API Gateway scope enforcement and the existing linked local
admin actor. File creation and deletion evidence is written to ChangeJournal without storing bytes, filenames,
tokens, or signed URLs in logs or fixtures.

## User Story

As a CPA or taxpayer using AuditFlow
I want uploads, previews, signed documents, templates, and ZIP downloads to keep working through private AWS storage
So that I can complete the existing tax-document workflow without learning a new interface or exposing another
client's files.

## Problem Statement

The browser still uploads multipart bodies to Base44 functions, several callers obtain signed URLs through a
Base44 integration, and `downloadAllFiles` trusts a browser-supplied URL list and buffers the complete archive in the
function response. Those paths retain a Base44 dependency, cannot safely pass large bodies through the selected AWS
HTTP API/Lambda boundary, and do not meet the target's resource-ownership and rollback-journal requirements.

The SST foundation already provides a private versioned `FilesBucket` and a private one-day
`TemporaryOutputsBucket`, but the application has no S3 file contracts, ownership-aware service, presigner,
completion protocol, ZIP worker, browser CORS policy, or file-specific tests.

## Solution Statement

Implement one AWS file boundary with these fixed contracts:

1. **Stable references:** new objects return an opaque `private://files/<server-owned-key>` string. The server alone
   constructs keys under the current firm and client/template purpose prefixes; object keys use generated IDs and a
   safe extension, not user-provided path segments or personal filenames. A resolver also maps each imported legacy
   private reference deterministically to the key contract consumed later by issue #11.
2. **Two-phase direct upload:** an initiation JSON request authorizes the caller, fixes key/content type/declared
   size/purpose and returns a short-lived presigned `PUT`; the browser uploads directly to S3 with XHR progress; a
   completion JSON request performs `HeadObject`, verifies the exact key/size/type/owner metadata, journals the file
   creation idempotently, and returns the existing `{ file_uri }` shape. API requests reject body/base64/file fields.
3. **Resource-scoped reads:** public `getSignedPdfUrl` and `getTemplateFileUrl` keep their function names and
   `{ signed_url }` result, but derive the reference from the authorized active Submission/PdfTemplate. CPA preview
   routes accept a Submission locator or PdfTemplate ID, never a raw key/URI. The unrestricted
   `createSignedUrl`/`CreateFileSignedUrl` surface is removed from migrated callers.
4. **Rollback-safe mutation evidence:** extend ChangeJournal with `File` mutations and an idempotency receipt stored
   in the existing operational journal table. Completion compensates an unjournaled upload with a version-aware
   delete if the journal transaction fails. Explicit owned-object deletion places a versioned delete marker,
   journals the before/after metadata, and removes the marker if journaling fails. Reference replacement remains a
   unique-key upload plus the existing journaled Submission/PdfTemplate pointer update; never overwrite an object
   key in place.
5. **Asynchronous complete ZIP:** `POST /cpa/submissions/{id}/zip-downloads` loads the Submission and derives all
   current/legacy response files plus signed PDFs server-side, writes a private job manifest below a filtered
   temporary-bucket prefix, and returns `202`. An S3-notified, idempotent ZIP worker streams every owned source into
   JSZip and streams the archive through multipart S3 upload. A scoped status route returns pending/failure or a
   one-hour result URL. Any missing source fails and removes the partial result; the ticket's complete-ZIP criterion
   intentionally supersedes the legacy function's silent partial-archive behavior.
6. **Narrow browser CORS:** only `FilesBucket` receives exact-origin `PUT`/`HEAD` CORS for the SST Router,
   `http://localhost:5173` in test, and `https://app.ddcpa.co.il` in production. It exposes only headers needed by
   the signed upload. Both buckets remain private and HTTPS-only; `TemporaryOutputsBucket` remains browser-CORS-free.

## Out of Scope / Non-Goals

- Not included: PdfTemplate CRUD, questionnaire-template version management, CPA-assisted persistence, or other
  dashboard lifecycle parity; issue #10 owns these and consumes this file service.
- Not included: PDF rendering, native packaging, page generation, or signing-render parity; issue #9 owns the PDF
  service and uses the S3 references established here.
- Not included: production snapshot import/reference rewriting; issue #11 copies bytes to the deterministic legacy
  keys and reconciles them. This issue defines and tests the resolver contract only.
- Not included: multipart browser uploads. Current flows use one direct presigned `PUT`; keep initiation/completion
  extensible so multipart can be added later without changing component APIs. Never permit an object above S3's
  single-`PUT` limit.
- Not included: a general file browser, public bucket/CloudFront origin, multi-firm administration, or a generic
  caller-selected URI/key signer.
- Not included: Drive synchronization or Telegram file delivery; their controlled `Not implemented` behavior stays.
- Not included: changing Hebrew copy, RTL layout, buttons, modal structure, file ordering, stored `file_names`,
  signed-PDF record shape, or questionnaire save/resume semantics.
- Not changing: disabled/dev PDF POC routes except where a shared helper change requires compilation. Issue #9 must
  migrate or remove their remaining PDF-specific direct calls before final Base44 retirement.
- Not fixing: unrelated pre-existing upload error UX. Characterize and preserve the current active components'
  visible success/progress/failure behavior unless issue #8 explicitly requires a platform-boundary change.
- Not authorized: test/production deployment, production data access/import, DNS/certificate changes, cutover, or
  Base44 retirement. A test-stage deploy/manual exercise requires explicit authorization during implementation.

## Feature Metadata

**Feature Type**: New Capability / Platform Migration

**Estimated Complexity**: High

**Primary Systems Affected**: React file callers; AWS compatibility clients; modular API Lambda; Client,
Submission, QuestionnaireTemplate, and PdfTemplate reads; ChangeJournal; private S3 buckets; SST route/IAM/CORS
contracts; asynchronous ZIP worker

**Dependencies**: Accepted issues [#6](https://github.com/noamtz/cpa-platform/issues/6) and
[#7](https://github.com/noamtz/cpa-platform/issues/7); Node 20.17.0; SST 3.19.3; AWS SDK v3 packages pinned to the
repository's `3.1116.0` line; JSZip 3.10.1; current Zod/Vitest stack; existing `FilesBucket`,
`TemporaryOutputsBucket`, Cognito, DynamoDB repositories, and ChangeJournal

## Related Work

**Implements**: [issue #8 — Implement private S3 files and ZIP downloads](https://github.com/noamtz/cpa-platform/issues/8)

**Epic**: [issue #1 — Migrate AuditFlow off Base44](https://github.com/noamtz/cpa-platform/issues/1) ·
[PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration) ·
[Architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- `.agents/plans/establish-sst-serverless-aws-foundation.md` - Created the two private buckets, strict stage model,
  Router/API Lambda, deployment boundary, and foundation verifier extended here.
- `.agents/plans/implement-cognito-core-cpa-compatibility.md` - Supplies the CPA actor, AWS HTTP/facade seams,
  repositories, and atomic ordered ChangeJournal coordinator.
- `.agents/plans/preserve-public-questionnaire-persistence-resume.md` - Supplies timing-safe public token ownership,
  active current-year Submission scoping, legacy JSON preservation, optimistic writes, and public function routing.
- `.agents/reports/inventory-export-base44-data-files-report.md` - Proves 687 production references/622 unique files
  can be closed without retaining private content in Git; issue #11 will consume the resolver contract defined here.

**Forward-references**:

- [Issue #9](https://github.com/noamtz/cpa-platform/issues/9) - Uses private template/signed-artifact references in
  the SST PDF rendering and signing pipeline.
- [Issue #10](https://github.com/noamtz/cpa-platform/issues/10) - Migrates PdfTemplate CRUD and complete CPA
  workflows onto this file service.
- [Issue #11](https://github.com/noamtz/cpa-platform/issues/11) - Copies the rehearsal/final bytes into the stable
  legacy-reference keys and reconciles record pointers.
- [Issue #12](https://github.com/noamtz/cpa-platform/issues/12) - Reverse-replays journaled file create/delete/version
  evidence during rollback proof.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` (lines 37-87) - Target placement, migration status, parity, validation, source-integrity, and AWS rules.
- `.agents/references/auditflow-api-security-contracts.md` (lines 1-5) - Public token ownership, resource-scoped file
  routes, safe errors, and the prohibition on arbitrary URI signing.
- `.agents/references/auditflow-submission-compatibility.md` (lines 1-6) - JSON-string fields and legacy flat file
  references that ZIP/read/delete resolution must preserve.
- `.agents/references/auditflow-questionnaire-parity.md` (lines 1-6) - Save queue/resume/PDF completion behavior that
  file completion must not disturb.
- `.agents/references/auditflow-pdf-pipeline.md` (lines 1-6) - The file/PDF seam; rendering remains server-side and
  out of scope.
- `.agents/references/auditflow-aws-operations.md` (lines 1-40) - SST ownership, stage safety, permissions boundary,
  diff/deploy rules, and production authorization limits.
- `base44/functions/uploadFile/entry.ts` (lines 3-42) - Source dual-auth multipart function and `{ file_uri }` result.
- `base44/functions/getSignedPdfUrl/entry.ts` (lines 7-50) - Source client/Submission/step lookup and one-hour signer.
- `base44/functions/getTemplateFileUrl/entry.ts` (lines 7-56) - Source client/PdfTemplate lookup and both legacy
  `basePdf` reference shapes.
- `base44/functions/createSignedUrl/entry.ts` (lines 3-20) - Unsafe arbitrary URI source behavior that must not be
  reproduced.
- `base44/functions/downloadAllFiles/entry.ts` (lines 4-61) - Legacy labels/extensions/ZIP name and the buffering,
  caller-trust, and silent-skip behavior being replaced.
- `base44/functions/deleteSubmissionWithFiles/entry.ts` (lines 14-62) - Complete legacy/current/signed reference
  discovery and deletion evidence; do not reproduce its fire-and-forget failure swallowing.
- `src/api/base44Client.js` (lines 20-63) - Explicit legacy allowlist; remove the Core file signer only after every
  active caller has an AWS path and keep non-file downstream allowlist entries.
- `src/api/aws-client.js` (lines 15-100), `src/api/http-client.js` (lines 25-62), and
  `src/api/function-client.js` (lines 1-56) - Existing CPA bearer retry/error mapping and exact public function client.
- `src/components/questionnaire/QuestionStep.jsx` (lines 50-98, 101-140, 154-160, 225-305, 409-446) - Concurrent
  uploads, 0→90→100 XHR progress, stored `files`/`file_names`, continue gating, and signed-PDF open behavior.
- `src/components/questionnaire/PdfSignStepWrapper.jsx` (lines 92-129) - Signed artifact record and current swallowed
  upload failure behavior.
- `src/pages/PdfSignIframeOverlay.jsx` (lines 17-30, 225-310, 495-560) - Production signing route, client/template
  authorization context, active Submission, artifact upload, and ordered persistence.
- `src/pages/ClientQuestionnaire.jsx` (lines 444-464) - Signed-PDF spinner/open interaction.
- `src/components/dashboard/ClientRow.jsx` (lines 7-14, 24-94, 100-186, 423-580) - CPA previews, original filename
  derivation, ZIP spinner/toast/download name, current caller-supplied list, and signed-PDF entries.
- `src/pages/PdfTemplateEditor.jsx` (lines 432-540) and `src/lib/pdfme-config.js` (lines 135-205) - CPA template
  upload/read, `{__type:"file_uri",value}`, one-hour URL resolution, and cache behavior.
- `src/lib/submission-compat.js` (lines 137-175) and `src/lib/__tests__/submission-compat.test.js` (lines 220-276) -
  Authoritative file group ordering, removed-template steps, legacy fields, and parallel stored names.
- `backend/api/auth/cpa-context.ts` (lines 25-59) - Required API Gateway/raw bearer/local User admin boundary.
- `backend/api/services/public-questionnaire.ts` (lines 225-247, 341-429) - Timing-safe public authorization, active
  current-year Submission lookup, and atomic journal mutation pattern.
- `backend/api/core/http.ts` (lines 24-54), `backend/api/core/router.ts` (lines 1-31), and
  `backend/api/handler.ts` (lines 34-76, 79-162, 165-205) - Strict JSON/error response, exact route dispatch,
  dependency injection, route allowlists, and privacy-safe unexpected logging.
- `backend/api/repositories/{client,submission,questionnaire-template,dynamo}.ts` - Validated direct/indexed reads and
  persisted `.passthrough()` record contracts to mirror in the read-only PdfTemplate repository.
- `backend/api/services/change-journal.ts` (lines 91-112, 138-268) and
  `backend/api/contracts/change-journal.ts` (lines 3-53) - File-reference extraction, action/item bounds, idempotent
  transaction behavior, and entity type list to extend.
- `infra/sst/contracts.ts` (lines 18-32, 113-246, 306-335), `infra/sst/storage.ts` (lines 7-80),
  `infra/sst/application.ts` (lines 14-117), and `sst.config.ts` (lines 27-87) - Bucket/CORS model, exact routes,
  one 512MB/10-second API Lambda, links, resource inventory, and construction order.
- `infra/sst/__tests__/contracts.test.ts` (lines 16-93, 150-245),
  `infra/sst/foundation-contract.json`, and `tooling/verify_sst_foundation.mjs` (lines 52-150, 410-451, 556-596) -
  Dependency-free contract, hard-coded route/inventory/privacy assertions, and live checks that must change together.
- `docs/migration/auditflow-source-baseline.md` (lines 51-67) - Accepted full frontend typecheck/lint baseline; all
  touched paths must still be clean.

### New Files to Create

- `src/api/file-client.js` - Shared dual-context initiate/direct-PUT/complete upload, public scoped reads, CPA scoped
  reads, ZIP request/status polling, and injected XHR/fetch/auth seams.
- `src/api/__tests__/file-client.test.js` - Browser protocol, progress, expiry/error, no-API-body, and ZIP redirect tests.
- `backend/api/auth/public-client.ts` - Shared timing-safe client-token + active current-year Submission authorization
  extracted without changing issue #7 behavior.
- `backend/api/contracts/files.ts` - Strict upload/read/delete/ZIP schemas, constants, opaque reference parser, safe
  filename/extension helpers, and response types.
- `backend/api/repositories/pdf-template.ts` - Read-only validated PdfTemplate lookup required for scoped template URLs.
- `backend/api/services/files.ts` - Ownership/key resolver, S3 presigner/completion, scoped read, legacy mapping,
  journal/idempotency receipt, and version-aware delete compensation.
- `backend/api/routes/files.ts` - Exact CPA and compatibility function routes with existing actor/request-ID patterns.
- `backend/api/workers/zip-download.ts` - S3-notified, idempotent, streaming complete-ZIP worker.
- `backend/api/__tests__/files-contract.test.ts` - Boundary, key traversal, size/type, extra/body field, and URI tests.
- `backend/api/__tests__/pdf-template-repository.test.ts` - Read/validation/no-scan repository tests.
- `backend/api/__tests__/files-service.test.ts` - Authorization, completion, signing, journaling, idempotency,
  compensation, expiry, and no-leak tests.
- `backend/api/__tests__/files-routes.test.ts` - Exact routes, CPA/public auth split, safe response/log, and 404 tests.
- `backend/api/__tests__/zip-download.test.ts` - Server-derived file inventory, stable/collision filenames, streaming,
  complete/failure semantics, idempotency, and temporary result tests.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [AWS SDK for JavaScript v3 S3 request presigner](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/)
  - Specific section: `getSignedUrl` for `PutObjectCommand` and `GetObjectCommand`, expiry, and signed headers.
  - Why: implement the metadata-only initiation/read boundary with pinned SDK v3 packages.
- [Amazon S3 presigned uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html)
  - Specific section: permission/key scope, expiration, and same-key replacement behavior.
  - Why: server-owned unique keys and short TTLs prevent overwrite/cross-owner access.
- [Amazon S3 object integrity](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html)
  - Specific section: checksums on presigned uploads.
  - Why: if a checksum is supplied, the initiation contract must sign it and the XHR must send it exactly; do not
    treat multipart/encrypted ETags as MD5.
- [Amazon S3 object metadata](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingMetadata.html) and
  [object key naming](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-keys.html)
  - Why: keep ownership/purpose facts compact and server-owned; never use a user filename as an authorization key.
- [Amazon S3 CORS elements](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html)
  - Specific section: allowed origins/methods/headers and exposed headers.
  - Why: direct browser PUT needs narrow CORS while the bucket remains private.
- [Amazon S3 multipart/single-object limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html)
  - Why: validate the direct single-PUT ceiling and preserve a future multipart-compatible two-phase contract.
- [API Gateway HTTP API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
  and [Lambda Invoke limits](https://docs.aws.amazon.com/lambda/latest/api/API_Invoke.html)
  - Why: HTTP API is capped at 10 MB and synchronous Lambda payloads at 6 MB; only metadata crosses the API.
- [Amazon S3 event notifications to Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html)
  - Specific section: asynchronous invocation, prefix filters, recursion prevention, and idempotency.
  - Why: filtered `zip-jobs/requests/` manifests trigger the worker; results use a non-triggering prefix.
- [Amazon S3 lifecycle rules](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html) and
  [expiration behavior](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html)
  - Why: one-day physical cleanup is delayed/day-granular, so status and signed URLs must enforce logical expiry.
- [SST v3 Bucket](https://sst.dev/docs/component/aws/bucket) and [SST resource linking](https://sst.dev/docs/linking)
  - Specific section: `cors`, `lifecycle`, `notify`, filters, and function linking.
  - Why: use the existing buckets and give only the API/worker the required resource access.
- [JSZip Node stream generation](https://stuk.github.io/jszip/documentation/api_jszip/generate_node_stream.html) and
  [JSZip limitations](https://stuk.github.io/jszip/documentation/limitations.html)
  - Why: `generateAsync()` buffers the archive; use `generateNodeStream({streamFiles:true})` into S3 multipart upload.

### Patterns to Follow

**Naming Conventions:** backend TypeScript modules use kebab-case filenames and named exports; frontend pure API
helpers use kebab-case ESM JavaScript; React components/pages remain PascalCase. Preserve snake_case transport and
legacy record fields (`file_uri`, `signed_url`, `client_id`, `signed_pdfs`, `file_names`).

**Strict route pattern:** mirror `backend/api/routes/public-questionnaire.ts:20-61`:

```ts
router.register("POST /apps/{appId}/functions/uploadFile", async (event) => {
  const input = parseJsonBody(event, uploadRequestSchema);
  return jsonResponse(200, await files.handlePublicUpload(input, getRequestId(event)));
});
```

Public-at-Gateway means only that Cognito is unavailable there; the service must authorize `client_id + token`
before any S3/repository action. CPA routes pass through the existing `authenticated` wrapper and must not resolve an
actor a second, weaker way.

**Repository pattern:** mirror `backend/api/repositories/submission.ts:17-74`: inject the document client/table name,
use direct `GetCommand` or an existing index, validate with the persisted `.passthrough()` schema, and map invalid
stored data to the current safe internal error. Never scan to authorize a file.

**Journal pattern:** mirror `PublicQuestionnaireService.commitMutation` at
`backend/api/services/public-questionnaire.ts:341-360` and the transaction construction at
`backend/api/services/change-journal.ts:223-245`. Store only compact metadata:

```ts
{
  entityType: "File",
  entityKey: stableReferenceHash,
  operationType: "create",
  before: null,
  after: { file_uri, owner_type, owner_id, purpose, size, content_type, version_id }
}
```

Do not include bytes, original filenames, client tokens, signed URLs, S3 query strings, or complete job manifests in
journal snapshots/logs. The conditioned receipt is a business action in the existing ChangeJournal table, under a
separate operational scope/key, so completion replay returns the same `file_uri` without a second journal entry.

**Opaque reference/key pattern:** parse only the exact new scheme/prefix grammar; reject encoded separators,
backslashes, `.`/`..`, bucket names/ARNs, `s3://`, HTTP(S), and caller-supplied keys. Public read inputs identify a
record/step/template; the service loads the stored reference before resolving it. Imported legacy references map to
`legacy/<sha256(canonical-reference)>` without placing the legacy string in logs or an object key.

**Upload progress pattern:** preserve `QuestionStep.jsx:55-86`: 0% before initiation, direct S3 XHR progress capped
at 90%, 100% only after successful completion, then return `{ file_uri }`. API initiation/completion receives JSON
metadata only. Use the same helper for signed blobs and template base PDFs.

**ZIP filename pattern:** preserve server-derived group order and `${label}_${index + 1}.${ext}`, sanitize path
separators/control characters, preserve Hebrew, and add a deterministic suffix for collisions. Archive filename
remains the sanitized client display name plus `.zip`; neither display name nor entry names belong in logs.

**Error handling:** preserve JSON `{ error: message }` and 400/401/403/404/409/500 meanings. The worker records a
private bounded failure code and deletes/aborts partial output; the status route translates it to a safe error.
Unexpected logs contain request/job ID, error class, and a fixed message only.

---

## IMPLEMENTATION PLAN

### Phase 1: File contracts and ownership foundation

Add pinned S3/ZIP dependencies, strict schemas/constants, shared public-client authorization, read-only PdfTemplate
access, opaque new/legacy reference resolution, and `File` journal evidence. No browser or S3 body behavior starts
until the ownership and metadata boundary is testable.

### Phase 2: Upload/read/delete services and routes

**Depends on:** Phase 1

Implement public/CPA initiation and completion, scoped read routes, idempotent journal receipts, version-aware
compensation/deletion, exact route registration, and safe errors. Keep the direct function URL shapes needed by
public callers while using dedicated Cognito-scoped CPA routes.

### Phase 3: Private asynchronous ZIP infrastructure

**Depends on:** Phase 1 for reference/ownership contracts and Phase 2 for service composition

Implement server-derived ZIP jobs, an S3 prefix-filtered worker, streaming JSZip-to-S3 output, status/result signing,
narrow FilesBucket CORS, resource links/environment, and synchronized foundation contracts/verifier checks.

### Phase 4: Frontend compatibility integration

**Depends on:** Phase 2 for upload/read routes and Phase 3 for ZIP request/status

Create the shared file client, remove the Base44 Core signer from the facade, and migrate active questionnaire,
signing, CPA preview/ZIP, and PDF-template file call sites. Preserve visible state/copy and persisted reference/name
shapes.

### Phase 5: Characterization, full validation, and authorized test-stage evidence

**Depends on:** Phases 1-4

Prove success/ownership/expiry/failure, no API file bodies, complete stable ZIPs, journal/compensation behavior,
privacy-safe logs/fixtures, frontend progress, unchanged non-file behavior, and infrastructure least privilege. Run
all local gates; perform AWS diff/deploy/live/manual checks only with the required authorization.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. UPDATE `package.json` and `package-lock.json` with pinned file dependencies

- **IMPLEMENT**: Add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, and `@aws-sdk/lib-storage` at exactly
  `3.1116.0`; add `jszip` at `3.10.1`. Use `npm install --save-exact` under Node 20.17.0 so the lockfile is canonical.
- **PATTERN**: Existing AWS SDK pins at `package.json:25-28`; do not introduce a second SDK line or unpinned range.
- **GOTCHA**: Do not reuse the Deno `npm:jszip@3.10.1` source import. Do not add a web framework, queue library, or
  Base44 package. Verify JSZip's shipped types before adding any `@types` package.
- **VALIDATE**: `npm ci && npm ls @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage jszip`
- **SATISFIES**: AC #3, AC #4.

### 2. CREATE file contracts, shared public authorization, and PdfTemplate reads

- **CREATE**: `backend/api/contracts/files.ts`, `backend/api/auth/public-client.ts`,
  `backend/api/repositories/pdf-template.ts`, and their focused tests.
- **UPDATE**: Refactor `backend/api/services/public-questionnaire.ts` to consume the shared public authorizer without
  changing status text, 403/404 behavior, active current-year rules, or queries. Extend persisted entity contracts
  only with the permissive PdfTemplate shape needed to read `template_json`.
- **IMPLEMENT**: Define upload purposes, safe content-type/size bounds, initiation/completion discriminated schemas,
  CPA Submission locators, public PDF/template request shapes, ZIP job/status shapes, one-hour read/result TTL,
  shorter upload TTL, opaque reference/key parser, deterministic legacy reference key, safe extension and ZIP names.
- **PATTERN**: `backend/api/contracts/public-questionnaire.ts` uses strict ingress and separate permissive persisted
  shapes; `PublicQuestionnaireService.authorize` at lines 225-233 is the behavior to extract.
- **GOTCHA**: No request accepts a bucket, S3 key, signed URL, arbitrary `file_uri`, filename path, file bytes,
  `Buffer`, base64 body, or unknown fields. Preserve legacy reference strings only after they are loaded from an
  authorized record.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/files-contract.test.ts backend/api/__tests__/pdf-template-repository.test.ts backend/api/__tests__/public-questionnaire-service.test.ts`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #7.

### 3. UPDATE ChangeJournal for idempotent file mutation evidence

- **UPDATE**: `backend/api/contracts/change-journal.ts`, `backend/api/services/change-journal.ts`, and the contract/
  service tests to accept `File` changes and conditioned file-operation receipts in the existing table.
- **IMPLEMENT**: Keep journal entries in the existing `AUDITFLOW` scope/ordered sequence; keep receipts under a
  separate scope and deterministic key derived from operation/reference. Expose a narrow commit/query result needed
  for replay-safe completion. Bound all metadata and preserve current cursor conflict/retry semantics.
- **GOTCHA**: DynamoDB and S3 are not atomic. Upload completion must `HeadObject`, attempt the receipt+journal
  transaction, and version-delete an unjournaled object on failure. Delete must capture the S3 `VersionId`, journal
  the delete metadata, and remove the delete marker if journaling fails. Never claim full atomicity across services.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/change-journal-contract.test.ts backend/api/__tests__/change-journal-service.test.ts`
- **SATISFIES**: AC #6, AC #7.

### 4. CREATE the ownership-aware file service and exact routes

- **CREATE**: `backend/api/services/files.ts`, `backend/api/routes/files.ts`,
  `backend/api/__tests__/files-service.test.ts`, and `backend/api/__tests__/files-routes.test.ts`.
- **UPDATE**: Compose S3/presigner/repositories/journal in `backend/api/handler.ts`; register every exact route in the
  router and its early CPA/public allowlist. Add S3 bucket names to runtime environment in `infra/sst/application.ts`.
- **IMPLEMENT**:
  - Public upload initiation/completion behind the existing
    `POST /apps/{appId}/functions/uploadFile` path, with the operation discriminator in strict JSON.
  - Cognito-scoped CPA upload initiation/completion under `/cpa/files/uploads/...`.
  - Existing public `getSignedPdfUrl` and `getTemplateFileUrl` compatibility paths, resolving active Submission step
    and allowed PdfTemplate base file respectively.
  - CPA Submission/PdfTemplate locator signing routes, replacing arbitrary `createSignedUrl` semantics.
  - An internal owned-file deletion operation with version-aware compensation for later lifecycle consumers. Do not
    expose `deleteSubmissionWithFiles` in issue #8: exhaustive `src/` analysis found no active caller. Leave the
    tested service seam for issue #10 and retain bytes when a questionnaire merely removes a reference for rollback.
- **PATTERN**: `handler.ts:145-162` authenticated wrapper and `routes/public-questionnaire.ts:20-61` public route
  registration. `core/http.ts:24-54` is the only body/error parser.
- **GOTCHA**: Completion accepts only a server-issued upload ID/reference grammar and reauthorizes current ownership;
  it must not trust initiation-time authorization forever. Reject missing/archived/cross-client/current-year conflicts
  before `HeadObject` or presigning. GET URLs are one hour; upload URLs are shorter and single-use by unique key.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/files-service.test.ts backend/api/__tests__/files-routes.test.ts backend/api/__tests__/auth.test.ts backend/api/__tests__/router.test.ts`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #5, AC #6.

### 5. CREATE the complete streaming ZIP job and worker

- **CREATE**: `backend/api/workers/zip-download.ts` and `backend/api/__tests__/zip-download.test.ts`.
- **UPDATE**: Add CPA request/status routes to `backend/api/routes/files.ts` and file-service composition.
- **IMPLEMENT**: The request route accepts only Submission ID, loads the Submission/Client, derives legacy/current
  response files and signed PDFs server-side, fixes stable names/order, and writes a private bounded manifest below
  `zip-jobs/requests/<jobId>.json`. The worker validates the manifest, streams every S3 source into JSZip, uses
  `generateNodeStream({streamFiles:true})` piped through AWS `Upload` to `zip-jobs/results/<jobId>.zip`, then writes
  bounded ready/failure state. Status reauthorizes the CPA actor recorded on the request and signs only a complete,
  unexpired result.
- **PATTERN**: Mirror `src/lib/submission-compat.js:137-175` file ordering and source function
  `downloadAllFiles:33-57` extension/filename behavior, with deterministic collision suffixes.
- **GOTCHA**: S3 notification is asynchronous and at least once. Use the job ID/result existence as the idempotency
  key; filter notifications to the request prefix and never trigger on result/status writes. On any source failure,
  abort multipart upload, delete a partial result, write a safe failure, and do not return a partial archive.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/zip-download.test.ts backend/api/__tests__/files-service.test.ts backend/api/__tests__/files-routes.test.ts`
- **SATISFIES**: AC #2, AC #3, AC #4, AC #5, AC #7.

### 6. UPDATE SST bucket CORS, worker, routes, IAM links, and verifier contracts

- **UPDATE**: `infra/sst/contracts.ts`, `infra/sst/storage.ts`, `infra/sst/application.ts`, `sst.config.ts`,
  `infra/sst/foundation-contract.json`, `infra/sst/__tests__/contracts.test.ts`,
  `infra/sst/__tests__/verify-sst-foundation.test.js`, and `tooling/verify_sst_foundation.mjs`.
- **IMPLEMENT**: Construct the Router before storage so exact deployed origin input can feed FilesBucket CORS. Permit
  only direct-upload methods/headers for Router origin plus test-local or production custom origin as appropriate.
  Keep TemporaryOutputs CORS false, private access blocks, FilesBucket versioning, HTTPS, and one-day temporary
  lifecycle. Add one Node 20 arm64 ZIP worker with bounded memory/timeout/ephemeral settings, filtered S3
  notification, both bucket links, and the stage workload permissions boundary. Update exact route and function
  inventory/output contracts.
- **PATTERN**: `infra/sst/storage.ts:32-60` materializes bucket contracts;
  `infra/sst/application.ts:28-59` applies runtime/logging/boundary/link conventions.
- **GOTCHA**: The API Lambda remains the metadata signer/router and must not gain ZIP memory/timeout settings. The
  worker may read `FilesBucket` and read/write/delete only its temporary job prefixes; no public access, wildcard
  bucket, recursive S3 notification, production replacement, or Terraform-owned PDF change. Lifecycle expiry may
  run after the logical expiry, so status must enforce its own deadline.
- **VALIDATE**: `npm run test:foundation && npm run typecheck:foundation && npm run lint:foundation && node tooling/verify_sst_foundation.mjs --mode contract --stage test`
- **SATISFIES**: AC #2, AC #3, AC #4, AC #7.

### 7. CREATE the shared browser file client and remove the Base44 file signer allowlist

- **CREATE**: `src/api/file-client.js` and `src/api/__tests__/file-client.test.js`.
- **UPDATE**: `src/api/aws-client.js`, `src/api/function-client.js` as needed for exact routes; remove only
  `integrations.Core.CreateFileSignedUrl` from `src/api/base44Client.js` and update
  `src/api/__tests__/{aws-client,base44-client,function-client}.test.js`.
- **IMPLEMENT**: Provide public and CPA upload helpers that initiate with JSON, perform XHR `PUT` directly to the
  returned S3 URL with exact signed headers, report progress capped at 90, complete with JSON, and return
  `{file_uri}`. Provide resource-scoped public/CPA signed-read helpers and CPA ZIP request/status polling that
  follows the returned `signed_url` using a browser download link instead of `res.blob()`.
- **PATTERN**: Reuse `createHttpClient` for CPA bearer/one-refresh/error behavior and `invokePublicFunction` for
  public compatibility paths; expose injected `fetchImpl`, `xhrFactory`, clock/polling hooks for deterministic tests.
- **GOTCHA**: Never read the old `base44_access_token`, send the public client token in a query string, log a signed
  URL, or fall back to Base44 when AWS rejects. Revoke no S3 URL; it naturally expires. Preserve one-hour read TTL
  server-side even if callers pass legacy `expires_in`.
- **VALIDATE**: `npx vitest run src/api/__tests__/file-client.test.js src/api/__tests__/aws-client.test.js src/api/__tests__/base44-client.test.js src/api/__tests__/function-client.test.js src/api/__tests__/http-client.test.js`
- **SATISFIES**: AC #1, AC #3, AC #5.

### 8. UPDATE active upload, preview, template, and ZIP call sites

- **UPDATE**: `src/components/questionnaire/QuestionStep.jsx`,
  `src/components/questionnaire/PdfSignStepWrapper.jsx`, `src/pages/PdfSignIframeOverlay.jsx`,
  `src/pages/ClientQuestionnaire.jsx`, `src/components/dashboard/ClientRow.jsx`,
  `src/pages/PdfTemplateEditor.jsx`, and `src/lib/pdfme-config.js`.
- **IMPLEMENT**:
  - Replace raw multipart function calls with `file-client` direct S3 upload while preserving concurrent ordering,
    `file_names`, 0→90→100 progress, continue gating, and signed-record fields.
  - Replace public signed PDF/template reads with scoped helpers and existing spinner/window-open behavior.
  - Replace CPA individual previews with Submission/PdfTemplate locators. Keep original names from `file_names` or
    record labels so opaque references do not alter visible names/extensions.
  - Replace ClientRow's browser-supplied ZIP list and binary response with Submission job request/poll/signed-result
    download while retaining the same button, `downloading` state, Hebrew error toast, and `<client>.zip` name.
  - Preserve `{__type:"file_uri",value}` in PdfTemplate JSON and allow both new and imported legacy stored refs.
- **PATTERN**: Callers already hold the needed ownership context: QuestionStep has `clientId/token`; production
  signer has `clientId/token/submission/templateId/stepId`; ClientRow has the displayed Submission; template editor
  has editing ID/CPA auth.
- **GOTCHA**: Incomplete/signed-PDF upload failures are currently swallowed and may persist `pdf_file_url:null`;
  questionnaire upload failure has limited/stuck visible behavior. Characterize before refactoring and avoid adding
  copy or navigation behavior. Do not change save ordering: completion must finish before the file reference enters
  the queued Submission mutation.
- **VALIDATE**: `npx eslint src/api/file-client.js src/api/base44Client.js src/api/aws-client.js src/api/function-client.js src/components/questionnaire/QuestionStep.jsx src/components/questionnaire/PdfSignStepWrapper.jsx src/pages/PdfSignIframeOverlay.jsx src/pages/ClientQuestionnaire.jsx src/components/dashboard/ClientRow.jsx src/pages/PdfTemplateEditor.jsx --quiet && npm test`
- **SATISFIES**: AC #1, AC #4, AC #5.

### 9. ADD full negative/compatibility coverage and update operational documentation

- **UPDATE**: Extend `src/lib/__tests__/submission-compat.test.js`, handler/public route tests, foundation verifier
  tests, `README.md`, and `AGENTS.md` migration status. Add no real names, references, content, or signed URLs.
- **IMPLEMENT**: Cover wrong client/firm/prefix, traversal, arbitrary URI, archived/missing Submission, template not
  allowed by the client's pinned questionnaire, expired initiation/read/job, same completion retry, missing/mismatched
  object, S3/journal/worker failures, delete compensation, stable Unicode/collision filenames, legacy/current/signed
  file discovery, complete ZIP byte entries, logical/physical cleanup distinction, and privacy-safe logs.
- **IMPLEMENT**: Add a synthetic object larger than API Gateway's 10 MB limit in service/client tests and assert the
  API sees metadata only while the injected S3 XHR carries the bytes. Fixtures must be generated benign bytes or
  short in-memory streams; never commit production content.
- **GOTCHA**: Update all exact counts/lists in `foundation-contract.json`, TypeScript contract tests, dependency-free
  verifier, and live verifier together. Full app typecheck/lint retain accepted unrelated baseline failures, but no
  touched path may add a diagnostic.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/files-contract.test.ts backend/api/__tests__/pdf-template-repository.test.ts backend/api/__tests__/files-service.test.ts backend/api/__tests__/files-routes.test.ts backend/api/__tests__/zip-download.test.ts backend/api/__tests__/change-journal-contract.test.ts backend/api/__tests__/change-journal-service.test.ts infra/sst/__tests__/contracts.test.ts infra/sst/__tests__/verify-sst-foundation.test.js && npx vitest run src/api/__tests__/file-client.test.js src/api/__tests__/base44-client.test.js src/lib/__tests__/submission-compat.test.js && python tooling/validate_codex_layer.py`
- **SATISFIES**: AC #1-#7.

### 10. RUN all local gates, inspect the SST diff, and perform only authorized live evidence

- **IMPLEMENT**: Use Node 20.17.0. Run focused suites first, then every repository gate. Compare full frontend
  diagnostics with `docs/migration/auditflow-source-baseline.md` and require zero new/touched-path errors. Inspect the
  synthesized SST diff for no stateful replacement/deletion and no Terraform/PDF/production action.
- **VALIDATE**: `npm ci && npm test && npm run test:foundation && npm run typecheck:foundation && npm run lint:foundation && npm run typecheck && npm run lint && npm run build && node tooling/verify_sst_foundation.mjs --mode contract --stage test && python tooling/validate_codex_layer.py && git diff --check`
- **VALIDATE**: With a valid owner-authenticated test profile, `npm run sst:diff:test`; do not deploy merely to make
  the diff available.
- **MANUAL (explicit authorization required)**: Deploy test, run
  `node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json`, then use disposable
  synthetic clients/files to prove one public document upload, one signed-PDF upload, one CPA template upload, one
  individual preview, a >10 MB direct S3 upload, cross-client denial, one complete ZIP, one failed ZIP, URL expiry,
  and temporary cleanup. Inspect logs only for aggregate/request IDs; do not print tokens, object refs, filenames,
  signed query strings, journal snapshots, or bytes.
- **GOTCHA**: No production preview/deploy, production record/file access, Base44 write, DNS/certificate change,
  cutover, or retirement is authorized by issue implementation. Record live evidence as aggregate-only report data.
- **SATISFIES**: AC #1-#7.

---

## TESTING STRATEGY

### Unit Tests

- Contract tests reject extra/file/body/base64 fields, non-finite/negative/oversized sizes, unsafe content types,
  malformed upload IDs, foreign/new/legacy URIs, traversal/encoded separators, unsafe names, and expired timestamps.
- Reference tests round-trip new opaque refs, deterministically map legacy private shapes, never accept HTTP/S3/ARN,
  and do not leak input in thrown/logged messages.
- File-service tests inject S3/presigner/repositories/journal/clock/IDs. Verify initiation contains fixed key/headers/
  TTL only after auth; completion performs current reauthorization + HeadObject validation + one journal receipt;
  retry is idempotent; failure compensates the exact version; deletion restores a failed delete marker transaction.
- Authorization tests prove public client A cannot initiate/read/complete client B, archived or wrong-year resources;
  CPA routes reject missing scope, wrong token use, unlinked/duplicate/non-admin profiles, other firm prefixes, and raw
  caller keys before S3.
- ZIP tests use invented in-memory streams and an unzip reader to assert every byte/name/order/collision, all legacy
  and signed refs, no caller URL influence, streaming/multipart path, at-least-once idempotency, logical expiry,
  complete failure semantics, abort/delete cleanup, and no archive bytes in route responses.
- File-client tests inject XHR/fetch/auth/clock and assert initiate → direct S3 PUT → complete ordering, exact signed
  headers, 0→90→100 progress, abort/error/expiry propagation, no API body bytes, Cognito vs public auth, polling,
  and signed-result link behavior.

### Integration Tests

- Build the assembled API handler with fake Dynamo/S3/auth dependencies and invoke exact API Gateway v2 events for
  every CPA/public route. Assert early allowlist/404 behavior, actor resolution, request IDs, error shapes, and no
  dependency construction for unknown routes.
- Exercise a Submission containing dynamic `responses`, legacy flat arrays, removed-template steps, parallel
  `file_names`, and `signed_pdfs`; prove CPA preview and ZIP resolve the same server-owned ordered set.
- Exercise file completion plus ChangeJournal receipt/entry transaction, transport retry, conditional conflict,
  350KB/500-ref bounds, S3 compensation, and no bytes/signed URLs in serialized Dynamo items.
- Synthesize foundation contracts and verify two private buckets, only FilesBucket's narrow CORS, versioning,
  one-day temporary lifecycle, exact route auth, separate bounded ZIP worker, filtered trigger, workload boundary,
  and no public object origin.

### Edge Cases

- Missing/blank/malformed client token; missing, archived, wrong-year, stale, or cross-client Submission.
- Initiation succeeds but URL expires; partial/failed XHR; object absent at completion; declared/actual size or type
  mismatch; completion replay; journal failure after PUT; compensation failure reported safely for reconciliation.
- File names with Hebrew, emoji, slashes, quotes, control characters, reserved names, duplicate labels/extensions,
  no extension, misleading content type, and names absent from legacy records.
- New opaque refs, `private://...`, `private/...`, and `mp/...` imported refs loaded from records; never raw caller refs.
- Empty ZIP request; file removed between request and worker; zero-byte valid file; one inaccessible source; repeated
  event; worker timeout/failure; multipart abort; result exists but ready marker missing; job/result logically expired
  before S3 lifecycle physically deletes it.
- Archive/source larger than API/Lambda payload limits; assert only direct S3/browser/worker streams carry bytes.
- Signed URL query strings, client tokens, original filenames, contents, signatures, answers, and raw record refs are
  absent from logs, errors, analytics, committed fixtures, and implementation reports.

---

## VALIDATION COMMANDS

Execute every applicable local command. Deployment/live commands remain gated by explicit authorization.

### Level 1: Syntax & Style

```powershell
npm run typecheck:foundation
npm run lint:foundation
npm run typecheck
npm run lint
npm run build
python tooling/validate_codex_layer.py
git diff --check
```

Expected baseline handling: foundation checks and build pass. Full app typecheck/lint may retain only the documented
unrelated baseline; compare counts/paths and require zero diagnostics in every touched file.

### Level 2: Unit Tests

```powershell
npx vitest run src/api/__tests__/file-client.test.js src/api/__tests__/aws-client.test.js src/api/__tests__/base44-client.test.js src/api/__tests__/function-client.test.js src/lib/__tests__/submission-compat.test.js
npx vitest run --config vitest.foundation.config.js backend/api/__tests__/files-contract.test.ts backend/api/__tests__/pdf-template-repository.test.ts backend/api/__tests__/files-service.test.ts backend/api/__tests__/files-routes.test.ts backend/api/__tests__/zip-download.test.ts backend/api/__tests__/change-journal-contract.test.ts backend/api/__tests__/change-journal-service.test.ts
```

### Level 3: Integration and Contract Tests

```powershell
npm test
npm run test:foundation
node tooling/verify_sst_foundation.mjs --mode contract --stage test
```

### Level 4: Manual Validation

After explicit test-stage authorization:

1. Run `npm run sst:diff:test`; confirm only intentional file routes, narrow CORS, environment/link/IAM updates, ZIP
   worker/notification, Lambda code, and static assets change. No table/bucket replacement or deletion is allowed.
2. Run `npm run sst:deploy:test`, then
   `node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json`.
3. With invented disposable data, exercise public upload/resume, production iframe signed-artifact upload/view, CPA
   template base-PDF upload/read, dashboard single preview/download, and dashboard ZIP button without UI/copy change.
4. Direct-upload a benign object over 10 MB and prove browser→S3 carries bytes while API requests contain JSON only.
5. Attempt client A against client B's submission/template/ref, a manipulated firm/prefix/key, expired upload/read/job,
   and inaccessible ZIP source. Confirm no signed URL or partial ZIP and the safe current error surface.
6. Download two repeat ZIPs and compare stable names/order/content. Confirm logical result expiry and the configured
   one-day lifecycle/cleanup without claiming exact physical deletion time.
7. Inspect aggregate CloudWatch/journal evidence for action counts, error classes, and version evidence only. Confirm
   no token, signed URL, original filename, content, request body, signature, answer, or production identifier appears.

### Level 5: Additional Validation

```powershell
npm ci
npm ls @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage jszip
npm run sst:diff:test
```

Production preview/deploy and production data/file checks are intentionally absent; they require separate authority.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1 — Existing controls:** client-answer uploads, signed-artifact uploads/views, CPA template base-file
  uploads/reads, individual CPA previews, and ZIP download controls work through AWS with unchanged visible UI/copy
  and preserved `file_uri`, `file_names`, signed-PDF, template JSON, progress, and observable error shapes.
- [ ] **AC #2 — Ownership:** every upload/read/delete/ZIP operation authorizes the current public client or linked CPA
  actor and derives/validates a server-owned firm/client/submission/template prefix. Arbitrary, foreign, traversal,
  archived, wrong-year, cross-client, and cross-firm inputs produce no S3 access or signed URL.
- [ ] **AC #3 — Bodies bypass API:** initiation/completion/status contain metadata only; browser file bytes travel
  directly to S3; ZIP source/output bytes travel S3↔worker↔S3. Tests include a payload above the HTTP API limit and
  prove no API/Lambda body buffering.
- [ ] **AC #4 — Complete ZIP:** batch download derives all authorized current/legacy/signed references server-side,
  produces deterministic collision-safe names and complete contents, returns a short-lived S3 result, fails instead
  of silently omitting a source, and logically expires/physically lifecycle-cleans temporary artifacts.
- [ ] **AC #5 — Compatibility UX:** one-hour read behavior, upload progress, spinners, Hebrew toast/error surfaces,
  preview/modal/open/download interactions, ordering, and download names remain observable as before except for the
  explicitly required asynchronous/private transport.
- [ ] **AC #6 — ChangeJournal:** successful file creates and explicit deletes have bounded ordered File entries plus
  idempotency/version evidence; replacements use a unique new object plus the journaled owner-record pointer update;
  S3/Dynamo failure paths compensate or produce bounded reconciliation evidence and never record content.
- [ ] **AC #7 — Privacy and quality:** authorization, expiry, idempotency, conflict, missing-object, service failure,
  worker retry/cleanup, and log-redaction tests pass; no production content, real identifiers, client tokens,
  filenames, signatures, answers, signed URLs, or secrets enter logs or committed fixtures.
- [ ] All focused and full local validation commands pass subject only to the documented untouched frontend baseline.
- [ ] No Base44 Core file signer remains in the compatibility allowlist or any active production file path; remaining
  PDF/template/readiness deferrals are explicit and continue to shrink in issues #9/#10.
- [ ] No production deployment, data mutation, cutover, or source-repository modification occurs in this slice.

---

## COMPLETION CHECKLIST

- [ ] Issue #8, closed #6/#7, epic #1, current PRD/architecture, contracts, and branch state revalidated.
- [ ] Pinned dependencies and lockfile added under Node 20.17.0.
- [ ] Strict file contracts, shared public auth, PdfTemplate read repository, new/legacy resolver implemented.
- [ ] Upload initiation/direct PUT/completion and resource-scoped public/CPA reads implemented.
- [ ] File journal receipt/create/delete compensation implemented and covered.
- [ ] Server-derived asynchronous streaming ZIP request/worker/status implemented with complete failure semantics.
- [ ] SST CORS/worker/trigger/link/IAM/route/inventory/verifier contracts synchronized.
- [ ] Shared browser file client and every active production caller migrated; Base44 file signer removed.
- [ ] Focused frontend/backend/foundation tests pass.
- [ ] Full test, foundation typecheck/lint, build, contract verifier, Codex-layer validation, and diff check pass.
- [ ] Full frontend baseline compared with zero new/touched-path diagnostics.
- [ ] Test-stage diff inspected; deployment/live/manual evidence executed only if explicitly authorized.
- [ ] Aggregate-only implementation report records results, deviations, and any deferred POC/PDF paths.
- [ ] No production/private content, sensitive identifiers, tokens, filenames, signed URLs, or secrets recorded.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Assumption — architecture authority:** the 2026-08-23 canonical Wiki architecture has selected private versioned
  S3, direct presigned uploads, JSZip, and temporary S3 ZIP output. This plan's filtered S3-manifest notification is a
  ticket-level implementation of that selected boundary, not a new platform. If review requires SQS/EventBridge or a
  new job table, record that architecture amendment before implementation; do not silently add it.
- **Assumption — no File table:** durable authorization remains in Client/Submission/QuestionnaireTemplate/
  PdfTemplate records and server-owned key grammar; idempotency receipts live in the existing operational
  ChangeJournal table. Adding a general FileMetadata table changes the epic data model and requires architecture
  approval.
- **Assumption — current firm:** this epic remains single-firm. Keys still include an immutable current-firm scope and
  reject any caller-supplied firm so future tenancy cannot accidentally make today's references global.
- **Assumption — template authorization:** a public template file is signable only when its PdfTemplate ID is used by
  the authorized client's active/pinned QuestionnaireTemplate flow. This is stricter than Base44's valid-token + any
  template-ID implementation and follows issue #8's ownership criterion. If exact current configuration cannot prove
  the relationship, stop and get an owner/security decision rather than weakening to arbitrary template signing.
- **Assumption — ZIP completeness wins:** issue #8 explicitly requires a complete ZIP, so one inaccessible source
  fails the job; legacy silent omission is not preserved. The existing ClientRow error toast remains the visible
  failure surface.
- **Assumption — direct single PUT:** current browser file workflows fit S3's single-PUT ceiling. Enforce the ceiling
  in contracts and keep the two-phase interface extensible. If approved rehearsal aggregates reveal any individual
  file beyond that ceiling, multipart becomes a required amendment before execution.
- **Assumption — physical retention on reference removal:** removing a reference from a questionnaire journals the
  Submission change but may retain the versioned object for rollback until an explicit lifecycle/delete operation.
  Do not delete immediately after a successful optimistic save because cross-service failure would change save/retry
  semantics. Issue #10 should call the explicit owned delete seam for final entity/template deletion.
- **No critical user decision is currently required.** Any change to the worker mechanism, File table decision,
  public template authorization, or complete-vs-partial ZIP rule would materially change this plan and must be
  resolved before implementation.

## NOTES (open canvas)

### File data flow

```text
Browser ── JSON initiate ──> API Lambda ── authorize record/prefix ──> presigned PUT
Browser ═════════════════════════ direct file bytes ═════════════════> private FilesBucket
Browser ── JSON complete ──> API Lambda ── HeadObject + reauthorize ──> ChangeJournal receipt/entry
Browser <────────────────────────────── { file_uri } ───────────────── API Lambda

CPA ── Submission ID ──> API Lambda ── derive owned refs ──> private ZIP request manifest
TemporaryOutputsBucket request prefix ── async event ──> ZIP worker
ZIP worker ═════ streams FilesBucket objects → JSZip → multipart S3 ═══> result prefix
CPA ── job status ──> API Lambda ── reauthorize actor/expiry ──> short-lived result URL
```

### Why not reuse the legacy endpoints literally?

The old `uploadFile` consumes multipart bodies and therefore crosses the prohibited gateway/function payload path.
The old `createSignedUrl` signs an arbitrary URI. The old ZIP endpoint trusts caller URLs, silently loses failed
files, buffers everything, and returns bytes through the function. Their names and visible result shapes are useful
compatibility evidence; their security and transport mechanisms are precisely what issue #8 replaces.

### Sequencing/rollback risk

S3 and DynamoDB cannot share one transaction. Unique object keys remove overwrite races. Completion verifies the
object before journaling, a conditioned receipt makes replay stable, and an unjournaled object is compensated by
version-aware deletion. Deletion records the marker/version so a failed journal transaction can reveal the prior
version again. Pointer replacement is deliberately split: create the new immutable object first, then let the
existing journaled entity mutation swap the reference. Rollback evidence therefore identifies both the record
pointer and object versions without storing content.

### Confidence score

**8/10** for one-pass implementation. The ownership/auth/repository/journal seams and bucket resources already exist,
and source behavior is well evidenced. The main implementation risks are cross-service compensation/idempotency,
SST dynamic-origin CORS plus filtered notification syntax, JSZip streaming/backpressure, and the downstream #9/#10
boundary around PdfTemplate lifecycle. The plan makes each risk a focused contract/test before UI integration.

## AMENDMENTS

<!-- Append-only after initial approval/execution. -->
