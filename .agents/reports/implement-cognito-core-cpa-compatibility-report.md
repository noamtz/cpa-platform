# Implementation Report — Cognito core CPA compatibility

**Plan**: `.agents/plans/implement-cognito-core-cpa-compatibility.md`

**Issue**: `#6`

**Branch**: `feature/implement-cognito-core-cpa-compatibility`

**Status**: PARTIAL — local implementation and validation are complete; the test-stage preview is blocked by an
expired named AWS SSO session, and deployment/user/data creation plus live acceptance were not authorized.

## Summary

Implemented the local Cognito and AWS compatibility slice for the CPA application. The SST contract now defines
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
- Named AWS identity preflight: BLOCKED — the SSO token expired and automatic refresh failed. No SST preview was
  attempted without a verified identity.
- Test deployment/live verifier/two-user acceptance: NOT RUN — not authorized by this execution request.

## Deviations and limitations

- SST 3.19.3's bundled provider lacks the Cognito refresh-token rotation field. The implementation therefore uses
  a test-only AWS SDK post-deploy step that describes the deployed client, preserves all returned writable settings,
  enables the required grace period, and describes again to prove convergence. It has not been run against AWS.
- Task 15's exact test-stage diff could not be reviewed because the established named AWS SSO session had expired.
  Reauthenticate that session, rerun the identity preflight, and then run `npm run sst:diff:test`; preview remains
  distinct from deployment authorization.
- Task 16 remains intentionally pending. No AWS deployment, user creation, temporary-password exercise, DynamoDB
  fixture, external integration call, production operation, or Base44/source-repository mutation occurred.
- Layered tests cover handler authorization/routing, repositories against fake SDK commands, services/journal
  transaction composition and failure behavior, and facade compatibility. The real Gateway/Cognito/DynamoDB
  assembled path remains part of the separately authorized live exercise.
- Direct legacy function URLs bypass the compatibility facade and remain owned by downstream public/template/PDF
  migration tickets; this change neither proxies nor claims them as SST-compatible.

## Remaining gates

1. Restore the named AWS SSO session and run the sanitized identity preflight.
2. Run and inspect `npm run sst:diff:test`; abort on replacement, deletion, or unrelated drift.
3. Obtain explicit authorization before `npm run sst:deploy:test`, synthetic user/data creation, or the two-user
   browser/API/journal acceptance exercise.
4. After those live gates pass, update this report from PARTIAL to COMPLETE with sanitized evidence only.

## Related

- Implementation issue: `#6`
- Epic: `#1`
- Architecture: `Architecture-AuditFlow-Platform-Migration` in the repository Wiki
