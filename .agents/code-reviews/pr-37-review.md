# PR #37 review — Establish production-readiness gates

**PR:** https://github.com/noamtz/cpa-platform/pull/37

**Reviewed head:** `46c60184228bce2673c368772de7fd1041264100`

**State:** Draft

**Recommendation:** REQUEST CHANGES before marking ready or merging

## Summary

The change establishes a useful fail-closed readiness framework, keeps production and Base44 mutations out of the
ordinary PR path, and adds substantial focused coverage. It is not ready to merge yet. The current test-stage workflow
is red before deployment, the evidence verifier can accept materially incomplete release evidence, the production
workflow has a missing permission, and the generalized production deployer can mutate account-wide shared deployment
resources. Four additional gaps weaken the intended optional-domain, maintenance-availability, browser-parity, and
repository-validation guarantees.

## Issue counts

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 4 |
| Medium | 4 |
| Low | 0 |

## High

1. **AGENT FIXES — staged artifact scanning rejects normal package symlinks and makes CI fail.**
   `tooling/verify_runtime_independence.mjs:43` rejects every symbolic link. The reviewed-head workflow failed on the
   ordinary `.bin/color-support` shim inside the packaged PDF runtime, so PDF bundle verification, test deployment,
   and live verification were skipped. Preserve rejection of traversal and external targets, but resolve and inspect
   symlinks whose real target remains inside the artifact root; add a regression test using a realistic packaged
   `node_modules/.bin` link. No deployment step ran after this failure, so this run did not mutate the test stage.

2. **AGENT FIXES — the production workflow cannot perform its GitHub Environment protection read-back.**
   `.github/workflows/deploy-sst-production.yml:19` grants only `id-token: write` and `contents: read`, while
   `.github/workflows/deploy-sst-production.yml:87` calls the Environment and deployment-branch-policy APIs using the
   workflow token. The existing test workflow grants `actions: read` for the equivalent preflight. Add
   `actions: read` and make the workflow contract assert that permission so preview/prepare cannot fail before AWS
   access for a preventable token-scope omission.

3. **HUMAN DECIDES — the new production deployer inherits account-wide shared-resource mutation.**
   `infra/sst/deployment-policy.ts:463` allows the selected stage role to update every CloudFront KeyValueStore in the
   account, and `infra/sst/deployment-policy.ts:301` lets it delete objects from the shared SST asset namespace without
   a stage boundary. Generalizing this policy to the production OIDC identity violates the promised cross-stage and
   unrelated-application isolation. Choose and document a provider-compatible design that scopes these mutations to
   AuditFlow production resources, or keep production-role enablement blocked until that isolation is possible; do not
   solve it by broadening permissions further.

4. **AGENT FIXES — a signed but materially empty readiness artifact can unlock evidence mode.**
   `tooling/verify_production_readiness.mjs:179` accepts any nonempty list of passing/waived gates, permits empty source
   and artifact digests, and never validates the candidate commit or the exact required gate IDs. The happy-path test at
   `tooling/verify_production_readiness.test.mjs:59` explicitly blesses one arbitrary gate with empty digests. Require
   the exact ten gate IDs, a valid candidate commit SHA, every required source/runtime artifact digest with valid SHA-256
   values, digest read-back, and one-to-one waiver consistency before returning `passed`.

## Medium

1. **HUMAN DECIDES — optional domain configuration is mandatory in the operator path.**
   `.github/workflows/deploy-sst-production.yml:77` requires the production hostname and certificate even for preview,
   while `infra/sst/stage.ts:97` deliberately permits both values to be absent. Production live verification also
   assumes the custom hostname. Either support generated-origin preview/bootstrap when both values are absent or record
   and test an intentional decision that a validated domain is mandatory before every production preview.

2. **AGENT FIXES — a stalled maintenance request leaves the entire application on an infinite spinner.**
   `src/lib/maintenance-status.js:13` has no request deadline, and `src/App.jsx:110` renders only the loading state until
   the promise settles. Use a bounded abort/timeout that resolves to `UNKNOWN`, preserve the backend as the authoritative
   write fence, and test a fetch promise that never settles.

