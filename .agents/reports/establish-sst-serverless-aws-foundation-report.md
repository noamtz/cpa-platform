# Implementation Report — Establish SST serverless AWS foundation

**Plan**: `.agents/plans/establish-sst-serverless-aws-foundation.md`

**Issue**: `#4`

**Branch**: `feat/issue-4-sst-foundation`

**Status**: PARTIAL — implementation and authorized local/test deployment are complete; the OIDC workflow proof
requires the normal commit/push/PR handoff, and SST cannot diff an undeployed production stage.

## Summary

Implemented the SST 3.19.3 compatibility foundation in `il-central-1` with strict `test` and `production` stage
contracts. The authorized `test` stage is deployed and verified: one Router/StaticSite, one HTTP API and linked
Node 20 ARM Lambda, seven on-demand DynamoDB tables with PITR, two private buckets, one Cognito pool/client, and
one JWT authorizer. A separate test-only GitHub OIDC role trusts the exact immutable repository Environment
subject and has no managed or administrator policy.

The GitHub `test` Environment now contains the deploy-role ARN variable and only the authorized `main` and exact
`refs/pull/21/merge` branch policies. No production foundation, production budget, DNS, certificate, Terraform/PDF,
Base44 cutover, deletion, or destructive replacement was performed.

## Tasks completed

- Passed the consolidated authorization gate and revalidated the feature issue, accepted dependency, canonical
  Wiki architecture, origin, safe branch state, AWS identity/region/session, one Terraform-owned GitHub OIDC
  provider, GitHub `noamtz` identity, Environment policies, and ignored production inputs.
- Created the feature branch and pinned Node 20.17.0/SST 3.19.3 plus focused TypeScript, ESLint, and Vitest tooling.
- Defined executable stage, resource, route, output, cost, inventory, and OIDC contracts with dependency-free JSON
  verification data.
- Created all seven DynamoDB table contracts, both private bucket contracts, Cognito pool/browser client, and
  production-only protection/retention/budget behavior.
- Created the modular API skeleton, public and JWT-protected health routes, safe JSON errors/logging, one linked
  Lambda, HTTP API, same-origin Router rewrite, and Vite StaticSite.
- Created the separate `auditflow-test-github-deploy` role against the existing provider with exact `aud`/`sub`,
  service-scoped deployment actions, scoped IAM role management, and no managed policies.
- Added the active test workflow with minimal GitHub permissions, Environment gating, decoded claim validation,
  AWS role assumption, focused checks, diff/deploy, and live verification.
- Added a live verifier covering exact inventory, table billing/PITR, bucket privacy/versioning/lifecycle, Cognito
  client safety, API/Lambda/CloudFront settings, OIDC role trust/policy, SPA routing, health response, and protected
  rejection.
- Deployed the named `test` stage once with the owner-authenticated SSO profile, verified it live, and confirmed a
  subsequent test diff contains no AWS resource creates, updates, replacements, or deletes.
- Configured and verified the GitHub `test` Environment deploy-role variable without printing its value.
- Updated repository and AWS operations documentation with ownership, stage, preview, deployment, and safety
  boundaries.

## Tests added

- `infra/sst/__tests__/stage.test.ts`: exact stage parsing, test behavior, production protection, external budget
  parsing, and fail-closed invalid settings.
- `infra/sst/__tests__/contracts.test.ts`: JSON/TypeScript contract synchronization, inventory, DynamoDB keys and
  indexes, storage privacy/lifecycle, same-origin routes, OIDC trust, cost behavior, and safe outputs.
- `backend/api/__tests__/health.test.ts`: public/protected handler dispatch, 404 behavior, malformed requests,
  safe failure responses, and secret non-disclosure.

Result: **3 files / 28 tests passed**.

## Validation results

- Readiness: **pass**; identity/account/region/provider values were checked and withheld.
- Node/npm: **20.17.0 / 10.8.2**.
- Dependency pins: **SST 3.19.3**, `typescript-eslint` **8.67.0**, AWS Lambda types **8.10.162**.
- `npm ci`: **pass** (existing dependency audit findings were not auto-fixed).
- Focused test/type/lint: **pass** — 28 tests and zero diagnostics.
- Contract verifier: **pass** for both `test` and `production` contracts.
- Workflow YAML parse: **pass**.
- `npm test`: **pass** — 3 files / 67 characterization tests.
- `npm run build`: **pass**.
- Full imported-source typecheck: expected **exit 2 / 233 inherited diagnostics**, with zero foundation-path
  diagnostics.
