# PR #44 review — allow ZIP worker to detect new jobs

Reviewed branch: `fix/zip-download-stall`

## Verdict

Approve. No critical, high, medium, or low findings.

## Findings

- AGENT FIXES — `tooling/verify_sst_foundation.mjs:413`: the fresh-eyes review noted that the contract verifier did not pin the new bucket permission; the assertion was added before approval.
- HUMAN READS — `infra/sst/application.ts:160`: the new `s3:ListBucket` permission is scoped to the existing private temporary-output bucket and is required for S3 missing-object reads to return 404 instead of 403.
- HUMAN TESTS — `backend/api/__tests__/zip-download.test.ts:209`: after the protected test deployment, retry a one-file ZIP from a real imported submission and confirm the browser downloads it.
- FYI — `backend/api/workers/zip-download.ts:68`: retry logs contain only bounded stage/name/code/HTTP/request-ID fields; provider messages, object paths, filenames, and tokens are excluded.

## Validation

| Check | Result |
| --- | --- |
| Frontend tests | Passed — 16 files, 168 tests |
| Foundation tests | Passed — 48 files, 412 tests |
| Frontend and foundation typechecks | Passed |
| Frontend and foundation lint | Passed |
| Production build | Passed |
| Foundation contract verifier | Passed |
| SST test preview | Passed; relevant IAM diff is the temporary-bucket list grant |
| Fresh-eyes code review | Passed; no material findings |

## What is good

The change addresses the exact AWS behavior behind the incident without touching imported data or production. The permission is resource-scoped, the worker still fails closed on real access errors, and the added diagnostics preserve the private-file logging boundary.

## Recommendation

Merge after the current CI check passes, dispatch the protected test deployment with legacy reads enabled, and run the focused one-file ZIP probe.
