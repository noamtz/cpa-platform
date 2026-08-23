# Base44 production snapshot runbook

This runbook operates the read-only migration snapshot used by issue #11. The snapshot contains production tax
records, access tokens, personal data, file references, and downloaded files. It is private operating material,
not a repository artifact.

## Prerequisites and access boundary

- Use Python 3.11 or newer for the exporter.
- Run the pinned Base44 CLI in a separate shell with Node 20.19 or newer. The AuditFlow application continues to
  use its repository-pinned Node runtime.
- Base44 CLI `exec` delegates scripts to Deno. Install the pinned runtime in a disposable operator-only directory,
  prepend its package bin directory to `PATH` for this shell, and verify the exact version before any live read:

  ```powershell
  $auditflowCliRuntime = Join-Path $env:TEMP "auditflow-base44-cli-deno-2.9.5"
  npm install --prefix $auditflowCliRuntime --no-save --no-package-lock deno@2.9.5
  $env:PATH = "$(Join-Path $auditflowCliRuntime 'node_modules\deno');$env:PATH"
  deno --version
  ```

  This is separate from the product dependencies and does not modify `package.json`.
- The exporter sets `DENO_NO_PACKAGE_JSON=1` and an isolated disposable `DENO_DIR` for every bridge subprocess.
  This prevents Deno from discovering unrelated ancestor `package.json` files under the operator profile and keeps
  CLI npm resolution separate from the product and user-level Node environments.
- Authenticate interactively with `npx --yes base44@0.1.10 login`. The operator owns the device-code flow and the
  CLI credential store; do not copy, inspect, log, or back up that store as part of this procedure.
- Set `BASE44_APP_ID` only in the operator shell. Never pass an app ID, token, login code, or signed URL on the
  command line or save it in this repository.
- The operator must be an app owner/editor because `exec --privileged --data-env prod` is required for complete
  reads. The tool never links, deploys, uploads, creates, updates, deletes, or synchronizes Base44 resources.
- Select an owner-approved encrypted, non-cloud-synced absolute output root outside this Git worktree. Confirm
  sufficient free space and restrict access to the migration operators. The tool rejects in-worktree output.
- Use only one export or resume process per output root. The exporter holds an operating-system lock from run
  selection through final status publication and fails closed with `export_lock_held` when another process owns it.
  The small `.auditflow-export.lock` file may remain after a process exits; the lock itself is released automatically.

## Safe sequence

Use a quiet production-read window. First run the non-writing capability gate:

```powershell
python tooling/export_base44_snapshot.py doctor --data-env prod --confirm-production-read-only
```

`doctor` reads all six entity inventories, checks total ID ordering at normal and page-size-one boundaries, requires
exactly two visible `User` records with the dashboard's CPA `admin` role while preserving every user record, and
probes one private-file signing operation when a private reference exists. It prints
only versions, counts, and booleans and creates no snapshot.

Start a new snapshot under the approved output root:

```powershell
python tooling/export_base44_snapshot.py export `
  --data-env prod `
  --output-root <absolute-private-output-root> `
  --confirm-production-read-only
```

For the rehearsal, interrupt once only after the tool reports durable progress. Resume against the same output root:

```powershell
python tooling/export_base44_snapshot.py export `
  --data-env prod `
  --output-root <absolute-private-output-root> `
  --resume `
  --confirm-production-read-only
