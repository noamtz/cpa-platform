# Feature: Prove reverse migration and rollback replay

This plan is implementation-ready, but execution must first revalidate the ticket, canonical architecture,
dependency acceptance, current Base44/AWS documentation, and the exact controlled rehearsal target. Preserve existing
names and persisted shapes, and keep all private data outside version control and ordinary command output.

## Feature Description

Implement and prove the rollback path required by [issue #12](https://github.com/noamtz/cpa-platform/issues/12).
After AWS becomes the sole writer, every supported post-cutover business mutation must be reproducible in Base44 in
the same logical order before DNS can be restored. The solution must freeze AWS writes at an exact journal cursor,
validate a selected contiguous `ChangeJournal` range, reconstruct full expected states from the verified pre-cutover
snapshot, translate AWS-only identifiers and private-file references into Base44-compatible values, converge a
controlled Base44 target idempotently, and reconcile both systems without exposing client data.

This creates an operator-only rollback tool and runbook. It does not add Base44 back to the application runtime,
does not dual-write, and does not authorize production replay. Production use remains reserved for an actual,
explicitly owner-approved rollback decision.

## User Story

As the AuditFlow product owner,
I want all ordered business changes made in AWS after cutover to be safely replayable and reconciled in Base44,
so that an emergency rollback does not discard new client records, questionnaire progress, templates, invitations,
or files.

## Problem Statement

The AWS runtime atomically journals business mutations, and the forward importer has proved resumable AWS
convergence. There is no reader or reverse writer for the journal, no maintenance mode that closes a race-free end
boundary, no Base44 write adapter, no cross-system checkpoint, and no reverse reconciliation evidence. A naive replay
is unsafe because:

- update entries retain changed fields while their hashes describe complete before/after records;
- one logical operation may span several journal entries;
- Base44 does not document cross-record transactions, conditional writes, or durable request idempotency;
- native S3 references must become newly assigned Base44 private-file URIs inside plain and JSON-string fields;
- the process can fail after Base44 accepts a write but before AWS records a checkpoint;
- presigned uploads issued before maintenance remain usable for 15 minutes; and
- Base44's documented APIs do not prove caller-ID preservation, invitation semantics, private-file deletion, or
  exactly-once upload behavior.

Without an exact boundary, explicit capability proof, destination-observed retries, and exhaustive reconciliation,
rollback could lose or duplicate business activity.

## Solution Statement

Build five cooperating layers:

1. Add private maintenance-control, external-activity counter/intent, and reconciliation-resolution items to
   `ChangeJournalTable`. Every journaled or direct operational mutation reads an OPEN generation and conditions its
   DynamoDB transaction on that exact generation. The operator atomically marks the start cursor and later closes the
   gate/captures the end cursor. A request holding an older generation cannot commit after close/reopen.
2. Add a central route-level gate for every business-mutating or side-effecting route so new upload initiations,
   completions, ZIP requests, default-template seeding, and normal writes return a stable privacy-safe 503. Track
   Cognito invitations, S3-first deletes, and ZIP workers with fenced durable activity intents; drain the 15-minute
   upload capability window and reconcile uncommitted objects/identities before accepting the boundary.
3. Add a strict Node operator tool that queries numeric `GLOBAL` entries, validates continuity/grouping/schema/hash,
   and reconstructs complete record states by applying deltas to the exact verified snapshot bound to the start cursor
   using issue #11's manifest contract. Bind immutable private
   checkpoint state and a durable restricted Dynamo replay ledger to stage, target, manifest, range, and payload.
4. Add a separate fixed, allowlisted Base44 replay bridge. It performs only required entity/user/file operations on
   an owner-approved controlled target. It strips AWS-only fields, maintains entity-ID and file-URI maps, uploads exact
   S3 versions before rewriting references, and treats an observed desired destination state as success after an
   ambiguous response.
5. Independently enumerate Base44 and compare it with the reconstructed expected projection. Only a passing zero-drift
   reconciliation may render committed aggregate-only rehearsal evidence. Failure keeps cutover blocked and, once
   replay writes start, `abort-replay` freezes the run but leaves AWS in maintenance. A successful real rollback
   terminalizes the control as `ROLLED_BACK` with AWS writes disabled; `resume-aws-writes` exists only to abandon a
   rollback after proving Base44 received no replay writes (or after fully reversing disposable rehearsal effects),
   and never runs after Base44 is restored as the authoritative writer.

## Out of Scope / Non-Goals

- Not included: production replay, DNS restoration, Base44 cancellation, Terraform PDF rollback, or production
  cutover. Issue #15 owns those actions.
- Not included: runtime dual-write, continuous replication, Streams/CDC, or a Base44 dependency in browser/Lambda
  application code.
- Not included: public/admin maintenance controls, maintenance UI redesign, or exposing replay state to users.
- Not included: changing UI behavior, Hebrew copy, RTL, entity schemas, archive semantics, or the compatibility facade.
- Not included: replaying any forward import. The run's verified start snapshot/manifest is the baseline and the range
  begins strictly after its recorded cutover cursor. Issue #12 rehearsal uses invented fixture data; issue #15 must
  bind the final production snapshot/delta before production writes open.
- Not included: replaying active guards, file receipts, resolved reconciliation records, ZIP requests/locks/results,
  temporary archives, Cognito subjects, `_version`, `record_type`, or `_auditflow_migration` metadata. They still must
  be generation-fenced or quiesced so they cannot conceal an unresolved post-boundary side effect.
- Not included: inventing hard record deletes. Reachable record lifecycle is update/archive; a future physical delete
  is supported only after the same capability/mapping gate.
- Not changing: `tooling/base44_export_bridge.ts`; it remains fixed and read-only.
- Not changing: Google Drive and Telegram remain controlled `Not implemented` operations.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: ChangeJournal, API mutation dispatch, S3 upload quiescence, migration tooling, Base44
controlled-target adapter, reconciliation/evidence, SST verification, CI, and migration runbooks
**Dependencies**: Issues #5, #6, #8, #10, #11; Node 20.17.0; AWS SDK v3.1116.0; Zod 3.24.2; existing exporter CLI
pin 0.1.10; provisioned-clone CLI 0.1.14 plus Deno 2.9.5; current controlled-target SDK behavior; owner-authorized
AWS test credentials and isolated Base44 rehearsal app
**Live rehearsal input still required**: One disposable inbox whose invitation and login can be observed; never use a
real client address.

## Related Work

**Implements**: [issue #12](https://github.com/noamtz/cpa-platform/issues/12)  ·  **Epic**:
[issue #1](https://github.com/noamtz/cpa-platform/issues/1)  ·  **PRD**:
[AuditFlow Platform Migration](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration)  ·
**Architecture**:
[AuditFlow Platform Migration](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- `.agents/plans/inventory-export-base44-data-files.md` - Immutable source snapshot, read-only Base44 bridge,
  file-reference discovery, pagination, and privacy contract.
- `.agents/plans/implement-cognito-core-cpa-compatibility.md` - Ordered transactional journal and foundational
  Client/Submission/User mutations.
- `.agents/plans/implement-private-s3-files-zip-downloads.md` - Versioned S3 receipts, compensation, ownership, and
  temporary ZIP artifacts.
- `.agents/plans/complete-cpa-workflow-template-parity.md` - Remaining workflow/template writers and final runtime
  Base44 removal.
- `.agents/plans/import-reconcile-base44-snapshot.md` - Exact baseline, checkpoint, shaping, reconciliation, aggregate
  evidence, and fail-closed operations.
- `.agents/reports/complete-cpa-workflow-template-parity-report.md` (lines 9-22, 53-100) - Issue #10's merged,
  test-deployed result and optional exploratory checks.
- `.agents/reports/import-reconcile-base44-snapshot-report.md` (lines 9-19, 38-51, 90-103) - Issue #11's accepted
  import/resume/idempotence/reconciliation and protected enable/disable proof.

**Forward-references**:

- Issue #14 consumes the aggregate reverse-replay proof as a release-readiness gate.
- Issue #15 records the production start cursor and may invoke this runbook only after a rollback decision.

### Provisioned rehearsal target (2026-09-07)

- Canonical protected operator descriptor: `C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json`.
  Implementation commands load this file through `--target-descriptor`; they do not duplicate its app ID, URL, or
  absolute working paths in repository files, command arguments, CI, logs, or evidence.
- The descriptor stores the non-secret rehearsal app ID/URL, linked clone metadata path, clone/checkpoint/dry-run/
  fixture/private-evidence roots, expected source fingerprint, deployment exception, readiness flags, and mismatched-
  clone cleanup pointer. It contains no access token or password.
- Base44 credentials remain in the CLI-managed authenticated profile at
  `C:\Users\ntzur\.base44\auth\auth.json`, as documented by Base44. The supported reference is
  `credential_provider = base44-cli-authenticated-profile`, validated by `base44 whoami`; implementation must never
  read, copy, log, commit, or serialize the underlying token store.
- Base44 documents CLI-created backend projects as not integrated with the app editor. Therefore this ejected target is
  a candidate for entity/file API replay, not automatically proof of app-editor authentication/runtime equivalence.
  The capability matrix must prove the required invitation/login and private-file behavior on this target. If it
  differs, create a native dashboard `Clone App`, repoint this same descriptor, and rerun the matrix before fixtures.
- The owner approved an isolated clone. Base44 CLI 0.1.14 `eject` created a new backend/local sibling project from the
  Hebrew-branded production-source app; no export/import or production data copy was run.
- The selected source fingerprint matches the pinned migration source exactly by names/counts: six entity schemas and
  seventeen backend functions. The clone is explicitly private, locally labeled `AuditFlow Rollback Rehearsal`, built,
  and deployed with its app identifier kept out of this repository and plan.
- Six entities, the site, the agent, and sixteen functions deployed. `notifySubmissionCompleted` was rejected because
  the new clone uses Workflows and Base44 disables that legacy automation shape. It is an external notification path,
  not rollback state, but its exclusion and non-production integration behavior must be recorded in capability evidence.
- Base44 documents an ejected clone as starting with an empty database and no copied users. Nevertheless, live
  privileged enumeration of all six entities remains mandatory before fixtures: CLI `exec` currently fails during
  Deno npm resolution, so emptiness has not yet been independently read back.
- An initial clone of a different account app named `AuditFlow` failed the source fingerprint (four different entities,
  two functions). It remains private, empty, undeployed, and locally preserved so its remote identity can be removed
  through the Base44 dashboard before rehearsal; it must never be accepted as the target.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

#### Canonical decisions and state

- `AGENTS.md` (lines 44-96) - AWS-only target, migration status, source boundary, validation, and authorization.
- `.agents/references/github-project-documents.md` (lines 1-135) - Canonical artifact and publication boundaries.
- `.agents/references/auditflow-api-security-contracts.md` (lines 1-5) - Public ownership and stable error shape.
- `.agents/references/auditflow-submission-compatibility.md` (lines 1-5) - JSON-string/legacy field fidelity.
- `.agents/references/auditflow-aws-operations.md` - Deployment, rollback, and production authorization.
- `docs/migration/private-file-import-verification.json` (line 1) - Proves the issue #11 manifest/evidence contract and
  current test-stage import; do not copy its client data into the isolated Base44 rehearsal fixture.

#### Journal and reachable mutations

- `backend/api/contracts/change-journal.ts` (lines 3-17, 19-65, 67-98) - Cursor/order, entity/operation union,
  snapshots/hashes/file refs, operational receipts, and limits.
- `backend/api/services/change-journal.ts` (lines 76-145, 178-254, 256-370) - Canonical hashes, update delta sentinel,
  receipts, contiguous transactions, and retries.
- `backend/api/services/entities.ts` (lines 79-159, 171-241) - Client create/update/token rotation and Submission update.
- `backend/api/services/public-questionnaire.ts` (lines 298-394, 436-615) - Default seed and public Submission/Client
  mutations.
- `backend/api/services/users.ts` (lines 85-123, 126-215) - Profile update and Cognito-before-journal invitation plus
  fallible compensation; this external-effect race requires a durable fenced intent.
- `backend/api/services/templates.ts` (lines 104-148, 172-255, 268-391) - Guard repair, questionnaire versioning,
  PDF-template lifecycle/archive.
- `backend/api/services/cpa-workflows.ts` (lines 195-216, 218-639) - CPA save, tax year, details, restore, reset, status.
- `backend/api/services/files.ts` (lines 419-572, 745-857, 859-1080) - 15-minute upload, S3 VersionId, receipts,
  pointer replacement, ZIP requests, and S3-delete-before-journal plus reconciliation fallback.
- `backend/api/handler.ts` (lines 61-109, 123-220, 230-299) - Route inventory, composition, dispatch/error boundary.
- `infra/sst/contracts.ts` (lines 114-153, 155-422, 473-509) - Journal key, S3 versioning/CORS, API/ZIP contracts.

#### Migration/reconciliation patterns

- `tooling/base44_export_bridge.ts` (lines 1-19, 48-141) - Fixed read-only marker protocol to mirror, not modify.
- `tooling/export_base44_snapshot.py` (lines 782-900, 1333-1615, 2028 onward) - Pinned CLI, production read guard,
  immutable export, sensitive-argument rejection.
- `tooling/import_base44_snapshot.mjs` (lines 43-70, 113-178, 247-260, 615-888, 1043-1518, 1554-1747) - Versions,
  canonical hash, private paths, doctor, checkpoint, exact S3/binding logic, convergence, reconciliation, evidence, CLI.
- `tooling/import_base44_snapshot.test.mjs` (lines 32-356, 577 onward) - Fake clients, private temp roots,
  interruption/resume/idempotence/binding tests.
- `docs/migration/base44-export-runbook.md` (lines 1-100) - Production export is read-only.
- `docs/migration/base44-import-runbook.md` (lines 1-51, 95-165) - Authorization, private state, run sequence,
  protected enablement and rollback precedent.
- `.github/workflows/deploy-sst-test.yml` (lines 1-62, 64-89, 95-227) - Filters, Node pin, protected environment,
  OIDC, validation, preview/deploy/read-back.
- `package.json` (lines 5-30, 32-39, 115-140) - Versions/scripts; tooling lint list is explicit.

### New Files to Create

- `backend/api/contracts/maintenance.ts` - Maintenance control/generation/boundary, external-intent/counter,
  reconciliation-resolution, and route classification contracts.
- `backend/api/services/maintenance.ts` - Strong reads, exact-generation transaction/fenced operational write helpers,
  external-activity intent lifecycle, and atomic start/close transitions.
- `backend/api/__tests__/maintenance-service.test.ts` - State, fencing, route, race, malformed control, and 503 tests.
- `tooling/base44_replay_bridge.ts` - Separate fixed allowlisted Base44 entity/user/private-file bridge.
- `tooling/replay_base44_change_journal.mjs` - Doctor/capabilities/plan/control/replay/resume/reconcile/evidence/abort CLI.
- `tooling/replay_base44_change_journal.test.mjs` - Synthetic journal, fake AWS/Base44/S3, checkpoint and privacy tests.
- `docs/migration/base44-rollback-replay-runbook.md` - Authority, preparation, exact boundary, replay and abort procedure.
- `docs/migration/base44-reverse-replay-verification.json` - Generated only after authorized controlled rehearsal;
  aggregate facts only.

### Existing Files to Update

- `backend/api/contracts/change-journal.ts` - Operational control/intent/resolution scopes and reserved actions.
- `backend/api/services/change-journal.ts` - Exact-generation condition on every business commit; fenced operational
  writes for guard repair; unresolved reconciliation queries.
- `backend/api/core/errors.ts` - Stable non-sensitive 503 maintenance response.
- `backend/api/handler.ts` - Inject gate and classify exact side-effecting routes while preserving reads/auth/health.
- `backend/api/services/public-questionnaire.ts`, `templates.ts`, `cpa-workflows.ts`, `users.ts`, `files.ts`, and
  `backend/api/workers/zip-download.ts` - Fence direct guard repairs; track Cognito/file/ZIP external effects; preserve
  typed 503 through compensation; prevent queued ZIP work from starting after close.
- `backend/api/__tests__/change-journal-contract.test.ts`, `change-journal-service.test.ts`, `router.test.ts`,
  `files-routes.test.ts`, `zip-download.test.ts`, and service tests - Generation, limits, race, compensation,
  stale-generation ZIP notification, and mutation-matrix coverage.
- `infra/sst/contracts.ts`, `infra/sst/application.ts`, foundation tests, and `tooling/verify_sst_foundation.mjs` - Link
  the ZIP worker to maintenance state with least privilege and verify the table/runtime contract without an always-on
  service or public control route.
- `package.json` / `package-lock.json` - Focused replay scripts and lint scope; avoid new dependencies if possible.
- `.github/workflows/deploy-sst-test.yml` - New path filters/static tests; never run replay or hold Base44 credentials.
- `AGENTS.md` and execution report - Update status only after the authorized rehearsal/read-back.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Base44: Work with data](https://docs.base44.com/developers/references/sdk/getting-started/work-with-data)
  - Read CRUD, permissions, and import-from-file sections.
  - Why: confirms entity operations/service role; browser-only `importEntities` is not an operator solution.
- [Base44 entities API](https://docs.base44.com/developers/references/sdk/docs/type-aliases/entities#list)
  - Read `list`, `filter`, `update`, `delete`; reconcile the 5,000-record request limit.
- [Base44 Core integrations](https://docs.base44.com/developers/references/sdk/docs/type-aliases/integrations#uploadprivatefile)
  - Read `UploadPrivateFile` and `CreateFileSignedUrl`; upload returns a new opaque URI.
- [Base44 `createClientFromRequest`](https://docs.base44.com/developers/references/sdk/docs/functions/createClientFromRequest)
  - Read service-role behavior; the privileged bridge requires target fingerprint and owner confirmation.
- [AWS DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)
  - Read action/size limits, idempotency, isolation, and conflict behavior.
- [AWS DynamoDB Query pagination](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html)
  - Read `LastEvaluatedKey` exhaustion; query the `GLOBAL` partition, never scan for order.
- [AWS S3: Restoring previous versions](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RestoringPreviousVersions.html)
  - Read non-destructive version restoration/order; replay must fetch exact retained versions.

### Patterns to Follow

**Canonical hash/private state:** reuse `canonicalJson`, SHA-256, outside-worktree path validation, exclusive `wx`
lock, immutable bindings, atomic rename, and redacted failures from `import_base44_snapshot.mjs:113-178,801-888`.
Checkpoint only after Base44 is observed in the desired state.

**Ordered grouping:** query `scope = GLOBAL`, accept only 20-digit sequences, require continuity, and require adjacent
entries for one `operation_id` with indexes `0..operation_count-1`. Checkpoint a complete operation group, not a row.

```js
const group = requireCompleteOperation(entries);
const expected = applyAndVerifyHashes(baselineState, group);
await convergeBase44Operation(expected, durableMappings);
await observeAndCheckpoint(group.operation_id, expected.aggregateSha256);
```

**Generation-fenced maintenance:** a business or direct guard-repair write strongly reads
`{ mode: "OPEN", generation }` and conditions its transaction on both fields. `mark-cutover-start` strongly reads
cursor `N` and control `G`, verifies the immutable baseline metadata declares `lastAppliedGlobalCursor=N` and its
canonical state hash matches the reconciled AWS projection, then atomically stores `start=N`, manifest/cutover
identity/hash, and `G+1`, conditioned on the cursor/state still matching, start being absent, and no prior replay run.
If a snapshot was captured at `N-1` while the cursor advanced to `N`, marking fails closed; operators must capture and
reconcile a new snapshot (or first freeze writes, produce it, and bind its observed cursor). Close similarly writes
`MAINTENANCE/G+1/end=N` only if cursor/state match and the external-activity counter is zero. Reopen always bumps
generation, defeating stale requests that began before close.

**External-effect intents:** before Cognito invitation or S3-first delete, transactionally create an immutable intent
and increment a separate activity counter under the observed OPEN generation. Successful journal commit or proven
compensation resolves the intent/decrements the counter. Maintenance close requires zero activity and no unresolved
`FILE_RECONCILIATION`/external intent. Because DynamoDB cannot condition and update the same item twice in one
transaction, keep the activity counter distinct from the maintenance control item.

**Snapshot reconstruction:** seed the projector from the exact verified start snapshot/manifest and apply
`(cutoverStart,maintenanceBoundary]`. The controlled rehearsal uses an invented snapshot paired with its isolated
Base44 fixture; an actual rollback uses issue #15's final reconciled production snapshot/delta. For updates, interpret
`{ __auditflow_missing: true }` as absence and verify complete reconstructed `before_hash`/`after_hash`; never treat a
delta as a replacement record.

**Destination mapping and output split:** strip target-only metadata, preserve Base44 business fields/JSON-string
behavior, resolve entity IDs before dependents, and file mappings before pointer-bearing updates. The private dry-run
artifact (outside the repository, owner-readable permissions) lists affected entity type+ID and affected file
reference/name needed for operator review, but no record values or file content. Terminal summaries and committed
evidence contain only bounded counts/aggregates. Never send the private plan to CI/issues or normal logs.

**Files:** resolve native references to exact S3 key/version, stream/hash bytes, upload privately, durably map native
fingerprint to Base44 URI, then rewrite plain/nested JSON-string pointers. Delete only after the expected reference
graph proves zero references. Imported legacy refs already belong to Base44. Exclude `zip-jobs/**`.

**Fail closed:** unknown entity/op, incomplete group, gap/hash/range drift, missing S3 version, unsupported field,
ambiguous unobservable result, or privacy failure terminates before the next write; no generic fallback exists.

---

## IMPLEMENTATION PLAN

### Phase 1: Drift lock and release-blocking Base44 capability proof

Revalidate dependencies and run a synthetic private capability matrix against only an owner-approved controlled
Base44 target. Prove or block exact-ID/system-field behavior, entity CRUD, invitation, private upload/read/delete,
pagination, and ambiguous-result observability before depending on them.

### Phase 2: Generation-fenced maintenance boundary

Add control schema/service, central route classification, 503, journal/direct-write conditions, and fenced external
intents. Prove mark-start/in-flight, close/in-flight, close/reopen, guard-repair, invitation, and file compensation
races. Add operator bootstrap/mark-start/close/status/abort-replay, abandonment-only resume-aws-writes, and terminal
successful-rollback commands; no public endpoint.

### Phase 3: Ordered projection and replay adapters

**Depends on:** Phase 1 Base44 facts and Phase 2 immutable range closure.

Implement journal validation, snapshot reconstruction, coverage registry, destination projection/dependency order,
invitation mapping, exact S3 reads, reference rewriting, bridge calls, and destination-observed idempotence.

### Phase 4: Durable resume, reconciliation, evidence, and abort

Add immutable private/Dynamo run state, operation receipts, exhaustive Base44 enumeration, zero-drift gates,
aggregate evidence, and explicit abort/resume state. Dry-run performs every read/projection and writes only its
private operator plan file—no AWS control/checkpoint or Base44 mutation.

### Phase 5: Regression, CI, runbook, and controlled rehearsal

Document roles/commands, validate locally, then only with separate owner authorization bootstrap/deploy test gating,
generate controlled changes, drain uploads, close, interrupt/resume replay, rerun with zero writes, reconcile, render
aggregate evidence, exercise abort-replay and separately authorized abandonment-only resume-aws-writes on a disposable
scenario, prove terminal rollback remains write-disabled, and read back final state.
Production remains untouched.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order. Each task is atomic and independently testable.

### 1. REVALIDATE ticket, architecture, dependencies, stage, and boundaries

- **IMPLEMENT**: Re-fetch issues #1/#5/#6/#8/#10/#11/#12, Wiki pages, current dependency reports/merged SHAs,
  manifest/evidence, origin, branch, and worktree. Confirm issue #10 deployment and issue #11 acceptance despite stale
  prose elsewhere; do not treat one hard-coded historical PR head as the complete dependency gate. Validate the
  provisioned clone's protected target descriptor/binding, private visibility, exact six-entity/seventeen-function source
  fingerprint, and independently enumerated zero-row starting state. Remove the mismatched extra clone through the
  dashboard before rehearsal so operators cannot select it accidentally.
- **GOTCHA**: Contract drift, stale/failed import evidence, unaccepted dependency, or unexpected production state blocks
  implementation. The documented empty-clone contract is not a substitute for live pre-fixture enumeration. Use the
  repository GitHub wrapper and configured identity; never commit/log either clone's identifier. Require
  `--target-descriptor C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json` and reject
  conflicting target/path flags.
- **VALIDATE**: `python tooling/github.py issue view 12 --repo noamtz/cpa-platform --json number,title,body,state,url; python tooling/github.py issue view 1 --repo noamtz/cpa-platform --json number,body,url; npm run verify:file-cutover:test; git remote get-url origin; git status --short --branch`
- **SATISFIES**: Preconditions for AC 1-7.

### 2. CREATE controlled-target capability probe and immutable result

- **IMPLEMENT**: Add a read-first `capabilities` command and separate bridge. On a disposable target graph/file test
  explicit ID/timestamp handling, list/filter pagination, CRUD visibility, `users.inviteUser` equivalence/retry,
  private upload/read/delete, and ambiguous-outcome observation. Its doctor must first prove the pinned CLI/Deno/bridge
  can enumerate all six clone entities and that all are empty. Bind to CLI/SDK versions and target fingerprint.
- **PATTERN**: `base44_export_bridge.ts:48-141`; `export_base44_snapshot.py:782-900`.
- **GOTCHA**: Reject production target/config, missing confirmation, generic operations/code, and sensitive CLI flags.
  The currently observed CLI `exec` Deno npm-resolution failure is a pre-write blocker until corrected or replaced by
  the plan's fixed supported bridge; do not bypass it with token inspection or undocumented endpoints.
  Do not equate an ejected CLI backend with a native app-editor clone until invitation/login and private-file probes
  pass; a fidelity mismatch requires a dashboard clone and descriptor rebinding.
  If new Client IDs cannot be preserved (breaking already-shared URLs), invitations cannot converge, or file effects
  cannot be observed safely, emit a release blocker. Do not hide it with an ID map absent an approved link solution.
- **VALIDATE**: `npm run test:reverse-replay -- -t "capability|target fingerprint|production rejection|bridge allowlist"`
- **SATISFIES**: AC 1, AC 3, AC 7.

### 3. CREATE maintenance contracts/service and ADD 503

- **IMPLEMENT**: Add strict singleton state, `OPEN|MAINTENANCE`, monotonic generation, cutover start, inclusive end,
  run/timestamps/manifest/tool bindings and transitions; a terminal `ROLLED_BACK` state; a separate external-activity
  counter; immutable intent and
  reconciliation-resolution schemas. Add strong reads/fenced-write helpers and generic 503.
- **PATTERN**: `change-journal.ts:3-17,67-92`; `core/errors.ts:3-42`.
- **GOTCHA**: Missing/malformed required control is fail-closed after guarded deployment. Bootstrap is explicit; every
  reopen increments generation. Only classified mutation attempts during operator maintenance return exact
  `{ error: "Maintenance in progress" }`; normal status/error behavior is unchanged and responses expose no boundary.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/maintenance-service.test.ts backend/api/__tests__/change-journal-contract.test.ts backend/api/__tests__/router.test.ts`
- **SATISFIES**: AC 2, AC 6, AC 7.

### 4. UPDATE journaled and direct operational writes with generation fencing

- **IMPLEMENT**: Strongly read OPEN generation and condition every business transaction on exact mode/generation.
  Compute the 100-action/4 MB limit from the fully assembled transaction: cursor, maintenance condition, business
  actions, journal entries, file receipts, intent/counter create or resolution, and every other internal action.
  Dynamically reserve the exact overhead for each invocation shape and reject an over-capacity shape before sending;
  do not retain `operation_count <= 98` as sufficient by itself. Convert the three direct `!ACTIVE` guard
  repairs (`public-questionnaire.ts:315-343`, `templates.ts:104-148`, `cpa-workflows.ts:150-183`) to maintenance-aware
  conditional transactions. Map gate conflict to 503 while preserving 409 and compensation.
- **PATTERN**: `change-journal.ts:256-370`; `files.ts:481-572,995-1080`.
- **GOTCHA**: Handler checks cannot fence a direct guard `PutCommand`; each repair must use the transactional helper.
  Dynamo's request token is not durable cross-system idempotency. Generation changes require a fresh read.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/change-journal-service.test.ts backend/api/__tests__/files-service.test.ts backend/api/__tests__/entity-service.test.ts backend/api/__tests__/public-questionnaire-service.test.ts backend/api/__tests__/template-service.test.ts backend/api/__tests__/cpa-workflow-service.test.ts backend/api/__tests__/user-service.test.ts -t "maintenance|transaction capacity|intent overhead|guard repair"`
- **SATISFIES**: AC 1, AC 2, AC 3, AC 7.

### 5. UPDATE handler route classification and dispatch gate

- **IMPLEMENT**: Enumerate side-effecting routes: public save/upload/active seed; Client/Submission/User/template/CPA
  writes; upload initiate/complete; mirror; ZIP request. Check after auth where needed but before body/side effects.
  Allow health and minimum reconciliation reads; classify POST queries/signers by behavior, not verb.
- **PATTERN**: `handler.ts:61-109,230-299`; `infra/sst/contracts.ts:155-422`.
- **GOTCHA**: Precheck gives stable behavior but journal/guard conditions close the race. Active-template reads can
  seed guards and need correct classification. Deferred integrations stay 501.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/router.test.ts backend/api/__tests__/auth.test.ts backend/api/__tests__/public-questionnaire-routes.test.ts backend/api/__tests__/files-routes.test.ts backend/api/__tests__/template-routes.test.ts backend/api/__tests__/cpa-workflow-routes.test.ts`
- **SATISFIES**: AC 2, AC 6, AC 7.

### 6. ADD operator transitions and upload/ZIP quiescence

- **IMPLEMENT**: Add commands to bootstrap OPEN; atomically mark start by strongly reading cursor/control, requiring
  immutable baseline metadata whose `lastAppliedGlobalCursor` equals that cursor and whose canonical state hash has
  been reconciled against AWS, then conditionally storing cursor, manifest/cutover identity/hash, and bumped generation
  with no existing start/replay scope;
  inspect; atomically close/capture end; freeze a run with `abort-replay`; and reopen only through a distinct
  `resume-aws-writes` generation bump under the abandonment rules in Task 12. Before Cognito invitation or S3-first
  file delete, create a fenced intent/increment activity. Before the ZIP request `PutObject`, create its fenced intent,
  keep it active through worker terminalization, and include its originating generation/run in the request. The worker
  validates that generation before acquiring/processing and quarantines or records cancellation for stale-generation
  delayed notifications rather than executing them after close/reopen. Resolve/decrement only after journal/result
  success, observed compensation, worker terminalization, or recorded cancellation.
  Close requires zero activity, drains presigns, waits for ZIP requests/leases to become terminal or explicitly
  fenced, reconciles unlinked Cognito users, scans internal S3 for missing create receipts, and scans
  `FILE_RECONCILIATION` plus intents for unresolved delete/compensation state.
- **PATTERN**: `contracts/files.ts:5-15`; `files.ts:419-572,859-988`; importer doctor/checkpoint `:615-888`.
- **GOTCHA**: ZIP effects are non-business but accepted boundary requires no active request/worker. A request already
  queued before close retains its originating generation and cannot execute under a later OPEN generation; an in-flight
  route cannot put a request after close without leaving a blocking intent. A late PUT, unpaired Cognito identity, unresolved intent, or
  unresolved file reconciliation blocks close and is not auto-deleted. After successful User compensation rethrow the
  original 503; after failed compensation persist a privacy-safe unresolved intent/reconciliation instead of log-only.
- **VALIDATE**: `npm run test:reverse-replay -- -t "maintenance|snapshot cursor mismatch|generation|boundary|presigned|orphan|zip request race|delayed notification|abort"; npx vitest run --config vitest.foundation.config.js backend/api/__tests__/zip-download.test.ts infra/sst/__tests__/contracts.test.ts; node tooling/verify_sst_foundation.mjs --mode contract --stage test`
- **SATISFIES**: AC 2, AC 3, AC 6, AC 7.

### 7. IMPLEMENT ordered reader and full-state projector

- **IMPLEMENT**: Strongly query/paginate `GLOBAL` for `(from,to]`; reject nonnumeric rows, gaps, duplicates, malformed
  sequences/groups/schema/hashes and range changes. Separately query operational intent/reconciliation scopes and
  refuse replay if any item affecting the range remains unresolved. Load the exact start-bound snapshot whose declared
  last-applied GLOBAL cursor and canonical projection hash equal the values bound by `mark-cutover-start` (invented for
  rehearsal; final reconciled snapshot for actual rollback), rebuild target records, apply missing sentinel, and verify
  complete before/after hashes at each entry.
- **PATTERN**: `contracts/change-journal.ts:19-98`; `import_base44_snapshot.mjs:113-147`; exporter verifier at
  `export_base44_snapshot.py:1615 onward`.
- **GOTCHA**: Do not Scan/use GSI for order. Lower bound must match cutover start. Never replay import/operational scopes.
- **VALIDATE**: `npm run test:reverse-replay -- -t "journal query|pagination|gap|operation group|projector|hash|missing sentinel|range binding"`
- **SATISFIES**: AC 1, AC 2, AC 5, AC 7.

### 8. IMPLEMENT explicit mutation coverage registry/dependency plan

- **IMPLEMENT**: Register Client create/update; Submission create/update; QuestionnaireTemplate create/update;
  PdfTemplate create/update/archive-as-update; User invite-create/update; File create/delete; reference replacement in
  entity updates. Mark SyncedDriveFile and hard entity delete unreachable and fail if encountered. Plan users/clients/
  templates/files before dependent submissions/pointer rewrites; delete unreferenced files last.
- **PATTERN**: journal calls in `entities.ts:101,135,219`, `public-questionnaire.ts:367,440`, `users.ts:98,183`,
  `templates.ts:241,363`, `cpa-workflows.ts:203`, `files.ts:522,819,1020`.
- **GOTCHA**: Guards are AWS operational state but must be fenced. File reconciliation/external intents are control
  signals: unresolved means blocker; resolved means excluded from Base44 replay. Archive is update. Unknown future
  combinations never use generic CRUD.
- **VALIDATE**: `npm run test:reverse-replay -- -t "coverage registry|reachable matrix|dependency order|unknown blocker"`
- **SATISFIES**: AC 1, AC 3, AC 7.

### 9. IMPLEMENT Base44 record, invitation, and file convergence

- **IMPLEMENT**: Add per-entity allowlists/projectors, strip internal metadata, resolve IDs, preserve token/JSON-string
  behavior, reconcile User invitation, and use before-or-desired observation for retries. Stream exact S3 versions,
  hash, upload, checkpoint URI mappings, rewrite nested pointers, and defer delete until reference count is zero.
- **PATTERN**: importer target shaping `:336-442`, legacy binding `:247-260`; file versions
  `files.ts:481-540,995-1050`; invitation behavior `users.ts:126-215`.
- **GOTCHA**: Base44 lacks cross-record transaction. Do not checkpoint partial groups. Never delete a referenced URI or
  log mappings, URLs, IDs, values, email, tokens, filenames, or content.
- **VALIDATE**: `npm run test:reverse-replay -- -t "entity projection|invite|ambiguous retry|file version|upload mapping|json reference|replace|delete|shared reference"`
- **SATISFIES**: AC 1, AC 2, AC 3, AC 5, AC 7.

### 10. ADD immutable cross-system checkpoint and operation receipts

- **IMPLEMENT**: Bind schema/tool/bridge/CLI versions, AWS stage/resources, manifest, journal table/range/hash, Base44
  target/capabilities, and plan hash. Use outside-repo lock/atomic checkpoint plus restricted ChangeJournal replay-scope
  run/operation receipts. Resume accepts exact binding and completes only after destination observation.
- **PATTERN**: `import_base44_snapshot.mjs:801-888,1170-1290`.
- **GOTCHA**: No cross-system atomicity. Crash after Base44 success is resolved by observation. If an ambiguous upload
  cannot be rediscovered, stop as a release blocker rather than create another reachable file.
- **VALIDATE**: `npm run test:reverse-replay -- -t "checkpoint|lock|binding|receipt|crash window|resume|zero write rerun"`
- **SATISFIES**: AC 2, AC 3, AC 4, AC 7.

### 11. IMPLEMENT dry-run, reconciliation, and aggregate evidence

- **IMPLEMENT**: Dry-run performs every read/projection/coverage/dependency check and writes an owner-only private plan
  outside the repository listing exact affected entity IDs and file identifiers/references without record values or
  contents; it performs zero AWS/Base44 writes. Reconciliation
  paginates all six entities, compares mapped IDs/business hashes/relationships and file count/bytes/hash, finds extras
  and deletions, and permits evidence only from a current complete zero-drift checkpoint. Evidence contains versions,
  stage, range aggregate/counts, operation/mutation/file totals, interruption/resume/zero-write facts, per-entity/file
  aggregates, blocker/drift counts, and boolean gates.
- **PATTERN**: `import_base44_snapshot.mjs:1340-1518`; runbook privacy at `base44-import-runbook.md:114-132`.
- **GOTCHA**: Exact IDs/files belong only in the private dry-run artifact, never terminal output, CI, issue comments, or
  committed evidence. Terminal/evidence prefer counts; any diagnostic opaque ID uses a run-secret keyed fingerprint.
  No evidence from failed/stale reconciliation.
- **VALIDATE**: `npm run test:reverse-replay -- -t "dry run|zero writes|reconcile|pagination|extra|drift|evidence|privacy"`
- **SATISFIES**: AC 1, AC 3, AC 4, AC 5, AC 7.

### 12. CREATE exact rollback runbook

- **IMPLEMENT**: Document owner/CPA communication, target access, private inputs, doctors/capabilities, snapshot/start,
  dry-run/range review, maintenance, upload drain/orphans/ZIPs, boundary read-back, replay/interruption/resume,
  reconciliation, zero-write rerun, evidence, abort-replay/resume-aws-writes, terminal `ROLLED_BACK`, and DNS
  prerequisite. Separate controlled-test and actual-production confirmations.
- **PATTERN**: `base44-import-runbook.md:1-51,95-165`; canonical rollback architecture.
- **GOTCHA**: `abort-replay` changes run state only and never opens AWS. Before first Base44 write, a separate authorized
  `resume-aws-writes` may reopen only when the owner explicitly abandons rollback and verifies Base44 received no replay
  writes. If disposable rehearsal writes occurred, first reverse them and reconcile the fixture to its pre-run state.
  A successful actual rollback instead transitions to terminal `ROLLED_BACK`; AWS remains write-disabled while issue
  #15 restores DNS to Base44. No automatic cleanup/reopen/DNS, and never reopen AWS after Base44 is authoritative.
- **VALIDATE**: `rg -n "owner|maintenance|generation|boundary|15 minutes|dry-run|resume|reconcile|abort|DNS|production|privacy" docs/migration/base44-rollback-replay-runbook.md`
- **SATISFIES**: AC 5, AC 6, AC 7.

### 13. UPDATE scripts, lint/type scope, verifier, and CI

- **IMPLEMENT**: Add `reverse-replay`/`test:reverse-replay`, lint new tooling, update lock only if needed, include paths
  in CI, and extend contract/live verification for maintenance access/state. CI only uses fakes/static checks.
- **PATTERN**: `package.json:9-30`; `deploy-sst-test.yml:15-62,95-227`.
- **GOTCHA**: CI never receives Base44 write credentials or invokes control/replay/fixture operations.
- **VALIDATE**: `npm run test:reverse-replay; npm run test:foundation; npm run typecheck:foundation; npm run lint:foundation; node tooling/verify_sst_foundation.mjs --mode contract --stage test`
- **SATISFIES**: AC 1-7.

### 14. RUN full local validation and privacy review

- **IMPLEMENT**: Use Node 20.17.0, clean install, run all focused/full checks, compare inherited frontend baseline,
  inspect diff/output privacy, and do not claim live proof from fakes.
- **VALIDATE**: `node --version; npm ci; npm test; npm run test:pdf; npm run test:reverse-replay; npm run test:foundation; npm run typecheck:foundation; npm run lint:foundation; npm run build; node tooling/verify_sst_foundation.mjs --mode contract --stage test; python tooling/validate_codex_layer.py; git diff --check`
- **SATISFIES**: AC 1-7.

### 15. EXECUTE separately authorized controlled rehearsal and read back

- **IMPLEMENT**: With explicit authorization for exact test AWS/Base44 fixtures, bootstrap/verify OPEN, deploy guarded
  runtime, verify the provisioned private clone's exact fingerprint and empty live enumeration, mark start, create
  invented record create/update, reference replacement, invitation if supported, and
  versioned file delete; close/drain/prove boundary; dry-run; replay; deliberately interrupt/resume; reconcile; rerun
  with zero writes; render evidence. Exercise `abort-replay` on a separate disposable run before its first Base44 write
  and prove it remains MAINTENANCE; only then separately authorize `resume-aws-writes`. If testing abort after writes,
  restore/reconcile the fixture before any reopen. Read both systems back.
- **GOTCHA**: No production AWS/Base44/DNS/Terraform action or broad cleanup. If file delete is not UI-reachable, use
  an owner-only fixture harness around existing service behavior, never add a product route. Any drift/blocker blocks
  issues #14/#15.
- **VALIDATE**: With the private variables defined by the runbook, execute
  `npm run reverse-replay -- doctor --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --snapshot $snapshotPath --outputs $outputsPath; npm run reverse-replay -- capabilities --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --confirm-controlled-rehearsal; npm run reverse-replay -- maintenance-bootstrap --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --outputs $outputsPath --confirm-controlled-rehearsal; npm run reverse-replay -- mark-cutover-start --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --snapshot $snapshotPath --outputs $outputsPath --confirm-controlled-rehearsal; npm run reverse-replay -- rehearsal-fixtures --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --fixture $rehearsalFixturePath --outputs $outputsPath --confirm-controlled-rehearsal; npm run reverse-replay -- maintenance-close --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --outputs $outputsPath --confirm-controlled-rehearsal; npm run reverse-replay -- plan --dry-run --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --snapshot $snapshotPath --outputs $outputsPath; npm run reverse-replay -- replay --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --snapshot $snapshotPath --outputs $outputsPath --resume --confirm-controlled-rehearsal; npm run reverse-replay -- reconcile --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --snapshot $snapshotPath --outputs $outputsPath; npm run reverse-replay -- evidence --stage test --target-descriptor "C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json" --snapshot $snapshotPath --outputs $outputsPath --output docs/migration/base44-reverse-replay-verification.json; npm run test:reverse-replay; git diff --check docs/migration/base44-reverse-replay-verification.json`.
- **SATISFIES**: AC 2-7.

### 16. UPDATE delivery status only after accepted rehearsal

- **IMPLEMENT**: Create `.agents/reports/prove-reverse-migration-rollback-replay-report.md`, update `AGENTS.md`, link
  issue/epic/architecture/evidence, and preserve explicit production authority. Do not duplicate the plan in an issue.
- **GOTCHA**: Complete only if mappings are proved or honestly recorded as release blockers and rehearsal/evidence
  pass. A release blocker blocks cutover; it is not a silent pass.
- **VALIDATE**: `python tooling/validate_codex_layer.py; git diff --check; git status --short`
- **SATISFIES**: AC 1-7 and artifact contract.

---

## TESTING STRATEGY

### Unit Tests

- Maintenance transitions: bootstrap/baseline-cursor-bound atomic start/open generation/atomic close,
  abandonment-only reopen/terminal rollback, stale generation, external counter/intents, malformed state, 503.
- Journal commit: condition in every transaction, action/size limits, cursor/gate/transport conflicts, compensation.
- Reader/projector: strong pagination, order/gaps/groups, sentinel, baseline reconstruction, hashes/range binding.
- Mapping registry: every reachable type explicit; unknown/unreachable combinations fail.
- Projection: internal stripping, IDs/tokens/timestamps, JSON-string references, archive, invitation, before/desire drift.
- Files: exact version/hash/size, create/replace/delete/shared refs, ambiguous upload, missing version, legacy, ZIP exclude.
- Checkpoint: outside-repo path, lock, immutable bindings, receipts, every crash window, resume, zero-write rerun.
- CLI/privacy: strict args/confirmations, target rejection, redacted terminal errors, private dry-run IDs/files without
  client values/content, zero AWS/Base44 dry-run mutation, and aggregate evidence rejection.

### Integration Tests

- Synthetic baseline + mixed journal range runs plan → close → dry-run → interrupted replay → resume → reconcile →
  evidence against paginated fake AWS/S3/Base44 adapters.
- Concurrent writes and all three guard repairs racing start/close either finish on the correct side or fail 503; stale
  generation fails after reopen. Close between `AdminCreateUser` and journal plus failed Cognito compensation leaves a
  blocking intent/counter, not an invisible identity. File-delete journal+restore failure does the same and requires
  resolution of its `FILE_RECONCILIATION` signal.
- A baseline declaring `N-1` cannot bind when the strongly read cursor is `N`. ZIP request creation racing close leaves
  a blocking intent, and a delayed notification from an older generation cannot execute after close then reopen.
- Partially applied multi-entry operations re-observe/converge each member but receive no group completion early.
- File create + pointer update + replacement + delete restores exact graph; late unjournaled PUT blocks the boundary.
- Capability, target, gap/hash, Base44, S3, checkpoint, reconciliation, or privacy failure preserves fail-closed state;
  abort alone never changes mode to OPEN.

### Controlled Rehearsal

- Owner-approved invented AWS test fixtures and isolated Base44 app with a nonproduction fingerprint only.
- Record create/update and file create/reference replace/delete, interruption/resume, order, zero-write rerun, zero drift.
- Verify every mapping or emit blocker; row parity alone does not prove invitation/file behavior.
- Read back control/boundary/range and aggregate destination evidence without private values.

### Edge Cases

- Empty range; boundary inside operation; cursor moves; start missing/mismatch.
- Gap/duplicate/group mismatch/bad hash/unknown scope/type/operation or item/reference limits.
- Imported nulls, duplicate active submissions, authorized placeholder, nested/repeated/shared JSON/flat file refs.
- Timeout after accepted create/update/invite/upload/delete; destination before, desired, or third state.
- Client ID cannot be preserved and an AWS Client URL was already shared.
- File created then deleted; pointer ordering; noncurrent/missing version/delete marker/hash mismatch/shared URI.
- Start/close races mutation/upload/Cognito/each guard repair or rapid reopen; invitation/file compensation fails;
  presigned PUT lands during drain; ZIP is pending/running/stuck.
- Lost local checkpoint, durable ledger mismatch, concurrent operators, stale capability, changed target, missing confirm.
- Evidence contains PII/token/URL/path/filename/raw ID/URI/snapshot/checkpoint/resource name or follows failed reconcile.

---

## VALIDATION COMMANDS

Use Node 20.17.0. New foundation/tooling code must have zero errors; compare only documented inherited frontend
baseline failures.

### Level 1: Syntax & Style

```powershell
node --version
npm ci
npm run typecheck:foundation
npm run lint:foundation
git diff --check
```

### Level 2: Unit Tests

```powershell
npm run test:reverse-replay
npx vitest run --config vitest.foundation.config.js backend/api/__tests__/maintenance-service.test.ts backend/api/__tests__/change-journal-contract.test.ts backend/api/__tests__/change-journal-service.test.ts backend/api/__tests__/router.test.ts backend/api/__tests__/files-service.test.ts
```

### Level 3: Integration and Repository Validation

```powershell
npm test
npm run test:pdf
npm run test:foundation
npm run build
node tooling/verify_sst_foundation.mjs --mode contract --stage test
python tooling/validate_codex_layer.py
npm run typecheck
npm run lint
```

### Level 4: Read-Only Operator Preflight

Representative shape; implementation/runbook must replace placeholders with exact validated syntax:

```powershell
$targetDescriptorPath = 'C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json'
npm run reverse-replay -- doctor --stage test --target-descriptor $targetDescriptorPath --snapshot <private> --outputs .sst/outputs.json
npm run reverse-replay -- plan --dry-run --stage test --target-descriptor $targetDescriptorPath --snapshot <private> --outputs .sst/outputs.json --from-exclusive <start> --to-inclusive <end>
```

Reject placeholder values, in-repo private paths, sensitive arguments, production target fingerprint, and production
stage without actual-rollback confirmation plus external authorization.

### Level 5: Owner-Authorized Controlled Rehearsal

Follow `docs/migration/base44-rollback-replay-runbook.md` exactly. The capability command below performs controlled
fixture mutations and therefore requires separate owner authorization. Then bootstrap/read-back, mark start, create
invented mutations, close/drain, prove the immutable boundary, dry-run, replay, deliberately interrupt/resume,
reconcile, zero-write rerun, and render evidence. Exercise `abort-replay` plus separately authorized
`resume-aws-writes` only on the runbook's distinct disposable scenario. Production remains untouched.

```powershell
$targetDescriptorPath = 'C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json'
npm run reverse-replay -- capabilities --stage test --target-descriptor $targetDescriptorPath --confirm-controlled-rehearsal
npm run reverse-replay -- maintenance-bootstrap --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- mark-cutover-start --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- rehearsal-fixtures --stage test --target-descriptor $targetDescriptorPath --fixture $rehearsalFixturePath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- maintenance-close --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- maintenance-status --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath
npm run reverse-replay -- plan --dry-run --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath
npm run reverse-replay -- replay --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --confirm-controlled-rehearsal
# Interrupt only after durable progress, then resume the exact bound run.
npm run reverse-replay -- replay --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --resume --confirm-controlled-rehearsal
npm run reverse-replay -- reconcile --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath
npm run reverse-replay -- replay --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --resume --confirm-controlled-rehearsal
npm run reverse-replay -- evidence --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --output docs/migration/base44-reverse-replay-verification.json
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC 1 — Complete coverage:** Every reachable AWS mutation has a tested explicit mapping, including invitation
  and reference changes, or is a release blocker. Unknown future combinations fail closed.
- [ ] **AC 2 — Ordered/resumable/idempotent:** The reconciled baseline cursor/hash is atomically bound to an exact
  contiguous range; generation fencing prevents boundary races; complete logical operations replay in order, exact
  state resumes, ambiguous results are observed, and completed rerun writes zero.
- [ ] **AC 3 — Files:** Additions/replacements/relevant versioned deletions copy exact bytes, persist URI maps, rewrite
  all pointers, protect shared refs, and reconcile count/size/hash. ZIP artifacts are explicitly excluded.
- [ ] **AC 4 — Rehearsal:** Controlled isolated Base44 demonstrates record create/update, file create/replace/delete,
  interruption/resume, ordered convergence, zero-write rerun, and zero-drift reconciliation with invented fixtures.
- [ ] **AC 5 — Privacy:** Dry-run makes zero AWS/Base44 mutations and its protected outside-repository artifact clearly
  lists affected entity IDs/files without client record values or file contents. Terminal output and committed evidence
  remain aggregate/redacted and contain no PII, raw IDs, tokens, URLs/URIs, paths, filenames, credentials, snapshots,
  checkpoint/resource details.
- [ ] **AC 6 — Runbook:** Names who enables/communicates maintenance, exact start/end, external activity/presign/ZIP
  drain, validation, DNS prerequisite, terminal successful rollback, and abandonment-only
  abort-replay/resume-aws-writes behavior.
- [ ] **AC 7 — Fail closed:** Dependency/capability/control/range/hash/journal/mapping/file/Base44/checkpoint/privacy/
  reconciliation failure stops replay and blocks #14/#15. After replay starts, maintenance remains until owner action.
- [ ] Application runtime stays AWS-only; exporter stays read-only; no runtime dual-write exists.
- [ ] Focused/full validation has no new regression beyond the documented inherited frontend baseline.

---

## COMPLETION CHECKLIST

- [ ] Issue/epic/Wiki/dependencies/evidence revalidated; implementation branch created.
- [ ] Controlled Base44 capability matrix passed or blockers recorded.
- [ ] Provisioned clone is private, exact-source fingerprinted, live-enumerated empty, and the mismatched extra clone is
  removed before rehearsal.
- [ ] Maintenance generation condition covers every business transaction and side-effecting route.
- [ ] Upload drain/orphan and ZIP quiescence proven.
- [ ] Journal groups/hashes reconstruct from exact baseline.
- [ ] Coverage registry includes core/public/file/CPA/template/user paths.
- [ ] Entity/invitation/file/JSON/deletion maps are durable and tested.
- [ ] Every crash window resumes without double-applying reachable state.
- [ ] Private dry-run lists affected IDs/files without contents; terminal/evidence privacy checks pass.
- [ ] Runbook defines authority, boundaries, validation, abort-replay, resume-aws-writes, and DNS prohibition.
- [ ] Node 20.17.0 validation passes.
- [ ] Authorized controlled rehearsal, interruption/resume, zero-write rerun, reconciliation/evidence read-back pass.
- [ ] Production AWS/Base44/DNS/Terraform remain untouched.
- [ ] Report/status state proven result and blockers honestly.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Critical — Base44-assigned IDs:** Docs do not prove callers can preserve `id`/timestamps. An internal ID map handles
  relationships but cannot preserve a questionnaire URL already containing a new AWS Client ID. The probe must prove
  preservation or cutover is blocked absent an approved link-compatibility architecture.
- **Critical — User invitation:** AWS User creation follows Cognito invitation. Base44 row creation alone does not
  restore login. Prove/reconcile `users.inviteUser` or block cutover while post-cutover invitations are possible.
- **Critical — files:** Docs establish private upload/signed read but not enumeration/idempotency/delete/recovery/hash.
  Source evidences `DeleteFile`; the controlled probe must prove actual behavior. An unobservable ambiguous upload is a
  blocker, not nominal idempotence.
- **Clone readiness:** The correct private clone exists and matches the source inventory, but live empty-state read-back
  is still blocked by the current CLI `exec`/Deno resolution failure. Fixing the supported bridge and proving six empty
  entity enumerations is mandatory before the first fixture write.
- **Clone fidelity:** Base44 says CLI backend projects are not app-editor-integrated. The ejected target is acceptable
  only if the controlled capability matrix proves the rollback-critical entity, invitation/login, and private-file
  semantics. Otherwise use a native dashboard clone; this does not authorize production access.
- **Invitation inbox:** A disposable non-client address with observable delivery/login remains a required owner-provided
  rehearsal input. Its value belongs only in the protected descriptor/operator environment, never this plan or logs.
- **Legacy notification automation:** `notifySubmissionCompleted` does not deploy into a Workflows-enabled clone. It
  carries no rollback record/file state and production integrations must not be reconnected for rehearsal; document the
  exclusion in capability evidence rather than weakening the core mutation/file proof.
- **Maintenance bootstrap:** Assumes a private item in existing ChangeJournal table, bootstrapped before guarded deploy.
  CloudFormation-owned seeding would require an architecture amendment due to changed deployment ordering.
- **Baseline handoff:** The current issue #11 artifact proves the importer/evidence format and current test import; it is
  not automatically the future production rollback baseline. `mark-cutover-start` must bind the exact verified
  snapshot/delta current at that start. The issue #12 live rehearsal uses only an invented fixture snapshot and must not
  seed an external rehearsal app with production client data.
- **Durable state:** Restricted Dynamo ledger is authoritative for operation completion; external checkpoint holds
  detailed private mappings/diagnostics. Both bind one run; neither pretends Base44 and Dynamo share a transaction.
- **Physical deletes:** Reachable record lifecycle is update/archive. Controlled delete proof uses existing versioned
  File delete behavior through an owner-only fixture harness, not a new product route.
- **Production authority:** Code may have a heavily guarded production branch, but this plan authorizes no production
  execution.
- **Abort semantics:** `abort-replay` freezes/preserves the run and never opens AWS. `resume-aws-writes` is a different
  owner-authorized transition used only to abandon rollback after proving Base44 received no replay writes, or after
  fully reversing/reconciling disposable rehearsal effects. Successful actual rollback terminalizes as `ROLLED_BACK`
  and leaves AWS write-disabled for issue #15 DNS restoration.

## NOTES (open canvas)

### Rollback data flow

```text
verified start snapshot/manifest + cutover start
              |
              v
generation-fenced maintenance close --> inclusive GLOBAL cursor
              |
              v
ordered journal validation --> full-state hash-verified projector
              |
              v
dependency map + exact S3 versions --> allowlisted Base44 convergence
              |
              v
private checkpoint + Dynamo receipts --> exhaustive reconciliation
              |
              v
aggregate-only zero-drift evidence --> issue #14/#15 gate
```

### Why route gating and transaction fencing

Route gating gives predictable 503 and prevents new presigns/ZIPs. It cannot close the race for a request already past
the check. The mode+generation condition in the same transaction as business state, journal, and cursor is the exact
boundary and prevents a stale request from landing after a rapid reopen.

### Why start from the snapshot

Update entries intentionally store changed fields, while their hashes describe full records. The start-bound verified
baseline allows every intermediate full state/hash to be reconstructed; the final AWS row cannot prove order. For
rehearsal this baseline is invented; for actual rollback it is issue #15's final reconciled production snapshot/delta.

### Why the ledger is not a transaction

Base44 converges one operation at a time. After a crash, some members may already be desired, but the group remains
incomplete until every member/reference matches. Destination observation is correctness; the ledger constrains resume.

### Confidence score

**8/10 for implementation on the current codebase; 6/10 for unconditional production rollback until the Base44
capability probe resolves ID, invitation, and private-file semantics.** AWS journal, S3 versioning, importer, and
checkpoint patterns are mature; external Base44 write behavior is explicitly isolated as the release gate.

## AMENDMENTS

<!-- Append-only after initial approval/execution. -->

- **2026-09-07 - isolated Base44 target provisioned:** Owner selected the safer cloned-app rehearsal approach. CLI
  0.1.14/Deno 2.9.5 were installed; the correct source was selected by exact six-entity/seventeen-function fingerprint,
  the new app was made private, labeled, built, and deployed without a data import. One legacy notification automation
  is incompatible with Workflows and is explicitly excluded from rollback state.
- **2026-09-07 - readiness gates added from provisioning evidence:** Require live zero-row enumeration before fixtures,
  resolution of the CLI `exec`/Deno bridge failure, protected target binding, and deletion of the private undeployed
  mismatched clone before the controlled rehearsal.
- **2026-09-07 - live capability blocker:** The owner deleted the exact mismatched clone and the approved target read
  back with zero business rows plus one mandatory administrator owner row. The pinned bridge then proved Base44
  preserves invented Client fields but reassigns the caller-supplied entity ID and both system timestamps. The
  residual invented row was removed by its observed destination ID and the owner-only baseline was restored. This
  blocks public questionnaire-link compatibility and therefore blocks maintenance bootstrap, replay, and issues #14/
  #15 until an approved compatibility design exists and the full capability matrix passes.
- **2026-09-07 - assigned-ID compatibility and residual target-fidelity blocker:** The approved compatibility design
  treats Base44 IDs/timestamps as destination-owned, stores AWS values in immutable `auditflow_source_*` aliases,
  persists destination mappings, rewrites typed references, and resolves public Client links native-ID-first then
  source-alias while retaining token validation. Live CRUD, alias/timestamp observation, pagination, private upload,
  signing, and byte-for-byte read passed. Invitation acceptance remains external and two-phase. The ejected clone
  rejected private-file deletion through both privileged CLI and a deployed backend-function probe; Base44's current
  official Core integration reference does not document deletion. Failed probes left unenumerable file orphans, so
  this target cannot produce accepted clean-state evidence. Rebind to a fresh native dashboard clone and require both
  distinct invitation/login and observable file deletion before maintenance bootstrap; otherwise obtain a supported
  Base44 deletion contract and keep issues #14/#15 blocked.
