# PR #26 Re-review — Private S3 files and ZIP downloads

**Reviewed head:** `765b9b1f18648e633d9b1f616bf755a685f09ff0`

## Summary

PR #26 is not ready to merge. The prior three findings were addressed thoughtfully, but the fresh-eyes pass found
three remaining High-severity defects: the active AWS readers cannot serve existing Base44-backed file references
before the later byte import, the permanent ZIP lock can strand a job after a crash or status-write failure, and the
worker logs an unbounded external error message despite the plan's fixed-message privacy invariant. One
Medium-severity path also lets the new template mirror expose an owned upload without completion or File journal
evidence.

## Findings

### Critical

None.

### High

#### 1. The active AWS read path breaks existing Base44-backed files before their bytes are imported

Evidence: `backend/api/contracts/files.ts:164-173`, `backend/api/services/files.ts:528-554`,
`backend/api/services/files.ts:557-615`, and `src/pages/PdfTemplateEditor.jsx:42-50,88-102`.

Every stored reference now resolves to a FilesBucket key and is checked with `HeadObject` before signing. Legacy
`private://`, `private/`, and `mp/` values are only hashed to `legacy/<sha256>`; this PR does not copy their bytes.
The new template mirror copies only the locator metadata for the first 50 templates loaded in the CPA editor, not the
object, and public template reads require that DynamoDB mirror. Existing template bases, signed PDFs, questionnaire
documents, CPA previews, and ZIP sources therefore return not-found until the separately scoped issue #11 import has
copied and verified the objects. This violates the plan and repository rule to retain the working Base44 path until
the AWS replacement has parity and a rollback-safe cutover.

Fix: keep the existing resource-scoped Base44 read functions for legacy stored references until the snapshot import
has copied and verified all bytes, without restoring the arbitrary signer. Alternatively, make that import a tested
deployment prerequisite and do not activate the AWS readers before it succeeds. Cover an unmirrored legacy template,
a mirrored-but-not-imported template, a legacy signed PDF/questionnaire file, and a ZIP containing a legacy source.

#### 2. A ZIP worker crash or terminal-status failure permanently strands the job

Evidence: `backend/api/workers/zip-download.ts:91-118`, `backend/api/workers/zip-download.ts:120-193`,
`backend/api/__tests__/zip-download.test.ts:217-289`, and `infra/sst/contracts.ts:341`.

The worker creates `zip-jobs/locks/<job>.json` with `If-None-Match: *`, but the lock has no lease expiry, ownership
token, takeover rule, or release path. If the 900-second Lambda is terminated after acquiring it, or either terminal
status write fails, no terminal state is guaranteed and all S3 retries return immediately on the permanent lock.
The one-day bucket lifecycle eventually removes the lock but neither retriggers the request nor completes the job.
The new overlap test proves only that a successful owner excludes a concurrent delivery; it does not exercise owner
death or failed status persistence.

Fix: use a recoverable conditional lease or durable processing state with an owner token, expiry, and atomic takeover;
only its current owner may publish/delete. Add crash/timeout and ready/failed-status-write regression cases in which a
later delivery takes over and produces exactly one terminal outcome.

#### 3. The ZIP worker can copy sensitive external error text into CloudWatch

Evidence: `backend/api/workers/zip-download.ts:188-192`,
`backend/api/__tests__/zip-download.test.ts:210-214`, and
`.agents/plans/implement-private-s3-files-zip-downloads.md:303,322,600`.

The catch path logs `error.message` verbatim. S3, multipart-upload, stream, JSON, and validation errors are external
or data-adjacent and do not guarantee that their message omits an object reference, archive entry name, token, or
other private context. The implementation therefore cannot satisfy the explicit plan contract that unexpected logs
contain only the job ID, an error class, and a fixed message. The current failure test checks `errorName` but does not
assert redaction.

Fix: emit a fixed worker-failure message and a small normalized/allowlisted failure class; never serialize arbitrary
external `.message` text. Add a regression test whose thrown message contains synthetic private reference, filename,
and token markers and prove none reaches the console payload.

### Medium

#### 4. Template mirroring can bypass upload completion and File journal evidence

Evidence: `backend/api/services/files.ts:435-494`, `backend/api/services/files.ts:618-653`, and
`backend/api/__tests__/files-service.test.ts:395-423`.

