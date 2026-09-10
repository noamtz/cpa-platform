# Feature: Establish parity and production readiness gates

The following plan should be complete, but it is important to validate documentation, codebase patterns, ticket
state, and task sanity before implementation. Pay special attention to the names and locations of existing utilities,
types, contracts, and evidence artifacts. Import from the existing modules rather than creating parallel abstractions.

## Feature Description

Implement issue [#14](https://github.com/noamtz/cpa-platform/issues/14), the final pre-cutover release gate for the
AuditFlow Base44-to-AWS migration. The work proves that the current AWS implementation preserves every reachable
public and CPA workflow evidenced by executable code, contains no external Base44 runtime dependency, still fails
closed for deliberately deferred Google Drive and Telegram behavior, and retains the migration, rollback, PDF,
Sentry, and PostHog guarantees established by issues #7 through #13.

The feature also prepares—but does not cut over—the protected SST `production` stage. It adds an operator-safe
production deployment/preflight path, verifies the existing conversion-aware AWS Budget control, prepares the
external ACM/Box DNS handoff, exposes a user-facing maintenance experience backed by the existing fail-closed
maintenance control, and produces smoke, rollback-threshold, owner-sign-off, and 72-hour observation checklists for
issue #15. Production DNS remains on Base44, AWS does not become the production writer, no final production snapshot
is imported, and Base44 or the legacy Terraform PDF stack is not retired in this issue.

## User Story

As the AuditFlow product owner,
I want one evidence-backed release gate covering parity, migration safety, cost, and operations,
so that I can explicitly approve or reject production cutover without risking current CPA or taxpayer work.

## Problem Statement

The migration slices are implemented and accepted individually, but there is no single current-head gate that proves
their combined behavior. Existing evidence is distributed across unit/contract tests, test-stage verifiers, migration
JSON, runbooks, reports, and owner observations. Some earlier reports still describe gates that later issues completed,
there is no Playwright suite for the actual product routes, the built SST artifacts are not independently audited for
external Base44 dependencies, Sentry and PostHog still have live acceptance gaps, and production has no active SST
deployment workflow or complete external-domain/maintenance/observation runbook.

Without a consolidated and machine-checkable gate, a green build could still omit a reachable journey, rely on stale
migration evidence, ship an external Base44 URL/package, mishandle maintenance, or leave the owner without objective
go/no-go and rollback criteria.

## Solution Statement

Create a versioned readiness contract derived from executable frontend/API routes, a verifier that validates that
contract against current evidence, and a privacy-safe aggregate evidence file that can only reach `passed` after both
automation and owner-supervised checks succeed. Add focused Playwright journeys against the deployed SST test stage,
keeping stateful checks opt-in and bound to designated disposable fixtures. Add a separate runtime-independence audit
over dependency manifests, `dist`, and SST Lambda artifacts while explicitly distinguishing the permitted local
Base44-shaped compatibility seam from forbidden Base44 packages, hosts, storage, agents, connectors, or network calls.

Extend existing stage, deployment-role, workflow, and live-verifier patterns to support a protected manual production
preparation deployment with legacy reads disabled and no data import. Add optional, pair-validated external-domain
configuration and document the owner-controlled ACM/Box sequence without changing traffic DNS. Reuse the existing
DynamoDB maintenance control to serve a public, non-sensitive maintenance-status endpoint and an RTL maintenance page;
the backend remains the authoritative write fence. Finish with a single production-readiness runbook and owner matrix
that link the current migration/replay/PDF evidence, objective rollback thresholds, and issue #15's 72-hour watch.

## Out of Scope / Non-Goals

- Not included: changing Box traffic DNS, importing the final production snapshot/delta, enabling AWS production
  business writes, cancelling Base44, removing the legacy Terraform PDF stack, or executing an actual rollback. Those
  are issue #15 operations and each requires explicit owner authorization.
- Not included: rerunning the issue #11 import or issue #12 Base44 replay against production. Issue #14 validates and
  aggregates their committed privacy-safe evidence; any fresh mutating rehearsal requires separately authorized private
  inputs and scope.
- Not included: functional Google Drive, Telegram, Bedrock/agent, or conversation integrations. Their reachable controls
  must return the controlled `501 Not implemented` contract with no outbound request.
- Not included: renaming the local `base44`-shaped compatibility façade or legacy function URL shapes. The canonical
  architecture deliberately retains those names until after Base44 retirement; the readiness audit targets external
  runtime dependencies and destinations, not harmless compatibility identifiers.
- Not included: multi-tenancy, new CPA features, UI redesign, broad refactoring, dependency modernization, or fixes to
  unchanged pre-existing product defects.
- Not changing: the accepted unmasked Sentry Session Replay configuration, except to verify that it remains intact and
  observable. The owner has already accepted its migration-scope privacy risk.
- Not changing: the current single-writer design. No dual-write path to Base44 may be introduced.

## Feature Metadata

**Feature Type**: New Capability / Release Readiness
**Estimated Complexity**: High
**Primary Systems Affected**: parity/evidence tooling, Playwright acceptance tests, React routing and maintenance UI,
API maintenance status, SST stage/domain/deployment roles, GitHub Actions, runtime artifact audits, migration/PDF/
observability runbooks
**Dependencies**: closed issues #7–#13; Node.js 20.17.0; React 18; Vite 6; Vitest 4; Playwright 1.61.1; SST 3.19.3;
AWS SDK/CLI and owner-authorized AWS access; GitHub protected Environments/OIDC; owner-supplied test fixtures, browser
access, Sentry access, and optionally a PostHog EU public project key

## Related Work

**Implements**: [issue #14 — Establish parity and production readiness gates](https://github.com/noamtz/cpa-platform/issues/14)
**Epic**: [issue #1 — Migrate AuditFlow off Base44 without product change](https://github.com/noamtz/cpa-platform/issues/1) ·
[canonical PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration) ·
[canonical architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references** (decisions and evidence this plan inherits):

- `.agents/plans/preserve-public-questionnaire-persistence-resume.md` and its report - public token, save-queue,
  resume/merge, archived-submission, and template-selection contracts.
- `.agents/plans/implement-private-s3-files-zip-downloads.md` and its report - private S3 ownership, opaque references,
  presigned upload completion, async server-inventoried ZIP behavior, and fail-closed legacy reads.
- `.agents/plans/prove-sst-pdf-generation-signing-parity.md` and
  `docs/migration/pdf-parity-runbook.md` - server-side rendering, browser matrix, same-origin PDF routing, rollback test
  override, and aggregate-only PDF evidence.
- `.agents/plans/complete-cpa-workflow-template-parity.md` and its report - AWS-only CPA façade, transactional workflow,
  template lifecycle, and deferred integration behavior.
- `.agents/plans/import-reconcile-base44-snapshot.md`, `docs/migration/private-file-import-verification.json`, and the
  issue #11 report - manifest-bound test import, exhaustive reconciliation, authorized placeholder/duplicate handling,
  and reversible legacy-reference enablement.
- `.agents/plans/prove-reverse-migration-rollback-replay.md`,
  `docs/migration/base44-reverse-replay-verification.json`, and the issue #12 report - maintenance fencing, exact-range
  reverse replay, interruption/resume, zero-write rerun, zero-drift reconciliation, and fail-closed waived capabilities.
- `.agents/plans/add-privacy-safe-posthog-analytics.md`, `docs/analytics-data-dictionary.md`, and its report - explicit
  privacy-safe events, fixed PostHog EU host, analytics failure isolation, and unchanged Sentry initialization.
- `.agents/plans/establish-sst-serverless-aws-foundation.md` and its report - strict stages, cost guardrail, OIDC,
  permission boundaries, and SST foundation-verifier patterns.

**Forward-references**:

- [issue #15 — cut over production and complete the 72-hour watch](https://github.com/noamtz/cpa-platform/issues/15) -
  consumes the signed readiness evidence, production outputs, DNS handoff, smoke checklist, rollback thresholds, and
  observation checklist produced here.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

#### Product reachability and parity

- `src/App.jsx` (lines 37-92) - Authoritative browser route inventory: public questionnaire/sign routes, CPA routes,
  auth callback, and production-vs-development reachability.
- `src/pages/ClientQuestionnaire.jsx` (lines 37-182, 228-311, 472-558) - Public token load, legacy resume, serialized
  save/conflict behavior, completion, and PDF handoff/return.
- `src/components/questionnaire/QuestionStep.jsx` (lines 51-156, 214-514) and `src/api/file-client.js` (lines 73-188) -
  conditional questions, client uploads, progress/errors, CPA uploads, template mirroring, and signed file access.
- `src/pages/PdfSignIframeOverlay.jsx` (lines 104-128, 259-346, 423-576) - Server-rendered page overlays, field/signature
  alignment, Sentry capture, PDF generation, upload, persistence, return, and resume.
- `src/pages/CpaDashboard.jsx` (lines 31-93), `src/components/dashboard/ClientRow.jsx` (lines 135-214, 424-617,
  654-805, 839-868), and `src/pages/ClientsPage.jsx` (lines 23-61) - Portfolio, client links/tokens, files/ZIPs, status,
  archive/restore, conflict, and orphan-repair workflows.
- `src/pages/CpaFillQuestionnaire.jsx` (lines 38-239, 273-405) - CPA-assisted answer editing, PDF exemption, signing
  records, and audit-trail behavior.
- `src/pages/QuestionnaireSettings.jsx` (lines 8-57), `src/components/dashboard/QuestionnaireEditor.jsx`
  (lines 30-77, 572-745), and `src/components/dashboard/VersionHistory.jsx` (lines 16-171) - Questionnaire template
  lifecycle, versioning, ordering, conditions, disabled steps, and historical versions.
- `src/pages/PdfTemplateEditor.jsx` (lines 43-70, 429-574) - PDF-template create/edit/archive and private base-file flow.
- `src/components/dashboard/TeamSection.jsx` (lines 16-51), `src/pages/UserManagement.jsx` (lines 12-55), and
  `src/pages/Settings.jsx` (lines 21-78, 111-218) - Invitation, reachable user route, and visible deferred controls.
- `docs/user-journeys/04-user-journeys.md` and `docs/user-journeys/05-traceability-ledger.md` - Discovery evidence only;
  both must be reconciled with current executable AWS behavior rather than treated as the parity boundary.
- `docs/user-journeys/06-coverage-gaps.md` (lines 169-181) - Historical claim of no API/Lambda/E2E tests; update it to
  reflect the now-substantial backend suite while preserving the still-real frontend E2E gap.

#### Existing test patterns

- `src/lib/__tests__/questionnaire-template.test.js`, `questionnaire-steps.test.js`, `questionnaire-start.test.js`,
  `questionnaire-save-queue.test.js`, `submission-compat.test.js`, and `cpa-fill.test.js` - Vitest characterization style
  for legacy data, questionnaire rules, serialized writes, and CPA fill.
- `backend/api/__tests__/public-questionnaire-routes.test.ts` and `public-questionnaire-service.test.ts`
  (approximately lines 75-660) - Public token/resource ownership, stale revision, conflict, and negative authorization.
- `backend/api/__tests__/files-routes.test.ts`, `files-service.test.ts`, and `zip-download.test.ts`
  (approximately lines 98-987) - Private-object ownership, unresolved/foreign references, async ZIP, leases, and errors.
- `backend/api/__tests__/core-cpa-routes.test.ts` (lines 124-205) and
  `cpa-workflow-{routes,service}.test.ts` (approximately lines 57-314) - JWT/role checks and transactional CPA workflow.
- `backend/api/__tests__/maintenance-service.test.ts` (lines 27-212) - Fail-closed maintenance state, stable 503,
  read/health availability, and authentication-before-maintenance-disclosure.
- `backend/api/__tests__/deferred-integrations.test.ts` (lines 52-94) - Existing Drive `501`/no-`fetch` pattern; extend
  this table-driven to all four deferred routes and negative payload/auth cases.
- `vitest.foundation.config.js` (lines 3-16) - Node-environment foundation test include/exclude conventions.
- `package.json` (scripts lines 7-34; dependencies/devDependencies) - Node version, complete validation entry points,
  already-installed Playwright, pinned SST/AWS/PDF dependencies, and no Base44 package.

#### AWS compatibility and runtime independence

- `src/api/base44Client.js` (lines 1-29) - Permitted local AWS-backed compatibility seam and unreachable agent stubs;
  do not mistake its legacy-shaped name for an external dependency.
- `src/api/aws-client.js` (lines 15-160) - Actual AWS HTTP destinations, controlled Drive routes, and connector methods.
- `src/api/function-client.js` - Same-origin legacy function-shape adapter with no Base44 network destination.
- `backend/api/routes/deferred-integrations.ts` (lines 20-53) - Exact authenticated `501` body for Drive/Telegram.
- `infra/sst/contracts.ts` (lines 157-455, 570-592) and `infra/sst/foundation-contract.json` (routes lines 20-66,
  deployment gate lines 162-178) - Canonical API/deployment route inventory, evidence binding, cost threshold, and
  same-origin contracts.
- `tooling/verify_sst_foundation.mjs` (contract mode around lines 80-359; deployer mode 564-630; live mode 647-1600) -
  Fail-fast verifier style, aggregate output shape, AWS CLI read-back, CloudFront/site/API/PDF/auth tests, and current
  test-only assumptions to parameterize safely.
- `.github/workflows/deploy-sst-test.yml` (lines 84-249) - OIDC claim preflight, protected enablement, Node setup,
  validation, SST diff/artifact creation, PDF bundle audit, deploy, and live-verifier ordering.

#### Production, maintenance, cost, and operations

- `sst.config.ts` (lines 3-112) - Strict stage loading, ignored production env, resource composition, and output keys.
- `infra/sst/stage.ts` (lines 1-99) - `test`/`production` parsing, `protect`, retain policy, log retention, operator USD/
  ILS conversion, and hard ILS 50 ceiling.
- `infra/sst/cost.ts` (lines 4-34) and `infra/sst/contracts.ts` (lines 584-592) - Retained, alert-only production AWS
  Budget at the existing 80% actual threshold; no automatic shutdown.
- `infra/sst/__tests__/stage.test.ts` (lines 10-101) and `contracts.test.ts` (around lines 479-492) - Existing USD 10 /
  ILS conversion and cost-contract test patterns.
- `infra/sst/application.ts` (lines 15-53, 55-237) - Router, API, site, PDF, auth environment, same-origin routing, and
  production restriction on PDF override; custom-domain support plugs in here.
- `infra/sst/auth.ts` (lines 43-61) - Managed-login prefix and callback/logout derived from the router URL; custom-domain
  preparation must preserve this relation.
- `infra/sst/deployment-role.ts` (lines 8-79) and `deployment-policy.ts` (lines 19-45, 103-533) - Current test-only OIDC
  role/policy and workload boundary; parameterize by exact stage instead of copying a weaker production policy.
- `backend/api/contracts/maintenance.ts` (lines 14-101), `backend/api/services/maintenance.ts` (lines 77-174,
  340-557), and `backend/api/handler.ts` (lines 113-334) - Existing authoritative maintenance state, fences, route
  classification, auth ordering, close/replay/abort/terminal transitions.
- `.env.example` (lines 11-15), `README.md` (lines 63-116), and
  `.agents/references/auditflow-aws-operations.md` (lines 17-38) - Ignored operator configuration, production preview /
  deploy authority boundaries, stage-not-found behavior, and validation order.
- `.github/workflows/deploy-lambda-prod.yml` and `rollback-prod.yml` - Disabled Terraform-era evidence only; retain their
  `github.repository == 'noamtz/auditflow'` guards and do not repurpose them for SST.

#### Migration, rollback, PDF, and observability evidence

- `docs/migration/private-file-import-verification.json` - Aggregate issue #11 result: 366 records, 687 references,
  zero unresolved items, and all reconciliation gates true. Validate schema/status/hash, never embed private inputs.
- `docs/migration/base44-rehearsal-summary.{md,json}` - Export inventory and file/hash reconciliation context.
- `docs/migration/base44-import-runbook.md` (lines 3-51, 95-165) - Private input handling, authorized commands, evidence
  generation, protected legacy-read enable/disable, and production prohibitions.
- `docs/migration/base44-reverse-replay-verification.json` - Aggregate issue #12 result: exact isolated-test range,
  interruption/resume, zero-write rerun, zero drift, terminal rollback, and production untouched.
- `docs/migration/base44-rollback-replay-runbook.md` (lines 1-16, 101-127, 129-238) - Exact maintenance/replay boundary,
  owner waivers, fail-closed residuals, and issue #15's exclusive DNS/actual rollback responsibility.
- `docs/migration/pdf-parity-runbook.md` (lines 8-44, 48-115) and `pdf-parity-evidence.json` - Local/live PDF commands,
  same-origin/rollback endpoints, browser matrix, aggregate evidence, and historical Sentry-unavailable result.
- `src/instrument.js` (lines 1-25) and `src/main.jsx` (lines 1-14) - Sentry must initialize first and retain accepted
  tracing/replay configuration.
- `src/lib/analytics.js` (lines 1-30, 100-199), `src/lib/__tests__/analytics.test.js` (lines 33-310), and
  `docs/analytics-data-dictionary.md` (lines 3-35, 91-126) - PostHog EU fixed-host/no-op/privacy/failure-isolation
  contract and permitted event envelope.
- `.agents/reports/add-privacy-safe-posthog-analytics-report.md` (lines 78-99) and
  `.agents/reports/prove-sst-pdf-generation-signing-parity-report.md` (lines 122-134) - Explicit unresolved live PostHog
  and Sentry observations; never infer them from source tests.

### New Files to Create

- `tooling/production-readiness-contract.json` - Versioned route/journey/gate inventory derived from executable code,
  with automation, owner-check, evidence, negative-case, dev-only, and dormant classifications.
- `tooling/verify_production_readiness.mjs` - Contract/evidence verifier that composes current tests, aggregate migration
  artifacts, runtime audit, browser evidence, cost/domain/maintenance checks, waivers, and owner sign-off.
- `tooling/verify_production_readiness.test.mjs` - Fixture-driven pass/fail tests for missing journeys, stale hashes,
  privacy leaks, unresolved gates, invalid waivers, and premature owner sign-off.
- `tooling/verify_runtime_independence.mjs` - Deterministic scan of manifests, `dist`, and SST Lambda artifacts for
  forbidden Base44 packages/imports/hosts/storage/runtime destinations, with explicit migration-only exclusions.
- `tooling/verify_runtime_independence.test.mjs` - Positive/negative artifact fixtures, archive traversal, allowlist, and
  false-positive tests for the local compatibility façade and operator-only migration tooling.
- `playwright.config.js` - Test-stage-only browser configuration with no implicit web server or production fallback.
- `e2e/support/acceptance-fixture.js` - Strict parser for private owner-supplied base URL, CPA storage state, public token,
  synthetic record IDs, write opt-in, and cleanup/restore contract.
- `e2e/public-questionnaire.spec.js` - Public load, legacy resume, conditional steps, upload, completion, refresh, and
  invalid/foreign/stale/archived token/resource cases.
- `e2e/cpa-workflows.spec.js` - Login/session, portfolio, client/submission, status, CPA-fill, archive/restore, files/ZIP,
  questionnaire templates, PDF templates, user/invitation, `/users`, and 404 route checks.
- `e2e/pdf-signing.spec.js` - Browser-level render, Hebrew/mixed fields, checkbox, mouse/touch signature, generation,
  private upload, save, return, refresh/resume, and reopen checks.
- `e2e/permissions-deferred-maintenance.spec.js` - Anonymous/direct-route denial, cross-resource permission failures,
  all Drive/Telegram `501` controls/no external traffic, unreachable agent surface, and maintenance UI/write fencing.
- `src/pages/Maintenance.jsx` - Minimal RTL maintenance page preserving product styling and no business data.
- `src/lib/maintenance-status.js` - Same-origin, non-sensitive maintenance-status client and response parser.
- `src/lib/__tests__/maintenance-status.test.js` - Parser/network/error/fail-safe tests using current frontend test style.
- `docs/migration/production-readiness-runbook.md` - Canonical issue #14 operator sequence: prerequisites, generated-endpoint
  smoke, cost read-back, ACM/Box handoff, Cognito users, maintenance, Sentry/PostHog, owner sign-off, rollback thresholds,
  and issue #15/72-hour handoff.
- `docs/migration/production-readiness-evidence.json` - Aggregate-only, schema-versioned result with no URLs containing
  tokens, account IDs, emails, raw IDs, responses, filenames, analytics envelopes, Sentry replay data, or credentials.
- `.github/workflows/deploy-sst-production.yml` - Protected, manual-only SST production preparation workflow with explicit
  preview/prepare operation, exact OIDC claims, legacy reads forced off, full preflight, artifact audit, and live read-back.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [SST custom domains — manual setup](https://sst.dev/docs/custom-domains#manual-setup)
  - Specific section: external DNS, `dns: false`, supplied ACM certificate, and CloudFront certificate region.
  - Why: Box remains authoritative DNS and must not be given to SST or CI; CloudFront certificates must be prepared in
    `us-east-1` while application data remains in `il-central-1`.
- [SST custom domains — how it works](https://sst.dev/docs/custom-domains#how-it-works)
  - Specific section: certificate ownership validation followed by traffic routing.
  - Why: separates harmless certificate-validation preparation from the issue #15 traffic cutover.
- [SST Router](https://sst.dev/docs/component/aws/router/)
  - Specific section: `domain`, `routes`, and `url` outputs.
  - Why: the existing same-origin Router is the only permitted domain seam.
- [AWS Budgets — managing costs](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
  - Specific section: fixed monthly budgets, actual/forecast notifications, and delayed billing data.
  - Why: the USD alert is an early warning, not a hard ILS cap or automatic shutdown.
- [AWS Budgets best practices — update frequency](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-best-practices.html#understanding-the-aws-budgets-update-frequency)
  - Specific section: at-least-daily updates and notification limitations.
  - Why: the runbook needs a separate owner observation cadence and conservative FX buffer.
- [AWS bill summary and currency](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/getting-viewing-bill.html#aws-bill-summary)
  - Specific section: pending USD spend and separately displayed invoice currency.
  - Why: record the operator-reviewed ILS/USD rate, date, source, and USD threshold; do not claim AWS enforces ILS 50.
- [CloudFront distribution status](https://docs.aws.amazon.com/cloudfront/latest/APIReference/API_Distribution.html#cloudfront-Type-Distribution-Status)
  and [AWS CLI distribution waiter](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/get-started-cli-tutorial.html#cli-deploy-distribution)
  - Specific section: wait until status is `Deployed` before smoke tests.
  - Why: prevents propagation delay from being misclassified as application failure.
- [API Gateway invoking an HTTP API](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-call-api.html#how-to-call-api-invoke)
  - Specific section: invoke deployed endpoints and distinguish public from authenticated calls.
  - Why: generated endpoint smoke must precede any custom-domain traffic switch.
- [GitHub Actions OIDC in AWS](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
  - Specific sections: `sub` trust condition, Environment subject, `id-token: write`, and short-lived credential exchange.
  - Why: production uses a distinct protected Environment/role and must match the repository's immutable claim syntax.
- [Playwright projects](https://playwright.dev/docs/test-projects),
  [authentication](https://playwright.dev/docs/auth), and [test retries](https://playwright.dev/docs/test-retries)
  - Specific sections: desktop/mobile projects, private storage state, and trace-on-first-retry.
  - Why: automate representative test-stage journeys without committing credentials or treating retries as a pass over
    nondeterministic product failures.

### Patterns to Follow

**Naming conventions:**

- Product React pages use PascalCase under `src/pages/`; small shared frontend clients use kebab-case under `src/lib/`.
- Backend and SST TypeScript modules use kebab-case filenames, named exports, `readonly` types, and Zod at boundaries.
- Tooling verifiers use `verify_<subject>.mjs`, expose pure helpers for Vitest, fail fast with stable machine-readable
  codes, and print aggregate JSON only.
- Evidence/runbook files use kebab-case under `docs/migration/`; no private snapshot, token, email, signed URL, raw
  record ID, endpoint secret, or detailed finding belongs in committed evidence.

**Error handling:**

Mirror the existing stable API shape instead of inventing a readiness-only error envelope:

```ts
return jsonResponse(501, {
  error: "Not implemented",
  code: "FEATURE_NOT_IMPLEMENTED",
  feature,
});
```

Maintenance stays a `503` business-write fence. Public maintenance status may reveal only a boolean/mode safe for all
users; protected requests must still authenticate before any maintenance disclosure. Verifiers throw on a failed
assertion and emit a non-zero process exit; they never downgrade a missing gate to a warning unless the evidence carries
an explicit owner waiver allowed by the contract.

**Logging and evidence:**

- Follow `tooling/verify_sst_foundation.mjs`: output mode, stage, named statuses, bounded counts, and booleans—not request
  bodies, auth headers, query strings, tokens, business values, URLs with secrets, or raw records.
- Hash build artifacts and source evidence with SHA-256 so a sign-off cannot silently apply to a later build.
- Sentry/PostHog checks record only observation window, environment, aggregate event/error outcome, and verdict. Do not
  store replay content, analytics payloads, pseudonymous IDs, project keys, or user/record identifiers.
- A waiver needs gate ID, exact scope, owner, date, reason, expiry/next action, and confirmation that it does not relax
  security, migration reconciliation, or rollback fail-closed behavior.

**Route inventory and parity:**

- Generate the readiness contract from current `src/App.jsx` and `infra/sst/contracts.ts` inventories, then manually map
  each reachable journey to automated and owner checks. Documentation is never allowed to remove a code-reachable route.
- Classify routes as `public`, `cpa`, `auth-callback`, `dev-only`, or `dormant`. Production sign-off covers every public,
  CPA, and auth-callback route. Dev-only POCs receive a build/development smoke classification; dormant
  `SubmissionReadinessChat` remains absent from production and must not create an agent backend.
- Each state-changing Playwright check uses only a designated disposable test-stage fixture, takes a before snapshot,
  restores the supported state when possible, and records cleanup. It never targets production or imports private data.

**Infrastructure and authorization:**

- Parameterize the existing deployment policy/role by exact stage and tags. Do not duplicate the test policy or grant
  broad `Resource: "*"` permissions merely to make production deployment succeed.
- Production workflow is manual-only, uses `environment: production`, exact OIDC `aud`/`sub` checks, Node 20.17.0,
  `AUDITFLOW_ENABLE_LEGACY_FILE_READS=false`, no snapshot/import/replay command, and an explicit operation/confirmation.
- Treat `sst diff` as preview only. If the production stage does not yet exist, `Stage not found` does not authorize
  deployment. The first owner-authenticated bootstrap and the protected prepare deployment are distinct reviewed steps.
- The configured USD budget remains conversion-aware and below ILS 50 using an operator rate. It is an alert, not an
  enforced shutdown. Preserve the standing USD 10/month target unless the owner explicitly changes it.

---

## IMPLEMENTATION PLAN

### Phase 1: Freeze the readiness contract and close automated evidence gaps

Build the code-derived journey/gate inventory first. Add deterministic verification for external Base44 independence,
deferred integrations, and committed migration/replay evidence before introducing browser or production operations.

**Tasks:**

- Define all current browser/API journeys and acceptance gates in one versioned machine-readable contract.
- Add runtime-manifest/build/Lambda artifact auditing with explicit migration-only exclusions.
- Expand Drive/Telegram `501`, no-outbound, invalid-input, and auth regression coverage.
- Validate issue #11/#12 aggregate evidence, waiver boundaries, and current source hashes without touching private data.
- Reconcile stale user-journey/coverage documentation with current executable AWS behavior.

### Phase 2: Add test-stage browser parity and maintenance UX

**Depends on:** Phase 1 (the browser specs must trace to stable journey and gate IDs)

Add a strict Playwright harness and close the frontend E2E gap. Expose only non-sensitive maintenance state, display a
minimal RTL maintenance page, and prove the backend remains the authoritative write fence.

**Tasks:**

- Parse private test-stage fixture inputs and refuse production hosts or unapproved writes.
- Cover public, CPA, PDF, negative-permission, legacy-data, deferred-control, error, and maintenance flows.
- Keep actual device/in-app-browser, Sentry, and PostHog observations as explicit owner checks where automation cannot
  faithfully substitute.
- Add frontend/backend tests for maintenance loading, failure behavior, 503 handling, and auth-before-disclosure.

### Phase 3: Prepare protected production infrastructure and operations

**Depends on:** Phase 1 (artifact/readiness checks gate any production preparation)
**Independent of:** Phase 2 implementation; the code changes may be developed in parallel, but no production prepare
operation may run until Phase 2 automation and owner prerequisites are ready.

Parameterize the existing least-privilege deployment path for `production`, add optional external-domain configuration,
and create a manual protected workflow. Reuse the cost guardrail and extend read-back verification; do not import data,
enable writes/legacy reads, or alter DNS.

**Tasks:**

- Add exact production Environment/OIDC role and stage-tagged least-privilege policy support.
- Add pair-validated external hostname/certificate configuration while preserving generated-url preparation when no
  validated certificate is supplied.
- Generalize deployer/live foundation verification for the protected production stage, including CloudFront `Deployed`,
  private origins, Cognito callbacks, budget existence/threshold/subscriber, log retention, and legacy reads disabled.
- Add a manual preview/prepare workflow; bootstrap and prepare execution remain owner-authorized external actions.

### Phase 4: Consolidate runbooks, execute acceptance, and bind owner sign-off

**Depends on:** Phases 1-3

Create the single operational runbook/evidence schema, execute all automated and owner-supervised gates on the exact
candidate commit/artifacts, and record a binary readiness verdict. A `pending`, stale, waived-security, or unsigned
result blocks issue #15.

**Tasks:**

- Document the exact generated-endpoint smoke order, ACM/Box records, Cognito user procedure, maintenance communication,
  Sentry/PostHog checks, rollback thresholds, and 72-hour observation handoff.
- Run the full Node 20.17.0 suite and compare any root type/lint findings with the current accepted baseline; obtain an
  explicit owner waiver rather than claiming green when they remain.
- Run read-only and designated-fixture test-stage checks, browser/device matrix, production preparation/read-back, and
  runtime artifact scans.
- Hash and aggregate the final evidence, obtain explicit owner parity sign-off, and hand issue #15 an unambiguous
  go/no-go result without changing traffic DNS.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable. External AWS,
GitHub Environment, PostHog, Sentry, ACM, or Box actions require the explicit owner scope stated in the task; local code
changes and read-only checks do not authorize them.

### Task 1: CREATE `tooling/production-readiness-contract.json`

- **IMPLEMENT**: Add a schema-versioned inventory of all `src/App.jsx` routes and `infra/sst/contracts.ts` API surfaces,
  grouped into public questionnaire, public PDF signing, CPA auth/session, dashboard/client/submission, files/ZIP,
  CPA-fill, questionnaire templates, PDF templates, user/invitation, settings/deferred integrations, maintenance/error,
  migration/replay, PDF/Sentry, PostHog, cost/domain, and owner-signoff gates. Each item must carry a stable ID, source
  location, reachability class, positive cases, negative cases, legacy-data requirement, automation evidence IDs,
  owner-check IDs, and waiver policy.
- **PATTERN**: Mirror `infra/sst/foundation-contract.json:1-208` for deterministic JSON and
  `docs/user-journeys/05-traceability-ledger.md` for source-to-behavior mapping, but correct the ledger from current code.
- **IMPORTS**: None; this is data consumed by the verifier and browser tests.
- **GOTCHA**: Do not include dev-only POCs in production parity totals, and do not omit `/users`, `/pdf-templates`,
  `/auth/callback`, `/questionnaire/sign`, or unknown-route behavior simply because older journey docs omit them.
- **VALIDATE**: `node -e "JSON.parse(require('node:fs').readFileSync('tooling/production-readiness-contract.json','utf8')); console.log('readiness contract JSON valid')"`
- **SATISFIES**: AC #1, #2, #5, #9.

### Task 2: CREATE `tooling/verify_runtime_independence.mjs` and its test

- **IMPLEMENT**: Scan `package.json`, `package-lock.json`, `dist/**`, and every staged application/PDF/worker Lambda
  artifact under `.sst/artifacts` (including archive entries) for forbidden Base44 package IDs, import specifiers,
  external hostnames/API origins, SDK bootstrap code, agent/connector transports, and Base44 storage destinations. Emit
  paths, SHA-256 hashes, counts, allowlist classifications, and `passed` without dumping file contents. Reject symlink/
  path traversal, unreadable archives, empty scan sets, and an artifact set that omits a required runtime.
- **PATTERN**: Export pure helpers and a CLI like `tooling/verify_pdf_bundle.mjs` and
  `tooling/verify_private_file_cutover.mjs`; use stable failures and fixture-driven Vitest coverage.
- **IMPORTS**: Node built-ins only where possible (`fs`, `path`, `crypto`, archive reader already available through
  existing dependencies if required). Do not add a general scanner dependency.
- **GOTCHA**: Permit the local `src/api/base44Client.js` compatibility name and legacy URL-shaped same-origin route
  labels. Exclude `base44/`, `docs/`, source manifests, and import/export/replay/rollback tooling only by explicit
  repository-root allowlist. The scan passes because there is no external dependency/destination, not because every
  occurrence of the word `base44` is ignored.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/verify_runtime_independence.test.mjs`
- **SATISFIES**: AC #3, #9.

### Task 3: UPDATE deferred integration and compatibility tests

- **IMPLEMENT**: Make `backend/api/__tests__/deferred-integrations.test.ts` table-driven across Drive sync/connect/
  disconnect and Telegram notify. Assert exact authenticated `501` JSON, valid legacy payload handling, malformed body
  `400`, anonymous/invalid-scope denial before handler disclosure, and zero `fetch`/SDK/outbound calls. Extend
  `src/api/__tests__/aws-client.test.js` and `base44-client.test.js` to prove the visible compatibility calls route only
  to same-origin AWS endpoints, propagate the controlled error, and keep agent methods local/unreachable.
- **PATTERN**: `backend/api/routes/deferred-integrations.ts:20-53` and existing tests at lines 52-94.
- **IMPORTS**: Existing Vitest helpers and handler/client factories only.
- **GOTCHA**: `SubmissionReadinessChat` is dormant and must remain absent from the production route/component graph; do
  not build a replacement agent backend. A `501` is the accepted behavior, not a test failure.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/deferred-integrations.test.ts && npx vitest run src/api/__tests__/aws-client.test.js src/api/__tests__/base44-client.test.js`
- **SATISFIES**: AC #3, #5, #9.

### Task 4: CREATE `tooling/verify_production_readiness.mjs` and its test

- **IMPLEMENT**: Add `contract` mode to validate the readiness contract against current frontend/API route inventories,
  required evidence schemas, and package scripts; add `evidence` mode to validate exact candidate commit/artifact hashes,
  all required automated/owner results, allowed waivers, production budget/domain/maintenance read-back, and explicit
  owner sign-off. Validate issue #11 totals/gates/hash and issue #12 test-only/exact-range/interruption/zero-write/
  zero-drift/production-untouched facts. Treat invitation-login and private probe-deletion waivers as rehearsal-only and
  continue to require fail-closed real replay semantics.
- **PATTERN**: Mirror argument parsing/assertions and aggregate JSON from `tooling/verify_sst_foundation.mjs:61-89,
  1546-1618`; mirror manifest/evidence hash binding from `tooling/verify_private_file_cutover.mjs`.
- **IMPORTS**: Node built-ins, `production-readiness-contract.json`, and exported pure helpers from the runtime verifier.
- **GOTCHA**: Historical reports that say issue #11 evidence is missing are superseded by the merged issue #11 artifact.
  Validate current files rather than editing history. A stale artifact, missing owner check, unknown waiver, or evidence
  carrying sensitive fields must fail closed. Do not run import/replay commands from the verifier.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js tooling/verify_production_readiness.test.mjs && node tooling/verify_production_readiness.mjs --mode contract`
- **SATISFIES**: AC #1, #2, #4, #5, #6, #7, #8, #9, #10.

### Task 5: UPDATE journey documentation from executable code

- **IMPLEMENT**: Update `docs/user-journeys/04-user-journeys.md`, `05-traceability-ledger.md`, and
  `06-coverage-gaps.md` to reflect AWS-backed current behavior, all reachable routes, new backend/PDF/migration tests,
  deferred Drive/Telegram controls, dev-only POCs, dormant agent UI, and the remaining browser/owner gaps. Link stable
  readiness-contract IDs instead of duplicating acceptance verdicts.
- **PATTERN**: Preserve the existing journey/step/trace tables and executable-code-first rule.
- **IMPORTS**: None.
- **GOTCHA**: Do not rewrite historical Base44 evidence out of the ledger; label it as provenance and add current target
  evidence. Do not claim E2E/Sentry/PostHog coverage before those gates run.
- **VALIDATE**: `node tooling/verify_production_readiness.mjs --mode contract && python tooling/validate_codex_layer.py`
- **SATISFIES**: AC #1, #9.

### Task 6: CREATE the Playwright acceptance harness

- **IMPLEMENT**: Add `playwright.config.js` and `e2e/support/acceptance-fixture.js`. Require an explicit HTTPS test-stage
  base URL, private storage-state path, public token/fixture descriptor, exact expected stage, and a separate stateful-
  write confirmation. Reject `app.ddcpa.co.il`, production SST outputs, inline credentials, missing cleanup metadata,
  unrecognized fixture schema, and accidental fallback to localhost/production. Configure desktop Chromium, desktop
  Edge when installed, and mobile Chrome emulation; retain trace/screenshot/video only on failure and scrub URLs/tokens
  before any retained artifact.
- **PATTERN**: Follow Node argument/schema validation in existing tooling and React/Vitest no-secret practices; use
  Playwright storage state from an ignored owner path, never repository fixtures.
- **IMPORTS**: Existing `playwright` dependency only; do not add browser automation libraries.
- **GOTCHA**: Playwright emulation is not proof of actual WhatsApp/WKWebView behavior. Browser retries expose flakes and
  do not convert a first-attempt product failure into an unconditional pass. No web server should start implicitly.
- **VALIDATE**: `npx playwright test --list`
- **SATISFIES**: AC #1, #5, #9.

### Task 7: CREATE public, CPA, PDF, permission, deferred, and maintenance E2E specs

- **IMPLEMENT**: Create the four planned spec files and tag every test with readiness-contract IDs. Cover the public
  questionnaire and uploads; legacy JSON/flat resume; invalid/foreign/stale/archived resource denial; auth callback,
  anonymous direct CPA navigation, and session; dashboard/client/submission/status/CPA-fill/archive/restore; private
  file/ZIP ownership; questionnaire/PDF-template lifecycles; user/invitation route; all deferred controls; unknown route;
  maintenance page and blocked mutation; and full PDF render/sign/upload/save/resume/reopen. Use network assertions to
  prove there is no request to Base44, Google, Telegram, or non-EU PostHog hosts.
- **PATTERN**: Mirror the behavior asserted by the linked Vitest/backend tests and the exact manual PDF action chain in
  `docs/migration/pdf-parity-runbook.md:100-115`.
- **IMPORTS**: Playwright test/expect, the fixture parser, and small page helpers local to `e2e/support/` only when shared.
- **GOTCHA**: State-changing cases require designated synthetic test data and restore evidence. Do not mutate imported
  legacy business records merely to prove UI actions. Invitations that send email and irreversible file deletion need
  explicit owner-approved disposable targets or a recorded allowed waiver; security/ownership cases cannot be waived.
- **VALIDATE**: `npx playwright test --list && npx playwright test --grep "@readonly"`
- **SATISFIES**: AC #1, #3, #5, #8, #9.

### Task 8: ADD public maintenance status and RTL maintenance page

- **IMPLEMENT**: Add a read-only public maintenance-status route backed by `MaintenanceService.getControl()`, returning
  only stable non-sensitive availability state. Register it in `infra/sst/contracts.ts` and the foundation contract.
  Add `src/lib/maintenance-status.js`, `src/pages/Maintenance.jsx`, and an app-level gate that shows the maintenance page
  when the backend is not `OPEN`; health and authorized read-only APIs remain available, while the existing backend
  `503` fence remains authoritative for every mutation. Handle transition/race/network failure without leaking control
  generation, cursors, manifest hashes, or replay state.
- **PATTERN**: Reuse `backend/api/services/maintenance.ts:77-95` for state reading,
  `backend/api/__tests__/maintenance-service.test.ts:171-212` for route/auth ordering, and existing page RTL tokens from
  `src/index.css`/`src/App.jsx`.
- **IMPORTS**: Existing router, `jsonResponse`, `MaintenanceService`, React hooks/components, and no new dependency.
- **GOTCHA**: Do not make the browser gate the write lock. Missing/corrupt maintenance control must remain fail-closed
  for writes. Decide and test the UI's network-failure state explicitly so a transient status request cannot create a
  data-loss path or endless redirect. Avoid polling that materially increases the cost floor.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js backend/api/__tests__/maintenance-service.test.ts && npx vitest run src/lib/__tests__/maintenance-status.test.js && npm run typecheck:foundation`
- **SATISFIES**: AC #5, #7, #8, #9.

### Task 9: UPDATE production stage/domain/deployment contracts and tests

- **IMPLEMENT**: Extend `StageSettings` with optional production custom-domain settings parsed only when hostname and
  ACM certificate ARN are supplied together. Validate exact `app.ddcpa.co.il`, no URL/userinfo/path/query, and a
  `us-east-1` ACM certificate ARN. Pass stage settings to `createApplicationRouter`, preserving the generated URL when
  absent and using SST `{ domain: { name, dns: false, cert } }` when present. Keep Cognito callback/logout derived from
  the final router URL. Add safe outputs needed for runbook read-back without outputting secrets.
- **PATTERN**: `infra/sst/stage.ts:42-81` fail-closed production budget parsing,
  `application.ts:19-53` production-only PDF override validation, and SST manual external-domain documentation.
- **IMPORTS**: Existing SST globals/types only.
- **GOTCHA**: A certificate validation record and the final CloudFront traffic record are different steps. This task
  configures capability and instructions; it does not alter Box DNS. Do not require Box credentials, create Route 53,
  or silently use a regional certificate for CloudFront.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js infra/sst/__tests__/stage.test.ts infra/sst/__tests__/contracts.test.ts && npm run typecheck:foundation`
- **SATISFIES**: AC #6, #7, #9.

### Task 10: REFACTOR deployment role/policy for exact `test` and `production` stages

- **IMPLEMENT**: Rename/generalize `createTestDeploymentRole` and `buildTestDeploymentPolicy` so both strict stages use
  stage-specific names, tags, OIDC Environment subjects, state prefixes, permissions boundaries, and least-privilege
  resource patterns. Add a production subject/role contract, preserve the separate test legacy-read-enablement subject,
  prohibit cross-stage resource/state mutation, and expose the selected deploy role ARN in outputs. Expand policy tests
  for cross-stage denial, self-mutation denial, pass-role restriction, and exact immutable GitHub subject syntax.
- **PATTERN**: Preserve `infra/sst/deployment-role.ts:31-76`, `deployment-policy.ts:27-45, 486-531`, and existing policy
  simulation tests; parameterize rather than copy.
- **IMPORTS**: Existing AWS/SST IAM constructs and contract types.
- **GOTCHA**: The initial production role/boundary creation is an owner-authenticated bootstrap, not something the role
  can grant itself. Verify the current repository/environment OIDC claim before freezing the subject. Never broaden
  permissions to unrelated production resources or the legacy Terraform PDF stack.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js infra/sst/__tests__/deployment-policy.test.ts infra/sst/__tests__/contracts.test.ts infra/sst/__tests__/verify-sst-foundation.test.js`
- **SATISFIES**: AC #2, #6, #7, #9.

### Task 11: UPDATE production budget and live-foundation read-back without changing its ceiling

- **IMPLEMENT**: Extend foundation verification to support `--stage production` in deployer/live modes while retaining
  test-specific legacy-read and enablement checks. In production live mode verify protected/retained resources,
  CloudFront `Deployed`, private origins, exact auth callbacks, no legacy reads, no test PDF override, production log
  retention, and the named AWS Budget's USD amount, 80% actual alert, recipient count, and no automatic actions. Add an
  evidence field for operator rate/date/source and converted ILS amount; fail above ILS 50.
- **PATTERN**: `infra/sst/cost.ts:4-34`, `stage.ts:42-81`, and `tooling/verify_sst_foundation.mjs:647-1600`.
- **IMPORTS**: Existing AWS CLI wrapper and contract JSON; no cost-estimation service dependency.
- **GOTCHA**: AWS billing data is delayed and normally reported in USD. The verifier proves configuration/read-back,
  not a hard ILS cap or a complete month of actual cost. Never print the alert email. Preserve the standing USD 10
  target unless owner direction changes it, and refresh the ignored ILS/USD rate before every preview/deploy.
- **VALIDATE**: `npx vitest run --config vitest.foundation.config.js infra/sst/__tests__/verify-sst-foundation.test.js infra/sst/__tests__/stage.test.ts && node tooling/verify_sst_foundation.mjs --mode contract --stage production`
- **SATISFIES**: AC #2, #6, #7, #9.

### Task 12: CREATE `.github/workflows/deploy-sst-production.yml`

- **IMPLEMENT**: Add manual `workflow_dispatch` only, with `preview` and explicitly confirmed `prepare` operations. Use
  protected `production` Environment, `id-token: write`/`contents: read`, exact OIDC `aud`/`sub` preflight, Node 20.17.0,
  ignored/Environment-supplied budget/domain values, legacy reads forced false, full tests/build/contract/runtime scans,
  deployer verification, SST diff when an existing stage permits it, artifact scan, and prepare deploy only after the
  owner confirmation. After prepare, wait for CloudFront and run production live read-back and non-mutating health/
  auth/PDF smoke. Upload only scrubbed aggregate evidence.
- **PATTERN**: `.github/workflows/deploy-sst-test.yml:84-249`; do not copy the disabled legacy PDF production workflow.
- **IMPORTS**: `actions/checkout@v4`, `actions/setup-node@v4`, `aws-actions/configure-aws-credentials@v4`, and existing
  repository commands.
- **GOTCHA**: No automatic push/PR production deployment. No import, replay, Base44, Box DNS, production business write,
  or Terraform command. `Stage not found` is expected before initial bootstrap and must not trigger an implicit deploy.
  The owner-authenticated bootstrap/read-back must happen before relying on GitHub OIDC.
- **VALIDATE**: `python tooling/validate_codex_layer.py && node tooling/verify_production_readiness.mjs --mode contract`
- **SATISFIES**: AC #2, #3, #6, #7, #9.

### Task 13: UPDATE test workflow and package entry points

- **IMPLEMENT**: Add scripts for runtime audit, readiness contract/evidence verification, and Playwright read-only/full
  suites. Include new tooling in `lint:foundation`. Update `.github/workflows/deploy-sst-test.yml` path filters, run the
  frontend scan immediately after `npm run build`, scan `.sst/artifacts` after `sst diff`, and run readiness contract
  verification before deploy. Keep authenticated/stateful browser acceptance manual unless owner-protected fixture
  secrets are deliberately configured.
- **PATTERN**: Existing `test:pdf`, `test:reverse-replay`, bundle verifier, and workflow ordering at lines 218-249.
- **IMPORTS**: No new package required; Playwright is already pinned.
- **GOTCHA**: Do not commit browser binaries, storage state, fixture descriptors, `.sst`, `dist`, or raw workflow output.
  A PR contract run must remain non-mutating; only the existing authorized main/test deployment path mutates test.
- **VALIDATE**: `npm ci && npm run test:foundation && npm run typecheck:foundation && npm run lint:foundation && npm run build && npm run verify:runtime-independence -- --frontend dist && npm run verify:readiness -- --mode contract`
- **SATISFIES**: AC #2, #3, #9.

### Task 14: CREATE the production readiness runbook and evidence schema

- **IMPLEMENT**: Write `docs/migration/production-readiness-runbook.md` in exact go/no-go order: dependency/evidence
  freshness; Node/full-suite gate; runtime artifacts; test-stage legacy enabled/disabled behavior; generated endpoint;
  public/CPA/negative/legacy/PDF/browser checks; PostHog absent/configured/blocked-network checks; Sentry observation;
  production budget/config/OIDC bootstrap/prepare/read-back; external ACM validation and Box record worksheet; Cognito
  two-user temporary-password procedure; maintenance communications/page/fence/quiescence; smoke checklist; objective
  rollback triggers; owner sign-off; issue #15 DNS handoff; and 0h/1h/6h/12h/24h/48h/72h observation cadence. Define the
  aggregate evidence JSON fields and privacy denylist.
- **PATTERN**: Reuse commands and safety language from `base44-import-runbook.md`,
  `base44-rollback-replay-runbook.md`, and `pdf-parity-runbook.md`; link rather than duplicate private instructions.
- **IMPORTS**: None.
- **GOTCHA**: Make clear that ACM validation DNS, final traffic DNS, production data import, rollback replay, and Base44
  retirement are separate owner decisions. Objective rollback triggers include any data/reconciliation gap, unknown
  critical/high regression, auth/link/token failure, cross-resource access, write/journal failure, PDF/sign/resume
  failure, unobservable production errors, or cost trajectory beyond the approved ceiling. Analytics-only failure is
  non-blocking to product writes but blocks analytics acceptance until waived/fixed.
- **VALIDATE**: `node tooling/verify_production_readiness.mjs --mode contract && python tooling/validate_codex_layer.py`
- **SATISFIES**: AC #1, #4, #5, #6, #7, #8, #10.

### Task 15: EXECUTE automated current-head and artifact validation

- **IMPLEMENT**: On Node 20.17.0 run the complete root/foundation/PDF/import/replay/readiness suites, build, SST contract
  verifier, runtime scan, and `git diff --check`. Record exact commit and artifact digests. Compare root type/lint output
  with the current accepted baseline; either fix migration regressions in issue scope or record an explicit owner waiver
  for unchanged baseline findings. Do not describe historical failures as current without rerunning.
- **PATTERN**: AGENTS.md validation contract and the execution sections of issues #11-#13 reports.
- **IMPORTS**: None.
- **GOTCHA**: Prior reports used different snapshots and sometimes Node 24. Only this exact candidate's Node 20.17.0
  output counts. Local success does not authorize AWS/Base44/DNS actions.
- **VALIDATE**: `npm ci && npm test && npm run typecheck && npm run lint && npm run build && npm run test:pdf && npm run test:import && npm run test:reverse-replay && npm run test:foundation && npm run typecheck:foundation && npm run lint:foundation && npm run verify:runtime-independence -- --frontend dist && npm run verify:readiness -- --mode contract && python tooling/validate_codex_layer.py && git diff --check`
- **SATISFIES**: AC #2, #3, #4, #9.

### Task 16: EXECUTE owner-authorized test-stage parity and observability acceptance

- **IMPLEMENT**: Against the exact deployed SST test candidate, validate live foundation with manifest-bound legacy reads
  in the owner-selected state, run read-only Playwright first, then stateful designated-fixture tests. Complete the manual
  browser matrix on current desktop Chrome and Edge plus Android Chrome/touch and the actually reachable WhatsApp/
  in-app-browser path or explicit scoped waiver. For PDF, complete Hebrew/mixed numeric fields, checkbox, mouse/touch
  signature, generate/upload/save/return/refresh/resume/reopen and visual placement. Inspect Sentry in the exact window;
  test PostHog with blank key, configured EU key, and blocked EU network while proving product behavior is unchanged.
- **PATTERN**: `docs/migration/pdf-parity-runbook.md:100-115` and the manual acceptance section of the PostHog plan.
- **IMPORTS**: Private owner fixture/storage-state paths and public PostHog project key supplied outside the repository.
- **GOTCHA**: Do not infer Sentry from source configuration or PostHog from unit tests. Do not retain replay/payloads.
  An unavailable external console must be recorded as unavailable and blocks that gate unless the owner explicitly
  waives only the observation—not security, persistence, or parity.
- **VALIDATE**: `npx playwright test --grep "@readonly" && npx playwright test --grep "@stateful" && node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json`
- **SATISFIES**: AC #1, #3, #5, #8, #10.

### Task 17: EXECUTE owner-authorized protected production preparation

- **IMPLEMENT**: Verify the production GitHub Environment and immutable OIDC claim; use the owner-authenticated bootstrap
  path to create/read back the production deployment role/boundary when required; refresh the ignored ILS/USD rate;
  review the production contract/diff; then manually dispatch only the confirmed `prepare` operation. Deploy protected,
  retained, empty production infrastructure with legacy reads disabled, no snapshot/import, and no traffic DNS. Wait for
  CloudFront `Deployed`; verify generated site/API/PDF/auth health, private origins, budget alert/subscriber, log retention,
  and no business data/writes. Record exact generated DNS target and ACM/Box instructions privately for owner review.
- **PATTERN**: Test-stage bootstrap/deployer/live sequence in README and `deploy-sst-test.yml`, adapted to production.
- **IMPORTS**: Owner-authorized AWS/GitHub access and ignored production configuration.
- **GOTCHA**: This is an external AWS mutation and must not be run merely because the code is merged. Do not add/change
  Box traffic records, import production data, create CPA business records, enable legacy reads, or touch Terraform.
  If certificate validation requires a Box record, stop at the reviewed instruction unless the owner separately
  authorizes that exact non-traffic DNS change.
- **VALIDATE**: `node tooling/verify_sst_foundation.mjs --mode deployer --stage production && node tooling/verify_sst_foundation.mjs --mode live --stage production --outputs .sst/outputs.json && npm run verify:runtime-independence -- --frontend dist --artifacts .sst/artifacts`
- **SATISFIES**: AC #3, #5, #6, #7, #9.

### Task 18: FINALIZE aggregate evidence and obtain explicit owner sign-off

- **IMPLEMENT**: Populate `docs/migration/production-readiness-evidence.json` only from scrubbed results, bind it to the
  candidate commit/runtime/migration/replay hashes, record every gate and allowed waiver, and have the owner record an
  explicit signed/date-stamped `go` or `no-go` verdict. Run evidence mode. Update the issue #14 implementation report and
  hand issue #15 only a `passed`/owner-approved artifact plus the runbook; do not perform cutover in this task.
- **PATTERN**: Aggregate-only evidence conventions in issue #11/#12 JSON and the GitHub repository-backed artifact
  contract.
- **IMPORTS**: Scrubbed outputs from Tasks 15-17; no raw browser, AWS, Sentry, PostHog, or private fixture exports.
- **GOTCHA**: A machine-generated pass without owner sign-off is not readiness. Any stale digest, open critical/high
  regression, unexplained data gap, unauthorized waiver, or unsigned checklist results in `no-go`. Do not post the plan
  or private evidence to a duplicate GitHub issue.
- **VALIDATE**: `node tooling/verify_production_readiness.mjs --mode evidence --evidence docs/migration/production-readiness-evidence.json && git diff --check`
- **SATISFIES**: AC #1-#10.

---

## TESTING STRATEGY

### Unit Tests

- Readiness verifier: malformed schema, missing/extra route, missing negative case, stale source/evidence hash, unexpected
  waiver, rehearsal-only waiver escaping its scope, sensitive-field denylist, unsigned owner verdict, and exact happy
  path.
- Runtime verifier: forbidden dependency/import/URL in manifest, minified frontend bundle, and Lambda archive; missing
  artifact; traversal/symlink; explicit documentation/migration exclusions; harmless local compatibility symbols.
- Deferred integrations: all four routes, exact 501 body, malformed input, anonymous/invalid-scope caller, and no fetch.
- Maintenance: missing/corrupt/open/maintenance/rolled-back control, non-sensitive status response, auth ordering, 503
  mutation fence, read/health availability, UI parser/network failure, and page rendering.
- SST: exact stages, paired domain config, hostname/cert rejection, generated URL fallback, callback/logout derivation,
  production/test OIDC subjects, cross-stage IAM denial, budget conversion/threshold, and production output contract.

### Integration Tests

- Current foundation suite continues to exercise API route registration, auth/resource ownership, DynamoDB journal/fence,
  files, ZIP worker, templates, PDF Lambda, migration, and reverse replay.
- Readiness contract test imports/parses current route definitions and proves every reachable code path has at least one
  automation or required owner-check mapping plus negative/security coverage where applicable.
- Production workflow/static contract test proves manual-only trigger, protected Environment, exact permissions, forced
  legacy-off state, absence of import/replay/DNS/Terraform commands, artifact scan ordering, and explicit prepare guard.
- Runtime scan runs twice: after Vite `dist` and after SST packages `.sst/artifacts`.

### Browser / End-to-End Tests

- Read-only suite may run broadly and must be safe against the deployed test stage.
- Stateful suite requires explicit fixture/write confirmation and restores designated synthetic state.
- Desktop Chromium and Edge cover the CPA/public baseline; mobile Chrome emulation covers layout/touch automation.
- Actual Android Chrome and reachable WhatsApp/in-app browser remain owner-supervised checks, because emulation cannot
  prove OS/browser integration.
- Capture a failure trace only; scrub token-bearing URLs and do not commit it. A browser console/network error related
  to the app, API, PDF, auth, or storage fails the relevant gate.

### Manual / Owner-Supervised Tests

- Exact supported-device PDF matrix and visual placement.
- Sentry project/replay/error observation for a controlled safe failure and successful flow.
- PostHog blank/configured/blocked-network observation in the EU project.
- Production GitHub Environment/OIDC, AWS Budget subscription, ACM/Box worksheet, Cognito two-user procedure, and
  generated endpoint smoke.
- Explicit review of all waivers, rollback thresholds, and the final binary sign-off.

### Edge Cases

- Missing/malformed/expired/wrong client token; foreign client/submission/template/file; archived/stale revision;
  unresolved legacy reference; missing S3 object; ZIP pending/failure/expired result.
- Questionnaire simultaneous start, save queue ordering, refresh during save, JSON-string and flat legacy answers,
  disabled/conditional steps, template version drift, submission-archived conflict.
- Anonymous CPA deep links, expired OAuth session, invalid scope/role, callback error, invited user temporary-password
  setup, and auth-before-maintenance disclosure.
- PDF malformed template, multipage RTL/numeric fields, checkbox off/on, mouse/touch signature, render/generate timeout,
  upload failure, persist failure, refresh/resume, and legacy-test rollback endpoint only in test.
- Maintenance status missing/corrupt/transitioning, outstanding upload/ZIP/invitation intent, last-issued upload grace
  window, and mutation racing maintenance close.
- Runtime string false positives in documentation/source evidence vs real package/host/import inside a minified bundle or
  archive; absent runtime artifact; archive traversal.
- AWS Budget data delay, missing subscriber verification, stale or optimistic FX rate, stage not found, CloudFront not
  yet `Deployed`, invalid/wrong-region ACM certificate, and incomplete Box record worksheet.
- PostHog key absent, SDK blocked, EU endpoint blocked, analytics exception, and accidental non-EU/PII envelope.
- Sentry sampling makes success inconclusive; controlled error must still appear or receive an explicit narrow waiver.

---

## VALIDATION COMMANDS

Run with Node.js **20.17.0**. Commands that contact AWS, GitHub, PostHog, Sentry, or a deployed test stage require the
owner-authorized context described above. Do not run production deploy/DNS/data commands as part of ordinary local
validation.

### Level 1: Syntax & Style

```powershell
node --version
npm ci
npm run typecheck:foundation
npm run lint:foundation
npm run typecheck
npm run lint
git diff --check
python tooling/validate_codex_layer.py
```

Expected Node output is `v20.17.0`. Root typecheck/lint must either pass or be compared line-for-line with the current
accepted baseline and explicitly waived by the owner; no new finding is allowed.

### Level 2: Unit Tests

```powershell
npm test
npm run test:pdf
npm run test:import
npm run test:reverse-replay
npm run test:foundation
```

### Level 3: Build, Contracts, and Artifact Audits

```powershell
npm run build
node tooling/verify_sst_foundation.mjs --mode contract --stage test
node tooling/verify_sst_foundation.mjs --mode contract --stage production
npm run verify:runtime-independence -- --frontend dist
npm run verify:readiness -- --mode contract
npm run sst:diff:test
npm run verify:pdf-bundle -- --artifacts .sst/artifacts --function PdfRendererFunction
npm run verify:runtime-independence -- --frontend dist --artifacts .sst/artifacts
```

### Level 4: Authorized Test-Stage and Browser Validation

```powershell
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json
npx playwright test --grep "@readonly"
npx playwright test --grep "@stateful"
```

Also run the existing PDF parity profiles with owner-supplied test endpoints/fixtures, then complete the actual-device,
Sentry, and PostHog sections in the runbook. Do not place endpoint tokens or private fixture paths in committed command
logs/evidence.

### Level 5: Separately Authorized Production Preparation

```powershell
node tooling/verify_sst_foundation.mjs --mode deployer --stage production
node tooling/verify_sst_foundation.mjs --mode live --stage production --outputs .sst/outputs.json
npm run verify:runtime-independence -- --frontend dist --artifacts .sst/artifacts
node tooling/verify_production_readiness.mjs --mode evidence --evidence docs/migration/production-readiness-evidence.json
```

The actual first bootstrap/deploy occurs only through the reviewed operator/workflow sequence. There is intentionally no
Box DNS, import, Base44, rollback, or Terraform command in this validation list.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1 — Exhaustive executable-code parity:** every production-reachable public, CPA, and auth-callback route and
  workflow derived from current code has positive, negative, legacy-data, automated, and/or required owner evidence;
  dev-only and dormant paths are explicitly classified rather than silently omitted.
- [ ] **AC #2 — Candidate validation:** Node 20.17.0 root/foundation/PDF/import/replay tests and builds pass; typecheck,
  lint, deployment smoke, and Codex-layer validation pass or carry an explicit scoped owner waiver for unchanged
  baseline findings. There are zero new failures.
- [ ] **AC #3 — Runtime independence:** dependency manifests, `dist`, and all SST Lambda artifacts contain no Base44 SDK,
  package import, external runtime/API/storage destination, agent transport, or connector transport. The permitted local
  compatibility seam is classified and all deferred controls make no external call.
- [ ] **AC #4 — Migration and rollback evidence:** issue #11 import/reconciliation and issue #12 isolated reverse replay
  artifacts validate against their schemas/hashes with zero unexplained record/file/reference/drift gap, exact-range and
  interruption/resume/zero-write facts true, production untouched, and rehearsal-only waivers contained.
- [ ] **AC #5 — Test-stage readiness:** file upload/read/ZIP, PDF render/sign/save/resume, Cognito auth, same-origin routes,
  public/CPA permission failures, legacy imported data, maintenance behavior, and observable error paths pass automated
  and owner-supervised test-stage checks.
- [ ] **AC #6 — Cost gate:** the protected production stage has an alert-only AWS Budget using the reviewed USD threshold,
  configured subscriber, and dated operator ILS/USD rate; converted limit is at or below ILS 50 and the runbook states
  that delayed AWS billing data makes this an early warning rather than a hard cap.
- [ ] **AC #7 — Production preparation:** protected/retained empty SST production resources, exact OIDC Environment/role,
  generated endpoints, private origins, log retention, optional external-domain contract, ACM/Box instructions, Cognito
  procedure, maintenance controls, and smoke checklist are complete and read back. Legacy reads remain disabled, no
  production data is imported, and DNS still points to Base44.
- [ ] **AC #8 — Browser and observability:** representative desktop/mobile PDF and workflow checks pass; Sentry is observed
  in an exact window or narrowly waived; PostHog absent/configured/blocked-network checks prove privacy-safe EU-only and
  non-blocking behavior; no raw telemetry or sensitive evidence is committed.
- [ ] **AC #9 — Project consistency:** new code follows existing React/TypeScript/tooling/SST patterns, all tasks are
  traceable to readiness-contract IDs, docs reflect current AWS behavior, and legacy/provenance/runbook safety boundaries
  remain intact.
- [ ] **AC #10 — Owner decision:** the aggregate evidence binds the exact candidate commit/artifacts and includes the
  owner's explicit dated `go`/`no-go`. Only a fully passing, signed `go` may unlock issue #15; issue #14 itself performs
  no traffic cutover, production business write, final import, actual rollback, or Base44 retirement.

---

## COMPLETION CHECKLIST

- [ ] All implementation tasks completed in dependency order.
- [ ] Readiness contract accounts for every current executable route and journey.
- [ ] Each task's focused validation passed immediately after the change.
- [ ] Full Node 20.17.0 root/foundation/PDF/import/replay suite executed.
- [ ] Typecheck/lint findings are zero-new and either green or explicitly owner-waived against the current baseline.
- [ ] Vite and every SST runtime artifact passed the external Base44 independence audit.
- [ ] Test-stage read-only and designated-fixture browser suites passed.
- [ ] Actual-device PDF, Sentry, and PostHog owner checks are recorded without sensitive data.
- [ ] Issue #11/#12 aggregate evidence validates and rehearsal waivers remain fail-closed for real replay.
- [ ] Protected production prepare deployment/read-back completed only with explicit owner authorization.
- [ ] AWS Budget subscriber and conversion-aware ILS ceiling are read back.
- [ ] ACM/Box DNS worksheet, Cognito procedure, maintenance communication, smoke, rollback thresholds, and 72-hour
  checklist reviewed.
- [ ] Aggregate evidence is privacy-safe, hash-bound, current, and verifier-passing.
- [ ] Owner issued an explicit dated readiness verdict.
- [ ] No Box traffic DNS, final import, production business write, Terraform mutation, actual rollback, or Base44
  retirement occurred.
- [ ] Plan and implementation report remain repository-backed; no duplicate plan issue was created.

---

## OPEN QUESTIONS / ASSUMPTIONS

### Critical owner inputs required before execution reaches external/manual gates

1. **Production AWS/GitHub identity:** confirm the exact production GitHub Environment protection rules, immutable OIDC
   `sub`, production deploy-role name/account, and who approves the owner-authenticated bootstrap. The implementation
   must inspect actual claims rather than copy a guessed subject.
2. **Box/ACM sequence:** confirm whether a suitable `us-east-1` ACM certificate already exists and whether adding its
   validation CNAME before cutover is allowed. If no DNS change of any kind is allowed in #14, prepare the code/worksheet
   and leave certificate validation/domain activation to issue #15; do not substitute Route 53.
3. **Cost inputs:** refresh the ignored ILS/USD rate, its source/date, AWS account reporting/payment currency, and budget
   recipient immediately before production preview/deploy. Standing assumption: keep the USD 10 monthly budget target,
   which must still convert below ILS 50 at the reviewed rate.
4. **Acceptance fixtures:** identify disposable test-stage client/submission/template/PDF/file records and the private CPA
   browser storage-state procedure. Imported legacy business rows should be read/verified, not modified for testing.
5. **Browser support:** confirm whether Edge is required alongside Chrome and which WhatsApp/in-app-browser path current
   taxpayers actually use. Actual-device evidence or an explicit narrow owner waiver is required for any reachable path.
6. **Observability access:** provide owner access and observation windows for Sentry, plus explicit consent and a public
   PostHog EU project key if live analytics acceptance is required. Blank-key and blocked-network checks remain mandatory.
7. **Invitation/file-delete waiver:** decide whether issue #14 repeats disposable live invitation/login and file deletion
   checks. The issue #12 owner waivers are valid only for the isolated rehearsal; real rollback stays fail-closed for
   unobservable invitation or deletion operations.

### Assumptions embedded in this plan

- Issues #7 through #13 remain closed/accepted and their current committed evidence is the starting point; any source or
  schema drift discovered by the verifier reopens the relevant gate.
- Production preparation may create protected empty AWS resources and an AWS Budget after explicit owner authorization,
  while Box traffic DNS remains on Base44 and no production business data/write is introduced.
- The local Base44-shaped compatibility façade and legacy route names are intentionally retained per architecture; zero
  runtime dependency means zero external Base44 package/host/transport/storage use.
- Root typecheck/lint may retain known imported-source baseline findings. The acceptance rule is zero new findings plus
  explicit owner disposition, not a false statement that historical main is entirely clean.
- The 72-hour clock begins only after issue #15 changes production traffic DNS, not after issue #14's empty-stage
  preparation. Issue #14 prepares the checklist and thresholds but cannot complete that observation window.

No unresolved question above requires reopening the canonical architecture. They affect operator values, authorization,
and the final evidence sequence; the implementation must stop before the corresponding external action if the owner has
not supplied the answer.

## NOTES (open canvas)

### Gate composition

```text
Executable routes + API contracts
        │
        ├── current unit/foundation/import/replay/PDF tests
        ├── Vite + SST artifact independence scan
        ├── test-stage Playwright + negative/legacy checks
        ├── actual-device PDF + Sentry + PostHog observation
        └── protected production config/budget/domain/maintenance read-back
                              │
                              ▼
             hash-bound aggregate readiness evidence
                              │
                     explicit owner go/no-go
                              │
                    issue #15 cutover only
```

This structure prevents three common category errors: treating old issue reports as proof of the current build, treating
an internal compatibility name as an external runtime dependency, and treating infrastructure preparation as authority
to change DNS or production data.

### Evidence freshness and stale historical text

Earlier #9/#10 reports correctly recorded that issue #11 evidence was missing at their execution time. Do not rewrite
those historical reports. The readiness verifier should use the later committed issue #11 artifact and current AGENTS
status as the present source of truth, while the production-readiness runbook can explicitly state that the old blocker
was superseded. Likewise, the issue #13 implementation is source-complete but its report explicitly says live PostHog
acceptance was not run; that remains a real #14 gate.

### Cost interpretation

The standing product target is AWS hosting at or below ILS 50/month. Current code models a USD monthly budget and an
operator-provided ILS/USD rate because AWS budget telemetry is not a real-time ILS hard limit. Keep the USD 10 target,
verify its conversion at execution time, alert before the ceiling, and review actual/forecast spend during issue #15's
watch. Do not add an automatic shutdown that could take the customer offline.

### Rollback threshold ownership

The readiness runbook should be decisive: any unexplained data/reconciliation gap, cross-resource access, broken public
token/link, journal/write failure, PDF/sign/resume failure, or new critical/high regression is an automatic no-go or
rollback trigger. Analytics failure alone must never block a business write, but missing required live analytics/Sentry
acceptance remains an unresolved readiness gate until fixed or explicitly waived by the owner. Actual maintenance,
reverse replay, reconciliation, and DNS restoration remain issue #15 actions.

## AMENDMENTS

(None at creation.)
