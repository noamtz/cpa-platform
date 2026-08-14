# Root Cause Analysis: GitHub Issue #3

## Issue Summary

- **GitHub Issue ID**: #3
- **Issue URL**: https://github.com/noamtz/cpa-platform/issues/3
- **Title**: [Migration 01/13] Import production source and lock the parity baseline
- **Reporter**: noamtz
- **Status**: Open

## Assessment

| Metric | Value | Reasoning |
|--------|-------|-----------|
| Severity | High | A clean Windows checkout cannot run the documented audit, so the imported baseline's central reproducibility guarantee is unavailable; the Git objects remain correct and no data is corrupted. |
| Complexity | Medium | The fix is localized to destination hashing, workflow guard removal, and importer tests, but it must preserve exact Git-blob verification across source, committed destination, and worktree representations. |
| Confidence | High | The failure was reproduced on clean `main`; Git EOL diagnostics, worktree/blob hashes, and all three workflow blobs prove that CRLF checkout conversion is the only difference. |

## Problem Description

The committed AuditFlow source manifest is intended to be independently verifiable after the import commit. On a
clean Git for Windows checkout with `core.autocrlf=true`, the documented `inspect --verify-applied` command fails
even though the committed imported files and workflow guards are correct.

**Expected Behavior:**
The verifier should accept a clean checkout when Git's canonical blobs match the committed import evidence,
regardless of whether Git presents text files as LF or CRLF in the worktree. It must continue to reject meaningful
content changes, missing or duplicated workflow guards, and source-blob mismatches.

**Actual Behavior:**
The verifier hashes raw worktree bytes and searches for an LF-only workflow guard block. Git for Windows checks
text files out as CRLF, so the guard search fails first; copy-exact blob comparisons and restored-workflow hashes
would also fail once that first error is cleared.

**Symptoms:**
- The documented command exits 1 with `Workflow guard is missing or duplicated`.
- `git status` is clean and `git ls-files --eol` reports `i/lf w/crlf` for affected text files.
- The committed workflow blobs contain one guard each, and removing each guard reproduces its pinned source blob.
- Raw worktree hashes differ from both the committed destination blobs and manifest evidence.

## Reproduction

**Steps to Reproduce:**
1. Check out the merged import commit in a clone configured with `core.autocrlf=true`.
2. Confirm Git reports imported text files as `i/lf w/crlf` and the worktree as clean.
3. Run the committed-manifest verification command from `docs/migration/auditflow-source-baseline.md`.
4. Observe the workflow-guard error before manifest comparison.

**Reproduction Verified:** Yes, on the post-merge Windows `main` checkout at
`e5561d64c7bcb19e43269d59fd74ea1519c4693d`.

## Root Cause

### Affected Components

- **Files**: `tooling/import_auditflow_source.py`, `tooling/tests/test_import_auditflow_source.py`,
  `docs/migration/auditflow-source-baseline.md`
- **Functions/Classes**: `raw_blob_id`, `remove_workflow_guard`, `verify_destination_entry`,
  `ImportAuditFlowSourceTests`
- **Dependencies**: Git checkout/clean-filter behavior controlled by `core.autocrlf`

### Analysis

The source archive is intentionally created with `core.autocrlf=false` and verified against raw pinned source
blobs. That source-side behavior is correct. The destination verifier, however, also uses raw worktree bytes. A
worktree is not a stable byte representation of a Git blob: Git may present an LF blob as CRLF while retaining the
same canonical object and a clean status.

The workflow path has two additional raw-byte assumptions. `remove_workflow_guard` concatenates two LF-terminated
constants and requires that exact block once. After Windows checkout, the semantic lines are present once but use
CRLF. Even if removal accepted CRLF, the verifier then manually hashes restored CRLF bytes and compares that hash
to the LF source blob. Copy-exact files have the same problem because their raw worktree hash is compared directly
with the source blob.

**Evidence Chain (5 Whys):**
```text
WHY does committed-manifest verification fail on a clean Windows checkout?
-> Because remove_workflow_guard reports that the expected workflow block is absent.
   (evidence: tooling/import_auditflow_source.py:321-329 - exact text.count(block) check)

WHY is the block reported absent when the guard is visibly present once?
-> Because WORKFLOW_COMMENT and WORKFLOW_GUARD contain LF terminators while the checkout contains CRLF.
   (evidence: tooling/import_auditflow_source.py:32-35; git ls-files --eol reports i/lf w/crlf)

WHY would verification still fail after making guard lookup newline-aware?
-> Because the restored workflow is manually hashed as raw CRLF bytes, and copy-exact files are also hashed with
   git hash-object --no-filters.
   (evidence: tooling/import_auditflow_source.py:303-304 and 436-447)

WHY do raw worktree hashes differ in a clean checkout?
-> Because core.autocrlf=true converts canonical LF blobs to CRLF only when populating the worktree.
   (evidence: HEAD:path hashes equal the manifest while raw worktree hashes differ and git status remains clean)

ROOT CAUSE: Destination verification treats platform-dependent worktree bytes as canonical Git evidence instead
of applying Git's path-aware clean conversion before comparing blob identities; workflow guard parsing separately
assumes LF-only input.
   (evidence: tooling/import_auditflow_source.py:303-304, 321-329, and 424-450)
```

**Why This Occurs:**
The test repositories force `core.autocrlf=false`, and the only existing `core.autocrlf=true` test covers source
archive staging rather than a committed destination checkout. The import initially verifies immediately after
writing LF archive bytes, so the defect becomes visible only after committing and checking the files out again.

