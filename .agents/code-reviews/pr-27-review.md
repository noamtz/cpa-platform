# PR #27 review — SST PDF generation and signing parity

**PR:** https://github.com/noamtz/cpa-platform/pull/27

**State:** Draft

**Reviewed:** 2026-09-02

## Summary

Advisory verdict: the implementation and live evidence are ready for the final mobile acceptance cell, with no
unresolved Critical, High, Medium, or Low code findings. The dedicated PDF runtime, same-origin routing, exact
handler CORS, native ARM64/font bundle, bounded parity verifier, compute-only role, private upload, negative legacy
access, and rollback boundary are coherent and validated. The PR remains a draft only because real
WhatsApp/WKWebView touch signing requires the owner's physical mobile device.

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

- `docs/migration/pdf-parity-runbook.md:108` — complete the WhatsApp/WKWebView touch signing path.

### FYI

- `tooling/verify_sst_foundation.mjs:1249` — the final review initially found an API-tag adoption path. Commit
  `f95c1cf` fixed it, and both live IAM simulation and the fresh-eyes re-review confirmed request tags alone are
  denied while an existing correctly tagged AuditFlow API remains manageable.
- `infra/sst/application.ts:18` — the final acceptance review found that the first rollback guard accepted any clean
  same-region API Gateway origin. It now accepts only the exact retained legacy test PDF origin, rejects another
  syntactically valid API Gateway host, and continues to reject every production-stage override.

## Findings by severity

### Critical

None.

### High

None unresolved. The API-tag adoption finding was fixed and independently rechecked before this verdict.

### Medium

None unresolved. The rollback-origin allowlist finding was fixed and focused contract, typecheck, lint, verifier,
and diff checks passed before this verdict.

### Low

None.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | PASS — Node 20.17.0 |
| `npm ci` | PASS — inherited peer/engine/deprecation warnings; 36 audit findings |
| `npm test` | PASS — 12 files / 108 tests |
| `npm run test:pdf` | PASS — 3 files / 22 tests |
| `npm run test:foundation` | PASS — 31 files / 235 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run typecheck` | KNOWN BASELINE — 150 diagnostics; no new diagnostics from changed lines |
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
| Negative legacy-reference probe | PASS — 404 on public read and ZIP request; no signed URL, ZIP job, or worker request; fixture cleaned up |
| Desktop SST journey | PASS — authenticated Hebrew/RTL signing, upload/save, refresh/resume, and visual reopen |
| Legacy rollback journey | PASS — legacy test render/generate and complete save/resume/reopen; SST `/pdf` restored |
| Owner browser matrix | PENDING — mobile WhatsApp/WKWebView touch-signing cell only |

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

Keep PR #27 as a draft until the single mobile HUMAN TEST is recorded. After it passes, update the implementation
report, mark the PR ready, and hand it to a human for final approval and merge. No additional code remediation is
currently recommended.