- Full imported-source lint: expected **exit 1 / 23 inherited errors**, with zero foundation-path diagnostics.
- Python tooling tests: **pass** — 11/11.
- `python tooling/validate_codex_layer.py`: **pass** — 31 skills / 6 agents.
- Test deploy: **pass** — 91 SST/Pulumi resources tracked, no destructive replacement.
- Post-deploy test diff: **pass** — only the ephemeral local StaticSite build command trigger appeared; no AWS
  resource drift or deletion.
- Live verifier: **pass** — 7/7 active on-demand/PITR tables, 2/2 private buckets, expected lifecycle/versioning,
  HTTP API, Node 20 ARM Lambda, deployed Router, exact OIDC trust, no administrator policy, SPA root/deep link,
  exact public health JSON, and unauthenticated protected-route rejection.
- GitHub Environment variable and branch policies: **pass**, with values withheld.
- `git diff --check`: **pass** (Git for Windows emitted informational future line-ending warnings).
- Protected-boundary scan: **pass** — no changes under `infra/{test,prod}/`, `lambda/pdf-generator/`, the three
  imported PDF workflows, `src/api/base44Client.js`, or product source paths.

## Partial validations and handoff items

1. **Production diff:** the ignored production file loaded successfully and its values passed fail-closed parsing,
   but SST 3.19.3 returned `Stage not found` because `production` has never been deployed. SST requires prior stage
   state before `sst diff`; initializing it with `sst deploy` was not authorized. Production safety remains covered
   by contract tests: protection and retention are enabled, tables have deletion protection/PITR, Cognito has
   deletion protection, files are versioned, and the alert-only USD 10 budget is below the ILS 50/month ceiling.
2. **OIDC CI run:** PR #21 is open. Its initial job failed before runner allocation because GitHub evaluates
   Environment policies against the pull-request merge ref rather than the head branch name. The Environment was
   narrowed to the exact `refs/pull/21/merge` ref while retaining `main`. The next run proved OIDC claim validation
   and role assumption, then found that a clean runner needs `sst install --stage test` to generate platform types
   before strict type-checking. After that fix, CI validation, diff, and deployment passed; the final verifier found
   that the role needed read-only `iam:ListAttachedRolePolicies` permission to prove it has no managed administrator
   policy. That verification action is now explicit; a green rerun is still required before calling AC #5 complete.
3. **Imported-manifest verifier:** all 11 importer unit tests passed, but `--verify-applied` correctly reported the
   first intentionally changed imported root file. That command enforces byte identity for the entire imported
   tree and therefore cannot pass after the plan-required package/ESLint/README updates. Explicit protected-path
   comparison passed and is the relevant immutable-boundary evidence for this feature.

## Deviations from the plan

- Used the owner-provided `ntz-taxflow` profile rather than the plan's illustrative profile name; all identity and
  region checks passed before deployment.
- Used `sst install --stage test` because strict unnamed-stage rejection makes bare `sst install` invalid.
- The initial test `sst diff` created the authorized shared SST bootstrap state/asset bucket and ECR repository,
  then returned `Stage not found`. The owner-authenticated test deployment created stage state; the subsequent diff
  succeeded. Explicit ECR asset permissions were added to the test deploy role.
- Loaded only `.env.production.local` explicitly through Node 20 because SST does not automatically load that
  plan-defined filename. No value was logged, committed, or returned as an SST output.
- GitHub reports that this repository uses the post-July-2026 immutable OIDC subject prefix. The exact owner and
  repository IDs were used rather than broadening trust to a wildcard or legacy repository name.
- GitHub Environment policies match `GITHUB_REF` for pull-request jobs, so the planned `feat/issue-4-*` head-branch
  pattern was replaced with the exact `refs/pull/21/merge` ref after the first PR job failed before runner
  allocation. This permits only PR #21 plus `main`, not every pull request.
- The clean GitHub runner requires an explicit `npm run sst:install` after AWS role assumption so SST's generated
  platform globals exist before `typecheck:foundation`; local validation had retained those ignored generated
  types from the owner-authenticated bootstrap.
- The test deploy role includes `iam:ListAttachedRolePolicies` only on `auditflow-test-*` roles so the live verifier
  can prove that no managed administrator policy is attached after CI deployment.
- No commit, push, or pull request was created by `piv-implement`; those remain the prescribed next workflow steps.

## Cost and safety evidence

The production alert input is USD 10/month, approximately ILS 30.73 at the reviewed Bank of Israel representative
USD rate, below the owner's ILS 50/month ceiling. It is alert-only with no automated shutdown. Production was not
deployed, so no production budget currently exists. The test stage remains request-driven, temporary outputs
expire after one day, and logs use bounded retention and safe structured messages.

## Related

- Implementation issue: `#4`
- Dependency issue: `#3`
- Epic: `#1`
- Architecture: `Architecture-AuditFlow-Platform-Migration` in the repository Wiki
