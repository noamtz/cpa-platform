# Feature: Prove SST PDF Generation and Signing Parity

The following plan should be complete, but it is important that the implementation agent revalidates the cited
documentation, current dependency locks, codebase patterns, and task sanity before changing code. Pay special
attention to the existing PDF request/response shapes, native ARM64 packaging, fixed-height pdfme UI constraint,
and the ownership boundary between the untouched Terraform endpoint and the new SST test path.

## Feature Description

Package the existing server-side pdfme/PDF.js renderer as a dedicated SST v3 PDF API in the `test` stage, expose it
through the existing same-origin SST Router, and prove that its health, page-rendering, PDF-generation, Hebrew/RTL,
field-placement, signature, error, and binary-response behavior matches the current Terraform-managed endpoint.
The active public signing screen will retain its existing endpoint override as a rollback/parity switch, while the
legacy test and production Terraform stacks, aliases, workflows, and deployed endpoints remain unchanged.

The work includes deterministic handler and infrastructure contracts, synthetic non-sensitive parity fixtures,
cross-endpoint structural and rendered-page comparison, aggregate performance/resource evidence, and owner-run
browser acceptance for the production signing screen. It does not redesign PDF templates, signing UX, storage, or
the legal meaning of the existing drawn signature.

## User Story

As the AuditFlow product owner,
I want the existing PDF generation and signing boundary reproduced and proven under SST,
so that the application can move to AWS without breaking Hebrew forms, client signatures, or the current rollback path.

## Problem Statement

AuditFlow currently depends on a separately Terraform-managed Node 20/ARM64 Lambda for two production-critical
operations: converting private PDF templates into server-rendered page images and generating completed pdfme PDFs.
The runtime relies on a native `@napi-rs/canvas` binary, a bundled Heebo font, pinned PDF.js behavior, binary API
Gateway responses, manual CORS, and an active frontend endpoint-selection seam. None of those behaviors is presently
expressed in the SST foundation, covered by automated PDF tests, or backed by a committed synthetic parity corpus.

Moving the signing screen to an unproven SST package risks missing native binaries or fonts, duplicated multipage
output, incorrect Hebrew/RTL placement, oversized responses, timeouts, browser crashes, or silent drift in stored
signed-PDF records. Changing the existing Terraform endpoint in place would also remove the required rollback control.

## Solution Statement

Keep `lambda/pdf-generator/index.mjs` as the behavioral handler and package it in a dedicated SST `PdfApi` plus
`PdfRendererFunction`, separate from the ordinary 10-second application API Lambda. Configure Node 20, ARM64,
1024 MB memory, a 60-second Lambda timeout, bounded log retention, explicit native dependencies, and a copied Heebo
font. Route `/pdf/*` through the existing SST Router to the new HTTP API, while leaving the legacy API URLs live.

Add handler/infrastructure tests and a synthetic Hebrew/RTL multipage fixture. Build a parity verifier that calls the
legacy and SST endpoints, compares exact stable metadata/bytes when repeatability proves them stable, otherwise
compares structural PDF facts and lossless rendered pixels against a calibrated tolerance. Record end-to-end latency,
payload sizes, status/failure behavior, Lambda configuration, and CloudWatch `REPORT` memory evidence without logging
signed URLs, template values, signatures, tokens, or client data. Extract the frontend endpoint resolver into a pure
helper so `VITE_PDF_API_URL` remains the documented old-versus-SST switch and both `/render-pages` and
`/generate-pdf` use one tested base URL.

## Out of Scope / Non-Goals

- Not included: production SST deployment, DNS cutover, Terraform apply/destroy, alias movement, or retirement of the
  old PDF endpoint. Those remain release/cutover work in issues #14/#15 and require explicit authorization.
- Not included: bypassing the issue #11 private-file import deployment gate. Full test-stage deployment and live
  acceptance wait until that aggregate-only evidence reports zero unresolved file references.
- Not included: PDF template CRUD or CPA template-management parity; issue #10 owns that workflow.
- Not included: rewriting the active signing UI, changing Hebrew copy, changing `signed_pdfs`/audit record shapes,
  changing questionnaire resume behavior, or replacing drawn signatures with cryptographic/certificate signing.
- Not included: client-side final PDF generation. Final rendering/generation stays behind the server PDF API.
- Not included: direct S3/DynamoDB permissions for the PDF Lambda. It continues to fetch a short-lived URL obtained
  through the resource-scoped file service and receives no storage link it does not need.
- Not included: a general SSRF/rate-limit/auth redesign of the inherited public `basePdfUrl` contract. Record the
  inherited risk for the production-readiness gate; do not silently change the request shape in a parity ticket.
- Not changing: `infra/test/main.tf`, `infra/prod/main.tf`, `.github/workflows/deploy-lambda.yml`,
  `.github/workflows/deploy-lambda-prod.yml`, or `.github/workflows/rollback-prod.yml`.
- Not changing: `src/instrument.js`, including the explicitly approved unmasked Sentry Replay settings.
- Not treating dev-only `PdfSignPage*`, `PdfSignTest`, `/pdf-test`, or `poc-server/` as the production route or as
  sufficient automated parity evidence.

## Feature Metadata

**Feature Type**: Enhancement / migration parity proof

**Estimated Complexity**: High

**Primary Systems Affected**: SST v3 infrastructure, PDF Lambda packaging/runtime, active public signing endpoint
selection, PDF contract/parity tests, test deployment workflow and runbook

**Dependencies**: Closed issue #4 SST foundation; implemented issue #7 public resume/update contracts; implemented
issue #8 private template URL and signed-PDF upload contracts; live deployment/acceptance gated by issue #11 evidence;
Node 20.17.0; SST 3.19.3; pdfme 6.1.1; PDF.js 3.11.174; `@napi-rs/canvas`; AWS Lambda/API Gateway/CloudWatch

## Related Work

