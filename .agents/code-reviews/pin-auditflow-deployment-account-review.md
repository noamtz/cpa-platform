# Code review: pin AuditFlow deployment account

- Branch: `fix/pin-auditflow-deployment-account`
- Base: `main`
- Verdict: pass

Code review passed. No technical issues detected.

## Stats

- Files modified: 9
- Files added: 3
- Files deleted: 0
- New lines: 315
- Deleted lines: 25

## Review routing

### AGENT FIXES

None.

### HUMAN DECIDES

None.

### HUMAN READS

- `sst.config.ts:32` — confirms the Pulumi AWS provider rejects credentials outside the selected stage account.
- `.github/workflows/deploy-sst-production.yml:133` — confirms GitHub resolves the production role and account from the repository manifest before credential setup.
- `tooling/verify_sst_foundation.mjs:182` — confirms deployer and live verification stop on account mismatch without disclosing account identifiers in the error.

### HUMAN TESTS

None required for this configuration-only change. No AWS authentication, preview, deployment, or resource mutation was performed.

### FYI

- `infra/sst/__tests__/deployment-targets.test.ts:1` — regression coverage pins both stage targets and the provider account allowlist.

## Validation

| Check | Result |
| --- | --- |
| Application tests | Pass — 15 files, 164 tests |
| Foundation tests | Pass — 48 files, 407 tests |
| Focused account/workflow tests | Pass — 2 files, 35 tests |
| Root typecheck and lint | Pass |
| Foundation typecheck and lint | Pass |
| Production build | Pass |
| SST test and production contract verification | Pass |
| Production-readiness contract | Pass |
| Codex AI-layer validation | Pass — 31 skills, 6 custom agents |
| `git diff --check` | Pass |

## Security assessment

The intended account is no longer inferred from the active AWS caller. The canonical manifest is enforced at the
SST provider, role-bootstrap, GitHub credential, deployer-preflight, and live-readback boundaries. Mismatch errors
are intentionally generic, and GitHub masks the account identifier in action logs.
