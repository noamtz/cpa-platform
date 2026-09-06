# PR #29 Review — Import and reconcile Base44 snapshot

**PR**: https://github.com/noamtz/cpa-platform/pull/29

**Reviewed head**: `87aafe4e11276cc3c52d9e042446769460777ba4`

**Recommendation**: REQUEST CHANGES

## Summary

The migration convergence design, privacy-bounded evidence, and fail-closed deployment intent are strong, but the PR
is not safe to merge yet. Four High findings affect imported-record readability, cross-client file authorization, and
deployment viability. The required `Deploy SST test` check is red, and its failed deployment partially updated route
resources before the deploy role's explicit self-mutation deny stopped the stack. One Low documentation inconsistency
should also be corrected with the blocking fixes.

## Findings

### High — imported future-year submissions cannot be read

**File**: `backend/api/contracts/entities.ts:93`

The importer intentionally preserves source tax years through 9999, and the verified rehearsal includes 2350–2353,
but `submissionPersistedSchema` still caps `tax_year` at 2200. Repository parsing of those imported submissions fails
and surfaces as an internal API error.

**Fix**: Align the persisted submission schema and related read/workflow schemas with the approved positive/9999
compatibility range. Add a repository/API regression test that reads an imported submission with tax year 2350.

### High — the derived placeholder violates the persisted client contract

**Files**: `tooling/import_base44_snapshot.mjs:475`, `backend/api/contracts/entities.ts:40`

The owner-approved placeholder omits `full_name`, while `clientPersistedSchema` requires a non-empty value. The
importer writes the row because its local target validator does not enforce that field, but any client lookup/list
page containing the placeholder can fail schema parsing and return an internal error.

**Fix**: Either give the placeholder a documented non-identifying display value or make the persisted schema accept
only a correctly marked migration placeholder. Exercise the resulting row through the real client repository/API
schema in a regression test.

### High — enabled legacy reads permit cross-client reference injection

**Files**: `backend/api/contracts/public-questionnaire.ts:57`, `backend/api/contracts/files.ts:159`,
`backend/api/services/files.ts:573`

Public submission mutation accepts arbitrary JSON strings for `responses` and `signed_pdfs`. Resolver v2 accepts any
syntactically valid legacy/HTTPS reference, and `signedUrlFor` skips owned-prefix validation for legacy keys. After
enablement, a token holder who knows another imported reference can write it into their own submission and receive a
signed URL for the other client's existing mirrored object. This violates issue #11's cross-owner and arbitrary-
reference fail-closed acceptance criteria; ZIP collection has the same ownership-binding concern.

**Fix**: Reject newly introduced legacy references in public mutations, preserve only unchanged imported values, and
bind every legacy key to its imported resource owner before signing or adding it to a ZIP. Add public-token and CPA
cross-client regression tests using an existing foreign legacy object.

### High — the new OIDC trust cannot be deployed by the role being changed

**Files**: `infra/sst/deployment-role.ts:51`, `tooling/verify_sst_foundation.mjs:1240`

The PR adds the protected environment subject to the test deploy role's trust policy, while that same deployed role
is explicitly denied `iam:UpdateAssumeRolePolicy`. The required workflow failed at this exact operation with HTTP 403.
Before failure, SST reported partial route/site KVS updates; API/ZIP live verification did not run.

**Fix**: Use the documented owner-authenticated bootstrap path to update and read back the exact two-subject trust
policy outside the self-denied CI role. Reconcile the live test stage after the partial deployment, rerun the required
workflow to green, and preserve the self-mutation deny for ordinary CI.

### Low — PDF runbook contradicts the completed import rehearsal

**File**: `docs/migration/pdf-parity-runbook.md:14`

The runbook says the authorized live import and evidence do not exist, contradicting the committed aggregate
evidence, README, AGENTS status, and implementation report.

**Fix**: State that test import/reconciliation evidence exists while protected legacy-read enablement and acceptance
remain pending.

## Validation

| Check | Result |
| --- | --- |
| Node 20.17.0 `npm ci` | PASS; known dependency warnings and 36 audit findings remain |
| Python tooling | PASS — 74 tests |
| Application tests | PASS — 110 tests |
| Foundation tests | PASS — 294 tests |
| PDF tests | PASS — 22 tests |
| Foundation typecheck and scoped lint | PASS |
| Application typecheck | Inherited 145 diagnostics, matching detached base HEAD |
| Full-tree lint | Inherited 2 errors, matching detached base HEAD |
| Production build | PASS on isolated retry; an initial parallel run hit a transient Windows output-directory lock |
| SST contract verifier | PASS |
| Strict private-file cutover verifier | PASS — fresh evidence, zero unresolved references |
| Codex-layer validator and `git diff --check` | PASS |
| Required GitHub Actions deployment | FAIL — deploy-role trust self-update denied |
| Live disabled-mode reconciliation after partial deployment | NOT VERIFIED — no usable local AWS session |

## What is good

- Conditional DynamoDB/S3 convergence, durable checkpoints, and replay behavior are deliberately fail-closed.
- Reconciliation exhaustively checks imported rows, object inventories, bytes, hashes, relationships, guards, and
  pagination while separating pre-existing target records.
- The committed evidence is aggregate-only, strict, fresh, and bound to the source manifest.
- Protected-environment verification and matching API/ZIP manifest configuration are good controls once the
  deployment bootstrap and resource-level authorization gap are fixed.

## Recommendation

Do not merge PR #29. Fix all four High findings, reconcile the partially updated test stage, obtain a green required
workflow at the same reviewed head, and then rerun this review gate. The Low runbook correction should travel with
those fixes.
