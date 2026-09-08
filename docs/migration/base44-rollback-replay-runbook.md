# Base44 rollback replay runbook

This runbook proves issue #12 on the isolated test target and defines the production rollback sequence consumed by
issue #15. It never authorizes production replay, DNS changes, Terraform changes, Base44 cancellation, or broad
cleanup. The application runtime remains AWS-only; only this operator tool can write to the controlled Base44 target.

## Authority and roles

- The product owner authorizes the exact stage, target descriptor, invented fixture, maintenance window, and every
  mutating command. Production needs a new explicit rollback decision; rehearsal approval is not transferable.
- The owner tells both CPAs when maintenance starts, which workflows are unavailable, and when the authoritative
  application is restored. No DNS change is attempted by this tool.
- The operator keeps snapshots, fixture inputs, capability output, checkpoints, dry-run plans, and detailed evidence
  under the protected roots declared by the target descriptor. Never paste them into CI, Issues, PRs, logs, or chat.
- Use only the `noamtz/cpa-platform` repository and its `noamtz` GitHub identity. Production data and the pinned source
  repository are read-only unless a separately authorized production rollback requires the documented bridge.

## Non-negotiable gates

Use Node 20.17.0. The target descriptor is
`C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json`; commands accept no app identifier,
URL, credential, private-file URI, invitation address, or alternate checkpoint flag. Base44 authentication stays in
its CLI-managed profile and is validated only by the fixed bridge.

Before any fixture write:

1. Confirm issues #5, #6, #8, #10, and #11 remain accepted and the verified test import is current.
2. Remove the mismatched private clone through the Base44 dashboard and update the protected descriptor only after
   remote read-back proves it is gone.
3. Prove the selected app is private, matches six entity schemas and seventeen source functions (with the documented
   non-state notification exclusion), and is not the production app.
4. Run live enumeration of all six entities. The five business collections must be zero and `User` must contain
   exactly one identified app-owner row with an administrator role. Base44 does not permit removing the app owner.
   Any additional row blocks fixture writes; a documented empty-clone expectation is not sufficient.
5. Supply an invented capability file in the protected fixture root. Supply a disposable, observable, non-client
   invitation inbox unless the owner explicitly waives live invitation verification. Never reconnect production
   notifications or integrations.
6. Install and deploy the rollback compatibility fields/functions in the disposable clone. Then run the capability
   matrix. Assigned-ID mapping, immutable source aliases/timestamps, public-link resolution, create/update/delete
   visibility, pagination, private upload/read, and retry observability must pass. Invitation/login and disposable
   probe-file cleanup may be omitted only under the recorded owner waivers; real replay remains fail-closed for those
   operations. Any other unsupported result blocks issues #14 and #15.

## Local and contract validation

```powershell
node --version
npm ci
npm run test:reverse-replay
npm run test:foundation
npm run typecheck:foundation
npm run lint:foundation
npm run build
node tooling/verify_sst_foundation.mjs --mode contract --stage test
python tooling/validate_codex_layer.py
git diff --check
```

The version must be `v20.17.0`. CI runs only static and fake-adapter checks and never receives Base44 write access.

## Controlled rehearsal preparation

Define these variables only in the operator's local PowerShell session. Values come from the protected descriptor,
the invented rehearsal snapshot, the invented fixture file, and current SST output. Do not print them.

```powershell
$targetDescriptorPath = 'C:\Users\ntzur\Documents\Codex\AuditFlow\rollback-replay\rehearsal-target.json'
$snapshotPath = '<absolute protected invented snapshot directory>'
$capabilityFixturePath = '<absolute protected capability fixture file>'
$rehearsalFixturePath = '<absolute protected invented fixture file>'
$artifactRoot = '<absolute protected isolated rehearsal root>'
$outputsPath = '.sst/rehearsal-outputs.json'
```

Provision isolated, tagged test resources before the rehearsal. This writes no production-derived data and refuses
to use an artifact root inside the repository. A distinct `--outputs` file and artifact root are required for a
second abort/abandonment scenario.

```powershell
npm run provision:isolated-rehearsal -- --artifact-root $artifactRoot --outputs $outputsPath
```

Read-only doctor and the controlled capability probe:

