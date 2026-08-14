# AuditFlow AWS operations

Use this only for infrastructure, deployment, rollback, or cutover work. The imported source has separate test and production Terraform stacks in `infra/{test,prod}/main.tf` and legacy GitHub Actions workflows for automatic test deployment plus manual production deployment and rollback. Those stacks and their Lambda/PDF resources remain Terraform-owned. The imported workflows remain disabled by a `github.repository == 'noamtz/auditflow'` guard and are migration evidence only. Evidence: `.github/workflows/deploy-lambda.yml`, `deploy-lambda-prod.yml`, `rollback-prod.yml`, and `docs/migration/auditflow-source-baseline.md`.

The active non-PDF foundation is defined by `sst.config.ts`, `infra/sst/`, and `backend/api/`. SST owns its
CloudFront/S3 application shell, HTTP API and Lambda, DynamoDB tables, private buckets, Cognito resources, and the
separate test deployment role. It reuses, but does not modify, the account-level GitHub OIDC provider owned by
Terraform. Resource ownership must not cross those boundaries.

Only exact `test` and `production` SST stages are accepted. The test stage is removable for iteration;
production is protected and retained and requires an alert-only monthly AWS budget. Production configuration is
loaded from ignored `.env.production.local`; do not print or commit it. The GitHub `test` Environment supplies the
test deploy-role ARN as `AWS_DEPLOY_ROLE_ARN`, and `.github/workflows/deploy-sst-test.yml` validates the immutable
repository OIDC audience and subject before deployment.

For test-stage changes, run the focused test, type-check, lint, contract verifier, SST diff, deployment, and live
verifier commands documented in `README.md`. A first deployment creates the stage before later `sst diff` previews
can resolve it. A production preview is allowed only with explicit scope; production deployment or removal always
requires separate authorization. When production has never been deployed, SST 3.19.3 returns `Stage not found` for
`sst diff`; that is not authority to initialize it with `sst deploy`.

Deployment, Terraform apply, production data migration, and Base44 retirement require explicit task scope. Base44 paths may be retired only after AWS parity evidence and a rollback-safe cutover; the final runtime must contain no Base44 dependency. See `.agents/references/auditflow-rewrite-target.md`.
