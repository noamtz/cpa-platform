# GitHub Wiki and Project document contract

Use this contract whenever work creates, reads, or updates a product or delivery artifact. It translates the
course's Jira/Confluence workflow to GitHub without changing the artifact boundaries:

- GitHub Issues and the configured Project replace Jira for actionable work: epics, stories, tasks, and bugs.
- The GitHub Wiki replaces Confluence for durable PRDs and architecture documents.
- Versioned repository files remain the agent's working artifacts: plans, RCAs, implementation and execution
  reports, code-review reports, and system reviews.
- Pull requests hold review verdicts and discussion; the original bug issue holds the short RCA summary and work
  status.

Do not create a repository issue merely to store a plan, RCA, report, or review. Create an issue only when it is an
actionable work item or the master epic used to track delivery progress.

This repository is permanently bound to `noamtz/cpa-platform`, its Wiki repository
`noamtz/cpa-platform.wiki`, and GitHub user `noamtz`. Never use another stored GitHub account for it. Run CLI
fallbacks as `python tooling/github.py ...`, not bare `gh ...`.

## Storage model

Read `.github/project-documents.json` before resolving or publishing an artifact. Its `canonicalArtifacts` mapping
decides the source of truth for each artifact type.

- **PRD:** canonical Markdown page in the GitHub Wiki. One master repository issue represents the actionable epic
  in the GitHub Project and links to the Wiki page.
- **Architecture:** canonical Markdown page in the GitHub Wiki, linked directly from the master epic and paired PRD.
  Do not create an architecture issue solely to represent the document. Create an architecture task only when
  there is distinct implementation or decision work to track.
- **Implementation plan:** canonical Markdown file under `.agents/plans/`, committed on the feature branch with the
  implementation it governs. Do not create a duplicate plan issue.
- **RCA:** canonical Markdown file under `docs/issues/issue-<number>.md`. Post a short summary to the original bug
  issue; do not create a second RCA issue.
- **Implementation report:** canonical Markdown file under `.agents/reports/<plan-slug>-report.md`.
- **Execution report:** canonical Markdown file under `.agents/execution-reports/<feature-name>.md`.
- **Code review:** canonical Markdown file under `.agents/code-reviews/`. For PR reviews, post the full review or
  its verdict and findings directly to that PR.
- **System review:** canonical Markdown file under `.agents/system-reviews/<feature-name>-review.md`.
- **Technical contracts:** keep versioned in `AGENTS.md`, `.agents/references/`, and code-adjacent READMEs.

Do not maintain a second PRD or architecture copy in the main code repository. The Wiki itself is a separate Git
repository containing real Markdown files; a duplicate under `docs/` would create two competing sources of truth.

## Wiki artifact shape

Use stable page filenames so links survive title edits:

- PRD: `PRD-<epic-slug>.md`
- Architecture: `Architecture-<epic-slug>.md`

Preserve each skill's required sections, then end the page with:

- `Artifact type`: `PRD` or `Architecture`.
- `Master epic`: URL of the epic issue.
- `Related`: links to the paired PRD/architecture page and relevant issues or pull requests.
- `Last updated`: an ISO date.

Update `Home.md` when publishing the first artifact for an epic. Link PRD and architecture pages both ways once
the architecture exists.

## Tracker issue shape

### Master epic issue for a PRD

- Title it `[Epic] <outcome-oriented name>`.
- Keep the complete PRD in the Wiki, not in the issue body.
- Put the canonical Wiki PRD URL first, followed by a concise outcome, deadline, success criteria, and sections for
  architecture, child issues, and pull requests.
- Apply `epic` and `artifact:prd`, attach the issue to the configured Project, and set `Artifact type` to `PRD`.
- Reuse an existing PRD issue as the master epic when one already exists; never create a duplicate merely to adopt
  this model.

### Architecture linkage

- Add the canonical Wiki architecture URL to the master epic's Architecture section.
- Link the master epic and Wiki PRD from the architecture page, and link the architecture page from the PRD.
- Keep review discussion as comments on the master epic or on the pull request that changes implementation; fold
  accepted document changes back into the Wiki page.
- Do not add the architecture page to the Project through a proxy issue.

## Actionable issue shape

Stories, tasks, and bugs are repository issues attached to the configured Project. Each should describe a testable
unit of work with acceptance criteria, relevant Wiki context, dependencies, and its parent epic. A deferred review
finding becomes an issue only when the owner deliberately chooses to make it future work; the review report itself
does not become an issue.

For a bug investigation, keep the original bug issue as the work item. Store the full RCA in
`docs/issues/issue-<number>.md`, then comment on the original issue with the assessment, root cause, affected files,
and link/path to the RCA. Do not create a separate RCA issue.

## Repository-backed working artifacts

Store each implementation plan at `.agents/plans/<kebab-case-descriptive-name>.md`. The planning skill creates or
updates that canonical file; the execution skill reads it directly. Commit the plan on the same feature branch as
the implementation so review can compare intent and execution at one revision. A plan may link to its tracker
ticket, epic, Wiki pages, implementation report, and pull request, but those links do not replace the repository
file as the source of truth.

Use the skill-specific repository paths for the other working artifacts:

- `docs/issues/issue-<number>.md` for an RCA.
- `.agents/reports/<plan-slug>-report.md` for the implementation report produced by `piv-implement`.
- `.agents/execution-reports/<feature-name>.md` for the reflective execution report.
- `.agents/code-reviews/<name>.md` and `.agents/code-reviews/pr-<number>-review.md` for reviews.
- `.agents/system-reviews/<feature-name>-review.md` for a process/system review.

Commit artifacts that are part of the delivery record on the relevant feature branch. Do not add these artifact
types to the Project's `Artifact type` field and do not publish duplicate report issues.

## Publication and read-back

1. Resolve the repository, Wiki, Project owner/number, storage mapping, and allowed Project artifact types from
   `.github/project-documents.json`; never guess them.
2. Verify `origin` is `git@github.com:noamtz/cpa-platform.git`.
3. Prefer the `github-projects` MCP for repository issues and Project items. Use
   `python tooling/github.py issue ...` and `python tooling/github.py project ...` as the fallback.
4. For a Wiki-backed artifact, clone or update `git@github.com:noamtz/cpa-platform.wiki.git`, edit the Markdown
   page, commit it with the `noamtz` identity, and push its default branch. The Wiki must already contain its first
   page before GitHub exposes this Git repository.
5. For a PRD, create or update the master epic only after the canonical page can be published. Link the page and
   epic in both directions, attach the epic to the Project, and set `Artifact type` to `PRD`.
6. For architecture, update the existing master epic and both Wiki pages; do not create a proxy issue.
7. Read back the public Wiki page URL and every updated tracker/Project field. Do not treat the publication as saved
   until they resolve to the intended content.

Creating or materially editing a Wiki page, issue, PR review, or comment is an external write. Do it when the user
asked for it or an active workflow requires that output. Otherwise present a draft and ask before publishing. Never
copy tokens into files, commands, issue bodies, comments, or logs.

If the Wiki has no initial page, authentication cannot push to it, the manifest has missing values, or the Project
cannot be read, stop publication and report the exact prerequisite. Do not silently fall back to `docs/`, an issue
body for a Wiki-backed artifact, or another local artifact directory.

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

Create the Wiki's first page once through `https://github.com/noamtz/cpa-platform/wiki`; GitHub exposes
`git@github.com:noamtz/cpa-platform.wiki.git` only after that initial page exists. Restart Codex after changing
`.codex/config.toml`, then verify `github-projects` in `/mcp` or with `codex mcp list`.
