---
name: plan-create-stories
description: Decomposes a PRD into well-formed, engineer-ready GitHub issues attached to this repository's configured GitHub Project. Use after a PRD exists to turn its phases and user stories into a structured backlog. Works for a new codebase (MVP scope) or an existing one (epic scope); use another tracker only when the user explicitly overrides the repository default.
---

# Create Stories: PRD → Ticket Backlog

## Overview

Turn a finished PRD into a backlog of small, well-formed tickets. Each
Implementation Phase in the PRD becomes a group of tickets; each User Story
becomes one or more tickets with explicit acceptance criteria.

For this repository, the Wiki PRD is the product source of truth; GitHub Issues attached to the configured GitHub
Project are the delivery trackers and ticket source of truth. Read `.agents/references/github-project-documents.md`
before resolving the PRD or creating tickets.

## Arguments

| Argument | Required | Meaning |
|----------|----------|---------|
| `<prd-url>` | yes | Master epic issue or canonical Wiki PRD URL produced by `plan-create-prd` |
| `--milestone` | no | Optional GitHub milestone to attach issues to |

If the user explicitly requests another tracker, honor that direct request; otherwise do not ask which platform.

## Workflow

### 1. Read and decompose the PRD
- If `<prd-url>` is the master epic issue, follow its canonical Wiki PRD link. Read the Wiki Markdown page in full;
  the issue body is the delivery tracker, not the PRD source of truth.
- Walk the **Implementation Phases** section. Each phase is a ticket group.
- Walk the **User Stories** section. Each story maps to one ticket (split if it
  hides more than ~a day of work).
- For every ticket, draft:
  - **Title** — imperative, specific (`Add token refresh endpoint`, not `Auth`).
  - **Description** — what and why, linked back to the PRD phase.
  - **Acceptance criteria** — a checklist a reviewer can verify.
  - **Phase label** — which PRD phase it belongs to.
- Keep tickets small. A ticket that can't be described in one screen is two
  tickets.

### 2. Confirm the plan before creating anything
Print the proposed ticket list (titles + phase grouping) and the target
platform. This is the checkpoint — creating real tickets is not reversible in
one click.

### 3. Create the tickets in GitHub

- Prefer the `github-projects` MCP; use `python tooling/github.py ...` as the fallback.
- Create each repository issue, then add it to the configured GitHub Project.
- Put acceptance criteria in the issue body as a markdown checklist.
- Apply a `phase-N` label per PRD phase (create the label if missing with
  `python tooling/github.py label create`).
- Capture each created issue number/URL.

### 4. Report
- A table: ticket title → phase → created key/number/URL.
- The canonical Wiki PRD URL and master epic issue the backlog was generated from.
- Next step: each phase is now ready to run as a PIV loop.

## Quality Checks

- ✅ Every ticket traces back to a PRD phase or user story
- ✅ Every ticket has verifiable acceptance criteria
- ✅ Tickets are small (≤ ~1 day of work)
- ✅ The correct platform was used and every create succeeded
- ✅ Phase grouping is preserved (labels/epic) so the backlog stays navigable

## Notes

- Greenfield vs brownfield changes the PRD's *scope* (MVP vs next epic), not
  this skill — `plan-create-stories` runs the same either way.
- Never create tickets without the step-2 confirmation.
- If a phase is too vague to decompose, stop and flag it — that's a PRD gap,
  not a ticket-writing problem.
