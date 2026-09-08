# Implementation Report — Prove reverse migration and rollback replay

**Plan**: `.agents/plans/prove-reverse-migration-rollback-replay.md`

**Branch**: `feature/prove-reverse-migration-rollback-replay`

**Tracker**: issue #12 under epic #1; issues #5, #6, #8, #10, and #11 revalidated closed

**Status**: COMPLETE; CONTROLLED LIVE REHEARSAL PASSED

## Summary

Implemented a generation-fenced maintenance boundary, complete journal/file/invitation side-effect accounting,
allowlisted Base44 replay bridge, ordered resumable replay engine, exhaustive reconciliation, aggregate-only evidence,
operator commands, an owner-only invented-fixture harness, CI coverage, and the rollback runbook. Local behavior is
validated, the application runtime remains AWS-only, and production AWS, Base44, DNS, and Terraform were untouched.

The owner deleted the exact mismatched private clone and read back its absence. The selected rehearsal clone then
passed live enumeration with zero rows in all five business collections and exactly one mandatory app-owner User.
The assigned-ID blocker is resolved in code. Every replayed business record now stores immutable AWS source-ID and
source-timestamp aliases, the checkpoint persists destination IDs, typed references are rewritten in dependency order,
and the five public Base44 functions resolve Client links by native ID and then source alias while retaining the
original Client token check. A repeatable guarded installer applies this compatibility layer only to the named private
rehearsal clone.

The expanded live matrix proved entity CRUD, assigned-ID/source-alias recovery, timestamp aliases, pagination, private
upload, signing, and byte-for-byte read. Base44 rejected private-file deletion through privileged CLI execution and a
temporary deployed backend-function probe; the official Core integration reference documents private upload and
signed reads but no delete API. The owner explicitly accepted deletion of unreachable disposable probe blobs as
best-effort, so those orphans no longer invalidate the target or block shipping. Real journaled file deletion remains
fail-closed. The invitation was sent but did not materialize as a distinct signed-in User; the owner explicitly waived
that live capability proof so the controlled rehearsal can proceed without a second Google identity. The waiver-bound
matrix then passed live, restored the owner-only entity baseline, and wrote protected capability evidence. Actual replay
still fails closed if an encountered invitation cannot be observed and converged.

The owner-authorized controlled rehearsal passed on isolated, tagged AWS test resources containing only invented
data. The immutable range contained 9 entries in 8 logical operation groups. Replay deliberately paused after its
first durable checkpoint, resumed to 9 total destination writes, reconciled with zero missing/extra/drifted records
or files, and reran with zero writes. Aggregate-only evidence was generated and the isolated control terminalized as
`ROLLED_BACK`; AWS writes remain disabled for that run. A distinct no-write scenario also proved that `abort-replay`
preserves maintenance and that abandonment reopens AWS only after the explicit zero-write check. Production AWS,
Base44, DNS, and Terraform were not touched.

## Implementation

- Added strict `OPEN`, `MAINTENANCE`, and terminal `ROLLED_BACK` control contracts with monotonic generations,
  strongly consistent reads, transactional write fences, external-intent accounting, boundary cursors, abort state,
  and abandonment-only reopen guards.
- Added central mutation/side-effect route gating with authenticated CPA checks before maintenance disclosure, while
  retaining transactional fences for requests already in flight. Health and read-only routes remain available.
- Fenced journaled mutations, direct guard repairs, Cognito invitations, private-file uploads/deletes, and ZIP creation.
  Expired upload intents settle only from destination observation or a durable receipt; unexplained S3 objects and
  unresolved external/file activity block maintenance close.
- Bound ZIP manifests and workers to maintenance generation and active intent. Stale-generation work cannot acquire a
  lease or write an archive, and worker IAM now has only the required journal-table read/transaction permissions.
- Added a fixed Deno/Base44 bridge with an exact entity and operation allowlist. It exposes no arbitrary-code channel
  and uses the CLI-managed credential profile without reading or serializing its token store.
- Added deterministic Windows Deno discovery/PATH normalization so pinned CLI execution works under the required Node
  20 runtime.
- Added Base44-assigned-ID recovery by immutable source aliases, source-timestamp preservation, typed-reference
  rewriting, owner-row-aware reconciliation, and public-link compatibility installation for the five token-protected
  public functions.
- Added strict target/source fingerprint validation, independent strongly consistent AWS baseline reconciliation,
  contiguous GLOBAL journal reconstruction, complete logical-operation grouping, coverage rejection, dependency
  ordering, User invitation/email ID mapping, nested reference rewriting, exact S3 version reads, private uploads,
  reference-safe file deletion, and exhaustive six-entity destination reconciliation.
- Added locked atomic private checkpoints plus Dynamo operation receipts. Every destination mutation and receipt
  rechecks the exact maintenance run/generation/range, allowing safe interruption/resume while making abort fail closed.
- Added destination-observed idempotence for ambiguous results. Private file deletion counts as observed only after an
  explicit Base44 `404` or `410`; timeouts and other bridge failures remain blockers.
- Added a test-only operator pause flag that exits only after a durable operation receipt, making the interruption
  proof deterministic instead of relying on process timing.
- Corrected create observation to use the immutable source alias rather than probing an unassigned AWS ID through
  Base44's native-ID filter, and excluded AWS `created_by` because Base44 owns that audit field. Both cases are covered
  by replay projection/resume tests.
- Added a resumable isolated-rehearsal provisioner for seven tagged on-demand DynamoDB tables, a private versioned S3
  bucket, an empty manifest-bound snapshot, and invented no-invitation/no-delete fixtures. Protected resource bindings
  stay outside version control.
