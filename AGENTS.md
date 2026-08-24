# AGENTS.md — AuditFlow rewrite

## Architecture map

Application, migration-evidence, AI-layer, and tooling entries in this map now live in this repository. The pinned
production source remains available read-only at `C:\Users\ntzur\workspace-antigravity\auditflow` for provenance
checks only.

```text
src/main.jsx                        # Browser bootstrap and global stylesheet loading.
src/instrument.js                   # Sentry browser instrumentation.
src/index.css                       # Global styles, RTL defaults, and design tokens.
src/App.jsx                         # Route composition and the boundary between public client flows and CPA flows.
src/pages/                          # Page-level product flows; pages orchestrate data and reusable components.
src/components/                     # Shared product UI, organized into the workflow areas below when applicable.
src/components/dashboard/           # CPA-facing workflow components shared by management pages.
src/components/questionnaire/       # Questionnaire, upload, navigation, completion, and signing UI.
src/components/ui/                  # Generated shadcn/Radix primitives, isolated from product components.
src/hooks/                          # Reusable React hooks.
src/lib/                            # Shared state, compatibility, auth, query, routing, template, and PDF helpers.
src/lib/__tests__/                  # Characterization tests for the behavior most important to preserve.
src/api/                            # Cognito auth, AWS HTTP compatibility modules, and the explicit temporary Base44 allowlist.
base44/entities/                    # Source data contracts and migration inputs, not the target storage design.
base44/functions/*/entry.ts         # Endpoint behavior and security evidence, not target runtime code.
base44/agents/                      # Reference readiness-agent behavior, not a target Base44 dependency.
lambda/pdf-generator/               # Existing AWS PDF rendering and generation boundary.
poc-server/                         # Legacy development-only PDF signing POC; migration evidence, not target runtime.
infra/{test,prod}/main.tf           # Existing test and production infrastructure for the PDF API.
infra/sst/                          # Active SST v3 contracts and test/production foundation components.
backend/api/                        # CPA/public compatibility routes, private-file/ZIP services, indexed repositories, and ChangeJournal coordination.
sst.config.ts                       # Strict-stage SST entry point for the serverless compatibility layer.
.github/workflows/                  # Disabled imported PDF evidence plus the active SST test workflow.
docs/PRD.md                         # Product inventory for parity discovery; code remains authoritative.
docs/user-journeys/                 # Evidence-backed journey and permission inventory.
docs/migration/                     # Imported-source manifest, baseline, and verification evidence.
.agents/ and .codex/                # Codex rules, on-demand references, skills, agents, hooks, and configuration.
tooling/                            # Source verification, Cognito compatibility checks, GitHub/Project helpers, and Codex tooling.
```

## Where new code goes

- **Frontend:** compose routes in `src/App.jsx`, pages in `src/pages/`, product UI in the matching `src/components/` area, hooks in `src/hooks/`, and shared behavior plus tests in `src/lib/` and `src/lib/__tests__/`; generated primitives remain in `src/components/ui/`.
- **Frontend data access:** replace `src/api/base44Client.js` with AWS-backed client modules under `src/api/`, not a parallel client directory.
- **New non-PDF backend:** follow the approved SST v3 serverless compatibility architecture: CloudFront/S3,
  API Gateway HTTP API, modular Lambda code, DynamoDB, private S3 storage, and Cognito. Preserve the relevant
  behavior and security evidenced by `base44/entities/`, `base44/functions/`, and
  `.agents/references/auditflow-api-security-contracts.md`; architectural deviations require a recorded decision.
- **PDF API:** extend `lambda/pdf-generator/`; change `infra/{test,prod}/` only for infrastructure or configuration changes, and `.github/workflows/` only for deployment or rollback changes.

## Ground rules

Evidence paths below are relative to this repository. The external production-source repository is provenance-only.

- **Behavioral source:** Preserve UI and behavior demonstrated by source code and characterization tests. Use `docs/PRD.md` and `docs/user-journeys/` to discover scenarios, but resolve conflicts in favor of executable code. Evidence: `src/App.jsx`, `src/pages/ClientQuestionnaire.jsx`, `src/lib/__tests__/questionnaire-steps.test.js`, and `docs/user-journeys/05-traceability-ledger.md`.
- **Target platform:** New runtime integrations are AWS-backed and introduce no new Base44 SDK, entity, function,
  connector, agent, or storage dependency. The canonical architecture selects an SST v3 serverless compatibility
  layer; do not introduce a different platform without updating that architecture decision. Evidence:
  `.agents/references/auditflow-rewrite-target.md` and the canonical `Architecture-AuditFlow-Platform-Migration`
  Wiki page.
