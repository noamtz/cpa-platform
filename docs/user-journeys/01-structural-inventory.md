# 01 — Structural Inventory

> **Status:** COMPLETE
> **Classification:** All items ✅ VERIFIED unless noted

---

## 1. Frontend Routes

Source: [App.jsx](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/App.jsx)

| Route | Component | Auth | Actor | Purpose |
|---|---|---|---|---|
| `/` | `CpaDashboard` | ProtectedRoute (Base44 JWT) | CPA | Main dashboard — client list, status, files, actions |
| `/settings` | `Settings` | ProtectedRoute (Base44 JWT) | CPA | Google Drive connection, sync-all, base path |
| `/questionnaire` | `ClientQuestionnaire` | **None** (token-based) | CLIENT | Public questionnaire for document collection |
| `/cpa-fill` | `CpaFillQuestionnaire` | ProtectedRoute (Base44 JWT) | CPA | CPA fills questionnaire on behalf of a client |
| `/clients` | `ClientsPage` | ProtectedRoute (Base44 JWT) | CPA | Client management (add, edit, bulk import) |

---

## 2. Backend Functions (Base44)

Source: `base44/functions/*/entry.ts`

### 2.1 Public (Token-authenticated)

| Function | Auth | Input | Output | Purpose |
|---|---|---|---|---|
| `getClientByToken` | client_id + token | `{client_id, token}` | `{client, submission}` | Load client + active submission for questionnaire |
| `updateClientSubmission` | client_id + token | `{client_id, token, data, completed, submission_id?}` | `{submission}` | Save questionnaire progress (client-side) |
| `uploadFile` | client_id + token **OR** CPA JWT | `FormData (file)` | `{file_uri}` | Upload a document file |
| `getSignedPdfUrl` | client_id + token | `{client_id, token, step_id}` | `{signed_url}` | Get signed URL for a completed PDF |
| `getTemplateFileUrl` | client_id + token | `{client_id, token, template_id}` | `{signed_url}` | Get signed URL for PDF template base file |
| `getActivePdfTemplates` | None (public) | `{}` | `{templates[]}` | List all active PDF signing templates |
| `getPdfTemplateById` | None (public) | `{template_id}` | `{template}` | Load single PDF template for signing flow |
| `getActiveTemplate` | Service role | `{}` | `{template}` | Get active questionnaire template (steps) |
| `getTemplateById` | Service role | `{template_id}` | `{template}` | Load a specific template version by ID |
| `getAllTemplateVersions` | CPA auth or service | `{}` | `{versions[]}` | List all template version history |

### 2.2 CPA-authenticated

| Function | Auth | Input | Output | Purpose |
|---|---|---|---|---|
| `cpaSaveSubmission` | CPA JWT (`auth.me()`) | `{client_id, submission_id?, step_id?, data, completed?}` | `{submission, audit_entry}` | CPA saves/fills questionnaire with audit trail |
| `saveQuestionnaireTemplate` | CPA JWT (implicit) | `{steps[]}` | `{template}` | Save new questionnaire template version |
| `downloadAllFiles` | CPA JWT | `{files[], clientName}` | ZIP binary | Download all client files as ZIP archive |
| `deleteSubmissionWithFiles` | CPA JWT (implicit) | `{submission_id}` | `{success, deletedFiles}` | Delete submission + associated files |
| `syncFilesToGoogleDrive` | CPA JWT | `{submission_id, client_id}` or `{sync_all, submission_ids[]}` or `{check_connection}` | `{success, uploadCount, skippedCount}` | Sync files to Google Drive |
| `createSignedUrl` | CPA JWT (implicit) | `{file_uri}` | `{signed_url}` | Generate signed URL for any private file |

### 2.3 System/Event-triggered

| Function | Trigger | Purpose |
|---|---|---|
| `notifySubmissionCompleted` | Submission entity update event | Send Telegram alert when submission is newly completed |

---

## 3. Lambda Handlers (AWS)

