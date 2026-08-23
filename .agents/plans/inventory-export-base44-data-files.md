# Feature: Inventory and export Base44 data and files

The following plan is complete for the repository state at `126427b802fd0e38dae4b6c181e714646b0eec29`
after issue #4. Before implementation, repeat the drift, access, and CLI capability checks below. This ticket handles
highly sensitive production tax records and files: raw output is local, ignored, and outside the Git worktree; only
aggregate reconciliation evidence may be committed.

## Feature Description

Build a repeatable, read-only production snapshot tool for the six Base44 entities (`Client`, `Submission`,
`QuestionnaireTemplate`, `PdfTemplate`, `SyncedDriveFile`, and `User`). Preserve every field returned by Base44,
including system metadata and legacy JSON strings; recursively discover file references at any nested or stringified
JSON path; download accessible private and approved public files; and produce deterministic object/file checksums,
resumable state, a private machine-readable manifest, and a sanitized rehearsal report.

The tool is migration evidence for the later AWS import in issue #11. It does not import, normalize, update, or
delete anything.

## User Story

As the AuditFlow product owner, I want a complete and reproducible read-only snapshot of Base44 records and files so
that I can prove the migration boundary, reconcile a later AWS import, and stop cutover if any production data is
missing.

## Problem Statement

Base44's documented dashboard export is per-table CSV and does not discover or download private files embedded in
legacy arrays, nested response objects, signed-PDF records, or PDF template JSON. Current product helpers enumerate
only known paths and sometimes swallow parse/download errors. They are behavior evidence, not a complete migration
inventory. A naive script could also miss pagination, leak client tokens or signed URLs, fetch arbitrary hosts, or
leave a corrupt partial snapshot after interruption.

## Solution Statement

Use a standard-library Python orchestration layer for canonical serialization, recursive discovery, hashing, safe
downloads, atomic checkpoints, resume, offline verification, and redacted reporting. Use a deliberately tiny
TypeScript bridge executed through the supported, pinned Base44 CLI as the only authenticated platform seam. The
bridge accepts only two operations: paginated entity reads and private-file signing. Run it with
`exec --privileged --data-env prod`, which gives an authenticated owner/editor complete read visibility without
deploying a Base44 function or inventing an undocumented Python API.

Fetch each entity in bounded pages, require two consecutive canonical inventories to match, reject duplicate/missing
IDs, and retain the first stable record set verbatim in private page artifacts. Walk every record recursively and
also walk successfully decoded object/array JSON strings, recording every JSON Pointer occurrence. Deduplicate
downloads by source-reference fingerprint and then by content hash, but retain all referrers. Keep signed URLs only
in memory. On interruption, verify existing checkpoints and hashes before resuming; never append to or overwrite an
incompatible run.

## Out of Scope / Non-Goals

- Not included: importing records/files into DynamoDB or S3; issue #11 consumes this snapshot.
- Not included: final cutover delta, reverse migration, DNS, Base44 retirement, or rollback replay.
- Not included: deploying a new Base44 function, changing the Base44 app, calling create/update/delete/upload/sync
  APIs, or modifying `C:\Users\ntzur\workspace-antigravity\auditflow`.
- Not included: normalizing `responses`, `signed_pdfs`, `cpa_audit_log`, template JSON, field names, IDs, timestamps,
  tokens, or legacy flat submission fields.
- Not included: Google Drive content export. `SyncedDriveFile` records are preserved, but Drive IDs are not fetched.
- Not included: arbitrary internet crawling. Public candidates require an explicit approved host; private references
  are resolved only through Base44's signed-file operation.
- Not included: committing raw records, object IDs, file URIs, filenames, query strings, tokens, PII, tax data,
  downloaded bytes, checkpoints, or the private manifest.
- Not changing: frontend, SST/AWS foundation, authentication, PDF behavior, source schemas, or product dependencies.

## Feature Metadata

**Feature Type**: New capability / migration tooling

**Estimated Complexity**: High

**Primary Systems Affected**: `tooling/`, migration documentation, `.gitignore`, Base44 read/sign APIs, local
operator storage

**Dependencies**: Python 3.11+ standard library; Base44 CLI `0.1.10`; a separate Node `>=20.19.0` CLI shell;
Deno `2.9.5` on that CLI shell's `PATH`; Base44 owner/editor login; `BASE44_APP_ID` in the operator environment;
adequate encrypted local disk space

## Related Work

