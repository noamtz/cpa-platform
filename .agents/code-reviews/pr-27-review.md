# PR #27 review — SST PDF generation and signing parity

**PR:** https://github.com/noamtz/cpa-platform/pull/27

**State:** Draft

**Reviewed:** 2026-09-02

## Summary

Advisory verdict: the implementation and automated live evidence are ready for human acceptance, with no unresolved
Critical, High, Medium, or Low code findings. The dedicated PDF runtime, same-origin routing, exact handler CORS,
native ARM64/font bundle, bounded parity verifier, compute-only role, and legacy rollback boundary are coherent and
validated locally and in CI. The PR remains a draft because the required authenticated desktop, mobile in-app
browser, legacy rollback, and negative legacy-reference acceptance cells are not complete.

## Issue counts

| Severity | Unresolved |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

## Review routing

### AGENT FIXES

None remain.

### HUMAN DECIDES

None.

### HUMAN READS

- `infra/sst/deployment-policy.ts:380` — the API tag permission now requires matching request tags and pre-existing
  AuditFlow test resource tags, preventing an unrelated API from adopting the stage identity.
- `infra/sst/pdf.ts:48` — the API transform removes SST's empty API Gateway CORS object so the Lambda remains the
  single owner of exact browser CORS behavior.
- `tooling/verify_pdf_parity.mjs:268` — the live verifier sends `templateJson` as the same JSON string used by the
  product and applies bounded structural/visual comparisons without retaining endpoint values.

### HUMAN TESTS

- `docs/migration/pdf-parity-runbook.md:58` — run the synthetic negative legacy-reference probe and confirm 404 with
  no signed URL, source read, or ZIP job.
- `docs/migration/pdf-parity-runbook.md:107` — complete authenticated desktop signing, reopen/resume, and the dated
  Sentry observation.
- `docs/migration/pdf-parity-runbook.md:108` — complete the WhatsApp/WKWebView touch signing path.
- `docs/migration/pdf-parity-runbook.md:109` — complete one legacy-test rollback smoke path.

### FYI

- `tooling/verify_sst_foundation.mjs:1249` — the final review initially found an API-tag adoption path. Commit
  `f95c1cf` fixed it, and both live IAM simulation and the fresh-eyes re-review confirmed request tags alone are
  denied while an existing correctly tagged AuditFlow API remains manageable.

## Findings by severity

### Critical

None.

### High

None unresolved. The API-tag adoption finding was fixed and independently rechecked before this verdict.

### Medium

None.

### Low

None.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | PASS — Node 20.17.0 |
| `npm ci` | PASS — inherited peer/engine/deprecation warnings; 36 audit findings |
| `npm test` | PASS — 12 files / 108 tests |
| `npm run test:pdf` | PASS — 3 files / 22 tests |
| `npm run test:foundation` | PASS — 31 files / 234 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run typecheck` | KNOWN BASELINE — 150 diagnostics, zero touched-path matches |
| `npm run lint` | KNOWN BASELINE/GENERATED — 19 errors; zero touched-source errors |
| `npm run build` | PASS |
| Foundation contract verifier | PASS — distinct application/PDF APIs and functions |
| Live foundation verifier | PASS — runtime/assets/CORS/IAM/storage/auth/health and both legacy-read flags false |
| PDF parity | PASS — compact ×2, representative ×2, boundary ×1; zero rendered-pixel mismatch |
| Boundary limits | PASS — 5,717,960-byte request, 4,224,444-byte PDF, 5,632,968-byte SST proxy envelope |
| Protected Terraform/workflow/Sentry paths | PASS — unchanged from the PR merge base |
| `git diff --check origin/main...HEAD` | PASS |
| GitHub Actions run 33620970616 | PASS — validation, preview, bundle, deploy, and live verification |
| Private-file import gate | EXPECTED BLOCK — still required before either legacy reader may be enabled |
| Owner browser matrix | PENDING — four HUMAN TESTS above |

## What is good

- The PDF Lambda is isolated from the ordinary API, has a permissions boundary, and receives no S3, DynamoDB, or
  Cognito data permissions.
- The verifier proved exact render bytes and zero pixel mismatch across compact, eight-page representative, and
  24-page near-limit boundary profiles while keeping committed evidence endpoint-free and synthetic-only.
- Handler-owned CORS was tested through both the raw API and same-origin Router path after removing API Gateway's
  empty CORS configuration.
- The deployment workflow preserves the owner-approved synthetic-only exception while leaving both legacy-read
  switches false and retaining the issue #11 gate for any later enablement.
- Legacy Terraform endpoints/workflows, DNS, production resources, and Sentry instrumentation are unchanged.

## Recommendation

Keep PR #27 as a draft until the four HUMAN TESTS are recorded. After they pass, update the implementation report,
mark the PR ready, and hand it to a human for final approval and merge. No additional code remediation is currently
recommended.