Normal upload completion checks the create receipt, validates the declared size against the object, and commits the
bounded File journal entry. `mirrorCpaTemplateFile` independently accepts an owned pending/template reference after
checking only content type, purpose, and owner hash, then makes it available to public template reads. A CPA can
therefore initiate and PUT a template object, skip completion, and mirror an unjournaled object. The regression test
constructs exactly that path and expects it to succeed.

Fix: for owned references, require the matching successful create receipt for the exact `file_uri` before writing the
template mirror. Keep any legacy exception limited to references produced by the authorized import path. Add a
negative test proving an initiated/PUT-but-uncompleted object cannot be mirrored or publicly signed.

### Low

None.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | PASS — Node 20.17.0 and npm 10.8.2 |
| `npm ci` | PASS — documented peer/engine/deprecation warnings; audit reports 31 findings |
| Direct dependency pins | PASS — S3 client, presigner, multipart helper, and JSZip resolve to exact versions |
| `npm test` | PASS — 10 files, 96 tests |
| `npm run test:foundation` | PASS — 27 files, 189 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run typecheck` | BASELINE — 151 diagnostics versus 233 documented; zero changed-path hits |
| `npm run lint` | BASELINE — 17 errors versus 23 documented; zero changed-path hits |
| `npm run build` | PASS — existing Browserslist-age notice only |
| SST contract verifier | PASS — test-stage contract and worker inventory verified |
| Codex-layer validation | PASS — 31 skills and 6 custom agents |
| `git diff --check origin/main...HEAD` | PASS |
| `npm run sst:diff:test` | BLOCKED — STS rejects the cached test credential with `InvalidClientTokenId` |
| Live AWS/browser acceptance | NOT RUN — requires refreshed credentials and separately authorized deployment |

The local suite is healthy relative to the imported baseline. The blocked external preview is not the reason for the
verdict; the three High findings are independently merge-blocking.

## What is done well

- The upload/read contracts remain strict, opaque, and resource-scoped; the fix did not restore arbitrary signing.
- The template mirror verifies exact pending/template prefixes and server-owned S3 metadata.
- The conditional ZIP lock correctly prevents two overlapping live invocations from sharing result ownership.
- File-delete double failure now leaves bounded, reference-free reconciliation evidence while retaining the original
  journal failure.
- Focused regression coverage is broad, and the complete local suite passes under the pinned runtime.

## Recommendation

**Request changes.** Resolve all three High findings before merge and close the Medium completion/journal bypass in
the same pass. Then rerun the full local suite and the fresh PR gate. Refresh the authorized test-stage AWS session
separately so the read-only SST diff can be inspected before deployment.

## Resolution

All four findings were accepted and fixed on the PR branch:

1. The AWS private-file readers are now protected by a tested, fail-closed deployment prerequisite. The test-stage
   workflow and supported deploy command require aggregate verification evidence from issue #11 showing that every
   legacy reference was imported with zero unresolved objects. The gate deliberately does not restore the arbitrary
   Base44 signer or expose legacy references to the browser.
2. ZIP processing now uses a renewable conditional lease with an owner token, expiry, atomic takeover, and
   owner-specific result keys. Regression tests cover an expired crashed owner and a delivery whose terminal status
   writes fail before a later delivery takes over and completes the job.
3. ZIP failure logs now contain only the job ID, a normalized failure class, and a fixed message. A regression test
   injects a synthetic private reference, filename, and token into an external error and proves none is logged.
4. Mirroring an owned template upload now requires the exact successful create receipt before any S3 access or
   public mirror write. A negative test proves an initiated and uploaded, but uncompleted, object is rejected.

Post-fix validation passed: 96 frontend tests, 196 foundation/backend tests, foundation typecheck and lint, build,
the SST contract verifier, Codex-layer validation, and `git diff --check`. Repository-wide frontend typecheck and
lint remain at their known imported baseline (151 diagnostics and 17 errors respectively, with zero changed-path
hits). The read-only SST diff remains blocked by the cached AWS credential's `InvalidClientTokenId`; the supported
deploy command is also intentionally blocked until issue #11 publishes valid import evidence.

**Resolution status:** fixed; ready for a fresh PR review.
