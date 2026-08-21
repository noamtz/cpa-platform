# Feature: Establish the SST serverless AWS foundation

**Mandatory execution precondition:** before `piv-implement` creates a branch, changes files, or calls a mutating AWS/GitHub API, it must complete the consolidated handoff gate below. Ask the owner once for every approval, authenticated session, and external value the run can need; validate them together; then continue without routine approval pauses. Never ask the owner to paste a password, access key, session token, OIDC token, or SSO cache into chat or a repository file.

After that gate passes, the implementation agent must revalidate the ticket, Wiki architecture, installed SST v3 types, AWS account identity, and GitHub OIDC claim before changing or deploying resources. This plan establishes the compatibility platform only; it does not replace a working Base44 path or touch the Terraform-managed PDF service.

## Feature Description

Create the minimal, independently deployable SST v3 foundation for AuditFlow in explicit `test` and `production` stages. The foundation serves the existing Vite build through a CloudFront-backed SST Router, forwards same-origin `/api/*` traffic to one modular Node.js Lambda behind API Gateway HTTP API, provisions the six legacy entity tables plus `ChangeJournal`, creates private file and temporary-output buckets, and creates a Cognito user pool/client with a JWT-authorized API route. A new test-only GitHub Actions workflow assumes a repository-scoped AWS role through the account's existing GitHub OIDC provider, deploys the named `test` stage, and validates the live health route and resource inventory.

Production is defined but not deployed by this ticket. Production configuration is protected and retains stateful resources, with explicit DynamoDB and Cognito deletion protection. The existing Base44 runtime, `app.ddcpa.co.il`, PDF Lambda, Terraform state, and legacy PDF workflows remain operational and unchanged.

## User Story

As the AuditFlow product owner, I want a low-cost, protected AWS application foundation so that later compatibility services can be implemented and rehearsed without changing the production product or paying for always-on compute.

## Problem Statement

The imported repository contains the authoritative React application and a separate Terraform-managed PDF API, but it has no target-platform application infrastructure. Later migration slices need stable resource names, keys, links, routing, authentication, and deployment contracts. Creating those piecemeal would risk incompatible table keys, cross-origin behavior, excess permissions, accidental production deletion, or collision with the existing PDF stack.

## Solution Statement

Pin the latest published SST v3 release, `3.19.3`, in both the lockfile and SST app config; split the infrastructure into small TypeScript modules with a pure resource contract; and expose a single orchestration point through root `sst.config.ts`. Use usage-priced AWS resources in `il-central-1`, attach the existing Vite build and API to one SST Router, and route `/api` to API Gateway with an explicit prefix rewrite. Link all state resources to one API Lambda, configure a Cognito JWT authorizer, and add public and protected health routes.

Use the existing account-level GitHub OIDC provider without importing or recreating it. Create a separate test deploy role scoped to the `noamtz/cpa-platform` GitHub Environment subject, store its ARN and stage values outside source control, and require a one-time owner-authenticated bootstrap deployment before CI assumes the role. Validate both the declared contract and deployed AWS settings. Production receives stage protection, retention, table/user-pool deletion protection, and an externally configured cost alert, but no production deploy, DNS, or cutover occurs.

## Out of Scope / Non-Goals