- **Migration status:** Core CPA authentication, Client/Submission/User compatibility, invitations, and journaled
  mutations are deployed to the SST test stage and the live foundation plus managed-login redirect are verified.
  The first synthetic admin and its linked User fixture are bootstrapped. Private S3 upload/read, journaled file
  evidence, and asynchronous complete-ZIP contracts are implemented and locally validated but are not yet deployed
  or acceptance-tested. The facade retains only the Wiki-approved temporary PDF-template/readiness allowlist;
  snapshot file mirroring, authenticated acceptance, broader data seeding, and every production action still require
  explicit authorization.
- **Source integrity:** Make rewrite changes here; treat `C:\Users\ntzur\workspace-antigravity\auditflow` as read-only unless the user explicitly requests changes there. Reproduce and verify the imported baseline through `tooling/import_auditflow_source.py` and `docs/migration/auditflow-source-manifest.json`. Evidence: rewrite/input boundary in `.agents/references/auditflow-rewrite-target.md`.
- **Parity:** Add evidence before replacing behavior, and keep the working Base44 path until its AWS replacement has verified parity and a rollback-safe cutover. Evidence: rewrite-workspace `.agents/references/auditflow-rewrite-target.md` and source `.agents/AGENTS.md`.
- **Git:** Use feature branches for major work, reserve direct `main` changes for hotfixes, and prefix commits with `feat:`, `fix:`, `refactor:`, `infra:`, `test:`, or `docs:`. Evidence: source `.agents/AGENTS.md` and this repository's accepted documentation history.
- **GitHub identity:** This repository belongs exclusively to GitHub user `noamtz`, with origin `git@github.com:noamtz/cpa-platform.git`. Never use `noamtznm` here; that account belongs to unrelated work. Run GitHub CLI operations through `python tooling/github.py ...`, which selects the `noamtz` credential explicitly. The `github-projects` MCP launcher is bound to the same credential.
- **Validation:** Use Node 20.17.0 and run `npm ci`, `npm test`, `npm run typecheck`, `npm run lint`, and
  `npm run build` here. Compare known baseline failures with `docs/migration/auditflow-source-baseline.md`. For
  SST foundation changes, also run `npm run test:foundation`, `npm run typecheck:foundation`,
  `npm run lint:foundation`, and the contract verifier. For AI-layer changes, also run
  `python tooling/validate_codex_layer.py`. Evidence: `package.json`, the migration baseline report, and
  `tooling/validate_codex_layer.py`.
- **Project documents:** Use GitHub as the course's Jira/Confluence equivalent: GitHub Issues and the configured Project hold actionable work (epics, stories, tasks, and bugs), while the GitHub Wiki holds canonical PRDs and architecture documents. Keep agent working artifacts versioned locally: implementation plans under `.agents/plans/`, RCAs under `docs/issues/`, implementation and execution reports under `.agents/reports/` or `.agents/execution-reports/`, code reviews under `.agents/code-reviews/`, and system reviews under `.agents/system-reviews/`. Post review verdicts to the pull request and RCA summaries to the original bug issue; do not create tracker issues merely to store reports. Do not duplicate Wiki documents in this repository or create a fallback when the Wiki is unavailable; report the missing Wiki, Project identity, or authentication prerequisite instead. Keep code-operational contracts in this repository. Read `.agents/references/github-project-documents.md` before creating, reading, or updating a project artifact.

Read the relevant contract before changing its area:

- Frontend structure, types, naming, RTL, and lint: `.agents/references/auditflow-frontend-conventions.md`.
- API authentication, file access, errors, and CORS: `.agents/references/auditflow-api-security-contracts.md`.
- Source-data and legacy submission compatibility: `.agents/references/auditflow-submission-compatibility.md`.
- Questionnaire state and resume semantics: `.agents/references/auditflow-questionnaire-parity.md`.
- PDF rendering and signing: `.agents/references/auditflow-pdf-pipeline.md`.
- Terraform, deployment, rollback, and cutover: `.agents/references/auditflow-aws-operations.md`.
