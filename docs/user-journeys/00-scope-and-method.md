# 00 — Scope and Method

> **Document type:** Audit framework definition
> **Status:** COMPLETE
> **Audit date:** 2026-08-04
> **Repository commit:** HEAD of `main` branch

---

## 1. Purpose

This document defines the scope, methodology, and terminology for the AuditFlow user-journey discovery audit.

The audit's goal is to produce an evidence-backed specification of every **implemented and reachable** user journey in the AuditFlow codebase — with file-level traceability.

This is a **read-only documentation mission**. No code changes, refactoring, test implementation, or bug fixes are included.

---

## 2. Repository Scope

| Layer | Path | Technology |
|---|---|---|
| Frontend SPA | `src/` | React 18, Vite 6, Tailwind CSS, shadcn/ui |
| Auth | `src/lib/AuthContext.jsx` | Base44 SDK auth |
| Business logic (pure) | `src/lib/*.js` | ES modules, Vitest-tested |
| Backend functions | `base44/functions/*/entry.ts` | Deno, Base44 SDK |
| Lambda (PDF gen) | `lambda/pdf-generator/index.mjs` | Node.js 20, AWS Lambda |
| Entity schemas | `base44/entities/*.jsonc` | JSONC definitions |
| Infrastructure | `infra/`, `.github/workflows/` | Terraform, GitHub Actions |
| Observability | `src/instrument.js` | Sentry (browser tracing + replay) |

---

## 3. Terminology

### 3.1 User Journey
An end-to-end sequence of actions by a **single actor** to achieve a concrete **business goal**. A journey may cross multiple pages, functions, and entities.

> Example: "Client completes tax document questionnaire"

### 3.2 UI Flow
A within-page interaction sequence. One journey may contain multiple UI flows.

> Example: "Upload files for a step" (within the questionnaire journey)

### 3.3 Internal Workflow
An automated system process triggered by a user action or event, invisible to the triggering actor.

> Example: "Telegram notification on submission completion"

### 3.4 Scenario
A concrete path through a journey, determined by data conditions and actor choices.

> Example: "Client answers 'no' to pension question (עוסק פטור)" — a variant of the questionnaire journey

### 3.5 Actor
A human or system role that interacts with the application.

---

## 4. Actors

| Actor ID | Label | Auth mechanism | Scope |
|---|---|---|---|
| `CLIENT` | לקוח (Client) | Token-based (`client_id` + `token` in URL) | Public questionnaire only |
| `CPA` | רואה חשבון (Accountant) | Base44 auth (JWT session) | Dashboard, settings, CPA-fill |
| `SYSTEM` | System / Event trigger | Service role (Base44 SDK internal) | Background functions, webhooks |
| `CI` | CI/CD Pipeline | OIDC (GitHub Actions → AWS) | Lambda deployment |

---

## 5. Evidence Standards

### 5.1 Classification Labels

| Label | Meaning |
|---|---|
| ✅ **VERIFIED** | Traced to exact file, function, and line |
| ⚠️ **INFERRED** | Behaviour implied by code patterns but not directly observed at runtime |
| ❓ **UNCERTAIN** | Code path exists but may be dead, conditional, or untested |
| 🚫 **NOT IMPLEMENTED** | Referenced in UI/PRD but no backend implementation found |

### 5.2 Evidence Format

Every claim must include:
- **File path** (relative to repo root)
- **Symbol name** (function, component, or handler)
- **Line range** (where the behaviour is implemented)
- **Classification label** (from table above)

---

## 6. Methodology

### Phase 0: Structural Inventory
Catalog every routable page, API function, entity schema, and Lambda handler.

### Phase 1: Actor/Permission Mapping
Map which actors can access which routes and functions, and what auth gates protect them.

### Phase 2: Entity Lifecycle Analysis
Trace create → read → update → delete paths for each entity.

### Phase 3: Journey Discovery
Walk through each page's logic to identify end-to-end user journeys.

### Phase 4: Scenario Enumeration
For each journey, enumerate the concrete scenarios (happy path + error paths + conditional branches).

### Phase 5: Traceability Ledger
Cross-reference every scenario with exact file/line evidence.

### Phase 6: Coverage Audit
Identify gaps: dead code, unreachable paths, missing error handling, broken references.

---

## 7. Deliverables

| Document | Purpose |
|---|---|
| `00-scope-and-method.md` | This document |
| `01-structural-inventory.md` | Complete catalog of pages, functions, entities |
| `02-actor-permission-map.md` | Auth boundaries and access control |
| `03-entity-lifecycles.md` | CRUD paths for each entity |
| `04-user-journeys.md` | Discovered journeys with full scenario trees |
| `05-traceability-ledger.md` | Evidence-backed cross-reference matrix |
| `06-coverage-gaps.md` | Gaps, dead code, and audit findings |
