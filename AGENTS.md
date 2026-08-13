# AGENTS.md — AuditFlow rewrite

## Architecture map

All application entries in this map currently live under `C:\Users\ntzur\workspace-antigravity\auditflow`; the `.agents/`, `.codex/`, and `tooling/` entries live in this rewrite workspace.

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
src/api/base44Client.js             # Reference frontend data-client seam to replace with AWS-backed API modules.
base44/entities/                    # Source data contracts and migration inputs, not the target storage design.
base44/functions/*/entry.ts         # Endpoint behavior and security evidence, not target runtime code.
base44/agents/                      # Reference readiness-agent behavior, not a target Base44 dependency.
lambda/pdf-generator/               # Existing AWS PDF rendering and generation boundary.
infra/{test,prod}/main.tf           # Existing test and production infrastructure for the PDF API.
.github/workflows/                  # Existing PDF Lambda deployment and rollback automation.
docs/PRD.md                         # Product inventory for parity discovery; code remains authoritative.
docs/user-journeys/                 # Evidence-backed journey and permission inventory.
.agents/ and .codex/                # Codex rules, on-demand references, skills, agents, hooks, and configuration.
tooling/                            # Deterministic validation and local MCP tooling for the Codex layer.
```

## Where new code goes

- **Frontend:** compose routes in `src/App.jsx`, pages in `src/pages/`, product UI in the matching `src/components/` area, hooks in `src/hooks/`, and shared behavior plus tests in `src/lib/` and `src/lib/__tests__/`; generated primitives remain in `src/components/ui/`.
- **Frontend data access:** replace `src/api/base44Client.js` with AWS-backed client modules under `src/api/`, not a parallel client directory.
- **New non-PDF backend:** no target implementation seam or AWS service has been selected. Record an architecture decision first, then preserve the relevant behavior and security evidenced by `base44/entities/`, `base44/functions/`, and `.agents/references/auditflow-api-security-contracts.md`.
- **PDF API:** extend `lambda/pdf-generator/`; change `infra/{test,prod}/` only for infrastructure or configuration changes, and `.github/workflows/` only for deployment or rollback changes.

## Ground rules

Evidence paths below are relative to `C:\Users\ntzur\workspace-antigravity\auditflow` unless marked as rewrite-workspace files.

- **Behavioral source:** Preserve UI and behavior demonstrated by source code and characterization tests. Use `docs/PRD.md` and `docs/user-journeys/` to discover scenarios, but resolve conflicts in favor of executable code. Evidence: `src/App.jsx`, `src/pages/ClientQuestionnaire.jsx`, `src/lib/__tests__/questionnaire-steps.test.js`, and `docs/user-journeys/05-traceability-ledger.md`.
- **Target platform:** New runtime integrations are AWS-backed and introduce no new Base44 SDK, entity, function, connector, agent, or storage dependency. Choose specific AWS services only through a recorded architecture decision. Evidence: rewrite-workspace `.agents/references/auditflow-rewrite-target.md`.
- **Source integrity:** Make rewrite changes here; treat `C:\Users\ntzur\workspace-antigravity\auditflow` as read-only unless the user explicitly requests changes there. Evidence: rewrite/input boundary in `.agents/references/auditflow-rewrite-target.md`.
- **Parity:** Add evidence before replacing behavior, and keep the working Base44 path until its AWS replacement has verified parity and a rollback-safe cutover. Evidence: rewrite-workspace `.agents/references/auditflow-rewrite-target.md` and source `.agents/AGENTS.md`.
- **Git:** Use feature branches for major work, reserve direct `main` changes for hotfixes, and prefix commits with `feat:`, `fix:`, `refactor:`, `infra:`, or `test:`. Evidence: source `.agents/AGENTS.md`.
- **GitHub identity:** This repository belongs exclusively to GitHub user `noamtz`, with origin `git@github.com:noamtz/cpa-platform.git`. Never use `noamtznm` here; that account belongs to unrelated work. Run GitHub CLI operations through `python tooling/github.py ...`, which selects the `noamtz` credential explicitly. The `github-projects` MCP launcher is bound to the same credential.
- **Validation:** Until the corresponding application manifest and scripts migrate here, run the applicable source scripts from `C:\Users\ntzur\workspace-antigravity\auditflow`: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`. For AI-layer changes, run `python tooling/validate_codex_layer.py` here. Evidence: source `package.json` and rewrite-workspace `tooling/validate_codex_layer.py`.
- **Project documents:** Store canonical PRDs and architecture documents as Markdown pages in the GitHub Wiki configured in `.github/project-documents.json`. Represent each with a repository issue attached to the GitHub Project: a PRD uses one master epic issue, while architecture uses a linked child/tracker issue. Other delivery artifacts remain canonical in their tracker issue bodies. Do not duplicate Wiki documents in this code repository or create a fallback when the Wiki is unavailable; report the missing Wiki, Project identity, or authentication prerequisite instead. Keep code-operational contracts in this repository. Read `.agents/references/github-project-documents.md` before creating, reading, or updating a project artifact.

Read the relevant contract before changing its area:

- Frontend structure, types, naming, RTL, and lint: `.agents/references/auditflow-frontend-conventions.md`.
- API authentication, file access, errors, and CORS: `.agents/references/auditflow-api-security-contracts.md`.
- Source-data and legacy submission compatibility: `.agents/references/auditflow-submission-compatibility.md`.
- Questionnaire state and resume semantics: `.agents/references/auditflow-questionnaire-parity.md`.
- PDF rendering and signing: `.agents/references/auditflow-pdf-pipeline.md`.
- Terraform, deployment, rollback, and cutover: `.agents/references/auditflow-aws-operations.md`.
