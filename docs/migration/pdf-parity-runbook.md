# SST PDF parity and rollback runbook

This runbook proves the dedicated SST test PDF API preserves the active signing contract before it can replace the
Terraform-managed test renderer. Use only the synthetic fixture for automated evidence and disposable,
non-production-like records for the owner-run signing exercise. Never place endpoint URLs, signed file URLs,
templates, field values, signatures, tokens, or client data in committed evidence.

## Safety boundary and prerequisites

- Use Node 20.17.0 and region `il-central-1` with an independently verified AuditFlow AWS identity.
- `sst diff` is read-only review, not deployment approval. The owner has authorized issue #9's full SST `test`
  deployment only in synthetic-only mode, with application and ZIP-worker legacy file reads pinned to `false`.
- `npm run verify:file-cutover:test` remains the hard gate for issue #11's later legacy-read enablement. A missing or
  failing artifact is expected before #11 and does not block synthetic-only issue #9 acceptance.
- Production deployment, production preview, DNS, Terraform, and the imported legacy Lambda workflows are outside
  this procedure and remain prohibited without separate authorization.
- Lambda's complete synchronous proxy response must remain below 6 MB; because generated PDFs are base64-encoded
  inside that response, the practical raw-PDF ceiling is roughly 4.5 MiB, not 6 MiB. API Gateway separately permits
  10 MB HTTP payloads. The verifier measures the complete modeled proxy response, caps decoded reads at 6,291,456
  bytes, and caps each request at 30 seconds even if Lambda could continue running.

Install and validate locally:

```powershell
$env:Path = "C:\Users\ntzur\AppData\Roaming\nvm\v20.17.0;$env:Path"
npm ci
npm run test:pdf
npm run test:foundation
npm run typecheck:foundation
npm run lint:foundation
npm run build
node tooling/verify_sst_foundation.mjs --mode contract --stage test
npm run sst:diff:test
```

After preview, verify the exact Heebo copy source plus the staged Linux ARM64 `@napi-rs/canvas` package and AArch64
ELF binary. When SST has materialized the deployment archive, the same command prefers `code.zip` and verifies the
font inside it:

```powershell
npm run verify:pdf-bundle -- --artifacts .sst\artifacts --function PdfRendererFunction
```

## Endpoint selection

The active browser resolver uses this priority, with trailing slashes removed:

1. A nonblank build-time `VITE_PDF_API_URL`.
2. The retained production legacy URL only when `window.location.hostname` is `app.ddcpa.co.il`.
3. The retained test legacy URL for every other hostname.

The SST site contract sets `VITE_PDF_API_URL=/pdf`; CloudFront routes the `/pdf` prefix to the dedicated SST PDF API. The
raw API and the same-origin Router path expose exactly `GET /health`, `POST /render-pages`,
`POST /generate-pdf`, and `OPTIONS /{proxy+}`.

For the authorized synthetic-only test acceptance, deploy through `npm run sst:deploy:test` only, then verify the
live foundation reports `LEGACY_FILE_READS_ENABLED=false` for both the application API and ZIP worker. Use only
disposable synthetic clients, submissions, templates, generated PDFs, signatures, and owned uploads. A negative
probe containing a legacy-shaped reference must return 404 without a signed URL, source-object read, or ZIP job.
Delete or clearly isolate the exact disposable fixtures after evidence capture; review resolved identifiers before
cleanup and do not target a stage, table, bucket, or prefix broadly. Verify the live raw and Router PDF paths with
`tooling/verify_sst_foundation.mjs`. To prove rollback, rebuild the test site with
`VITE_PDF_API_URL` set to the retained legacy **test** base URL and repeat the smoke journey. To restore SST, rebuild
with `/pdf`. Do not add a browser-persisted toggle and never select the production legacy URL in a test exercise.

## Synthetic cross-endpoint evidence

Keep URLs in shell variables so they are not written to command history or evidence. Run the compact profile first,
then representative and boundary profiles only after compact passes:

```powershell
$env:AUDITFLOW_LEGACY_PDF_TEST_URL = "<owner-supplied-legacy-test-base-url>"
$env:AUDITFLOW_SST_PDF_TEST_URL = "<verified-sst-test-base-url>"
npm run verify:pdf-parity -- `
  --legacy-url "$env:AUDITFLOW_LEGACY_PDF_TEST_URL" `
  --sst-url "$env:AUDITFLOW_SST_PDF_TEST_URL" `
  --fixture lambda/pdf-generator/__fixtures__/rtl-multipage-case.json `
  --profile compact `
  --output <private-or-approved-aggregate-output.json>
```

The verifier calls legacy twice before SST. The boundary profile carries a deterministic off-page image resource so
both its request and base64-bearing Lambda proxy response approach their synchronous 6 MB ceilings without changing
visible page pixels. Exact response hashes are required only when the two legacy responses
prove stable. Otherwise, it falls back to PDF structure and lossless local RGBA comparison. Pixel mismatch counts a
pixel once when any RGB channel exceeds the fixture delta. The accepted ratio is the larger of the fixture minimum
and legacy self-variance plus margin, capped at 1%; legacy self-variance above 1% fails calibration.

Evidence schema version 1 contains only endpoint labels, statuses, durations, byte counts, page counts/dimensions,
synthetic-artifact SHA-256 hashes, pixel counts/ratios, thresholds, limits, and verdicts. Review the JSON before
committing an approved aggregate artifact. A nonzero verifier exit or `passed: false` blocks cutover.

After an authorized live run, collect the matching CloudWatch Lambda `REPORT` aggregates: invocation count,
duration, billed duration, and maximum memory used for cold and warm compact/representative/boundary calls. Record
only ranges or aggregates with observation times; do not copy request logs. The handler's structured measurements
are limited to route label, status, duration, byte/page counts, RSS/configured memory, and request ID.

## Owner-run supported-browser acceptance

Follow the active `/questionnaire/sign` journey in `src/docs/PDF_MODULE.md`. Every selected cell must complete:
render → Hebrew text → checkbox on/off → mouse/touch signature → generate → upload → save → return → refresh/resume
→ retrieve/reopen. Verify fixed page layout and field/signature placement. Repeat the smoke path once with the
legacy test override to prove rollback.

| Date/time (Asia/Jerusalem) | Device | OS/version | Browser or in-app browser/version | Endpoint label | Actions completed | Expected/actual signed-record facts | Reopened artifact | Resume result | Sentry observation | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-02 15:00–15:24 | Desktop | Windows 11 | Chrome 152 | SST test | Hebrew and mixed RTL/numeric fields, checkbox, mouse signature, generate, private upload, save | Synthetic signed record persisted and remained retrievable | PASS; two pages and placement visually checked | PASS after refresh | Unavailable; not inferred | PASS |
| 2026-09-02 | Pixel 10 | Android / version not supplied | Link opened from WhatsApp in external Chrome / version not supplied; WKWebView not exercised | SST test | Touch signing, generate/save, refresh/resume, reopen | Owner confirmed the synthetic signed record persisted and remained retrievable | PASS | PASS | Unavailable; not inferred | PASS — owner accepted Chrome handoff for issue #9 AWS migration scope |
| 2026-09-02 15:00–15:24 | Desktop | Windows 11 | Chrome 152 | Legacy test rollback | Hebrew and mixed fields, checkbox, mouse signature, generate, private upload, save | Synthetic replacement signed record persisted and remained retrievable | PASS | PASS after refresh; SST `/pdf` build restored afterward | Unavailable; not inferred | PASS |

Do not infer a Sentry result: record the exact observation window and whether it was unavailable or inconclusive.
Any failed selected cell, new relevant crash, misplaced field, output over 6 MB, request over 30 seconds, or inability
to retrieve/resume blocks cutover and leaves the legacy test selection in place.