3. **AGENT FIXES — the browser “parity” cases are route smoke tests rather than workflow assertions.**
   `e2e/cpa-workflows.spec.js:25`, `e2e/public-questionnaire.spec.js:27`, and `e2e/pdf-signing.spec.js:22` merely open or
   reload a page and assert that the body is nonempty. They would pass if save/resume, signing persistence, archive/
   restore, template lifecycle, and most J5–J10 actions were broken. Exercise designated disposable state through the
   claimed transitions, assert persisted server-visible results after reload, verify restore/cleanup, and add the
   promised cross-resource negative cases before these IDs count as browser evidence.

4. **AGENT FIXES — the committed diff fails the repository whitespace gate.**
   `.agents/plans/establish-parity-production-readiness-gates.md:78` and
   `.agents/reports/establish-parity-production-readiness-gates-report.md:3` begin eight trailing-whitespace findings
   reported by `git diff --check`. Replace Markdown hard-break spaces with formatting that passes the mandated check and
   rerun it against `origin/main...HEAD`.

## Validation

| Check | Result | Evidence |
| --- | --- | --- |
| Node toolchain | PASS | Node 20.17.0 used for npm/node checks |
| `npm ci` | PASS | 1,070 packages installed; engine warnings and 38 audit findings remain |
| `npm test` | PASS | 15 files, 163 tests |
| `npm run test:foundation` | PASS | 46 files, 379 tests |
| `npm run test:pdf` | PASS | 3 files, 22 tests |
| `npm run test:import` | PASS | 1 file, 10 tests |
| `npm run test:reverse-replay` | PASS | 4 files, 41 tests |
| `npm run typecheck:foundation` | PASS | No diagnostics |
| `npm run lint:foundation` | PASS | Clean |
| `npm run build` | PASS | Vite build completed |
| Test and production foundation contract | PASS | Both exact-stage contract checks completed |
| Frontend runtime-independence scan | PASS | 20 files, zero findings |
| Readiness contract mode | PASS | 17 frontend routes, 47 API routes, 15 journeys |
| Playwright discovery | PASS | 30 cases listed |
| Playwright read-only harness | INCOMPLETE | 24/24 skipped without the private fixture; not acceptance evidence |
| Codex-layer validation | PASS | 31 skills, 6 custom agents |
| `npm run typecheck` | FAIL (known baseline) | 147 diagnostics, zero in PR-changed files; no owner waiver recorded |
| `npm run lint` | FAIL (known baseline) | Two unchanged unused imports; no owner waiver recorded |
| `git diff --check origin/main...HEAD` | FAIL | Eight trailing-whitespace findings |
| GitHub `Deploy SST test` | FAIL | Staged runtime scan rejected an internal package symlink; deploy/live steps skipped |

## Required human routing

### HUMAN READS

- **HUMAN READS — `infra/sst/deployment-policy.ts:463`:** assess the production role’s KVS and shared SST asset
  mutation boundary before any production bootstrap.
- **HUMAN READS — `backend/api/handler.ts:318`:** confirm the public maintenance response exposes only availability
  while the server remains the authoritative fail-closed write fence.
- **HUMAN READS — `tooling/verify_production_readiness.mjs:172`:** scrutinize the evidence verifier because its result
  is intended to gate issue #15.

### HUMAN TESTS

- **HUMAN TESTS — `.github/workflows/deploy-sst-production.yml:82`:** after the permission/domain decisions, verify the
  protected Environment, exact OIDC claims, preview behavior, and refusal of implicit bootstrap.
- **HUMAN TESTS — `.github/workflows/deploy-sst-test.yml:259`:** after symlink handling is fixed, rerun the staged
  runtime/PDF audits and test deployment and confirm live verification is green.
- **HUMAN TESTS — `e2e/support/acceptance-fixture.js:11`:** run the private-fixture desktop/mobile plus explicitly
  confirmed stateful matrix, then verify restoration evidence.