```powershell
npm run reverse-replay -- doctor --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath
npm run install:base44-rollback-compat -- --target-descriptor $targetDescriptorPath --apply --confirm-controlled-rehearsal
$cloneRoot = (Get-Content $targetDescriptorPath -Raw | ConvertFrom-Json).local_paths.clone_root
Push-Location $cloneRoot
npx --yes base44@0.1.14 entities push
npx --yes base44@0.1.14 functions deploy getClientByToken updateClientSubmission uploadFile getSignedPdfUrl getTemplateFileUrl
Pop-Location
npm run install:base44-rollback-compat -- --target-descriptor $targetDescriptorPath
npm run reverse-replay -- capabilities --stage test --target-descriptor $targetDescriptorPath --fixture $capabilityFixturePath --confirm-controlled-rehearsal
# After the invited user accepts the invitation and signs in:
npm run reverse-replay -- capabilities --stage test --target-descriptor $targetDescriptorPath --fixture $capabilityFixturePath --confirm-controlled-rehearsal --confirm-invitation-login
# Or, only after an explicit owner decision to omit live invitation proof:
npm run reverse-replay -- capabilities --stage test --target-descriptor $targetDescriptorPath --fixture $capabilityFixturePath --confirm-controlled-rehearsal --waive-invitation-verification
```

The capability fixture contains invented create/update records for the five ordinary entity surfaces, a second Client
record for forced one-row pagination, a disposable invitation address plus User update, and a private binary path. The
capability command mutates only the approved owner-only clone, verifies each effect across all six entity surfaces,
removes every disposable record, attempts best-effort cleanup of the unreachable probe file, proves the target returned
to its owner-only entity baseline, and stores aggregate results outside the repository. It stops if a business
collection is nonempty, the owner baseline changes, or a required business effect is unobservable. Failure to delete
the disposable probe blob is recorded as `disposableFileDeletionObserved: false` but is not a shipping blocker. Verify
delivery/login at the disposable inbox before accepting the invitation gate; do not use a client address. The first
run may return `pending_invitation_acceptance` after cleaning all business records and attempting best-effort
probe-file cleanup. The explicit second command accepts the activated invited User, proves retry and update behavior,
deletes that disposable User, and writes passing capability evidence. When the owner explicitly omits that live proof,
the waiver command does not send another invitation and instead records `invitationVerificationWaived: true`. Actual
replay remains fail-closed if its journal contains an invitation that cannot be observed at the destination.

Current controlled-target result (updated 2026-09-08): **PASSED WITH OWNER WAIVERS**. The approved
compatibility design now
stores the AWS ID and timestamps in ordinary immutable alias fields, records Base44-assigned IDs, rewrites references,
and resolves public Client links by native ID then source alias without weakening token validation. Live entity CRUD,
alias observation, assigned-ID mapping, pagination, private upload, signing, and byte-for-byte read passed. The
invitation was sent but has not materialized as a distinct signed-in User. Base44 rejected private-file deletion both
from privileged CLI execution and from a deployed backend-function probe; its current official Core integration
reference documents private upload and signed read but no delete method. By owner decision, cleanup of unreachable
disposable probe blobs is best effort and does not require a fresh clone. This waiver does not change real replay
semantics: a journaled file deletion remains fail-closed unless absence is observed. The owner also waived live
invitation/login verification for this rehearsal. The rerun restored the owner-only entity baseline and wrote protected
capability evidence recording both waivers; maintenance bootstrap may proceed once the isolated invented AWS baseline
and fixture exist.

## Exact start and maintenance boundary

Deploying guarded code requires the maintenance control to exist first. Bootstrap is an explicit one-time test action:

```powershell
npm run reverse-replay -- maintenance-bootstrap --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- maintenance-status --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath
```

`mark-cutover-start` strongly reads the `GLOBAL` cursor and accepts the snapshot only when its reconciled AWS
projection hash and `lastAppliedGlobalCursor` match exactly. It atomically binds the manifest, target, run, cursor, and
new maintenance generation. If the cursor advances, capture and reconcile a new baseline; never edit the binding.

```powershell
npm run reverse-replay -- mark-cutover-start --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- rehearsal-fixtures --stage test --target-descriptor $targetDescriptorPath --fixture $rehearsalFixturePath --outputs $outputsPath --confirm-controlled-rehearsal
```

The invented fixture must exercise Client/Submission/template create and update, questionnaire JSON-string state,
native file creation, and reference replacement. By default it also exercises User invitation and versioned file
deletion. Under the recorded owner waivers, omit `invitation_email` and set `delete_original_file` to `false`; this
keeps those unverified capabilities out of the rehearsal journal while preserving fail-closed production behavior.
Every journaled transaction and direct guard repair is conditioned on the exact OPEN generation.

