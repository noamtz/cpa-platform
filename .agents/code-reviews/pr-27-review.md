# PR #27 review — SST PDF generation and signing parity

**PR:** https://github.com/noamtz/cpa-platform/pull/27

**State:** Draft

**Reviewed:** 2026-08-26

## Summary

Advisory review: no critical, high, or medium issues were found. The dedicated PDF runtime, same-origin routing,
frontend endpoint seam, response-boundary model, native ARM64/font verification, and deployment gate are internally
coherent and well covered. Two low-severity cleanup findings remain: redundant legacy parity invocations when
multiple SST iterations are requested, and whitespace errors in committed Markdown that make a base-to-head diff
check fail.

The PR should remain a draft. The documented omission of deployment, live cross-endpoint parity, and owner browser
acceptance is intentional because the issue #11 private-file evidence gate currently reports `missing_evidence`.
Those missing tasks are not review findings, but they still prevent representing issue #9 parity as fully accepted.

## Findings

### Critical

None.

### High

None.

### Medium

None.

### Low

#### 1. Extra legacy calls do not contribute to parity comparison

- **File:** `tooling/verify_pdf_parity.mjs:492`
- **Evidence:** `runParity` invokes the legacy endpoint `iterations + 1` times, but every SST comparison uses only
  `legacy.slice(0, 2)`. With `--iterations 5`, this produces six legacy runs and five SST runs, while four legacy
  runs cannot affect the verdict or evidence. The runbook also states that legacy is called twice before SST.
- **Impact:** Boundary profiles are intentionally expensive and near the synchronous payload limit. The unused calls
  increase test-stage latency, load, and cost without increasing confidence.
- **Fix:** Invoke legacy exactly twice for stability calibration and invoke SST `iterations` times. Alternatively,
  compare and report every legacy invocation if the extra sampling is intentional. Add an `iterations: 2` regression
  that asserts endpoint invocation counts, not only argument parsing.

#### 2. The committed PR range fails whitespace validation

- **Files:** `.agents/code-reviews/prove-sst-pdf-generation-signing-parity-review.md:3`,
  `.agents/reports/prove-sst-pdf-generation-signing-parity-report.md:3`
- **Evidence:** `git diff --check origin/main...HEAD` reports five trailing-whitespace errors: two in the earlier
  code-review heading metadata and three in the implementation-report metadata. A plain `git diff --check` on the
  clean worktree passes because it has no uncommitted diff, so it does not validate the committed PR range.
- **Impact:** The PR does not reproduce the implementation report's diff-hygiene claim when validated against its
  base. This is documentation-only and does not affect runtime behavior.
- **Fix:** Remove the trailing spaces or replace Markdown hard breaks with blank lines, then validate with
  `git diff --check origin/main...HEAD`.

## Validation

| Check | Result |
| --- | --- |
| Node/npm | PASS — Node 20.17.0, npm 10.8.2 |
| `npm ci` | PASS — inherited peer/engine/deprecation warnings; 34 audit findings |
| Dependency tree | PASS — pdfme 6.1.1, `@napi-rs/canvas` 0.1.100, PDF.js 3.11.174 |
| `npm test` | PASS — 12 files / 108 tests |
| `npm run test:pdf` | PASS — 3 files / 22 tests |
| `npm run test:foundation` | PASS — 31 files / 224 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run typecheck` | KNOWN BASELINE — 150 diagnostics, zero in touched paths |
| `npm run lint` | KNOWN BASELINE/GENERATED — 19 errors: 16 inherited source and 3 generated artifact errors; zero in touched source |
| Touched frontend lint | PASS |
| `npm run build` | PASS |
| Foundation contract verifier | PASS — schema v3 with distinct application and PDF API/function inventories |
| Post-preview PDF bundle verifier | PASS — exact Heebo digest, canvas package 0.1.100, ELF64 AArch64 binary |
| Codex-layer validator | PASS — 31 skills / 6 custom agents |
| `npm run sst:install` | PASS |
| `npm run sst:diff:test` | PASS — read-only preview synthesized 180 resources; no deployment |
| `git diff --check` | PASS on clean worktree; base-to-head range FAILS as finding #2 |
| Protected Terraform/workflow/Sentry paths | PASS — unchanged from `origin/main` |
| Private-file cutover gate | EXPECTED BLOCK — `missing_evidence` for issue #11 |
| Test deploy/live parity/manual browser matrix | NOT RUN — intentionally gated and not authorized |

The first preview attempt encountered an expired/stale AWS session. The existing `ntz-taxflow` SSO profile was
refreshed, stale child-process credential variables were excluded, and the read-only preview then completed. No SST
deployment, Terraform action, DNS change, or production action was performed.

## What is good

- The PDF Lambda is isolated from the ordinary API runtime, has the workload permissions boundary, and receives no
  S3, DynamoDB, Cognito, or other data links/permissions.
- Handler-owned CORS, JSON error shapes, binary PDF responses, page fallback, and multipage flattening remain
  characterized and compatible.
- The frontend keeps the explicit endpoint override as the highest-priority rollback seam while SST selects the
  same-origin `/pdf` path.
- The boundary fixture measures the complete base64-bearing Lambda proxy envelope and includes an explicit
  over-limit regression.
- Preview verification checks the exact font and AArch64 native artifact before deployment; live verification is
  correctly reserved for the actual deployed `code.zip`.
- The workflow retains the issue #11 gate before deployment and does not alter legacy Terraform PDF ownership.

## Recommendation

Keep PR #27 as a draft and address the two low findings before marking it ready. There are no code-review blockers
in the locally implemented scope. After issue #11 evidence is accepted and deployment is explicitly authorized,
complete the live verifier, cross-endpoint parity evidence, and owner browser/rollback matrix before seeking final
human approval for issue #9 parity.

## Resolution

Both low findings were accepted for this PR:

1. The parity verifier now performs exactly two legacy stability-calibration runs regardless of the requested SST
   iteration count. An end-to-end regression with separate local legacy/SST endpoints proves two legacy renders,
   two requested SST renders, four summarized runs, and two comparisons when `iterations` is two.
2. The five Markdown hard-break spaces were replaced with blank-line-separated metadata. PR-range whitespace
   validation now covers `origin/main...HEAD` plus the pending fixes rather than relying on an empty worktree diff.
