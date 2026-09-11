# Code review — imported file preview type

**Branch:** `fix/imported-file-preview-type`

**Base:** `883170a` (`main`)

## Scope

Reviewed imported-file type detection, the authorized legacy-object read path, S3 response headers, preview state
propagation, signed-PDF handling, and regression coverage. Also verified that the test workload boundary retains the
DynamoDB transaction primitive already required by the runtime and present in the deployed boundary. The change does
not alter file ownership checks, legacy manifest binding, imported data, or production AWS resources.

## Stats

- Files Modified: 5
- Files Added: 3
- Files Deleted: 0
- New lines: 292
- Deleted lines: 36

## Findings

- **High — fixed:** the first version relied on an original filename or a file extension in the stored reference.
  Real imported submission records can contain only an extensionless legacy reference, and imported S3 objects do
  not always have useful content-type metadata. The API now samples only the first 32 bytes after authorization and
  manifest-binding checks, recognizes supported PDF/image signatures, and signs the URL with the correct response
  content type. The UI consumes that authorized content type.
- **High — fixed:** the PR deployment exposed source/deployed workload-boundary drift. Source omitted
  `dynamodb:ConditionCheckItem` even though runtime transactions require it and the deployed test boundary already
  contains it. The source policy and focused assertion now preserve that least-privilege action, avoiding an unsafe
  removal attempt during deployment.

## Verdict

The finding is fixed. No unresolved technical issues remain in the reviewed scope.

Validation passed with Node 20.17.0: 4 focused frontend tests, 25 focused backend tests, the full 168-test frontend
suite, the full 411-test foundation suite, both type checks and lints, production build, SST test-stage contract
verification, and diff hygiene.

## HUMAN READS

- `backend/api/services/files.ts:665` — preserves the existing owner/manifest authorization checks before any object
  content is sampled.
- `backend/api/services/files.ts:704` — reads at most 32 bytes only when an imported file lacks trustworthy type
  information, then supplies the detected type on the signed S3 response.
- `src/components/dashboard/ClientRow.jsx:460` — uses the API-provided type for inline preview while retaining the
  original filename/type fallback.

## HUMAN TESTS

- `src/components/dashboard/ClientRow.jsx:460` — open one extensionless imported PDF and one imported image from a
  CPA submission in the deployed test environment and confirm each uses the inline preview instead of the
  unsupported-type message.

## FYI

- `src/lib/__tests__/file-preview.test.js:20` — locks the original regression: an extensionless signed legacy URL no
  longer produces a fake `.com/legacy/...` extension.
- `backend/api/__tests__/files-service.test.ts:325` — proves an authorized extensionless imported PDF is detected and
  returned with `application/pdf` without weakening legacy binding.
