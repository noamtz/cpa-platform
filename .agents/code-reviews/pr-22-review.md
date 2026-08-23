# PR #22 Review — Base44 production snapshot exporter

**PR:** https://github.com/noamtz/cpa-platform/pull/22

**Base ← head:** `main` ← `feature/inventory-export-base44-data-files`

**Verdict:** REQUEST CHANGES

## Resolution

All four findings were accepted as in-scope and fixed on the PR branch on 2026-08-23:

- Resume compatibility now includes and explicitly verifies the exporter version.
- One operating-system lock covers run selection, checkpoint mutation, manifest publication, and final status.
- A failed private URL from a signing batch is re-signed individually before bounded retries.
- HTTPS connections use the validated DNS address directly while preserving hostname-based TLS verification.

Focused regression tests and the complete 74-test Python exporter/importer suite pass. The original verdict above
is retained as the point-in-time review result; PR re-review is required after the fix commit is pushed.

## Summary

The PR delivers the intended read-only Base44 migration snapshot boundary and is backed by strong synthetic,
production-rehearsal, and manual reconciliation evidence. The fresh review nevertheless found two High-severity
resume/integrity gaps that should be fixed before merge, plus two Medium download edge cases. The project validation
matches its documented baseline and has no changed-file diagnostics.

## Issue counts

- Critical: 0
- High: 2
- Medium: 2
- Low: 0

## Validation

| Check | Result |
| --- | --- |
| Node/npm | PASS — Node 20.17.0, npm 10.8.2 |
| `npm ci` | PASS — existing peer/engine warnings and 31 current audit advisories; dependency files are unchanged |
| Python exporter/importer tests | PASS — 69 tests |
| Frontend tests | PASS — 67 tests |
| SST foundation tests | PASS — 45 tests |
| Foundation typecheck/lint/contract | PASS |
| Production build | PASS |
| Codex-layer validation | PASS — 31 skills, 6 custom agents |
| Full application typecheck | BASELINE MATCH — 233 inherited diagnostics, 0 in changed files |
| Full application lint | BASELINE MATCH — 23 inherited errors, 0 in changed files |
| Artifact JSON, ignore rules, and `git diff --check` | PASS |
| Manual aggregate reconciliation | PASS — owner confirmed all six dashboard counts match |

## AGENT FIXES

### High — Resume does not reject a different exporter version

file: `tooling/export_base44_snapshot.py:924`

The state records `toolVersion`, but `_state_config` omits it and `_initialize_or_resume` never compares the
top-level version. An interrupted snapshot from older Python orchestration logic can therefore reuse checkpoints
under a newer exporter when the bridge, CLI, page size, and other config values happen to match. This contradicts
the documented resume-compatibility contract.

Fix: add `TOOL_VERSION` to immutable resume compatibility (or compare `state["toolVersion"]` explicitly) and add an
older-version resume rejection test.

### Medium — Batched signed URLs can expire before later downloads begin

file: `tooling/export_base44_snapshot.py:1375`

The exporter obtains as many as 50 URLs with a 900-second expiry, then downloads them serially. A slow or large
early file can leave later URLs expired before their first request; retry currently reuses the same expired URL.

Fix: re-sign the individual reference after an authorization/download failure before the final retry, or otherwise
make signing expiry-aware. Add a test in which a later URL from the original batch expires before download.

## HUMAN DECIDES

### High — Concurrent resume processes are not serialized

file: `tooling/export_base44_snapshot.py:1136`

Two `--resume` processes can select the same active run, load the same state, and repeatedly replace `state.json`
from independent in-memory copies. Atomic writes prevent torn files but do not prevent lost checkpoint entries or a
late process overwriting completed state; differing manifest completion timestamps can also produce immutable
artifact drift after duplicated work.

Required decision before merge: accept a per-run exclusive lock held from resume validation through final status
publication, or explicitly narrow the operational contract and provide equivalent fail-closed serialization. Add a
concurrent-resume regression test.

### Medium — Address validation and connection perform separate DNS lookups

file: `tooling/export_base44_snapshot.py:546`

The exporter validates the addresses returned by `getaddrinfo`, then `urllib` resolves the hostname again while
opening the connection at `tooling/export_base44_snapshot.py:607`. A rebinding host can change from a global address
to a private address between those operations and bypass the intended SSRF boundary.

Required decision: use a transport that pins the validated address for the connection while retaining TLS
hostname/SNI and certificate checks, then add a DNS-rebinding regression test.

## HUMAN READS

- `tooling/base44_export_bridge.ts:1` — privileged Base44 read/sign boundary.
- `tooling/export_base44_snapshot.py:1228` — production export, checkpoint, and reconciliation orchestration.
- `docs/migration/base44-export-runbook.md:1` — private-data handling, retention, and operator procedure.

## HUMAN TESTS

- `.agents/reports/inventory-export-base44-data-files-report.md:58` — manual six-entity dashboard reconciliation
  is recorded as complete; no additional manual test is required for this review round.

## FYI

- `tooling/base44_snapshot_viewer.html:1` — the offline viewer blocks network connections and browser persistence
  and inserts record data using `textContent`.

## What is done well

- The privileged bridge is narrow and validates its two allowed operations without exposing mutation or arbitrary
  SDK dispatch.
- Raw record preservation, recursive decoded-JSON discovery, immutable artifact publication, and independent
  manifest reconciliation are thoughtfully implemented.
- Signed URLs stay out of persisted artifacts and CLI output; aggregate evidence avoids record-level values.
- The implementation report documents the live-rehearsal deviations instead of hiding them.

## Recommendation

Request changes. Fix the two High findings before merge, address or explicitly resolve the two Medium findings, then
rerun validation and this PR gate. After that, a human should review and approve the merge.
