# 06 — Coverage Gaps and Audit Findings

> **Status:** COMPLETE
> **Purpose:** Document gaps, dead code, missing error handling, architectural risks, and audit observations

---

## 1. Missing Auth Checks

### 1.1 Functions Without Explicit Auth Validation

The following Base44 functions do **not** call `base44.auth.me()` or validate a client token. They rely entirely on Base44 platform-level auth (which may or may not enforce access control at the function invocation level):

| Function | Risk | Evidence |
|---|---|---|
| `deleteSubmissionWithFiles` | Any caller with a valid `submission_id` can delete | [entry.ts](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/deleteSubmissionWithFiles/entry.ts) — no auth check |
| `createSignedUrl` | Any caller can generate a signed URL for any private file | [entry.ts](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/createSignedUrl/entry.ts) — no auth check |
| `saveQuestionnaireTemplate` | Any caller could save a new template version | [entry.ts](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/saveQuestionnaireTemplate/entry.ts) — no auth check |
| `getTemplateById` | Uses `createClient` (service mode) instead of `createClientFromRequest` | [entry.ts:11](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/getTemplateById/entry.ts#L11) |

> **Mitigation:** These are likely protected at the Base44 platform level (the frontend proxy only forwards authenticated requests). However, this is not verified in-code and would be a risk if the API were exposed directly.

---

## 2. Missing Client Deletion

No client deletion functionality was found in the codebase:

- **No `deleteClient` function** in `base44/functions/`
- **No delete button** in `ClientsPage.jsx` or `ClientRow.jsx`
- **No cascade logic** for deleting a client's submissions, files, or synced Drive records

> **Impact:** Once created, clients cannot be removed. This may be intentional (audit trail preservation) but is undocumented.

---

## 3. Missing Template Deletion Safety

### 3.1 Ghost PDF Template References (Known Bug)

Documented in [OPEN_BUGS.md](file:///c:/Users/ntzur/workspace-antigravity/auditflow/OPEN_BUGS.md):

- Deleting a PdfTemplate does not cascade to QuestionnaireTemplate steps referencing it
- Results in `"Template not found"` errors during signing flow
- No referential integrity enforcement exists

### 3.2 No QuestionnaireTemplate Deletion

- No function to delete a questionnaire template version
- Old versions are preserved indefinitely (deactivated)
- No cleanup mechanism for orphaned versions

---

## 4. Data Format Duplication

### 4.1 DEFAULT_STEPS Defined in Three Places

The default questionnaire steps are defined independently in:

| Location | Steps Count | Differences |
|---|---|---|
| [default-template.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/default-template.js) | 6 | Original v1 defaults |
| [questionnaire-template.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/questionnaire-template.js) | 8 | Extended v2 with `income_sources`, `education_status`, `select_config` |
| [getActiveTemplate/entry.ts](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/getActiveTemplate/entry.ts) | 6 | Server-side seed (different field names: `is_active` vs `enabled`) |

> **Risk:** Different step IDs (`stock` vs `stocks`, `additional_income` vs `additional`) between server-side and client-side defaults. If both are used as fallbacks, they produce incompatible `responses` keys.

---

## 5. Error Handling Gaps

### 5.1 Silent File Deletion

In `deleteSubmissionWithFiles`, file deletion errors are silently swallowed:

```javascript
fileUris.forEach((fileUri) => {
  base44Service.integrations.Core.DeleteFile({ file_uri: fileUri }).catch(() => {});
});
```

**Evidence:** [entry.ts:56-58](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/deleteSubmissionWithFiles/entry.ts#L56)

> **Impact:** Orphaned files may remain in storage after submission deletion.

### 5.2 Silent Signed PDF Parse Failures

Multiple locations parse `signed_pdfs` JSON with empty `catch {}` blocks:

- [ClientRow.jsx:369-371](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/components/dashboard/ClientRow.jsx#L369)
- [ClientRow.jsx:514](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/components/dashboard/ClientRow.jsx#L514)
- [submission-compat.js:113](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/submission-compat.js#L113)

> **Impact:** Corrupted `signed_pdfs` data silently results in missing signed PDF sections with no error feedback.

### 5.3 No Upload Error Feedback

`uploadFile` errors (network failure, storage full) during the questionnaire flow cause the upload to fail silently — the file simply doesn't appear in the list. The XHR `onerror` handler in [QuestionStep.jsx:85](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/components/questionnaire/QuestionStep.jsx#L85) rejects the promise but the `Promise.all` has no user-facing error handler.

---

## 6. Notification Trigger Accuracy

### 6.1 Telegram Alert Fires on Any Update

The `notifySubmissionCompleted` function triggers on **any** submission update where `step_completed > 0 && !alert_sent`, not specifically when progress reaches 100%:

```javascript
const isNewlyCompleted = submission.step_completed > 0 && !submission.alert_sent;
```

**Evidence:** [entry.ts:22](file:///c:/Users/ntzur/workspace-antigravity/auditflow/base44/functions/notifySubmissionCompleted/entry.ts#L22)

> **Impact:** The alert may fire after the **first** step is completed, not when the entire questionnaire is done. The comment says "first time status became completed (progress = 100)" but the code doesn't check progress.

---

## 7. PdfTemplate CRUD Gap

### 7.1 No Frontend UI for PdfTemplate Management

The codebase has `PdfTemplate` entity schemas and API functions (`getActivePdfTemplates`, `getPdfTemplateById`) but **no frontend page or component for creating, editing, or deleting PDF templates**.

The `QuestionnaireEditor` can **link** a step to a PdfTemplate (by ID), but the actual template creation/upload appears to happen through the Base44 entity editor (external to the audited codebase).

> **Impact:** PdfTemplate lifecycle management is opaque — no audit trail, no validation, no referential integrity.

---

## 8. Security Observations

### 8.1 Token Entropy

Client tokens are generated with:
```javascript
Math.random().toString(36).substring(2, 18)
```

`Math.random()` is **not** cryptographically secure. The 16-character base-36 string provides ~82 bits of entropy, which is adequate for non-critical bearer tokens but below security best practices.

**Evidence:** [ClientRow.jsx:209](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/components/dashboard/ClientRow.jsx#L209)

### 8.2 Token in URL

Client tokens appear in URL query parameters (`?client={id}&token={token}`), which means they are:
- Logged in web server access logs
- Visible in browser history
- Potentially shared via referrer headers
- Cached by CDNs or proxies

### 8.3 No Token Rotation on Access

Tokens are never automatically rotated. A compromised link grants permanent access to a client's questionnaire and submission data until the CPA manually regenerates the token.

---

## 9. Dead/Unreachable Code Candidates

| Item | Location | Reason |
|---|---|---|
| `generate-pdf` Lambda endpoint | `lambda/pdf-generator/index.mjs` | ❓ Only `generate-and-sign` is referenced in frontend; `generate-pdf` may be dead |
| `createSignedUrl` function | `base44/functions/createSignedUrl/entry.ts` | ❓ `ClientRow.jsx` uses `base44.integrations.Core.CreateFileSignedUrl` directly; this function may be unused |
| `getTemplateById` function | `base44/functions/getTemplateById/entry.ts` | ❓ Not referenced in any frontend code; may be used only for debugging |
| Vite proxy `/poc-api` | `vite.config.js` L31-37 | ❓ POC proxy to localhost:3001 — likely leftover from migration POC |

---

## 10. Test Coverage Summary

| Module | Tests Exist | Test File |
|---|---|---|
| `questionnaire-template.js` | ✅ | `src/lib/__tests__/questionnaire-template.test.js` |
| `questionnaire-steps.js` | ✅ | `src/lib/__tests__/questionnaire-steps.test.js` |
| `submission-compat.js` | ✅ | `src/lib/__tests__/submission-compat.test.js` |
| All frontend components | ❌ | No component tests found |
| All Base44 functions | ❌ | No server-side tests found |
| Lambda handler | ❌ | No Lambda tests found |
| Integration / E2E | ❌ | `playwright` in devDependencies but no test files found |

> **Coverage gap:** Only pure business logic modules have tests. No component, API, integration, or E2E tests exist.

---

## Summary of Findings

| Category | Count | Severity |
|---|---|---|
| Missing auth checks | 4 functions | Medium |
| Missing CRUD operations | 2 (client delete, template delete) | Low |
| Data format duplication | 3 locations (DEFAULT_STEPS) | Medium |
| Silent error swallowing | 3+ locations | Medium |
| Known bugs | 1 (ghost PDF references) | High |
| Dead code candidates | 4 items | Low |
| Missing test coverage | Components, APIs, E2E | High |
| Security observations | 3 (token entropy, URL exposure, no rotation) | Medium |
| Notification accuracy | 1 (premature trigger) | Medium |
| Missing CRUD UI | 1 (PdfTemplate management) | Medium |
