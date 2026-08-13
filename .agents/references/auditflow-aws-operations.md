# AuditFlow AWS operations

Use this only for infrastructure, deployment, rollback, or cutover work. The reference repository has separate test and production Terraform stacks in `infra/{test,prod}/main.tf`; a `main` push affecting `lambda/pdf-generator/**` deploys the test Lambda, while production deployment and rollback are manual GitHub Actions workflows. Evidence: source `.github/workflows/deploy-lambda.yml`, `deploy-lambda-prod.yml`, and `rollback-prod.yml`.

Deployment, Terraform apply, production data migration, and Base44 retirement require explicit task scope. Base44 paths may be retired only after AWS parity evidence and a rollback-safe cutover; the final runtime must contain no Base44 dependency. See `.agents/references/auditflow-rewrite-target.md`.
