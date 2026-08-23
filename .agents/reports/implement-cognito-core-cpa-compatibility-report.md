# Implementation Report — Cognito core CPA compatibility

**Plan**: `.agents/plans/implement-cognito-core-cpa-compatibility.md`

**Issue**: `#6`

**Branch**: `feature/implement-cognito-core-cpa-compatibility`

**Status**: PARTIAL — implementation, test deployment, live foundation verification, managed-login redirect, and
first synthetic-admin bootstrap are complete; human completion of the temporary-password login flow is pending.

## Summary

Implemented and test-deployed the Cognito and AWS compatibility slice for the CPA application. The SST contract now defines
the managed-login domain/resource server, exact CPA scope and route authorization, User listing index, application
outputs, and a no-secret code-flow client. Because the provider pinned by SST 3.19.3 does not expose refresh-token
rotation, the test deploy command performs an explicit describe/update/verify compatibility step after deployment.

The Lambda API now has fail-closed dual token verification, authoritative local User linkage and admin-role checks,
strict request contracts, indexed DynamoDB repositories, CPA entity/current-user/invitation routes, and controlled
Drive/Telegram deferrals. Client, Submission, and User mutations use one DynamoDB transaction for the business
write, global cursor advance, and immutable ChangeJournal evidence.

The browser now uses Cognito authorization code/PKCE with session-scoped OIDC state, safe callback return paths,
one refresh retry, managed logout, and an AWS-only HTTP client for migrated/deferred operations. The retained
`base44` export is an explicit hybrid allowlist: migrated calls never fall back on AWS failure, while only the
approved PDF/template/readiness surfaces remain delegated pending their downstream tickets.

## Tasks completed

- Revalidated issue #6, epic #1, the accepted foundation dependency, installed package/provider APIs, and the
  canonical architecture Wiki.
- Recorded the owner-approved temporary staged-coexistence exception on the canonical Wiki before changing the
  compatibility facade.
- Added exact Cognito, DynamoDB document client, JWT verification, and OIDC dependencies.
- Extended the SST foundation with the Cognito domain/resource server, exact browser client policy, CPA scope,
  fourteen authenticated CPA routes, User `byCreatedDate` index, runtime configuration, safe outputs, and minimum
  deployment permissions.
- Added the test-only post-deploy refresh-token rotation compatibility script and focused tests proving it preserves
  the described app-client configuration and verifies convergence.
- Added modular backend auth, core HTTP/router behavior, strict ingress and permissive persisted-record contracts,
  Client/Submission/User repositories, services, routes, and runtime composition.
- Added atomic ordered ChangeJournal coordination with conditional cursor allocation, contiguous sequences,
  deterministic hashes, changed-field snapshots, file references, bounded actions/items, stable transport retry,
  and safe conflict mapping. Excess file evidence is rejected before mutation rather than truncated.
- Added Cognito invitation with idempotent retry detection and compensating identity deletion when the atomic
  User+journal transaction fails.
- Added Cognito browser auth, same-origin bearer HTTP, AWS compatibility mappings, callback page/route, simplified
  latent AuthContext, explicit compatibility allowlists, and UI-safe integration deferral handling.
- Updated the safe local configuration example, README operating guidance, and repository architecture/status map.
- Previewed and deployed the authorized test-stage changes, applied refresh-token rotation, and passed the full
  live foundation/security verifier.
- Corrected the browser authority after human smoke testing exposed discovery against the managed-login domain.
  The deployed authority is now the regional user-pool issuer; discovery returns the managed-login authorization
  endpoint, and an isolated browser reaches the Cognito sign-in page with authorization code/S256 PKCE and exact
  scopes.

## Validation results

- `npm ci`: PASS with Node 20.17.0.
- Application tests: PASS — 7 files / 84 tests.
- Foundation/backend/tooling tests: PASS — 18 files / 91 tests.
- Focused frontend API tests: PASS — 4 files / 17 tests.
- Foundation typecheck and lint: PASS.
- Foundation contract verifier: PASS — exact inventory remains seven tables, two buckets, and one each of the
  Router, StaticSite, API, API function, pool, client, domain, resource server, and JWT authorizer.