```

If the run stops in `awaiting_public_host_review`, review the private candidate-host artifact locally. Create a
private JSON allowlist outside the worktree using either `{"hosts":["files.example.invalid"]}` or a JSON array of
hostnames, then resume with `--public-host-allowlist <absolute-private-json>`. Every redirect is revalidated; a new
redirect host produces another private expanded candidate and another review pause. The tool accepts an expansion
only when its canonical hash and entry count match the pending candidate recorded in run state. Any other allowlist
change requires a fresh run.

## Output and integrity model

Each run is created beneath the output root. `state.json` is the atomic checkpoint; `manifest.json` is the private
machine-readable reconciliation boundary. Raw first-pass pages live under `entities/<Entity>/pages/`, stable sorted
NDJSON inventories under `entities/`, and downloaded bytes under `files/sha256/<prefix>/<sha256>`. Paths are derived
only from fixed entity names, numeric offsets, and validated hashes.

Records are preserved exactly as returned by the SDK and hashed as canonical UTF-8 JSON without rewriting embedded
JSON strings. Two consecutive complete inventories must match by ID and record hash. File occurrences retain every
entity/record/JSON-Pointer referrer; source references and signed URLs never appear in committed evidence. Downloads
are streamed, bounded, revalidated across redirects, hashed, and atomically published into content-addressed
storage. Signed URLs exist only in process memory. The static bridge receives canonical requests through its child
environment so Deno's generated-source cache cannot retain private request literals. Private signing is performed
in bounded batches inside the same fixed `sign_file` operation, with ordered per-item outcomes. If a batched URL
has expired by the time its download starts, the exporter requests a fresh single-file signature before retrying.
Every hostname is resolved and checked once per request or redirect; the HTTPS socket is pinned to a validated
global address while TLS certificate verification and SNI continue to use the original hostname.

Resume verifies the schema, tool/CLI/bridge versions, entity set, app/environment fingerprints, page size,
allowlist fingerprint, and all checkpointed artifacts before replaying inventory from offset zero. Successful
reference-to-content resolutions are checkpointed individually and reused after an interruption or host-review
pause. It fails closed
on tamper, source drift, configuration drift, duplicate/missing IDs, unstable ordering, or file failure. Never edit a
private run to force resume; begin a new run after investigating the safe failure category.

Run offline verification without Base44 credentials or network access:

```powershell
python tooling/export_base44_snapshot.py verify --snapshot <absolute-private-run-path>
```

## View a verified snapshot locally

Open `tooling/base44_snapshot_viewer.html` in Chrome or Edge, choose **Choose snapshot folder**, and select the exact
completed run folder that contains `manifest.json` and `entities/`. The page shows aggregate totals, the six entity
lists, searchable record IDs, and each selected record's preserved JSON. It makes no network requests and keeps no
browser storage; **Clear data** or closing the tab removes the loaded references from the page.

Use the viewer only after the offline `verify` command passes. It does not verify hashes and does not open binary
attachments. Treat everything displayed as private production data: do not share screenshots, copy records into
issues or chat, or select the parent output folder containing more than one run.

After a passing rehearsal, render the two approved aggregate-only repository artifacts:

```powershell
python tooling/export_base44_snapshot.py summarize `
  --snapshot <absolute-private-run-path> `
  --json docs/migration/base44-rehearsal-summary.json `
  --markdown docs/migration/base44-rehearsal-summary.md
```

## Failure handling

User-visible failures contain only a safe category. Private manifest findings use bounded categories such as
`malformed_known_json`, `unsupported_reference`, `public_host_review_required`, `sign_failed`, `download_failed`,
`source_file_missing`, `redirect_rejected`, `size_limit_exceeded`, and `content_length_mismatch`. A generic
`download_failed` transport error is retried with a refreshed private signature when applicable, up to three
attempts; HTTP 404/410 is classified as missing without retry. Lock contention fails immediately instead of
waiting or changing state. Do not paste raw CLI output, exception
details, records, URIs, hosts, filenames, paths, IDs, or response bodies into issues, chat, reports, or Git.

A passing rehearsal requires stable inventories for all six entities, exactly two CPA/admin users, zero unresolved findings,
all page/record/file hashes verified, and an independent aggregate dashboard count check. Dashboard CSV is
corroboration only and must not be committed. Any failed gate stops the migration handoff; do not weaken it to match
a manual observation or deploy a Base44 helper.

## Retention, handoff, and cleanup

Retain the verified private snapshot under owner-controlled access for issue #11. Record the handoff without its
location or contents. The owner decides retention duration and authorizes eventual deletion; the exporter never
deletes a snapshot automatically. Cleanup must be an explicit, separately reviewed operation that targets the exact
private run. Reconfirm the pinned external source repository stayed clean and no Base44/AWS write or deployment
occurred before closing the rehearsal.
