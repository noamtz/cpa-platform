---
name: piv-review-pr
description: Full pull-request review — fetch the PR, run the project's validation, review the diff with fresh eyes (dispatching the code-reviewer agent), categorize issues by severity, post the review to GitHub (approve / request-changes / comment), and save a report. The agentic gate that runs on an open PR before a human approves. Use after piv-create-pr.
---

# Review PR: The Agentic Gate Before the Human

**Input**: the user's request

The point of this skill is **fresh eyes**: it reviews the PR in a clean context — *not* the context that wrote
the code — and can hand the deep analysis to the **`code-reviewer` agent**, which is the whole reason the review
catches what the author's own context rationalizes away. It posts its verdict on the PR, then a **human** makes
the final call.

## Phase 1 — Fetch the PR

Resolve the input to a PR number (a number, a URL, or a branch via
`python tooling/github.py pr list --head <branch> --json number -q '.[0].number'`). Then:

```bash
python tooling/github.py pr view {N} --json number,title,body,author,headRefName,baseRefName,headRefOid,state,isDraft,mergeable,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,files
python tooling/github.py pr diff {N}
python tooling/github.py pr checkout {N}
```

State guard: `MERGED`/`CLOSED` → stop ("nothing to review"); `DRAFT` → review direction, don't approve/block.

## Phase 2 — Load the context (so you review against the right bar)

- **`AGENTS.md`** + any `.agents/references/` — the project's standards are the review rubric.
- **The implementation report**: follow `.agents/references/github-project-documents.md` and read the matching
  local `.agents/reports/<plan-slug>-report.md`, plus its plan. A documented deviation is an *intentional decision*,
  **not** an issue — only flag *undocumented* divergences. (No report? Review normally and note its absence.)
- The PR's own intent (title/body): what problem it claims to solve.

## Phase 3 — Run validation

Run the project's real suite (the **`piv-validate`** skill, or the plan's validation commands) — tests, type-check,
lint, build. Capture pass/fail + counts. A red suite is a finding in itself.

Inspect `statusCheckRollup` at the reviewed head after local validation. Do not publish a final verdict while a
relevant required check is pending. For every failed check, open its run and failed logs through
`python tooling/github.py run view <run-id> --json ...` and `--log-failed`, determine whether it is a code,
permissions, infrastructure, or external-state failure, and record it in the report. A documented local limitation
does not excuse a red CI check. For deployment failures, confirm whether any resource changed before failure and
require reconciliation evidence. Re-read the PR head and check rollup immediately before posting so the verdict
cannot describe an older commit or overlook a late failure.

## Phase 4 — Review the diff (dispatch the code-reviewer agent)

Hand the deep pass to the **`code-reviewer` agent** (`.codex/agents/code-reviewer.toml`) — it reviews against the
project's standards and reports **high-confidence issues only**. Read every changed file *in full* (not just the
diff) for context. Cover: correctness · type safety · pattern/standards compliance · security · performance ·
tests present · maintainability.

**Categorize every issue by severity:**

| Severity | Meaning |
|----------|---------|
| **Critical** | Blocking — security, data loss, crashes |
| **High** | Should fix before merge — type-safety holes, missing error handling, logic errors |
| **Medium** | Pattern inconsistencies, missing edge cases, *undocumented* deviations |
| **Low** | Suggestions, minor polish |

Acknowledge what's done well, too — review is constructive, not just a defect list.

## Phase 5 — Decide

- **Approve** — no critical/high issues, local validation and relevant required checks pass, matches intent.
- **Request changes** — high issues, or fixable validation failures, or undocumented pattern violations.
- **Block** (request-changes, strongly) — critical security/data issues, or wrong fundamental approach.
- Honor an explicit `--approve` / `--request-changes` flag, but never approve over an unresolved critical issue.

## Phase 6 — Save the report + post it to the PR

Follow `.agents/references/github-project-documents.md`. Write the full report to
`.agents/code-reviews/pr-{N}-review.md` (summary · issues by severity with `file:line` + fix · validation table ·
what's good · recommendation), then post that report directly as the GitHub PR review or comment. Do not create a
separate repository issue for the review. Use the local report as the CLI body file.

```bash
# approve
python tooling/github.py pr review {N} --approve --body-file .agents/code-reviews/pr-{N}-review.md
# request changes
python tooling/github.py pr review {N} --request-changes --body-file .agents/code-reviews/pr-{N}-review.md
# or just comment (draft PRs / advisory)
python tooling/github.py pr comment {N} --body-file .agents/code-reviews/pr-{N}-review.md
```

## Output + hand off

Print: PR number/URL · issue counts by severity · validation results · the recommendation. Then hand off:
**"Posted on the PR. A human now reviews the code + this review and merges."** If there are issues, the natural
next step is **`piv-fix-review-findings`** on the report, then re-run validation.

## Notes

- **Fresh eyes is the whole point** — run this in a clean context (or let the `code-reviewer` agent be the clean
  context). Don't review with the session that wrote the code; it rationalizes instead of scrutinizing.
- This is the *agentic* gate; it does not replace the human — it gives the human a validated, triaged PR to
  approve. Going deeper (multiple review agents, tuning the reviewer to your stack, the validation pyramid) is
  the code-review-as-a-component material later in the course.