**Code Location:**
```python
# tooling/import_auditflow_source.py:303-304
def raw_blob_id(repo: Path, path: Path) -> str:
    return decode(git(repo, "hash-object", "--no-filters", str(path)))

# tooling/import_auditflow_source.py:326-329
block = WORKFLOW_COMMENT + WORKFLOW_GUARD
if text.count(block) != 1:
    raise ImportFailure(f"Workflow guard is missing or duplicated: {path}")
```

### Related Issues

- PR #18 fixed mutable manifest metadata comparison but did not cover post-checkout line-ending conversion.
- Issue #3 was reopened after its merged completion evidence failed on a clean Windows checkout.

## Impact Assessment

**Scope:**
- Affects clean checkouts where Git converts text files to CRLF, including the repository owner's Windows setup.
- Applies to all imported copy-exact text files and all three adapted workflows, not only the first reported file.
- Does not affect the correctness of the committed Git objects or the pinned source repository.

**Affected Features:**
- Reproduction of the imported AuditFlow baseline.
- Independent committed-manifest verification.
- Reviewer confidence in the migration provenance evidence.

**Severity Justification:**
The defect invalidates a key acceptance criterion and documented audit command for the primary development
platform. There is a manual workaround—inspect committed blobs directly—but the supported verifier is unusable.

**Data/Security Concerns:**
No data corruption or security defect was found. The failure is false-negative verification; strict comparison
must remain in place so meaningful imported-content changes are not accepted.

## Proposed Fix

### Fix Strategy

Keep source archive verification byte-exact. For destination files, compute the Git blob identity using
`git hash-object --path=<repo-relative-path>` so Git applies the same path-aware clean conversion it would apply
when committing. Make guard removal accept exactly one complete LF or CRLF guard block while preserving the
input's remaining bytes. Hash the restored workflow through the same path-aware Git conversion before comparing it
with the pinned source blob.

Add a regression that applies and commits the fixture import, creates a fresh clone with
`core.autocrlf=true`, confirms CRLF worktree bytes, and successfully runs committed-manifest verification from that
clone. Keep existing manifest-tampering coverage to prove immutable evidence is still enforced.

### Files to Modify

1. **`tooling/import_auditflow_source.py`**
   - Changes: Separate strict archive hashing from canonical destination hashing; support LF/CRLF guard blocks;
     compare restored workflows through Git's clean conversion.
   - Reason: This makes verification depend on canonical Git content rather than checkout presentation.

2. **`tooling/tests/test_import_auditflow_source.py`**
   - Changes: Add a fresh-clone `core.autocrlf=true` regression and assertions that it actually produced CRLF.
   - Reason: Existing fixtures explicitly disable autocrlf and cannot expose the reported failure.

3. **`docs/migration/auditflow-source-baseline.md`**
   - Changes: Clarify that committed verification compares Git-canonical destination content across LF/CRLF
     worktrees while retaining exact source-blob evidence.
   - Reason: Document the portability guarantee and its boundary.

### Alternative Approaches

- Reading only `HEAD:path` would avoid checkout conversion but could miss uncommitted changes and would not support
  apply-time verification before a commit.
- Normalizing all newlines in Python before raw hashing would address the pinned files but would duplicate Git's
  canonicalization rules and risk accepting transformations that Git itself would record as changes.
- Adding a repository-wide `.gitattributes` file could force worktree LF, but it would change checkout policy for
  the entire imported application and would not make the verifier robust to other valid Git configurations.

### Risks and Considerations

- Source archive verification must continue using `--no-filters` so the pinned source bytes remain exact.
- Guard removal must require exactly one complete comment-plus-guard block and reject mixed, missing, or duplicate
  blocks.
- Path-aware hashing may honor destination attributes or clean filters; this is intentional because the verifier's
  evidence is the blob Git would commit, but the regression must prove real content edits still fail.
- No manifest schema change is required because stored blob IDs remain canonical Git blob identities.

### Testing Requirements

**Test Cases Needed:**
1. Apply and commit an import, clone it with `core.autocrlf=true`, verify CRLF worktree presentation, and confirm
   `inspect --verify-applied --manifest` succeeds.
2. Preserve the existing LF apply/inspect round trip and manifest-tampering rejection.
3. Run the documented verification against the real pinned source and merged destination on Windows.

**Validation Commands:**
```powershell
python -m unittest tooling.tests.test_import_auditflow_source -v
python tooling/import_auditflow_source.py inspect `
  --source C:\Users\ntzur\workspace-antigravity\auditflow `
  --destination C:\Users\ntzur\workspace-vscode\cpa-platform `
  --expected-commit 5920c779cc49d6502bdbb2aad56e40845778fc9c `
  --manifest docs/migration/auditflow-source-manifest.json `
  --verify-applied
python tooling/validate_codex_layer.py
npm test
npm run typecheck
npm run lint
npm run build
```

## Implementation Plan

1. Add a destination-only path-aware Git blob helper while retaining strict raw archive hashing.
2. Update destination and restored-workflow verification to use canonical Git blob identities.
3. Make workflow guard removal exactly-one-block safe for LF and CRLF inputs.
4. Add the committed fresh-Windows-checkout regression.
5. Update the baseline contract, run focused and full validation, and rerun the real documented audit.

This RCA document should be used by the `piv-implement-issue` skill.

## Next Steps

1. Review this RCA document.
2. Run `$piv-implement-issue` with issue #3 to implement the fix.
3. Run `$piv-commit` after implementation is complete.
