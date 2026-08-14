# User Journey Discovery — Recipe

> A reusable recipe for auditing any codebase and producing evidence-backed user journey documentation.
> Derived from the AuditFlow audit (August 2026).

---

## When to Use

Use this recipe when you need to:
- Understand an unfamiliar codebase from a product/UX perspective
- Create acceptance-test-ready specifications from existing code
- Audit coverage gaps before a major refactor or migration
- Onboard a new team member with a structured overview

---

## Principles

1. **Evidence over inference** — every claim must reference an exact file, function, and line
2. **Mark uncertainty explicitly** — use classification labels (✅ VERIFIED, ⚠️ INFERRED, ❓ UNCERTAIN, 🚫 NOT IMPLEMENTED)
3. **Separate concepts** — user journey ≠ UI flow ≠ internal workflow ≠ scenario
4. **Never claim 100% coverage** — only claim "100% structural traceability"
5. **Read-only mission** — no code changes, no bug fixes, no refactoring

---

## Deliverables

Produce these documents in order. Each builds on the previous:

```
docs/user-journeys/
├── 00-scope-and-method.md      # Framework and definitions
├── 01-structural-inventory.md  # What exists in the codebase
├── 02-actor-permission-map.md  # Who can do what
├── 03-entity-lifecycles.md     # How data flows (CRUD)
├── 04-user-journeys.md         # End-to-end journeys
├── 05-traceability-ledger.md   # Evidence cross-reference
└── 06-coverage-gaps.md         # Findings and gaps
```

---

## Phase 0: Structural Inventory

**Goal:** Catalog everything that exists before analyzing behaviour.

### Steps

1. **Map the directory structure** — understand the technology stack, layers, and boundaries
2. **List all routes/pages** — find the router config (e.g., `App.jsx`, `routes.ts`)
3. **List all API endpoints/functions** — scan backend function directories, Lambda handlers, REST controllers
4. **List all entity schemas** — find database models, entity definitions, type files
5. **List all pure business logic modules** — identify testable logic separated from UI
6. **List all CI/CD pipelines** — scan `.github/workflows/`, `Jenkinsfile`, etc.
7. **Note observability setup** — error tracking, logging, monitoring tools

### Output Format

Use tables with columns: `Name | Path | Technology | Purpose`

### Tips

- Start with the entry point (`App.jsx`, `main.ts`, `index.html`) and trace outward
- Don't read every file yet — just catalog what exists
- Note any files that seem orphaned or unreferenced

---

## Phase 1: Actor / Permission Mapping

**Goal:** Identify who interacts with the system and what they can access.

### Steps

1. **Identify actors** — human roles (admin, user, reviewer) + system roles (background jobs, CI)
2. **Map auth mechanisms** — JWT, token-based, API keys, OAuth, session cookies
3. **Map route-level access** — which auth gates protect which pages
4. **Map function-level access** — which API endpoints check auth and how
5. **Assess data isolation** — multi-tenant? Can Actor A access Actor B's data?
6. **Build the permission matrix** — rows = actors, columns = routes/functions, cells = ✅/❌

### Output Format

```markdown
| Route/Function | Actor A | Actor B | Actor C |
|---|:---:|:---:|:---:|
| /dashboard     | ✅      | ❌      | ❌      |
| /public-form   | ❌      | ✅ (token) | ❌   |
```

### Tips

- Look for auth middleware, guard components, and `if (!user) return 401` patterns
- Flag functions that **lack** explicit auth checks — they may rely on platform-level protection
- Document the auth validation code path, not just the presence of a guard

---

## Phase 2: Entity Lifecycle Analysis

**Goal:** Trace every Create → Read → Update → Delete path for each data entity.

### Steps

1. **For each entity**, search the codebase for all places it's created, read, updated, or deleted
2. **Draw a state diagram** — what states can the entity be in? What transitions exist?
3. **Map each CRUD operation** to the actor who performs it and the function that implements it
4. **Identify missing operations** — can entities be deleted? Is there soft-delete?
5. **Note cascade behaviour** — does deleting entity A clean up related entity B?

### Output Format

Use Mermaid state diagrams + CRUD tables:

```markdown
| Operation | Actor | Function | Evidence |
|---|---|---|---|
| CREATE | Admin | `createUser()` | `api/users.ts:42` |
```

### Tips

- Search for `.create(`, `.update(`, `.delete(`, `.filter(`, `.list(` patterns
- Track JSON fields that embed sub-entities (e.g., `responses` JSON string inside `Submission`)
- Note any legacy/compatibility layers (old format → new format converters)

