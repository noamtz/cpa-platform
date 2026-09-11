# Code review — imported file preview type

**Branch:** `fix/imported-file-preview-type`

**Base:** `883170a` (`main`)

## Scope

Reviewed file-type extraction, preview state propagation, signed-PDF handling, query-string and encoded-filename
behavior, user-facing fallback behavior, and regression coverage. The change is frontend-only and does not alter
file authorization, signed-URL generation, imported data, or AWS resources.

## Stats

- Files Modified: 1
- Files Added: 2
- Files Deleted: 0
- New lines: 57
- Deleted lines: 10

## Verdict

Code review passed. No technical issues detected.

Validation passed with Node 20.17.0: 3 focused regression tests, the full 167-test frontend suite, frontend
type-check, frontend lint, and production build.

## HUMAN READS

- `src/lib/file-preview.js:13` — extracts an extension only from a final filename/path segment and never from a
  signed URL hostname plus extensionless legacy key.
- `src/components/dashboard/ClientRow.jsx:456` — prefers the original uploaded filename, then the stored source
  reference, before creating preview state.
- `src/components/dashboard/ClientRow.jsx:555` — explicitly identifies signed questionnaire output as PDF.

## HUMAN TESTS

- `src/components/dashboard/ClientRow.jsx:463` — open one imported PDF and one imported image from a CPA submission
  in the deployed test environment and confirm each uses the inline preview instead of the unsupported-type message.

## FYI

- `src/lib/__tests__/file-preview.test.js:20` — locks the exact regression: an extensionless signed legacy URL no
  longer produces a fake `.com/legacy/...` extension.
