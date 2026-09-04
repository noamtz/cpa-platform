# PR #28 final review — Complete CPA workflow and template parity

**PR:** https://github.com/noamtz/cpa-platform/pull/28

**Head:** `94b2823ac8ec69c3ae9986a2b8c011034e74f219`

**State:** Open

**Reviewed:** 2026-09-03

## Summary

Recommendation: approve. A fresh-context code review of the complete `origin/main...94b2823`
change found no application correctness, security, data-integrity, concurrency, type-safety, performance,
maintainability, or test-coverage defects. The CloudFront KeyValueStore deployment-role failure is now remediated,
regression-tested, owner-deployed to the test stage, and verified through both IAM simulation and the complete live
foundation verifier. The archived-Submission CPA-fill issue from the preceding review is resolved, and the earlier
template-concurrency, workflow-field, request-validation, verifier-count, and atomic Client-edit findings remain
resolved.

The executable application, foundation, and PDF suites pass, as do the strict foundation typecheck/lint, production
build, SST contract verifier, Codex-layer validator, runtime Base44 scan, and diff hygiene. Full frontend typecheck
and lint remain on the documented imported baseline at 145 diagnostics and five errors, both below the original
233/23 baseline. The owner-authenticated preview and deployment completed without stateful replacement, the exact
deployer policy is effective, and every live foundation check passes. Required GitHub workflow run `33776002459`
also passed preflight, preview, deployment, and live verification under Node 20.17.0 at the reviewed head.

## Issue counts

| Severity | Unresolved |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

## Issues by severity

### Critical

None.

### High

None.

## Resolved findings

1. **CloudFront KeyValueStore deployment permission.** The failed run
   https://github.com/noamtz/cpa-platform/actions/runs/33726972426 exposed an ineffective tag-conditioned grant.
   `infra/sst/deployment-policy.ts` now grants only the six required data-plane actions on this account's
   KeyValueStore ARN namespace, without unsupported conditions. Tests reject wildcard resources and the former tag
   condition. The owner-authenticated deployment reconciled the partial site update, and both deployer and live
   verification pass. `.github/workflows/deploy-sst-test.yml` now runs the deployer verifier before `sst diff` or
   deployment so missing effective permissions fail before any stage mutation.

### Medium

None.

### Low

None.

## Validation

| Check | Result |
| --- | --- |
| PR state/head | PASS — open, non-draft, mergeable PR at `94b2823` |
| `npm ci` | PASS — 1,055 packages; inherited peer/deprecation warnings and 35 audit findings |
| Node/npm | DOCUMENTED DEVIATION — Node 24.13.0 / npm 11.6.2; project requires Node 20.17.0 |
| `npm test` | PASS — 13 files / 110 tests |
| `npm run test:foundation` | PASS — 35 files / 267 tests |
| `npm run test:pdf` | PASS — 3 files / 22 tests |
| `npm run typecheck:foundation` | PASS |
| `npm run lint:foundation` | PASS |
| `npm run build` | PASS |
| `node tooling/verify_sst_foundation.mjs --mode contract --stage test` | PASS |
| `python tooling/validate_codex_layer.py` | PASS — 31 skills / 6 custom agents |
| Runtime Base44 scan | PASS — zero runtime matches |
| `git diff --check origin/main...HEAD` | PASS |
| `npm run typecheck` | DOCUMENTED BASELINE — 145 diagnostics; imported baseline was 233 |
| `npm run lint` | DOCUMENTED BASELINE — five errors; imported baseline was 23 |
| `npm run sst:diff:test` | PASS — owner-authenticated preview; intended role and PR application artifacts, no stateful replacement |
| `npm run sst:deploy:test` | PASS — owner-authenticated test deployment and Cognito refresh-rotation configuration |
| Deployer verifier | PASS — exact six-action account scope; cross-account access denied |
| Live foundation verifier | PASS — complete deployed inventory, runtime, IAM, auth, health, and Access Analyzer contract |
| File-cutover verifier | EXPECTED BLOCK — issue #11 import evidence is absent; legacy reads remain safely disabled |
| GitHub `Deploy SST test` | PASS — run `33776002459`, including Node 20.17.0, preflight, preview, deploy, and live verifier |

## What is good

- `backend/api/services/cpa-workflows.ts:218`, `:252`, and `:319` derive CPA audit identity server-side and combine
  conditional revisions with journaled multi-record writes.
- `backend/api/services/templates.ts:104` and `:250` serialize active questionnaire-template replacement through a
  strongly addressed guard and return reloadable conflicts instead of overwriting concurrent work.
- `backend/api/services/files.ts:629` keeps public PDF/template access client-token authorized and resource-scoped;
  callers cannot request a signed URL for an arbitrary file reference.
- `backend/api/services/files.ts:675` validates receipt, owner prefix, MIME type, purpose, and metadata before a CPA
  template file reference can be persisted.
- `src/pages/CpaFillQuestionnaire.jsx:30`, `:145`, and `:158` preserve serialized saves and conflict handling, while
  `src/lib/cpa-fill.js:1` now requests and defensively selects only active Submission records.
- The route allowlists, SST contracts, contract JSON, tests, and live verifier remain synchronized at 36 protected
  CPA routes, and the browser/runtime Base44 boundary is absent.

## Review routing

- **AGENT FIXES:** None.
- **HUMAN DECIDES:** None.
- **HUMAN READS:** `infra/sst/deployment-policy.ts:459` is the load-bearing least-privilege exception for CloudFront
  KeyValueStore data-plane operations.
- **HUMAN TESTS:** `src/pages/CpaFillQuestionnaire.jsx:145` archived-history behavior and simultaneous template
  editing remain useful exploratory browser scenarios; automated regression coverage and deployed foundation checks
  pass.
- **FYI:** `tooling/verify_sst_foundation.mjs:532` and `.github/workflows/deploy-sst-test.yml:117` now detect an
  ineffective deployer policy before any test-stage mutation.

## Recommendation

Approve PR #28. The exact reviewed head has no unresolved findings, local validation passes subject only to the
documented inherited frontend baselines, and the required test deployment workflow is green.