**Implements**: [issue #9](https://github.com/noamtz/cpa-platform/issues/9)

**Epic**: [issue #1](https://github.com/noamtz/cpa-platform/issues/1) ·
[PRD](https://github.com/noamtz/cpa-platform/wiki/PRD-AuditFlow-Platform-Migration) ·
[Architecture](https://github.com/noamtz/cpa-platform/wiki/Architecture-AuditFlow-Platform-Migration)

**Depends on**: [issue #4](https://github.com/noamtz/cpa-platform/issues/4) (closed; SST foundation accepted)

**Back-references**:

- `.agents/plans/establish-sst-serverless-aws-foundation.md` - explicitly defers the PDF Lambda/SST route to #9 and
  defines stage, Router, resource-contract, permissions-boundary, CI, and Terraform-ownership rules.
- `.agents/reports/establish-sst-serverless-aws-foundation-report.md` - confirms the test Router/API/static site and
  workload boundary were deployed while the Terraform PDF stack remained untouched.
- `.agents/plans/preserve-public-questionnaire-persistence-resume.md` - owns optimistic signing-state persistence and
  reserves `/render-pages` and `/generate-pdf` for #9.
- `.agents/plans/implement-private-s3-files-zip-downloads.md` - supplies the token-authorized template URL and
  two-phase signed-PDF upload seams consumed by the active signer.

**Forward-references**:

- [issue #10](https://github.com/noamtz/cpa-platform/issues/10) - completes CPA workflow/template parity after #9.
- [issue #11](https://github.com/noamtz/cpa-platform/issues/11) - must publish zero-unresolved private-file import
  evidence before the repository permits a full SST test deployment.
- [issue #14](https://github.com/noamtz/cpa-platform/issues/14) - consumes parity, browser, performance, security-risk,
  and rollback evidence for release readiness.
- [issue #15](https://github.com/noamtz/cpa-platform/issues/15) - owns production cutover and the 72-hour watch.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md` - repository architecture, ownership boundaries, validation baseline, deployment authorization, and
  current issue #11 deployment gate.
- `.agents/references/auditflow-pdf-pipeline.md` (lines 1-5) - server-side final PDF boundary, CORS/response parity,
  lazy browser tooling, and fixed-height pdfme constraint.
- `.agents/references/auditflow-aws-operations.md` (lines 1-31) - Terraform/SST resource ownership, exact stages,
  workload boundary, deployment commands, production restrictions, and live-verification rules.
- `.agents/references/auditflow-api-security-contracts.md` (lines 1-9) - public token/resource scope, safe file URL
  boundaries, `{ error }` status semantics, and CORS on every PDF response.
- `.agents/references/auditflow-frontend-conventions.md` (lines 1-14) - JavaScript/checkJs, file placement, Hebrew/RTL,
  generated UI exclusion, and touched-path lint rules.
- `lambda/pdf-generator/index.mjs` (lines 11-70) - pdfme/PDF.js/native-canvas imports, DOM polyfills, warm Heebo load,
  exact plugin set, multipage-input flattening, and manual CORS headers.
- `lambda/pdf-generator/index.mjs` (lines 73-175) - OPTIONS/health routing, JSON/required-field validation, signed-URL
  fetch, font injection, generation, binary/base64 proxy response, and current 400/500 error bodies.
- `lambda/pdf-generator/index.mjs` (lines 179-269) - canvas factory and `/render-pages` defaults, ordered JPEG output,
  page-level 1x1 fallback, page count, and top-level errors.
- `lambda/pdf-generator/package.json` (lines 1-16) and `lambda/pdf-generator/package-lock.json` - legacy package
  intent and current lock drift that must not be assumed to describe the SST root bundle.
- `lambda/pdf-generator/build.sh` (lines 29-84) - legacy Terraform ZIP recipe, font copy, forced Linux ARM64 canvas
  binary, pruning, and package-size evidence. Preserve it as legacy behavior; do not make SST deployment depend on it.
- `lambda/pdf-generator/fonts/Heebo-Regular.ttf` - 122,012-byte Lambda font; must remain byte-identical to
  `public/fonts/Heebo-Regular.ttf` and be copied to `fonts/Heebo-Regular.ttf` inside the SST bundle.
- `infra/test/main.tf` (lines 52-65, 108-213) - legacy test values: Node 20, ARM64, 1024 MB, 60 seconds, manual CORS,
  HTTP API route keys, and outputs.
- `infra/prod/main.tf` (lines 157-282) - legacy production Lambda/version/alias/API route and rollback boundary.
- `infra/sst/application.ts` (lines 22-64) - ordinary API Lambda and permission-boundary pattern; do not fold the
  heavyweight binary PDF runtime into this function.
- `infra/sst/application.ts` (lines 66-111, 141-167) - dedicated-function configuration pattern, shared Router API
  rewrite, and StaticSite environment injection.
- `infra/sst/contracts.ts` (lines 330-376, 436-470) - Router/dedicated-worker contracts plus strict resource inventory
  and output keys that must gain explicit PDF API/function entries.
- `infra/sst/stage.ts` (lines 1-98) - exact `test`/`production` stages, `il-central-1`, protection/removal, and log policy.
- `infra/sst/deployment-role.ts` (lines 8-75) - every SST workload Lambda must receive the stage workload boundary.
- `sst.config.ts` (lines 27-88) - composition and outputs; wire the PDF component here without crossing Terraform
  ownership or initializing production.
- `infra/sst/foundation-contract.json` (lines 124-157) and
  `infra/sst/__tests__/contracts.test.ts` (lines 18-103) - JSON/TypeScript inventory synchronization and output tests.
- `tooling/verify_sst_foundation.mjs` (lines 413-456, 567-607) - live output/configuration checks to extend for the
  dedicated PDF API/function, Router health, ARM64, memory, timeout, and font/native runtime proof.
- `.github/workflows/deploy-sst-test.yml` (lines 7-28, 104-128) - path filters, validation order, private-file cutover
  gate, deployment, and live verification. Add PDF paths/checks but do not weaken the gate.
- `src/App.jsx` (lines 16, 43-66) - confirms `/questionnaire/sign` uses `PdfSignIframeOverlay`; older signers are
  disabled or dev-only.
- `src/pages/PdfSignIframeOverlay.jsx` (lines 10-21) - existing `VITE_PDF_API_URL` override, legacy host fallback,
  and issue #9-owned public template URL helper.
- `src/pages/PdfSignIframeOverlay.jsx` (lines 251-344) - required public parameters, token cleanup, authorized
  client/template/base-file loading, `/render-pages`, and Sentry load capture.
- `src/pages/PdfSignIframeOverlay.jsx` (lines 421-563) - required fields, system/static field rewriting,
  `/generate-pdf` request, raw/base64 response handling, secure upload, exact `signed_pdfs` replacement, optimistic
  save, and current error UX.
- `src/api/file-client.js` (lines 51-145) - public two-phase upload and resource-scoped template URL methods; reuse
  these and do not give the PDF Lambda direct storage access.
- `backend/api/services/files.ts` (lines 587-622) - active-submission/template authorization before issuing signed
  URLs, which is the current frontend-to-PDF trust seam.
- `src/pages/ClientQuestionnaire.jsx` (lines 185-208, 419-535) - signing route state and resume/return behavior that
  must not regress.
- `src/lib/questionnaire-steps.js` (lines 10-47) and
  `src/lib/__tests__/questionnaire-steps.test.js` (lines 87 onward) - signed-step completion/resume contract.
- `src/lib/pdfme-config.js` (lines 137-196, 267-329, 347-415) - authorized base-PDF resolution, signature validation,
  multipage flattening, and current audit behavior; useful parity evidence but not the active server transport.
- `src/components/questionnaire/LightweightSignaturePad.jsx` (lines 17-121) - mouse/touch/DPR canvas behavior used by
  the active signer.
- `src/docs/PDF_MODULE.md` (lines 128-222, 315-361) - dev-only manual harness, owner manual-validation rule,
  multipage flattening, LTR pdfme internals, and the fixed-height/no-`minHeight` crash constraint.
- `src/main.jsx` (lines 1-12) and `src/instrument.js` (lines 1-26) - Sentry loads first, wraps the app, and intentionally
  keeps Replay text/media unmasked. These files are parity evidence and must remain unchanged.
- `docs/user-journeys/04-user-journeys.md` and `docs/user-journeys/05-traceability-ledger.md` (lines 40-52, 176-189) -
  signing/generation/deployment journeys; executable code wins where ledger names are stale.
- `docs/user-journeys/06-coverage-gaps.md` (lines 169-195) - no existing component/API/E2E PDF coverage.
- `docs/migration/auditflow-source-baseline.md` (lines 51-67) - accepted imported typecheck/lint failures and the
  no-regression comparison rule.

### New Files to Create

- `infra/sst/pdf.ts` - dedicated PDF API/function construction using the existing Router and workload boundary.
- `lambda/pdf-generator/__fixtures__/rtl-multipage-case.json` - synthetic, non-sensitive fixture containing a compact
  base-PDF data URL, Hebrew/RTL text, multipage schemas, checkbox/signature inputs, expected dimensions, and visual
  tolerance policy; no client or production template data.
- `lambda/pdf-generator/__tests__/handler.test.mjs` - direct health/CORS/error/render/generate/flattening/font/native
  contract tests under Node.
- `src/lib/pdf-api.js` - pure endpoint resolver and narrow render/generate transport helpers.
- `src/lib/__tests__/pdf-api.test.js` - endpoint override/fallback and exact request/response/error tests.
- `tooling/verify_pdf_parity.mjs` - cross-endpoint stable-byte, structural, rendered-pixel, timing, payload, and
  aggregate-evidence verifier.
- `tooling/verify_pdf_parity.test.mjs` - offline verifier policy, normalization, self-variance, tolerance, and redaction
  tests using local stub endpoints/fixtures.
- `tooling/verify_pdf_bundle.mjs` - inspect the SST staged function directory after synthesis/diff and fail unless the
  exact Heebo digest and a Linux ARM64 canvas `.node` binary are present; never inspect host `node_modules` as proof.
- `docs/migration/pdf-parity-runbook.md` - endpoint switch, test-stage deployment prerequisites, parity commands,
  safe evidence fields, CloudWatch resource measurement, browser checklist, rollback, and non-production limits.
- `docs/migration/pdf-parity-evidence.json` - conditionally generated aggregate-only live evidence after authorized
  deployment; do not create or commit it while the issue #11 gate prevents the live run.

### Existing Files Expected to Update

- `package.json` and `package-lock.json` - make the handler's direct `@napi-rs/canvas` 0.1.100/PDF.js 3.11.174
  runtime dependencies explicit,
  pin the behavior-affecting versions, and add focused PDF validation commands.
- `lambda/pdf-generator/index.mjs` - only the smallest testability/safe-measurement changes needed; retain route and
  response compatibility, plugin behavior, page fallback, and binary output.
- `infra/sst/contracts.ts`, `infra/sst/foundation-contract.json`, `infra/sst/__tests__/contracts.test.ts`, and
  `infra/sst/__tests__/verify-sst-foundation.test.js` - explicit PDF resource/route/config/output contracts.
- `infra/sst/application.ts` - accept the PDF component and attach its API to `/pdf/*`; inject `/pdf` into the SST
  StaticSite build without changing the ordinary `/api/*` path.
- `sst.config.ts` - create the PDF component, compose it with the Router, and expose raw/same-origin health and
  function-name outputs.
- `tooling/verify_sst_foundation.mjs` - verify the live PDF API/function and Router path.
- `vitest.foundation.config.js` and `eslint.config.js` - include the Node PDF handler/verifier tests and Node globals.
- `src/pages/PdfSignIframeOverlay.jsx` - replace inline endpoint selection/fetch duplication with the tested helper;
  preserve visible flow, request bodies, upload/save record shape, and Sentry behavior.
- `.github/workflows/deploy-sst-test.yml` - add PDF paths and focused PDF checks while retaining the issue #11 gate.
- `README.md` - add only a concise pointer to the PDF parity commands/runbook.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [SST `aws.Function` — Node install](https://sst.dev/docs/component/aws/function/#nodejs-install)
  - Specific section: excluding native/unbundleable packages into function `node_modules`.
  - Why: `@napi-rs/canvas` and PDF.js must be explicitly installed, not accidentally tree-shaken.
- [SST `aws.Function` — Copy files](https://sst.dev/docs/component/aws/function/#copyfiles)
  - Specific section: copying package-relative assets.
  - Why: place `Heebo-Regular.ttf` at the exact path the ESM handler resolves at runtime.
- [SST `ApiGatewayV2.route`](https://sst.dev/docs/component/aws/apigatewayv2/#route)
  - Specific section: route an existing Lambda/function ARN under explicit HTTP route keys.
  - Why: preserve the three PDF route contracts without merging the handler into the ordinary API Lambda.
- [SST resource linking](https://sst.dev/docs/linking/#injecting-links)
  - Specific section: links inject typed values and permissions.
  - Why: confirms that no S3/Dynamo link should be added when the PDF Lambda only consumes an already authorized URL.
- [AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html)
  - Specific sections: 6 MB synchronous request/response, 50 MB ZIP/250 MB unzipped package, 15-minute timeout,
    memory/CPU scaling, and layer limits.
  - Why: base64 expands generated output; artifact and payload measurements are release gates.
- [AWS Lambda Node.js deployment packages](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-package.html)
  - Specific section: Linux-compatible native dependencies in ZIP deployments.
  - Why: a Windows or x64 canvas binary cannot satisfy an ARM64 Lambda.
- [AWS Lambda ephemeral storage](https://docs.aws.amazon.com/lambda/latest/dg/configuration-ephemeral-storage.html)
  - Specific section: 512-10,240 MB `/tmp`, including PDF workloads.
  - Why: retain 512 MB initially because the current code is memory-only; raise only if measured fixtures prove need.
- [API Gateway HTTP API quotas](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-quotas.html)
  - Specific section: non-increasable 30-second integration timeout and 10 MB payload limit.
  - Why: a 60-second Lambda timeout does not make a synchronous HTTP request viable beyond 30 seconds.
- [pdfme generator](https://pdfme.com/docs/getting-started#generator)
  - Specific section: Node generator input/template model.
  - Why: preserve the single merged input object so multipage templates create one document, not N documents.

### Patterns to Follow

**SST composition and ownership:**

```ts
const dedicated = new sst.aws.Function("StableLogicalName", {
  handler: "lambda/pdf-generator/index.handler",
  runtime: "nodejs20.x",
  architecture: "arm64",
  memory: "1024 MB",
  timeout: "1 minute",
  logging: { format: "json", retention: stage.isProduction ? "1 month" : "2 weeks" },
  transform: { role(args) { args.permissionsBoundary = workloadBoundaryArn; } },
});
```

Mirror `infra/sst/application.ts:66-99`. The PDF function is dedicated like the ZIP worker but has no S3 event,
business-table link, or bucket permission. Its API is a new SST-owned resource; the Terraform API remains untouched.

**Same-origin routing:**

```ts
router.route("/pdf/*", pdfApi.url, {
  rewrite: { regex: "^/pdf/(.*)$", to: "/$1" },
});
```

Mirror the `/api/*` Router rewrite at `infra/sst/application.ts:141-146`. The exact implementation may attach the
route inside `infra/sst/pdf.ts` if doing so avoids a circular component dependency, but the public path and ownership
must remain explicit and covered by contracts.

**Error handling:**

- Keep `{ error: message }` JSON and 400/500 statuses from `lambda/pdf-generator/index.mjs`.
- Keep CORS headers on OPTIONS, health, success, validation errors, page-render errors, and generation errors.
- Set SST `CORS_ORIGIN` to the exact Router origin; the raw PDF API is verifier-only for browsers and must not rely on
  the handler's legacy `*` default. Keep the default only as untouched legacy/local handler compatibility.
- Keep page-level render failure as an ordered 1x1 JPEG placeholder; do not convert it into a top-level failure.
- Do not leak `basePdfUrl`, token/query text, template JSON/values, signatures, field names, or raw error objects to
  aggregate evidence. Safe fields are route, status, duration, request/response byte counts, page count, memory,
  function version/architecture, and request ID.

**Frontend transport:**

```js
const configured = import.meta.env.VITE_PDF_API_URL;
const baseUrl = resolvePdfApiUrl({ configured, hostname: window.location.hostname });
```

The configured URL remains highest priority. With no override, `app.ddcpa.co.il` still selects the Terraform
production URL and other hosts still select the Terraform test URL. The SST StaticSite supplies `/pdf`, so only that
build selects the new path. Both operations use the same resolver; no query-string or localStorage switching.

**Parity classification:**

- First call the legacy endpoint twice with the same fixture to measure self-variance.
- Compare status, content type, page count/order/dimensions, valid `%PDF-` bytes, render defaults, and required response
  fields exactly.
- Compare SHA-256/bytes exactly only for artifacts whose two legacy runs are identical.
- Otherwise render generated PDFs locally at a pinned scale into raw RGBA/lossless PNG and compare pixels. Start with
  a maximum mismatch ratio of `max(legacy self-variance + 0.1%, 0.5%)`, capped at 1%, with a per-channel delta threshold
  recorded in the fixture. A legacy self-variance above the cap cannot auto-pass; require structural checks plus owner
  visual review and record that limitation.
- Never compare deployment ZIP hashes as output parity; package timestamps/install metadata make that an invalid gate.

---

## IMPLEMENTATION PLAN

### Phase 1: Baseline and Executable Contracts

Lock the exact reachable production behavior and create non-sensitive fixtures/tests before changing SST routing.
This prevents packaging work from silently redefining the current PDF contract.

**Tasks:**

- Confirm the imported handler/font/build/Terraform inputs still match the read-only production-source repository and
  the intentionally guarded legacy workflows remain unchanged from the implementation branch's merge base.
- Make direct runtime dependencies explicit in the root lock without upgrading pdfme/PDF.js behavior opportunistically.
- Add synthetic Hebrew/RTL multipage fixtures and direct handler contract tests.
- Add safe aggregate runtime measurements while removing business field-name logging.

### Phase 2: Dedicated SST PDF Boundary

**Depends on:** Phase 1 (the handler/package contract must be executable before infrastructure claims parity)

Create a separate SST HTTP API and ARM64 function, attach only the exact routes, copy the font, install native
dependencies, apply the workload boundary, and expose it under `/pdf/*` on the existing Router.

**Tasks:**

- Define the PDF resource/route/package contract.
- Create the PDF API/function component.
- Compose it into `sst.config.ts`, Router, StaticSite environment, outputs, JSON contract, tests, and live verifier.
- Preserve the existing `/api/*` application Lambda and all Terraform resources byte-for-byte.

### Phase 3: Frontend Switch and Cross-Endpoint Evidence

**Depends on:** Phase 2 (the new base path/output contract must be known)

Extract the current endpoint selection and transport into a pure helper, keep `VITE_PDF_API_URL` as the highest-
priority switch, and add a parity verifier/runbook for legacy versus SST test endpoints.

**Tasks:**

- Centralize endpoint resolution and render/generate response handling.
- Preserve the active signing flow, secure file helper, upload/save/resume record shape, and Sentry configuration.
- Compare exact stable facts and calibrated rendered pixels from both endpoints.
- Add CI path filters and focused checks without bypassing the issue #11 deployment gate.

### Phase 4: Test-Stage Deployment, Measurement, and Browser Acceptance

**Depends on:** Phases 1-3, explicit test-stage authorization, valid AWS identity, and issue #11's committed
zero-unresolved private-file import evidence.

Deploy the complete SST test stage, verify both raw and same-origin PDF routes, run synthetic cross-endpoint parity,
collect latency/payload/memory/failure evidence, and have the owner exercise the active signing journey in the
repository-evidenced desktop/mobile browser environments. Do not initialize production.

**Tasks:**

- Run the full repository deploy wrapper and live verifier only after the gate passes.
- Execute cold/warm and boundary fixture measurements and record aggregate-only evidence.
- Run owner manual signing acceptance, confirm Sentry evidence remains available, then switch back to the legacy
  endpoint to prove rollback selection.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### 1. VERIFY the imported PDF baseline and dependency intent

- **IMPLEMENT**: Re-run source/import provenance checks for `lambda/pdf-generator/{index.mjs,package.json,package-lock.json,build.sh,fonts/Heebo-Regular.ttf}` and the two Terraform files against the pinned manifest/read-only source. Record the current root/nested resolved versions of pdfme, PDF.js, and canvas before editing. Treat code plus direct endpoint behavior as authoritative when stale journey docs mention `/generate-and-sign` instead of the executable `/generate-pdf` route.
- **PATTERN**: `docs/migration/auditflow-source-manifest.json`, `docs/migration/auditflow-source-baseline.md:5-67`, and the accepted source hash/import workflow.
- **GOTCHA**: The nested lock currently does not fully describe every dependency declared in its package manifest; do not infer the deployed native version from one stale file or upgrade dependencies as cleanup.
- **VALIDATE**: Run this fail-fast PowerShell block; the workflows are compared to the branch merge base because their
  repository guards are intentional import deltas:

  ```powershell
  $sourceRoot = 'C:/Users/ntzur/workspace-antigravity/auditflow'
  $exactSourceFiles = @(
    'lambda/pdf-generator/index.mjs',
    'lambda/pdf-generator/package.json',
    'lambda/pdf-generator/package-lock.json',
    'lambda/pdf-generator/build.sh',
    'lambda/pdf-generator/fonts/Heebo-Regular.ttf',
    'infra/test/main.tf',
    'infra/prod/main.tf'
  )
  foreach ($relativePath in $exactSourceFiles) {
    git diff --no-index -- $relativePath (Join-Path $sourceRoot $relativePath)
    if ($LASTEXITCODE -ne 0) { throw "Source drift: $relativePath" }
  }
  $planBase = git merge-base HEAD origin/main
  git diff --exit-code $planBase -- infra/test/main.tf infra/prod/main.tf .github/workflows/deploy-lambda.yml .github/workflows/deploy-lambda-prod.yml .github/workflows/rollback-prod.yml src/instrument.js
  if ($LASTEXITCODE -ne 0) { throw 'Protected rollback/Sentry evidence changed' }
  ```
- **SATISFIES**: AC #2, #6, #8.

### 2. UPDATE `package.json` and `package-lock.json` with explicit PDF runtime dependencies/scripts

- **IMPLEMENT**: Add direct, pinned root dependencies for the handler imports that are currently only nested/transitive (`pdfjs-dist` 3.11.174 and `@napi-rs/canvas` 0.1.100), keep pdfme at the repository-resolved 6.1.1 line, and regenerate the root lock with Node 20.17.0/npm. Add `test:pdf`, `verify:pdf-bundle`, and `verify:pdf-parity` scripts. Do not change the legacy Terraform build script or make SST use its generated ZIP.
- **PATTERN**: Root `package.json:5-24` pins the runtime/SST and defines focused validation; `infra/sst/application.ts:24-99` relies on the root lock for SST bundles.
- **IMPORTS**: Existing `@pdfme/generator`, `@pdfme/schemas`, `@napi-rs/canvas`, and `pdfjs-dist/legacy/build/pdf.js` imports from `lambda/pdf-generator/index.mjs:11-27`.
- **GOTCHA**: SST `nodejs.install` packages must also exist in root `package.json`. The SST builder receives the target ARM64 architecture; prove the deployed Linux ARM64 binary with render/live tests rather than accepting a host-platform `node_modules` tree.
- **VALIDATE**: `npm ci; npm ls @pdfme/common @pdfme/generator @pdfme/schemas @napi-rs/canvas pdfjs-dist --depth=1`
- **SATISFIES**: AC #1, #3, #9.

### 3. CREATE `lambda/pdf-generator/__fixtures__/rtl-multipage-case.json`

- **IMPLEMENT**: Add a compact synthetic fixture with no production data: a deterministic two-page base PDF data URL, Hebrew/RTL text, text/checkbox/signature schemas, system/read-only and editable fields, a small synthetic signature image, merged inputs, expected two-page dimensions/order, response facts, and explicit visual thresholds. Canonical visual fields must include PDF.js/canvas identity and version, scale, background/color-space/alpha policy, page order, per-channel delta, and a mismatch ratio whose denominator is pixels (a pixel mismatches when any compared channel exceeds the delta). Define deterministic `compact`, `representative`, and `boundary` generator profiles—target request/output byte bands, repeated-page/field counts, response-read ceiling, and timeout—so near-limit cases are generated in memory instead of committed as large artifacts.
- **PATTERN**: `poc-server/test-render.mjs:14-74` for a generated minimal PDF and `src/lib/pdfme-config.js:315-329` for correct single-document input flattening.
- **GOTCHA**: Do not commit real tax forms, names, IDs, signatures, private S3 URLs, Base44 URLs, tokens, or screenshots. The data URL keeps offline tests self-contained; separately exercise a real signed S3 URL only during authorized owner acceptance.
- **VALIDATE**: `node -e "const f=require('./lambda/pdf-generator/__fixtures__/rtl-multipage-case.json'); if(!f.templateJson||!f.basePdfUrl?.startsWith('data:application/pdf;base64,')||f.expected.pageCount!==2||f.visual?.mismatchDenominator!=='pixels'||!f.profiles?.boundary) process.exit(1)"`
- **SATISFIES**: AC #2, #3, #5, #8.

### 4. UPDATE `lambda/pdf-generator/index.mjs` and CREATE `lambda/pdf-generator/__tests__/handler.test.mjs`

- **IMPLEMENT**: Drive the existing exported handler through OPTIONS, health, invalid JSON, missing fields, base-PDF fetch failure, successful two-page render, page-level fallback, successful generation, and generation failure. Assert exact status/body/header/binary flags, `%PDF-` decoding, default scale/quality, page count/order, Heebo health, input flattening, and exact configured non-wildcard SST CORS. Make only minimal handler changes needed to export/test pure helpers or inject controlled dependencies. Add structured aggregate measurements (route/status/duration/input/output bytes/pages/RSS/function memory/request ID) and remove field-name/value/URL logging; retain current user-visible errors and CORS. Add an offline byte assertion that the Lambda and browser Heebo files are both 122,012 bytes and SHA-256 `18F930B583FA8FE6B40B2F8263B7AC6AFBAC07ADC91A12467874E7467D3ACE30`.
- **PATTERN**: `lambda/pdf-generator/index.mjs:44-70,73-175,179-269` is the contract; `backend/api/__tests__/health.test.ts` and `backend/api/__tests__/router.test.ts` demonstrate direct handler/router assertions.
- **GOTCHA**: Preserve the 1x1 JPEG for a failed individual page, the raw PDF response, the legacy base64 fallback contract, the exact attachment filename, and all plugin/font behavior. Do not log the fixture's field values even though synthetic tests are safe.
- **VALIDATE**: `npm run test:pdf`
- **SATISFIES**: AC #2, #3, #5, #8, #9.

### 5. UPDATE `vitest.foundation.config.js` and `eslint.config.js` for PDF Node code

- **IMPLEMENT**: Include `lambda/pdf-generator/__tests__/**/*.test.mjs` and `tooling/verify_pdf_parity.test.mjs` in the Node-only foundation suite. Add a narrow Node-global ESLint block for the PDF handler/test/verifier files and extend `lint:foundation` paths without pulling generated `.sst` artifacts or browser-only POC pages into the rule set.
- **PATTERN**: `vitest.foundation.config.js:3-12` and the Node verifier block in `eslint.config.js`.
- **GOTCHA**: Root Vitest is for `src/**` browser-adjacent tests; keep native server tests in the foundation runner. Do not broaden lint/typecheck into unrelated imported baseline debt.
- **VALIDATE**: `npm run test:foundation; npm run lint:foundation`
- **SATISFIES**: AC #3, #9.

### 6. UPDATE `infra/sst/contracts.ts` and CREATE `infra/sst/pdf.ts`

- **IMPLEMENT**: Define a strict PDF contract with stable logical names, `GET /health`, `POST /render-pages`, `POST /generate-pdf`, Node 20, ARM64, 1024 MB, 60-second Lambda timeout, 512 MB initial ephemeral storage, `/pdf` Router prefix/rewrite, font source/destination and SHA-256, `nodejs.install: ["@napi-rs/canvas", "pdfjs-dist"]`, safe log retention, and zero storage links/permissions. Create a dedicated `sst.aws.ApiGatewayV2` plus `sst.aws.Function`; attach all route keys to the same function ARN, keep API CORS disabled because the handler owns Safari-compatible CORS, set `CORS_ORIGIN` to the exact Router origin, copy `lambda/pdf-generator/fonts/Heebo-Regular.ttf` to `fonts/Heebo-Regular.ttf` with SST 3.19.3 `copyFiles`, and apply the workload permissions boundary. The raw API URL is verification-only for browser traffic; product traffic is same-origin through `/pdf`.
- **PATTERN**: `infra/sst/application.ts:22-64` for API construction and `:66-99` for a dedicated bounded function; legacy route/runtime values in `infra/test/main.tf:52-65,108-213`.
- **IMPORTS**: `StageSettings`, the new PDF contract, and `$util.Input<string>`/SST globals consistent with other infrastructure modules.
- **GOTCHA**: API Gateway HTTP integration timeout remains 30 seconds even though Lambda is 60 seconds. The 60-second value preserves Lambda behavior for direct invocation/diagnosis; parity fixtures must complete within the HTTP limit. Do not attach tables/buckets/Cognito or create an SST replacement for the Terraform alias. Do not assume host dependency installation retained the Linux ARM64 optional canvas binary; Task 8 inspects the staged artifact and the live renderer.
- **VALIDATE**: `npm run typecheck:foundation; npm run lint:foundation; npm run test:foundation`
- **SATISFIES**: AC #1, #2, #5, #6, #8.

### 7. UPDATE `infra/sst/application.ts` and `sst.config.ts` to compose the PDF path

- **IMPLEMENT**: Create the PDF component after the shared Router and workload boundary are available; attach `/pdf/*` to the PDF API with the exact rewrite in the PDF component/composition seam; set only `StaticSite.environment.VITE_PDF_API_URL` to `"/pdf"`; return the PDF API/function from application composition; expose raw API URL, same-origin PDF base/health URLs, and function name in SST outputs. Do not change the StaticSite build command, root route, SPA fallback, existing `/api/*`, ordinary API Lambda, ZIP worker, tables, buckets, or Cognito.
- **PATTERN**: `sst.config.ts:27-88` orchestration/outputs and `infra/sst/application.ts:141-167` Router/static environment pattern.
- **GOTCHA**: Avoid circular construction: Router exists before the PDF route; StaticSite receives the final relative path. The SST test build should select `/pdf`, while a non-SST/default production build still falls back to the legacy endpoint until an explicit cutover.
- **VALIDATE**: `npm run sst:install; npm run typecheck:foundation; npm run test:foundation`
- **SATISFIES**: AC #1, #2, #7, #9.

### 8. UPDATE strict SST contracts/tests and verifiers; CREATE `tooling/verify_pdf_bundle.mjs`

- **IMPLEMENT**: Synchronize `foundation-contract.json` with a distinct exact `pdfApi` inventory/route set, PDF function inventory, and output keys; do not append PDF routes to or relax the existing application API public/CPA inventories, and do not relabel the ordinary API/ZIP worker counts. Add contract assertions for exact route keys, handler path, install/copy settings, architecture/memory/timeout/storage, exact non-wildcard CORS environment, permission boundary, Router rewrite, StaticSite endpoint, font digest, and no resource link/permission. Create `verify_pdf_bundle.mjs` to inspect the `PdfRendererFunction` staged directory after `sst diff` and require the exact font bytes plus a Linux ARM64 canvas `.node` binary. Extend the live verifier to inspect the deployed function/API, confirm ARM64/Node20/1024MB/60s, call raw and Router `/health`, require `heeboLoaded: true`, invoke a tiny render to prove the native module loads, resolve the execution role, require the expected permissions-boundary ARN, enumerate inline/attached policies (or simulate the principal), and prove S3, DynamoDB, and Cognito data actions are not allowed.
- **PATTERN**: `infra/sst/__tests__/contracts.test.ts:18-103`, `infra/sst/__tests__/verify-sst-foundation.test.js`, and `tooling/verify_sst_foundation.mjs:413-456,567-607`.
- **GOTCHA**: A config-only font path assertion and health flag are not byte-identity proof; staged-bundle digest/native inspection plus live render are required. The live role check must inspect effective data permissions, not merely source `link: []`. Do not weaken exact public/protected application API inventories or workload policy checks to make the separate PDF API pass.
- **VALIDATE**: `npm run test:foundation; node tooling/verify_sst_foundation.mjs --mode contract --stage test; npm run sst:diff:test; npm run verify:pdf-bundle -- --artifacts .sst/artifacts --function PdfRendererFunction`
- **SATISFIES**: AC #1, #2, #5, #8, #9.

### 9. CREATE `src/lib/pdf-api.js` and `src/lib/__tests__/pdf-api.test.js`; UPDATE `src/pages/PdfSignIframeOverlay.jsx`

- **IMPLEMENT**: Move endpoint resolution and narrow `renderPages`/`generatePdf` fetch handling into a named helper. Preserve precedence exactly: non-empty `VITE_PDF_API_URL`, then legacy production URL on `app.ddcpa.co.il`, otherwise legacy test URL. Normalize only trailing slashes. Test the SST `/pdf` relative override, both legacy fallbacks, render JSON/errors, raw `application/pdf`, base64 proxy fallback, and malformed responses. Update the active overlay to call the helper without changing load/submission state, Hebrew UI, required fields, template mutation, upload, audit data, `signed_pdfs`, optimistic version, navigation, or Sentry capture.
- **PATTERN**: `src/pages/PdfSignIframeOverlay.jsx:10-21,323-337,467-557`; pure helper/named-export placement follows `src/lib/questionnaire-steps.js` and its tests.
- **IMPORTS**: The new named resolver/transport methods only; retain `invokePublicFunction`, `loadPublicPdfTemplate`, `fileClient`, React Router, Sentry, and signature-pad imports.
- **GOTCHA**: Do not touch disabled/dev POC signers, do not move public file authorization into the PDF helper, and do not add an Authorization header or browser-persisted endpoint toggle. Keep current Sentry load capture and do not edit `src/instrument.js`.
- **VALIDATE**: `npm test -- src/lib/__tests__/pdf-api.test.js src/api/__tests__/function-client.test.js src/api/__tests__/file-client.test.js src/lib/__tests__/questionnaire-steps.test.js; npx eslint src/pages/PdfSignIframeOverlay.jsx --quiet; npm run build`
- **SATISFIES**: AC #2, #4, #7, #8, #9.

### 10. CREATE `tooling/verify_pdf_parity.mjs` and `tooling/verify_pdf_parity.test.mjs`

- **IMPLEMENT**: Build a non-interactive CLI accepting `--legacy-url`, `--sst-url`, `--fixture`, `--profile`, `--output`, and bounded iteration/timeout settings. Generate compact/representative/boundary payloads deterministically in memory. Run legacy twice, then SST; verify health/CORS, render response, generate response, exact stable fields/hashes, PDF structure/page dimensions, and locally rendered lossless RGBA visual differences using the fixture's pinned renderer/scale/color/alpha/page-order/channel-delta/pixel-denominator policy. Record only aggregate JSON: endpoint labels (not secret URLs), statuses, durations, byte counts, page facts, hashes only for synthetic artifacts, mismatch metrics, thresholds, and pass/fail. Exit nonzero on contract/threshold failure. Tests must prove legacy self-variance calibration, unstable-byte fallback, 1% cap, deterministic boundary generation/response-read ceiling, timeout/oversize/error handling, and redaction.
- **PATTERN**: `tooling/verify_sst_foundation.mjs` for parse/assert/JSON output and nonzero failure; `tooling/export_base44_snapshot.py:162-176,350-378` for streaming SHA-256/canonical evidence concepts; canvas/PDF.js setup from `lambda/pdf-generator/index.mjs:179-249`.
- **IMPORTS**: Node `fs`, `path`, `crypto`, performance/fetch APIs, PDF.js, and `@napi-rs/canvas`; do not add a second image library unless raw RGBA comparison proves insufficient.
- **GOTCHA**: Never print full endpoint URLs because signed query parameters may appear in other fixtures. Never declare differing PDF bytes a failure until two legacy calls prove bytes stable. Bound response reads before buffering to protect the verifier itself.
- **VALIDATE**: `npm run test:pdf; npm run verify:pdf-parity -- --help`
- **SATISFIES**: AC #2, #3, #5, #8, #9.

### 11. CREATE `docs/migration/pdf-parity-runbook.md`; UPDATE `README.md` and `.github/workflows/deploy-sst-test.yml`

- **IMPLEMENT**: Document the exact legacy/SST URL switch, synthetic parity command, evidence schema, visual calibration, expected routes, CORS, 30-second HTTP/6 MB Lambda response ceilings, CloudWatch `REPORT` memory collection, manual supported-browser checklist, legacy rollback selection, and production prohibitions. Add PDF paths (`lambda/pdf-generator/**`, helper/tests, parity tooling/runbook) to PR/push filters and run focused PDF tests before diff/deploy. Retain the private-file evidence step and skip deployment/live verification when it is not ready.
- **PATTERN**: `README.md:59-99`, `.github/workflows/deploy-sst-test.yml:7-28,104-128`, and `docs/migration/base44-export-runbook.md` for safe operational evidence.
- **GOTCHA**: Do not add a second workflow that bypasses the gate, enable the imported Lambda workflows, print AWS secrets/signed URLs, or imply `sst diff`/successful local tests authorize deployment.
- **VALIDATE**: `python tooling/validate_codex_layer.py; npm run test:foundation; npm run test:pdf; git diff --check`
- **SATISFIES**: AC #3, #5, #6, #7, #8, #9.

### 12. RUN the complete local validation and read-only SST preview

- **IMPLEMENT**: Run all focused and repository suites under Node 20.17.0. Compare full-app typecheck/lint to the accepted baseline/current latest report and require zero diagnostics in touched paths. Verify contract output and review `sst diff` for only intended new PDF API/function/Router/site/output/workflow changes. Confirm all Terraform files, imported legacy PDF workflows, and Sentry instrumentation remain unchanged.
- **PATTERN**: `.agents/references/auditflow-aws-operations.md` and `README.md:59-99`.
- **GOTCHA**: `npm run typecheck` and `npm run lint` have accepted imported failures; record exact counts and touched-path cleanliness, never relabel an inherited failure as a pass. `sst diff` is read-only and not deployment authority.
- **VALIDATE**: `npm ci; npm test; npm run test:pdf; npm run test:foundation; npm run typecheck; npm run typecheck:foundation; npm run lint; npm run lint:foundation; npm run build; node tooling/verify_sst_foundation.mjs --mode contract --stage test; python tooling/validate_codex_layer.py; git diff --check; npm run sst:diff:test`
- **SATISFIES**: AC #1-#9.

### 13. DEPLOY and VERIFY the SST test PDF path after all gates pass

- **IMPLEMENT**: With explicit authorization, a verified AuditFlow AWS identity, and issue #11 evidence accepted by `verify:file-cutover:test`, run the repository's full deploy wrapper. Run the live foundation/PDF verifier and cross-endpoint parity tool. Exercise valid small/representative/near-limit fixtures plus invalid JSON, missing fields, unreachable base PDF, page-render failure, and payload/latency boundary cases. Collect cold and warm end-to-end latency, request/response bytes, status/failure results, Lambda configuration, and CloudWatch `REPORT` duration/billed/max-memory values into the implementation report or a bounded aggregate JSON artifact. Do not include URLs, template contents, tokens, signatures, or PII.
- **PATTERN**: `package.json:18-24`, `.github/workflows/deploy-sst-test.yml:104-128`, and `tooling/verify_sst_foundation.mjs` live mode.
- **GOTCHA**: Do not deploy if the issue #11 check fails. Do not use `npx sst deploy` directly to evade the wrapper. Do not deploy/preview production or modify DNS/Terraform. A request exceeding 30 seconds or Lambda's 6 MB synchronous response ceiling fails acceptance even if direct Lambda execution could finish.
- **VALIDATE**: `npm run verify:file-cutover:test; npm run sst:deploy:test; node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json; npm run verify:pdf-parity -- --legacy-url "$env:AUDITFLOW_LEGACY_PDF_TEST_URL" --sst-url "$env:AUDITFLOW_SST_PDF_TEST_URL" --fixture lambda/pdf-generator/__fixtures__/rtl-multipage-case.json --output docs/migration/pdf-parity-evidence.json`
- **SATISFIES**: AC #1, #2, #3, #5, #6, #8, #9.

### 14. COMPLETE owner-run signing/browser and rollback-switch acceptance

- **IMPLEMENT**: Following `src/docs/PDF_MODULE.md`, have the owner use disposable, non-production-like test records to complete the active `/questionnaire/sign` journey against SST: render pages, enter Hebrew text, check/uncheck fields, draw touch/mouse signature, generate, upload, persist, return, refresh/resume, and retrieve the signed PDF. Complete the runbook's required dated matrix for every selected cell: device model, OS/version, browser or in-app-browser/version, endpoint label, exact actions, expected/actual signed-record facts, reopened artifact, resume result, start/end observation time, and verdict. Exercise desktop Chromium/Edge and the production-evidenced mobile WhatsApp in-app browser/WKWebView path; confirm no new crash and fixed layout/placement. Record whether Sentry showed no relevant new event during the observation window or was unavailable/sampling-inconclusive—never invent evidence. Rebuild/select the legacy test URL via the documented override and repeat the smoke path to prove the rollback switch.
- **PATTERN**: `src/pages/PdfSignIframeOverlay.jsx:251-563`, `src/pages/ClientQuestionnaire.jsx:185-208,487-535`, and `src/docs/PDF_MODULE.md:178-222,325-361`.
- **GOTCHA**: The repository explicitly requires user manual PDF verification; automated visual tests supplement but do not replace it. Do not use production client data, and do not post Sentry replay content or signed URLs as evidence. If the owner defines a broader browser matrix, amend this task before acceptance.
- **VALIDATE**: Follow `docs/migration/pdf-parity-runbook.md` and require every selected matrix cell to pass render → generate → upload → save → refresh/resume → retrieve with the expected endpoint label and signed-record facts; record the dated matrix and Sentry observation status in `.agents/reports/prove-sst-pdf-generation-signing-parity-report.md`.
- **SATISFIES**: AC #2, #3, #4, #7, #8.

---

## TESTING STRATEGY

### Unit and Contract Tests

- Directly invoke the Lambda handler with API Gateway v2-shaped events for OPTIONS, health, malformed JSON, missing
  inputs, fetch failure, generation failure, render failure, and successful render/generate.
- Assert CORS and JSON errors on every response path, exact binary flags/content headers, `%PDF-` output, page count,
  dimensions/order, default scale/quality, page-level fallback, font health, and flattened multipage inputs.
- Assert the SST TypeScript/JSON contracts agree on two APIs, a separate PDF API inventory, the dedicated PDF function, exact route keys, Router
  rewrite, outputs, package install/copy rules, workload boundary, and zero storage links.
- Test the endpoint resolver/transport independently from React for explicit `/pdf`, explicit absolute override,
  production legacy fallback, non-production legacy fallback, raw PDF, base64 fallback, and errors.
- Test parity policy offline: stable hashes, unstable-byte structural fallback, baseline self-variance, capped pixel
  tolerance, redaction, response-size bounding, timeouts, and nonzero exits.

### Integration and Cross-Runtime Tests

- Use one synthetic two-page fixture for both endpoints; never use production forms in CI.
- Run legacy twice before comparing SST so nondeterministic PDF metadata cannot create false byte failures.
- Compare render JSON and decoded images, generated PDF page count/dimensions/text/rendered pixels, response headers,
  error shapes, and latency/payload evidence.
- After authorized deployment, call the raw SST PDF API and same-origin Router `/pdf` path; both must reach the same
  function contract, while the ordinary `/api` routes remain unchanged.
- Verify deployed configuration with AWS APIs: Node 20, ARM64, 1024 MB, 60 seconds, 512 MB ephemeral storage,
  bounded logs, permissions boundary, effective denial of S3/DynamoDB/Cognito data actions, and `heeboLoaded: true`.

### Manual Browser Acceptance

- Owner opens an SST test questionnaire link for a disposable fixture, not `/pdf-test` as a substitute for the
  production route.
- Desktop: load pages, enter Hebrew text, toggle checkboxes, draw mouse signature, submit, download/reopen, refresh,
  and verify resume/complete state.
- Mobile/WhatsApp in-app browser: repeat with touch signature, unavailable/localStorage-safe path, scrolling, and
  return/resume behavior.
- Inspect generated field alignment and signature placement against the legacy endpoint.
- Confirm no new crash/error in the UI and that existing Sentry error/replay evidence is still available.
- Switch the same test build back to the legacy test endpoint through `VITE_PDF_API_URL`; repeat a smoke signing and
  document the rollback selection.

### Edge Cases

- OPTIONS and health through raw API and Router; exact CORS origin/headers and Safari-compatible 200 preflight.
- Invalid/missing JSON, missing `templateJson`, `basePdfUrl`, or `inputs`.
- Signed base URL returns 403/404/timeout/HTML/non-PDF/empty body.
- One render page fails while later pages succeed; placeholder remains ordered and page count unchanged.
- Hebrew RTL, punctuation/numbers, long text, checkbox true/false, empty/near-empty signature, and signature image.
- Multiple schemas/input objects; flattening must generate one N-page PDF, not N×N pages.
- Missing Heebo asset/native ARM64 binary; deployment verifier must fail rather than accept fallback/default font.
- Raw `application/pdf` and legacy base64 proxy response decoding.
- Output just below and above Lambda/API Gateway safe payload bounds; base64 expansion is included.
- Cold/warm execution close to the 30-second HTTP limit and memory pressure; no false pass on a Lambda-only result.
- Duplicate submit guard, upload failure, stale submission 409, signing-state save failure, refresh/resume, and retrieval.
- Endpoint override with/without trailing slash, relative `/pdf`, legacy hostname fallback, and malformed empty override.
- Parity bytes stable versus metadata-unstable; visual self-variance above the 1% auto-pass cap.
- WhatsApp/WKWebView localStorage access failure and touch canvas DPR resizing.

---

## VALIDATION COMMANDS

Execute every applicable command under Node 20.17.0. Deployment/live commands require the gates and authorization
listed below.

### Level 1: Dependency, Syntax, Type, and Style

```powershell
npm ci
npm ls @pdfme/common @pdfme/generator @pdfme/schemas @napi-rs/canvas pdfjs-dist --depth=1
npm run typecheck:foundation
npm run lint:foundation
npm run typecheck
npm run lint
git diff --check
```

Full-app typecheck/lint retain imported debt. Require exact count comparison and zero touched-path diagnostics; the
foundation and focused PDF paths must pass cleanly.

### Level 2: Unit and Contract Tests

```powershell
npm run test:pdf
npm run test:foundation
npm test
node tooling/verify_sst_foundation.mjs --mode contract --stage test
python tooling/validate_codex_layer.py
```

### Level 3: Build and Read-Only Infrastructure Preview

```powershell
npm run build
npm run sst:install
npm run sst:diff:test
```

Review the diff for only intended SST PDF/Router/site/output changes. No Terraform resource or production stage action
is permitted.

### Level 4: Authorized Test Deployment and Live Parity

```powershell
npm run verify:file-cutover:test
npm run sst:deploy:test
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json
npm run verify:pdf-parity -- --legacy-url "$env:AUDITFLOW_LEGACY_PDF_TEST_URL" --sst-url "$env:AUDITFLOW_SST_PDF_TEST_URL" --fixture lambda/pdf-generator/__fixtures__/rtl-multipage-case.json --output docs/migration/pdf-parity-evidence.json
```

Do not run this level until issue #11 evidence passes, AWS identity is verified, and test deployment is explicitly
authorized. Environment values must not be printed or committed.

### Level 5: Resource/Failure Measurement and Manual Validation

1. Use the runbook's bounded AWS read-only commands to correlate synthetic parity invocations with Lambda `REPORT`
   lines and record cold/warm duration, billed duration, configured/max memory, request/response sizes, and status.
2. Run the owner browser matrix against SST and legacy test paths.
3. Verify `src/instrument.js`, both Terraform stacks, and all three imported Lambda workflows have no diff.
4. Record aggregate evidence and manual verdict in the implementation report; never copy URLs/tokens/PII/replay data.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1 — SST package/runtime:** A dedicated SST test PDF function is defined and, once the issue #11 gate is
  satisfied, deploys as Node 20/ARM64 with 1024 MB, 60-second Lambda timeout, bounded logs, workload boundary,
  Linux native canvas, and Heebo asset whose staged bytes/122,012-byte size/SHA-256 exactly match the browser copy.
  Staged artifact inspection plus health and real page rendering prove the runtime assets load.
- [ ] **AC #2 — Contract compatibility:** OPTIONS, health, `/render-pages`, and `/generate-pdf` preserve request,
  response, CORS, JSON error, binary/base64, render-default, page-fallback, plugin/font, and multipage semantics.
  Public template retrieval/upload/persistence/resume behavior remains unchanged.
- [ ] **AC #3 — Automated parity:** Synthetic Hebrew/RTL multipage text, checkbox, signature, field placement, output
  structure, metadata, and pages pass exact checks where legacy output is stable and calibrated lossless visual checks
  where it is not. The verifier is non-interactive, bounded, redacted, and exits nonzero on failure.
- [ ] **AC #4 — Signing/browser continuity:** The active `PdfSignIframeOverlay` completes without new crashes in the
  repository-evidenced desktop Chromium/Edge and mobile WhatsApp/WKWebView paths; upload/save/return/refresh/resume
  work in every dated owner matrix cell, and the Sentry observation status is recorded with `src/instrument.js` unchanged.
- [ ] **AC #5 — Measured limits/failures:** Cold/warm latency, request/response sizes, configured/max memory, page count,
  output size, 30-second HTTP boundary, 6 MB Lambda response boundary, invalid input, fetch failure, render failure,
  and generation failure are measured and recorded as aggregate-only evidence. Representative flows fit the limits.
- [ ] **AC #6 — Rollback boundary:** `infra/{test,prod}/main.tf`, the legacy Lambda workflows/aliases/endpoints, and
  production resources are neither changed nor removed. No production deploy, DNS change, or Terraform action occurs.
- [ ] **AC #7 — Documented switch:** `VITE_PDF_API_URL` remains the highest-priority build-time endpoint selector;
  SST uses `/pdf`, default production remains legacy until cutover, and the runbook proves switching both directions.
- [ ] **AC #8 — Security/observability boundary:** The PDF function receives no unnecessary storage/data permissions;
  deployed IAM proof denies S3/DynamoDB/Cognito data actions; token-authorized file helpers remain the supported
  product seam; SST CORS is exact and non-wildcard; logs/evidence exclude URLs,
  tokens, client/template/signature content, and PII; the inherited arbitrary-URL risk is recorded for readiness.
- [ ] **AC #9 — Validation/no regression:** Focused PDF tests, foundation tests/typecheck/lint, root tests/build,
  contract verifier, Codex-layer validation, diff hygiene, and read-only SST preview pass as applicable. Imported
  full-app type/lint debt does not worsen and touched paths are clean.

---

## COMPLETION CHECKLIST

- [ ] Issue #9, epic #1, architecture, #4 report, #7/#8 seams, and all relevant local contracts were reread.
- [ ] PDF dependency versions are explicit and reproducible from the root lock under Node 20.17.0.
- [ ] Synthetic fixture is non-sensitive and covers Hebrew/RTL, multipage, text, checkbox, and signature behavior.
- [ ] Handler, endpoint helper, parity policy, SST resources/routes/outputs, and redaction have focused tests.
- [ ] The SST PDF function is separate from the ordinary API Lambda and has the workload boundary/no storage links.
- [ ] Same-origin `/pdf/*` and the documented legacy/SST selector are implemented without UI/copy/state changes.
- [ ] CI watches PDF paths and runs PDF validation without weakening the issue #11 gate.
- [ ] Full local validation and `sst diff` completed; Terraform/workflow/Sentry evidence files have no diff.
- [ ] Issue #11 evidence passed before any full SST test deploy.
- [ ] Authorized test deploy/live verifier and cross-endpoint parity completed.
- [ ] Aggregate latency/payload/memory/failure evidence is recorded without sensitive data.
- [ ] Owner manual desktop/mobile signing and rollback-switch matrix passed.
- [ ] Implementation report records validation outcomes, inherited risks, gate status, and any amendments.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Critical deployment gate:** The repository currently forbids a full SST test deployment until issue #11 commits
  `docs/migration/private-file-import-verification.json` with zero unresolved references. This plan assumes local
  implementation/preview can proceed now and Phase 4 waits. Do not create a targeted/bypass deployment path without
  a separately recorded architecture/owner decision proving gated file readers cannot activate.
- **Supported browser assumption:** No broader formal browser matrix is versioned. The plan treats the executable
  evidence as the minimum: desktop Chromium/Edge plus the mobile WhatsApp in-app browser/WKWebView path with touch.
  If the owner requires Safari/Firefox or specific OS/version coverage, amend Task 14 before acceptance.
- **Dependency assumption:** Preserve the root-resolved pdfme 6.1.1 behavior and PDF.js 3.11.174 handler behavior.
  Resolve the canvas version from the current lock/runtime baseline and pin it; do not select a newer version merely
  because it is available.
- **Payload/latency assumption:** Representative production-like templates fit API Gateway's 30-second integration
  and Lambda's 6 MB synchronous response limits because the current endpoint uses the same boundary. This is an
  assumption to measure, not a fact. If false, stop and amend architecture rather than silently introducing an async
  request/response contract in this parity ticket.
- **Inherited URL-fetch risk:** The current PDF API accepts a caller-provided `basePdfUrl`. Product code obtains it
  through a token/resource-scoped endpoint, but the PDF endpoint itself is independently callable. Exact parity keeps
  that shape in test. Production readiness must explicitly accept or remediate the SSRF/rate/abuse boundary before
  cutover; do not hide the risk or grant the function direct storage access as an ad hoc fix.
- **Visual threshold assumption:** The proposed 0.5%-to-1% calibrated pixel policy is a starting contract. Lock the
  final per-fixture threshold from legacy self-variance before judging SST; never loosen it after observing an SST
  mismatch without documented owner review.
- **No critical local-design question:** The accepted architecture and current seams are sufficient for Phases 1-3.
  Full issue acceptance remains conditional on the deployment gate and owner manual browser evidence.

## NOTES (open canvas)

The chosen topology deliberately keeps three concerns separate:

```text
public signer
  -> token-scoped file API -> short-lived base-PDF URL
  -> selected PDF base URL
       legacy Terraform API (rollback/parity)
       SST Router /pdf/* -> dedicated PdfApi -> PdfRendererFunction
  <- page JPEG JSON or generated PDF bytes
  -> two-phase private-file upload -> versioned signing-state save
```

The PDF Lambda is compute-only. It neither decides which client/template may be read nor persists the generated file.
That preserves the already implemented file security boundary and makes legacy/SST output comparison meaningful.

A dedicated PDF API/function is preferred over adding routes to the ordinary application API because the runtimes
have materially different constraints: 1024 MB versus 512 MB, 60 seconds versus 10 seconds, native ARM64 canvas and
font assets, binary PDF responses, PDF.js page rendering, and manual CORS. It also makes rollback evidence legible and
keeps an accidental PDF package failure from expanding the ordinary API Lambda's cold start/package size.

No async redesign is planned even though HTTP API integrations stop at 30 seconds. The issue explicitly requires the
existing render/generate contracts, and the old endpoint already exposes them synchronously. The correct ticket-level
decision is to measure production-like cases and fail the parity gate if the boundary is exceeded. An async S3 job
would be an architecture amendment and a frontend contract change, not a hidden optimization.

The existing endpoint switch already has the right rollback property. Extracting it creates testability; it should
not become a runtime user preference, URL query switch, or localStorage flag. SST supplies `/pdf` at build time;
legacy production remains the default until the release ticket deliberately changes it.

**Confidence score:** 8.0/10 for one-pass implementation. The handler/routes/frontend seam are bounded and the SST
foundation has strong contract patterns. Remaining uncertainty is concentrated in native ARM64 bundle behavior,
legacy output nondeterminism, real template size/latency, and the issue #11 live-deployment gate. Each is isolated by
an explicit executable check rather than an implicit assumption.

## AMENDMENTS

<!-- Append-only after initial approval/execution. -->
