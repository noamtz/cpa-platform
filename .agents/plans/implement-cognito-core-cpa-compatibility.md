# Feature: Implement Cognito and Core CPA Compatibility Services

The following plan is complete, but implementation must revalidate issue #6, the canonical Wiki architecture, the
merged SST foundation, installed SST/Pulumi types, current official Cognito behavior, and the active feature-branch
diff before changing code. Preserve legacy record fields and frontend method signatures exactly at the compatibility
boundary; do not copy Base44 authorization weaknesses or broaden this ticket into public questionnaire, file, PDF,
or template parity.

## Feature Description

Replace AuditFlow's foundational CPA-side Base44 authentication and Client/Submission/User data operations with a
same-origin AWS compatibility path. Cognito managed login supplies authorization-code/PKCE sign-in, refresh/session
restore, sign-out, and the required temporary-password first-login flow. API Gateway and the modular Lambda validate
access tokens; the Lambda then links the Cognito subject to the preserved legacy `User` profile and requires the CPA
`admin` role before any business data is read.

Behind the retained `src/api/base44Client.js` facade, migrated calls use the existing SST API, Client, Submission,
User, and ChangeJournal resources. SDK-shaped methods that are explicitly unmigrated may temporarily delegate to the
current Base44 client until their owning tickets verify AWS parity. Direct `/api/apps/{appId}/functions/{name}` calls
in public/questionnaire/file/PDF flows do not pass through this facade and are knowingly not exercisable through the
issue #6 SST Router; their route parity remains with issues #7-#10 and must not be claimed by this slice. Google Drive
and Telegram are exceptions: their visible UI remains, but every migrated action returns a controlled
`Not implemented` response without contacting either service.

Every successful DynamoDB create, update, or delete uses one `TransactWriteItems` operation that conditionally writes
the business state and one or more append-only ChangeJournal entries. A cursor item inside the existing
ChangeJournal table allocates a gap-free, lexicographically sortable global sequence in that same transaction.
Journal entries preserve changed before/after values, actor and operation identity, record hashes, and file-reference
metadata needed by issue #12's reverse replay.

## User Story

As one of the two CPA users,
I want to sign in and continue using the existing dashboard, client, settings, and team interactions,
So that the platform can move to AWS without changing my workflow or losing the ability to roll changes back.

## Problem Statement

Issue #4 provisioned the target resources but deliberately stopped at a protected health route. CPA pages still use
the Base44 browser session and SDK-shaped entity calls, the Lambda has no business router or repositories, and the
ChangeJournal table has no writer. Replacing individual page calls ad hoc would spread Cognito/token handling across
components, risk exposing unlinked or unauthorized data, change Base44-compatible list/filter/error semantics, and
allow successful AWS writes that cannot be replayed during rollback.

## Solution Statement

Extend the approved SST foundation rather than adding another backend:

1. Configure the existing no-secret Cognito app client for authorization code only, S256 PKCE, exact callback/logout
   URLs, refresh-token rotation, a managed-login domain, and one `auditflow-api/cpa` resource-server scope. The app
   client allows and the browser requests exactly `openid auditflow-api/cpa`; `email` and `profile` are deliberately
   omitted because the application profile is loaded from DynamoDB. API Gateway requires only `auditflow-api/cpa`.
2. Use exact `oidc-client-ts@3.5.0` behind a small injected browser adapter. Store OIDC transaction and user state in
   `sessionStorage`, validate state/nonce through the library, restore the intended same-origin return path, refresh
   once on an expired access token, and use Cognito's logout endpoint so the managed-login cookie is cleared.
3. Apply the existing API Gateway JWT authorizer plus the CPA scope to every issue #6 route. In Lambda, use a
   module-scoped `aws-jwt-verify@5.2.1` verifier with `tokenUse: "access"`, exact pool/client, and explicit scope
   checking. Resolve the verified `sub` through `UserTable.byCognitoSubject` and require the local legacy role.
4. Add strict Zod request schemas and fail-closed DynamoDB repositories using exact
   `@aws-sdk/client-dynamodb@3.1116.0`, `@aws-sdk/lib-dynamodb@3.1116.0`, and
   `@aws-sdk/client-cognito-identity-provider@3.1116.0`. Preserve legacy fields and metadata in responses while
   stripping internal keys such as `record_type`, `cognito_sub`, and mutation version.
5. Expose bounded, index-backed list/filter/create/update behavior for Client, bounded list/filter/update behavior
   for Submission, current-user/list/invite behavior for User, and a server-generated cryptographic Client token.
   Keep full CPA lifecycle orchestration and template/public/file/PDF operations with their later tickets.
6. Serialize every business mutation through a ChangeJournal coordinator. The coordinator reads one strongly
   consistent cursor, then atomically advances it, applies conditional business changes, and writes contiguous
   journal entries. Cursor conflicts retry with a bound; validation, authorization, and conflict failures write
   neither state nor journal evidence.

## Out of Scope / Non-Goals

- Not included: public `client_id + token` lookup, questionnaire template selection, autosave, resume, completion, or
  signing-state persistence; issue #7 owns those routes and their security contract.
- Not included: private S3 upload/download, signed URLs, ZIP generation, file deletion, or file-byte migration;
  issue #8 owns those operations. Journal entries record file references only.
- Not included: PDF Lambda migration or PDF-template behavior; issue #9 and issue #10 own those paths.
- Not included: `getActiveTemplate`, template version/history/activation, `cpaSaveSubmission`, full archive/restore
  workflows, multi-record status transitions, or CPA-assisted questionnaire parity; issue #10 completes them.
- Not included: importing the private Base44 snapshot or reconciling all six tables/files; issue #11 owns import.
- Not included: ChangeJournal reverse replay, checkpoints, or Base44 writes; issue #12 consumes this ticket's schema.
- Not included: passwordless email/SMS OTP. "One-time password" is interpreted as Cognito `AdminCreateUser`'s
  temporary password followed by required password change in managed login.
- Not included: production deployment, real CPA user creation, production callback/DNS activation, cutover, or any
  Base44 mutation. Test-stage deployment and user setup require separate explicit owner authorization.
- Temporary architecture exception requiring approval before implementation: retain `@base44/sdk` and
  `@base44/vite-plugin` only for SDK-shaped methods owned by later migration tickets. The canonical architecture's
  final state removes both at the completed compatibility boundary; record this staged-coexistence exception on the
  canonical architecture Wiki before Task 12, or stop and rescope this ticket. Migrated auth, Client, Submission,
  User, Drive, and Telegram methods must have no Base44 fallback.
- Not changing: Hebrew copy, RTL layouts, route hierarchy, current page-level auth guards, public questionnaire
  behavior, stringified Submission fields, Sentry, Terraform/PDF infrastructure, or the read-only source repository.
- Not claiming in issue #6 acceptance: direct Base44 function URLs under `/api/apps/{appId}/functions/{name}`. They
  remain available only in the currently deployed legacy path and are outside the issue #6 CPA-only SST exercise;
  a Router cutover that would expose public traffic waits for their owning tickets.

## Feature Metadata

**Feature Type**: New capability / migration compatibility slice

**Estimated Complexity**: High

**Primary Systems Affected**: Cognito/SST configuration, API Gateway route authorization, modular API Lambda,
DynamoDB repositories, ChangeJournal transaction coordinator, frontend authentication/API facade, settings/team
compatibility tests

**Dependencies**: Accepted issue #4/PR #21 foundation; merged issue #5/PR #22 export evidence; Node 20.17.0; SST
3.19.3; TypeScript 5.8; Zod 3.24.2; Vitest 4.1.6; exact AWS SDK/OIDC/JWT packages listed above

## Related Work