- Production build: PASS.
- Full application typecheck: inherited failure remains, but diagnostics decreased from the recorded 233 baseline
  to 196 after adding the standard Vite browser types; zero diagnostics occur in the new API/callback modules.
- Full application lint: inherited 23 errors / 0 warnings exactly match the recorded baseline; zero issue #6 path
  errors were added.
- Codex-layer validation: PASS — 31 skills and 6 custom agents.
- Codebase-search self-test: PASS.
- `git diff --check`: PASS (informational Git for Windows future line-ending warnings only).
- Named AWS identity preflight: PASS after the owner completed interactive SSO login; identifiers were withheld.
- Test preview: PASS — expected additive routes/domain/resource server, in-place User GSI/pool/client/Lambda/site
  updates, and ephemeral build/artifact replacement only; no stateful replacement or deletion.
- Test deployment: PASS — all 150 SST/Pulumi resources converged and refresh-token rotation was enabled/verified.
- Live verifier: PASS — exact inventory, active User index, managed login, discovery issuer/authorization split,
  refresh rotation, fourteen scoped CPA routes, IAM boundaries/simulations, health, and protected rejection.
- Post-deploy diff: PASS — only the ephemeral StaticSite build trigger remained.
- Isolated browser redirect smoke: PASS — the deployed app reached Cognito sign-in with code/S256 PKCE, the exact
  callback, and `openid auditflow-api/cpa`; the temporary browser profile was deleted afterward.
- Synthetic-admin bootstrap: PASS — Cognito created and enabled the account in the expected
  `FORCE_CHANGE_PASSWORD` state, requested email delivery of the invitation, and the User table contains exactly
  one linked admin fixture. No address or subject identifier is recorded in this report.
- Synthetic-user/two-user authenticated acceptance: NOT RUN — human completion of the temporary-password login
  flow is still required; the broader second-user exercise remains deferred to the agreed feature checkpoint.

## Deviations and limitations

- SST 3.19.3's bundled provider lacks the Cognito refresh-token rotation field. The implementation therefore uses
  a test-only AWS SDK post-deploy step that describes the deployed client, preserves all returned writable settings,
  enables the required grace period, and describes again to prove convergence. The deployed test client passed this
  check, and the corrective redeployment proved the step is idempotent.
- The initial browser configuration used the managed-login domain as `oidc-client-ts` authority. Human smoke testing
  correctly exposed the resulting discovery 404/CORS failure. AWS documents discovery on the regional user-pool
  issuer, while authorize/token/logout remain on managed login; the implementation and live verifier now enforce
  that split.
- Task 16 is only partially complete. Test infrastructure was deployed, browser redirect was proved, and the first
  synthetic admin plus linked User fixture were created, but the temporary-password flow and authenticated
  application exercise have not yet run.
- Layered tests cover handler authorization/routing, repositories against fake SDK commands, services/journal
  transaction composition and failure behavior, and facade compatibility. The real Gateway/Cognito/DynamoDB
  assembled path remains part of the separately authorized live exercise.
- Direct legacy function URLs bypass the compatibility facade and remain owned by downstream public/template/PDF
  migration tickets; this change neither proxies nor claims them as SST-compatible.

## Remaining gates

1. Complete the invitation's temporary-password challenge, then exercise callback, `/cpa/me`, reload/session
   restore, and managed logout.
2. Defer the broader second-user and business-mutation UI exercise until the agreed downstream feature checkpoint,
   or complete it now if the owner expands the acceptance scope.
3. Update this report from PARTIAL to COMPLETE after the selected authenticated acceptance gate passes.

## Related

- Implementation issue: `#6`
- Epic: `#1`
- Architecture: `Architecture-AuditFlow-Platform-Migration` in the repository Wiki
