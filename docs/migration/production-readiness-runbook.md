# AuditFlow production-readiness runbook (issue #14)

This is the go/no-go sequence for preparing the AWS rewrite for production. It does not authorize production data import, reverse replay, DNS traffic cutover, Base44 retirement, or any production business write. Stop at the first failed or stale gate. Store only aggregate results in `production-readiness-evidence.json`; keep fixture descriptors, credentials, endpoint outputs, user details, signed URLs, and raw telemetry outside the repository.

## 1. Freeze the candidate and prerequisites

1. Work from the exact candidate commit on Node 20.17.0 with a clean dependency install.
2. Confirm issues #11 and #12 evidence still represents the accepted migration and isolated rollback rehearsal. Do not rerun either mutating procedure merely to refresh readiness evidence.
3. Confirm `docs/migration/private-file-import-verification.json`, `docs/migration/base44-reverse-replay-verification.json`, and `docs/migration/pdf-parity-evidence.json` contain no private source material and match their source files.
4. Confirm the production GitHub Environment is protected by required owner review and a main-only deployment policy. Confirm its immutable OIDC subject is `repo:noamtz@2631641/cpa-platform@1332935468:environment:production`.
5. Confirm `infra/sst/deployment-targets.json` maps production to the intended account and `il-central-1`. The SST provider, bootstrap, and verifier must all reject any other caller before resource access or mutation.
6. Obtain a disposable test-stage fixture descriptor and separate authenticated storage state. Do not commit either file. Stateful checks require `AUDITFLOW_E2E_ALLOW_WRITES=confirmed-test-stage` and a descriptor whose restore contract is confirmed.

Run:

```powershell
npm ci
node tooling/verify_production_readiness.mjs --mode contract
node tooling/verify_sst_foundation.mjs --mode contract --stage test
node tooling/verify_sst_foundation.mjs --mode contract --stage production
```

Any changed candidate commit or build artifact invalidates later sign-off and must restart this sequence.

## 2. Complete automated validation and runtime audit

Run the complete project validation on Node 20.17.0:

```powershell
npm test
npm run typecheck
npm run lint
npm run test:foundation
npm run typecheck:foundation
npm run lint:foundation
npm run test:pdf
npm run test:import
npm run test:reverse-replay
npm run build
npm run verify:runtime-independence -- --frontend dist
npm run verify:readiness -- --mode contract
python tooling/validate_codex_layer.py
git diff --check
```

After each SST preview or deployment, also scan the produced runtime packages:

```powershell
npm run verify:runtime-independence -- --artifacts .sst/artifacts --no-manifests
```

A forbidden Base44 package, import, hostname, protocol, or storage reference in a shipped artifact is an immediate no-go. Compatibility labels in local source are not evidence of an external runtime dependency; the built output and packaged Lambdas are authoritative.

## 3. Verify migration and rollback evidence

The issue #11 artifact must show 366 source and imported records, 687 references, zero unresolved references, and all gates true. The issue #12 artifact must show the exact isolated range, interruption/resume, zero-write rerun, zero drift, terminal rollback, production untouched, and zero blockers.

Use [the import runbook](base44-import-runbook.md) and [the reverse-replay runbook](base44-rollback-replay-runbook.md) only when separately authorized. Real invitation/login verification and deletion of the disposable Base44 probe remain fail-closed unless the owner explicitly performs them or records one of the narrowly allowed waivers. No waiver may conceal a reconciliation gap, unsupported mutation, or production effect.

## 4. Test-stage generated-endpoint and legacy-mode checks

1. Verify the current generated CloudFront endpoint with legacy reads disabled.
2. Under the existing protected test enablement procedure, verify reconciled manifest-bound reads with legacy reads enabled.
3. Disable legacy reads again and repeat public health, protected-health rejection, public questionnaire, file, and PDF reads.
4. Confirm unresolved or unbound legacy references fail closed in both API and ZIP paths.

Use the existing deployment/live verifier sequence from `.github/workflows/deploy-sst-test.yml`. Never use imported records for state-changing acceptance. Do not place endpoint URLs or source identifiers in committed evidence.

## 5. Browser parity and negative cases

Set the private fixture variables and run read-only coverage first:

```powershell
$env:AUDITFLOW_E2E_STAGE = "test"
$env:AUDITFLOW_E2E_BASE_URL = "<generated-test-origin>"
$env:AUDITFLOW_E2E_FIXTURE = "<private-disposable-fixture-json>"
$env:AUDITFLOW_E2E_STORAGE_STATE = "<private-authenticated-storage-state>"
npm run test:e2e:read-only
```

Then, only for a designated disposable fixture with a verified restore record:

```powershell
$env:AUDITFLOW_E2E_ALLOW_WRITES = "confirmed-test-stage"
npm run test:e2e
```

Cover J1-J15 from `tooling/production-readiness-contract.json`: public load/save/resume/completion, direct file upload/read, desktop and mobile multipage RTL PDF signing, managed login/logout/session, CPA client/submission/status/archive/restore, files/ZIP, CPA fill, questionnaire/PDF templates, users/invitations, deferred integration responses, permissions, unknown routes, and maintenance behavior. Exercise every documented negative case, including invalid tokens, foreign resources, stale revisions, archived resources, and unauthenticated CPA access. Restore the disposable fixture and record only aggregate pass counts.

For mobile PDF signing, test the browsers/devices taxpayers actually use. If the in-app browser cannot be exercised, only `OWNER_PDF_MOBILE_IN_APP_BROWSER` may be waived, with scope, owner, date, reason, and next action.

## 6. Observability acceptance

- Sentry: cause a controlled test-stage client and API error, confirm the expected release/environment and useful stack/context, then remove or close the test event. Production errors that cannot be observed are a no-go. `OWNER_SENTRY_OBSERVATION` is the only allowed narrow waiver.
- PostHog absent: with no key, confirm no analytics request and no product failure.
- PostHog configured: with the EU project key, confirm only the intended aggregate event contract.
- PostHog blocked: block the analytics network request and confirm all product reads/writes continue. Analytics failure is non-blocking for product operation but blocks analytics acceptance until fixed or covered by `OWNER_POSTHOG_LIVE`.

Never commit raw events, user identities, request payloads, session recordings, or telemetry URLs.

## 7. Production budget, domain, and owner bootstrap

Before every preview/prepare, refresh the ignored/Environment-supplied ILS/USD rate, observation date, and source. The production AWS Budget must be exactly USD 10 monthly, COST, with one 80% ACTUAL `GREATER_THAN` percentage notification, at least one recipient, and zero automatic actions. The converted amount must be no more than ILS 50. Billing data can lag; this gate proves configuration, not a real-time hard ILS cap.

Prepare these protected Environment values:

- `AWS_DEPLOY_ROLE_ARN` for `auditflow-production-github-deploy`.
- `AUDITFLOW_MONTHLY_BUDGET_USD=10`.
- `AUDITFLOW_ILS_PER_USD`, `AUDITFLOW_ILS_PER_USD_DATE`, and `AUDITFLOW_ILS_PER_USD_SOURCE`.
- Secret `AUDITFLOW_BUDGET_ALERT_EMAIL`.
- `AUDITFLOW_PRODUCTION_DOMAIN=app.ddcpa.co.il`.
- A `us-east-1` ACM certificate ARN in `AUDITFLOW_PRODUCTION_CERTIFICATE_ARN`.

The first production role, permissions boundary, and retained empty foundation are created and read back through a
non-root owner-authenticated local profile whose STS account matches `infra/sst/deployment-targets.json`. CI
deliberately refuses an implicit first deployment. The bootstrap must use the same reviewed candidate and must not
import data, enable legacy reads, modify Box DNS, invoke Terraform, or write business records. After bootstrap, run
deployer and live verification using the exact outputs. An account mismatch is a stop condition, never a reason to
change or bypass the target contract during the run.

ACM validation DNS and final CloudFront traffic DNS are separate decisions. Record the ACM validation CNAME worksheet outside the repository, have the owner make the Box DNS change, and confirm certificate `ISSUED` before prepare. Do not create Route 53 resources. Record the final `app.ddcpa.co.il` traffic record worksheet for issue #15; do not apply it during issue #14.

## 8. Protected preview and prepare