- Not included: replacing `src/api/base44Client.js`, removing Base44 packages/plugins, or implementing entity/auth compatibility behavior; defer to #6 and #7.
- Not included: presigned upload/download, ZIP generation, or object ownership behavior; defer to #8. The file buckets remain private and browser CORS stays disabled until that contract is implemented.
- Not included: packaging or routing `lambda/pdf-generator/` through SST; defer to #9.
- Not included: exporting Base44 data (#5), importing/reconciling data (#11), or implementing ChangeJournal writes/replay (#6/#12).
- Not included: creating CPA users, the managed-login UI/domain, PKCE session handling, or changing frontend authentication UX; defer to #6.
- Not included: deploying the `production` SST stage, attaching `app.ddcpa.co.il`, provisioning/validating the external ACM certificate, changing Box.co.il DNS, or cutting over traffic; defer to #15.
- Not included: changing, importing, deleting, or adopting any resource under `infra/{test,prod}/`, `lambda/pdf-generator/`, or the three imported PDF workflows.
- Not changing: visible UI, route composition, public questionnaire behavior, Sentry behavior, legacy data field names/stringified JSON, or the current production writer.
- Not adding: VPC, NAT gateway, RDS, containers, provisioned concurrency, OpenSearch, or other always-on infrastructure.

## Feature Metadata

**Feature Type**: New capability / infrastructure foundation

**Estimated Complexity**: High

**Primary Systems Affected**: SST configuration, API Lambda skeleton, DynamoDB, S3, Cognito, CloudFront/Router, API Gateway HTTP API, IAM/OIDC, GitHub Actions, Node validation

**Dependencies**: Accepted Issue #3 baseline; Node 20.17.0; npm lockfile; SST 3.19.3; TypeScript 5.8; AWS account/region access; existing account GitHub OIDC provider; GitHub Environment `test`; AWS CLI for live verification

## Related Work

**Implements**: [Issue #4](https://github.com/noamtz/cpa-platform/issues/4) · **Epic**: [Issue #1](https://github.com/noamtz/cpa-platform/issues/1) · [Canonical architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- `.agents/plans/import-auditflow-production-source-baseline.md` - Issue #3 plan whose accepted baseline unblocks this ticket.
- `.agents/reports/import-auditflow-production-source-baseline-report.md` - confirms the imported source and validation baseline.
- [PRD — AuditFlow Platform Migration](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration) - fixes the minimal-change, parity, cost, and deadline constraints.
- [Architecture — AuditFlow Platform Migration](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration) - selects the SST v3 serverless compatibility layer and its security/data/operations boundaries.

**Forward-references**:

- #6 consumes the Cognito, API Lambda, Client/Submission/User tables, and ChangeJournal contracts.
- #7 consumes public routing plus Client/Submission/QuestionnaireTemplate storage.
- #8 consumes the private file and temporary-output buckets.
- #9 adds the existing PDF function to SST without changing the Terraform endpoint.
- #11 consumes all six entity tables and private file bucket for rehearsal import/reconciliation.
- #12 consumes the ordered `ChangeJournal` key contract.

---

## PRE-IMPLEMENTATION AUTHORIZATION AND ACCESS GATE

This gate runs before all implementation phases and tasks. It collects the owner's interaction in one bounded handoff, proves that the session can finish, and avoids serial prompts during a long run. The agent receives an authenticated capability and explicit scope—not raw credential material.

### Single consolidated owner handoff

If the current conversation does not already contain every item below, ask for all missing items in one message and wait once:

1. **Bounded authorization:** permission to create/update only the Issue #4 SST `test` stage, its named AWS foundation resources, the separate least-privilege GitHub OIDC deploy role, the GitHub `test` Environment/variables/branch policies, test health requests, and a production *preview/diff only*. The authorization excludes production deployment, DNS/domain/certificate changes, Terraform/PDF changes, Base44 cutover/removal, stage removal, resource deletion, and destructive replacement.
2. **AWS authenticated session:** the owner supplies only a named AWS CLI profile (recommended name `auditflow-deploy`) and completes `aws sso login --profile auditflow-deploy` locally. The owner configures the session for the expected run and sets the profile's deployment region to `il-central-1`. Never request or accept static keys in chat.
3. **AWS target confirmation:** the owner confirms that the profile targets the intended AuditFlow AWS account. Compare caller identity to repository evidence without printing or persisting the account ID or ARN. Account mismatch is a hard stop.
4. **GitHub authority:** permission to use `python tooling/github.py ...` through the required `noamtz` identity to verify or configure Environment `test`, its branch policies, and the non-secret deploy-role ARN after bootstrap.
5. **Production-preview inputs:** the owner places the budget-alert recipient and positive USD threshold in an ignored local configuration source and supplies only its path/name. The preview threshold must be below the ILS 50/month ceiling at execution time. Do not put the recipient or other sensitive values in chat, Git, logs, SST outputs, or the implementation report.
6. **One-run availability:** the owner confirms the SSO session will remain usable for the expected execution window. If the window is insufficient, do not begin implementation; aggregate this with every other missing prerequisite.

Use this authorization wording when the owner asks for a copyable approval:

> I authorize implementation of Issue #4 to create or update only the AuditFlow SST `test` stage and its issue-scoped AWS resources, the least-privilege GitHub OIDC deploy role, and the GitHub `test` Environment configuration. I authorize test-stage deployment and verification plus production diff/preview only. I do not authorize production deployment, DNS/domain/certificate changes, Terraform/PDF changes, Base44 cutover/removal, resource deletion, or destructive replacement. Continue without further approval for non-destructive actions inside this scope; stop on account mismatch, expired/denied access, scope drift, or a destructive action.

### Gate validation and continuation rule

- Verify the feature-branch/worktree prerequisite before invoking `piv-implement`: the base branch must not contain unresolved user changes. Preserve the existing `.codex/agents/*.toml` edits; never stash, commit, or move them without owner direction.
- Verify the AWS profile through `aws sts get-caller-identity`, explicit `il-central-1` configuration, OIDC-provider list/get access, and expected provider ownership in `infra/prod/main.tf`. Capture only pass/fail state.
- Verify `python tooling/github.py auth status` selects `noamtz`; verify Environment `test` and the `main` plus `feat/issue-4-*` branch policies. Create/update them only when the consolidated authorization permits and they are missing or incorrect.
- Verify the ignored production-preview configuration exists and can be parsed without echoing values.
- Report every missing item together. Do not start partial implementation and later ask for a predictable prerequisite.
- Once all checks pass, record a sanitized readiness result in the implementation report and continue through every in-scope, non-destructive task without another approval request. A failed safety check, expired/denied session, destructive replacement, or scope expansion still requires a stop; advance authorization cannot waive those safeguards.

**Current observed state (2026-08-14):** GitHub CLI authentication through `tooling/github.py` selects `noamtz`. GitHub Environment `test` now exists with custom deployment policies for `main` and `feat/issue-4-*`. AWS CLI is installed, but no authenticated AWS identity was available during planning; its default region was `us-east-1`, so the future run must use the explicit named profile and `il-central-1` rather than ambient defaults.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: READ BEFORE IMPLEMENTING

- `AGENTS.md` lines 9-45, 51-64 - architecture map, target platform, source integrity, parity, Git identity, and required validation.
- `.agents/references/auditflow-rewrite-target.md` lines 1-10 - accepted AWS migration and read-only production-source boundary; the newer Wiki architecture resolves its previously open service selection.
- `.agents/references/auditflow-aws-operations.md` lines 1-6 - legacy workflows are disabled evidence; deployment and production operations require explicit scope.
- `.agents/references/auditflow-api-security-contracts.md` lines 1-7 - future public/protected API boundary and observable JSON error contract.
- `.agents/references/github-project-documents.md` - this plan is the canonical repository-backed artifact; do not duplicate it in an issue.
- `docs/migration/auditflow-source-baseline.md` lines 49-76 - Node 20.17.0 validation baseline: tests/build pass; typecheck/lint have documented inherited failures.
- `package.json` lines 1-15 and 76 onward - ESM package, existing scripts, TypeScript/Vite/Vitest versions, and dependency conventions.
- `package-lock.json` line 4 onward - npm lockfile v3; update only through the pinned package install.
- `.gitignore` lines 1-3 and 60-62 - stage-local configuration, `.sst/`, and `sst-env.d.ts` are already ignored; only the safe example template is committed.
- `vite.config.js` lines 1-19 and 29-39 - existing Vite/Base44 build and local proxy behavior; do not remove the plugin in this ticket.
- `vitest.config.js` lines 1-10 - existing Node-environment characterization-test configuration.
- `jsconfig.json` lines 1-20 - existing frontend-only typecheck scope; add a separate foundation TypeScript project rather than broadening baseline diagnostics.
- `eslint.config.js` lines 7-60 - existing frontend lint scope; add a separate TypeScript block and focused command without masking the inherited frontend failures.
- `src/App.jsx` lines 36-90 - Vite SPA and existing public/CPA browser routes that need a static-site fallback.
- `src/api/base44Client.js` lines 1-18 - compatibility seam remains unchanged and Base44-backed in #4.
- `base44/entities/Client.jsonc` lines 1-69 - retained Client shape; `id` and timestamps are Base44 system fields rather than declared properties.
- `base44/entities/Submission.jsonc` lines 1-20 and 97-153 - client/year access, stringified payloads, template links, and archive state.
- `base44/entities/QuestionnaireTemplate.jsonc` lines 1-27 - version and active-template access pattern.
- `base44/entities/PdfTemplate.jsonc` lines 1-23 - active PDF template and JSON definition.
- `base44/entities/SyncedDriveFile.jsonc` lines 1-36 - submission-owned historical sync records.
- `base44/entities/User.jsonc` lines 1-21 - retained legacy User profile; Cognito subject is internal metadata.
- `src/pages/ClientsPage.jsx` lines 30-47 and 237-269 - Client/Submission creation-order, archive, and client/year access evidence.
- `src/pages/CpaDashboard.jsx` lines 40-47 - creation-order list access for Client and Submission.
- `src/components/dashboard/TeamSection.jsx` lines 20-30 - team listing access for User.
- `base44/functions/getActiveTemplate/entry.ts` lines 108-125 - active/versioned QuestionnaireTemplate access evidence.
- `base44/functions/syncFilesToGoogleDrive/entry.ts` lines 200-250 and 300-380 - historical SyncedDriveFile submission access; runtime integration stays deferred.
- `infra/test/main.tf` lines 93-230 - existing test PDF Lambda, S3 package, API Gateway, health route, and outputs; must remain byte-unchanged.
- `infra/prod/main.tf` lines 75-118 and 142-315 - Terraform-owned OIDC provider/legacy deploy role plus PDF version/alias rollback model; never reuse its broad role or adopt its resources.
- `lambda/pdf-generator/index.mjs` lines 60-99 - existing CORS and `{ ok: true, heeboLoaded }` health/error response pattern; new API health uses the same status/body discipline but is a separate function.
- `.github/workflows/deploy-lambda.yml` lines 10-40 and 70-82 - reusable minimal OIDC permissions and HTTP-200 smoke-check pattern; the workflow itself stays disabled/unchanged.
- `.github/workflows/deploy-lambda-prod.yml` lines 23-43 and `.github/workflows/rollback-prod.yml` lines 24-36 - legacy PDF production evidence; not the new SST workflow.

### New Files to Create

- `sst.config.ts` - pinned SST v3 app entry; stage protection/removal policy; module orchestration and outputs.
- `infra/sst/stage.ts` - fail-closed `test`/`production` stage parser and external runtime-configuration validation.
- `infra/sst/contracts.ts` - pure resource names, table keys/indexes, bucket policy intent, route paths, and expected inventory shared by config/tests/verifier.
- `infra/sst/storage.ts` - seven on-demand DynamoDB tables and two private buckets.
- `infra/sst/auth.ts` - Cognito user pool, public client, production deletion protection, and API JWT authorizer inputs.
- `infra/sst/application.ts` - one Router, one StaticSite, one API Gateway, one linked API Function, route registration, and same-origin rewrite.
- `infra/sst/deployment-role.ts` - test-only GitHub OIDC deploy role/policy that references but does not own the existing account provider.
- `infra/sst/cost.ts` - production-only monthly cost budget/notification using externally supplied USD threshold and email; no automatic shutdown.
- `backend/api/handler.ts` - single API Gateway v2 Lambda entry and minimal route dispatch.
- `backend/api/routes/health.ts` - public/protected health response helpers with no dependency or business-data disclosure.
- `infra/sst/__tests__/stage.test.ts` - allowed-stage, production policy, and external-config tests.
- `infra/sst/__tests__/contracts.test.ts` - exact resource count/name/key/index/route/protection contract tests.
- `backend/api/__tests__/health.test.ts` - API Gateway v2 event tests for public health, protected route handler, 404, and JSON error shape.
- `vitest.foundation.config.js` - focused TypeScript infrastructure/backend test suite that does not change existing characterization-test includes.
- `tsconfig.foundation.json` - no-emit strict TypeScript checks for SST modules, Lambda, tests, and verifier support.
- `.env.example` - configuration names and safe placeholders only; never real account, email, token, or credential values.
- `.github/workflows/deploy-sst-test.yml` - active test-only OIDC validation, checks, diff, deploy, and smoke workflow.
- `tooling/verify_sst_foundation.mjs` - dependency-free contract/output/live AWS verifier using `.sst/outputs.json`, `fetch`, and AWS CLI describe calls.

### Existing Files to Update

- `package.json` / `package-lock.json` - exact `sst@3.19.3`, TypeScript lint/types dependencies, Node engine, and focused foundation scripts.
- `eslint.config.js` - TypeScript/Node rules for the new foundation files without changing current frontend rules.
- `README.md` - safe local/test-stage setup, external configuration names, OIDC bootstrap, deploy/diff/smoke commands, and production no-deploy warning.
- `AGENTS.md` - add `sst.config.ts`, `infra/sst/`, `backend/api/`, and distinguish the active SST test workflow from disabled imported PDF workflows.
- `.agents/references/auditflow-aws-operations.md` - record SST ownership, named stages, test workflow, production protection, and the continuing Terraform/PDF boundary.

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [SST Config: app, stages, environment, version, protect, and removal](https://sst.dev/docs/reference/config/#app)
  - Why: pin `version: "3.19.3"`, set `il-central-1`, reject unnamed stages, and protect/retain production.
  - Version caveat: current public docs track the newest major. The installed `sst@3.19.3` generated types and `npx sst version` are authoritative; v3.19.3 `sst diff` has no `--json` flag.
- [SST Router route/rewrite](https://sst.dev/docs/component/aws/router/#route) and [StaticSite Router integration](https://sst.dev/docs/component/aws/static-site/#router)
  - Why: one CloudFront origin boundary serves the SPA and rewrites `/api/*` to API Gateway without browser CORS.
- [SST StaticSite build/environment](https://sst.dev/docs/component/aws/static-site/#build)
  - Why: build the existing root Vite app to `dist`; only non-sensitive `VITE_*` values may enter the browser bundle.
- [SST ApiGatewayV2 routes and Cognito JWT authorizer](https://sst.dev/docs/component/aws/apigatewayv2/#addauthorizer)
  - Why: public `/health`, protected `/auth/health`, Cognito issuer/audience, explicit per-route auth, and `cors: false`.
- [SST Function linking](https://sst.dev/docs/component/aws/function/#link)
  - Why: expose resource identity and least-privilege runtime permissions to the one API Lambda rather than hand-written environment values.
- [SST Dynamo fields/indexes/deletion protection](https://sst.dev/docs/component/aws/dynamo/#fields)
  - Why: key field types cannot be changed in place; production tables also need `deletionProtection` and PITR through the v3 transform.
- [AWS DynamoDB deletion protection](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-dynamodb-table.html#cfn-dynamodb-table-deletionprotectionenabled)
  - Why: verify the synthesized and deployed production safety setting independently of SST removal policy.
- [SST Bucket access/versioning/lifecycle](https://sst.dev/docs/component/aws/bucket/#access)
  - Why: buckets are private by default, file objects are versioned, and temporary output expires without always-on cleanup compute.
- [SST Cognito user pool/client/transform](https://sst.dev/docs/component/aws/cognito-user-pool/#addclient)
  - Why: email sign-in foundation, public browser client, and underlying production deletion-protection transform.
- [AWS Cognito deletion protection](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-deletion-protection.html)
  - Why: SST `removal: "retain"` does not by itself retain every non-S3/Dynamo resource.
- [SST CLI deploy and diff](https://sst.dev/docs/reference/cli/#deploy)
  - Why: `diff` builds/previews and `deploy --stage test` creates the named stage. Use flags present in v3.19.3, not newer-doc-only flags.
- [SST IAM credentials](https://sst.dev/docs/iam-credentials/#iam-permissions)
  - Why: bootstrap/state/asset permissions are separate from resource-deploy permissions; do not copy the legacy `AdministratorAccess` role.
- [GitHub Actions: AWS OIDC](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws)
  - Why: `id-token: write`, `contents: read`, environment-bound subject, and no long-lived AWS keys.
- [AWS CLI IAM Identity Center authentication](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
  - Why: the owner authenticates a named, refreshable temporary-credential profile before execution; no raw AWS credential is shared with the agent.
- [GitHub deployment environments](https://docs.github.com/en/actions/concepts/workflows-and-actions/deployment-environments) and [deployment branch policy API](https://docs.github.com/en/rest/deployments/branch-policies)
  - Why: pre-create/verify Environment `test`, allow only `main` and the Issue #4 feature-branch pattern, and avoid an unexpected reviewer wait during the run.
- [GitHub OIDC subject claims](https://docs.github.com/en/actions/reference/security/oidc#example-subject-claims)
  - Why: a job using Environment `test` normally has subject `repo:noamtz/cpa-platform:environment:test`; newer immutable-subject behavior must be detected rather than guessed.
- [AWS IAM OIDC role trust](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html#role-oidc-prepare)
  - Why: require both audience and exact subject conditions and reference the existing provider ARN.
- [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)
  - Why: production alert threshold is configured externally in USD below the ILS 50 ceiling; alert only, never shutdown.

### Patterns to Follow

**Naming:** TypeScript files and variables use lower camel case; SST logical component names use stable PascalCase (`ClientTable`, `ApplicationRouter`, `ApiFunction`). Do not embed generated physical names in product code. Keep the SST app name stable (`auditflow`) because changing it or a component logical name can orphan/recreate resources.

**Stage guard:** only exact `test` and `production` stages are accepted. The config follows this shape and never guesses from usernames:

```ts
const isProduction = input.stage === "production";
return {
  name: "auditflow",
  home: "aws",
  version: "3.19.3",
  protect: isProduction,
  removal: isProduction ? "retain" : "remove",
  providers: { aws: { region: "il-central-1" } },
};
```

**Table keys and indexes:** retain all legacy fields without normalization. Add only internal index attributes populated later by import/repository code.

| Table | Primary key | Required GSI(s) | Reason |
| --- | --- | --- | --- |
| `Client` | `id` (string) | `byCreatedDate`: `record_type` + `created_date` | ordered CPA lists |
| `Submission` | `id` (string) | `byClientYear`: `client_id` + `tax_year`; `byCreatedDate`: `record_type` + `created_date` | exact client/year lookup and ordered lists |
| `QuestionnaireTemplate` | `id` (string) | `byVersion`: `record_type` + `version` | active/version ordering; filter `is_active` after query |
| `PdfTemplate` | `id` (string) | `byCreatedDate`: `record_type` + `created_date` | ordered/active template list |
| `SyncedDriveFile` | `id` (string) | `bySubmission`: `submission_id` + `created_date` | retained historical records by submission |
| `User` | `id` (string) | `byCognitoSubject`: `cognito_sub` | link Cognito subject to retained User ID |
| `ChangeJournal` | `scope` + `sequence` (strings) | `byEntity`: `entity_key` + `sequence` | globally ordered single-firm replay plus entity drill-down |

`record_type`, `cognito_sub`, `scope`, `sequence`, and `entity_key` are internal metadata, not replacements for legacy fields. Do not use booleans as DynamoDB key fields. Use on-demand billing and PITR for all tables; enable table deletion protection only in production so the test stage remains removable.

**Buckets:** `FilesBucket` has no public access, HTTPS enforcement, versioning, and no browser CORS yet. `TemporaryOutputsBucket` is also private, with a one-day expiration lifecycle and no versioning. Never route either bucket publicly; #8 issues scoped signed URLs after authorization.

**API shape:** instantiate one `sst.aws.Function` and reuse it for both API routes; do not let each route create a separately designed Lambda. Register `GET /health` without auth and `GET /auth/health` with the Cognito JWT authorizer. The Router owns `/api` and rewrites `^/api/(.*)$` to `/$1`. Return `Content-Type: application/json`, `{ ok: true, service: "auditflow-api", stage }`, `{ error: message }` for handler errors, and 404 for unknown route keys. Do not log request bodies, authorization headers, tokens, or resource names.

**Same-origin frontend:** attach the root Vite StaticSite to the Router (not a second CloudFront distribution), build with `npm run build` to `dist`, configure SPA fallback to `index.html`, and expose only `VITE_API_BASE_URL=/api`. Do not copy Base44 production settings into CI or the site bundle.

**Protection:** production uses app `protect: true` plus `removal: "retain"`; tables use deletion protection and retained underlying resource options; the Cognito User Pool uses AWS deletion protection plus retained resource options. The file bucket remains versioned. Test deliberately remains removable.

**OIDC:** the account-level provider in `infra/prod/main.tf:77-85` remains Terraform-owned. Reference its ARN; never declare, import, or delete it in SST. Create a distinct test role whose trust requires `aud=sts.amazonaws.com` and the exact `test` Environment `sub`. The workflow prints/validates only decoded `aud` and `sub`, never the JWT. Store the role ARN as a GitHub Environment variable and use no long-lived AWS keys.

**Deployment permissions:** replace the legacy administrator role pattern with the SST bootstrap/state permissions plus only the AWS service actions needed by this foundation (S3, SSM state, CloudFront, Lambda, API Gateway, DynamoDB, Cognito, CloudWatch Logs, IAM role/policy/pass-role, tagging, and test-stage resource updates). Scope ARNs/prefixes where AWS APIs permit; document unavoidable `Resource: "*"` actions and validate through IAM Access Analyzer/CloudTrail after the test deployment.

**Errors and logging:** fail closed on invalid stage or missing production-only config. Include command stderr and resource logical ID in operator errors, but never runtime config values, OIDC tokens, request bodies, client data, or signed URLs.

**Avoid:** latest/unpinned SST (currently a newer major), current-doc-only CLI flags such as v3.19.3-unsupported `sst diff --json`, a second CloudFront site distribution, wildcard CORS, public S3 access, one Lambda per route, broad administrator reuse, duplicate OIDC provider, physical resource-name coupling, production deploy, Terraform edits, Base44 removal, or domain/DNS changes.

---
## IMPLEMENTATION PLAN

### Phase 0: Consolidated authorization and access readiness

Before branch creation or implementation writes, obtain the single owner handoff defined above and validate the AWS profile, target account, session, GitHub identity/environment, branch state, and production-preview input source together. Do not begin a partial run when a predictable prerequisite is missing.

### Phase 1: Versioned foundation contract

**Depends on:** Phase 0.

Pin SST v3 and TypeScript tooling, define fail-closed stages and the immutable resource/key inventory, and add focused type/lint/test commands. This phase produces no AWS resources.

### Phase 2: Stateful resources and authentication

**Depends on:** Phase 1.

Provision seven on-demand/PITR DynamoDB tables, two private S3 buckets, the Cognito pool/client, production-specific protections, and the production-only cost budget definition.

### Phase 3: Same-origin application skeleton

**Depends on:** Phase 2 because the single API Lambda links every state/auth resource.

Add the modular health handler, one linked Lambda, API Gateway routes/authorizer, Router prefix rewrite, and root Vite StaticSite.

### Phase 4: OIDC deployment and verification

**Depends on:** Phase 3 because the role policy and smoke verifier target the complete foundation.

Reference the existing OIDC provider, create the test deploy role, add the active test-only GitHub workflow, verify OIDC claims, bootstrap locally once, deploy through CI, and inspect the live inventory/settings.

### Phase 5: Contracts, regression checks, and handoff

Update operating instructions, prove production synthesis is protected without deploying it, compare known baseline diagnostics, and confirm all legacy PDF/Terraform and Base44 seams remain unchanged.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order. Deployment tasks are explicitly separated from local code/preview validation.

### 0. COLLECT the single owner handoff and PASS the readiness gate

- **IMPLEMENT**: Ask once for every missing item in the PRE-IMPLEMENTATION AUTHORIZATION AND ACCESS GATE: bounded authorization, the named AWS profile after owner-completed SSO login, target-account confirmation, GitHub Environment authority, the ignored production-preview configuration path, and session-duration confirmation.
- **IMPLEMENT**: Never request or store access keys, passwords, SSO/OIDC tokens, credential-cache files, account identifiers, or the budget recipient. Use the authenticated profile in place and capture only sanitized pass/fail evidence.
- **IMPLEMENT**: Verify the base/feature-branch state before `piv-implement` writes. If the base branch has unresolved user changes, aggregate that with all other missing prerequisites rather than prompting serially; preserve the existing `.codex/agents/*.toml` work.
- **IMPLEMENT**: Verify the AWS caller and explicit region through profile `auditflow-deploy`, compare the account silently with repository evidence, confirm OIDC-provider read access/ownership, and check the session again immediately before the bootstrap deployment.
- **IMPLEMENT**: Verify `tooling/github.py` selects `noamtz`, Environment `test` exists, and its custom policies allow only `main` and `feat/issue-4-*`. The environment currently exists; make this check idempotent rather than blindly creating it.
- **IMPLEMENT**: Verify the ignored production-preview configuration can be parsed without echoing values. Once the full gate passes, continue without further owner approval for in-scope non-destructive actions.
- **GOTCHA**: Advance approval does not authorize production deployment, deletions, destructive replacement, account mismatch, credential workarounds, or scope expansion. Those remain hard stops. An expired/denied session is an unavoidable external blocker and must never be bypassed with long-lived keys.
- **VALIDATE**: `git status --short --branch`; `aws sts get-caller-identity --profile auditflow-deploy --output json > $null`; `if ((aws configure get region --profile auditflow-deploy) -ne 'il-central-1') { throw 'Wrong deployment region' }`; `aws iam list-open-id-connect-providers --profile auditflow-deploy --output json > $null`; `python tooling/github.py auth status`; `python tooling/github.py api repos/noamtz/cpa-platform/environments/test > $null`; `python tooling/github.py api repos/noamtz/cpa-platform/environments/test/deployment-branch-policies > $null`.
- **SATISFIES**: AC #0, #3, #5, and #6.

### 1. INSPECT ticket gate, branch, toolchain, AWS, and OIDC ownership

- **IMPLEMENT**: Re-read #4, #1, the Wiki architecture, and Issue #3 completion evidence. Work on `feat/issue-4-sst-foundation` based on current `main`; preserve unrelated `.codex/agents/*.toml` edits.
- **IMPLEMENT**: Confirm origin is `git@github.com:noamtz/cpa-platform.git`, Node is 20.17.0, `sst@3.19.3` is still the intended v3 line, the Phase 0 AWS caller/region evidence remains valid, and exactly one expected GitHub OIDC provider already exists.
- **IMPLEMENT**: Confirm `infra/prod/main.tf` owns that provider and its legacy role is not suitable for `cpa-platform`.
- **GOTCHA**: An absent/duplicate provider, wrong AWS account, failed Issue #3 gate, or changed architecture blocks deployment; do not repair Terraform or guess ownership.
- **VALIDATE**: `git remote get-url origin`; `node --version`; `npm view sst@3 version --json`; `aws sts get-caller-identity --profile auditflow-deploy --output json > $null`; `aws iam list-open-id-connect-providers --profile auditflow-deploy --output json > $null`.
- **SATISFIES**: AC #5 and #6.

### 2. UPDATE package.json/package-lock.json and CREATE focused tool configs

- **IMPLEMENT**: Add exact `sst@3.19.3`, `typescript-eslint@8.67.0`, and `@types/aws-lambda@8.10.162` as development dependencies; add Node `20.17.0` engine.
- **IMPLEMENT**: Add `sst:install`, `sst:diff:test`, `sst:deploy:test`, `test:foundation`, `typecheck:foundation`, and `lint:foundation` scripts using only v3.19.3-supported flags.
- **IMPLEMENT**: Create `tsconfig.foundation.json` and `vitest.foundation.config.js`; extend ESLint with TypeScript/Node parsing for only the new foundation paths.
- **PATTERN**: Preserve `package.json:6-15`, `vitest.config.js:4-10`, `jsconfig.json:19-20`, and `eslint.config.js:7-60`; do not change current frontend scopes or inherited findings.
- **GOTCHA**: `sst install` generates ignored type/platform files. Do not track `.sst/` or `sst-env.d.ts`. Do not run `sst init`, which can rewrite the existing project.
- **VALIDATE**: `npm ci`; `npx sst version`; `npx sst install`; `npm run typecheck:foundation`; `npm run lint:foundation`.
- **SATISFIES**: AC #1, #2, and #7.

### 3. CREATE infra/sst/stage.ts, infra/sst/contracts.ts, and contract tests

- **IMPLEMENT**: Accept only `test` and `production`; derive `isProduction`, region, protection/removal, bounded log retention, and production-only external settings.
- **IMPLEMENT**: Encode exact logical component names, seven table schemas/indexes, two bucket intents, two API routes, same-origin `/api` prefix, expected outputs, and stage inventory.
- **IMPLEMENT**: Require a monthly budget threshold and alert recipient only for production. Validate a positive USD threshold; keep both outside source control and never log the recipient.
- **IMPLEMENT**: Create `.env.example` with configuration names/comments and blank/example-safe values only. GitHub Environment variables and ignored stage-local files are the runtime sources.
- **GOTCHA**: Do not put sensitive values or Base44 production values in StaticSite `environment`, `.env.example`, tests, outputs, logs, or workflow YAML.
- **VALIDATE**: `npm run test:foundation -- infra/sst/__tests__/stage.test.ts infra/sst/__tests__/contracts.test.ts`; confirm stage-local files and `.sst/outputs.json` are ignored.
- **SATISFIES**: AC #1, #2, #3, and #7.

### 4. CREATE infra/sst/storage.ts

- **IMPLEMENT**: Instantiate six legacy tables with `id` primary keys and the table above indexes; instantiate `ChangeJournal` with `scope + sequence` and `byEntity`.
- **IMPLEMENT**: Use PAY_PER_REQUEST and PITR in both stages. Enable SST/AWS table deletion protection and retained resource options in production only.
- **IMPLEMENT**: Create private HTTPS-only `FilesBucket` with versioning and `cors: false`; create private `TemporaryOutputsBucket` with `cors: false` and one-day lifecycle expiration.
- **PATTERN**: Entity schema evidence is `base44/entities/*.jsonc`; architecture access patterns are canonical. Preserve field names/values and use separate internal metadata only.
- **GOTCHA**: Dynamo key/index changes can require replacement. Do not add speculative tenant keys, boolean keys, TTL to business records, public access, or browser upload CORS.
- **VALIDATE**: `npm run test:foundation -- infra/sst/__tests__/contracts.test.ts`; `npm run typecheck:foundation`; later `npx sst diff --stage test --print-logs` must show exactly seven Dynamo components and two buckets.
- **SATISFIES**: AC #1, #2, #3, and #7.

### 5. CREATE infra/sst/auth.ts and infra/sst/cost.ts

- **IMPLEMENT**: Create email-username Cognito User Pool and public browser client without a client secret. Do not create users, hosted UI domain, or frontend login code.
- **IMPLEMENT**: In production, transform the underlying pool to `DeletionProtection: ACTIVE` and retain it on config removal; test remains removable.
- **IMPLEMENT**: Export pool/client IDs for the API authorizer and non-sensitive deployment outputs.
- **IMPLEMENT**: Create the production-only monthly cost budget/notification from external USD/email config, below the ILS 50 ceiling at deployment time, with alerts only and no automated shutdown.
- **GOTCHA**: The client ID is public; credentials and budget email are not browser outputs. Callback/logout URLs and PKCE session behavior belong to #6.
- **VALIDATE**: `npm run test:foundation`; `npm run typecheck:foundation`; production preview later must show deletion protection and a budget, while test must not require production config.
- **SATISFIES**: AC #1, #2, and #3.

### 6. CREATE backend/api health skeleton and tests

- **IMPLEMENT**: Add one API Gateway v2 handler dispatching by method/route key to public `/health` and protected `/auth/health`; return deterministic JSON with service/stage only.
- **IMPLEMENT**: Return 404 `{ error: "Not found" }` for unknown routes and 500 `{ error: "Internal server error" }` for unexpected errors; log only a request/correlation identifier and safe error class/message.
- **PATTERN**: `lambda/pdf-generator/index.mjs:73-99` for Lambda response shape and JSON content type; `.agents/references/auditflow-api-security-contracts.md` for `{ error: message }` discipline.
- **GOTCHA**: Do not check authentication in frontend code or log JWT claims/tokens. API Gateway authorizes the protected route; later backend authorization still verifies role/resource scope.
- **VALIDATE**: `npm run test:foundation -- backend/api/__tests__/health.test.ts`; `npm run typecheck:foundation`; `npm run lint:foundation`.
- **SATISFIES**: AC #1, #4, and #7.

### 7. CREATE infra/sst/application.ts and sst.config.ts

- **IMPLEMENT**: Pin app version/name/region and stage policies; construct one Router, API Gateway with `cors: false`, one arm64 Node 20 API Function with cost-conscious memory/timeout and bounded logs, and link all tables/buckets/pool.
- **IMPLEMENT**: Reuse that Function instance for both routes. Create Cognito JWT authorizer with regional issuer and client ID audience; apply only to `/auth/health`.
- **IMPLEMENT**: Route Router `/api` to API URL with explicit prefix removal; attach the root StaticSite to the same Router, build to `dist`, use SPA fallback, and inject only `VITE_API_BASE_URL=/api`.
- **IMPLEMENT**: Return outputs needed by verification: stage, router/site URL, API URL, health URL, protected-health URL, table names, bucket names, pool/client IDs, and test deploy-role ARN when present. Do not output email, policies, account IDs, tokens, or sensitive values.
- **GOTCHA**: Do not create a standalone StaticSite distribution, a second API Lambda, wildcard API CORS, a production custom domain, or routes into the existing PDF endpoint.
- **VALIDATE**: `npx sst install`; `npm run typecheck:foundation`; `npm run test:foundation`; `npm run build`; `npx sst diff --stage test --print-logs`.
- **SATISFIES**: AC #1, #2, #4, and #7.

### 8. CREATE infra/sst/deployment-role.ts

- **IMPLEMENT**: Resolve current AWS account identity, construct/reference the existing `token.actions.githubusercontent.com` provider ARN, and create a separate test-stage role only.
- **IMPLEMENT**: Trust only `sts.amazonaws.com` plus the discovered exact GitHub Environment `test` subject. Add SST state/bootstrap actions and service-scoped foundation deployment actions; no `AdministratorAccess` attachment.
- **IMPLEMENT**: Keep production role/workflow out of this ticket. Export the test role ARN for one-time GitHub Environment configuration.
- **GOTCHA**: Creating a second account provider conflicts with Terraform/AWS. Reusing `github-actions-taxflow` fails both repository trust and least-privilege expectations.
- **VALIDATE**: `npx sst diff --stage test --print-logs`; inspect the trust/policy preview; after bootstrap inspect the role and attached inline policies through AWS CLI.
- **SATISFIES**: AC #5 and #6.

### 9. CREATE .github/workflows/deploy-sst-test.yml

- **IMPLEMENT**: Use `workflow_dispatch`, same-repository pull requests targeting `main`, and main-branch path-filtered deploys; set `environment: test`, `permissions: { id-token: write, contents: read }`, checkout v4, setup-node v4 with 20.17.0/npm cache, and `npm ci`. Refuse deployment for fork pull requests.
- **IMPLEMENT**: Request a GitHub OIDC token and decode/validate only `aud` and `sub` before AWS assumption. Fail if they do not equal the role trust contract; never print the token.
- **IMPLEMENT**: Read the deploy-role ARN and non-sensitive stage config from GitHub Environment variables, assume through `aws-actions/configure-aws-credentials@v4`, confirm AWS identity/region, run foundation tests/type/lint/build, `sst diff`, `sst deploy --stage test --print-logs`, then the live verifier.
- **IMPLEMENT**: Set concurrency for the test environment so only one deployment mutates a stage at a time. Do not use `--continue`.
- **PATTERN**: `.github/workflows/deploy-lambda.yml:10-40` for minimal GitHub permissions/credential setup and lines 70-82 for fail-fast health checking.
- **GOTCHA**: OIDC subject format can differ if immutable claims are enabled. Capture the actual claim first and update both trust/test together; never broaden to `repo:noamtz/*` or all environments.
- **VALIDATE**: Parse workflow YAML through the repository's available validator or GitHub read-back; after bootstrap push/update the same-repository PR and require `python tooling/github.py run list --workflow deploy-sst-test.yml --branch feat/issue-4-sst-foundation --limit 2` to show a green run.
- **SATISFIES**: AC #3, #5, and #7.

### 10. CREATE tooling/verify_sst_foundation.mjs

- **IMPLEMENT**: Contract mode validates exact logical inventory without credentials. Live mode reads `.sst/outputs.json`, enforces `stage === test`, validates URL host/protocol/path, and uses AWS CLI describe calls for seven tables, two buckets, Cognito pool/client, API, Lambda, and Router/CloudFront.
- **IMPLEMENT**: Verify test tables are ACTIVE with PAY_PER_REQUEST and PITR, buckets block public access, FilesBucket versioning is enabled, temporary lifecycle exists, public `/api/health` is HTTP 200 with exact safe fields, and unauthenticated `/api/auth/health` is HTTP 401/403.
- **IMPLEMENT**: Produce only logical IDs, AWS status flags, counts, and URLs that are already deployment outputs. Redact account IDs and never print policy documents, emails, tokens, object keys, or credential-bearing response headers.
- **GOTCHA**: SST v3.19.3 `diff` lacks `--json`; use `sst diff` as synthesis/build evidence and the pure contract plus live outputs/AWS describe APIs for machine-verifiable inventory.
- **VALIDATE**: `node tooling/verify_sst_foundation.mjs --mode contract --stage test`; after deploy: `node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json`.
- **SATISFIES**: AC #1, #4, #5, and #7.

### 11. UPDATE README.md, AGENTS.md, and auditflow-aws-operations.md

- **IMPLEMENT**: Document Node/SST pin, ignored stage config, one-time owner-authenticated test bootstrap, GitHub Environment variables, diff/deploy/remove warnings, health/inventory verification, and the fact that production is defined but not deployed.
- **IMPLEMENT**: Add new backend/SST paths and distinguish the active SST test workflow from the three disabled imported PDF workflows.
- **IMPLEMENT**: Record ownership: SST owns new application-foundation resources; Terraform continues to own the current PDF API and account OIDC provider; Base44 remains the production writer until later parity/cutover gates.
- **GOTCHA**: Do not document credential values, account identifiers, personal email, generated physical names, or a production deploy/cutover command as approved execution.
- **VALIDATE**: `python tooling/validate_codex_layer.py`; `git diff --check`; review all instructions against actual scripts/files.
- **SATISFIES**: AC #3, #5, and #6.

### 12. BOOTSTRAP and deploy only the named test stage

- **IMPLEMENT**: Re-run the Phase 0 AWS identity/region check immediately before mutation, set the process to profile `auditflow-deploy` and region `il-central-1`, then use the already granted bounded authorization to run one test deployment. Do not pause for a redundant approval when the gate is still valid.
- **IMPLEMENT**: Create SST state/resources and the test OIDC role, then run the live verifier before configuring CI.
- **IMPLEMENT**: Add the role ARN to GitHub Environment `test`; restrict deployments to `main` and `feat/issue-4-*`; push/update the same-repository pull request so the OIDC workflow redeploys the locally bootstrapped stage and proves idempotency.
- **IMPLEMENT**: Capture sanitized evidence: SST version/stage, diff summary, output inventory counts, health result, protected-route rejection, workflow run URL, and AWS protection/status flags.
- **GOTCHA**: This task authorizes only the issue-scoped `test` stage. Do not deploy `production`, change DNS/domain/certificates, apply Terraform, or delete/remove any stage.
- **VALIDATE**: `$env:AWS_PROFILE='auditflow-deploy'; $env:AWS_REGION='il-central-1'; aws sts get-caller-identity --output json > $null`; `npx sst deploy --stage test --print-logs`; live verifier; `python tooling/github.py run list --workflow deploy-sst-test.yml --branch feat/issue-4-sst-foundation --limit 2`; the OIDC redeploy must pass.
- **SATISFIES**: AC #1, #4, #5, and #7.

### 13. SYNTHESIZE production safely and run full regression/integrity checks

- **IMPLEMENT**: Supply production-only config from an ignored/operator environment and run `sst diff --stage production` without deployment. Inspect `protect`, retention, table/Cognito deletion protection, versioned file storage, and budget notification.
- **IMPLEMENT**: Run the complete project validation under Node 20.17.0. Compare typecheck/lint to `docs/migration/auditflow-source-baseline.md`; require zero new diagnostics, not an impossible clean inherited baseline.
- **IMPLEMENT**: Verify `infra/test/main.tf`, `infra/prod/main.tf`, `lambda/pdf-generator/`, the three legacy PDF workflows, `src/api/base44Client.js`, and product/UI files have no ticket changes.
- **IMPLEMENT**: Re-run the committed source-manifest verifier to prove imported baseline integrity.
- **VALIDATE**: `npx sst diff --stage production --print-logs`; `npm test`; `npm run typecheck`; `npm run lint`; `npm run build`; `npm run test:foundation`; `npm run typecheck:foundation`; `npm run lint:foundation`; `python -m unittest discover -s tooling/tests -p "test_*.py" -v`; `python tooling/validate_codex_layer.py`; `git diff --check`; importer `inspect --manifest ... --verify-applied` command from the baseline report.
- **SATISFIES**: all ACs.

---

## TESTING STRATEGY

### Unit Tests

- Stage parser accepts exactly `test` and `production`, rejects personal/empty/typo stages, and requires production-only budget settings only for production.
- Contract tests assert exactly seven named tables and two named private buckets, stable logical names, key/index types, no boolean keys, one-day temporary lifecycle, versioned file storage, route paths, and stage-specific protections.
- Health handler tests use API Gateway HTTP API v2 event fixtures for public health, the protected handler path after gateway authorization, unknown route, malformed event, and unexpected error. Assertions include status, JSON content type/body, and absence of request/token/resource details.
- OIDC trust-policy pure tests assert exact provider/audience/subject and reject wildcards/legacy `noamtz/auditflow` values.
- Cost tests assert production alert-only behavior and no test-stage budget.

### Integration / Synthesis Tests

- `npx sst install` plus strict no-emit TypeScript validates actual v3.19.3 component/transform types.
- `sst diff --stage test` builds the site/function and previews the exact test inventory with no production/Terraform changes.
- `sst diff --stage production` validates protected retained configuration only; it is never followed by production deploy in #4.
- Contract verifier checks the declared logical inventory before AWS access.

### Deployment Tests

- One owner-authenticated test bootstrap followed by an OIDC workflow redeploy proves first deployment and idempotency.
- Live verifier checks actual AWS resource statuses/settings, public health 200/body, protected-health unauthorized rejection, and Router-served SPA shell/assets.
- GitHub workflow validates its OIDC `aud`/`sub`, assumed role identity, named stage, and test environment concurrency.

### Edge Cases

- Owner supplies credentials or tokens instead of authenticating a named profile; refuse the material and redirect to SSO login.
- SSO session is absent, near expiry, or expires before bootstrap; wrong account/profile; ambient `us-east-1` leaks into an `il-central-1` command.
- GitHub authentication selects the wrong identity, Environment `test` is missing/partially configured, or branch policy would wait for a reviewer or reject the feature branch.
- Predictable prerequisites are requested one at a time after implementation has started instead of being aggregated in Phase 0.
- Wrong/unnamed stage; SST v4 accidentally installed; v4-only CLI flag used with v3.19.3.
- Existing OIDC provider absent, duplicated, or owned by a different stack; immutable GitHub OIDC subject differs from legacy subject.
- Workflow tries to assume the Terraform legacy role or broadens trust to another repository/environment.
- Production removal/protection configured only at app level while Cognito remains deletable.
- Table key/index drift that would force replacement; internal metadata accidentally overwrites legacy fields.
- StaticSite creates a second distribution; `/api` prefix is not rewritten; SPA deep links return 404.
- API/Bucket wildcard CORS; private bucket public access; temp objects never expire; file bucket lacks versioning.
- Health leaks resource names/account ID/config or protected route is accidentally public.
- Baseline typecheck/lint failures are mistaken for new regressions, or new diagnostics are hidden inside the inherited count.
- SST declarations overlap Terraform PDF names/resources or a diff shows update/delete outside the new foundation.

---

## VALIDATION COMMANDS

Run with Node 20.17.0. Deployment commands require the exact authorized stage and AWS identity.

### Level 0: Authorization and access readiness

```powershell
git status --short --branch
aws sts get-caller-identity --profile auditflow-deploy --output json > $null
if ((aws configure get region --profile auditflow-deploy) -ne 'il-central-1') { throw 'Wrong deployment region' }
aws iam list-open-id-connect-providers --profile auditflow-deploy --output json > $null
python tooling/github.py auth status
python tooling/github.py api repos/noamtz/cpa-platform/environments/test > $null
python tooling/github.py api repos/noamtz/cpa-platform/environments/test/deployment-branch-policies > $null
```

Expected: the consolidated authorization is present; branch state is safe for `piv-implement`; AWS profile, account, region, session, and OIDC read access pass; GitHub uses `noamtz`; Environment `test` has only the intended branch policies; the ignored production-preview configuration is present. Record only sanitized pass/fail evidence.

### Level 1: Versions, syntax, style, and focused types

```powershell
node --version
npm ci
npx sst version
npx sst install
npm run typecheck:foundation
npm run lint:foundation
git diff --check
```

Expected: Node `v20.17.0`, SST `3.19.3`, and all focused foundation checks clean.

### Level 2: Unit and regression tests

```powershell
npm run test:foundation
npm test
python -m unittest discover -s tooling/tests -p "test_*.py" -v
python tooling/validate_codex_layer.py
```

Expected: new foundation tests and existing 67 characterization tests pass; tooling/AI-layer tests pass.

### Level 3: Build and synthesis

```powershell
$env:AWS_PROFILE='auditflow-deploy'
$env:AWS_REGION='il-central-1'
npm run build
node tooling/verify_sst_foundation.mjs --mode contract --stage test
npx sst diff --stage test --print-logs
npx sst diff --stage production --print-logs
```

The production command uses externally supplied production settings and is preview only. Inspect for no changes/deletes to existing Terraform resources.

### Level 4: Test-stage deployment and live validation

```powershell
$env:AWS_PROFILE='auditflow-deploy'
$env:AWS_REGION='il-central-1'
aws sts get-caller-identity --output json > $null
npx sst deploy --stage test --print-logs
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json
python tooling/github.py run list --workflow deploy-sst-test.yml --branch feat/issue-4-sst-foundation --limit 2
```

Manual checks: Router root and one SPA deep link return the Vite shell; `/api/health` returns HTTP 200 and the exact safe JSON; `/api/auth/health` without JWT returns 401/403; the workflow run uses Environment `test` and the expected assumed role.

### Level 5: Full baseline and immutable-boundary validation

```powershell
npm run typecheck
npm run lint
npm run build
python tooling/import_auditflow_source.py inspect `
  --source C:\Users\ntzur\workspace-antigravity\auditflow `
  --destination . `
  --expected-commit 5920c779cc49d6502bdbb2aad56e40845778fc9c `
  --manifest docs/migration/auditflow-source-manifest.json `
  --verify-applied
```

Expected: typecheck/lint match the documented inherited failure set with zero new diagnostics; all other commands pass. Compare the feature-branch diff to its merge base and require no changes under the legacy PDF/Terraform/product seams listed in Task 13.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #0 — Non-blocking execution gate:** before implementation begins, the agent obtains one bounded authorization/access handoff, validates the safe branch state, named AWS profile/account/region/session/OIDC access, required GitHub identity/environment policies, and ignored production-preview inputs, then records sanitized readiness evidence and proceeds without predictable approval pauses.
- [ ] **AC #1 — Test foundation:** named SST `test` deploy serves the Vite shell through one Router/StaticSite, exposes one API Gateway/one linked Lambda, provisions exactly seven DynamoDB tables, two private buckets, one Cognito pool/client, and a configured JWT authorizer.
- [ ] **AC #2 — Production safety:** `production` synthesis has `protect: true`, retained stateful resources, DynamoDB deletion protection/PITR, Cognito deletion protection/retention, versioned file storage, and alert-only budget configuration; no production deployment occurs.
- [ ] **AC #3 — Configuration separation:** only exact `test`/`production` stages are allowed; stage-specific values live outside source control, the committed example contains no real values, and no server credential enters source/browser output.
- [ ] **AC #4 — Same-origin model:** Router root serves SPA routes/assets and `/api/*` reaches API Gateway through the explicit rewrite; API/buckets are not made broadly cross-origin or public.
- [ ] **AC #5 — OIDC CI:** GitHub Environment `test` token `aud`/`sub` are validated, a separate non-administrator role is assumed through OIDC, and the workflow successfully redeploys the locally bootstrapped named test stage without long-lived AWS keys.
- [ ] **AC #6 — Existing production boundary:** `infra/{test,prod}/`, `lambda/pdf-generator/`, three imported PDF workflows, Base44 compatibility seam, production domain/DNS, and live product behavior are unchanged and operational.
- [ ] **AC #7 — Evidence:** v3.19.3 type/install checks, contract inventory, test/production diffs, live AWS describe verification, public health 200/body, protected-health rejection, build, tests, and baseline comparison are captured with no sensitive values.
- [ ] **AC #8 — Cost/operations:** all compute remains request-driven, temporary output expires, logs are bounded/privacy-safe, and the production budget alert is below the ILS 50/month ceiling without automated shutdown.

---

## COMPLETION CHECKLIST

- [ ] Consolidated owner handoff is complete and AC #0 passed before branch creation or implementation writes.
- [ ] No password, access key, session/OIDC token, credential cache, account identifier, or budget recipient was copied into chat, Git, logs, outputs, or reports.
- [ ] AWS identity/session was rechecked immediately before bootstrap; no redundant owner approval was requested after the valid gate.
- [ ] Issue #3 gate, Wiki architecture, origin, feature branch, AWS account, and OIDC ownership revalidated.
- [ ] SST is exactly 3.19.3 in package lock and app config; generated artifacts remain ignored.
- [ ] Resource/key/route contract tests pass before synthesis.
- [ ] Test and production diffs reviewed; production protections explicitly visible.
- [ ] Owner-authenticated test bootstrap succeeds; no production deploy/apply occurs.
- [ ] GitHub Environment `test` variables/branch protection configured; decoded OIDC claim matches exact trust.
- [ ] Local bootstrap and the subsequent idempotent OIDC workflow redeploy pass.
- [ ] Live verifier proves exact inventory, privacy/protection settings, same-origin shell/health, and protected rejection.
- [ ] Existing characterization tests and build pass.
- [ ] Typecheck/lint have zero new diagnostics relative to the documented imported baseline.
- [ ] Codex-layer, Python tooling, manifest, and diff-integrity checks pass.
- [ ] No legacy Terraform/PDF/Base44/product file changed.
- [ ] Implementation report records sanitized evidence and remaining manual prerequisites.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Assumption:** Issue #3 remains accepted at merged `main`; it was closed with completion evidence on 2026-08-14. Drift in the imported manifest or architecture requires a plan amendment.
- **Assumption:** The expected AWS account still contains the single Terraform-owned GitHub OIDC provider evidenced by `infra/prod/main.tf`. Read-only verification is mandatory; do not create a duplicate if the assumption fails.
- **Assumption:** The expected Environment subject is `repo:noamtz/cpa-platform:environment:test`. The workflow must discover/validate the actual `aud` and `sub`; if GitHub immutable claims are enabled, update the exact trust string rather than broadening it.
- **Assumption:** SST `3.19.3` remains the approved v3 implementation despite a newer SST major being current. Any move to v4 is an epic-level architecture change, not a dependency update inside #4.
- **Assumption:** Test-stage bootstrap uses the named, owner-authenticated AWS SSO profile once; subsequent test deploys use OIDC. Missing/expired AWS access, missing GitHub authority, unsafe branch state, or absent preview inputs fail Phase 0 and block the entire implementation run before code changes.
- **Assumption:** A conservative production USD budget threshold and alert recipient will be supplied through an ignored local source during the consolidated handoff. The threshold must be checked against the ILS 50 ceiling then; do not hardcode a stale exchange-rate assumption.
- **Observed external state:** GitHub Environment `test` and its `main` plus `feat/issue-4-*` custom branch policies were created on 2026-08-14 during readiness exploration. Future execution verifies them idempotently. No AWS resource was deployed.
- **No critical product question remains.** The only discovery-sensitive values are AWS/OIDC/runtime facts that the implementation workflow can verify fail-closed.

## NOTES (open canvas)

### Expected SST component inventory

| Component | Test | Production preview | Notes |
| --- | ---: | ---: | --- |
| Router + attached StaticSite | 1 + 1 | 1 + 1 | one CloudFront application boundary per stage |
| API Gateway + API Function | 1 + 1 | 1 + 1 | two routes reuse one Lambda |
| Dynamo tables | 7 | 7 | six legacy entities + ChangeJournal |
| Private buckets | 2 | 2 | durable files + expiring temporary output |
| Cognito pool + client | 1 + 1 | 1 + 1 | login UI/users deferred |
| JWT authorizer | 1 | 1 | protected route must opt in |
| GitHub deploy role | 1 | 0 | test CI only in this ticket |
| AWS Budget | 0 | 1 | production alert-only definition |

Underlying AWS resources created by SST exceed these logical component counts (for example CloudFront functions, logs, IAM roles, deployment/state assets). The verifier should assert the logical contract and security-relevant underlying settings rather than snapshotting every generated physical resource name.

### Sequencing rationale

The table keys and Router/API seams are the contracts consumed immediately by #6, #7, #9, and #11, so they are fixed and tested before deployment automation. OIDC is intentionally last because it depends on the complete deploy surface and because the first deployment must bootstrap its own future CI role. Production configuration is previewed only: its protection can be proved without creating traffic-bearing resources or expanding this ticket into cutover.

### Primary risks

1. SST v3 documentation drift: mitigate with exact package/app pin, generated v3 types, and CLI help verification.
2. OIDC bootstrap/ownership: mitigate by referencing the existing provider, exact claim checks, one owner-authenticated test bootstrap, and a distinct role.
3. Irreversible schema/name drift: mitigate with pure contracts, stable logical names, tests, preview, PITR, retention, and deletion protection.
4. Existing infrastructure collision: mitigate with distinct logical/physical prefixes and zero changes/imports in Terraform/PDF paths.
5. False validation failure from inherited frontend diagnostics: compare normalized typecheck/lint findings to the baseline while requiring all new focused checks clean.

Confidence for one-pass implementation: **8/10**. The remaining uncertainty is operational (actual AWS OIDC claim/provider state and owner-authorized bootstrap), not product or architecture scope.

## AMENDMENTS

- 2026-08-14 — Added a mandatory pre-implementation authorization/access gate so `piv-implement` gathers all owner interaction in one handoff, validates credentials and external values before writing code, and continues without predictable approval pauses. Recorded the already-created GitHub `test` Environment branch-policy state; no AWS deployment occurred.

---

**Artifact type:** Implementation plan

**Related:** [ticket #4](https://github.com/noamtz/cpa-platform/issues/4), [epic #1](https://github.com/noamtz/cpa-platform/issues/1), [PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration), [architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration), [dependency #3](https://github.com/noamtz/cpa-platform/issues/3)

**Last updated:** 2026-08-14
