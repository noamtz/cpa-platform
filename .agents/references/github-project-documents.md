# GitHub Wiki and Project document contract

Use this contract whenever work creates, reads, or updates a product or delivery artifact. The configured GitHub
Wiki is the canonical Markdown store for PRDs and architecture documents. Repository issues in the configured
GitHub Project track those artifacts and remain the canonical store for the other artifact types.

This repository is permanently bound to `noamtz/cpa-platform`, its Wiki repository
`noamtz/cpa-platform.wiki`, and GitHub user `noamtz`. Never use another stored GitHub account for it. Run CLI
fallbacks as `python tooling/github.py ...`, not bare `gh ...`.

## Storage model

Read `.github/project-documents.json` before resolving or publishing an artifact. Its `canonicalArtifacts` mapping
decides the source of truth for each artifact type.

- **PRD:** canonical Markdown page in the GitHub Wiki. One master repository issue represents the epic in the
  GitHub Project and links to the Wiki page.
- **Architecture:** canonical Markdown page in the GitHub Wiki. A separate architecture tracker issue links to the
  page, is attached to the Project, and is linked as a child of or from the master epic.
- **Implementation plan, RCA, execution report, code review, and system review:** canonical repository issue body,
  attached to the Project as before.
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

### Architecture tracker issue

- Title it `[Architecture] <epic name>`.
- Put the canonical Wiki architecture URL first and link the master epic and Wiki PRD.
- Apply `artifact:architecture`, attach it to the Project, set `Artifact type` to `Architecture`, and make it a
  sub-issue of the master epic when supported. Otherwise link the relationship explicitly in both issue bodies.

Tracker comments hold review discussion and short progress updates. Incorporate accepted document changes into the
canonical Wiki page rather than treating comments or the tracker body as a competing document.

## Other issue-backed artifacts

For artifact types mapped to `repository-issue-body`, preserve the skill-specific sections in the issue body and add:

- `Artifact type`: one value from `.github/project-documents.json`.
- `Related`: links to the master epic, Wiki pages, parent issues, plans, and implementation PRs where applicable.
- `Last updated`: an ISO date.

Apply the matching `artifact:*` label, add the issue to the Project, and set its `Artifact type` field.

## Publication and read-back

1. Resolve the repository, Wiki, Project owner/number, storage mapping, and allowed artifact types from
   `.github/project-documents.json`; never guess them.
2. Verify `origin` is `git@github.com:noamtz/cpa-platform.git`.
3. Prefer the `github-projects` MCP for repository issues and Project items. Use
   `python tooling/github.py issue ...` and `python tooling/github.py project ...` as the fallback.
4. For a Wiki-backed artifact, clone or update `git@github.com:noamtz/cpa-platform.wiki.git`, edit the Markdown
   page, commit it with the `noamtz` identity, and push its default branch. The Wiki must already contain its first
   page before GitHub exposes this Git repository.
5. Create or update the tracker issue only after the canonical page can be published. Link the page and tracker in
   both directions, attach the issue to the Project, and set `Artifact type`.
6. Read back the public Wiki page URL, tracker issue URL, and Project item fields. Do not treat the artifact as saved
   until all three resolve to the intended content.

Creating or materially editing a Wiki page or issue is an external write. Do it when the user asked to create or
update the artifact or an active workflow requires its documented output. Otherwise present a draft and ask before
publishing. Never copy tokens into files, commands, issue bodies, comments, or logs.

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