Dispatch `Prepare SST production` from `main` with `operation=preview` first. A missing stage is an expected stop requiring owner bootstrap, never a reason for CI to deploy. Review the exact SST diff and runtime artifact audit.

Only after every preceding gate passes, dispatch again with `operation=prepare` and the exact confirmation `PREPARE EMPTY PRODUCTION`. Verify:

- retained/protected production tables and Cognito pool;
- private/versioned/expiring storage as contracted;
- CloudFront `Deployed` with private OAC storage origins;
- exact `app.ddcpa.co.il` auth callback/logout URLs and no localhost callback;
- production PDF endpoint, assets, same-origin routing, and no retained test PDF override;
- all API/worker legacy-read variables are false and manifest bindings empty;
- 30-day production logs;
- exact production OIDC trust, scoped inline policy, boundary, self-mutation deny, and cross-stage denial;
- the budget configuration and dated ILS conversion.

The workflow performs only non-business health, auth rejection, and PDF rendering smoke. It uploads a scrubbed aggregate read-back, never private outputs.

## 9. Cognito two-user owner procedure

Using two designated non-production identities in the production pool, have an owner create each user with a temporary password, complete first login/password change, verify the intended admin versus CPA role behavior, log out, and log in again. Remove the temporary users when acceptance is complete. Record counts and verdicts only; do not commit addresses, subject IDs, passwords, tokens, or screenshots containing identity data. If this is deferred, production readiness is no-go unless the scope fits an explicitly allowed waiver.

## 10. Maintenance, quiescence, and communications

Before any later cutover or replay, publish the owner-approved maintenance message and contact path. Close the maintenance control, verify the public Hebrew RTL page, keep health/read checks available, and prove API mutations fail with the maintenance contract after authentication. Confirm queues/workers are quiescent and no journal writes are advancing. Missing or corrupt maintenance control must fail closed. Reopen only after the exact authorized operation and verification completes.

Issue #14 verifies this behavior in test and prepares the empty production foundation. It does not authorize a production replay or data import.

## 11. Objective no-go and rollback triggers

Stop or roll back immediately for any of the following:

- any record/file/reference reconciliation gap or source-digest mismatch;
- any unknown critical/high defect or cross-client/cross-resource access;
- broken login, invitation, public link, token, session, or authorization scope;
- failed write, journal, archive/restore, upload/download, ZIP, resume, PDF render/sign/save/reopen path;
- maintenance fence failure, unexpected worker activity, or inability to restore the disposable fixture;
- Base44 runtime network/package/import evidence in a shipped artifact;
- production errors that are not observable in Sentry;
- budget configuration or projected trajectory beyond USD 10 / ILS 50;
- CloudFront, private-origin, ACM, domain, or callback drift.

An analytics-only outage does not block product writes, but its acceptance gate remains failed until fixed or narrowly waived. If prepare fails, keep DNS unchanged, legacy reads disabled, and the protected retained resources intact while investigating. Use the reverse-replay runbook only under its separate explicit authorization.

## 12. Aggregate evidence and owner decision

Populate `production-readiness-evidence.json` from scrubbed results. It must bind the exact commit, build/runtime artifact SHA-256 digests, and source evidence digests; list every gate as `passed` or an allowed, fully documented `waived`; and contain an explicit dated owner `go` or `no-go`. It must not contain keys for tokens, authorization, passwords, secrets, addresses, signed/replay URLs, raw payloads, record/client/account identifiers, or private endpoints.

Validate a completed artifact with:

```powershell
node tooling/verify_production_readiness.mjs --mode evidence --evidence docs/migration/production-readiness-evidence.json
```

The committed initial artifact is intentionally `pending` and must fail evidence mode until owner-supervised gates and sign-off are complete.

## 13. Issue #15 DNS handoff and 72-hour observation

Only a passing, owner-approved issue #14 artifact may be handed to issue #15. Issue #15 owns the final Box DNS traffic change and production observation. At 0h, 1h, 6h, 12h, 24h, 48h, and 72h, record aggregate health/auth/public/CPA/PDF/error-rate/budget observations and evaluate the rollback triggers above. Keep Base44 rollback capability through the full window. Retirement is a separate owner decision after 72 hours; it is not implied by a successful cutover.
