# Code Review — Inventory and export Base44 data and files

**Branch:** `feature/inventory-export-base44-data-files`

**Reviewed against:** `HEAD` before the feature commit
**Verdict:** PASS AFTER AGENT FIXES

## Stats

- Files Modified: 2
- Files Added: 9
- Files Deleted: 0
- New lines: 3,693
- Deleted lines: 35

## AGENT FIXES

severity: high

file: tooling/export_base44_snapshot.py:1472

issue: Offline verification trusts manifest totals, reference closure, and gates instead of independently recomputing them.

detail: Entity and file bytes are rehashed, but `verify_snapshot` returns the manifest without reconciling its reference inventory, totals, file mappings, admin count, or pass/fail gates. A modified manifest paired with an updated mutable state checksum can therefore produce sanitized evidence that the verifier did not independently establish, contrary to the acceptance contract.

suggestion: Rebuild inventories and discovery from NDJSON, validate reference-to-file mappings, recalculate totals and gates, compare them exactly with the manifest, and add tamper tests.

resolution: FIXED — verification now rebuilds inventories/discovery, validates reference/file mappings, and compares independently calculated totals, gates, and completion status. The rewritten-state-checksum tamper test and the strengthened production offline verification both pass.

severity: medium

file: tooling/export_base44_snapshot.py:1719

issue: Failed-run diagnostics submit every failed source in one signing batch.

detail: `Base44CliBridge.sign_files` accepts at most 50 items, but `diagnose_failed_snapshot` passes the complete failure list. Any failed rehearsal with 51 or more private signing failures makes the diagnostic command fail before producing its aggregate-safe result.

suggestion: Split exact-source diagnostic signing into batches of 50 and test the 51-item boundary.

resolution: FIXED — diagnostics now batch exact-source checks in groups of 50; the 51-item boundary test observes batches of 50 and 1.

severity: high

file: tooling/export_base44_snapshot.py:1854

issue: Unexpected exceptions bypass the CLI's redacted error boundary.

detail: `main` catches a fixed subset of exception classes. A `KeyError`, `TypeError`, HTTP protocol exception, or another unexpected library failure can escape as a traceback containing private runtime details instead of the static `unexpected_safe_failure` category.

suggestion: Catch unexpected `Exception` values at the outer boundary without including their text, while continuing to let process-control exceptions propagate, and add a redaction test.

resolution: FIXED — the outer CLI boundary now maps every ordinary unexpected exception to `unexpected_safe_failure`; the regression test proves private exception text is absent.

severity: medium

file: tooling/export_base44_snapshot.py:546

issue: Download address validation allows non-global shared address space.

detail: The explicit deny-list does not reject ranges such as `100.64.0.0/10`, which are not globally routable. This weakens the intended SSRF boundary for signed and approved-public downloads.

suggestion: Require every resolved address to be globally routable and add a CGNAT regression test.

resolution: FIXED — resolved addresses must now satisfy `ipaddress.is_global`; CGNAT is rejected and an ordinary global address remains accepted in the focused test.

## Fix validation

- Exporter/viewer tests: PASS — 58 tests.
- Strengthened offline verification of the completed production rehearsal: PASS — 366 objects.
- Deferred findings: none.
- Manual follow-up findings: none.

## HUMAN READS

- tooling/base44_export_bridge.ts:1 — confirm the privileged bridge remains limited to entity reads and private-file signing.
- tooling/export_base44_snapshot.py:1228 — inspect the production export orchestration and durable resume boundary.
- docs/migration/base44-export-runbook.md:1 — confirm the operational privacy, retention, and production-read instructions.

## HUMAN DECIDES

None.

## HUMAN TESTS

None. The owner completed the independent dashboard aggregate comparison and confirmed that all six counts match.

## FYI

- tooling/base44_snapshot_viewer.html:1 — the standalone viewer uses a no-connect CSP, browser-memory-only state, and text-only rendering for snapshot values.