**Implements**: [Issue #6](https://github.com/noamtz/cpa-platform/issues/6) · **Epic**:
[Issue #1](https://github.com/noamtz/cpa-platform/issues/1) · **Architecture**:
[AuditFlow Platform Migration](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Back-references**:

- `.agents/plans/establish-sst-serverless-aws-foundation.md` - fixes the seven-table keys, one-Lambda API,
  same-origin Router, Cognito pool/client, JWT authorizer, stage protection, and validation contracts inherited here.
- `.agents/plans/inventory-export-base44-data-files.md` - defines the complete private source snapshot and preserved
  User IDs/fields that Cognito subjects must eventually link to without logging or committing identities.
- [PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration) - requires no product change,
  complete continuity, rollback safety, and hosting below the accepted cost ceiling.
- [Issue #4](https://github.com/noamtz/cpa-platform/issues/4) and [PR #21](https://github.com/noamtz/cpa-platform/pull/21)
  - accepted infrastructure dependency and security-remediation history.

**Forward-references**:

- Issue #7 consumes the shared CPA/public router, repositories, facade, and ChangeJournal mutation API for public
  questionnaire persistence while adding token-scoped authorization.
- Issue #8 consumes the journal's file-reference/effect fields and private S3 resources.
- Issue #10 completes template, assisted-questionnaire, archive/restore, status, and multi-entity CPA workflows.
- Issue #11 imports legacy User profiles and must populate/verify `cognito_sub` linkage without replacing matching
  issue #6 test/provisioning records silently.
- Issue #12 reads `scope + sequence` in descending/ascending order, verifies operation IDs and record hashes, and
  replays the journal; it must treat the cursor/idempotency item types as operational, not replay entries.

---

## PRE-IMPLEMENTATION AUTHORIZATION AND ACCESS GATE

Local code, tests, contract verification, and builds require no external mutation. Before any SST deployment,
Cognito user creation, DynamoDB fixture write, or managed-login exercise, collect one explicit owner authorization
covering the exact `test` stage and synthetic or operator-selected CPA accounts. Never request passwords, temporary
passwords, tokens, real emails, private export records, or AWS credentials in chat.

Before retaining the Base44 packages in Task 12, obtain owner approval for the temporary staged-coexistence exception
and record it on the canonical architecture Wiki: issue #6 migrates only CPA auth/core data, direct function URLs are
not available through the SST Router yet, issues #7-#10 complete those paths, and package/plugin removal occurs only
when the legacy method map reaches zero. If that amendment is not approved, stop before Task 12; do not silently
contradict the canonical removal decision or broaden issue #6 to absorb four downstream tickets.

The authorized live exercise may:

- run the established AWS identity preflight and `npm run sst:diff:test`;
- update only the existing AuditFlow `test` stage with the Cognito domain/resource server/client settings, routes,
  Lambda code, and additive User-table index;
- create bounded test Cognito users and synthetic/matching test User records, exercise first-login password change,
  session restore, invitation, logout, and authorized CRUD, then retain or remove fixtures only as separately agreed.

It may not deploy production, change DNS/certificates, touch Terraform/PDF resources, use real production data
without explicit scope, mutate Base44, or remove/recreate retained resources. A diff proposing table/user-pool
replacement, destructive index behavior, another table, public bucket/CORS, or unrelated stage drift is a hard stop.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — IMPORTANT: READ BEFORE IMPLEMENTING

- `AGENTS.md` (lines 1-29, 41-71) - repository map, AWS target, compatibility placement, parity/source-integrity,
  GitHub identity, validation, and project-artifact rules.
- `.agents/references/auditflow-frontend-conventions.md` - JavaScript/JSX, file placement, Hebrew/RTL, generated UI,
  lint, and `checkJs` boundaries.
- `.agents/references/auditflow-api-security-contracts.md` - public-versus-CPA auth boundary and exact
  `{ error: message }` 400/401/403/404/409/500 contract.
- `.agents/references/auditflow-submission-compatibility.md` - preserve `responses`, `signed_pdfs`, and
  `cpa_audit_log` strings plus legacy flat fields.
- `.agents/references/github-project-documents.md` - this repository file is the canonical plan; do not create an
  issue or Wiki duplicate.
- `sst.config.ts` (lines 27-82) - foundation composition and safe outputs. Router creation order must be adjusted
  only enough to supply exact callback/logout URLs without creating a second Router/API/Lambda.
- `infra/sst/contracts.ts` (lines 27-31, 33-104, 124-153, 176-203) - route typing, Client/Submission/User/Journal
  keys, existing route/auth contracts, exact resource inventory, and safe outputs.
- `infra/sst/auth.ts` (lines 4-39) - email-username pool and no-secret app client; managed-login domain, resource
  server, PKCE/OAuth settings, callbacks, logout, and refresh behavior are the missing issue #6 seam.
- `infra/sst/application.ts` (lines 10-89) - one API Function, environment/linking, issuer/audience authorizer,
  health route registration, Router rewrite, and StaticSite environment.
- `infra/sst/storage.ts` (lines 7-30, 63-80) - existing on-demand/PITR tables and typed table map. Add only the
  necessary User listing index; do not add a table or TTL to business/journal evidence.
- `infra/sst/deployment-policy.ts` (lines 122-190, 350-388) - workload Dynamo/Cognito permissions and test deploy
  role; add only provider actions actually required for domain/resource-server management.
- `infra/sst/foundation-contract.json` and `infra/sst/__tests__/contracts.test.ts` (lines 16-186) - exact contract
  synchronization, inventory, table/index, route, auth, and output assertions.
- `tooling/verify_sst_foundation.mjs` - contract mode currently asserts required health/protected-health presence,
  while exact route equality lives in `contracts.test.ts`; add live checks for the Cognito domain/resource server,
  app-client grant/scopes/callback/logout configuration, additive User GSI, and required CPA route authorization
  without weakening the existing inventory or health checks.
- `backend/api/handler.ts` (lines 11-51) - injected handler and safe 400/404/500 skeleton to turn into a modular
  composition root.
- `backend/api/routes/health.ts` (lines 3-25) - current JSON response primitive; generalize without changing health.
- `backend/api/__tests__/health.test.ts` (lines 6-123) - fabricated API Gateway v2 events, injected dependencies,
  route/error assertions, and non-leaking log checks to mirror.
- `src/api/base44Client.js` (lines 1-18) - retained facade filename/export and current SDK initialization. Split the
  AWS method map from a narrowly named legacy fallback.
- `src/lib/AuthContext.jsx` (lines 1-45, 99-154) - latent direct Base44 Axios/session coupling. It is not mounted,
  but must not remain an alternate Base44 auth path.
- `src/App.jsx` (lines 36-90) - public route bypass and CPA routes. Add only `/auth/callback`; preserve page guards.
- `src/pages/CpaDashboard.jsx` (lines 31-55, 58-75) - `isAuthenticated`, descending 200-row Client/Submission
  lists, and frontend join/status behavior.
- `src/pages/ClientsPage.jsx` (lines 27-53, 227-278) - archive lists, `updated_date`, Client updates, and later
  Submission restore/conflict behavior.
- `src/pages/CpaFillQuestionnaire.jsx` (lines 46-74) - CPA auth plus Client/Submission filters; template and save
  functions remain legacy until issue #10.
- `src/pages/Settings.jsx` (lines 20-75) - `me`, `updateMe`, Submission list, Drive check/connect/disconnect, and the
  two unhandled connector rejections requiring minimal UI-safe handling.
- `src/components/dashboard/TeamSection.jsx` (lines 20-47, 92-112) - current user, admin-filtered User list,
  invitation behavior, and intentionally nonfunctional visible delete icon.
- `src/components/dashboard/AddClientModal.jsx` (lines 8-28) - Client creation payload including weak browser token;
  the AWS facade/server must ignore it and generate the token securely without redesigning the form.
- `src/components/dashboard/AddSubmissionModal.jsx` (lines 16-49) - Client list, Submission filter, and Client
  year/status update shape.
- `src/components/dashboard/ClientRow.jsx` (lines 138-213, 631-760, 782-801) - Client year/token/status and direct
  Submission updates. Full lifecycle transaction consolidation remains issue #10.
- `base44/entities/Client.jsonc` (lines 5-68) - field enums/defaults; only `full_name` is source-required.
- `base44/entities/Submission.jsonc` (lines 5-20, 97-152) - client/year/status/template/string/archive fields.
- `base44/entities/User.jsonc` (lines 5-20) - role and drive path; UI-observed `id/full_name/email` are Base44 system
  metadata and exported values.
- `src/lib/submission-compat.js` (lines 6-41, 74-92, 137-174) - flat legacy mapping and fail-soft JSON readers;
  repository responses must not normalize these values.
- `docs/migration/auditflow-source-baseline.md` (lines 49-63, 93-114) - Node 20.17 and known inherited
  typecheck/lint failures; implementation must introduce no new diagnostics.
- `.agents/plans/establish-sst-serverless-aws-foundation.md` (lines 225-250, 340-370, 568-622) - inherited key,
  routing, protection, deployment, and issue #6 handoff decisions.

### Existing Files to Update

- `package.json` / `package-lock.json` - exact OIDC, AWS SDK, and JWT verification runtime dependencies; focused
  frontend API tests; do not remove Base44 packages yet.
- `sst.config.ts` - compose Router/auth/application in a dependency-safe order and expose only non-secret auth URLs.
- `infra/sst/stage.ts` - stable test/production application origins/domain-prefix policy if needed by pure config.
- `infra/sst/contracts.ts` - general HTTP method route type, CPA route definitions/scopes, User listing index,
  managed-login contract, outputs, and unchanged total resource count.
- `infra/sst/auth.ts` - resource server/scope, domain, app-client OAuth/PKCE/callback/logout/refresh configuration.
- `infra/sst/application.ts` - reuse the Router/API/Function, attach scope-protected CPA routes, inject safe browser
  OIDC config, and preserve public/protected health behavior.
- `infra/sst/deployment-policy.ts` - minimum deploy-role actions for the new Cognito child resources; do not widen
  workload business-data permissions beyond the existing tagged pool and stage tables.
- `infra/sst/foundation-contract.json`, `infra/sst/__tests__/{contracts,deployment-policy}.test.ts`, and
  `tooling/verify_sst_foundation.mjs` - exact new routes/index/domain/resource-server/output/live assertions.
- `backend/api/handler.ts` - composition root only; dependencies remain injectable for unit tests.
- `backend/api/routes/health.ts` - move/re-export the generic JSON helper without changing health response.
- `src/api/base44Client.js` - hybrid AWS/legacy facade with no fallback for migrated/deferred methods.
- `src/lib/AuthContext.jsx` - remove direct Base44 Axios/public-settings auth probe and delegate auth only to facade.
- `src/App.jsx` - add callback route while preserving existing public and CPA route layout.
- `src/pages/Settings.jsx` - catch controlled connector deferrals and always clear loading state; keep controls/copy.
- `README.md`, `.env.example`, and `AGENTS.md` - safe config names, local/auth/deferred behavior, implemented status,
  and no real identities/domain secrets.

### New Files to Create

- `src/api/http-client.js` - same-origin JSON fetch, access-token attachment, one refresh retry, and stable typed errors.
- `src/api/cognito-auth.js` - injected `oidc-client-ts` UserManager configuration/session/auth facade.
- `src/api/aws-client.js` - Client/Submission/User facade methods and controlled deferred integrations.
- `src/api/__tests__/{cognito-auth,http-client,aws-client}.test.js` - frontend protocol/facade/error/no-fallback tests.
- `src/pages/AuthCallback.jsx` - spinner-only callback completion and safe same-origin return restoration.
- `backend/api/core/{errors,http,router,request-context}.ts` - safe errors/responses, parsed routes, request IDs, and
  no-body/no-token logging.
- `backend/api/auth/{jwt,cpa-context}.ts` - module-cached verifier, claim/scope checks, User lookup, and admin role gate.
- `backend/api/contracts/{entities,change-journal}.ts` - strict ingress schemas, persisted internal metadata, public
  projections, journal entry/cursor, and field allowlists.
- `backend/api/repositories/{dynamo,client,submission,user}.ts` - injected DocumentClient and bounded access patterns.
- `backend/api/services/{change-journal,entities,users}.ts` - transactional cursor/journal coordinator, entity
  policies, secure token rotation, Cognito invitation/compensation, and current-user update.
- `backend/api/routes/{entities,me,users,deferred-integrations}.ts` - thin authenticated route adapters.
- `backend/api/__tests__/` focused fixtures/specs for auth, repositories, journal, entities/users, routes, and
  assembled CPA compatibility behavior.

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Cognito PKCE authorization code](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html#how-amazon-cognito-uses-pkce)
  - Why: S256 challenge/verifier and public-client authorization-code behavior.
- [Cognito app-client OAuth settings](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html#cognito-user-pools-app-idp-settings)
  - Why: exact callback/logout URLs, no client secret, grants, scopes, and token lifetime configuration.
- [Cognito token endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)
  - Why: authorization code and refresh grants; do not invent a browser token proxy.
- [Cognito refresh rotation and logout/revocation](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-refresh-token.html#cognito-user-pools-using-the-refresh-token)
  - Why: rotation/grace, refresh behavior, revocation, and managed-login cookie caveat.
- [Cognito AdminCreateUser](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_AdminCreateUser.html)
  and [account creation](https://docs.aws.amazon.com/cognito/latest/developerguide/how-to-create-user-accounts.html)
  - Why: temporary password, `FORCE_CHANGE_PASSWORD`, invitation delivery, expiry, and resend behavior.
- [API Gateway HTTP API JWT authorizer](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html#api-gateway-jwt-authorizer-workflow)
  - Why: issuer/audience/expiry verification, access-token scopes, forwarded claims, and JWKS cache behavior.
- [AWS Cognito JWT verification](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html#amazon-cognito-user-pools-using-tokens-verifying-a-jwt-validate)
  and [`aws-jwt-verify`](https://github.com/awslabs/aws-jwt-verify#verifying-jwts-from-amazon-cognito)
  - Why: module-scoped verifier, access-token/client/pool validation, and testable defense in depth.
- [DynamoDB transactions](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-apis-transact-write-items)
  and [transaction idempotency](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-apis-idempotency)
  - Why: atomic business+journal writes, 100-action/4-MB limits, unique-item constraint, cancellation, and 10-minute
    client token semantics.
- [DynamoDB Query](https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html)
  - Why: key conditions, sort direction, filter/limit interaction, 1-MB pagination, and consistent-read limits.
- [SST Cognito domain/client](https://sst.dev/docs/component/aws/cognito-user-pool/#domain),
  [JWT routes](https://sst.dev/docs/component/aws/apigatewayv2/#authjwt), and
  [Dynamo linking](https://sst.dev/docs/component/aws/dynamo/#link-the-table-to-a-resource)
  - Why: extend the accepted components and verify generated permissions instead of adding parallel infrastructure.
- [`oidc-client-ts` UserManager](https://authts.github.io/oidc-client-ts/classes/UserManager.html) and
  [settings](https://authts.github.io/oidc-client-ts/interfaces/UserManagerSettings.html)
  - Why: redirect callback, state/nonce, refresh, event hooks, logout, and injected web-storage configuration.

### Patterns to Follow

**Naming conventions:** TypeScript backend/infra uses kebab-case filenames, camelCase functions/variables, PascalCase
types and SST logical names. Existing React page/component files remain PascalCase default exports. New frontend API
helpers use kebab-case files and named exports.

**Strict boundary / permissive legacy read:** reject unknown request keys with strict Zod schemas. Persist and return
legacy records with approved passthrough fields so imported flat Submission properties survive. Strip only explicit
internal metadata at the response boundary.

**HTTP error pattern:**

```ts
return jsonResponse(status, { error: publicMessage, ...(safeCode ? { code: safeCode } : {}) });
```

Never expose Dynamo/Cognito names, cancellation reasons, claims, stack traces, record contents, tokens, or file URIs.
The browser error retains `message`, `status`, `code`, and safe parsed `data` because existing UI reads `err.message`.

**Repository pattern:** inject AWS clients/table names/clock/ID generator. Query only approved indexes, continue
pagination until the requested post-filter limit is filled or the keyspace ends, cap legacy calls at 200, and never
authorize from caller-supplied identity/role fields.

**Journal transaction pattern:**

```text
strongly consistent read GLOBAL / !CURSOR
  -> calculate contiguous zero-padded sequence range
  -> TransactWriteItems:
       conditionally create/update cursor to last allocated sequence
       conditionally create/update/delete business item(s)
       conditionally put one immutable journal entry per entity change
  -> retry only cursor/write conflicts with a bounded backoff
```

One journal entry contains one `entity_key`; multi-entity operations use contiguous sequences plus one
`operation_id`, `operation_index`, and `operation_count`. This preserves the existing `byEntity` GSI and enables
deterministic global replay without another table. Store only changed before/after fields for updates; store the full
record for create/delete. Reject a mutation before writing if the journal item would exceed DynamoDB's item limit;
never truncate rollback evidence.

**Hybrid facade pattern:** build the exported `base44` object explicitly. Migrated methods reference `awsClient`;
unmigrated methods reference `legacyBase44`; Google/Telegram methods reference the deferred AWS contract. Never use a
catch-based fallback from AWS to Base44, because an AWS auth/data failure must not become a silent cross-platform
write/read.

**OIDC and API scope contract:** the Cognito app client `allowedOAuthScopes` and the `oidc-client-ts` UserManager
`scope` are exactly `openid auditflow-api/cpa`. `openid` is required for the OIDC code/PKCE session; the custom scope
authorizes CPA API access. Do not request `email` or `profile`, and do not derive the app profile from token claims.
Every API Gateway business/deferred route declares `authorizationScopes: ["auditflow-api/cpa"]`; Lambda independently
requires an access token containing that same custom scope.

**Exact CPA API/facade compatibility matrix:** every path below is registered in `ApiRouteContract`, API Gateway,
and the Lambda router with the stated method. Query requests use strict JSON bodies so filter field types are not
lost in query-string coercion. All are CPA-scope protected; `{entity}` responses are bare legacy-shaped records and
query responses are bare arrays, with internal keys removed.

| Facade call | HTTP contract | Request | Success result visible to caller |
|---|---|---|---|
| `Client.list(sort?, limit?)` / `Client.filter(filter, sort?, limit?)` | `POST /cpa/clients/query` | `{ filter: {}, sort?: "-created_date", limit?: 1..200 }`; `list` sends an empty filter | Bare `Client[]`, exact-AND filters, requested order, default/cap 200 |
| `Client.create(data)` | `POST /cpa/clients` | Strict allowed Client create fields; ignore caller `id`, metadata, actor, and token | `201` plus bare created Client with server ID/token/timestamps |
| `Client.update(id, patch)` | `PATCH /cpa/clients/{id}` | Strict mutable-field patch; token is not accepted on this generic route | Bare updated Client; 404 missing, 409 conditional conflict |
| `Client.update(id, { token })` | `POST /cpa/clients/{id}/token-rotation` | Facade recognizes a token-only legacy patch and sends `{}`; it ignores the weak browser-generated token | Bare updated Client containing a new cryptographic server token |
| `Submission.list(sort?, limit?)` / `Submission.filter(filter, sort?, limit?)` | `POST /cpa/submissions/query` | `{ filter: {}, sort?: "-created_date", limit?: 1..200 }`; allowed filters include current caller keys such as `id`, `client_id`, `tax_year`, `is_archived` | Bare `Submission[]` with string fields unnormalized |
| `Submission.update(id, patch)` | `PATCH /cpa/submissions/{id}` | Strict issue-#6 mutable fields, including `is_archived` and `cpa_status`; later workflow orchestration remains #10 | Bare updated Submission; active client/year invariant enforced server-side |
| `User.list(sort?, limit?)` | `POST /cpa/users/query` | `{ filter: {}, sort?: "-created_date", limit?: 1..200 }`; facade may locally preserve any existing admin filter only if caller uses it | Bare role-authorized `User[]`, internal Cognito linkage removed |
| `auth.me()` / `auth.updateMe(patch)` | `GET /cpa/me` / `PATCH /cpa/me` | No body / strict `{ drive_base_path? }`; identity/role/email are never writable | Bare current User; `me()` returns `null` only when no local browser session exists, not for backend 401/403 |
| `users.inviteUser(email, role)` | `POST /cpa/users/invitations` | Strict `{ email, role: "admin" }` | `201` plus bare created User; facade resolves that record even though current UI ignores it |
| `functions.invoke("syncFilesToGoogleDrive", payload)` | `POST /cpa/integrations/google-drive/sync` | Preserve exactly one of check `{ check_connection: true }`, single `{ submission_id, client_id }`, or batch `{ sync_all: true, submission_ids: [...] }` shapes for validation only | Reject parsed 501 `{ error, code: "FEATURE_NOT_IMPLEMENTED", feature: "google-drive" }`; never synthesize `{ data }` success |
| `connectors.connectAppUser(id)` / `disconnectAppUser(id)` | `POST /cpa/integrations/google-drive/connect` / `POST /cpa/integrations/google-drive/disconnect` | `{ connector_id: string }` | Reject the same parsed Google 501; no URL, popup, timer, SDK, or outbound request |
| Reserved Telegram deferral | `POST /cpa/integrations/telegram/notify` | Strict non-secret event shape only when a later internal caller is wired; no current UI facade method | Reject parsed 501 with `feature: "telegram"`; no `alert_sent` write or outbound request |

All validation failures use 400, missing records 404, conditional/invariant conflicts 409, and unexpected failures 500.
The facade throws an `ApiError` retaining `message`, `status`, `code`, and safe parsed `data`; it wraps no entity/query
success response and wraps function success as `{ data }` only after that function is actually implemented by a later
ticket. Health routes remain the only scope-free application routes in this ticket.

**Direct function URL boundary:** `ClientQuestionnaire`, signing, ZIP, and related pages call
`/api/apps/{appId}/functions/{name}` directly and cannot be protected or preserved by `base44Client.js`. Do not add
those routes here, do not write a catch-all proxy, and do not assert them in issue #6 acceptance. Keep the test-stage
exercise on CPA routes; production/Router public cutover remains blocked until issues #7-#10 own those exact paths.

---

## IMPLEMENTATION PLAN

### Phase 0: Drift and authorization gate

Verify issue/epic/Wiki state, merged issue #4/#5 baselines, the clean issue-specific branch, current package/provider
types, and the boundary between local work and authorized test-stage mutations.

### Phase 1: Authentication and route foundation

Extend Cognito/app-client/domain/resource-server contracts, Router composition, scoped API routes, safe frontend
configuration, JWT verification, shared HTTP/router primitives, and current-CPA context resolution.

### Phase 2: Compatibility data and journal core

**Depends on:** Phase 1 for verified actor context and route contracts.

Implement strict entity models, bounded indexed reads, transactional mutation/journal sequencing, secure Client token
generation, Submission active-year guard semantics, User self-update/list/invitation, and Cognito compensation.

### Phase 3: Frontend facade and deferred integrations

**Depends on:** Phase 1 route/auth contracts; entity methods can be developed in parallel with Phase 2 against mocked
HTTP responses.

Add Cognito callback/session behavior, same-origin HTTP handling, explicit AWS/legacy method routing, and controlled
Google/Telegram responses with minimal Settings handling.

### Phase 4: Cross-boundary validation and authorized test exercise

Run focused/full tests and baseline comparisons, verify the exact infrastructure contract/diff, then—only with
explicit approval—deploy `test`, complete two temporary-password flows, exercise authorized/unauthorized CRUD and
journal atomicity, and prove no request contacts Base44 for migrated methods or Google/Telegram at all.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. INSPECT issue, branch, package, provider, and live-action prerequisites

- **IMPLEMENT**: Re-read issue #6, epic #1, Wiki PRD/architecture, issue #4 report/PR, issue #5 evidence, relevant
  references, current `origin/main`, and all issue #6 call sites. Confirm the branch contains no unrelated changes.
- **IMPLEMENT**: Resolve the blocking staged-coexistence decision with the owner. If approved, record the temporary
  exception on the canonical architecture Wiki through the repository's authenticated GitHub helper before code;
  otherwise stop and rescope rather than proceeding with Task 2.
- **IMPLEMENT**: Run `npm view` for the exact package versions in this plan and inspect generated SST/Pulumi Cognito
  types after `sst install`; amend only if the installed API contradicts an assumed property.
- **GOTCHA**: Planning authorization does not permit deployment or user/data creation. Do not inspect private export
  contents merely to obtain real identities; implementation fixtures use invented `.test` identities.
- **VALIDATE**: `git remote get-url origin; git status --short --branch; git merge-base --is-ancestor 126427b HEAD; npm view oidc-client-ts version; npm view aws-jwt-verify version; npm view @aws-sdk/client-dynamodb version`
- **SATISFIES**: AC #1, #7.

### 2. UPDATE dependency and test configuration

- **IMPLEMENT**: Add the exact OIDC/AWS SDK/JWT packages from the Solution Statement through npm so the lockfile is
  authoritative. Keep Base44 packages for unmigrated methods. Add/confirm focused `src/api/__tests__` discovery.
- **PATTERN**: `package.json:6-23,25-121`; `vitest.config.js:1-10`; `vitest.foundation.config.js:1-15`.
- **GOTCHA**: Lambda Node 20 does not guarantee these AWS SDK versions. Do not rely on runtime-provided packages or
  add a second validation/schema library.
- **VALIDATE**: `npm ci; npm ls oidc-client-ts aws-jwt-verify @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb @aws-sdk/client-cognito-identity-provider`
- **SATISFIES**: AC #1, #3, #7.

### 3. UPDATE SST Cognito, User-table, route, and verifier contracts

- **IMPLEMENT**: Widen `ApiRouteContract` to the exact required methods; declare all CPA/deferred routes with
  `cognito-jwt` plus `auditflow-api/cpa`; enumerate every method/path in the compatibility matrix; add User
  `record_type + created_date` and `byCreatedDate`; declare one domain, one resource server/scope, callback/logout
  policy, refresh policy, and safe auth outputs without changing seven-table inventory.
- **IMPLEMENT**: Update JSON contract and exact-route tests together. Extend the live verifier to inspect the additive
  User GSI; Cognito domain/resource server; app-client code grant, exact `openid auditflow-api/cpa` scopes,
  callback/logout URLs, and no-secret policy; and CPA route authorizer/scope attachment. Preserve existing table keys,
  required health-route checks, Router rewrite, production retention, and private buckets.
- **PATTERN**: `infra/sst/contracts.ts:33-104,124-203`; `infra/sst/__tests__/contracts.test.ts:16-186`.
- **GOTCHA**: Dynamo index changes and Cognito aliases can be replacement-sensitive. No diff may replace a table,
  user pool, app client, Router, API, or bucket. The User index exists for team listing; do not authorize with it.
- **VALIDATE**: `npm run test:foundation -- infra/sst/__tests__/contracts.test.ts; node tooling/verify_sst_foundation.mjs --mode contract --stage test`
- **SATISFIES**: AC #1, #2, #3, #7.

### 4. UPDATE `infra/sst/auth.ts`, application composition, and deploy policy

- **IMPLEMENT**: Create the existing Router before callback derivation, then configure the existing pool/client with
  stable stage domain, custom CPA resource scope, code grant only, exact origins, S256-capable public client, refresh
  rotation, logout URLs, no secret, and allowed scopes exactly `openid auditflow-api/cpa`. Attach every method/path in
  the compatibility matrix to the existing authorizer with only `auditflow-api/cpa` required and to the one Lambda.
- **IMPLEMENT**: Inject only API base, authority/domain, client ID, callback, logout, and scope into StaticSite. Add
  the minimum tagged Cognito domain/resource-server deployment actions and verify workload AdminCreateUser remains
  scoped to this stage pool.
- **PATTERN**: `infra/sst/auth.ts:4-39`; `infra/sst/application.ts:16-89`; deployment policy patterns at
  `infra/sst/deployment-policy.ts:350-388`.
- **GOTCHA**: A scope-free JWT route can accept an ID token. Every business/deferred route must require the custom
  access-token scope. Callback/logout URLs are public configuration, never credentials.
- **VALIDATE**: `npm run test:foundation -- infra/sst/__tests__/contracts.test.ts infra/sst/__tests__/deployment-policy.test.ts; npm run typecheck:foundation; npm run lint:foundation`
- **SATISFIES**: AC #1, #2, #3, #7.

### 5. CREATE shared backend HTTP, router, error, and JWT/CPA context modules

- **IMPLEMENT**: Generalize JSON responses; add strict body/query/path parsing, method/path dispatch, safe domain
  errors, request IDs, and centralized unexpected-error logging. Instantiate `CognitoJwtVerifier` once outside the
  handler and verify the raw bearer access token, client, pool, token use, expiry, and custom scope.
- **IMPLEMENT**: Query User by verified `sub`, fail closed on zero/duplicate/corrupt linkage, require legacy
  `role === "admin"`, and return a frozen internal actor context. Never trust caller IDs, emails, roles, or Gateway
  claims as the local authorization record.
- **PATTERN**: `backend/api/handler.ts:11-51`; `backend/api/routes/health.ts:3-25`;
  `backend/api/__tests__/health.test.ts:6-123`.
- **GOTCHA**: Gateway rejection occurs before Lambda, but unit/direct invocation must still fail closed. Do not log
  Authorization, claims, emails, bodies, Dynamo items, or AWS exception messages.
- **VALIDATE**: `npm run test:foundation -- backend/api/__tests__/auth.test.ts backend/api/__tests__/router.test.ts backend/api/__tests__/health.test.ts`
- **SATISFIES**: AC #2, #7.

### 6. CREATE strict entity and ChangeJournal contracts

- **IMPLEMENT**: Define Client/Submission/User persisted schemas, Base44-compatible response projections, internal
  metadata, exact create/update/filter/sort/limit schemas, journal cursor/entry schemas, operation types, and bounded
  changed-field/file-reference metadata.
- **IMPLEMENT**: Preserve unknown approved legacy record fields on read, but reject unknown mutation/filter keys.
  Keep the three Submission JSON fields strings and preserve flat legacy fields unchanged.
- **PATTERN**: `base44/entities/{Client,Submission,User}.jsonc`; `src/lib/submission-compat.js:6-41,74-92`.
- **GOTCHA**: Defaults apply only to newly created target records. Do not backfill or normalize imported values on
  read. Internal `record_type/cognito_sub/_version` never cross the facade.
- **VALIDATE**: `npm run test:foundation -- backend/api/__tests__/entity-contracts.test.ts backend/api/__tests__/change-journal-contract.test.ts`
- **SATISFIES**: AC #3, #4, #5, #7.

### 7. CREATE bounded Client, Submission, and User read repositories

- **IMPLEMENT**: Add injected DocumentClient repositories using Get/Query only. Implement `-created_date` and
  `created_date`, exact AND filters, 1-200 limits, and Dynamo pagination that fills the post-filter result limit.
  Use Client/Submission `byCreatedDate`, Submission `byClientYear`, User `byCreatedDate`, and User
  `byCognitoSubject` exactly.
- **IMPLEMENT**: Return bare ordered arrays through the facade, include legacy IDs/timestamps, and reject corrupt or
  duplicate records without returning partial data.
- **GOTCHA**: Dynamo `Limit` counts evaluated items before `FilterExpression`; continue pages. Do not Scan, expose
  cursors the existing UI cannot consume, or let `filter({id})` become an unbounded list.
- **VALIDATE**: `npm run test:foundation -- backend/api/__tests__/client-repository.test.ts backend/api/__tests__/submission-repository.test.ts backend/api/__tests__/user-repository.test.ts`
- **SATISFIES**: AC #3, #5, #7.

### 8. CREATE the atomic ChangeJournal mutation coordinator

- **IMPLEMENT**: Add strong cursor read, zero-padded 20-digit sequence allocation, first-write cursor creation,
  conditional cursor advancement, one immutable entry per entity, contiguous multi-entry operations, actor/request/
  operation metadata, before/after changed values, SHA-256 record hashes, and file-reference snapshots.
- **IMPLEMENT**: Compose conditional Put/Update/Delete business actions and journal actions in one transaction. Use a
  stable `ClientRequestToken` for same-payload transport retry; reread/reallocate only on classified cursor conflict.
  Bound retries/backoff and map validation/not-found/conflict/internal errors safely.
- **GOTCHA**: A transaction cannot target the same item twice and is capped at 100 actions/4 MB. Reject oversize
  evidence before writing. Cursor items are operational and never appear in journal replay queries.
- **VALIDATE**: `npm run test:foundation -- backend/api/__tests__/change-journal-service.test.ts`
- **SATISFIES**: AC #4, #7.

### 9. CREATE Client/Submission/User services and mutation policies

- **IMPLEMENT**: Client create generates UUID, secure base64url token, defaults, creator/timestamps, and journal;
  updates whitelist existing screen fields; exact token-only legacy update maps to server rotation and ignores the
  weak browser value. Submission updates whitelist current direct status/archive fields and maintain an internal
  active `(client_id,tax_year)` guard item when activating/archiving. User self-update allows only
  `drive_base_path`; list returns profiles; all use the coordinator.
- **IMPLEMENT**: Invitation validates admin/email/role, calls AdminCreateUser with email delivery, captures returned
  subject, creates/links User+journal transactionally, and compensates with AdminDeleteUser if Dynamo commit fails.
  Make retries distinguish already-linked idempotent success from email/profile conflict.
- **PATTERN**: current payloads in `AddClientModal.jsx:8-28`, `EditClientModal.jsx:8-29`,
  `ClientRow.jsx:138-213,631-760`, `Settings.jsx:50-54`, `TeamSection.jsx:34-47`.
- **GOTCHA**: Cognito+Dynamo cannot share one transaction. The User record and journal are atomic; Cognito is an
  idempotent external identity side effect with explicit compensation. Never accept role/sub/system metadata from
  the browser. Full multi-entity dashboard transitions stay issue #10.
- **VALIDATE**: `npm run test:foundation -- backend/api/__tests__/entity-service.test.ts backend/api/__tests__/user-service.test.ts`
- **SATISFIES**: AC #1, #3, #4, #5, #7.

### 10. CREATE thin CPA entity/current-user/invitation/deferred routes and compose handler

- **IMPLEMENT**: Register every exact method/path/request/response from the CPA compatibility matrix—no inferred
  aliases or generic catch-all entity route. Keep adapters limited to auth, validation, service call, and status/body
  mapping. Preserve health and unknown-route behavior.
- **IMPLEMENT**: Deferred routes return 501 `{ error: "Not implemented", code: "FEATURE_NOT_IMPLEMENTED", feature }`
  after authentication and never instantiate/fetch Google/Telegram clients. No `alert_sent` mutation occurs.
- **GOTCHA**: Do not add public questionnaire/function routes here. API Gateway authorizer/scope is mandatory for
  every issue #6 route, including deferred integrations, so the route itself cannot leak feature/account state.
- **VALIDATE**: `npm run test:foundation -- backend/api/__tests__/core-cpa-routes.test.ts backend/api/__tests__/deferred-integrations.test.ts`
- **SATISFIES**: AC #2, #3, #4, #6, #7.

### 11. CREATE Cognito browser auth, HTTP, and AWS facade modules

- **IMPLEMENT**: Configure injected UserManager with authority/client/callback/logout and literal scope
  `openid auditflow-api/cpa`, sessionStorage, code flow/PKCE, safe return-state sanitizer, callback completion,
  refresh/session restore, and signout redirect. Do not request `email`/`profile` or use claims as the profile. Map
  existing `auth.isAuthenticated/me/redirectToLogin/logout/updateMe` exactly.
- **IMPLEMENT**: Add same-origin fetch that attaches only the access token, retries once after refresh, parses JSON,
  and throws stable safe errors. Map `Client/Submission/User` list/filter/create/update and invitation to AWS routes;
  preserve bare arrays and Base44 method arguments.
- **GOTCHA**: Do not store Cognito state in any `base44_*` key because public pages currently remove those keys.
  Reject external return URLs. An absent/expired session makes `isAuthenticated()` false and `me()` null; protected
  entity calls still reject 401/403.
- **VALIDATE**: `npm test -- src/api/__tests__/cognito-auth.test.js src/api/__tests__/http-client.test.js src/api/__tests__/aws-client.test.js`
- **SATISFIES**: AC #1, #2, #3, #5, #7.

### 12. UPDATE the retained compatibility facade, callback route, latent AuthContext, and Settings deferral handling

- **IMPLEMENT**: Explicitly compose AWS-migrated, controlled-deferred, and legacy-unmigrated method maps in
  `base44Client.js`. Add callback page/route. Remove direct Base44 Axios auth logic from latent AuthContext. Catch
  connector deferrals in Settings, preserve UI/loading state, and surface the controlled message without opening a
  popup or scheduling connection polling.
- **IMPLEMENT**: Add a regression test/spies proving migrated methods never touch legacy SDK; unmigrated public/
  template/PDF SDK-shaped methods still delegate unchanged; direct `/api/apps/...` callers are explicitly excluded
  and not falsely asserted as working through SST; Drive/Telegram never perform external fetch.
- **GOTCHA**: Never fall back on AWS failure. Retain the Base44 packages/plugin only after the approved architecture
  amendment; do not add or reroute issue #7/#8/#9/#10 direct function paths in this ticket. Preserve existing
  Hebrew/RTL/page guards and the filename/export `base44`.
- **VALIDATE**: `npm test -- src/api/__tests__; npm run build; npx eslint src/App.jsx src/pages/Settings.jsx --quiet --no-error-on-unmatched-pattern`
- **SATISFIES**: AC #1, #3, #5, #6, #7.

### 13. ADD assembled authorization, compatibility, conflict, and journal regression tests

- **IMPLEMENT**: Assemble injected in-memory/fake AWS clients through handler→auth→service→repository. Cover valid
  admin, unlinked/role-user/wrong-client/expired/ID-token cases; list/filter/sort/limit; create/update/token rotation;
  archive guard; me/updateMe/invite/compensation; validation/not-found/conflict; journal failure rollback; concurrent
  sequence allocation; malformed stored records; and safe errors/logs.
- **IMPLEMENT**: Preserve existing submission-characterization tests and add no normalization. Assert no mutation or
  journal occurs on auth/validation/conflict and no successful mutation can bypass the journal coordinator.
- **GOTCHA**: Fixtures use invented `.test` data and opaque IDs only. Do not copy rehearsal/production rows, tokens,
  names, emails, responses, filenames, or hashes into tests/snapshots.
- **VALIDATE**: `npm run test:foundation; npm test`
- **SATISFIES**: AC #1-#7.

### 14. UPDATE safe documentation and repository status

- **IMPLEMENT**: Document browser config names, hybrid facade boundary, local callback behavior, temporary-password
  setup, test-stage authorization gate, deferred Drive/Telegram response, journal contract/limits, and downstream
  handoffs. Confirm the approved staged-coexistence amendment is present on the canonical Wiki rather than duplicating
  it in the repository. Update AGENTS status/map only after code exists.
- **IMPLEMENT**: Add no actual email, domain prefix override, pool/table name, AWS ID, token, callback deployment URL,
  or private export path/value to tracked docs or reports.
- **PATTERN**: `README.md:11-61`; `.env.example:1-9`; `AGENTS.md:1-71`.
- **GOTCHA**: Changing AGENTS requires Codex-layer validation and a fresh session before subsequent work.
- **VALIDATE**: `python tooling/validate_codex_layer.py; git diff --check`
- **SATISFIES**: AC #1, #6, #7.

### 15. RUN full local validation and review the exact test-stage diff

- **IMPLEMENT**: Run all app/foundation/tooling gates. Compare frontend typecheck/lint diagnostics with the imported
  baseline and prove no new issue #6 diagnostics. With a verified named AWS session, run preview only and inspect
  every operation/resource.
- **GOTCHA**: `typecheck` and `lint` have documented inherited failures; do not hide them, broaden excludes, or call
  them regressions if normalized diagnostics match baseline. Preview is not deployment authorization.
- **VALIDATE**: `npm test; npm run test:foundation; npm run typecheck; npm run typecheck:foundation; npm run lint; npm run lint:foundation; npm run build; node tooling/verify_sst_foundation.mjs --mode contract --stage test; python tooling/validate_codex_layer.py; git diff --check; npm run sst:diff:test`
- **SATISFIES**: AC #1-#7.

### 16. PERFORM authorized test deployment and two-user acceptance exercise

- **IMPLEMENT**: Only after the consolidated authorization gate, deploy the reviewed exact `test` diff through the
  existing workflow/command. Seed one synthetic admin linkage as test fixture under explicit scope, complete its
  Cognito temporary-password change, sign in through PKCE, invite the second synthetic CPA through the product API,
  complete the second password change, and verify refresh, page reload/session restore, me/list/update, logout, and
  rejection of expired/ID/wrong-client/unlinked/non-admin identities.
- **IMPLEMENT**: Exercise one Client create/update/token rotation, one Submission update, and one User update; read
  ChangeJournal through an operator-only AWS check to prove contiguous order, correct before/after/file metadata,
  actor/operation IDs, and atomic absence on a forced journal conflict. Confirm Drive/Telegram 501 and zero outbound
  integration calls.
- **GOTCHA**: Do not use production identities/data, deploy production, expose temporary passwords/tokens, query
  journal payloads into logs/reports, or remove test fixtures/resources without separate authorization. A replacement
  or unrelated drift aborts deployment.
- **VALIDATE**: `npm run sst:deploy:test; node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json` plus the documented owner-supervised browser/API checklist with only sanitized pass/fail evidence.
- **SATISFIES**: AC #1-#7.

---

## TESTING STRATEGY

### Unit Tests

- Auth browser adapter: PKCE redirect/callback state, safe return paths, session restore, one refresh retry, managed
  logout, storage namespace, absent/expired behavior, and typed errors.
- Backend auth: Gateway claims plus raw-token verification, access-vs-ID token, client/pool/scope/expiry, User linkage,
  duplicate linkage, admin role, and redacted logs.
- Contracts/repositories: strict mutation/filter schemas, preserved legacy fields/strings/metadata, projection of
  internal fields, every supported index path, post-filter pagination, order, limits, corrupt rows, and no Scan.
- ChangeJournal: first cursor, concurrent cursor conflicts, contiguous allocation, multi-entry grouping, conditional
  entity mutations, update deltas, create/delete snapshots, file references, hash determinism, 100-action/item-size
  guards, stable transport idempotency, failure atomicity, and safe cancellation mapping.
- Services: secure Client tokens, allowed/forbidden fields, not-found/conflict/version behavior, Submission active
  guard, updateMe ownership, invitation conflict/idempotency/compensation, and no role/sub escalation.
- Deferred features: exact 501 body and no Google/Telegram client/network construction.

### Integration Tests

- Handler-to-repository tests with fake Document/Cognito/JWT clients cover every route, status code, and response
  shape without AWS credentials.
- Frontend facade tests prove method arguments and results match current callers and that legacy delegation is an
  explicit allowlist rather than an error fallback.
- Authorized test-stage exercise verifies real managed login, forced password change, API Gateway authorizer/scope,
  Lambda verification, User linkage/role, Dynamo transactions, and session/logout behavior.

### Edge Cases

- Missing/malformed/expired/wrong-client/ID tokens; valid Cognito user without User record; duplicate subject mapping;
  local role `user`; deleted/disabled Cognito user; JWKS rotation cache behavior.
- Callback replay, state mismatch, external return URL, refresh-token rotation grace, lost network response, expired
  refresh, two tabs, public questionnaire clearing Base44 storage keys, logout without managed-cookie clearing.
- Unsupported sort/filter/limit, Dynamo 1-MB pagination, filters yielding fewer than evaluated limit, 200 cap, same
  created timestamp, corrupt persisted enum/string, legacy flat Submission and malformed JSON string.
- Concurrent journal writers, cursor initialization race, same-entity conditional conflict, transaction transport
  retry, cancellation classification, oversized evidence, operation with multiple entities, and no partial journal.
- Client create with weak browser token, token rotation request, duplicate User email, Cognito success+Dynamo failure,
  compensation failure (safe internal error plus operator alert, no claimed success), invite resend/expired temp password.
- Drive connection check/connect/disconnect/single/batch sync and Telegram invocation all return controlled deferral,
  keep UI visible, open no popup, send no network request, and mutate no `alert_sent`/sync state.

---

## VALIDATION COMMANDS

### Level 1: Syntax, contracts, and style

```powershell
npm run typecheck:foundation
npm run lint:foundation
node tooling/verify_sst_foundation.mjs --mode contract --stage test
git diff --check
```

Run `npm run typecheck` and `npm run lint` too; compare normalized diagnostics with
`docs/migration/auditflow-source-baseline.md` and require zero new diagnostics.

### Level 2: Unit tests

```powershell
npm test
npm run test:foundation
```

### Level 3: Build and assembled compatibility

```powershell
npm run build
npm run test:foundation -- backend/api/__tests__/core-cpa-routes.test.ts
npm test -- src/api/__tests__
```

### Level 4: Infrastructure preview

After the established named-profile identity preflight:

```powershell
npm run sst:install
npm run sst:diff:test
```

Expected: additive Cognito domain/resource server/client settings, additive User listing GSI, API route integrations/
authorizations, Lambda/site code/config, and safe outputs. Forbidden: another table/API/Lambda/Router, stateful resource
replacement/deletion, bucket CORS/public access, production/Terraform/PDF changes, or unrelated resource drift.

### Level 5: Authorized live validation

```powershell
npm run sst:deploy:test
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json
```

Then perform Task 16's two-user/browser/API/journal checklist. This level is required for live acceptance but is not
authorized by planning alone.

### Level 6: AI-layer validation

```powershell
python tooling/validate_codex_layer.py
uv run --script tooling/mcp/codebase_search.py --self-test
```

Run because implementation updates `AGENTS.md` repository-status context.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1 — Cognito CPA continuity:** two authorized test CPA users can use managed login's temporary-password
  first-login flow, authorization-code/S256 PKCE, refresh/session restore, current-user lookup, and managed logout;
  no client secret or credential enters browser source, logs, Git, or chat.
- [ ] **AC #2 — Fail-closed authentication/authorization:** every issue #6 business/deferred route requires the API
  Gateway CPA access-token scope and Lambda JWT verification; absent, malformed, expired, ID, wrong-client, unlinked,
  duplicate-linked, disabled, and non-admin identities fail consistently without reading or leaking business data.
- [ ] **AC #3 — AWS core compatibility:** dashboard/settings/team-required Client, Submission, and User reads plus
  foundational mutations work through indexed AWS modules while preserving IDs, legacy fields/string values,
  metadata, list/filter/sort/limit behavior, bare arrays, and safe error shapes.
- [ ] **AC #4 — Atomic ordered ChangeJournal:** every successful delivered Dynamo create/update/delete commits with
  immutable contiguous journal evidence in the same transaction; failures leave neither state nor journal; entries
  contain sufficient changed before/after, hashes, actor/operation, and file-reference metadata for issue #12.
- [ ] **AC #5 — Narrow compatibility facade:** existing callers retain `base44` method signatures without broad UI
  rewrite; migrated methods never call/fallback to Base44, explicitly unmigrated SDK-shaped methods continue the
  verified legacy path until their tickets replace them, and direct function URLs are neither proxied nor claimed.
- [ ] **AC #6 — Controlled integration deferral:** Drive and Telegram controls remain visible, return the documented
  501/typed `Not implemented` response, contact neither external service, create no connector/notification secret,
  and mutate no sync/alert state.
- [ ] **AC #7 — Contract/security coverage:** tests cover success, ownership/role, validation, not-found, conflict,
  token/session, list/filter/order, transaction concurrency/idempotency, journal rollback evidence, invitation
  compensation, deferred integrations, legacy string preservation, safe logs, and full existing regressions.
- [ ] Exact foundation inventory remains seven tables, two buckets, one Router/site/API/Lambda/pool/client/authorizer;
  the approved preview contains no stateful replacement/deletion or unrelated platform change.
- [ ] App/foundation tests and build pass; foundation typecheck/lint pass; frontend typecheck/lint have no diagnostics
  beyond the committed imported baseline; Codex-layer validation passes after AGENTS changes.
- [ ] No production deployment/user/data creation, DNS/certificate change, Terraform/PDF mutation, Base44 mutation,
  or source-repository write occurred.

---

## COMPLETION CHECKLIST

- [ ] Every task executed in order and its focused validation passed before continuing.
- [ ] Current issue/epic/Wiki and exact installed AWS/SST/OIDC APIs were revalidated.
- [ ] Owner approved and the canonical Wiki records the temporary staged Base44 coexistence exception.
- [ ] Cognito client is no-secret, code-only, PKCE, exact-origin, scoped, rotation-enabled, and logout clears managed
  login; allowed/requested scopes are exactly `openid auditflow-api/cpa`; test and production callback policies are
  distinct.
- [ ] Gateway scope and Lambda verifier both require access tokens; local User linkage/role is authoritative.
- [ ] No business query occurs before actor resolution and no unapproved filter causes a Scan.
- [ ] All legacy response fields/metadata/stringified Submission values remain byte/character compatible.
- [ ] Client tokens are generated/rotated server-side with cryptographic entropy.
- [ ] Every delivered business mutation is conditional, version-aware, and journal-coordinated.
- [ ] Journal cursor, sequences, operation grouping, hashes, changed fields, file references, size/action limits, retry,
  and cancellation behavior are tested.
- [ ] Invitation handles Cognito/Dynamo non-atomicity through idempotency and compensation without claiming false
  success or exposing identities.
- [ ] Facade has explicit migrated/deferred/legacy allowlists and no catch-based fallback.
- [ ] Public questionnaire, files, PDFs, templates, full lifecycle orchestration, and import/replay remain deferred;
  direct `/api/apps/...` function URLs are not represented as issue #6 SST parity.
- [ ] Drive/Telegram have zero outbound requests and controlled UI-safe errors.
- [ ] Full validation, baseline comparison, contract verifier, diff inspection, and authorized live exercise (if
  authorized) are recorded with sanitized evidence.
- [ ] README/env/AGENTS are truthful and contain no real identity, credential, resource name, or private export data.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Temporary password interpretation:** This plan treats the issue's approved “one-time-password setup flow” as
  Cognito `AdminCreateUser` invitation with temporary password and `FORCE_CHANGE_PASSWORD`, matching the canonical
  architecture. If the owner means passwordless email/SMS OTP, stop before implementation; that changes pool/app
  client policy, UX, recovery, and security testing.
- **Blocking staged-coexistence decision:** Base44 SDK/plugin retention is a temporary deviation from the canonical
  final removal decision, even though it is motivated by the repository parity rule and downstream ownership. Obtain
  owner approval and amend the canonical architecture Wiki before Task 12. If rejected, stop and rescope; migrated
  and deferred issue #6 methods must never reach Base44 either way.
- **Direct-function limitation:** SDK-shaped legacy methods can remain delegated, but direct
  `/api/apps/{appId}/functions/{name}` callers bypass the facade and are not usable through the issue #6 SST Router.
  The issue #6 live exercise is CPA-only and no public Router cutover occurs until issues #7-#10 provide those paths.
- **User bootstrap/linkage:** Production identities are not created by this ticket's local implementation. The
  product invitation service supports subsequent users; the first authorized test admin linkage is an explicitly
  scoped fixture/owner operation. Issue #11 must import/link the real preserved User profiles before cutover.
- **Journal global cursor:** One cursor serializes the single firm's low-volume writes. This intentionally trades
  horizontal write throughput for strict atomic ordering and simple rollback. If measured contention becomes
  material, change the architecture before sharding; sharding would change reverse-replay ordering.
- **Journal payload size:** Update entries store only changed before/after fields; create/delete store complete record
  snapshots and file-reference metadata. A record too large to fit safely with evidence is rejected before mutation
  and becomes a blocking design input for private S3 journal blobs; evidence is never truncated.
- **Invitation atomicity:** Cognito cannot participate in DynamoDB transactions. The plan interprets “atomically in
  ChangeJournal” as atomic User-record+journal persistence and uses idempotent Cognito creation plus compensation.
  This is explicitly surfaced, tested, and never represented as cross-service atomicity.
- **One approval remains before execution:** the owner must accept and record the staged Base44 coexistence amendment.
  Subject to that gate, the literal OIDC/API scopes, method/path/payload/result matrix, User listing index,
  auth/session storage, JWT authority, entity access patterns, sequence allocation, error shapes, deferrals, tests,
  and live authorization boundary are specified.

## NOTES (open canvas)

### Why a transactional cursor instead of timestamps or ULIDs

Timestamp/ULID sort keys are unique and approximately ordered but cannot prove commit order across concurrent Lambda
environments. A separate counter update would create gaps or a mutation outside the business transaction. The
existing `(scope, sequence)` table supports one cursor item and numeric journal items in the same partition. A strong
read plus conditional transactional cursor advance provides a deterministic total order and no committed gaps. The
single-firm workload makes its contention cost acceptable.

### Why a hybrid facade instead of removing Base44 immediately

The executable application uses one SDK object for both CPA and public/template/file paths. Replacing the object
wholesale before downstream routes exist would break SDK-shaped legacy behavior and violate the repository's parity
rule. Explicit method maps let issue #6 prove its migrated paths are AWS-only while preserving only those unrelated
calls that actually traverse the facade. They cannot preserve direct `/api/apps/...` fetches, so the issue #6 SST
exercise is deliberately CPA-only and public Router cutover remains blocked. After the owner records this temporary
architecture exception, each later ticket shrinks the legacy map; Base44 packages are removed at zero.

### Data and authorization flow

```text
CPA browser
  -> Cognito managed login (authorization code + S256 PKCE)
  -> access token in session-scoped OIDC state
  -> same-origin /api/cpa/* request
  -> API Gateway issuer/audience/scope validation
  -> Lambda aws-jwt-verify access-token validation
  -> UserTable.byCognitoSubject(sub) + role=admin
  -> strict request schema
  -> indexed entity read OR journal-coordinated mutation
  -> Base44-compatible response projection / safe {error}
```

### Confidence Score

**8.5/10** for one-pass implementation. Issue #4 supplies unusually explicit resource, IAM, routing, and test
contracts, and the frontend has one narrow compatibility seam. Remaining execution risk is concentrated in SST's
provider-specific Cognito domain/resource-server transforms, the additive User GSI diff on the deployed test table,
and the cross-service Cognito invitation compensation path. The plan makes each a focused, fail-closed task before
live deployment.

## AMENDMENTS

(None at creation.)
