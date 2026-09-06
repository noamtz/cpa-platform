# Base44 snapshot import and legacy-file cutover runbook

This runbook operates issue #11's test-stage import. Source snapshots, identity maps, checkpoints, detailed findings,
AWS identities, and resource names are private operator material. Keep them outside this repository. Only the fixed,
aggregate `docs/migration/private-file-import-verification.json` evidence artifact may be reviewed and committed.

Implementation of the importer and fail-closed cutover gate does not authorize an AWS write, deployment, user change,
or production action. Obtain explicit owner authorization for the exact test import before the import command and a
separate authorization for the later protected enablement/disable rehearsal. Production import and legacy-read
enablement are prohibited by this issue.

## Prerequisites and private inputs

- Use Node 20.17.0, Python 3, AWS region `il-central-1`, and an independently verified owner-operated AWS session.
- Use the exact completed snapshot handed off by the read-only exporter. Do not edit or relocate files within it.
- Create an external checkpoint directory and an external identity-map file. Neither may be inside this worktree.
- Set `AUDITFLOW_EXPECTED_AWS_ACCOUNT_ID` in the operator environment. Never pass it on the command line or record its
  value in logs, evidence, or this repository.
- The identity map has schema version 1, stage `test`, and exactly two entries in `users`. Each entry contains only
  `userId` and `cognitoSubject`; the source administrators and Cognito subjects must be unique and already exist in
  the deployed test pool.
- Confirm `.sst/outputs.json` was produced for stage `test`. The doctor validates the exact six tables, private bucket,
  Cognito pool, bucket encryption/versioning, and mapped identities before an import can write.
- The operator session needs only STS identity; DynamoDB Describe/Get/Put/Scan on the six tables; S3 ListBucket and
  Head/Get/Put on `legacy/*`; Cognito Describe/List/AdminGet for the test pool; and KMS decrypt only when required by
  the bucket key. A 403 is terminal and is never treated as an absent object.

Use private, absolute paths and do not paste their resolved values into tickets or committed reports:

```powershell
$env:AUDITFLOW_EXPECTED_AWS_ACCOUNT_ID = "<expected-account-id>"
$snapshotPath = "D:\private-migration\snapshot"
$checkpointRoot = "D:\private-migration\checkpoint"
$identityMapPath = "D:\private-migration\identity-map.json"
$outputsPath = (Resolve-Path '.sst\outputs.json').Path
```

## Verify and plan without writes

Run the Python verifier first. Any version, manifest, inventory, file, relationship, or gate failure requires a new
separately authorized read-only export; never weaken validation or repair the private snapshot in place.

```powershell
python tooling/export_base44_snapshot.py verify --snapshot $snapshotPath
npm run import:base44 -- doctor --stage test --snapshot $snapshotPath --checkpoint-root $checkpointRoot --identity-map $identityMapPath --outputs $outputsPath
npm run import:base44 -- plan --stage test --snapshot $snapshotPath --checkpoint-root $checkpointRoot --identity-map $identityMapPath --outputs $outputsPath
```

The commands print bounded aggregate JSON only. A failure prints one redacted category. Investigate details from the
private inputs/checkpoint without copying IDs, subjects, references, URLs, tokens, filenames, paths, AWS responses, or
resource names into committed material.

### Authorized source exceptions

The verified test snapshot contains historical inconsistencies that must be handled deterministically without editing
the immutable source rows:

- When an exact missing client ID is referenced by source submissions, the importer may synthesize one archived
  migration-only client with that same ID. The row is source-manifest-bound, contains no invented identifying data,
  and records only aggregate provenance. The exception is compiled against the reviewed manifest hash and the
  approved aggregate shape of one missing client referenced by 20 submissions; any other manifest or shape blocks
  preflight.
- When several active submissions share a client/year key, all submissions are preserved and the active guard points
  to the deterministic winner: latest `updated_date`, then latest `created_date`, then lexicographically smallest ID.
  The evidence reports the number of non-winning active submissions separately.
- Empty optional PDF-template references are absent relationships. Positive integral legacy tax years through 9999
  are preserved because the source contract does not impose the former 2200 ceiling.