Start the communicated maintenance window, stop new API mutations, and wait at least 15 minutes from the last issued
upload URL. Then inspect every active external intent, presigned upload capability, unlinked Cognito identity,
unreceipted S3 object version, file-reconciliation item, pending/running ZIP request, lease, and result. Close cancels
an expired upload intent only after proving its referenced object is absent, resolves it only when the create receipt
exists, and scans all owned S3 objects for missing receipts. Do not delete or guess at an orphan; keep close blocked.

```powershell
npm run reverse-replay -- maintenance-close --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- maintenance-status --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath
```

Close atomically requires zero external activity and captures the inclusive end cursor under a new generation. An
in-flight request can commit before that boundary or fail with `{ "error": "Maintenance in progress" }`; it cannot
land after it. A delayed ZIP notification from an older generation must not process.

## Dry-run, replay, interruption, and resume

The dry-run performs all AWS/Base44 reads, range continuity/group/hash checks, full-state reconstruction, coverage and
dependency planning, and file-version checks. It performs zero AWS control/checkpoint or Base44 writes. Its protected
plan lists exact affected entity and file identifiers but no client values or contents; terminal output is counts only.

```powershell
npm run reverse-replay -- plan --dry-run --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath
npm run reverse-replay -- replay --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --pause-after-operations 1 --confirm-controlled-rehearsal
```

The test-only pause flag exits with code `2` immediately after the requested number of durable operation receipts.
Resume the exact immutable binding:

```powershell
npm run reverse-replay -- replay --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --resume --confirm-controlled-rehearsal
```

Replay queries the numeric `GLOBAL` partition for `(start,end]`, preserves adjacent logical operations, uploads exact
S3 versions before pointer-bearing records, rewrites flat and nested JSON-string references, and checkpoints a group
only after every destination state is observed. An ambiguous record response is resolved by observation; an ambiguous
upload without safe rediscovery is a release blocker.

## Reconciliation, zero-write rerun, and evidence

```powershell
npm run reverse-replay -- reconcile --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- replay --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --resume --confirm-controlled-rehearsal
npm run reverse-replay -- evidence --stage test --target-descriptor $targetDescriptorPath --snapshot $snapshotPath --outputs $outputsPath --output docs/migration/base44-reverse-replay-verification.json
```

Reconciliation independently paginates all six entities, compares mapped business state and relationships, reads active
private files, and checks file count, bytes, and hash. The completed rerun must report zero destination writes. Evidence
is generated only from the current complete zero-drift checkpoint and contains aggregate counts/booleans—never raw
IDs, names, addresses, file names, URLs/URIs, paths, record values, snapshots, resource names, or credentials.

## Abort, abandonment, and successful rollback

`abort-replay` freezes the replay run only. It never changes AWS from MAINTENANCE to OPEN:

```powershell
npm run reverse-replay -- abort-replay --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath --confirm-controlled-rehearsal
npm run reverse-replay -- maintenance-status --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath
```

Exercise abandonment on a distinct disposable rehearsal run before its first Base44 write. Reopening requires a new
owner decision and explicit proof that Base44 received zero replay writes. If any disposable write occurred, reverse
it and reconcile the fixture to its pre-run state first.

```powershell
npm run reverse-replay -- resume-aws-writes --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath --confirm-no-replay-writes --confirm-controlled-rehearsal
```

For an actual successful rollback, do not run `resume-aws-writes`. After accepted zero-drift reconciliation, terminalize
the control as `ROLLED_BACK`; AWS remains write-disabled:

```powershell
npm run reverse-replay -- successful-rollback --stage test --target-descriptor $targetDescriptorPath --outputs $outputsPath --confirm-controlled-rehearsal
# Production requires a new, explicit owner authorization:
npm run reverse-replay -- successful-rollback --stage production --target-descriptor <owner-approved-production-descriptor> --outputs $outputsPath --confirm-actual-rollback
```

Current controlled result (2026-09-08): **PASSED**. The invented range contained 9 entries in 8 logical operations,
replay resumed after one durable checkpoint, total destination writes were 9, the completed rerun wrote zero,
reconciliation reported zero missing/extra/drift, aggregate evidence reported zero blockers, and the control read back
as terminal `ROLLED_BACK`. A distinct zero-write scenario also passed abort-preserved maintenance and guarded
abandonment reopen. Production remained untouched.

Only issue #15 may then restore DNS to Base44, after the owner verifies Base44 is authoritative and communicates the end
of maintenance. Never reopen AWS writes after DNS points users to Base44. Any capability, range, journal, hash, mapping,
file, checkpoint, privacy, or reconciliation failure leaves maintenance in place and blocks DNS restoration.
