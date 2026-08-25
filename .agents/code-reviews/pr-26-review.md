# PR #26 Review — Private S3 files and ZIP downloads

## Summary

PR #26 establishes a strong private-file boundary, but it is not ready to merge. The review found two High-severity
correctness defects: the migrated template-file path cannot operate while PdfTemplate records remain Base44-backed,
and concurrent duplicate S3 deliveries can race the ZIP worker into publishing a ready status for a deleted result.
A Medium-severity compensation gap can also leave a failed deletion hidden without durable reconciliation evidence.

## Findings

### Critical

None.

### High

#### 1. AWS template reads cannot resolve the templates still stored in Base44

Evidence: `src/pages/PdfTemplateEditor.jsx:62`, `src/pages/PdfTemplateEditor.jsx:514`,
`src/pages/PdfTemplateEditor.jsx:535`, `backend/api/services/files.ts:363`,
`backend/api/services/files.ts:574`, and `backend/api/services/files.ts:600`.

`PdfTemplateEditor` still lists, creates, and updates PdfTemplate records through the explicit Base44 compatibility
facade. The new CPA upload path authorizes non-pending owners only through `PdfTemplateTable`, and both CPA and public
read paths load only that DynamoDB repository. Existing Base44 templates therefore cannot initiate a private upload;
new templates may upload under `pending`, but the saved Base44 template ID still has no DynamoDB record, so subsequent
CPA and public reads return 404. This breaks template-base editing and the public signing flow as soon as they use a
new private S3 reference.

Fix: provide one authorization-preserving transitional source-of-truth bridge for PdfTemplate records, or persist an
AWS mirror before returning/saving the private reference. Add an integration test covering Base44-backed template
create, private upload, CPA read, and an authorized public read. Do not restore arbitrary reference signing.

#### 2. The ZIP worker is not idempotent under concurrent duplicate S3 deliveries

Evidence: `backend/api/workers/zip-download.ts:86`, `backend/api/workers/zip-download.ts:120`,
`backend/api/workers/zip-download.ts:132`, and `backend/api/__tests__/zip-download.test.ts:100`.

S3 notifications are at-least-once and may invoke two workers concurrently. Both workers can observe no terminal
status and upload to the same result object. If one invocation succeeds while the other fails, the failing invocation
unconditionally deletes the shared result and writes `failed`; the successful invocation can subsequently overwrite
the status with `ready`. The status route can then sign a result object that no longer exists. The existing test covers
only a later delivery after terminal status already exists, not overlapping deliveries.

Fix: acquire a conditional per-job lease before processing, or atomically create a processing lock/status. Only the
lease owner may upload/delete the result and publish terminal status. Add a concurrent duplicate-delivery regression
test in which one invocation succeeds and one fails.

### Medium

#### 3. Failed delete-marker restoration leaves no durable reconciliation evidence

Evidence: `backend/api/services/files.ts:796`.

After S3 deletion succeeds and the journal transaction fails, the service removes the versioned delete marker. If
that compensating S3 call also fails, its error escapes without durable bounded evidence containing the reference
hash, marker version, or operation identity. The object remains logically hidden with no File journal entry, and the
original journal failure is also displaced by the compensation failure.

Fix: handle restoration failure separately and write a privacy-safe retryable reconciliation record containing the
operation/reference hash and marker version while retaining the original failure context.

### Low

None.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | PASS — Node 20.17.0 and npm 10.8.2 |
| `npm ci` | PASS — known peer/engine/deprecation warnings; audit reports 31 findings |
| Direct dependency pins | PASS — S3 client, presigner, multipart helper, and JSZip resolve to exact versions |
| `npm test` | PASS — 10 files, 95 tests |
| `npm run test:foundation` | PASS — 27 files, 182 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run typecheck` | BASELINE — 151 diagnostics versus 233 documented; zero in changed frontend paths |
| `npm run lint` | BASELINE — 17 errors versus 23 documented; zero in changed source paths |
| `npm run build` | PASS — existing Browserslist-age notice only |
| SST contract verifier | PASS — test contract and worker inventory verified |
| Codex-layer validation | PASS — 31 skills and 6 custom agents |
| `git diff --check origin/main...HEAD` | PASS |
| `npm run sst:diff:test` | BLOCKED — cached AWS session returns `InvalidClientTokenId`; no mutation attempted |
| Live AWS/browser acceptance | NOT RUN — requires refreshed credentials and separately authorized deployment |

Local validation introduces no changed-path regression. The blocked external preview does not cause the code-review
verdict; the two High findings do.

## What is done well

- Strict ingress schemas reject raw URI/key/body/base64 signing paths.
- Public and CPA routes are resource-scoped, use short-lived URLs, and keep buckets private and versioned.
- Upload completion reauthorizes ownership, verifies S3 metadata, and compensates the exact object version when the
  journal transaction fails.
- ZIP inventory is server-derived and archive bytes stream from S3 through JSZip and multipart upload without crossing
  API Gateway.
- The tests cover authorization, contract validation, upload compensation, archive completeness, terminal replay,
  and partial-output cleanup broadly.

## Recommendation

**Request changes.** Resolve both High findings and add their regression tests before approval. Address the Medium
reconciliation gap in the same fix pass or explicitly defer it with durable operational handling and owner agreement.

## Resolution

All three findings were accepted and fixed on the PR branch:

- The authenticated template-file mirror now bridges Base44-backed template CRUD into the DynamoDB locator used by
  scoped CPA/public reads. Owned references require exact template/pending prefixes and matching S3 metadata; legacy
  references remain opaque deterministic migration inputs.
- The ZIP worker now atomically acquires a per-job S3 processing lock using `If-None-Match: *`. An overlapping event
  cannot upload, delete, or publish terminal state.
- A failed journal transaction followed by failed delete-marker restoration now produces a bounded durable
  `FILE_RECONCILIATION` record without the raw file reference and retains the original journal failure.

Regression coverage was added for each path. Final local validation passes with 96 frontend tests and 189
foundation/backend tests; changed-path type/lint remains clean. The SST preview remains externally blocked by the
invalid cached AWS session and requires operator credential refresh before live verification.

**Updated recommendation:** re-run the agentic review on the pushed fix commit before human approval.