These rules are limited to the import compatibility layer. They do not change source files or silently repair other
relationship, identity, reference, or target conflicts.

## Authorized test import, interruption, and resume

After explicit authorization for this exact test-data mutation, start the import with its stage-specific confirmation:

```powershell
npm run import:base44 -- import --stage test --snapshot $snapshotPath --checkpoint-root $checkpointRoot --identity-map $identityMapPath --outputs $outputsPath --confirm-test-import
```

For the required recovery rehearsal, interrupt only after the command reports durable checkpoint progress. Rerun the
same command with `--resume`. Never run two processes against the same checkpoint; the exclusive lock fails closed.

```powershell
npm run import:base44 -- import --stage test --snapshot $snapshotPath --checkpoint-root $checkpointRoot --identity-map $identityMapPath --outputs $outputsPath --confirm-test-import --resume
```

After completion, rerun the completed import once without `--resume`. It must recompare the target and report zero
writes. Existing unequal DynamoDB rows or S3 objects, binding drift, missing identities, malformed markers, pagination
failures, checksum mismatches, or new source findings stop the process; do not overwrite or clean fixtures.

## Reconcile and render aggregate evidence

Reconciliation performs full paginated table scans and legacy-prefix listing, validates every imported item/object,
and counts unmarked synthetic/operational extras separately. Evidence can be rendered only from a completed checkpoint
and a fresh passing reconciliation.

```powershell
npm run import:base44 -- reconcile --stage test --snapshot $snapshotPath --checkpoint-root $checkpointRoot --identity-map $identityMapPath --outputs $outputsPath
npm run import:base44 -- evidence --stage test --snapshot $snapshotPath --checkpoint-root $checkpointRoot --identity-map $identityMapPath --outputs $outputsPath --output docs/migration/private-file-import-verification.json
npm run verify:file-cutover:test
```

Before committing evidence, independently compare its aggregate counts with the verified snapshot and inspect the
file and diff. Its totals include source records, derived placeholder clients, resolved duplicate-active submissions,
derived guards, separately counted target extras, and reference/object closure. It must contain only
schema/resolver/tool versions, canonical timestamps, stage, counts, aggregate SHA-256 values, and the seven true
gates. Delete and regenerate it if it contains an ID, subject, email, token, URL,
path, filename, reference/object key, resource name, or detailed finding. Keep the snapshot and checkpoint under the
owner's private retention policy until acceptance and rollback rehearsal are complete; do not commit either one.

## Protected enablement and live acceptance

First merge the reviewed aggregate evidence while ordinary deployment remains disabled. In GitHub, create the
`test-legacy-read-enable` Environment with a required owner reviewer and a deployment branch policy restricted to
`main`, then read back both protections. Missing or unverifiable protection blocks enablement.

With separate deployment authorization, dispatch `Deploy SST test` from `main` with
`enable_legacy_file_reads=true` and the exact evidence `sourceManifestSha256`. The workflow validates the evidence and
request before acquiring AWS credentials, previews the change, deploys both matching runtime values, and runs the
enabled live verifier. Verify representative imported public-token questionnaire/file/PDF reads, CPA-authorized
file/template reads, and ZIP completion. Also prove invalid token, cross-client ownership, unresolved reference,
arbitrary reference, and missing object paths return the existing 404 behavior without a signed URL or ZIP job. Record
only aggregate outcomes.

The equivalent owner-side verification command is:

```powershell
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json --legacy-file-reads enabled --evidence docs/migration/private-file-import-verification.json
```

## Disable rehearsal

Dispatch the workflow again from `main` with `enable_legacy_file_reads=false` and an empty expected-manifest input.
Verify both functions are false with empty manifest bindings:

```powershell
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json --legacy-file-reads disabled
```

Repeat a negative legacy file and ZIP probe and confirm no S3 read/sign or ZIP job occurs. Disabling reads does not
delete imported rows or objects. Re-enable only after a new explicit owner decision and only while the reviewed
evidence remains fresh and matches the deployed test import.
