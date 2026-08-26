# Implementation Report — Prove SST PDF generation and signing parity

**Plan**: `.agents/plans/prove-sst-pdf-generation-signing-parity.md`

**Branch**: `feature/prove-sst-pdf-generation-signing-parity`

**PR**: [#27](https://github.com/noamtz/cpa-platform/pull/27)

**Status**: PARTIAL

## Summary

Implemented the complete local PDF parity boundary: a dedicated compute-only SST PDF API/function, same-origin
`/pdf` Router integration, active signer endpoint selection and transport helper, deterministic Hebrew/RTL
multipage fixtures, handler/contract/frontend tests, staged-bundle and cross-endpoint parity verifiers, and the
operational runbook/workflow gate. Post-review remediation now makes the size-boundary profile exercise the complete
base64-bearing Lambda proxy envelope and makes staged/native verification a mandatory pre-deploy workflow step.
Tasks 1–11 and the read-only preview portion of task 12 are complete. The preview
exposed and then verified a fix for Windows staging of native canvas: the function now explicitly installs the Linux
ARM64 N-API package and loads PDF.js only after injecting its N-API DOM globals. Deployment/parity evidence and
owner-run browser/rollback acceptance remain gated by missing issue #11 cutover evidence and the lack of explicit
deployment/manual-test authorization.

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
- Clean install: PASS — `npm ci`; inherited peer/engine/deprecation warnings and 34 audit findings remain.
- Dependency tree: PASS — direct `@napi-rs/canvas@0.1.100`, PDFme `6.1.1`, and
  `pdfjs-dist@3.11.174` resolved as pinned. PDFme UI retains its own `pdfjs-dist@5.7.284` transitive dependency.
- Focused PDF tests: PASS — 3 files / 22 tests.
- Foundation/backend/tooling tests: PASS — 31 files / 224 tests.
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
- Protected provenance: PASS — source/rewrite SHA-256 matches for legacy Lambda package/lock/build/font and both
  Terraform stage files; no imported PDF workflow or `src/instrument.js` diff.
- SST provider install: PASS.
- AWS identity: PASS — owner-authorized SSO login completed and STS matched the account configured for
  `ntz-taxflow` without printing identity values into the report.
- Read-only SST test diff: PASS — SST synthesized 180 resources and the new PDF API/function, four routes,
  `/pdf/*` Router route, `VITE_PDF_API_URL=/pdf`, bounded logs, and execution-role boundary. The same preview also
  contains the already-known undeployed private-file/ZIP resources described by the repository migration status;
  no Terraform, DNS, production, or imported workflow change appeared and nothing was deployed.
- Native staging inspection: PASS — `.sst/artifacts/PdfRendererFunction-src` contains
  `@napi-rs/canvas-linux-arm64-gnu@0.1.100`; its 27,711,392-byte native artifact starts with ELF magic
  `7F454C46`. The staged bundle loads PDF.js dynamically after assigning N-API `DOMMatrix`/`Path2D`.
- PDF runtime-asset verifier: PASS for preview staging — the command consumes `PdfRendererFunction-src`, verifies
  the exact 122,012-byte Heebo copy source and SHA-256, exact Linux ARM64 N-API package/version, and the ELF64
  AArch64 machine header. CI now runs it after preview and before deployment. The live verifier downloads and checks
  the actual deployed `code.zip`; that post-deploy archive check remains NOT RUN until deployment is authorized.
- Private-file cutover gate: expected BLOCK — `missing_evidence`; issue #11 has not published the required aggregate
  evidence artifact.
- Test deploy/live parity/manual browser matrix: NOT RUN — deployment gate, authorization, and deployed SST URL are
  absent.

## Deviations from the plan

- Tasks 13 and 14 were intentionally not executed. The plan requires explicit deployment authorization, accepted
  issue #11 evidence, a verified AuditFlow AWS identity, and owner-run supported-browser work; none is currently
  available.
- SST preview does not materialize the final PDF `code.zip` for a new function. The verifier therefore proves the
  preview's exact native staging plus font copy source before deployment, then the live verifier inspects the actual
  AWS deployment archive after an authorized deploy rather than manufacturing a local archive and presenting it as
  SST output.
- No `docs/migration/pdf-parity-evidence.json` was created: evidence must come from the authorized deployed legacy
  and SST test endpoints, not a fabricated or local-only run.
- The byte-stability probe deliberately crosses a one-second PDF metadata clock tick between the two legacy calls.
  This prevents timestamp-bearing output from being misclassified as stable while preserving the plan's exact-byte
  requirement for genuinely stable legacy output.

## Issues encountered

- `npm ci` reports inherited peer conflicts, an engine warning for PDFme UI's transitive PDF.js 5 package under the
  repository-pinned Node 20.17.0, deprecations, and 34 audit findings. The dedicated Lambda/verifier import is pinned
  to PDF.js 3.11.174 and all focused native-runtime tests pass.
- The first successful preview revealed that PDF.js's optional `canvas` installer staged a Windows PE binary and
  omitted the optional N-API Linux ARM64 package. The platform package is now declared both as an exact root
  dependency (so SST resolves `0.1.100`, not `*`) and an optional dependency (so Windows `npm ci` can skip its
  incompatible binary), and installed explicitly by the function contract. The final preview proved the exact
  N-API binary is ARM64 ELF. PDF.js is dynamically loaded after setting N-API globals so it does not initialize the
  optional Node canvas shim.
- SST continues to emit a non-fatal Windows temporary-log cleanup warning and spends about five minutes installing
  PDF.js's optional canvas dependency during each preview.

## Ready for the next step

PR #27 contains the locally validated implementation and remains a draft. Its two advisory review findings were
resolved with an iteration-count regression and PR-range whitespace validation. It should not be treated as a fully
accepted parity proof until issue #11 evidence exists and the owner authorizes the gated test deployment and manual
matrix. After those plan tasks pass, rerun the PR review gate before human approval.
