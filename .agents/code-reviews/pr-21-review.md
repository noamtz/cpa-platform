# PR #21 review — Establish the SST serverless AWS foundation

**Verdict: REQUEST CHANGES (blocking security findings)**

The foundation behavior and validation evidence are strong, but the test deploy role is not least-privilege. A
workflow session can promote itself to unrestricted AWS access and can mutate unrelated account resources. That
violates the PR's issue-scoped boundary and must be corrected before merge.

## HUMAN DECIDES

1. **Critical — The OIDC deploy role can grant itself administrator access.** The managed-role pattern includes
   `auditflow-test-github-deploy` itself, while the policy permits `iam:PutRolePolicy`. An assumed workflow session
   can replace/add its own inline policy with `Action: "*"`; it can also create another matching role, grant that
   role unrestricted permissions, and pass it to Lambda. Exact OIDC trust limits who receives the initial session
   but does not constrain privileges after assumption. Remove self-mutation and unconstrained role creation, or
   enforce a restrictive permissions boundary on every created/mutated role, explicitly exclude the deploy role,
   and constrain `iam:PassRole` with `iam:PassedToService`. Add regression coverage for both escalation paths.
   (`infra/sst/deployment-role.ts:38`, `infra/sst/deployment-role.ts:55`, `infra/sst/deployment-role.ts:94`)

2. **High — Foundation service mutations are account-wide, not issue-scoped.** `s3:*`, `dynamodb:*`, `lambda:*`,
   `cognito-idp:*`, `cloudfront:*`, `apigateway:*`, `logs:*`, and `ssm:*` are allowed on `Resource: "*"`. A trusted
   workflow, malicious same-repository change, or compromised dependency could modify or delete resources outside
   the SST test stage, including Terraform/PDF-owned resources and data. Split discovery/read actions from
   mutations; scope mutations to deterministic AuditFlow test ARNs/tags, and retain global scope only for specific
   AWS APIs that require it. Verify the final policy with IAM simulation or Access Analyzer. The live verifier's
   current literal `Action: "*"`/`iam:*` test does not detect service-wide or global-resource permissions.
   (`infra/sst/deployment-role.ts:4`, `infra/sst/deployment-role.ts:23`, `infra/sst/deployment-role.ts:89`,
   `tooling/verify_sst_foundation.mjs:353`)

3. **Medium — The declared production cost ceiling is not enforced.** The code declares a monthly ceiling of
   ₪50, but accepts every finite positive USD amount. For example, `AUDITFLOW_MONTHLY_BUDGET_USD=100000` passes
   configuration and becomes the production budget. Enforce a conversion-aware, operator-supplied maximum during
   production configuration and test an over-ceiling value, or remove the claim that the configuration enforces
   the ceiling.
   (`infra/sst/stage.ts:4`, `infra/sst/stage.ts:52`, `infra/sst/__tests__/stage.test.ts:32`)

4. **Medium — The live CORS check treats every AWS error as proof that CORS is absent.** `get-bucket-cors` is the
   only allowed-failure call, and `assert(!cors.ok)` passes for `AccessDenied`, throttling, wrong-region, and service
   errors as well as the intended `NoSuchCORSConfiguration`. This can create false privacy evidence, especially
   after narrowing the deploy role. Parse the AWS error and accept only `NoSuchCORSConfiguration`; fail on all
   other errors.
   (`tooling/verify_sst_foundation.mjs:241`, `tooling/verify_sst_foundation.mjs:244`)

## AGENT FIXES

None routed automatically. The required changes affect AWS authorization, account boundaries, and production
money controls, so they require an owner-reviewed remediation rather than an unattended edit.

## HUMAN READS

1. Review the deploy role's self-management and resource scopes as the merge-blocking security boundary.
   (`infra/sst/deployment-role.ts:31`)
2. Review the JWT authorizer attachment and same-origin Router rewrite as the public API boundary; these are
   correctly separated in the current implementation.
   (`infra/sst/application.ts:47`, `infra/sst/application.ts:55`)
3. Review production retention and deletion protection as the state-integrity boundary; the intended protections
   are present in the declarations.
   (`sst.config.ts:18`, `infra/sst/storage.ts:15`, `infra/sst/auth.ts:12`)

## HUMAN TESTS

1. After narrowing IAM, use policy simulation/Access Analyzer to prove the OIDC principal cannot update its own
   policy, create an unconstrained role, pass an unintended role, or mutate resources outside the AuditFlow test
   prefixes/tags.
   (`infra/sst/deployment-role.ts:85`)
2. Re-run the test Environment workflow after remediation and confirm diff, deployment, and live verification pass
   using only the narrowed role.
   (`.github/workflows/deploy-sst-test.yml:110`, `.github/workflows/deploy-sst-test.yml:113`)
3. Add a production configuration test above the ₪50-equivalent maximum and prove it fails closed before synthesis.
   (`infra/sst/__tests__/stage.test.ts:32`)

## FYI

1. Node 20.17.0 validation passed locally: 28/28 foundation tests, focused type-check and lint, both contract-stage
   verifications, 67/67 characterization tests, build, and `git diff --check`.
   (`package.json:21`)
2. Python importer tests passed 11/11 and the Codex layer validated 31 skills and 6 custom agents. Full inherited
   checks remain at the documented baseline: type-check exit 2 with 233 diagnostics and lint exit 1 with 23 errors;
   neither output contains foundation-path matches.
   (`AGENTS.md:55`)
3. GitHub run `31798046914` passed against head `d8bfee9`, demonstrating that the deployed shape works; it does not
   invalidate the IAM escalation findings because the current verifier checks only literal administrator actions.
   (`.github/workflows/deploy-sst-test.yml:113`, `tooling/verify_sst_foundation.mjs:353`)

## Recommendation

Request changes and do not merge until the critical self-escalation path and account-wide mutation scope are
removed. Then fix the two medium validation/contract gaps, rerun the full suite, redeploy the test stage through
OIDC, and re-review the resulting policy.

## Remediation status (2026-08-21)

All four findings were accepted and fixed:

1. **Resolved:** explicit self-mutation deny, mandatory workload permissions boundary, and Lambda-only
   `iam:PassRole`, with regression tests and IAM simulations for each escalation path.
2. **Resolved:** stage-prefix/tag-scoped service mutations, enumerated global discovery/create operations, AWS
   Access Analyzer validation, `auditflow/test`-only SST state mutation, and unrelated S3/Lambda/state mutation
   simulations.
3. **Resolved:** required operator-supplied ILS/USD rate and fail-closed ILS 50 converted budget ceiling, including
   invalid-rate and over-ceiling tests.
4. **Resolved:** exact `NoSuchCORSConfiguration` parsing, with negative tests for access denial, throttling,
   redirects, and configured CORS.

The owner-authenticated test-stage redeployment and strengthened live verifier passed. A fresh review and the
GitHub OIDC workflow remain the final merge gates.
