---
name: piv-run-full-loop
description: Autonomously develops a complete feature from priming through planning, execution, and commit by chaining the four core PIV-loop skills. Use when you want a full hands-off feature build from a single description.
---

# End-to-End Feature Development

**Feature Description**: the user's request

This skill chains the 4 core PIV-loop skills for autonomous feature development.

---

## Step 1: Prime - Load Codebase Context

Execute the priming workflow to understand the codebase.

Run the `prime-codebase` skill (`.agents/skills/prime-codebase/SKILL.md`).

---

## Step 2: Planning - Create Implementation Plan

Create a detailed implementation plan for the feature.

Run the `piv-plan-implementation` skill (`.agents/skills/piv-plan-implementation/SKILL.md`) with the feature description: **the user's request**.

**IMPORTANT**: Note the feature name and canonical plan issue URL that the planning step creates. You'll need them for the next step.

---

## Step 3: Execute - Implement the Feature

Implement the feature from the plan document.

Run the `piv-implement` skill (`.agents/skills/piv-implement/SKILL.md`) with the canonical plan issue URL.

(Use the feature name from Step 2.)

---

## Step 4: Commit - Save Changes

Create a git commit for all changes.

Run the `piv-commit` skill (`.agents/skills/piv-commit/SKILL.md`).

---

## Final Summary

After completing all 4 steps, provide:

### Feature Implementation Complete

**Original Request**: the user's request

**Feature Name**: [feature-name from planning step]

**Steps Executed:**
1. ✅ Prime - Codebase context loaded
2. ✅ Planning - Plan published to the configured GitHub Project
3. ✅ Execute - Feature implemented and validated
4. ✅ Commit - Changes committed to git

**Outputs:**
- Plan document: [canonical GitHub issue URL]
- Files created/modified: [list]
- Tests added: [list]
- Commit hash: [hash]

**Next Steps:**
- Push to remote: `git push`
- Create pull request (if applicable)
- Continue with next feature
