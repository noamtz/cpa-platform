# GitHub Project document contract

Use this contract whenever work creates or updates a product or delivery artifact. The configured GitHub Project
is the source of truth; do not create a local Markdown fallback when GitHub is unavailable.

This repository is permanently bound to `noamtz/cpa-platform` and GitHub user `noamtz`. Never use another stored
GitHub account for it. Run CLI fallbacks as `python tooling/github.py ...`, not bare `gh ...`.

## Storage model

- Store each durable artifact in the body of a repository issue and add that issue to the linked GitHub Project.
- Use a repository issue, not a draft Project item, so the artifact has a stable URL, comments, labels, and links to
  commits and pull requests.
- Keep the issue body canonical. Use comments for review discussion and short progress updates; incorporate accepted
  changes back into the body.
- Read `.github/project-documents.json` for the repository, Project owner/number, and allowed artifact types. Never
  guess a missing owner, repository, or Project number.
- Technical contracts needed to operate on the codebase remain versioned in `AGENTS.md`, `.agents/references/`, and
  code-adjacent READMEs. The GitHub Project holds PRDs, architecture specs/decisions, implementation plans, RCAs,
  execution reports, and review reports.

## Artifact shape

Use a concise issue title prefixed with the artifact type, for example `[Plan] Replace Base44 authentication`.
Preserve the artifact's skill-specific required sections in the issue body, then add:

- `Artifact type`: one value from `.github/project-documents.json`.
- `Related`: links to parent PRD/architecture/issue/plan and implementation PRs where applicable.
- `Last updated`: an ISO date.

Apply the matching `artifact:*` label created by `tooling/configure_github_project.py`. Add the issue to the
configured Project and set its `Artifact type` field. Do not treat the artifact as saved until its issue URL can be
read back.

## Tool order and safety

1. Prefer the `github-projects` MCP tools for repository issues and Project items.
2. Use `python tooling/github.py issue ...` and `python tooling/github.py project ...` as the deterministic fallback.
3. Before creating or editing an artifact, resolve the target from `.github/project-documents.json` and verify that
   the current repository matches its `repository` value.
4. Creating or materially editing an issue is an external write. Do it when the user asked to create/update the
   artifact or an active implementation workflow requires its documented output. Otherwise, present the draft and
   ask before publishing.
5. Never copy tokens into repository files, command arguments, issue bodies, comments, or logs.

If the manifest has null values, the remote is absent, authentication lacks Projects access, or the configured
Project cannot be read, stop the publishing step and report the exact prerequisite. Do not silently write to
`docs/`, `.agents/plans/`, or another local artifact directory.

## One-time setup

After the GitHub repository exists and `origin` points to it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tooling/refresh_github_auth.ps1
python tooling/configure_github_project.py --project-number <number>
```

To create a new linked Project instead:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tooling/refresh_github_auth.ps1
python tooling/configure_github_project.py --create-title "AuditFlow"
```

Restart Codex after changing `.codex/config.toml`; then verify `github-projects` in `/mcp` or with
`codex mcp list`.
