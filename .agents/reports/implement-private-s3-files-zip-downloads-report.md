# Implementation Report — Private S3 files and ZIP downloads

**Plan**: `.agents/plans/implement-private-s3-files-zip-downloads.md`
**Branch**: `feature/private-s3-files-zip-downloads`
**PR**: [#26](https://github.com/noamtz/cpa-platform/pull/26)
**Status**: COMPLETE

## Summary

Implemented the private-file boundary for questionnaire documents, signed PDFs, and PDF-template bases using strict
opaque references, short-lived conditional S3 PUTs, resource-derived signed reads, and journaled create/delete
evidence. Added an asynchronous, server-inventoried ZIP workflow with a prefix-filtered S3 worker that streams a
complete archive to private temporary storage. Migrated active production upload/read/ZIP callers away from raw
Base44 file signing while retaining the explicitly deferred development-only PDF POCs.

## Tasks completed

- Pinned S3/presigner/multipart/ZIP dependencies → `package.json`, `package-lock.json` (UPDATE).
- Added strict file/reference/upload/read/ZIP contracts and shared public-client authorization →
  `backend/api/contracts/files.ts`, `backend/api/auth/public-client.ts` (CREATE).
- Added permissive read-only PdfTemplate persistence access → `backend/api/repositories/pdf-template.ts` (CREATE).
- Reused the shared public authorizer without changing questionnaire behavior →
  `backend/api/services/public-questionnaire.ts` (UPDATE).
- Added ordered `File` journal entries and deterministic create/delete operation receipts →
  `backend/api/contracts/change-journal.ts`, `backend/api/services/change-journal.ts` (UPDATE).
- Added ownership-aware initiation/completion, resource locators, legacy mapping, ZIP jobs, and compensated deletion →
  `backend/api/services/files.ts`, `backend/api/routes/files.ts`, `backend/api/handler.ts` (CREATE/UPDATE).
- Added the idempotent streaming ZIP worker with terminal status and partial-output cleanup →
  `backend/api/workers/zip-download.ts` (CREATE).
- Added narrow FilesBucket CORS, a bounded least-privilege worker, filtered notification, route inventory, outputs,
  and live/contract verifier coverage → `infra/sst/`, `sst.config.ts`, `tooling/verify_sst_foundation.mjs` (UPDATE).
- Added the reusable browser protocol and removed the Base44 Core arbitrary signer →
  `src/api/file-client.js`, `src/api/function-client.js`, `src/api/base44Client.js` (CREATE/UPDATE).
- Migrated active questionnaire, signing, template-editor, dashboard preview, and dashboard ZIP callers →
  `src/components/`, `src/pages/`, `src/lib/pdfme-config.js` (UPDATE).
- Updated operating and migration status documentation → `README.md`, `AGENTS.md` (UPDATE).

## Tests added

- `backend/api/__tests__/files-contract.test.ts`: metadata-only ingress, size/type bounds, exact references, malformed
  UUIDs, traversal/URI rejection, deterministic legacy mapping, resource locators, and safe ZIP keys/names.
- `backend/api/__tests__/pdf-template-repository.test.ts`: direct read and passthrough persistence behavior.
- `backend/api/__tests__/files-service.test.ts`: authorization-before-S3, conditional metadata PUTs, completion,
  receipts, exact-version compensation, cross-owner denial, scoped reads, template authorization, ZIP request/status,
  empty inventory, and delete-marker restoration/replay.
- `backend/api/__tests__/files-routes.test.ts`: exact public/CPA route authorization and strict-body rejection.
- `backend/api/__tests__/zip-download.test.ts`: ordered legacy/current/signed inventory, Unicode collision names,
  complete archive bytes, terminal retry idempotency, missing-source failure, and cleanup.
- `src/api/__tests__/file-client.test.js`: metadata-only API exchange, signed PUT headers/body/progress, expiry rejection,
  completion, ZIP polling, and ready-result download.
- Extended journal, compatibility-facade, function-client, and SST foundation/verifier tests.

Final automated results after review fixes: 96 frontend tests passed across 10 files; 196 foundation/backend tests
passed across 28 files.

## Validation results

- `npm ci` — passed with the repository's existing peer/engine/deprecation warnings; audit reported 31 dependency
  findings. No automatic audit mutation was performed.
- `npm ls @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/lib-storage jszip --depth=0` — passed; all four
  direct dependencies resolve to the pinned versions.
- `npm test` — passed: 10 files, 96 tests.
- `npm run test:foundation` — passed: 28 files, 196 tests.
- `npm run typecheck:foundation` — passed.
- `npm run lint:foundation` — passed.
- `node tooling/verify_sst_foundation.mjs --mode contract --stage test` — passed.
- `npm run build` — passed; only the existing browserslist-age notice was emitted.
- `python tooling/validate_codex_layer.py` — passed: 31 skills and 6 custom agents.
- `git diff --check` — passed (Git emitted Windows line-ending notices only).
- `npm run typecheck` — expected imported-baseline failure: 151 diagnostics versus 233 in the pinned baseline, with
  zero diagnostics in changed frontend paths.
- `npm run lint` — expected imported-baseline failure: 17 errors versus 23 in the pinned baseline, with zero errors in
  changed frontend paths. One remaining result is from ignored SST-generated bundle content rather than source.
- `npm run sst:diff:test` — blocked after configuration evaluation because the cached AWS credential failed STS with
  `InvalidClientTokenId`. No deployment or AWS mutation was attempted.
- Live AWS verification and browser acceptance — not run; they require refreshed test-stage credentials and explicit
  deployment/acceptance authorization.

## Deviations from the plan

- Template uploads retain the existing transitional `pending` template owner only when issue #10 has not yet created
  an AWS PdfTemplate record. Scoped template reads accept that exact transitional prefix after loading and authorizing
  the owning template record; arbitrary references remain impossible. This preserves the planned issue ordering while
  keeping new references opaque.
- Added `If-None-Match: *` to the signed PUT contract and CORS allowlist so an upload URL cannot overwrite its unique
  object key during its validity window. This is a security hardening of the planned single-use-by-unique-key rule.
- The SST diff could not be completed because of invalid external AWS credentials; all local synthesis-facing
  contracts, types, tests, and verifier assertions passed.
- Development-only PDF POC routes continue using their legacy helpers, as explicitly deferred by the plan. Active
  production routes no longer use the arbitrary signer or browser-supplied ZIP list.
- Existing legacy objects cannot be served safely by every resource flow through the narrow Base44 functions. Rather
  than restore the arbitrary signer, the supported test deployment now fails closed until issue #11 publishes tested
  aggregate evidence that all referenced bytes were imported with zero unresolved objects.

## Issues encountered

- The project PreToolUse hook initially treated ordinary source property suffixes as possible secret paths.
  Implementation patches used equivalent destructuring forms; no hook policy was changed.
- The configured test-stage AWS token is invalid, preventing the read-only SST preview and live verification.
- The imported frontend baseline still contains repository-wide type/lint debt; changed paths were brought to zero
  diagnostics instead of expanding unrelated cleanup.

## Review fixes

PR #26's first agentic review found and this branch fixed all three findings:

- Added a narrow authenticated PdfTemplate file-mirror record so Base44-backed template CRUD can seed AWS-owned file
  locators without reintroducing arbitrary signing or taking over issue #10's full CRUD scope.
- Added an atomic conditional ZIP processing lock so overlapping S3 deliveries cannot share result/status ownership.
- Added bounded durable `FILE_RECONCILIATION` evidence when both delete journaling and delete-marker restoration fail.

Focused regression tests cover the mirror-to-CPA/public read flow, overlapping ZIP deliveries, and the double-failure
delete path. A fresh review then found four more issues, all of which were accepted and fixed:

- Added a tested, fail-closed deployment gate that requires issue #11's completed private-file import evidence before
  the AWS readers can be activated.
- Replaced the permanent ZIP lock with a renewable conditional lease, atomic expired-owner takeover, and
  owner-specific result publication and cleanup.
- Replaced unbounded ZIP error logging with normalized classes and fixed messages, with explicit private-marker
  redaction coverage.
- Required the exact completed-upload receipt before an owned template file can be mirrored for public access.

The complete local validation suite was rerun with the updated totals above.

## Ready for the next step

The code and local delivery record are complete on PR #26. Re-review the updated PR, publish issue #11's verified
import evidence, then refresh the authorized test-stage AWS session and rerun `npm run sst:diff:test`. Deployment and
live browser acceptance remain separately authorized actions.
