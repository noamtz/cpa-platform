# Implementation Report — Complete CPA workflow and template parity

**Plan**: `.agents/plans/complete-cpa-workflow-template-parity.md`

**Issue**: `#10`

**Branch**: `feature/complete-cpa-workflow-template-parity`

**Status**: COMPLETE AND TEST-STAGE VERIFIED — implementation, local validation, owner-authenticated preview/deploy,
restricted-deployer CI, and the live foundation verifier pass. The broader disposable two-user exploratory matrix
remains a human acceptance exercise.

## Summary

Completed the remaining reachable CPA workflow and template migration from Base44 to the Cognito-protected SST
compatibility API. The backend now owns questionnaire version activation, PDF-template lifecycle, CPA-assisted
submission saves, tax-year selection, restore/swap, and paired workflow-status transitions. These mutations use
strict contracts, optimistic concurrency, active-record guards, and immutable ChangeJournal entries.

The browser facade and all reachable callers now use AWS-backed protected or scoped-public operations as appropriate.
The Base44 SDK and Vite plugin were removed, remote Base44 media was localized, PDF signing uses the two-phase private
file flow, and the remaining non-migrated agent/integration entry points fail explicitly instead of falling back.

## Tasks completed

- Revalidated issue #10 and created `feature/complete-cpa-workflow-template-parity` from the current local `main`.
- Added strict questionnaire, PDF-template, and CPA-workflow ingress/persisted/projection contracts, including bounded
  JSON/steps, duplicate-step rejection, additive Submission revisions, and server-derived CPA identity.
- Added strongly addressed questionnaire and active-submission guards, bounded indexed history/list access, and safe
  singleton legacy initialization. The final review added atomic guard initialization for imported active submissions
  during CPA save, status transition, and restore/swap.
- Added journaled questionnaire version/history/activation and PDF-template list/read/create/update/archive services.
  PDF create/update validate the private upload receipt, object prefix, purpose/owner metadata, and exact pdfme JSON.
- Added revision-aware CPA-assisted saves with FIFO-compatible conflict behavior, server-selected template pinning,
  completed-submission pin preservation, fail-soft prior audit parsing, and server-derived audit entries.
- Added atomic tax-year selection, conflict-aware restore/swap, and paired Client/Submission workflow status changes.
- Registered nine protected template routes and four protected CPA workflow routes, including the legacy-shaped but
  Cognito-protected `cpaSaveSubmission` compatibility path; synchronized SST contracts and verifier inventories.
- Extended the AWS client/facade and migrated questionnaire editing/history, PDF-template management, CPA-assisted
  filling, dashboard lifecycle actions, and public/CPA PDF-signing call sites.
- Removed `@base44/sdk`, `@base44/vite-plugin`, the legacy app-parameter helper, runtime Base44 environment/media
  references, and all runtime fallback behavior.
- Added local brand assets and updated the manifest, HTML, dashboard/questionnaire imagery, README, and repository
  migration status. The source favicon endpoint returned HTTP 415, so the local ICO was derived from the exact
  downloaded brand image instead of being copied byte-for-byte.
- Added service, route, repository, authorization, facade, and regression coverage for success, conflict, no-mutation,
  archive denial, active guards, template pinning, and route protection.
- Completed a local desktop/mobile Chromium smoke check for routing, RTL/error presentation, and the localized brand
  asset; the isolated temporary profile was deleted after the check.
- Repaired the test deployer's CloudFront KeyValueStore data-plane grant with an explicit six-action,
  account-resource-scoped statement; added policy and workflow-order regressions plus an effective-permission
  preflight that runs before any CI preview or deployment.
- Used the owner-authenticated profile to preview and deploy the complete synthetic-only test stage, then verified the
  deployed role and complete live foundation. The required GitHub OIDC workflow subsequently passed end to end.

## Validation results

- `npm ci`: PASS under the available Node 24.13.0 runtime. Switching to required Node 20.17.0 via nvm failed with a
  Windows access-denied error; no dependency or lockfile drift followed the clean install.
- Application tests: PASS — 13 files / 110 tests.
- Foundation/backend/tooling tests: PASS — 35 files / 267 tests.
- PDF tests: PASS — 3 files / 22 tests.
- Foundation typecheck and lint: PASS.
- Production build: PASS.
- SST contract verifier: PASS — seven tables, two buckets, one router/site/application API/PDF API, one application
  function/PDF function/worker, and one pool/client/domain/resource server/authorizer.
- Runtime Base44 scan: PASS — zero matches in browser/runtime code, HTML, public assets, Vite config, or package manifest.
- Codex-layer validation: PASS — 31 skills and 6 custom agents.
- `git diff --check`: PASS (Git for Windows future line-ending warnings only).
- Full application typecheck: inherited untyped-UI failure remains; diagnostics decreased from the recorded 233
  baseline to 145. New backend modules pass the strict foundation typecheck, and touched frontend paths pass focused
  lint, tests, and the production build.
- Full application lint: inherited failure remains but decreased from 23 baseline errors to five. Three are generated
  `.sst` bundle rule-resolution errors; two are unused imports in untouched `CompletionScreen.jsx` and
  `UserManagement.jsx`. All task paths pass focused lint.
- Local isolated-browser smoke: PASS — localized 1024×1024 brand image loaded; `/questionnaire` rendered the expected
  Hebrew invalid-link state at 1440×900 and 390×844. That smoke did not exercise authenticated CPA browser behavior;
  deployed authorization is covered by the route/service suites and live foundation verifier.
- Owner-authenticated `npm run sst:diff:test`: PASS — intended deploy-role and application artifact updates, with no
  stateful resource replacement.
- Owner-authenticated `npm run sst:deploy:test`: PASS — test stage deployed and Cognito refresh rotation remained
  enabled.
- Deployer verifier: PASS — exactly six required CloudFront KeyValueStore actions are effective on the account-local
  resource namespace; cross-account access is denied.
- Live foundation verifier: PASS — deployed inventory, data protection, runtime, PDF rendering, IAM simulations,
  OIDC trust, managed login, health, and protected-health rejection all satisfy the contract.
- Required GitHub `Deploy SST test` workflow: PASS at `94b2823` under Node 20.17.0 and the restricted OIDC deployer,
  including preflight, preview, synthetic-only deployment, and live verification.
- Private-file cutover verifier: expected `missing_evidence` block — issue #11 has not published import evidence, so
  legacy reads remain safely disabled.

## Deviations and limitations

- Node 20.17.0 is installed but nvm could not activate it because Windows denied the symlink update. Local validation
  used Node 24.13.0; the required GitHub workflow passed under Node 20.17.0.
- SST still emits a Windows-only temporary diagnostic-log path warning locally, but both authenticated preview and
  deployment completed successfully and the live verifier passed.
- The broader disposable two-user browser matrix was not automated in this remediation run. Backend authorization,
  route, facade, conflict, and ownership cases are covered by the passing suites; a human may still perform that
  exploratory acceptance before merge.
- The preferred `agent-browser` CLI was unavailable in the environment. The repository-approved isolated Chromium
  fallback completed the local visual checks instead.
- Full frontend lint/typecheck remain intentionally outside this ticket's cleanup scope; their remaining failures are
  inherited and are materially below the recorded imported-source baseline.

## Remaining gates

1. A human may perform the plan's disposable two-user authenticated browser matrix as exploratory acceptance before
   merge; the automated authorization and live-foundation gates pass.
2. Issue #11 must publish verified import evidence before legacy file reads can be enabled.

## Related

- Implementation issue: `#10`
- Epic: `#1`
- Architecture: `Architecture-AuditFlow-Platform-Migration` in the repository Wiki