Source: [lambda/pdf-generator/index.mjs](file:///c:/Users/ntzur/workspace-antigravity/auditflow/lambda/pdf-generator/index.mjs)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | None | Health check endpoint |
| POST | `/generate-and-sign` | client_id + token | Generate filled PDF from template, upload, return signed URL |
| POST | `/generate-pdf` | ⚠️ INFERRED CPA-only | Generate PDF without signing (unused?) |
| OPTIONS | `*` | None | CORS preflight |

### Environment Routing

| Hostname | Lambda | API Gateway |
|---|---|---|
| `app.ddcpa.co.il` | `taxflow-pdf-generator-prod` | Production API |
| `*.base44.app` | `taxflow-pdf-generator-test` | Test API |
| `localhost` | `taxflow-pdf-generator-test` | Test API (via Vite proxy or direct) |

---

## 4. Entity Schemas

Source: `base44/entities/*.jsonc`

| Entity | Key Fields | Purpose |
|---|---|---|
| **Client** | `id`, `full_name`, `email`, `phone`, `token`, `tax_year`, `osek_type`, `status`, `pricing`, `last_activity` | Client record, owns token for questionnaire access |
| **Submission** | `id`, `client_id`, `tax_year`, `template_id`, `template_version`, `responses` (JSON), `signed_pdfs` (JSON), `step_completed`, `cpa_status`, `cpa_audit_log` (JSON), `is_archived`, `alert_sent` | Questionnaire submission data |
| **QuestionnaireTemplate** | `id`, `version`, `is_active`, `steps` (JSON), `created_at` | Versioned questionnaire step definitions |
| **PdfTemplate** | `id`, `name`, `template_json` (JSON with pdfme schema), `is_active` | PDF form template for signing flow |
| **User** | `id`, `email`, `full_name`, `drive_base_path` | CPA user account (Base44-managed) |
| **SyncedDriveFile** | `id`, `submission_id`, `original_file_url`, `drive_file_id`, `drive_parent_folder_id`, `file_name_on_drive`, `synced_at` | Google Drive sync tracking record |

---

## 5. Business Logic Modules

Source: `src/lib/`

| Module | Purpose | Test Coverage |
|---|---|---|
| [questionnaire-template.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/questionnaire-template.js) | Template parsing, year placeholders, conditional filtering, DEFAULT_STEPS v2 | ✅ `questionnaire-template.test.js` |
| [questionnaire-steps.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/questionnaire-steps.js) | Step building, resume logic, signed PDF parsing, status derivation | ✅ `questionnaire-steps.test.js` |
| [submission-compat.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/submission-compat.js) | Legacy/new format conversion, progress calc, file extraction, step summaries | ✅ `submission-compat.test.js` |
| [default-template.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/default-template.js) | DEFAULT_STEPS v1 (6 steps), year placeholders, active step filtering | Shared with above |
| [app-params.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/app-params.js) | localStorage/URL param management, WhatsApp WKWebView fallback | None |
| [AuthContext.jsx](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/lib/AuthContext.jsx) | React auth context, user state, login redirect | None |

---

## 6. CI/CD Pipelines

Source: `.github/workflows/`

| Workflow | Trigger | Purpose |
|---|---|---|
| `deploy-lambda.yml` | Push to `main` (path: `lambda/pdf-generator/**`) or manual | Build + deploy Lambda to **test** env |
| `deploy-lambda-prod.yml` | Manual dispatch only | Build + deploy Lambda to **prod** env with alias management |
| `rollback-prod.yml` | Manual dispatch (version number input) | Rollback prod Lambda to a specific version |

---

## 7. Observability

| Tool | Scope | Config |
|---|---|---|
| Sentry | Frontend (browser) | [instrument.js](file:///c:/Users/ntzur/workspace-antigravity/auditflow/src/instrument.js) — traces, replays |
| CloudWatch | Lambda | Standard Lambda logging |

---

## 8. Key Component Inventory

| Component | Path | Purpose |
|---|---|---|
| `ClientRow` | `src/components/dashboard/ClientRow.jsx` | Rich expandable row: status, files, actions, Drive sync, year tabs |
| `QuestionStep` | `src/components/questionnaire/QuestionStep.jsx` | Yes/No question, file upload, text input, select, PDF sign UI |
| `WelcomeStep` | `src/components/questionnaire/WelcomeStep.jsx` | Questionnaire welcome screen |
| `CompletionScreen` | `src/components/questionnaire/CompletionScreen.jsx` | Questionnaire completion screen with confetti |
| `ProgressBar` | `src/components/questionnaire/ProgressBar.jsx` | Step progress indicator |
| `StepSelector` | `src/components/questionnaire/StepSelector.jsx` | Horizontal step navigation bar |
| `QuestionnaireEditor` | `src/components/dashboard/QuestionnaireEditor.jsx` | CPA questionnaire step editor (add/edit/reorder/delete) |
| `EditClientModal` | `src/components/dashboard/EditClientModal.jsx` | Modal for editing client details |
| `CpaAuditBadge` | `src/components/dashboard/CpaAuditBadge.jsx` | Badge showing CPA filled a step |
| `RestoreSubmissionDialog` | `src/components/dashboard/RestoreSubmissionDialog.jsx` | Conflict resolution dialog for archived submissions |
| `SyncAllDriveButton` | `src/components/dashboard/SyncAllDriveButton.jsx` | Batch Drive sync from settings |
| `FilePreviewModal` | `src/components/dashboard/ClientRow.jsx` (inline) | In-row file preview (image, PDF, download) |
| `ProtectedRoute` | `src/components/ProtectedRoute.jsx` | Auth gate wrapper for CPA routes |