---

## Phase 3: Journey Discovery

**Goal:** Identify end-to-end user journeys by walking through page logic.

### Definition

A **user journey** is an end-to-end sequence of actions by a single actor to achieve a concrete business goal. One journey may span multiple pages, API calls, and entity mutations.

### Steps

1. **For each route/page**, read the component code and trace:
   - What data is loaded on mount?
   - What actions can the user take?
   - What API calls are made?
   - What state transitions occur?
2. **Group related actions into journeys** — don't treat every button click as a separate journey
3. **Name each journey** with the format: `J{N}: {Actor} {verb} {object}`
4. **Draw sequence diagrams** for complex journeys
5. **Enumerate scenarios** — happy path + error paths + conditional branches

### Journey vs Sub-journey

- If an action is meaningful on its own, it's a **journey**
- If it only makes sense in the context of a parent journey, it's a **sub-journey** (e.g., J4a, J4b)
- If it's a single interaction within a journey, it's a **UI flow** (don't promote it to a journey)

### Scenario Format

```markdown
| ID | Scenario | Condition | Evidence |
|---|---|---|---|
| J1-S1 | Happy path — all steps completed | Normal flow | `Page.jsx:L42-80` |
| J1-S2 | Error — invalid token | Token mismatch | `api.ts:L15` |
```

### Tips

- Follow the data flow, not the UI layout
- Look for conditional rendering (`if/else`, ternary) — each branch is a potential scenario
- Check error handlers and edge cases (empty states, loading states, network errors)
- Note when journeys cross actor boundaries (e.g., client action triggers system notification)

---

## Phase 4: Traceability Ledger

**Goal:** Prove every claim with exact file/line evidence.

### Steps

1. **For each scenario** in the journeys document, find the exact code that implements it
2. **Record:** file path, function/symbol name, line range, classification label
3. **Count totals** — how many verified vs inferred vs uncertain?

### Classification Labels

| Label | When to Use |
|---|---|
| ✅ VERIFIED | You traced it to exact file, function, and line |
| ⚠️ INFERRED | Code patterns suggest it but you didn't observe runtime behaviour |
| ❓ UNCERTAIN | Code path exists but may be dead, conditional, or unreachable |
| 🚫 NOT IMPLEMENTED | Referenced in UI, comments, or PRD but no backend implementation |

### Tips

- Use `grep` aggressively — search for function names, entity names, status strings
- If you can't find evidence for a claim, downgrade its classification — don't guess
- Aim for >95% VERIFIED

---

## Phase 5: Coverage Gaps

**Goal:** Identify what's missing, broken, or risky.

### Categories to Check

1. **Missing auth checks** — functions without explicit access control
2. **Missing CRUD operations** — entities that can't be deleted, or have no UI for management
3. **Data format duplication** — same constant defined in multiple places with drift risk
4. **Silent error handling** — `catch {}` blocks that swallow errors without feedback
5. **Dead/unreachable code** — functions, routes, or endpoints not referenced anywhere
6. **Notification/trigger accuracy** — do automated actions fire when expected?
7. **Security observations** — token entropy, URL exposure, credential handling
8. **Test coverage** — which layers have tests? Which don't?
9. **Known bugs** — check for `BUGS.md`, `TODO`, `FIXME`, `HACK` comments
10. **Referential integrity** — can deleting entity A break references from entity B?

### Output Format

For each finding, document:
- **What** — describe the gap
- **Where** — exact file/line evidence
- **Impact** — what could go wrong
- **Severity** — High / Medium / Low

---

## Checklist

Use this to track progress:

```markdown
- [ ] Phase 0: Structural inventory complete
- [ ] Phase 1: Actor/permission map complete
- [ ] Phase 2: Entity lifecycles complete
- [ ] Phase 3: All journeys discovered and scenarios enumerated
- [ ] Phase 4: Traceability ledger complete (>95% verified)
- [ ] Phase 5: Coverage gaps documented
- [ ] All documents cross-reference each other consistently
- [ ] No code changes were made (read-only mission)
```

---

## Anti-patterns

❌ **Don't treat every page as a journey** — group related actions
❌ **Don't treat every API endpoint as a journey** — endpoints are implementation details
❌ **Don't invent missing requirements** — document what IS, not what SHOULD BE
❌ **Don't assume existing behaviour is correct** — just document it
❌ **Don't skip error paths** — they're often the most important scenarios
❌ **Don't mix discovery with recommendations** — keep coverage-gaps factual, not prescriptive
