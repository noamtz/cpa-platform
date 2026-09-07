# Implementation Report — Prove reverse migration and rollback replay

**Plan**: `.agents/plans/prove-reverse-migration-rollback-replay.md`

**Branch**: `feature/prove-reverse-migration-rollback-replay`

**Tracker**: issue #12 under epic #1; issues #5, #6, #8, #10, and #11 revalidated closed

**Status**: IMPLEMENTATION COMPLETE; CONTROLLED LIVE REHEARSAL BLOCKED

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
upload, signing, and byte-for-byte read. It then failed closed because Base44 rejected private-file deletion. The same
operation failed through privileged CLI execution and a temporary deployed backend-function probe; the official Core
integration reference documents private upload and signed reads but no delete API. The invitation was sent but has not
materialized as a distinct signed-in User. All business rows were cleaned and the mandatory owner-only User baseline
was restored, but the disposable target now contains unenumerable probe-file orphans and must be replaced.

This remains a target-fidelity blocker, not a successful rehearsal. Maintenance bootstrap, guarded deployment, AWS
fixture mutation, replay, and evidence generation were not attempted. `AGENTS.md` was intentionally not advanced.

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
- Added read-only dry-run output outside the repository, aggregate-only privacy-validated evidence generation, strict
  production confirmation separation, and operator commands for bootstrap, start, close, status, replay, reconcile,
  abort, abandonment reopen, and terminal rollback.
- Added an owner-only fixture harness using existing runtime services for invented Client, QuestionnaireTemplate,
  Submission, invitation, private-file replacement, and versioned deletion behavior; no product-only delete route was
  introduced.
- Added `reverse-replay` and `test:reverse-replay` scripts, pinned the TypeScript runner, expanded foundation test/lint
  scope and SST contract verification, and added relevant CI path filters and tests without Base44 write credentials.
- Added `docs/migration/base44-rollback-replay-runbook.md` with operator/CPA roles, private-input rules, the 15-minute
  presign drain, upload/orphan/ZIP closure, exact replay/resume/reconcile/evidence flow, abort versus abandonment reopen,
  terminal rollback behavior, privacy boundaries, and the DNS prohibition.

## Task status

- Tasks 1 and 3–14: complete locally.
- Task 2: the assigned-ID/system-timestamp incompatibility is resolved through source aliases and public-link
  resolution. Live capability execution now blocks on unsupported private-file deletion and a still-unaccepted
  disposable invitation.
- Task 15: not executed because the controlled rehearsal prerequisites fail closed.
- Task 16: this report records the result; committed evidence and migration-status changes remain intentionally pending
  until an accepted rehearsal.

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

## Controlled rehearsal blockers

- The public-link blocker is resolved by native-ID-first/source-alias-second Client lookup with the original token
  validation unchanged.
- Base44 private upload, signed read, and byte equality pass, but private-file deletion is rejected by both privileged
  CLI and deployed-function paths. This blocks replay of reachable file deletions.
- The invitation has not materialized as a second User because the disposable invited identity has not completed a
  distinct login. The mandatory app owner must not be removed.
- Failed deletion probes left unenumerable orphan files in the disposable target, so a fresh native dashboard clone is
  required before another accepted matrix.
- A dedicated invented baseline snapshot and rehearsal fixture remain required after an approved link-compatibility
  target exists. No production-derived client data may be copied into the rehearsal clone.

The protected target descriptor and private aggregate blocker evidence record this result. No maintenance bootstrap,
guarded test deployment, AWS rehearsal fixture mutation, replay, committed verification evidence, or delivery-status
update occurred.

## Validation

- Node 20.17.0 clean `npm ci`: PASS; existing peer/engine/deprecation and 36 audit findings remain.
- Application: PASS, 110 tests in 13 files.
- PDF: PASS, 22 tests in 3 files.
- Reverse replay: PASS, 36 tests in 4 files.
- Foundation: PASS, 347 tests in 44 files.
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

Before resuming task 15, create a fresh native dashboard clone, bind a distinct disposable invitation identity, apply
the compatibility installer, and rerun the entire capability matrix from its verified owner-only baseline. The target
must demonstrate an observable private-file delete; if the native clone also lacks it, Base44 platform support or a
documented supported delete API is required and issues #14/#15 remain blocked. Only after every capability passes
should the owner provide the protected invented baseline/rehearsal fixture and authorize guarded deployment,
maintenance closure, interrupted/resumed replay, zero-write rerun, zero-drift reconciliation, evidence read-back, and
the separate abort/abandonment scenario.