### FYI

- **FYI — `.agents/reports/establish-parity-production-readiness-gates-report.md:36`:** live browser, Sentry, PostHog,
  production preparation, and owner sign-off are explicitly pending. These documented authorization boundaries were
  not treated as defects.
- **FYI — `.agents/reports/establish-parity-production-readiness-gates-report.md:61`:** the root typecheck/lint failures
  match the latest merged report and touch no PR-changed file, but the plan still requires an explicit owner disposition
  before final readiness evidence may pass.
- **FYI — `package-lock.json:1`:** dependency installation reports 38 known audit findings (2 low, 14 moderate, 20 high,
  2 critical) plus two Node-engine warnings; this review did not run a destructive or breaking audit fix.

## What is good

- Production and Base44 mutations are absent from the PR-triggered path; the failed CI run stopped before deployment.
- The production workflow is manual, Environment-bound, confirmation-gated, and forces legacy reads off.
- Maintenance status is intentionally sanitized, and backend tests preserve authentication-before-disclosure behavior.
- Focused foundation, migration, rollback, PDF, runtime, and readiness suites add meaningful regression coverage.
- The placeholder evidence remains `pending`; the implementation does not fabricate owner or live-acceptance results.

## Recommendation

Keep the PR in draft and address all four High findings before another review. Resolve the two HUMAN DECIDES items
explicitly, strengthen the browser evidence, clear the diff check, and rerun the complete Node 20 suite plus the GitHub
test-stage workflow. Once CI is green and the reviewed head is stable, rerun `piv-review-pr 37` before human approval.

## Fix follow-up (2026-09-10)

All eight review findings were addressed in the working branch:

| Finding | Resolution |
| --- | --- |
| Runtime symlinks | Internal, resolvable artifact symlinks are followed; broken and external targets fail closed. A packaged `.bin` regression case passes. |
| Environment API permission | The production workflow now grants `actions: read`, and the readiness contract enforces it. |
| Production deployer boundary | The production policy requires the Router's exact KeyValueStore ARN. Production Lambda asset keys include the AuditFlow production namespace, and S3 access is limited to those exact prefixes. Test logical names remain unchanged to avoid replacing the deployed test functions. |
| Readiness evidence | Evidence must bind to the candidate commit, exact ten gates, complete source/runtime digests with read-back, and one-to-one complete waivers. |
| Optional production domain | Both values may be absent for generated CloudFront bootstrap, or both must match the exact approved domain and certificate shape. Live verification accepts both modes. |
| Maintenance availability | The browser request aborts after five seconds and resolves to `UNKNOWN`; a never-settling fetch regression test passes. |
| Browser evidence | Stateful fixtures now require mutation, post-reload persistence, restore, post-reload restoration, and same-origin cross-resource denial cases. Arbitrary executable fixture actions and external routes are rejected. |
| Whitespace gate | All eight Markdown trailing-space findings were removed; `git diff origin/main --check` passes. |

Post-fix local validation on Node 20.17.0:

- PASS: frontend tests (15 files, 164 tests).
- PASS: foundation tests (47 files, 398 tests), foundation typecheck, and foundation lint.
- PASS: PDF (22), import (10), and reverse-replay (41) tests.
- PASS: Vite build, test/production foundation contracts, frontend runtime scan, readiness contract, Playwright discovery (32 cases), and Codex-layer validation.
- INCOMPLETE: private-fixture browser execution remains an owner-run gate; the local read-only command skipped 24 cases because no private fixture was supplied.
- KNOWN BASELINE FAIL: root typecheck still reports 147 pre-existing frontend diagnostics; none are in the review-fix files.
- KNOWN BASELINE FAIL: root lint still reports the two pre-existing unused imports in `CompletionScreen.jsx` and `UserManagement.jsx`.
- PENDING: GitHub test-stage workflow rerun after push.

No production AWS resource, Base44 application, or Base44 data was accessed or changed while applying these fixes.
