# AuditFlow AWS operations

Use this only for infrastructure, deployment, rollback, or cutover work. The imported source has separate test and production Terraform stacks in `infra/{test,prod}/main.tf` and legacy GitHub Actions workflows for automatic test deployment plus manual production deployment and rollback. In this repository, every imported workflow is intentionally disabled by a `github.repository == 'noamtz/auditflow'` guard and remains migration evidence until replacement or activation is explicitly approved. Evidence: `.github/workflows/deploy-lambda.yml`, `deploy-lambda-prod.yml`, `rollback-prod.yml`, and `docs/migration/auditflow-source-baseline.md`.

Deployment, Terraform apply, production data migration, and Base44 retirement require explicit task scope. Base44 paths may be retired only after AWS parity evidence and a rollback-safe cutover; the final runtime must contain no Base44 dependency. See `.agents/references/auditflow-rewrite-target.md`.
