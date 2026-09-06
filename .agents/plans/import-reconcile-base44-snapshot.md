# Feature: Import and reconcile the Base44 snapshot in AWS

The following plan is complete for repository state `a1122cba55d3765085ad9fa45099b668fadfe8d4` after issue #10.
Before implementation, repeat the ticket, architecture, dependency, private-snapshot, AWS identity, and deployment
drift checks below. This work handles production tax records, access tokens, file references, and document bytes:
private inputs and checkpoints stay outside Git, and only bounded aggregate evidence may be committed.

## Feature Description

Build a resumable, fail-closed forward-migration tool that consumes the verified six-entity Base44 snapshot from
issue #5, imports its records into the existing SST DynamoDB tables, copies every referenced file into the private
SST `FilesBucket`, and independently reconciles source and destination. Preserve Base44 IDs, timestamps, tokens,
unknown fields, and JSON-encoded strings while adding only target metadata required by the AWS compatibility layer.

The import must be safe to restart after any record or file, must never overwrite a different destination value,
must distinguish pre-existing synthetic test fixtures from imported source data, and must produce aggregate-only
evidence with zero unresolved references. Legacy file reads remain disabled by default. They can be enabled in the
test stage only through an explicit, auditable deployment request that is bound to the verified evidence and sets
the same effective mode in both the API Lambda and ZIP worker.

## User Story

As the AuditFlow product owner, I want the complete verified Base44 snapshot imported and reconciled in AWS so that
existing records, links, templates, and files can be exercised safely before production cutover without weakening
the rollback or privacy boundaries.

## Problem Statement

The repository has a complete private source snapshot and a functional AWS compatibility runtime, but no bridge
between them. The AWS test stage currently contains disposable synthetic data, every legacy file reference is
deliberately rejected, and the checked-in file-cutover verifier validates only a small metadata stub. A naive bulk
load could overwrite synthetic or newer state, omit operational active-record guards, break Cognito-to-User linkage,
store the 622 deduplicated content files under keys that cannot satisfy all 687 source references, trust incomplete
pagination, or enable legacy reads without proving the deployed data.

## Solution Statement

Create a Node 20 `.mjs` operator CLI using the repository's pinned AWS SDK v3 clients. The CLI first invokes the
existing Python snapshot verifier and then performs a complete local preflight before any AWS write. It derives
target rows, stage-specific admin identity links, active-template/submission guard rows, and the exact
reference-to-object plan in memory. Every DynamoDB row uses strong-read/compare plus conditional create; every S3
object uses an immutable deterministic key, explicit SHA-256 metadata/checksum, conditional create, and streamed
rehash. A private atomic checkpoint outside the worktree makes partial runs resumable, while target equality makes
the operation idempotent even if the checkpoint is lost.

Reconciliation scans every table page and streams every imported S3 object, compares source projections, target
metadata, relationships, guards, reference closure, sizes, and hashes, and reports synthetic/non-imported target
items separately. Only a passing reconciliation may render schema-v2 aggregate evidence at the fixed repository
path. A pure SST gate resolver requires both that evidence and an exact explicit enablement request, passes the
evidence manifest hash to both runtime functions, and leaves all ordinary PR/push deployments pinned disabled.

