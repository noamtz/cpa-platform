# AuditFlow

AuditFlow is the production React/Vite application used to manage CPA client annual-report questionnaires,
documents, signatures, and PDF workflows. This repository contains the immutable production-source baseline for
the Base44-to-AWS migration together with the project-scoped Codex tooling that governs parity work.

The imported baseline is pinned and accounted for in
[`docs/migration/auditflow-source-baseline.md`](docs/migration/auditflow-source-baseline.md). Treat the legacy
Base44 entities, functions, and agents as migration evidence, not as the target AWS architecture.

## Application setup

Use Node.js 20.17.0 and the committed lockfile:

```powershell
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

The baseline report records which checks already fail at the pinned source revision. Do not mix unrelated source
cleanup with migration changes. Run the development server with `npm run dev` after supplying the required local
runtime configuration through an ignored local configuration file.

## SST foundation operations

The non-PDF AWS foundation uses SST 3.19.3 in `il-central-1`. It accepts only the exact stages `test` and
`production`; aliases such as `prod` are rejected. Use an authenticated AWS profile that has been independently
verified against the intended AuditFlow account:

```powershell
$env:AWS_PROFILE = "<profile>"
$env:AWS_REGION = "il-central-1"
npm run sst:install
npm run test:foundation
npm run typecheck:foundation
npm run lint:foundation
npm run sst:diff:test
npm run sst:deploy:test
node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json
```

Production is retained and protected. A production preview additionally requires an ignored
`.env.production.local`, copied from `.env.example`, with a valid alert email, a positive monthly USD budget, and
the operator-reviewed ILS/USD conversion rate. Configuration fails closed when the converted limit exceeds the
ILS 50 monthly ceiling. Refresh the rate before every production preview or deployment.
Never commit that file or its values. Production deployment, removal, DNS, certificates, and changes to the
existing Terraform/PDF stacks require separate authorization. SST 3.19.3 cannot diff a stage that has never been
deployed; if it reports `Stage not found`, do not initialize production through a deployment merely to obtain a
preview. Use the production contract tests until a separately authorized production deployment creates the stage.

The active `Deploy SST test` workflow assumes the separate `auditflow-test-github-deploy` role through the GitHub
`test` Environment. Set only its ARN as the Environment variable `AWS_DEPLOY_ROLE_ARN`; the workflow validates its
immutable repository OIDC subject before assuming the role. The role cannot mutate itself. SST workload roles
must use the stage permissions boundary, and CI can pass them only to Lambda. Changes to the deploy role or the
boundary require an owner-authenticated bootstrap deployment; ordinary stage deployments remain OIDC-automated.
Mutable objects in the shared SST state bucket are restricted to the exact `auditflow/test` key space.
The account-level GitHub OIDC provider remains Terraform-owned, while SST owns only this issue-scoped role and the
new serverless foundation resources.

## Codex project setup

The repository also contains `AGENTS.md`, repo skills, custom agents, hooks, an MCP server, and optional Archon
workflows.

### First run

1. Open the repository as a trusted project in Codex.
2. Restart Codex so it discovers `AGENTS.md`, `.agents/skills`, `.codex/config.toml`, and `.codex/agents`.
3. Open `/hooks`, review the two project hook definitions, and trust them if their scripts match your policy.
4. Run `codex mcp list` and confirm `codebase-search` is enabled. It requires `uv` and installs its script dependencies on first launch.
5. Grant GitHub user `noamtz` Projects access with
   `powershell -NoProfile -ExecutionPolicy Bypass -File tooling/refresh_github_auth.ps1`. The script restores the
   previously active global account afterward. The `github-projects` MCP server and `python tooling/github.py ...` wrapper
   explicitly reuse only that account's keyring token and never store it in the repository.
6. After `origin` points to the GitHub repository, link an existing Project with
   `python tooling/configure_github_project.py --project-number <number>`, or create one with
   `python tooling/configure_github_project.py --create-title "AuditFlow"`.
7. Restart Codex and confirm both `codebase-search` and `github-projects` are enabled in `/mcp` or
   `codex mcp list`.
8. Run `python tooling/validate_codex_layer.py`.

To exercise the MCP server without starting a Codex session, run:

```powershell
uv run --script tooling/mcp/codebase_search.py --self-test
```

Skills are invoked with `$skill-name`, for example `$prime-codebase` or `$piv-plan-implementation`. Ask Codex directly to delegate when you want parallel subagents, for example: “Have `codebase-analyst` map billing and `research-agent` verify the provider API, then wait for both and summarize.”

Canonical PRDs and architecture documents live as Markdown pages in the repository Wiki. Repository issues
attached to the linked GitHub Project track actionable epics, stories, tasks, and bugs. Implementation plans,
RCAs, reports, and reviews remain versioned repository artifacts in their contract-defined paths; pull requests
hold review verdicts and discussion. See `.agents/references/github-project-documents.md` for the storage and
publishing contract. Technical contracts that Codex must read while changing code remain versioned here.

The `posthog-analyst` agent requires a separately configured PostHog MCP server and credential environment. The repository intentionally does not commit that external credential configuration.

Archon workflows under `.archon/workflows` use the Codex provider. Validate them with `archon validate workflows` when Archon is installed.
