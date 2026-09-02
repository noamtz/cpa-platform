# Implementation Report — Prove SST PDF generation and signing parity

**Plan**: `.agents/plans/prove-sst-pdf-generation-signing-parity.md`

**Branch**: `feature/prove-sst-pdf-generation-signing-parity`

**PR**: [#27](https://github.com/noamtz/cpa-platform/pull/27)

**Status**: LIVE VALIDATED; OWNER BROWSER MATRIX PENDING

## Summary

Implemented the complete local PDF parity boundary: a dedicated compute-only SST PDF API/function, same-origin
`/pdf` Router integration, active signer endpoint selection and transport helper, deterministic Hebrew/RTL
multipage fixtures, handler/contract/frontend tests, staged-bundle and cross-endpoint parity verifiers, and the
operational runbook/workflow gate. Post-review remediation now makes the size-boundary profile exercise the complete
base64-bearing Lambda proxy envelope and makes staged/native verification a mandatory pre-deploy workflow step.
Tasks 1–13 are complete under the owner-approved synthetic-only exception, with application and ZIP-worker legacy
reads pinned off. The test deployment, live foundation verifier, raw and same-origin PDF routes, compact,
representative, and boundary parity profiles, and aggregate CloudWatch measurements pass. The final owner browser
matrix remains pending authentication plus the mobile/in-app-browser and legacy rollback cells.

## Tasks completed

- Baseline/provenance and protected-file checks → source and rewrite hashes compared; Terraform, imported PDF
  workflows, font/build/package evidence, and Sentry instrumentation preserved.
- Runtime dependencies and scripts, including the explicit optional Linux ARM64 N-API package → `package.json`,
  `package-lock.json` (UPDATE).
- Synthetic Hebrew/RTL multipage and load profiles →
  `lambda/pdf-generator/__fixtures__/rtl-multipage-case.json` (CREATE).
- Injectable, aggregate-logging PDF handler → `lambda/pdf-generator/index.mjs` (UPDATE).
- Handler characterization/native-runtime tests → `lambda/pdf-generator/__tests__/handler.test.mjs` (CREATE).
- PDF test/lint discovery → `vitest.foundation.config.js`, `eslint.config.js` (UPDATE).
- Dedicated PDF resource contract and function/API → `infra/sst/contracts.ts`,
  `infra/sst/foundation-contract.json`, `infra/sst/pdf.ts` (CREATE/UPDATE).
- Router/site/output composition → `infra/sst/application.ts`, `sst.config.ts` (UPDATE).
- Contract/live verifier and artifact verifier → `infra/sst/__tests__/contracts.test.ts`,
  `tooling/verify_sst_foundation.mjs`, `tooling/verify_pdf_bundle.mjs` (CREATE/UPDATE).
- Active signer resolver/transport → `src/lib/pdf-api.js`, `src/pages/PdfSignIframeOverlay.jsx` (CREATE/UPDATE).
- Frontend resolver/transport characterization → `src/lib/__tests__/pdf-api.test.js` (CREATE).
- Bounded structural/byte/RGBA cross-endpoint verifier → `tooling/verify_pdf_parity.mjs`,
  `tooling/verify_pdf_parity.test.mjs` (CREATE).
- Operations and CI gates → `docs/migration/pdf-parity-runbook.md`, `README.md`,
  `.github/workflows/deploy-sst-test.yml` (CREATE/UPDATE).

## Tests added

- `lambda/pdf-generator/__tests__/handler.test.mjs`: OPTIONS, health/font, malformed/missing request handling,
  render/generate failures, native render, page fallback, binary PDF headers/body, input flattening, aggregate-log
  redaction, multipage dimensions/order, and exact Heebo bytes/hash.
- `src/lib/__tests__/pdf-api.test.js`: endpoint priority/fallback/trailing slashes, exact render transport, raw PDF,
  raw/JSON/object base64 fallbacks, malformed responses, and server errors.
- `tooling/verify_pdf_parity.test.mjs`: self-variance calibration, unstable-byte fallback, 1% cap, deterministic
  near-limit boundary output, complete Lambda proxy-response sizing, explicit over-limit rejection, 6 MB decoded
  read ceiling, timeout, URL/query redaction, exact legacy/SST iteration counts, and real local handler end-to-end
  parity runs.
- `tooling/verify_pdf_bundle.test.mjs`: preview-directory and archive verification, exact font/package identity, and
  rejection of an x64 ELF renamed as the ARM64 native binary.
- `infra/sst/__tests__/contracts.test.ts`: separate PDF inventory, exact runtime/routes/packages/font, no links or data
  permissions, permissions boundary, Router rewrite, and site environment contract.

## Validation results

- Node runtime: PASS — `v20.17.0`.
- Clean install: PASS — `npm ci`; inherited peer/engine/deprecation warnings and 36 audit findings remain.
- Dependency tree: PASS — direct `@napi-rs/canvas@0.1.100`, PDFme `6.1.1`, and
  `pdfjs-dist@3.11.174` resolved as pinned. PDFme UI retains its own `pdfjs-dist@5.7.284` transitive dependency.
- Focused PDF tests: PASS — 3 files / 22 tests.
- Foundation/backend/tooling tests: PASS — 31 files / 234 tests.
- Full browser-facing tests: PASS — 12 files / 108 tests.
- Focused frontend characterization: PASS — 4 files / 40 tests.
- Foundation typecheck/lint: PASS — zero diagnostics.
- Touched frontend/helper lint: PASS — zero diagnostics.
- Full application typecheck: inherited failure — exit 2 / 150 diagnostics (latest report: 151; pinned import
  baseline: 233), with zero diagnostics in touched paths.
- Full application lint: inherited/generated failure — exit 1 / 19 errors, 0 warnings: 16 inherited source errors
  plus three generated `.sst/artifacts` rule-metadata errors, with zero diagnostics in touched source paths.
- Vite build: PASS.
- Foundation contract verifier: PASS — schema v3 with 1 ordinary API/function and 1 PDF API/function.
- Codex layer validator: PASS — 31 skills / 6 custom agents.
- `git diff --check`: PASS; only configured line-ending notices.
- Protected provenance: PASS — the imported Lambda baseline was verified before its intentional testability and
  aggregate-logging edits; both Terraform stages, all imported PDF workflows, and `src/instrument.js` remain
  unchanged from the PR merge base.
- SST provider install: PASS.
- AWS identity: PASS — owner-authorized SSO login completed and STS matched the account configured for
  `ntz-taxflow` without printing identity values into the report.
- Read-only SST test diff: PASS — SST synthesized 180 resources and the new PDF API/function, four routes,
  `/pdf` Router prefix, `VITE_PDF_API_URL=/pdf`, bounded logs, and execution-role boundary. The same preview also
  contains the already-known undeployed private-file/ZIP resources described by the repository migration status;
  no Terraform, DNS, production, or imported workflow change appeared and nothing was deployed.
- Native staging inspection: PASS — `.sst/artifacts/PdfRendererFunction-src` contains
  `@napi-rs/canvas-linux-arm64-gnu@0.1.100`; its 27,711,392-byte native artifact starts with ELF magic
  `7F454C46`. The staged bundle loads PDF.js dynamically after assigning N-API `DOMMatrix`/`Path2D`.
- PDF runtime-asset verifier: PASS for preview and live deployment — the command consumes `PdfRendererFunction-src`, verifies
  the exact 122,012-byte Heebo copy source and SHA-256, exact Linux ARM64 N-API package/version, and the ELF64
  AArch64 machine header. CI runs it after preview and before deployment; the live verifier also downloaded and
  checked the deployed `code.zip`.
- Private-file cutover gate: expected BLOCK — `missing_evidence`; issue #11 has not published the required aggregate
  evidence artifact.
- Test deployment: PASS — owner-authorized synthetic-only SST test deployment converged without Terraform, DNS,
  production, or legacy-endpoint changes. Both application and ZIP-worker legacy reads are deployed as `false`.
- Live foundation verifier: PASS — deployed resource inventory, Node 20/ARM64 PDF runtime, exact font/native bundle,
  raw and same-origin health/render paths, exact handler CORS, permissions boundary, IAM denial simulations, private
  storage, ZIP notification, Cognito, and least-privilege deployment policy all passed.
- Cross-endpoint PDF parity: PASS — compact (2 SST iterations), representative (2), and boundary (1) all returned
  correct page counts/dimensions with zero rendered-pixel mismatch. Boundary evidence records a 5,717,960-byte
  request, 4,224,444-byte generated PDF, and 5,632,968-byte SST Lambda proxy envelope, all within configured limits.
- Aggregate SST runtime observations, 2026-09-02 13:17–13:18 Asia/Jerusalem: compact successful render/generate
  invocations used 35–73/425–515 billed ms with 184–194 MB maximum memory; representative used 251–264/411–480
  billed ms with 216–223 MB; boundary used 3,250/2,252 billed ms with 353/366 MB. A cold health initialization used
  1,001 billed ms and 166 MB. No request content or endpoint URL is retained in committed evidence.
- Failure behavior: PASS — live health/OPTIONS/malformed-JSON probes return 200/200/400; focused handler tests cover
  upstream fetch, render, and generation failures; verifier timeout/read/proxy limits fail closed.
- Desktop browser smoke: PENDING — deployed site and managed login were opened successfully; authenticated signing
  flow awaits owner completion of Cognito login. Mobile WhatsApp/WKWebView and legacy rollback cells remain owner-run.

## Deviations from the plan

- The owner approved the Wiki-recorded synthetic-only exception: issue #11 aggregate import evidence is not required
  for issue #9 acceptance while both legacy-read switches remain pinned off and only disposable synthetic data is
  used. The ordinary issue #11 gate still blocks enabling either legacy reader and remains an expected failure.
- Task 14 cannot be completed solely through headless automation: the desktop flow requires the owner's Cognito
  authentication, and WhatsApp/WKWebView touch behavior requires an owner-controlled mobile device.
- SST preview does not materialize the final PDF `code.zip` for a new function. The verifier therefore proves the
  preview's exact native staging plus font copy source before deployment, then the live verifier inspects the actual
  AWS deployment archive after an authorized deploy rather than manufacturing a local archive and presenting it as
  SST output.
- `docs/migration/pdf-parity-evidence.json` contains the aggregate-only authorized live boundary run; it contains no
  endpoints, tokens, customer data, or request content.
- The byte-stability probe deliberately crosses a one-second PDF metadata clock tick between the two legacy calls.
  This prevents timestamp-bearing output from being misclassified as stable while preserving the plan's exact-byte
  requirement for genuinely stable legacy output.

## Issues encountered

- `npm ci` reports inherited peer conflicts, an engine warning for PDFme UI's transitive PDF.js 5 package under the
  repository-pinned Node 20.17.0, deprecations, and 36 audit findings. The dedicated Lambda/verifier import is pinned
  to PDF.js 3.11.174 and all focused native-runtime tests pass.
- The first successful preview revealed that PDF.js's optional `canvas` installer staged a Windows PE binary and
  omitted the optional N-API Linux ARM64 package. The platform package is now declared both as an exact root
  dependency (so SST resolves `0.1.100`, not `*`) and an optional dependency (so Windows `npm ci` can skip its
  incompatible binary), and installed explicitly by the function contract. The final preview proved the exact
  N-API binary is ARM64 ELF. PDF.js is dynamically loaded after setting N-API globals so it does not initialize the
  optional Node canvas shim.
- SST continues to emit a non-fatal Windows temporary-log cleanup warning and spends about five minutes installing
  PDF.js's optional canvas dependency during each preview.
- The first CI deployment attempt exposed two missing least-privilege actions used by SST: CloudWatch Logs
  `ListTagsForResource` and API Gateway v2 tag `POST`. Narrow stage-scoped statements and regression/live assertions
  were added; no broad resource or action wildcard was introduced for either operation. A final fresh-eyes review
  then identified that request-tag conditions alone could let an unrelated API adopt the stage tags. The deployed
  statement now also requires the target API's existing AuditFlow test resource tags, and a negative IAM simulation
  proves request tags alone are denied.
- SST 3.19.3 normalizes `cors: false` to an empty API Gateway CORS object, which suppressed the handler-owned CORS
  headers. The PDF API transform now removes that object entirely; live raw and Router responses prove exact CORS.
- Live API Gateway created one integration per route even though all four target the same Lambda. The live verifier
  now resolves integration IDs and asserts the shared function URI instead of assuming a shared integration ID.
- SST Router prefix matching requires `/pdf`, not `/pdf/*`. The corrected prefix and rewrite were redeployed and the
  same-origin `/pdf/health`, render, and generation paths passed.
- The first live parity request revealed that the Terraform legacy Lambda requires `templateJson` as a JSON string,
  matching the product client. The verifier now sends that exact contract and reports safe endpoint labels in errors.

## Ready for the next step

PR #27 now contains live deployment and automated parity proof. Before it is ready for final human approval, complete
the authenticated desktop signing/reopen/resume path, the owner-run mobile WhatsApp/WKWebView cell, and one legacy
rollback smoke; record the dated results and Sentry observation, then rerun the final PR review gate.