The pre-import `legacy-sha256-v1` stub is superseded by `legacy-reference-sha256-v2`: hash the exact UTF-8 source
reference (the exporter's `referenceFingerprint`) into `legacy/<64hex>`, without trimming or normalizing it, and
support both Base44 private references and exporter-approved HTTPS references. This is necessary because content
deduplication produced 622 unique byte blobs but runtime lookup needs one addressable object for each of 687 unique
source references.

## Out of Scope / Non-Goals

- Not included: production import, DNS changes, making AWS the production writer, Base44 cancellation, or any
  production deployment; issue #15 owns those separately authorized operations.
- Not included: reverse replay of `ChangeJournal`; issue #12 owns reverse migration and rollback proof.
- Not included: PostHog, final release-readiness evidence, or the 72-hour production watch; issues #13-#15 own them.
- Not included: a cross-manifest delta/update algorithm. This ticket guarantees resume/replay of one immutable
  manifest. Issue #15 may extend the tool for a final delta if the final snapshot differs from a clean production
  target.
- Not included: rewriting legacy file references or normalizing `responses`, `pdf_inputs`, `signed_pdfs`,
  `cpa_audit_log`, `steps`, `template_json`, legacy flat submission fields, IDs, timestamps, or tokens.
- Not included: downloading from Base44 or public URLs during import. The importer reads only locally verified,
  content-addressed bytes from the private snapshot.
- Not included: creating real production Cognito accounts. The test rehearsal consumes an owner-approved private
  mapping to existing test-stage subjects; production identity creation/linking remains a cutover operation.
- Not included: journal entries for the pre-cutover forward load. `ChangeJournal` records post-cutover business
  mutations; the immutable source manifest, private checkpoint, target migration markers, and aggregate evidence are
  the import audit trail.
- Not changing: application UI, Base44 source data, the provenance-only external repository, Drive/Telegram
  deferrals, Terraform-owned PDF resources, or existing production infrastructure.
- Not permitted: committing snapshot paths, records, IDs, emails, tokens, references, filenames, document bytes,
  identity mappings, AWS responses containing data, or unredacted errors.

## Feature Metadata

**Feature Type**: New capability / migration tooling and deployment safety enhancement

**Estimated Complexity**: High

**Primary Systems Affected**: `tooling/`, SST deployment contracts, DynamoDB entity tables, private S3 file storage,
Cognito linkage validation, CI deployment controls, migration documentation

**Dependencies**: Node 20.17.0; Python 3.11+; AWS SDK v3 `3.1116.0`; AWS owner-authorized test profile;
verified private issue-#5 snapshot; `.sst/outputs.json`; private stage identity mapping; SST 3.19.3

## Related Work

**Implements**: [issue #11](https://github.com/noamtz/cpa-platform/issues/11) · **Epic**:
[issue #1](https://github.com/noamtz/cpa-platform/issues/1),
[PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration), and
[architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- `.agents/plans/inventory-export-base44-data-files.md` and
  `.agents/reports/inventory-export-base44-data-files-report.md` - define the immutable private snapshot, canonical
  hashes, recursive reference inventory, privacy boundary, and passing 366-record/687-reference rehearsal.
- `.agents/plans/establish-sst-serverless-aws-foundation.md` - establishes the target tables, buckets, account/region,
  retention, and deployment safety boundary.
- `.agents/plans/implement-cognito-core-cpa-compatibility.md` - establishes User/Cognito linkage, fail-closed duplicate
  handling, and the requirement that issue #11 link real preserved profiles before cutover.
- `.agents/plans/implement-private-s3-files-zip-downloads.md` - establishes private S3 references, deterministic
  legacy resolution, scoped signing, ZIP behavior, and the synthetic-only gate.
- `.agents/plans/complete-cpa-workflow-template-parity.md` - establishes target-required active guards, optimistic
  versions, and the now-complete AWS-only runtime surface.

**Forward-references**:

- [Issue #12](https://github.com/noamtz/cpa-platform/issues/12) consumes imported shapes and `ChangeJournal` for
  reverse replay proof.
- [Issue #14](https://github.com/noamtz/cpa-platform/issues/14) consumes aggregate import/reconciliation evidence.
- [Issue #15](https://github.com/noamtz/cpa-platform/issues/15) owns final production snapshot/import, user creation,
  DNS cutover, observation, and retirement.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` - migration status, source/target boundaries, AWS-only requirement, explicit authorization, and full
  validation matrix.
- `.agents/references/auditflow-submission-compatibility.md:1-7` - preserve JSON strings and legacy flat fields.
- `.agents/references/auditflow-api-security-contracts.md:1-8` - public token scope, file authorization, and observable
  error contracts.
- `.agents/references/auditflow-aws-operations.md:17-38` - strict stages, owner authorization, deploy-role boundary,
  and production prohibitions.
- `.agents/references/github-project-documents.md:72-102` - this plan is the canonical repository-backed artifact.
- `tooling/export_base44_snapshot.py:30-68` - six entities, snapshot/tool versions, known JSON fields, and private
  reference prefixes.
- `tooling/export_base44_snapshot.py:124-159` - exact Python canonical JSON and SHA-256 contract; do not substitute a
  different source-verification algorithm.
- `tooling/export_base44_snapshot.py:318-395` - stable ID ordering, per-record hashes, aggregate hashes, and NDJSON.
- `tooling/export_base44_snapshot.py:403-519` - exact recursive private/HTTPS discovery and occurrence pointers.
- `tooling/export_base44_snapshot.py:1333-1615` - immutable export, checkpoint, file mapping, and private manifest.
- `tooling/export_base44_snapshot.py:1619-1814` - mandatory offline rehash/re-discovery verifier before AWS writes.
- `tooling/export_base44_snapshot.py:2027-2145` - safe CLI arguments and redacted failure boundary to mirror.
- `tooling/tests/test_export_base44_snapshot.py:129-443` - canonicalization, inventory, recursion, duplicate-reference,
  and content-dedup fixtures.
- `tooling/tests/test_export_base44_snapshot.py:827-1054` - end-to-end verify/tamper/resume/failure test style.
- `docs/migration/base44-export-runbook.md:22-35,77-149` - private handoff, output layout, verification, reporting, and
  failure-handling rules.
- `docs/migration/base44-rehearsal-summary.json` - aggregate source expectations only; it is not an import manifest.
- `infra/sst/contracts.ts:46-153` - exact table keys/indexes and private/versioned bucket contract.
- `sst.config.ts:46-101` - stage assembly and the `tableNames`, `bucketNames`, pool, and function outputs the importer
  must validate rather than guess.
- `backend/api/contracts/entities.ts:40-51,91-121,144-158` - permissive persisted records, target `record_type`,
  `_version`, User linkage, and active-submission guard shape.
- `backend/api/contracts/public-questionnaire.ts:105-118` - questionnaire-template persisted shape.
- `backend/api/contracts/templates.ts:105-137` - questionnaire active guard and PDF-template persisted shape.
- `backend/api/repositories/submission.ts:27-57` - fixed `!ACTIVE#<client>#<year>` guard and duplicate-active behavior.
- `backend/api/repositories/questionnaire-template.ts:28-65` - fixed `!ACTIVE` guard and active-template behavior.
- `backend/api/repositories/user.ts:14-58` - unique Cognito-subject lookup and fail-closed duplicate behavior.
- `backend/api/contracts/files.ts:110-180` - owned/legacy key grammar and current pre-import v1 resolver to supersede.
- `backend/api/services/files.ts:366-370,573-601,851-867` - fail-closed signed reads and ZIP source authorization.
- `backend/api/workers/zip-download.ts:55-60,340-357,448-470` - independent worker gate and S3 read.
- `backend/api/contracts/change-journal.ts:3-65` and `backend/api/services/change-journal.ts:256-345` - business
  journal limits and why bulk forward import must not be forced through runtime mutation transactions.
- `tooling/verify_private_file_cutover.mjs:8-114` - current aggregate evidence verifier and CLI failure behavior.
- `infra/sst/application.ts:54-143` - current hardcoded `LEGACY_FILE_READS_ENABLED=false` in both functions.
- `infra/sst/contracts.ts:557-568` and `infra/sst/foundation-contract.json:161-171` - current issue-#11 gate metadata.
- `.github/workflows/deploy-sst-test.yml:130-166` - validation, soft evidence notice, deploy, and live verification
  order that must become explicit-mode aware.
- `infra/sst/__tests__/verify-private-file-cutover.test.js:14-83` - missing/invalid/stage-mismatch evidence tests.
- `infra/sst/__tests__/contracts.test.ts:419-435` - current synthetic-only wiring assertions.
- `tooling/verify_sst_foundation.mjs:289-304,785-804,968-981` - contract and live Lambda-mode checks.
- `base44/entities/{Client,Submission,QuestionnaireTemplate,PdfTemplate,SyncedDriveFile,User}.jsonc` - source fields
  and required relationships; source schemas are migration inputs, not target storage definitions.

### New Files to Create

- `tooling/import_base44_snapshot.mjs` - testable operator CLI, source preflight, target shaping, conditional import,
  private checkpointing, paginated reconciliation, and sanitized evidence rendering.
- `tooling/import_base44_snapshot.test.mjs` - synthetic AWS-client/stream/checkpoint/CLI tests; no live credentials.
- `infra/sst/private-file-cutover.ts` - pure explicit-mode/evidence resolver used during SST synthesis.
- `backend/api/core/runtime-config.ts` - shared fail-closed parser for the API/ZIP legacy-read boolean and manifest
  attestation environment.
- `backend/api/__tests__/runtime-config.test.ts` - direct truth-table coverage for disabled, enabled-and-bound, and
  malformed or partially configured runtime states.
- `docs/migration/base44-import-runbook.md` - private operator inputs, dry-run/import/resume/reconcile/evidence,
  enable/disable, acceptance, failure, and retention procedures.
- `docs/migration/private-file-import-verification.json` - generated only after the authorized passing test rehearsal;
  schema-v2 aggregate evidence with no private values.

### Existing Files to Update

- `package.json` / `package-lock.json` - add pinned `@aws-sdk/client-sts`, import/reconcile scripts, and include the
  new tool in strict foundation lint.
- `backend/api/contracts/entities.ts` plus User repository/auth tests - permit preserved non-admin User records to be
  unlinked while continuing to require unique linkage before CPA authorization succeeds.
- `backend/api/contracts/files.ts`, `backend/api/contracts/templates.ts`, every file resolver consumer, and their
  contract/service/worker tests - implement exact-reference v2 mapping consistently, including approved source HTTPS
  references, without external fetches or caller-selected signing.
- `infra/sst/contracts.ts`, `infra/sst/foundation-contract.json`, `infra/sst/application.ts`, `sst.config.ts` - define
  the v2 gate, evidence binding, explicit requested mode, and identical API/worker environment.
- `tooling/verify_private_file_cutover.mjs` and tests - validate the strict schema-v2 evidence and expose a pure
  result to the SST gate resolver.
- `tooling/verify_sst_foundation.mjs` and tests - accept an expected enabled/disabled mode and verify both functions
  plus the evidence manifest binding.
- `.github/workflows/deploy-sst-test.yml` - keep PR/push deployments disabled; allow a manual dispatch to select the
  separate `test-legacy-read-enable` Environment, require the expected manifest hash, and pass expected mode to live
  verification. The Environment itself must be configured with required owner review and main-only deployment.
- `README.md`, `AGENTS.md`, and `docs/migration/pdf-parity-runbook.md` - replace synthetic-only status after verified
  enablement and link the import/disable procedure without implying production authorization.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [DynamoDB BatchWriteItem API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html)
  - Specific section: 25-operation/16-MB limits, partial success, unprocessed items, and lack of conditions.
  - Why: confirms BatchWrite is unsuitable for collision-safe record import.
- [DynamoDB PutItem API](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html)
  - Specific section: `ConditionExpression` and replacement semantics.
  - Why: target creates must use `attribute_not_exists(id)` and compare after conditional races.
- [DynamoDB condition expressions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
  - Specific section: conditional put-if-absent.
  - Why: restart safety cannot silently overwrite a target row.
- [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
  - Specific section: 100-item/4-MB limits and 10-minute idempotency token window.
  - Why: explains why the pre-cutover load uses per-item convergence rather than the business journal transaction.
- [AWS SDK for JavaScript with DynamoDB](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/programming-with-javascript.html)
  - Specific section: SDK v3 pagination and retry behavior.
  - Why: scans must continue to `LastEvaluatedKey` exhaustion even when a page has no matching items.
- [S3 conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
  - Specific section: `If-None-Match: *`, 412 existing-object behavior, and 409 concurrent conflicts.
  - Why: imported reference objects are immutable and must never be last-writer-wins.
- [S3 PutObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)
  - Specific section: checksums, conditional requests, and versioning behavior.
  - Why: record explicit SHA-256, content length, metadata, and returned VersionId.
- [S3 HeadObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
  - Specific section: checksum mode, metadata, and 403/404 permission-dependent behavior.
  - Why: equality checks cannot infer absence solely from status without the correct bucket permissions.
- [S3 checksums with AWS SDK v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html)
  - Specific section: automatic CRC32 defaults and explicit checksum algorithms.
  - Why: use SHA-256 evidence; never treat an ETag as a content hash.
- [S3 ListObjectsV2 API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html)
  - Specific section: opaque continuation tokens.
  - Why: reconciliation must paginate to exhaustion.
- [AWS SDK retry behavior](https://docs.aws.amazon.com/sdkref/latest/guide/feature-retry-behavior.html)
  - Specific section: standard retry mode and attempt settings.
  - Why: SDK retries supplement, but do not replace, durable checkpoints and post-race equality checks.
- [SST StaticSite external domains](https://sst.dev/docs/component/aws/static-site/#domain-cert)
  - Why: reinforces that this ticket does not authorize production DNS/certificate work.

### Patterns to Follow

**Naming conventions:** operator tools use descriptive snake-case filenames and lower-camel JavaScript functions;
SST logical names remain PascalCase. Fixed operational items use reserved IDs beginning `!`. Evidence fields use
lower camel case and an explicit `schemaVersion`/`artifactType`.

**Source verification:** call the existing offline Python `verify` command before any AWS client write. Treat its
nonzero exit or any manifest gate/finding as terminal. Then validate the private manifest again at the import
boundary; never trust the checked-in aggregate rehearsal summary as source data.

**Target shaping:** preserve all source key/value pairs and embedded JSON strings. For Client, Submission,
QuestionnaireTemplate, PdfTemplate, and User, add `record_type`, a positive target `_version` (preserve a valid source
value, otherwise `1`), and the admin-only mapped `cognito_sub`. For SyncedDriveFile, preserve the opaque source row
and required `id`/`submission_id`/`created_date` GSI values without inventing an application schema or `record_type`.
Every source row adds exactly
`_auditflow_migration: { schema_version: 1, source: "base44", item_kind: "source_record", source_manifest_sha256,
source_record_sha256 }`. Reject a source `_auditflow_migration` or conflicting target-reserved value.

**Source parity projection:** compare full target items, including their complete marker, for idempotent equality.
Separately compare source parity by asserting that the target key set is exactly the source key set plus the
entity-specific additions above, and that every source key has a deeply equal value. Do not broadly strip underscore
fields or other unknown keys. The Python snapshot verifier remains authoritative for source canonical hashes; after
exact target/source semantic equality, evidence reuses the already verified per-entity source aggregate SHA-256.

**Idempotent Dynamo write:** strong `Get`; if absent, `PutCommand` with `attribute_not_exists(id)`; after a conditional
race, strong-read again. Skip only when the complete desired target hash matches. A different item at the same ID is
a terminal `target_record_conflict`, including synthetic records.

**Derived guards:** after complete local relationship validation, create the exact strict questionnaire guard
`{ id: "!ACTIVE", record_type: "!ACTIVE_GUARD", active_template_id, active_version, _version: 1 }` and the exact
strict submission guard `{ id: "!ACTIVE#<client>#<year>", record_type: "!ACTIVE_GUARD", submission_id, client_id,
tax_year }` for every non-archived Submission with a valid tax year, regardless of client status or completion.
Guards contain no migration marker because their runtime Zod schemas are strict. They are excluded from six-entity
source counts and separately reconciled. Multiple active candidates are blockers.

**User linkage:** the private identity map is outside the repository and maps the exact two source admin record IDs
to two distinct existing stage Cognito subjects. Validate the subjects against `outputs.userPoolId`, reject duplicate
or missing mappings, and never log either side. Non-admin historical User records may remain unlinked; authorization
continues to require one unique linked admin record.

**Reference mapping:** validate each manifest `sourceReference`, assert its SHA-256 equals the manifest
`referenceFingerprint`, and write its verified content bytes to `legacy/<referenceFingerprint>`. Do not use the
content hash as the runtime key. Duplicate byte content still creates one immutable object per distinct reference.
The stored source records remain unchanged.

**S3 equality:** use `HeadObject` only as a cheap first check. Skip an existing object only after metadata/length and a
streamed `GetObject` SHA-256 match. Create with `IfNoneMatch: "*"`, explicit base64 SHA-256, length, non-sensitive
metadata, and no public ACL; re-read/rehash after a 409/412 or successful put.

**Pagination:** DynamoDB Scan and S3 ListObjectsV2 continue until the continuation token is absent, regardless of
empty filtered pages. Reconciliation compares the complete imported marker set and reports all non-imported target
items separately; it never ignores arbitrary extras.

**Error handling/privacy:** mirror `SnapshotFailure`-style bounded categories. Standard output contains only stage,
counts, hashes, gates, and status. Raw SDK errors, records, keys derived from references, snapshot/checkpoint paths,
identity values, and response bodies never cross the top-level error boundary.

**Deployment gate:** evidence never enables reads automatically. Normal PR/push workflows set
`AUDITFLOW_ENABLE_LEGACY_FILE_READS=false`. A manual dispatch can set it to `true` only when it also supplies
`expected_legacy_import_manifest_sha256`, selects the separately configured `test-legacy-read-enable` Environment,
and passes its required owner review/main-only policy. SST accepts only the exact strings `true|false`, rejects
enabled mode outside stage `test`, revalidates stage-matched evidence before diff, and compares the requested hash to
the artifact's `sourceManifestSha256`. The exact artifact hash is then supplied to both functions and checked live.

**Runtime manifest binding:** `LEGACY_FILE_IMPORT_MANIFEST_SHA256` is an attestation, not a per-reference allowlist.
API and ZIP startup/config parsing treats enabled+missing/malformed hash as disabled/failure, while the live verifier
requires both functions to be true with the exact artifact hash. Disabled mode requires both booleans false and both
hash variables empty/absent. Individual access remains protected by record ownership plus S3 object existence.

### Exact schema-v2 aggregate evidence contract

The renderer and every consumer use this exhaustive shape; unknown keys are rejected. `sha256` values are lowercase
64-hex, timestamps are canonical UTC ISO strings, counts are safe nonnegative integers, the six entity counts are
positive, `referenceObjectCount === referenceCount`, `uniqueContentCount <= referenceCount`, and
`unresolvedReferenceCount === 0`. `verifiedAt` cannot be more than five minutes in the future or more than 72 hours
old when enablement is requested. Reconciliation can refresh it only by re-reading the complete target.

```json
{
  "schemaVersion": 2,
  "artifactType": "PRIVATE_FILE_IMPORT_VERIFICATION",
  "stage": "test",
  "status": "verified",
  "resolverContract": "legacy-reference-sha256-v2",
  "importToolVersion": "1.0.0",
  "sourceSnapshotCompletedAt": "2026-01-01T00:00:00.000Z",
  "verifiedAt": "2026-01-01T01:00:00.000Z",
  "sourceManifestSha256": "<64 lowercase hex>",
  "entities": {
    "Client": { "count": 1, "aggregateSha256": "<64 lowercase hex>" },
    "Submission": { "count": 1, "aggregateSha256": "<64 lowercase hex>" },
    "QuestionnaireTemplate": { "count": 1, "aggregateSha256": "<64 lowercase hex>" },
    "PdfTemplate": { "count": 1, "aggregateSha256": "<64 lowercase hex>" },
    "SyncedDriveFile": { "count": 1, "aggregateSha256": "<64 lowercase hex>" },
    "User": { "count": 1, "aggregateSha256": "<64 lowercase hex>" }
  },
  "totals": {
    "sourceRecordCount": 6,
    "importedRecordCount": 6,
    "derivedGuardCount": 2,
    "nonImportedTargetRecordCount": 0,
    "referenceCount": 1,
    "referenceObjectCount": 1,
    "uniqueContentCount": 1,
    "referenceObjectBytes": 1,
    "uniqueContentBytes": 1,
    "unresolvedReferenceCount": 0
  },
  "gates": {
    "sourceVerified": true,
    "recordsReconciled": true,
    "relationshipsValid": true,
    "guardsReconciled": true,
    "filesReconciled": true,
    "syntheticSeparated": true,
    "privacySafe": true
  }
}
```

---

## IMPLEMENTATION PLAN

### Phase 1: Drift lock and offline contracts

Revalidate the issue/epic/architecture, dependency merges, exact source snapshot, current AWS output contract, and
test-stage authorization boundary. Define strict private manifest, checkpoint, identity-map, target item, resolver,
and schema-v2 evidence contracts before any I/O implementation.

**Tasks:**

- Add pure parsers and validators for CLI arguments, outputs, manifests, identity maps, migration markers, and
  aggregate evidence.
- Add exact-reference v2 mapping and synthetic fixtures covering both private and HTTPS source references.
- Add a complete local preflight that verifies all records, references, relationships, and derived guards before AWS.

### Phase 2: Resumable conditional import

**Depends on:** Phase 1.

Implement bounded AWS clients and private checkpointing. Import deterministic Dynamo rows/guards and one immutable S3
object per reference with compare-before-skip behavior and safe retry/race handling.

**Tasks:**

- Verify AWS identity, region, stage outputs, table/bucket inventory, pool, and source/target emptiness/conflicts.
- Add atomic private checkpoints bound to tool version, source manifest hash, stage, target resource fingerprints,
  and identity-map hash.
- Import/replay records, guards, and reference objects without BatchWrite or last-writer-wins behavior.

### Phase 3: Independent reconciliation and aggregate evidence

**Depends on:** Phase 2.

Read all target pages and every imported S3 object, project out target-only metadata, verify source semantics and all
integrity constraints, and render the sole commit-safe evidence artifact only after every gate passes.

**Tasks:**

- Compare per-entity IDs/counts/projection hashes and derived guards.
- Verify all reference keys, content SHA-256 values, lengths, metadata, and exact closure.
- Distinguish non-imported synthetic items and fail on collisions or imported-marker drift.
- Generate strict aggregate JSON and a private detailed report/checkpoint outside Git.

### Phase 4: Explicit legacy-read enablement and rollback-to-disabled

**Depends on:** Phase 3 evidence contract.

**Independent of:** live data import while pure unit/contract tests are being developed.

Replace the hardcoded synthetic mode with an explicit requested mode that defaults false, requires valid evidence to
be true, applies identically to API and ZIP worker, and binds both to the verified manifest hash. Keep automatic
deployments disabled and make live verification mode-aware.

**Tasks:**

- Add pure SST gate resolver and synchronized source/JSON contracts.
- Add protected manual workflow input and pre-diff refusal on invalid enablement.
- Extend live verifier for expected mode and evidence hash.
- Document one-command disable/redeploy recovery that never deletes imported data.

### Phase 5: Authorized test rehearsal and acceptance

**Depends on:** Phases 1-4 and explicit owner authorization for the exact test data/AWS/deployment scope.

Run offline verification, dry-run, deliberate interruption/resume, import, full reconciliation, evidence rendering,
code review, explicit enablement deployment, and scoped browser/API acceptance against the imported rehearsal.
Retain or remove synthetic fixtures only through a separately approved, exact process.

**Tasks:**

- Complete the two-admin private test identity map without committing identifiers.
- Prove idempotent rerun and no duplicate/collision behavior.
- Commit aggregate evidence only after privacy scanning and review.
- Deploy enablement through the protected manual path, verify both functions live, and exercise authorized/denied
  public/CPA/ZIP reads.
- Rehearse returning to disabled mode and prove legacy reads fail closed again.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. REVALIDATE ticket, architecture, dependencies, source handoff, and target stage

- **IMPLEMENT**: Fetch issue #11, epic #1, canonical Wiki PRD/architecture, and current Project state through the
  repository-bound GitHub identity. Confirm issues #4, #5, and runtime dependencies #6-#10 are merged. Verify
  `origin`, clean feature branch, current table/bucket contracts, and absence of an already accepted issue-#11 plan.
  Run the current Python offline verifier against the exact privately handed-off snapshot; compare only aggregate
  results to the checked-in rehearsal summary. Verify `.sst/outputs.json` is stage `test` and names exactly the
  contract resources. No AWS write occurs.
- **PATTERN**: `.agents/references/github-project-documents.md:104-123`; `base44-export-runbook.md:77-107`.
- **GOTCHA**: the committed rehearsal says exporter `1.0.0` while current code is `1.1.0`; acceptance requires the
  current verifier to pass, not editing the private manifest. If it fails, stop and create a new separately
  authorized read-only snapshot rather than weakening verification.
- **VALIDATE**: `python tooling/export_base44_snapshot.py verify --snapshot <absolute-private-run-path>; node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json`
- **SATISFIES**: AC 1, AC 3, AC 4, AC 10.

### 2. CREATE `tooling/import_base44_snapshot.mjs` contract and pure preflight layer

- **IMPLEMENT**: Add strict subcommands `doctor`, `plan`, `import`, `reconcile`, and `evidence`; accept only exact
  `test|production`, absolute outside-worktree snapshot/checkpoint/identity paths, `.sst/outputs.json`, `--resume`,
  and stage-specific confirmation. Reject sensitive values and URLs in argv. Load and validate the private manifest,
  invoke the Python offline verifier before exposing a write-capable target, recompute its raw/canonical SHA-256,
  validate all six NDJSON inventories, reference/file mappings, zero findings, and complete gates. Return bounded
  error categories through one redacted top-level handler.
- **PATTERN**: `export_base44_snapshot.py:124-307,2027-2145`; `configure_cognito_refresh_rotation.mjs:19-121` for
  strict output parsing.
- **IMPORTS**: Node `fs`, `path`, `crypto`, `stream`, `child_process`; Zod only if it can remain fully testable and
  does not expose private validation payloads.
- **GOTCHA**: instantiate no Dynamo/S3 client until the entire source/relationship/identity preflight succeeds.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/import_base44_snapshot.test.mjs -t "offline preflight"`
- **SATISFIES**: AC 1, AC 3, AC 4, AC 9, AC 10.

### 3. ADD target-shaping, identity, relationship, and guard contracts

- **IMPLEMENT**: Derive each target item by preserving all source values and adding only `record_type`, target
  `_version`, and `_auditflow_migration` where the entity-specific contract above permits them. Treat SyncedDriveFile
  as opaque source passthrough plus its marker and required PK/GSI fields; add no runtime repository/schema. Validate
  the exact source-key-union target projection, required GSI fields, and existing target schemas. Require a private
  exact two-admin ID→Cognito-subject map, unique stage subjects, and no unmapped admin. Permit preserved non-admin
  Users without `cognito_sub`; ensure auth still rejects zero/duplicate linked admins. Validate Submission→Client,
  Submission→QuestionnaireTemplate/PdfTemplate when present, SyncedDriveFile→Submission, template-version coherence,
  exactly one active questionnaire template with valid `version`/`is_active`/`steps`, and at most one non-archived
  submission per client/year. Derive the exact strict, marker-free guards for every non-archived Submission with a
  tax year and fail before writes on any ambiguity.
- **PATTERN**: `entities.ts:40-51,101-121,144-158`; `submission.ts:27-57`;
  `questionnaire-template.ts:28-65`; `user.ts:46-58`.
- **GOTCHA**: do not “repair” ghost template references, duplicate active rows, missing timestamps, malformed JSON,
  or legacy business values. Report a private bounded finding and block evidence.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/import_base44_snapshot.test.mjs backend/api/__tests__/user-repository.test.ts backend/api/__tests__/auth.test.ts -t "target|identity|relationship|guard|unlinked"`
- **SATISFIES**: AC 1, AC 3, AC 4, AC 8, AC 9.

### 4. UPDATE `backend/api/contracts/files.ts` to `legacy-reference-sha256-v2`

- **IMPLEMENT**: Validate Base44 private and well-formed HTTPS stored references without fetching them. Map the exact
  unmodified UTF-8 reference to `legacy/<sha256>`, equal to the export manifest fingerprint; retain the owned
  `private://files/...` path unchanged. Reject controls, backslashes, encoded separators, traversal segments,
  malformed URLs, credentials, non-HTTPS schemes, and oversized values. Update `privateFileKeySchema`,
  `parsePrivateFileReference`, `resolveStoredFileReference`, PDF-template base-file validation, FileService, ZIP
  worker, verifier/contract resolver strings, and their tests as one synchronized contract.
- **PATTERN**: `files.ts:110-180`; exporter `classify_reference`/fingerprint at `403-455`.
- **GOTCHA**: do not trim before hashing and do not let this resolver perform network I/O. File endpoints still derive
  references from authorized records; there is no arbitrary-key signing endpoint. Add a whitespace-bearing raw
  fixture proving exporter fingerprint, Files, PDF-template, and ZIP behavior agree.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/files-contract.test.ts backend/api/__tests__/files-service.test.ts backend/api/__tests__/template-service.test.ts backend/api/__tests__/zip-download.test.ts -t "legacy|HTTPS|reference"`
- **SATISFIES**: AC 1, AC 5, AC 6, AC 8.

### 5. ADD AWS identity/resource doctor and private atomic checkpoint

- **IMPLEMENT**: Add pinned STS client and configure STS/DynamoDB/S3/Cognito clients for `il-central-1` with bounded
  standard retries. Require an expected account value from the private operator environment, compare STS identity,
  validate exact stage outputs/resource names, describe all six tables, verify FilesBucket versioning/encryption,
  and validate identity-map subjects in the output pool. Create an atomic checkpoint outside the repository bound to
  schema/tool version, manifest hash, stage, table/bucket/pool fingerprints, identity-map hash, and completed unit
  hashes. Resume revalidates all bindings; concurrent import for the same checkpoint fails closed.
- **PATTERN**: exporter containment/atomic/lock helpers `179-307,996-1329`; `sst.config.ts:66-101` outputs.
- **IMPORTS**: add `@aws-sdk/client-sts@3.1116.0`; reuse pinned DynamoDB, lib-dynamodb, S3, and Cognito clients.
- **GOTCHA**: the owner operator—not the restricted deploy role—needs only the scoped import permissions:
  STS identity; DynamoDB Describe/Get/Put/Scan on the six tables; S3 ListBucket plus Head/Get/Put on `legacy/*`;
  Cognito Describe/List/AdminGet for the test pool; and checksum-related KMS decrypt only if the deployed bucket key
  requires it. `HeadObject` uses `ChecksumMode: "ENABLED"`; any 403 is terminal and never treated as absence. Never
  print account/profile names, subjects, resource names, private paths, or SDK response bodies.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/import_base44_snapshot.test.mjs -t "doctor|checkpoint|resume|lock"`
- **SATISFIES**: AC 2, AC 7, AC 10, AC 11.

### 6. IMPLEMENT conditional DynamoDB entity and guard import

- **IMPLEMENT**: For all six entity items and derived guards, perform strong Get→compare; conditionally create absent
  rows with `attribute_not_exists(id)`; after a conditional race, strong-read and compare again. Checkpoint each exact
  desired hash after confirmed convergence. Reject any different existing item, reserved-key conflict, schema-invalid
  runtime record, invalid opaque SyncedDriveFile PK/GSI value, item over 400 KB, incomplete page, or source/target
  marker mismatch. Guards must exactly satisfy their strict schemas and contain no marker. Do not use BatchWriteItem
  or write ChangeJournal entries.
- **PATTERN**: repository DocumentClient construction in `backend/api/handler.ts`; AWS conditional patterns in
  `services/cpa-workflows.ts`; source checkpoints in `export_base44_snapshot.py:1021-1069`.
- **GOTCHA**: DynamoDB Scan/Query pages are capped at 1 MB. A filtered empty page with `LastEvaluatedKey` is not done.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/import_base44_snapshot.test.mjs -t "Dynamo|conditional|collision|partial resume"`
- **SATISFIES**: AC 1, AC 2, AC 3, AC 4, AC 9, AC 11.

### 7. IMPLEMENT immutable per-reference S3 import

- **IMPLEMENT**: For every downloaded manifest reference, verify its local content path containment, size, and
  SHA-256; derive `legacy/<referenceFingerprint>`; strong-check any existing object with Head metadata plus streamed
  Get hash; otherwise Put with `IfNoneMatch:*`, explicit `ChecksumSHA256`, `ContentLength`, private defaults, and
  non-sensitive resolver/content/manifest metadata. Handle 409/412 by rereading and comparing. Checkpoint only after
  confirmed equality. Use bounded concurrency and backpressure; no signed URL or source fetch.
- **PATTERN**: exporter content store `652-779,1446-1469`; FilesBucket versioning `infra/sst/storage.ts:35-74`.
- **GOTCHA**: ETag is not a content hash. The expected object count is unique references, not unique content. Two
  reference fingerprints pointing to the same content SHA still need two runtime keys.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/import_base44_snapshot.test.mjs -t "S3|checksum|duplicate content|immutable|race"`
- **SATISFIES**: AC 1, AC 2, AC 4, AC 5, AC 8, AC 11.

### 8. IMPLEMENT exhaustive target reconciliation and synthetic separation

- **IMPLEMENT**: Paginate full strong table scans and S3 legacy-prefix listing. Compare every imported marker/item
  with the desired full-target hash, then use the exact source-key-union projection contract to compare source
  semantics without broad stripping. The Node importer must not claim to reproduce Python source canonical hashes;
  it reuses those hashes only after the Python verifier passes and exact target/source deep equality is established.
  Verify per-entity
  counts/aggregate projection hashes, timestamps/IDs/tokens/raw strings, all relationships, guard count/content,
  identity links, reference key set, S3 metadata, streamed content hashes/sizes, and zero unresolved entries.
  Partition non-imported target items and owned S3 keys into separately counted synthetic/operational categories;
  fail on ID/key collisions or malformed migration markers. Store detailed findings only in the private checkpoint.
- **PATTERN**: exporter verifier `1619-1814`; foundation live verifier pagination/assertion style
  `tooling/verify_sst_foundation.mjs:616-809`.
- **GOTCHA**: an arbitrary target extra is not silently “synthetic.” Only records without the current import marker
  and without source-key collision may be counted separately; include their counts, never IDs, in evidence.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/import_base44_snapshot.test.mjs -t "reconcile|pagination|synthetic|extra|tamper"`
- **SATISFIES**: AC 1, AC 3, AC 4, AC 5, AC 8, AC 9, AC 10, AC 11.

### 9. CREATE strict schema-v2 aggregate evidence rendering

- **IMPLEMENT**: Permit `evidence` only from the current private checkpoint's passing reconciliation. Atomically
  write the exhaustive schema-v2 JSON shown above. Validate exact constants, six keys, equality/ordering/count/hash
  constraints, canonical timestamps, and seven named true gates. Add field-allowlist privacy validation that allows
  only the declared constants, ISO timestamps, safe semver, counts, and aggregate/manifest SHA-256 values; enforce
  `referenceObjectBytes >= uniqueContentBytes`; reject
  unknown fields and any raw record ID, reference fingerprint list, email, token, URL, path, filename, or resource.
- **PATTERN**: exporter `sanitized_summary` at `1817-1893`; current cutover verifier `19-45`.
- **GOTCHA**: do not emit the private checkpoint, target resource names, Cognito subjects, item keys, S3 keys,
  VersionIds, or detailed failure categories containing record context.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/import_base44_snapshot.test.mjs infra/sst/__tests__/verify-private-file-cutover.test.js -t "evidence|privacy|schema v2"`
- **SATISFIES**: AC 4, AC 5, AC 7, AC 9, AC 10, AC 11.

### 10. CREATE `infra/sst/private-file-cutover.ts` and wire explicit mode

- **IMPLEMENT**: Add a pure resolver receiving exact stage, explicit requested flag, and repository root. Default to
  disabled. Accept only exact string `true|false`; reject true outside stage `test`. On a true request, load and
  validate schema-v2 evidence, require stage/resolver/freshness and every gate, and compare the artifact's
  `sourceManifestSha256` to `AUDITFLOW_EXPECTED_LEGACY_IMPORT_MANIFEST_SHA256`; then return
  `{ enabled: "true", manifestSha256 }` or throw before synthesis. SST cannot read the private manifest at deploy
  time—the explicit expected hash plus reviewed evidence supplies the binding. Pass the result
  through `sst.config.ts` to both API and ZIP worker as `LEGACY_FILE_READS_ENABLED` and
  `LEGACY_FILE_IMPORT_MANIFEST_SHA256`. Use a shared runtime parser so enabled mode is effective only with an exact
  64-hex hash; disabled mode sets false/empty regardless of evidence presence.
- **PATTERN**: strict stage parsing in `infra/sst/stage.ts`; application env at `79-125`.
- **GOTCHA**: evidence presence is not an enablement request; a malformed truthy string is rejected, never coerced.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js infra/sst/__tests__/contracts.test.ts infra/sst/__tests__/verify-private-file-cutover.test.js -t "legacy|enable|evidence|binding"`
- **SATISFIES**: AC 6, AC 7, AC 11.

### 11. UPDATE deployment contract, CI workflow, and live verifier

- **IMPLEMENT**: Synchronize TypeScript/JSON contracts to resolver/evidence v2 and enabled/disabled/hash environment.
  Add `workflow_dispatch` boolean `enable_legacy_file_reads` default false and required string
  `expected_legacy_import_manifest_sha256` when true. PR/push jobs explicitly export false and empty expected hash.
  Manual true runs select the separately configured `test-legacy-read-enable` GitHub Environment, whose required
  reviewer and main-only branch policy must be created/read back before use; absence of that protection blocks live
  enablement. Only when `github.event_name == 'workflow_dispatch'` and the typed input is true may the job export
  `AUDITFLOW_ENABLE_LEGACY_FILE_READS=true` and the expected hash. Run evidence validation before SST diff/deploy and
  fail on any mismatch. Pass expected mode/evidence to the live verifier. Default verifier invocation means disabled:
  both booleans false and both hashes empty. Enabled requires both true and exact artifact hash. Reject mismatched
  functions, enabled+missing/malformed hash, disabled+nonempty hash, stage mismatch, evidence with unknown/false
  fields, and malformed CLI combinations. Add a static workflow-policy test proving ordering/environment/input rules.
- **PATTERN**: deployer preflight ordering at `.github/workflows/deploy-sst-test.yml:117-166`; live function checks at
  `verify_sst_foundation.mjs:785-804,968-981`.
- **GOTCHA**: do not let a merge of the evidence file auto-enable test. GitHub Environment protection is an
  operational prerequisite for the manual enablement run, not a substitute for the in-code gate.
- **VALIDATE**: `npm run test:foundation; npm run typecheck:foundation; npm run lint:foundation; node tooling/verify_sst_foundation.mjs --mode contract --stage test`
- **SATISFIES**: AC 6, AC 7, AC 11.

### 12. ADD runtime legacy-read positive/negative regression coverage

- **IMPLEMENT**: Extend file-service/worker tests for disabled private and HTTPS references, enabled imported keys,
  authorized public/CPA template and signed-PDF reads, ZIP entries, unresolved references, arbitrary caller values,
  cross-client ownership, missing objects, and invalid runtime enablement/hash combinations. The hash environment is
  deployment attestation only and does not claim per-reference membership. Assert disabled paths do not call S3 or
  create jobs and all denial surfaces retain current 404 behavior.
- **PATTERN**: `backend/api/__tests__/files-service.test.ts:296-416,546-803,903-946`; worker tests alongside
  `backend/api/workers/zip-download.ts`.
- **GOTCHA**: positive tests use invented hashes/bytes only; never add a real source reference or URL to fixtures.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/runtime-config.test.ts backend/api/__tests__/files-contract.test.ts backend/api/__tests__/files-service.test.ts backend/api/__tests__/template-service.test.ts backend/api/__tests__/zip-download.test.ts`
- **SATISFIES**: AC 5, AC 6, AC 8, AC 11.

### 13. CREATE `docs/migration/base44-import-runbook.md` and update operating contracts

- **IMPLEMENT**: Document private prerequisites, current snapshot verification, expected account/region, identity
  map, test-only confirmations, `doctor`→`plan`→`import`→interrupt/resume→`reconcile`→`evidence`, failure categories,
  evidence privacy review, required `test-legacy-read-enable` Environment configuration/read-back, manual enablement,
  live acceptance, exact false-mode dispatch/redeploy and disabled-verifier command, snapshot/checkpoint retention,
  and production prohibition. Update README/AGENTS/PDF runbook only to the verified current status.
- **PATTERN**: `docs/migration/base44-export-runbook.md`; README SST operations section.
- **GOTCHA**: examples use placeholders and environment variables; no private path, profile/account value, identity,
  token, reference, or resource name appears in committed docs. Evidence is committed/reviewed on `main` first; that
  ordinary push remains unconditionally disabled. Only the later owner-approved protected dispatch may enable it.
- **VALIDATE**: `rg -n "TODO|<real|private://|@.*\.|006296770641" docs/migration/base44-import-runbook.md README.md AGENTS.md docs/migration/pdf-parity-runbook.md; python tooling/validate_codex_layer.py`
- **SATISFIES**: AC 2, AC 7, AC 10, AC 11.

### 14. RUN the full local validation and pre-commit review

- **IMPLEMENT**: Install under Node 20.17.0, run focused importer/runtime/gate tests, exporter tests, full application,
  foundation, PDF, type/lint/build, contract, privacy, and diff checks. Compare inherited frontend failures to the
  committed baseline rather than claiming zero. Run `$piv-review-changes` and resolve every in-scope finding before
  any live import.
- **PATTERN**: `AGENTS.md` validation matrix; latest PR #28 report for current 110/267/22 test baselines.
- **GOTCHA**: local Node 24 success is not the required runtime gate; use CI Node 20.17 if Windows nvm remains blocked.
- **VALIDATE**: `npm ci; python -m unittest discover -s tooling/tests -v; npm test; npm run test:foundation; npm run test:pdf; npm run typecheck:foundation; npm run lint:foundation; npm run build; node tooling/verify_sst_foundation.mjs --mode contract --stage test; python tooling/validate_codex_layer.py; git diff --check`
- **SATISFIES**: AC 1-11.

### 15. EXECUTE owner-authorized test import, reconciliation, and evidence

- **IMPLEMENT**: After explicit authorization for this exact AWS/test-data scope, verify the owner AWS identity,
  complete the private two-admin mapping to distinct existing test subjects, run `doctor` and no-write `plan`, start
  import, deliberately interrupt after durable progress, resume, reconcile, rerun the complete import to prove
  idempotence, and render the fixed evidence file. Independently review aggregate counts against the snapshot and
  scan the evidence/diff for sensitive values. Do not deploy enablement in this task step.
- **PATTERN**: issue-#5 deliberate resume rehearsal and aggregate handoff.
- **GOTCHA**: target conflicts, missing subjects, new source findings, object mismatches, or extra imported markers
  stop the run. Do not clean or overwrite existing fixtures automatically.
- **VALIDATE**: `node tooling/import_base44_snapshot.mjs doctor --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json; node tooling/import_base44_snapshot.mjs plan --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json; node tooling/import_base44_snapshot.mjs import --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json --confirm-test-import; <interrupt after a reported durable checkpoint and rerun the same command with --resume>; <rerun the completed import once more and require zero writes>; node tooling/import_base44_snapshot.mjs reconcile --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json; node tooling/import_base44_snapshot.mjs evidence --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json --output docs/migration/private-file-import-verification.json; npm run verify:file-cutover:test`
- **SATISFIES**: AC 1-5, AC 9, AC 10.

### 16. DEPLOY explicit test enablement and run acceptance/disable rehearsal

- **IMPLEMENT**: With separate explicit deployment authorization, inspect `sst diff` for only expected Lambda env/site
  artifacts, dispatch the protected workflow with legacy reads enabled, and verify both live functions and manifest
  binding. Exercise representative imported public token questionnaire/file/PDF reads, CPA-authorized file/template
  reads, and ZIP completion; prove invalid token, cross-client, unresolved, and arbitrary references fail closed.
  Record only aggregate results. Then dispatch/deploy disabled mode, verify both functions false, and repeat a negative
  legacy probe. Re-enable only if the owner accepts the rehearsal and issue scope still requires it. The protected
  environment and evidence must already be committed/read back from `main`; enabled production is rejected in #11.
- **PATTERN**: `docs/migration/pdf-parity-runbook.md` synthetic acceptance and rollback-switch procedure.
- **GOTCHA**: do not expose presigned URLs or use production DNS/data. A passing import is not production-cutover
  authorization. Disabling reads does not delete imported objects or records.
- **VALIDATE**: `npm run sst:diff:test; npm run verify:file-cutover:test; <dispatch protected test workflow with enable_legacy_file_reads=true and exact expected manifest SHA>; node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json --legacy-file-reads enabled --evidence docs/migration/private-file-import-verification.json; <dispatch protected test workflow with enable_legacy_file_reads=false>; node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json --legacy-file-reads disabled; <run negative legacy read and ZIP no-side-effects probe>`
- **SATISFIES**: AC 5-8, AC 11.

---

## TESTING STRATEGY

### Unit Tests

- Strict CLI pair parsing, exact stages, absolute/outside-worktree paths, confirmation gates, sensitive argv
  rejection, redacted unknown failures, and no client creation before preflight.
- Source manifest/version/entity/file/reference validation, Python verifier failure, tampered NDJSON/file, invalid
  canonical hash, unsupported/malformed reference, and nonzero findings.
- Target shaping preserves unknown fields and raw JSON strings; reserved-field conflicts, missing index fields,
  >400-KB items, and invalid target schemas fail.
- Identity map covers exactly two admins with unique existing stage subjects; missing/duplicate/wrong-pool/unlinked
  admin fails; non-admin unlinked records list but never authorize.
- Relationship and guard validation: dangling client/template/PDF/submission links, template-version mismatch,
  duplicate active template/version, duplicate active client/year, archived history, and deterministic guards.
- Dynamo strong-read/conditional-put/equal replay/collision/race/pagination/partial-checkpoint behavior.
- S3 exact-reference keys, private and HTTPS variants, duplicate content under distinct keys, conditional create,
  409/412 races, wrong metadata/length/content, checksum, streaming limits, pagination, and partial resume.
- Schema-v2 evidence allowlist, wrong stage/resolver/manifest/counts/gates/timestamps, zero/positive constraints,
  sensitive-pattern rejection, and no evidence from a failed/stale checkpoint.
- SST gate matrix: no request+no evidence disabled; evidence+no request disabled; true+missing/invalid/wrong-stage
  evidence fails; true+valid evidence binds true/hash identically; malformed request fails.

### Integration Tests

- Synthetic six-entity snapshot fixture runs preflight→plan→interrupted import→resume→reconcile→evidence against
  fake paginated Dynamo/S3/Cognito/STS clients.
- Re-running the complete same manifest performs zero writes and produces identical aggregate reconciliation.
- A destination value changed between plan and put or between put and reconcile blocks evidence.
- Runtime `FileService` and ZIP worker resolve an imported private/HTTPS source reference only in enabled mode and
  retain resource ownership; disabled mode performs no S3 read/job write.
- Foundation source/JSON contracts, workflow ordering, manual input, Lambda environment, and live expected-mode
  verification stay synchronized.

### Edge Cases

- Snapshot manifest is valid JSON but its state, NDJSON, reference occurrence, or content-addressed file is altered.
- Source reference has leading/trailing whitespace, Unicode, query parameters, uppercase host, encoded separator,
  credentials, or unsupported scheme; exact source fingerprint must never be silently normalized.
- Multiple source references have identical bytes; one source reference unexpectedly changes bytes across snapshots.
- Existing S3 key has correct length but wrong SHA, correct metadata but wrong body, delete marker, or inaccessible
  object whose 403 cannot be assumed absent.
- Existing Dynamo item has same source projection but different migration marker/version, or a conditional creator
  wins after the initial Get.
- Scan/list returns an empty page with continuation, throttling, expired credentials, or retry exhaustion.
- Active historical data includes archived submissions, missing tax years, duplicate client/year records, multiple
  active templates, ghost template references, or malformed JSON strings.
- Test target contains synthetic User/client/submission/template/file fixtures. They are counted separately, never
  overwritten, and cannot conceal a collision.
- Checkpoint is truncated, copied to another stage/resource set, edited, from another tool version/manifest/identity
  map, or concurrently locked.
- Evidence exists but explicit enablement is absent; explicit enablement is requested with stale/mismatched evidence;
  API and ZIP environments drift; disable rollback is partially applied.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```powershell
node --check tooling/import_base44_snapshot.mjs
npm run typecheck:foundation
npm run lint:foundation
python -m py_compile tooling/export_base44_snapshot.py
git diff --check
```

### Level 2: Unit Tests

```powershell
python -m unittest discover -s tooling/tests -v
npx vitest run --config vitest.foundation.config.js tooling/import_base44_snapshot.test.mjs
npx vitest run --config vitest.foundation.config.js `
  infra/sst/__tests__/verify-private-file-cutover.test.js `
  infra/sst/__tests__/contracts.test.ts `
  backend/api/__tests__/runtime-config.test.ts `
  backend/api/__tests__/auth.test.ts `
  backend/api/__tests__/files-contract.test.ts `
  backend/api/__tests__/files-service.test.ts `
  backend/api/__tests__/template-service.test.ts `
  backend/api/__tests__/zip-download.test.ts `
  backend/api/__tests__/user-repository.test.ts
```

### Level 3: Integration and Repository Validation

```powershell
npm ci
npm test
npm run test:foundation
npm run test:pdf
npm run typecheck
npm run lint
npm run build
node tooling/verify_sst_foundation.mjs --mode contract --stage test
python tooling/validate_codex_layer.py
```

Full frontend typecheck/lint must either pass or exactly match the documented inherited baseline; every issue-#11
file must be clean. Foundation typecheck/lint, tests, build, importer checks, and privacy gates must pass outright.

### Level 4: Authorized Test-Stage Validation

```powershell
python tooling/export_base44_snapshot.py verify --snapshot <absolute-private-run-path>
node tooling/import_base44_snapshot.mjs doctor --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json
node tooling/import_base44_snapshot.mjs plan --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json
node tooling/import_base44_snapshot.mjs import --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json --resume --confirm-test-import
node tooling/import_base44_snapshot.mjs reconcile --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json
node tooling/import_base44_snapshot.mjs evidence --stage test --snapshot <private> --checkpoint-root <private> --identity-map <private> --outputs .sst/outputs.json --output docs/migration/private-file-import-verification.json
npm run verify:file-cutover:test
npm run sst:diff:test
```

After separate deployment authorization, dispatch the protected `Deploy SST test` workflow with enablement true and
run the mode-aware live verifier. Exercise imported public, CPA, PDF/template, and ZIP flows plus negative scope cases
without recording private inputs or URLs. Rehearse a false-mode deployment and negative legacy probe.

### Level 5: Privacy and Evidence Validation

```powershell
git diff -- docs/migration/private-file-import-verification.json
rg -n "private://|https://|@|client_id|submission_id|filename|token|subject|resourceName|checkpoint|snapshot" docs/migration/private-file-import-verification.json
git status --short
```

The evidence validator is authoritative; the `rg` scan is an additional human review prompt. Any unexpected match
blocks commit. Never run broad searches against the private snapshot/checkpoint from a transcripted shell.

---

## ACCEPTANCE CRITERIA

- [ ] **AC 1:** Every exported record and reference has a deterministic target row/key or a private explicit blocking
  finding; a passing run has none.
- [ ] **AC 2:** Interrupted and completed same-manifest imports resume/replay without duplicates and converge to the
  identical target/evidence.
- [ ] **AC 3:** All IDs, timestamps, client/submission/template links, public tokens, unknown fields, and JSON-string
  values are preserved; only documented target metadata and admin Cognito linkage are added.
- [ ] **AC 4:** Reconciliation exhaustively verifies per-entity counts/projection hashes, every target row, derived
  guards, referential integrity, reference closure, S3 lengths/SHA-256 values, and complete pagination.
- [ ] **AC 5:** Committed schema-v2 aggregate evidence reports zero unresolved references, exact record/file totals,
  source manifest binding, and no private or identifying data.
- [ ] **AC 6:** Before explicit enablement, API and ZIP worker reject every legacy private/HTTPS reference before S3
  while owned synthetic AWS references remain usable.
- [ ] **AC 7:** Enablement is an explicit protected action; absent/malformed/stale/wrong-stage/failed evidence stops
  synthesis before diff/deploy, and evidence presence alone never enables reads.
- [ ] **AC 8:** After authorized test enablement, imported public/CPA/PDF/template/ZIP reads succeed only for the
  resource owner; invalid token, cross-owner, arbitrary, missing, and unresolved reads fail closed.
- [ ] **AC 9:** Existing synthetic target fixtures are identified/countable separately, never overwrite source rows,
  and never inflate or conceal source reconciliation.
- [ ] **AC 10:** Private diagnostics retain enough local IDs/hashes for repair while committed logs/reports contain
  only allowed aggregate counts, hashes, gates, timestamps, and status.
- [ ] **AC 11:** Any source drift, target collision, hash/relationship mismatch, failed reconciliation, mode drift, or
  disable failure blocks evidence/enablement/cutover; the safe recovery mode is both functions disabled.

---

## COMPLETION CHECKLIST

- [ ] Implementation branch starts from current `origin/main`; ticket/epic/architecture/dependencies are re-read.
- [ ] Private snapshot passes the current offline exporter verifier before any AWS write.
- [ ] All source preflight, identity mapping, relationship, guard, and resolver checks pass locally.
- [ ] Every Dynamo and S3 unit converges through compare/conditional-create/checkpoint semantics.
- [ ] Deliberate interruption/resume and full idempotent rerun pass.
- [ ] Exhaustive target reconciliation passes with synthetic items separated.
- [ ] Aggregate evidence passes strict schema and privacy review; no private artifact is tracked.
- [ ] Legacy reads remain disabled through ordinary PR/push deployments.
- [ ] Protected enablement deploy and live API/ZIP manifest binding pass under explicit authorization.
- [ ] Authorized positive/negative imported-data acceptance passes without private output.
- [ ] Disable/redeploy rehearsal proves both functions fail closed without deleting imported data.
- [ ] Full application/foundation/PDF/exporter/importer validation and Codex-layer checks pass or match documented
  inherited frontend baselines exactly.
- [ ] Pre-commit code review has zero unresolved findings.
- [ ] Implementation report records only aggregate results, deviations, authorization, and remaining production
  prohibitions.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Operational input, not a design gap:** the private snapshot path, checkpoint root, expected AWS account value,
  profile, and identity map will be supplied only in the authorized operator shell. Their absence blocks live import
  but not implementation/local testing.
- **Admin identity prerequisite:** a passing test import requires two distinct existing test Cognito subjects mapped
  privately to the two preserved source admin records. If the second subject does not exist, creating it requires
  explicit owner authorization before the live rehearsal; the importer must not fabricate it.
- **Snapshot version:** the handed-off rehearsal snapshot may remain usable if the current offline verifier passes.
  If it does not, issue #11 requires a new explicitly authorized read-only snapshot; no manifest amendment is allowed.
- **Single-manifest scope:** same-manifest resume/idempotence is mandatory. Updating an already imported target from a
  later changed manifest is deliberately not inferred; issue #15 must plan a bounded delta or use a clean production
  target.
- **Forward-import journal boundary:** this plan treats pre-cutover import as an operational migration, not a product
  mutation, because the selected architecture defines `ChangeJournal` to protect post-cutover AWS writes. If the
  owner requires source-load events in `ChangeJournal`, amend the architecture and this plan before implementation;
  the current 100-action/350-KB contract cannot safely carry the snapshot.
- **Pre-existing broken relationships:** ghost PDF-template references or other source integrity defects are not
  repaired here. They block zero-gap reconciliation until the owner supplies a source correction or explicit
  release-readiness waiver through the proper later gate.

## NOTES (open canvas)

### Data flow

```text
private snapshot --current Python offline verify--> local preflight/desired model
       |                                                |
       |                                                +--> private identity map validation
       |                                                +--> derived active guards
       v
conditional Dynamo puts + immutable reference-key S3 puts --> private checkpoint
       |
       v
full table scan + S3 list/head/get/rehash --> private detailed reconciliation
       |
       v
strict aggregate schema-v2 evidence --explicit protected request--> API + ZIP enabled
                                                        |
                                                        +--> false-mode redeploy recovery
```

### Why not BatchWriteItem

BatchWriteItem is faster but has no per-item condition, is not atomic, and may partially succeed with unprocessed
items. At this dataset size (366 source rows plus bounded guards), individual conditional Put operations are fast
enough and materially safer. The tool still uses bounded concurrency where equality and checkpoint ordering remain
unambiguous.

### Why one S3 object per reference instead of one per content hash

The source snapshot correctly deduplicates local storage by content hash, but persisted records retain source
references. Runtime lookup cannot replace arbitrary strings nested inside JSON without a product-data rewrite. The
stable compatibility key therefore hashes the exact reference. Identical content may be uploaded to multiple small
keys; at the observed scale the storage duplication remains modest and preserves direct, stateless resolution.

### Why evidence does not auto-enable reads

A committed artifact proves a specific reconciliation; it does not authorize deployment or prove both live Lambda
environments changed together. Separating evidence from an explicit protected enablement request preserves review,
rollback, and ordinary-branch safety. Passing the manifest hash into both functions makes the live state auditable
without exposing the private manifest.

### Confidence score

**8.5/10.** The source snapshot, target tables, resolver seam, fail-closed runtime, and test patterns already exist.
The remaining uncertainty is operational rather than architectural: private snapshot freshness, exact real source
integrity, availability of two mapped test Cognito subjects, and owner-authorized AWS rehearsal/deployment.

## AMENDMENTS

(None at creation.)

---

**Artifact type:** Implementation plan

**Related:** [issue #11](https://github.com/noamtz/cpa-platform/issues/11),
[epic #1](https://github.com/noamtz/cpa-platform/issues/1),
[PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration),
[architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Last updated:** 2026-09-04
