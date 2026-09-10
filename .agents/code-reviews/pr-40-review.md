# PR #40 review — pin AuditFlow deployment accounts

- PR: `#40`
- Reviewed head: `67fd0f51e525aeccbddcf06fc66ae2fe958b0b1c`
- Base: `main`
- Verdict: approve

No unresolved critical, high, medium, or low findings remain.

## Issue counts

| Severity | Open |
| --- | ---: |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

## Review routing

### AGENT FIXES

None remaining.

### HUMAN DECIDES

None.

### HUMAN READS

- `sst.config.ts:32` — the Pulumi AWS provider rejects credentials outside the selected stage account.
- `.github/workflows/deploy-sst-production.yml:133` — GitHub resolves the role and account from the canonical manifest before credential setup.
- `tooling/bootstrap_test_deployment_trust.mjs:155` — the owner trust bootstrap rejects a mismatched caller before any IAM read or mutation.

### HUMAN TESTS

None for this fix. The hosted test-stage deployment and live readback passed; production and DNS were not touched.

### FYI

- `tooling/bootstrap_test_deployment_trust.test.mjs:45` — fresh-eyes review found the bootstrap helper was initially unguarded; the final head proves the wrong-account path performs zero IAM calls.

## Validation

| Check | Result |
| --- | --- |
| Application tests | Pass — 15 files, 164 tests |
| Foundation tests | Pass — 48 files, 407 tests |
| Focused final-head tests | Pass — 3 files, 39 tests |
| Root typecheck and lint | Pass |
| Foundation typecheck and lint | Pass |
| Production build | Pass |
| SST test and production contract verification | Pass |
| Production-readiness contract | Pass |
| Hosted required check | Pass — run `34500512271` at exact reviewed head |
| Hosted test-stage preview/deploy/live readback | Pass |
| `git diff --check` | Pass |

## What is strong

One repository manifest now drives stage account, region, and role selection. Enforcement exists independently at
the SST provider, role creation, GitHub credential action, deployer preflight, live readback, and owner trust
bootstrap boundaries. Mismatch errors avoid disclosing identifiers, and the workflow masks account IDs in logs.

## Recommendation

Approve and merge PR #40. A human should retain control of all production and DNS actions.
