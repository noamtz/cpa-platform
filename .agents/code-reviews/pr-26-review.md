# PR #26 Fresh Re-review — Private S3 files and ZIP downloads

**Reviewed head:** `f4418362c9d4f2b5a8ac68451908af5d1975f491`

## Summary

PR #26 is substantially improved and the four previously reported findings are implemented: deployment fails closed
until issue #11 import evidence exists, ZIP jobs use renewable leases and owner-specific outputs, worker logs are
bounded, and owned template mirrors require the exact upload-completion receipt. The full local suite is healthy
relative to the imported frontend baseline.

The fresh-eyes pass found two Medium-severity correctness gaps. A stale ZIP lease owner can still overwrite the
shared terminal status after another owner takes over, and the transitional template mirror mutates the AWS
PdfTemplate pointer without optimistic concurrency or ChangeJournal evidence. Both are undocumented violations of
the PR's stated ownership and rollback-journal contracts, so the PR is not ready to merge.

## Findings

### Critical

None.

### High

None.

### Medium

#### 1. A stale ZIP lease owner can overwrite the terminal status after takeover

Evidence: `backend/api/workers/zip-download.ts:120-129`, `backend/api/workers/zip-download.ts:209-274`,
`backend/api/workers/zip-download.ts:356-368`, and `backend/api/contracts/files.ts:290-313`.

The worker renews its lease immediately before publishing, but writes the shared
`zip-jobs/status/<job>.json` object with an unconditional `PutObject`. If worker A's status write stalls past the
60-second lease, worker B can atomically take over, publish its owner-specific result and terminal status, and then
have A's delayed write overwrite that terminal status. The release path swallows the failed stale-owner lease write,
so nothing detects or repairs the overwritten status. This defeats the result/status ownership guarantee and can
make the status endpoint expose the stale owner's output.

Fix: fence the terminal transition with the current lease generation/ETag or another conditional owner token. Only
a terminal status proven to belong to the current lease owner should be publishable and readable. Add a regression
that pauses owner A after its final renewal, lets owner B take over and publish, then resumes A and proves its delayed
status write cannot replace B's terminal result.

#### 2. Template mirroring performs an unjournaled, unconditional pointer mutation

Evidence: `backend/api/services/files.ts:618-660`, `backend/api/repositories/pdf-template.ts:42-81`, and
`.agents/plans/implement-private-s3-files-zip-downloads.md:60-64`.

After verifying ownership and the completion receipt, `mirrorCpaTemplateFile` calls `mirrorFile`, which unconditionally
updates `file_reference`, `name`, `is_active`, and `_version`. It supplies neither a DynamoDB condition nor a
ChangeJournal transaction. Two CPA sessions, or a delayed page-load mirror racing a save, can therefore both succeed;
the later write silently replaces the AWS pointer and metadata without an ordered `PdfTemplate` journal entry or a
stale-version conflict. The implementation report documents the transitional mirror, but not this exception to the
plan's journaled pointer-replacement rule.

Fix: make initial mirror creation conditional and make subsequent pointer changes conditionally versioned. Commit the
corresponding `PdfTemplate` update through ChangeJournal using the route request ID, and return the repository's
existing conflict shape for stale updates. Add concurrent/stale mirror tests and journal-entry assertions.

### Low

None.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | PASS — Node 20.17.0 and npm 10.8.2 |
| `npm ci` | PASS — documented peer/engine/deprecation warnings; audit reports 31 findings |
| Direct dependency pins | PASS — S3 client, presigner, multipart helper, and JSZip resolve to exact versions |
| `npm test` | PASS — 10 files, 96 tests |
| `npm run test:foundation` | PASS — 28 files, 196 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run typecheck` | BASELINE — 151 diagnostics versus 233 documented; zero changed-path hits |
| `npm run lint -- --quiet` | BASELINE — 17 errors versus 23 documented; zero changed-path hits |
| `npm run build` | PASS — existing Browserslist-age notice only |
| SST contract verifier | PASS — test-stage contract and worker inventory verified |
| Private-file cutover gate | PASS — correctly blocks deployment because issue #11 evidence is absent |
| Codex-layer validation | PASS — 31 skills and 6 custom agents |
| `git diff --check origin/main...HEAD` | PASS |
| `npm run sst:diff:test` | BLOCKED — STS rejects the cached test credential with `InvalidClientTokenId` |
| Live AWS/browser acceptance | NOT RUN — requires issue #11 evidence, refreshed credentials, and authorized deployment |

The blocked external preview is not the reason for the verdict. The local validation is healthy; the two findings are
independent concurrency and mutation-integrity defects that require regression coverage.

## What is done well

- File contracts remain metadata-only, opaque, and resource-scoped; no arbitrary signer was restored.
- Owned uploads require exact object metadata and durable completion receipts before use.
- The deployment command and test workflow both fail closed on missing issue #11 import evidence.
- ZIP source/result prefixes, filtered notifications, lease takeover, owner-specific result keys, and privacy-safe
  logging are narrowly scoped and broadly tested.
- The implementation preserves the documented frontend baseline while keeping all changed paths clean.

## Recommendation

**Request changes.** Fix the fenced terminal-status transition and the conditionally journaled template pointer
mutation, add the two concurrency regressions, then rerun the full validation and PR review gate.

## Resolution

Both Medium findings were accepted and fixed on the PR branch:

1. Terminal ZIP state now lives inside the lease record and is published with `If-Match` against the current lease
   ETag. A takeover and a terminal publication therefore compete on the same conditional object; a stale owner cannot
   overwrite the winner. The status route reads only this fenced terminal state. A regression pauses owner A's
   terminal write, lets owner B take over and complete, then proves A is rejected and B remains authoritative.
2. Template mirroring now carries the Base44 source version, treats exact replays idempotently, conditionally creates
   or updates the AWS mirror using `_version`, and commits the `PdfTemplate` mutation through ChangeJournal with the
   API request ID. Regression tests cover conditional creation, versioned pointer replacement, concurrent different
   mirrors with one winner, and stale-source rejection with the existing reload conflict shape.

Post-fix validation passed: 96 frontend tests, 199 foundation/backend tests, foundation typecheck and lint, build,
the SST contract verifier, cutover gate behavior, Codex-layer validation, dependency-pin checks, and
`git diff --check`. Repository-wide frontend typecheck and lint remain at their known imported baseline (151 diagnostics and
17 errors, with zero changed-path hits). The SST diff remains externally blocked by the cached AWS credential's
`InvalidClientTokenId`; deployment remains intentionally blocked until issue #11 evidence exists.

**Resolution status:** fixed; ready for a fresh PR review.
