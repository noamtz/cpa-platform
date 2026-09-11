# Code review — persist test legacy-file access

**Branch:** `fix/persist-test-legacy-file-access`

**Base:** `48edc73` (`main`)

## Scope

Reviewed the protected test-stage re-enablement path, evidence parser usage, workflow ordering before AWS credentials,
production rejection, documentation, and regression coverage. The change accepts an older, already-verified import
artifact only for the existing test-stage enablement path. Missing, failed, malformed, or manifest-mismatched evidence
still blocks, and the GitHub Environment owner approval plus main-only policy remain required.

## Stats

- Files Modified: 6
- Files Added: 0
- Files Deleted: 0
- New lines: 11
- Deleted lines: 9

## Verdict

Code review passed. No technical issues detected.

Focused validation passed with Node 20.17.0: 39 tests, foundation type-check, foundation lint, SST contract verifier,
and `git diff --check`.

## HUMAN READS

- `infra/sst/private-file-cutover.ts:47` — confirms re-enablement still requires structurally valid, stage-matched,
  exact-manifest evidence while ignoring only its age.
- `.github/workflows/deploy-sst-test.yml:151` — confirms enablement remains manual, main-only, and ordered before AWS
  credentials and protected-Environment verification.

## HUMAN TESTS

- `.github/workflows/deploy-sst-test.yml:285` — approve the protected test deployment, then retry one imported PDF
  template from the public questionnaire to confirm the previous 404 becomes a signed-file response.
