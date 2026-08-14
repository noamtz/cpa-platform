---
name: piv-slice-epic
description: Slice an epic and its architecture decisions into PIV-sized GitHub issues with a dependency graph, then attach them to this repository's configured GitHub Project. Accepts a linked PRD/epic and architecture artifact and turns them into the discrete units of work consumed by the PIV loop.
---

# $piv-slice-epic — Slice an Epic into PIV-Sized Tickets

The bridge between a strategic doc and the PIV loop. The epic doc is the destination; the PIV loop is the unit of motion; **tickets are the bridge.** `$piv-slice-epic` does the slicing.

## Input

- `the user's request` — the **epic** to slice **and its architecture decisions**. These arrive as **one doc or two**:
  - a single architected epic that carries its own `## Architecture` section, **or**
  - an **epic plus a separate, linked architecture page** (the common case when the architecture lives beside the
    epic — e.g. a Confluence epic page and its linked architecture page, both passed as URLs). **Read both.**
  - greenfield: a PRD stands in for the epic.
  For this repository, resolve GitHub issue URLs through the `github-projects` MCP (or
  `python tooling/github.py ...` fallback). The master epic is not the long-form source: follow its canonical
  GitHub Wiki PRD and architecture links and read both Markdown pages in full. If the user explicitly supplies
  Confluence/Jira references, fetch them via the Atlassian MCP. **This is the load-bearing input:** the architecture
  names the seams, data model, and missing pieces the slices must respect.
- **Not prime-dependent.** A primed session helps, but isn't required. If the codebase surface isn't loaded, this
  skill orients itself (Step 2) before slicing.

## Process

### Step 1 — Read the sources

Read the canonical Wiki PRD fully (goal, user stories, acceptance criteria, out-of-scope) **and its linked Wiki
architecture document** (the approach, stack, data model, missing pieces, spikes). Resolve both pages from the
master epic when an issue is supplied. The slicing has to respect those calls.

### Step 2 — Orient on the code surface (if not already primed)

Slicing needs enough codebase awareness to judge what's independent vs dependent — file overlap, shared seams. If the session is already oriented, skip this. Otherwise **explore it yourself — don't depend on a prior `$prime-codebase`**: starting from the architecture's named seams, data model, and missing pieces, read the relevant files/dirs (e.g. the adapter interface, the orchestrator, the ingestion pipeline) to see what exists, what's reused, and where new code lands. Just enough to slice confidently — not a full re-derivation.

### Step 3 — Decompose into PIV-sized slices

Break the epic into tickets. **Scope these for AI, not for a human backlog** — an agent loop carries far more than
a traditional ticket: a small-to-medium implementation *phase*, ~8–10 subtasks, often **500–1500 lines of change
(20–50% tests)**. A small epic might even be a single ticket. A well-sized ticket:

- Is **one testable concern** — easy to **test, review, and prove** on its own.
- Is one coherent unit — a vertical slice of behavior, not a horizontal layer.
- Has clear acceptance criteria of its own.
- Is small enough that **one focused loop can one-shot it without context rot** — not so large the agent loses
  the thread and returns diminish.

Split by **dependency**, by **concern**, or as a **slim end-to-end slice** (prove the whole flow thinly, then
fatten it next loop) — whatever makes each ticket easiest to prove. If a slice is too big to test or review in
one honest pass, split it further. The *planning detail* stays high regardless — it's the *scope* that's larger.

### Step 4 — Slice for parallelizability

Map dependencies between tickets. **Independent tickets** — ones that don't touch the same files or rely on each other's output — can run in **parallel worktrees** (see `$worktree-create`). Mark which tickets are independent and which form a dependency chain. Slicing along vertical-slice-architecture seams maximizes independence.

**Plan just-in-time:** a dependent ticket waits until its dependency is *implemented*, not just sliced — building the dependency informs the dependent's plan, so planning it early plans against a guess. Independent tickets can be planned and run in parallel; dependent ones wait their turn.

### Step 5 — Write the ticket breakdown

Follow `.agents/references/github-project-documents.md`. Write the tickets as repository issues and add each one to
the configured GitHub Project. Do not create a local ticket file. **Every ticket carries its own context** — that's
what lets a loop pick it up later without re-reading the whole epic:

```
# Ticket Breakdown — <epic name>

## Epic summary — goal in 2-3 lines
## Tickets
   ### TICKET-1 — <title>
   - Scope / acceptance criteria — one testable concern
   - Per-ticket context: the doc sections, guides, and seams this ticket needs
     (e.g. "source-adapter guide · seam: adapter interface · AC #2 + #4 from the epic")
   - Files touched (estimate) · rough size (~500–1500 lines, incl. tests)
   - Depends on: <none / TICKET-x>
   ### TICKET-2 — ...
## Dependency graph
   <text or mermaid graph showing the order + parallel groups>
## Suggested execution order
   Wave 1 (parallel): TICKET-1, TICKET-3
   Wave 2: TICKET-2 (after TICKET-1 is implemented)
```

## Output

A ticket breakdown in the configured GitHub Project. Each ticket then enters its own PIV loop —
straight to `$piv-plan-implementation` if it's well-scoped (it primes what it needs), or `$prime-codebase` first if it needs more
codebase orientation. **Priming is optional**; the per-ticket context above is what makes that possible.

## Notes

- For this repository, GitHub Issues attached to the configured GitHub Project are the required tracker. The goal is to **split the work just enough that each loop has the highest chance of one-shot success, so you can automate the loop.**
- Greenfield: the same slicing applies to MVP phases instead of epic tickets.