- Added read-only dry-run output outside the repository, aggregate-only privacy-validated evidence generation, strict
  production confirmation separation, and operator commands for bootstrap, start, close, status, replay, reconcile,
  abort, abandonment reopen, and terminal rollback.
- Added an owner-only fixture harness using existing runtime services for invented Client, QuestionnaireTemplate,
  Submission, invitation, private-file replacement, and versioned deletion behavior; no product-only delete route was
  introduced. The harness can explicitly omit invitation and disposable physical deletion for the waiver-bound
  rehearsal while retaining create/update/upload/reference-replacement coverage.
- Added `reverse-replay` and `test:reverse-replay` scripts, pinned the TypeScript runner, expanded foundation test/lint
  scope and SST contract verification, and added relevant CI path filters and tests without Base44 write credentials.
- Added `docs/migration/base44-rollback-replay-runbook.md` with operator/CPA roles, private-input rules, the 15-minute
  presign drain, upload/orphan/ZIP closure, exact replay/resume/reconcile/evidence flow, abort versus abandonment reopen,
  terminal rollback behavior, privacy boundaries, and the DNS prohibition.

## Task status

- Tasks 1-16: complete.
- Task 2's assigned-ID/system-timestamp incompatibility is resolved through source aliases and public-link resolution.
  Unsupported disposable probe-file cleanup and live invitation verification are explicit owner-accepted limitations
  recorded by passing protected capability evidence without weakening real replay failure handling.
- Task 15 passed with invented fixtures on isolated AWS resources: boundary close, deterministic interruption/resume,
  zero-write rerun, zero-drift reconciliation, aggregate evidence, terminal rollback, and the distinct no-write
  abort/abandonment path were all observed live.

## Plan amendments and implementation decisions

- CPA mutation routes perform authentication before their maintenance check so maintenance state is not leaked to an
  unauthenticated caller. The same generation fence still participates in the business transaction.
- External intent settlement may complete after the control advances into maintenance, but only for the exact intent
  generation and current control fence. This lets an in-flight Cognito/S3 compensation close honestly without reopening
  business writes.
- `reconcile` requires the controlled-rehearsal/actual-rollback confirmation because successful reconciliation records
  restricted AWS replay state; it is not a read-only command.
- Abandonment reopen is test-stage only and additionally proves no Dynamo replay receipt, no local completed operation,
  and an empty six-entity target. Successful rollback instead remains terminal and write-disabled.
- The bridge is pinned to Base44 CLI 0.1.14 and Deno 2.9.5, matching the provisioned target contract.
- Base44 owns native IDs and system timestamps. The compatibility contract preserves their AWS values in ordinary
  `auditflow_source_*` fields and never attempts to overwrite destination-owned fields.
- Capability execution is two-phase around the external invitation acceptance. Phase one cleans business fixtures and
  returns a pending result; phase two requires `--confirm-invitation-login`, proves retry/update/delete, and restores
  the owner-only User baseline.

## Controlled rehearsal result

- The public-link blocker remains resolved by native-ID-first/source-alias-second Client lookup with the original token
  validation unchanged.
- Base44 private upload, signed read, and byte equality passed. Deletion of unreachable disposable probe blobs and live
  invitation/login verification were omitted under the owner's explicit waivers. The journal contained neither
  operation; real replay still fails closed if either is encountered and cannot be observed.
- The mandatory app owner remained the sole baseline User. No production-derived test-table row was copied or deleted;
  all rehearsal AWS state lived in separately provisioned, tagged resources and all fixture values were invented.
- The main range closed only after the required 15-minute presigned-upload drain and quiescence/orphan checks. Dry-run
  reported 9 mutations across 8 logical operations and 2 files without printing protected identifiers or values.
- A first isolated attempt exposed an unsafe direct native-ID probe for new AWS IDs and was aborted in maintenance. A
  second exposed Base44 ownership of `created_by`, was also aborted, and its single invented Client was removed. Neither
  checkpoint was bypassed. The corrected final run started from a newly enumerated owner-only target and fresh isolated
  AWS resources.
- Final replay paused after one durable checkpoint, resumed through all 8 operations, independently reconciled at zero
  missing/extra/drift, reran with zero writes, reconciled again, generated aggregate-only evidence, and terminalized as
  `ROLLED_BACK` with AWS writes disabled.
- A distinct zero-write scenario proved `abort-replay` leaves maintenance active and `resume-aws-writes` reopens only
  after the explicit abandonment confirmation, zero receipt/checkpoint proof, and owner-only Base44 enumeration.

## Validation

- Node 20.17.0 clean `npm ci`: PASS; existing peer/engine/deprecation and 36 audit findings remain.
- Application: PASS, 110 tests in 13 files.
- PDF: PASS, 22 tests in 3 files.
- Reverse replay: PASS, 38 tests in 4 files.
- Foundation: PASS, 349 tests in 44 files.
- Foundation typecheck and lint: PASS.
- Production build: PASS. The first concurrent Windows build hit a transient `dist/assets` `ENOTEMPTY`; the immediate
  sequential rerun passed.
- Application typecheck: inherited frontend failure; no frontend source or frontend type configuration changed.
- Full-tree lint: inherited failure consisting of the same two unused-import errors; foundation/new tooling lint passes.
- SST foundation contract verifier: PASS.
- Strict test private-file cutover verifier: PASS.
- Codex-layer validator: PASS, 31 skills and 6 custom agents.
- `git diff --check`: PASS.

## Required handoff

No implementation or rehearsal gate remains. Review and merge PR #35 when CI and review are green. Issue #15 still
requires a separate explicit production rollback authorization before any production replay or DNS action.
