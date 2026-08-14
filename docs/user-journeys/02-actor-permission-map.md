# 02 — Actor / Permission Map

> **Status:** COMPLETE
> **Classification:** All ✅ VERIFIED unless noted

---

## 1. Authentication Mechanisms

### 1.1 Base44 JWT (CPA Session)

- **Source:** [AuthContext.jsx](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/AuthContext.jsx)
- **Storage:** `localStorage` key `base44_access_token` (with WhatsApp in-memory fallback via [app-params.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/app-params.js))
- **Validation:** `base44.auth.me()` — returns user object or null
- **Redirect:** `base44.auth.redirectToLogin()` on auth failure
- **Guard component:** [ProtectedRoute.jsx](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/components/ProtectedRoute.jsx)

### 1.2 Client Token (URL-based)

- **Format:** `/questionnaire?client={client_id}&token={token}`
- **Token generation:** Random 16-char string via `Math.random().toString(36).substring(2,18)` in [ClientRow.jsx:209](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/components/dashboard/ClientRow.jsx#L209)
- **Validation (server):** `getClientByToken`, `updateClientSubmission`, `uploadFile`, `getSignedPdfUrl`, `getTemplateFileUrl` — all check `client.token === token`
- **No expiry:** Tokens are persistent until regenerated

### 1.3 Service Role (Backend Internal)

- **Usage:** `base44.asServiceRole.entities.*` — elevated access for backend functions
- **No user-facing auth check** — service role bypasses entity-level permissions

### 1.4 OIDC (CI/CD)

- **Usage:** GitHub Actions → AWS via `github-actions-taxflow` IAM role
- **Source:** [deploy-lambda.yml](file:///c:/Users/ntzur/workspace-antigravity/auditflow/.github/workflows/deploy-lambda.yml)

---

## 2. Route-Level Access Matrix

| Route | Auth Gate | Unauthorized Behaviour |
|---|---|---|
| `/` | `ProtectedRoute` | Redirect to Base44 login |
| `/settings` | `ProtectedRoute` | Redirect to Base44 login |
| `/clients` | `ProtectedRoute` | Redirect to Base44 login |
| `/cpa-fill` | `ProtectedRoute` + `base44.auth.me()` check | Redirect to Base44 login |
| `/questionnaire` | **None** — intentionally public | Token validated server-side on every API call |

---

## 3. Function-Level Access Matrix

### 3.1 CLIENT Actor Access

| Function | Auth Method | Validation | Evidence |
|---|---|---|---|
| `getClientByToken` | client_id + token | `client.token === token` | [entry.ts:20](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/getClientByToken/entry.ts#L20) |
| `updateClientSubmission` | client_id + token | `client.token === token` | [entry.ts:20-21](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/updateClientSubmission/entry.ts#L20) |
| `uploadFile` | client_id + token (URL params) | `client.token === token` | [entry.ts:14-20](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/uploadFile/entry.ts#L14) |
| `getSignedPdfUrl` | client_id + token | `client.token === token` | [entry.ts:19](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/getSignedPdfUrl/entry.ts#L19) |
| `getTemplateFileUrl` | client_id + token | `client.token === token` | [entry.ts:19](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/getTemplateFileUrl/entry.ts#L19) |
| `getActivePdfTemplates` | None | Public endpoint | [entry.ts:7](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/getActivePdfTemplates/entry.ts#L7) |
| `getPdfTemplateById` | None | Public endpoint | [entry.ts:7](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/getPdfTemplateById/entry.ts#L7) |
| Lambda `/generate-and-sign` | client_id + token | Token validated in handler | [index.mjs](file:///c:/Users/ntzur/workspace-antigravity/auditflow/lambda/pdf-generator/index.mjs) |

### 3.2 CPA Actor Access

| Function | Auth Method | Validation | Evidence |
|---|---|---|---|
| `cpaSaveSubmission` | `base44.auth.me()` | Returns 401 if not authenticated | [entry.ts:8-11](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/cpaSaveSubmission/entry.ts#L8) |
| `downloadAllFiles` | `base44.auth.me()` | Returns 401 if not authenticated | [entry.ts:7-10](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/downloadAllFiles/entry.ts#L7) |
| `syncFilesToGoogleDrive` | `base44.auth.me()` | Returns 401 if not authenticated | [entry.ts:281-282](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/syncFilesToGoogleDrive/entry.ts#L281) |
| `uploadFile` | `base44.auth.me()` (fallback) | Returns 401 on auth failure | [entry.ts:22-28](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/uploadFile/entry.ts#L22) |
| `saveQuestionnaireTemplate` | ⚠️ INFERRED (no explicit auth check in function) | Relies on Base44 platform-level auth | [entry.ts](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/saveQuestionnaireTemplate/entry.ts) |
| `deleteSubmissionWithFiles` | ⚠️ INFERRED (no explicit auth check in function) | Relies on Base44 platform-level auth | [entry.ts](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/deleteSubmissionWithFiles/entry.ts) |
| `createSignedUrl` | ⚠️ INFERRED (no explicit auth check in function) | Relies on Base44 platform-level auth | [entry.ts](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/createSignedUrl/entry.ts) |
| `getActiveTemplate` | Service role | No per-user auth | [entry.ts](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/getActiveTemplate/entry.ts) |

### 3.3 SYSTEM Actor Access

| Function | Trigger | Auth |
|---|---|---|
| `notifySubmissionCompleted` | Submission entity update event | Service role (platform-triggered) |

---

## 4. Data Isolation

### 4.1 Tenant Model
AuditFlow is currently a **single-tenant** application. All entities belong to the same Base44 app. There is no multi-CPA tenant isolation.

### 4.2 Client Data Access
- **Client-side:** A client can only access their own data via the token mechanism. The server validates `client.token === token` on every request.
- **CPA-side:** The CPA has full read/write access to all clients and submissions via the Base44 SDK with session auth.

### 4.3 Cross-Client Risks
- ❓ **UNCERTAIN:** `deleteSubmissionWithFiles` accepts `submission_id` without validating ownership — any authenticated CPA (if multi-tenant) could delete any submission.
- ❓ **UNCERTAIN:** `createSignedUrl` accepts `file_uri` without validating which client/submission owns the file.

---

## 5. Permission Summary Matrix

| | Dashboard `/` | Clients `/clients` | Settings `/settings` | CPA Fill `/cpa-fill` | Questionnaire `/questionnaire` | Lambda `/generate-and-sign` |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| **CLIENT** | ❌ | ❌ | ❌ | ❌ | ✅ (token) | ✅ (token) |
| **CPA** | ✅ | ✅ | ✅ | ✅ | ❌ (not designed for) | ❌ (not designed for) |
| **SYSTEM** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