**Implements**: [issue #5](https://github.com/noamtz/cpa-platform/issues/5) · **Epic**:
[issue #1](https://github.com/noamtz/cpa-platform/issues/1),
[PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration), and
[architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- [Issue #3](https://github.com/noamtz/cpa-platform/issues/3) and
  `.agents/plans/import-auditflow-production-source-baseline.md` - accepted source/provenance baseline and Python
  manifest conventions.
- [Issue #4](https://github.com/noamtz/cpa-platform/issues/4) and
  `.agents/plans/establish-sst-serverless-aws-foundation.md` - establishes the target six entity tables plus
  `ChangeJournal`; this ticket does not write to them.
- `docs/migration/auditflow-source-manifest.json` - schema-versioned per-object verification precedent, not the
  schema for sensitive live data.

**Forward-references**:

- [Issue #11](https://github.com/noamtz/cpa-platform/issues/11) will import and reconcile the private snapshot.
- [Issue #14](https://github.com/noamtz/cpa-platform/issues/14) will consume the sanitized evidence in its readiness
  gate.
- [Issue #15](https://github.com/noamtz/cpa-platform/issues/15) will run the final snapshot/delta before cutover.

---

## CONTEXT REFERENCES

### Relevant Codebase Files - read before implementing

- `AGENTS.md` architecture map and ground rules - new migration code belongs in this repository; the external
  production source and Base44 records are read-only.
- `.agents/references/auditflow-rewrite-target.md:3-9` - source integrity, AWS target, parity, and retirement boundary.
- `.agents/references/auditflow-submission-compatibility.md:1-7` - preserve raw JSON-string fields and legacy flat
  fields; do not normalize in export.
- `.agents/references/auditflow-api-security-contracts.md:1-8` - tokens and file access are resource-sensitive;
  never expose an arbitrary signing endpoint.
- `.agents/references/auditflow-aws-operations.md:25-31` - export does not authorize deployment, production AWS data
  migration, or Base44 retirement.
- `.github/project-documents.json:1-31` and `.agents/references/github-project-documents.md:72-102` - this plan is the
  repository-backed artifact; do not create a duplicate tracker issue.
- `package.json:5-20,26-27` - app remains on Node 20.17.0 and Base44 SDK 0.8.41; the CLI's newer Node requirement must
  stay isolated from the product runtime.
- `.gitignore:1-45` - already excludes env/secrets/build output but has no dedicated migration-snapshot rule.
- `tooling/import_auditflow_source.py:1-15,67-83,149-164` - standard-library CLI, subprocess error, safe path, and
  containment patterns.
- `tooling/import_auditflow_source.py:467-535,637-673` - schema-versioned manifest, immutable evidence comparison,
  argparse subcommands, and single redacted error boundary.
- `tooling/tests/test_import_auditflow_source.py:49-74,122-203,275-340` - isolated temporary fixtures, dry-run,
  tamper, collision, and failure-path testing style.
- `docs/migration/auditflow-source-baseline.md:5-18,109-126` - provenance and immutable verification evidence; do
  not put transient machine paths or sensitive values in committed evidence.
- `base44/entities/Client.jsonc:5-64` - business fields include name, email, phone, token, notes, and activity; raw
  values are sensitive.
- `base44/entities/Submission.jsonc:5-152` - complete legacy/dynamic submission contract, five flat file arrays,
  top-level PDF URL, and four JSON-string fields.
- `base44/entities/QuestionnaireTemplate.jsonc:5-26` - JSON-string steps plus creator email; inactive historical
  versions remain in scope.
- `base44/entities/PdfTemplate.jsonc:5-22` - JSON-string pdfme template containing embedded base64 or a file URI.
- `base44/entities/SyncedDriveFile.jsonc:5-35` - original Base44 file reference and historical Drive metadata.
- `base44/entities/User.jsonc:5-20` and `src/components/dashboard/TeamSection.jsx:22-27` - schema fields are partial;
  runtime lists all users and consumes platform system/profile fields.
- `src/pages/CpaDashboard.jsx:41-48`, `src/pages/PdfTemplateEditor.jsx:55-60`, and
  `src/pages/ClientsPage.jsx:27-33` - current reads use Base44 entity `list`/`filter` and system `created_date`.
- `src/lib/submission-compat.js:6-33,74-91,137-174` - legacy file map, tolerant response parsing, and requirement to
  keep stale/custom response step files.
- `src/components/questionnaire/QuestionStep.jsx:115-137` - dynamic response shape contains files and filenames.
- `src/pages/PdfSignPage.jsx:105-158` and `src/pages/PdfSignPageMobile.jsx:337-350` - signed-PDF record and nested
  `pdf_inputs` variants.
- `src/pages/PdfTemplateEditor.jsx:512-540`, `src/lib/pdfme-config.js:127-169`, and
  `base44/functions/getTemplateFileUrl/entry.ts:30-51` - embedded PDF, typed file-URI, and legacy `private://`
  template forms.
- `base44/functions/deleteSubmissionWithFiles/entry.ts:20-58` and
  `base44/functions/syncFilesToGoogleDrive/entry.ts:90-104` - known paths are useful fixtures but are not exhaustive
  discovery algorithms.
- `base44/functions/downloadAllFiles/entry.ts:20-46` - private signing/download evidence; unlike this legacy code,
  the exporter must report every failure.
- `base44/functions/uploadFile/entry.ts:7-39` - write operation that must never appear in exporter code.

### Current facts to reverify

- Issue #3 is closed and dependency acceptance is merged.
- `main` is `126427b802fd0e38dae4b6c181e714646b0eec29` (`feat: establish SST serverless AWS foundation (#21)`).
- External production-source `HEAD` is the pinned, clean `5920c779cc49d6502bdbb2aad56e40845778fc9c`.
- `origin` is exactly `git@github.com:noamtz/cpa-platform.git`.
- Base44 CLI npm package `base44` latest/tested version on 2026-08-23 is `0.1.10`, with Node `>=20.19.0`.
- Base44 CLI `0.1.10` implements `exec` by spawning `deno`; the rehearsal pins Deno `2.9.5` in a disposable
  operator-only runtime directory rather than adding it to product dependencies.
- `base44 exec --privileged` is documented and present in CLI help; it requires app owner/editor permission and
  bypasses row-level security. The production data environment name is `prod`.
- No linked `base44/.app.jsonc` is committed or currently present here. Live commands use `BASE44_APP_ID` from the
  operator environment and never run `base44 link` or copy CLI authentication state.

If the issue/dependency/architecture, entity contracts, CLI privileged behavior, app ID/data environment, or source
baseline has drifted, stop and amend this plan before a production read.

### New Files to Create

- `tooling/export_base44_snapshot.py` - stdlib Python CLI and reusable canonicalization, discovery, checkpoint,
  download, verification, and summary functions.
- `tooling/base44_export_bridge.ts` - fixed-source Base44 CLI bridge with one request-environment marker; only
  `list_page` and `sign_file`.
- `tooling/tests/test_export_base44_snapshot.py` - synthetic unit/integration fixtures for every acceptance path.
- `tooling/tests/fixtures/base44-export/records.json` - invented non-production entity/page/file-reference variants.
- `docs/migration/base44-export-runbook.md` - safe operator prerequisites, commands, output schema, resume, retention,
  and failure handling.
- `docs/migration/base44-rehearsal-summary.json` - sanitized machine-readable pass/fail rehearsal evidence.
- `docs/migration/base44-rehearsal-summary.md` - human-readable rendering of the same sanitized evidence.

Actual run output is created only under an explicit absolute path outside the repository and is not listed above
because it must never be tracked. Its private shape is:

```text
<output-root>/<run-id>/
  state.json
  manifest.json
  entities/<Entity>/pages/<offset>.json
  entities/<Entity>.ndjson
  files/sha256/<first-two>/<sha256>
```

### Relevant Documentation - read before implementing

- [Base44 CLI overview](https://docs.base44.com/developers/references/cli/get-started/overview)
  - Specific section: installation/runtime requirements.
  - Why: CLI is beta and requires Node 20.19+; keep it separate from the Node 20.17 application runtime.
- [Base44 CLI `exec`](https://docs.base44.com/developers/references/cli/commands/exec)
  - Specific section: pre-authenticated scripts, `--privileged`, and `--data-env`.
  - Why: this is the supported authenticated bridge and complete-read capability gate.
- [Base44 CLI login](https://docs.base44.com/developers/references/cli/commands/login)
  - Specific section: device-code authentication and local credential storage.
  - Why: authentication is manual/operator-owned; the tool never reads or copies the auth file.
- [Base44 entity API](https://docs.base44.com/developers/references/sdk/docs/type-aliases/entities#list)
  - Specific section: `list(sort, limit, skip, fields)`, default 50, maximum 5,000.
  - Why: implement bounded offset pagination without truncating any entity.
- [Base44 work with data](https://docs.base44.com/developers/references/sdk/getting-started/work-with-data#read-records)
  - Specific sections: read records and service-role data access.
  - Why: confirm read behavior and privileged/security implications.
- [Base44 private upload and signed URL](https://docs.base44.com/developers/references/sdk/docs/type-aliases/integrations#createfilesignedurl)
  - Specific section: `CreateFileSignedUrl({ file_uri, expires_in })`.
  - Why: download private bytes without persisting temporary URLs.
- [Base44 dashboard data export](https://docs.base44.com/Building-your-app/Managing-your-app-data#exporting-data)
  - Specific section: per-table CSV export.
  - Why: useful independent spot check, but not a substitute for recursive private-file inventory.
- [Python `hashlib`](https://docs.python.org/3/library/hashlib.html#hash-algorithms)
  - Specific section: SHA-256.
  - Why: deterministic exact-byte and canonical-object checksums.
- [Python `os.replace`](https://docs.python.org/3/library/os.html#os.replace)
  - Specific section: atomic same-filesystem replacement.
  - Why: publish checkpoints/manifests only after complete temporary writes.

### Patterns to Follow

**Naming conventions:** Python modules/functions/fields use `snake_case`; JSON artifacts use stable `camelCase`
keys and explicit `schemaVersion`; entity names keep Base44 casing. CLI subcommands are `doctor`, `export`, `verify`,
and `summarize`.

**Error handling:** Mirror the single domain-exception boundary in `tooling/import_auditflow_source.py:666-673`.
Expected failures report a static category plus non-sensitive counts/operation names. Never echo a subprocess command,
request JSON, raw Base44 stderr, entity record, URI, filename, signed URL, response body, or exception containing one.

**Canonical object hash:** Serialize the complete SDK-returned record as UTF-8 JSON with keys sorted, compact
separators, Unicode preserved, and non-finite numbers rejected. Hash those bytes with SHA-256. Do not parse and
rewrite stringified JSON inside the preserved record; parsing is a separate discovery view.

**Base44 bridge:** Use computed entity access only after validating against the exact six-name allowlist. The only
SDK calls permitted are conceptually:

```ts
await base44.entities[entity].list("id", limit, skip);
await base44.integrations.Core.CreateFileSignedUrl({ file_uri: sourceReference, expires_in: 900 });
```

No bridge method may accept an SDK method name from input. No `asServiceRole`, `functions.invoke`, `fetch` to an
undocumented Base44 API, `create`, `update`, `delete`, `bulkCreate`, `UploadPrivateFile`, connector, or sync call is
allowed. Privilege comes only from CLI `exec --privileged`.

**Pagination and stability:** Use ascending system `id` as the required total order, default to 1,000 (allowed range
1-5,000), advance `skip` by the returned page length, and terminate only on a short page. `doctor` must prove that
production accepts `list("id", limit, skip)`, that IDs are strictly increasing across page boundaries, and that
page-size-one versus normal-page passes return the identical ID set. If Base44 cannot provide that order, stop and
amend the plan with an independent complete-ID-set mechanism; `created_date` offset pagination and dashboard counts
are insufficient fallbacks. Require every record to have a non-empty `id`, reject duplicate IDs, sort final NDJSON
by ID, and compare per-ID canonical hashes across two complete consecutive reads. Base44 does not document a
point-in-time snapshot; any drift fails the run and requires a new quiet-window attempt.

**Recursive discovery:** Walk mappings/lists/scalars at every JSON Pointer. For a string that decodes to a JSON
object or array, walk the decoded view recursively while retaining the original string untouched. Recognize typed
`{ "__type": "file_uri", "value": ... }`, Base44 private forms (`private://`, `private/`, `mp/`), and absolute URL
candidates. Known JSON fields that fail parsing become typed unresolved findings. Embedded base64 `basePdf` stays
inside the record and object checksum; it is not treated as a remote download.

**File safety:** Private refs go only to `sign_file`. Signed URLs remain in process memory, expire in 15 minutes,
and are never written or printed. Approved public refs must be HTTPS and match an explicit host allowlist loaded
from an absolute JSON file outside the worktree. After inventory, export may enter `awaiting_public_host_review` and
write the discovered host candidates only to the private run; the operator reviews them locally and creates the
private allowlist. Persist only the allowlist's canonical SHA-256 plus entry count in state, never its path/hosts in
logs or committed evidence, and reject resume if it changes. Validate every redirect, reject
loopback/private/link-local destinations, cap redirects/time/bytes, stream to a sibling temp file while hashing,
then atomically move into content-addressed storage. Never forward Base44 authorization to the file host.

**Resume:** `--resume` first validates schema/tool/CLI version, entity set, app/data-environment fingerprints,
page-size/config fingerprints, output containment, and every completed artifact hash. It replays entity inventory
from offset zero and rejects drift before continuing. A checkpoint is updated only after its referenced page/file
is fsynced and atomically published. A fresh run never overwrites an existing run directory.

**Private versus committed evidence:** `manifest.json` may contain record IDs, raw source refs without transient
signing query strings, referrer JSON Pointers, hashes, and artifact paths, so it is private. Entity pages/NDJSON
contain exact tokens/PII and are private. The committed rehearsal summary contains only entity counts and aggregate
hashes, total object/file/reference/byte counts, duplicate counts, unresolved counts grouped by safe reason,
JSON-parse finding counts, versions, timestamps, and pass/fail gates. It contains no IDs, paths, URIs, hosts,
filenames, field values, query strings, or record-level hashes.

**Avoid:** dashboard-only CSV as the canonical snapshot; fixed URL-field lists; silently swallowed JSON/download
errors; tokens on argv; persisting signed URLs; logging raw exceptions; output inside Git; network writes; source
repo operations other than read-only `git status`/`rev-parse`; changing application dependencies to satisfy CLI.

---

## IMPLEMENTATION PLAN

### Phase 0: Drift and privileged-read capability gate

Verify issue #3/architecture/source baselines, Base44 CLI version/runtime, authenticated owner/editor identity,
production data environment, complete privileged visibility over all six entities, private-file signing capability,
and a safe output root before creating raw output. A missing capability blocks implementation evidence; do not deploy
a workaround.

### Phase 1: Deterministic snapshot core

Implement pure Python canonical records, page artifacts, entity inventories, recursive JSON/file discovery,
content-addressed file storage, manifest schemas, atomic checkpoints, resume validation, and offline verification.

### Phase 2: Base44 read-only bridge and CLI integration

**Depends on:** Phase 1 (the bridge must feed a tested protocol rather than shape storage ad hoc).

Add the exact-operation TypeScript bridge and Python subprocess adapter. Keep authentication and signed URLs
ephemeral, validate CLI output strictly, and reject all protocol/config drift.

### Phase 3: Security, failure, and resumability tests

**Independent of:** Live Phase 0 access once the synthetic adapter protocol is fixed.

Exercise pagination, all known and unknown nested reference shapes, malformed JSON, duplicate IDs/refs/content,
interruption at every publication boundary, tamper/drift detection, redirect/host/size failures, and redaction.

### Phase 4: Production rehearsal and reconciliation evidence

**Depends on:** Phases 0-3.

During an owner-supervised quiet read window, run the complete snapshot and offline verifier, render sanitized JSON
and Markdown summaries, independently spot-check aggregate table counts, recheck source integrity, and run the full
repository validation suite. A rehearsal passes only when all six inventories are stable, the `User` inventory has
exactly two records with `role === "admin"` while every regular user is preserved, every discovered downloadable file
closes with bytes/size/hash, unresolved count is zero, and all private
artifacts rehash.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. INSPECT dependency, source, runtime, and access prerequisites

- **IMPLEMENT**: Re-read issue #5, epic #1, canonical Wiki PRD/architecture, issue #3 completion, and current entity
  contracts. Confirm destination origin/HEAD/status and external source HEAD/status without writing there.
- **IMPLEMENT**: In a separate Node >=20.19 shell, assert the actual `node --version`, then verify
  `npx --yes base44@0.1.10`, pinned Deno `2.9.5`, operator-managed login, owner/editor privilege,
  `BASE44_APP_ID`, and `prod` access.
  Capture only booleans/versions/record counts.
- **GOTCHA**: Do not inspect/copy `~/.base44/auth/auth.json`, run `base44 link`, print the app ID, or reuse the app's
  Node 20.17 shell for the CLI. Keep the pinned Deno runtime outside product dependencies and expose it only through
  the operator shell's `PATH`. Set `DENO_NO_PACKAGE_JSON=1` and an isolated disposable `DENO_DIR` on every bridge
  subprocess so Deno cannot discover unrelated ancestor package manifests from its temporary wrapper path.
- **VALIDATE**: `git remote get-url origin; git status --short --branch; git -C C:\Users\ntzur\workspace-antigravity\auditflow rev-parse HEAD; git -C C:\Users\ntzur\workspace-antigravity\auditflow status --short; $base44NodeVersion = [version]((node --version).TrimStart('v')); if ($base44NodeVersion -lt [version]'20.19.0') { throw 'Base44 CLI requires Node >=20.19.0' }; npx --yes base44@0.1.10 --version`
- **SATISFIES**: AC #1, #7, #8.

### 2. UPDATE `.gitignore` and CREATE `docs/migration/base44-export-runbook.md`

- **IMPLEMENT**: Ignore a dedicated emergency workspace fallback such as `/migration-output/` including state,
  manifests, logs, records, and files. The live CLI still rejects any output inside the Git worktree.
- **IMPLEMENT**: Document separate Node/Python prerequisites, device login, env-only app ID, encrypted/non-synced
  output storage, quiet-window procedure, commands, schemas, resume behavior, failure taxonomy, access/retention,
  cleanup ownership, and issue #11 handoff.
- **PATTERN**: `.gitignore:1-45`; `docs/migration/auditflow-source-baseline.md:109-126`.
- **GOTCHA**: Do not include a real app ID, account/email, host, filesystem run path, record count, URI, or token in
  the runbook.
- **VALIDATE**: `git check-ignore migration-output/state.json migration-output/files/example; git diff --check`
- **SATISFIES**: AC #5, #7.

### 3. CREATE `tooling/export_base44_snapshot.py` schemas and safe I/O primitives

- **IMPLEMENT**: Add domain errors, exact six-entity constants, versioned state/private-manifest/sanitized-summary
  schemas, canonical JSON bytes, SHA-256 streaming, safe relative paths, outside-worktree enforcement, temp/fsync/
  replace publication, and restrictive file-mode best effort.
- **PATTERN**: `tooling/import_auditflow_source.py:67-83,149-164,467-535,666-673`.
- **GOTCHA**: Never derive a path directly from entity ID, URI, filename, or JSON Pointer. Use fixed entity names,
  numeric offsets, and validated hex digests.
- **VALIDATE**: `python -m unittest tooling.tests.test_export_base44_snapshot.SnapshotPrimitiveTests -v`
- **SATISFIES**: AC #2, #3, #4, #5.

### 4. ADD deterministic pagination, record preservation, and stability verification

- **IMPLEMENT**: Persist complete raw pages, validate record IDs, canonical-hash each record, build stable sorted
  NDJSON, calculate entity aggregate hashes, and compare two full reads. Preserve every returned key/value and exact
  string value.
- **IMPLEMENT**: Page checkpoints record only offset/count/hash after atomic page publication. Reject page-size,
  entity-set, app/data-env fingerprint, or source-data drift on resume.
- **GOTCHA**: Pagination must use ascending `id` and prove strict cross-page ordering plus identical ID sets at page
  size one and the configured size. `created_date` is non-unique and forbidden for export pagination. Base44 has no
  documented point-in-time snapshot; duplicate IDs, page overlap, or any first/second pass hash difference fails
  instead of deduplicating away evidence.
- **VALIDATE**: `python -m unittest tooling.tests.test_export_base44_snapshot.PaginationTests tooling.tests.test_export_base44_snapshot.ResumeTests -v`
- **SATISFIES**: AC #1, #2, #4.

### 5. ADD recursive stringified-JSON and file-reference discovery

- **IMPLEMENT**: Walk all record fields and recursively decoded object/array strings; emit typed occurrences with
  entity, record ID, escaped JSON Pointer, container type, private/public/typed classification, and stable reference
  fingerprint in the private manifest.
- **IMPLEMENT**: Cover five legacy submission arrays, dynamic/stale response files, top-level `pdf_file_url`, signed
  PDFs, typed and legacy PDF template `basePdf`, `SyncedDriveFile.original_file_url`, unknown nested arrays/objects,
  duplicate references, embedded base64, and malformed known JSON fields.
- **PATTERN**: `src/lib/submission-compat.js:6-33,137-174`; `base44/functions/getTemplateFileUrl/entry.ts:30-51`.
- **GOTCHA**: Preserve raw strings; discovery parsing must not mutate/re-serialize the exported record. Do not mistake
  Drive IDs, normal text, or embedded base64 for remote files.
- **VALIDATE**: `python -m unittest tooling.tests.test_export_base44_snapshot.DiscoveryTests -v`
- **SATISFIES**: AC #1, #2, #6.

### 6. ADD safe private/public download and content-addressed storage

- **IMPLEMENT**: Resolve private refs through the bridge, hold signed URLs only in memory, stream bytes with bounded
  time/size, validate HTTPS/redirect/IP/host policy, compute byte count/SHA-256, and atomically publish by hash.
- **IMPLEMENT**: Deduplicate the same source ref and identical content while retaining every occurrence. Record every
  unsupported/unapproved/sign/download/content failure as a typed unresolved finding; never silently skip.
- **GOTCHA**: Supply approved public hosts only through `--public-host-allowlist <absolute-private-json>` outside the
  worktree. Canonical-hash it into run state and reject resume drift. Never put hosts on argv, fetch arbitrary record
  URLs, persist response URLs, forward auth headers, or log remote bodies.
- **VALIDATE**: `python -m unittest tooling.tests.test_export_base44_snapshot.DownloadTests -v`
- **SATISFIES**: AC #2, #3, #5, #6.

### 7. CREATE `tooling/base44_export_bridge.ts` and the captured subprocess adapter

- **IMPLEMENT**: Keep one exact marker in the fixed bridge source, such as
  `const REQUEST = /*__AUDITFLOW_REQUEST__*/;`. The Python adapter reads and hashes that source, verifies the marker
  appears exactly once, replaces only the marker with a canonical JSON literal (never executable text), and pipes
  that one complete program to pinned
  `npx --yes base44@0.1.10 --json exec --privileged --data-env prod`. The bridge validates/dispatches only
  `list_page` or `sign_file`, validates limits/offset/entity/reference types before SDK access, and returns one
  sentinel-framed JSON response. All output is captured.
- **IMPLEMENT**: Strip/replace CLI status and exception details before user-visible reporting. Ensure the command has
  no token/app-ID argument and that no signed response reaches a checkpoint or log.
- **PATTERN**: current read call in `src/pages/CpaDashboard.jsx:43-46`; current signing call in
  `base44/functions/downloadAllFiles/entry.ts:23-28`.
- **GOTCHA**: `--privileged` is allowed only with the static read/sign bridge. Do not expose method names or arbitrary
  code in request data, and do not add the CLI to `package.json`.
- **VALIDATE**: `python -m unittest tooling.tests.test_export_base44_snapshot.BridgeProtocolTests tooling.tests.test_export_base44_snapshot.ReadOnlySurfaceTests -v`
- **SATISFIES**: AC #1, #5, #7, #8.

### 8. ADD `doctor`, `export`, `verify`, and `summarize` CLI commands

- **IMPLEMENT**: `doctor` performs non-writing version/auth/privilege/six-entity probe and safe-output checks;
  `export` requires `--confirm-production-read-only`, explicit outside-repo output, and optional `--resume`; `verify`
  is network-free and rehashes every artifact; `summarize` renders sanitized JSON/Markdown from verified state.
- **IMPLEMENT**: Reject secrets on argv (`--token`, signed URL, credentials), unsafe/missing output roots, incomplete
  manifests, unknown schema versions, conflicting run directories, or report output outside the two approved docs
  paths.
- **GOTCHA**: `doctor` prints no sample row and creates no raw run. `summarize` writes pass/fail evidence even on a
  closed unresolved inventory, then returns nonzero when gates fail.
- **VALIDATE**: `python tooling/export_base44_snapshot.py --help; python -m unittest tooling.tests.test_export_base44_snapshot.CliTests -v`
- **SATISFIES**: AC #4, #5, #6, #7, #8.

### 9. CREATE comprehensive synthetic fixtures and end-to-end interruption tests

- **IMPLEMENT**: Use only invented `.test` users, opaque fake IDs, fake private URIs, local HTTP fixtures, and a fake
  bridge. Cover 0/1/1,000/1,001 records, short/empty pages, duplicate/missing IDs, same timestamps, all file shapes,
  malformed JSON, redirects, host/IP rejection, truncated/oversized bytes, transient sign failure, tamper, and drift.
- **IMPLEMENT**: Interrupt after temp write, page publication, checkpoint, signed URL acquisition, partial file, file
  publication, and manifest publication; each resume either continues exactly once or fails closed.
- **IMPLEMENT**: Test the exact one-stdin bridge layout (fixed source hash + one marker + canonical JSON literal),
  absolute outside-worktree allowlist parsing, canonical allowlist hashing, malformed/duplicate hosts, resume drift,
  and host/path redaction.
- **IMPLEMENT**: Capture stdout/stderr and scan sanitized outputs for sentinel token/email/name/phone/raw URI,
  `Authorization`, `X-Amz-`, query values, object IDs, paths, and record-level hashes.
- **VALIDATE**: `python -m unittest discover -s tooling/tests -p "test_export_base44_snapshot.py" -v`
- **SATISFIES**: AC #1-#8.

### 10. RUN the non-writing production capability probe

- **IMPLEMENT**: After the operator completes Base44 device login and sets `BASE44_APP_ID` in the separate CLI shell,
  run `doctor` against `prod` with privilege. Confirm all six entities are readable, ascending `id` is accepted and
  strictly increasing, page-size-one and normal-page ID sets match, exactly two `User` records have the dashboard's
  CPA `admin` role while every user record remains in scope, and at
  least one discovered private reference can be signed when production contains one.
- **IMPLEMENT**: If privilege, entity visibility, production environment, or signing is unavailable, stop and amend
  the plan. The only allowed fallback is an owner-approved supported/manual Base44 export path; never deploy a helper.
- **GOTCHA**: Store only sanitized readiness booleans/counts. Do not paste login codes, app ID, identity, or sample
  data into chat/report/Git.
- **VALIDATE**: `python tooling/export_base44_snapshot.py doctor --data-env prod --confirm-production-read-only`
- **SATISFIES**: AC #1, #7, #8.

### 11. RUN and resume-test the production rehearsal snapshot

- **IMPLEMENT**: Choose an encrypted, non-cloud-synced absolute output root outside the worktree with sufficient
  space. During an owner-supervised quiet read window, start the export, intentionally interrupt once after durable
  progress, rerun with `--resume`, and let both inventory passes plus file downloads complete.
- **IMPLEMENT**: If export pauses at `awaiting_public_host_review`, inspect the private candidate file locally, create
  an absolute private allowlist JSON outside the worktree, and resume with `--public-host-allowlist`; its canonical
  hash becomes immutable run configuration. Any source drift, allowlist drift, unresolved reference, malformed
  required JSON, file failure, or non-two CPA/admin User count produces a failed rehearsal.
- **GOTCHA**: Do not transmit, attach, inspect in chat, or commit the output. Keep the private run for issue #11 under
  owner-controlled retention.
- **VALIDATE**: `python tooling/export_base44_snapshot.py export --data-env prod --output-root <absolute-outside-repo-path> --resume --public-host-allowlist <absolute-private-json> --confirm-production-read-only; python tooling/export_base44_snapshot.py verify --snapshot <absolute-run-path>`
- **SATISFIES**: AC #1-#8.

### 12. GENERATE sanitized rehearsal evidence and complete repository validation

- **IMPLEMENT**: Render `docs/migration/base44-rehearsal-summary.{json,md}` only from an offline-verified private
  manifest. Include versions/timestamps, six per-entity counts and aggregate hashes, total object/reference/file/
  byte/duplicate counts, unresolved counts by safe reason, parse findings, two-CPA/admin-User gate, and overall pass/fail.
- **IMPLEMENT**: Independently compare Base44 dashboard per-entity aggregate counts where supported. Recheck external
  source HEAD/status, scan Git changes for raw artifacts/sensitive values, and prove actual output is outside Git.
- **GOTCHA**: A dashboard count is corroboration only. Do not commit exported CSV. Do not weaken a failed automated
  gate to match a manual observation.
- **VALIDATE**: `python tooling/export_base44_snapshot.py summarize --snapshot <absolute-run-path> --json docs/migration/base44-rehearsal-summary.json --markdown docs/migration/base44-rehearsal-summary.md; python -m json.tool docs/migration/base44-rehearsal-summary.json; python -m unittest discover -s tooling/tests -p "test_*.py" -v; npm test; npm run test:foundation; npm run typecheck:foundation; npm run lint:foundation; npm run typecheck; npm run lint; npm run build; node tooling/verify_sst_foundation.mjs --mode contract --stage test; python tooling/validate_codex_layer.py; git diff --check`
- **SATISFIES**: all acceptance criteria.

---

## TESTING STRATEGY

### Unit Tests

Use Python `unittest`, `TemporaryDirectory`, injected clocks/run IDs, in-memory/fake Base44 bridge responses, and a
local HTTP server. Keep fixtures entirely synthetic. Test canonical Unicode/numeric/JSON behavior; page boundaries;
record and aggregate hashes; JSON Pointer escaping; nested and repeatedly stringified JSON; every known source file
shape; malformed known JSON; private/public classification; content hash/bytes; atomic publication; redaction; and
schema/config compatibility.

The bridge protocol test executes the TypeScript source through a fake pre-authenticated `base44` object or checks a
small extracted dispatcher with injected entities/integrations. A Proxy should fail any property access outside the
six `.list` methods and `CreateFileSignedUrl`. Also statically reject mutation method names/imports and any direct
HTTP endpoint in the bridge.

### Integration Tests

- Fake CLI subprocess emits status on stderr plus sentinelled JSON on stdout; verify strict parsing/redaction.
- Local HTTP server exercises streaming bytes, content length mismatch, redirects, timeouts, non-HTTPS policy,
  disallowed/reserved IPs, and duplicate content.
- End-to-end synthetic export produces page artifacts, stable NDJSON, private manifest, files, and a sanitized
  summary; offline verify detects a single changed byte anywhere.
- Live `doctor` proves privileged read/sign capability without creating output.
- Live rehearsal proves complete/resumable production behavior while Base44 remains authoritative.

### Edge Cases

- Empty entity; exactly page-size records; more than one page; same `created_date`; unsupported/ignored `id` sort;
  non-increasing IDs; different ID sets at page size one versus normal; reordered pages; duplicate or missing IDs;
  record create/update/delete between passes; malformed/non-finite values.
- Stringified JSON nested more than once; arrays/objects already parsed despite string schema; malformed known JSON;
  stale response step; file occurrence when `answer` is false; duplicate URI at multiple pointers.
- Legacy submission arrays and top-level PDF URL; signed PDF with missing/incomplete file; current typed PDF
  `basePdf`; legacy `private://`; embedded base64; historical `SyncedDriveFile` URL; public HTTPS candidate;
  unsupported HTTP/data/unknown scheme.
- Signed URL signing failure/expiry; query-string leakage; redirect to private IP; redirect loop; wrong content
  length; zero-byte valid file; oversized file; mid-stream interruption; two references with same bytes.
- Existing run with different entity set/page size/CLI/tool/schema/app/data-env/allowlist fingerprint; malformed or
  in-worktree allowlist; tampered page/file/state; checkpoint ahead of artifact; artifact ahead of checkpoint;
  insufficient disk; output inside repo/symlink escape.
- Base44 user is authenticated but not owner/editor; `--privileged` rejected; only current User visible; production
  environment absent; CLI upgraded; Node shell too old; live data changes during the two-pass read.
- Summary/log accidentally includes a token, email, name, phone, note, field value, object ID, URI, filename, host,
  filesystem path, signed query, response body, or record-level hash.

---

## VALIDATION COMMANDS

Use the repository's Node 20.17.0 for application validation. Use a separate Node >=20.19.0 shell only for pinned
Base44 CLI 0.1.10. Commands requiring Base44 access run after manual device login and with `BASE44_APP_ID` set in the
operator environment; neither value is printed or passed on argv.

### Level 0: Drift and non-writing live readiness

```powershell
git remote get-url origin
git status --short --branch
git -C C:\Users\ntzur\workspace-antigravity\auditflow rev-parse HEAD
git -C C:\Users\ntzur\workspace-antigravity\auditflow status --short
$base44NodeVersion = [version]((node --version).TrimStart('v'))
if ($base44NodeVersion -lt [version]'20.19.0') { throw 'Base44 CLI requires Node >=20.19.0' }
$auditflowDenoVersion = (deno --version | Select-Object -First 1)
if ($auditflowDenoVersion -ne 'deno 2.9.5') { throw 'Base44 CLI rehearsal requires Deno 2.9.5' }
npx --yes base44@0.1.10 --version
python tooling/export_base44_snapshot.py doctor --data-env prod --confirm-production-read-only
```

Expected: correct origin, safe feature branch, clean pinned external source, CLI 0.1.10, six privileged entity reads,
two visible CPA/admin User records without excluding other users, and signing capability when a private reference
exists. No raw output is created.

### Level 1: Syntax, focused tests, and artifact format

```powershell
python -m unittest discover -s tooling/tests -p "test_export_base44_snapshot.py" -v
python tooling/export_base44_snapshot.py --help
python -m json.tool docs/migration/base44-rehearsal-summary.json
git check-ignore migration-output/state.json migration-output/files/example
git diff --check
```

### Level 2: Tooling and application regression tests

```powershell
python -m unittest discover -s tooling/tests -p "test_*.py" -v
python tooling/validate_codex_layer.py
npm test
npm run test:foundation
```

Expected: new exporter tests, importer tests, AI-layer validation, frontend characterization tests, and SST/backend
tests pass.

### Level 3: Types, lint, build, and foundation contract

```powershell
npm run typecheck:foundation
npm run lint:foundation
node tooling/verify_sst_foundation.mjs --mode contract --stage test
npm run typecheck
npm run lint
npm run build
```

Expected: focused foundation checks and build pass; full typecheck/lint have zero new diagnostics relative to
`docs/migration/auditflow-source-baseline.md`.

### Level 4: Production rehearsal and offline reconciliation

```powershell
python tooling/export_base44_snapshot.py export `
  --data-env prod `
  --output-root <absolute-outside-repo-path> `
  --resume `
  --public-host-allowlist <absolute-private-json> `
  --confirm-production-read-only
python tooling/export_base44_snapshot.py verify --snapshot <absolute-run-path>
python tooling/export_base44_snapshot.py summarize `
  --snapshot <absolute-run-path> `
  --json docs/migration/base44-rehearsal-summary.json `
  --markdown docs/migration/base44-rehearsal-summary.md
```

Expected: stable two-pass inventories, exact two CPA/admin User records with all users preserved, all references
resolved/downloaded, private artifact
hashes valid, sanitized summary pass, and no raw values in stdout/stderr/Git.

### Level 5: Manual review

- Confirm the private output is on owner-approved encrypted, non-synced storage outside the worktree and has enough
  free space.
- Compare aggregate entity counts with Base44 dashboard CSV/count views without retaining the CSV in Git.
- Review only safe unresolved-reason counts; if nonzero, inspect the private manifest locally and fail the rehearsal.
- Confirm `git status --short` lists only intended tool/tests/docs/ignore/plan files and never the raw output root.
- Reconfirm external source HEAD/status and that no Base44 deploy/write command was run.
- Retain the verified private snapshot for issue #11; deletion is an explicit later owner operation, not automatic.

---

## ACCEPTANCE CRITERIA

- [x] **AC #1 - Complete records:** all six entities paginate to a stable two-pass close; every SDK-returned object
  retains its ID, timestamps, token/access fields, undocumented system fields, field names, raw values, and exact
  stringified JSON values in private artifacts.
- [x] **AC #2 - Complete discovery:** recursive fixtures and production discovery cover legacy arrays, dynamic/stale
  responses, signed PDFs, templates, typed/legacy private refs, public candidates, unknown nested values, malformed
  known JSON, and every referrer JSON Pointer without a hand-maintained URL list.
- [x] **AC #3 - Checksummed manifest:** every record has a canonical SHA-256; every downloaded file has exact bytes,
  byte length, and SHA-256; entity/page/manifest aggregates are deterministic; duplicate refs/content remain
  reconcilable.
- [x] **AC #4 - Safe resume:** interruption at any tested boundary resumes without duplicate/corrupt output, verifies
  all prior artifacts/config, and fails closed on source drift, tamper, or incompatible state.
- [x] **AC #5 - Privacy/security:** raw output stays outside Git on owner-approved storage; no production auth
  material, PII, URI, signed URL, filename, raw ID, tax data, or record value appears in logs, committed fixtures,
  commands, summaries, reports, or source control.
- [x] **AC #6 - File closure:** every discovered accessible private/approved-public reference resolves to one verified
  content object; failures are typed findings rather than silent skips; successful rehearsal unresolved count is zero.
- [x] **AC #7 - Rehearsal evidence:** the two CPA/admin `User` records are accounted for while every regular user is
  preserved; sanitized JSON/Markdown reports
  contain six entity counts/aggregate hashes, object/reference/file/byte totals, duplicates, parse findings,
  unresolved reasons, and pass/fail; independent dashboard aggregate spot-check agrees.
- [x] **AC #8 - Read-only proof:** bridge surface contains only privileged entity list and signed-file operations;
  no source repository, Base44 record/file/app, AWS resource, Google Drive object, or product runtime is changed.
- [x] All focused/full validation commands pass or match the documented inherited typecheck/lint baseline with zero
  new diagnostics.

---

## COMPLETION CHECKLIST

- [x] Issue #3, epic architecture, origin, branch, external source, and CLI version/runtime are revalidated.
- [x] Base44 owner/editor login and privileged `prod` reads pass without exposing identity/auth material.
- [x] Raw output is outside Git on encrypted/non-synced storage; emergency in-repo output is ignored and unused.
- [x] Pure snapshot/discovery/download/resume/redaction tests pass before a live read.
- [x] Bridge read-only surface and captured subprocess protocol tests pass.
- [x] Live `doctor` reads six entities, sees two CPA/admin User records while preserving all users, and proves
  signing without writing output.
- [x] Rehearsal is interrupted once and resumes successfully.
- [x] Two consecutive record inventories match; every object/file/page/manifest hash verifies offline.
- [x] Every file ref occurrence is accounted for and unresolved count is zero.
- [x] Sanitized JSON/Markdown summary passes the sensitive-value scan and aggregate dashboard spot-check.
- [x] Python, frontend, foundation, type, lint, build, contract, Codex-layer, and diff checks complete.
- [x] External source and Base44 app/data remain unchanged; no deploy/write call occurred.
- [x] Private snapshot retention and issue #11 handoff are recorded without committing its location or contents.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Assumption:** The owner's Base44 identity has owner/editor permission, so CLI 0.1.10
  `exec --privileged --data-env prod` can bypass row-level restrictions for all six entities. This is verified by
  `doctor`; if false, implementation stops rather than deploying a service-role helper.
- **Assumption:** The production data environment is named `prod`, as exposed by current CLI help/documentation.
  Discovering a different real environment is a plan amendment, not a guess.
- **Assumption:** `CreateFileSignedUrl` accepts every retained private URI form. Official docs define the operation,
  but support for legacy `private://`, `private/`, and `mp/` references must be proven by live capability checks.
- **Assumption:** Two complete equal reads during a quiet window are sufficient rehearsal evidence. Base44 documents
  offset pagination but not an atomic point-in-time snapshot; a final cutover snapshot/delta still belongs to #15.
- **Assumption:** The complete `User` inventory includes exactly two records with `role === "admin"`, matching the
  dashboard's CPA-team filter and the architecture's two CPA profiles. Regular users remain in the complete export;
  an extra/missing admin record is a reconciliation finding, not silently filtered.
- **Assumption:** Production volume fits local encrypted storage and the configured safe download cap. `doctor`
  estimates record/reference counts, while actual byte total is a rehearsal fact. Never truncate to meet a cap.
- **Assumption:** Public file candidates can be closed with an owner-reviewed, absolute private JSON host allowlist
  outside the worktree. Its canonical hash is immutable run state. Non-file external URLs remain classified
  evidence, not fetched; unresolved classification must be zero for a passing rehearsal.
- **No unresolved product design question remains.** Remaining uncertainty is operational Base44 visibility and
  legacy-file support, both covered by fail-closed probes.

## NOTES (open canvas)

### Private artifact data flow

```text
Base44 CLI privileged list
        |
        v
captured page JSON -> canonical per-record/page hashes -> stable second pass
        |                                      |
        v                                      v
raw page + sorted NDJSON                drift => fail/new run
        |
        v
recursive raw + decoded-JSON walk -> reference occurrences -> dedupe
        |                                             |
        | private                                     | approved public HTTPS
        v                                             v
Base44 signed URL (memory only)                guarded direct fetch
        \_____________________________________________/
                              |
                              v
                 streamed bytes + SHA-256
                              |
                              v
                   content-addressed file
                              |
                              v
           private manifest -> offline verifier -> sanitized reports
```

### Reconciliation invariants

| Layer | Stable identity | Integrity evidence | Commit policy |
| --- | --- | --- | --- |
| Record | Base44 entity + raw ID | canonical record SHA-256 | private only |
| Entity | sorted `(ID, record hash)` pairs | count + aggregate SHA-256 | aggregate only |
| Reference | SHA-256 of source ref | all entity/ID/JSON Pointer occurrences | private only |
| File content | byte SHA-256 | byte count + content-addressed path | aggregate only |
| Run | schema/config/source fingerprints | manifest + full offline rehash | safe pass/fail only |

### Why the Python/CLI bridge split is selected

Base44 officially supports authenticated standalone scripts through its CLI, not a documented Python data API.
Putting only read/sign SDK calls in the bridge inherits supported authentication and privileged visibility. Keeping
state, bytes, hashing, URL safety, resume, and reports in stdlib Python follows existing repository tooling and makes
nearly all sensitive behavior deterministic and testable without production or Base44 credentials.

Dashboard CSV is retained only as an independent aggregate check because it is manual, per entity, does not close
private files, and may not preserve every system/nested representation as the SDK does. A deployed Base44 backend
export function was rejected because the architecture requires proving export without changing the source app and
because its service-role scope would add a new production attack surface.

### Primary risks

1. **Privileged visibility or CLI drift:** pin 0.1.10, assert the inherited CLI Node is >=20.19, and fail `doctor`
   before raw output.
2. **Non-atomic live pagination:** require/probe total ascending `id` ordering, compare page-size-one and normal ID
   sets, use a quiet window plus two full hash-equivalent passes, and retain a separate final cutover snapshot/delta.
3. **Unknown legacy file shapes/hosts:** recursively discover first, keep all occurrences, explicitly review public
   host categories, probe signing variants, and require zero unresolved findings.
4. **Sensitive-output leakage:** output outside Git, transient signed URLs, bounded redacted errors, sentinel scans,
   aggregate-only reports, and no argv credentials.
5. **Partial/corrupt runs:** temp/fsync/replace, content addressing, checkpoint-after-artifact ordering, complete
   rehash on resume, and network-free final verification.

Confidence for one-pass implementation: **8/10**. The design and repository patterns are well evidenced; the two
remaining uncertainties are live owner/editor privileged visibility and legacy private-reference signing behavior.

## AMENDMENTS

- **2026-08-23 — Deno runtime prerequisite:** The first live `doctor` attempt stopped before reading entity data.
  Inspection of the pinned Base44 CLI `0.1.10` package showed that `exec` spawns an external `deno` executable,
  although the original plan listed only the CLI's documented Node engine. Pin Deno `2.9.5` in a disposable
  operator-only runtime directory, validate it explicitly, and keep it out of product dependencies. The same live
  probe then exposed Deno ancestor `package.json` discovery from Base44's temporary wrapper path; force
  `DENO_NO_PACKAGE_JSON=1` with an isolated disposable `DENO_DIR` on bridge subprocesses instead of modifying the
  unrelated user-level manifest. This does not change the read-only bridge, snapshot format, acceptance criteria,
  or source/target boundaries.
- **2026-08-23 — Page-size-one probe batching:** The first successful live doctor transport revealed that launching
  a complete Base44 CLI/Deno process for every `list("id", 1, skip)` page made the required complete-ID-set proof
  scale with per-record process startup. Keep the existing `list_page` operation and exact SDK calls, but allow its
  doctor-only `exhaust` mode to execute the page-size-one offset loop inside one captured bridge process per entity.
  The bridge itself rejects missing/non-increasing IDs and oversized pages, and Python revalidates/hashes the returned
  complete ordered sequence. This changes performance only, not query semantics or the two-operation read/sign
  surface.
- **2026-08-23 — CPA user reconciliation semantics:** The optimized live doctor proved complete privileged access
  to eight `User` records: two schema-valid `admin` records and six schema-valid regular `user` records. Executable
  dashboard behavior in `src/components/dashboard/TeamSection.jsx` defines CPA team members as
  `users.filter((u) => u.role === "admin")`. Replace the incorrect total-User-count gate with an exact-two-admin gate
  while preserving and hashing all User records. No identity or record-level value is committed or reported.
- **2026-08-23 — Static bridge request transport and Windows Deno resolution:** Live cache inspection showed that
  injecting a private reference as a TypeScript source literal allowed Deno's disposable transpilation cache to
  retain that request. Keep the bridge program static and pass canonical requests only through the child-process
  environment; remove the affected exporter-owned cache after validating its exact temp-directory containment.
  On Windows, put the package's directory containing `deno.exe` on `PATH` rather than its npm shim directory,
  because Base44 CLI launches the executable directly. This preserves the two-operation protocol and prevents
  private request material from entering generated source artifacts.
- **2026-08-23 — Iterative redirect review and reference checkpoints:** The first approved public host redirected to
  a second host. Treat any unapproved redirect as a durable `awaiting_public_host_review` pause, publish an expanded
  private candidate artifact, and accept resume only when its canonical hash/count matches run state. Persist each
  successful reference-to-content resolution so review pauses and interruptions do not redownload verified files.
  The owner approved both private candidates; neither hostname is committed or logged.
- **2026-08-23 — Batched signing and bounded transport retry:** Production volume made one Base44 CLI/Deno startup
  per private reference operationally excessive and exposed transient process/download failures. Allow up to 50
  references inside the existing `sign_file` operation, returning only ordered per-item outcomes and keeping signed
  URLs in memory. Retry only the static `download_failed` transport category up to three attempts, while classifying
  HTTP 404/410 as `source_file_missing` without retry. The passing rehearsal retained identical record/reference
  semantics and closed 687 unique references with zero unresolved findings.

---

**Artifact type:** Implementation plan

**Related:** [ticket #5](https://github.com/noamtz/cpa-platform/issues/5),
[epic #1](https://github.com/noamtz/cpa-platform/issues/1),
[dependency #3](https://github.com/noamtz/cpa-platform/issues/3),
[PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration),
[architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Last updated:** 2026-08-23
