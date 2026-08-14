# Product Requirements Document (PRD)
## Automated Tax Document Collection & Client Onboarding Platform

**Product Name:** Doron & Doron CPA — Client Onboarding & Document Collection  
**Domain (Production):** `app.ddcpa.co.il`  
**Platform:** Base44 (BaaS) + React/Vite frontend + AWS Lambda (PDF generation) + Google Drive (file sync)  
**Last Updated:** July 2026  
**Status:** In Production

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Users & Roles](#3-target-users--roles)
4. [System Architecture](#4-system-architecture)
5. [Data Model](#5-data-model)
6. [Feature: CPA Dashboard](#6-feature-cpa-dashboard)
7. [Feature: Client Questionnaire (Public)](#7-feature-client-questionnaire-public)
8. [Feature: Dynamic Questionnaire Templates](#8-feature-dynamic-questionnaire-templates)
9. [Feature: PDF Template Editor & Digital Signing](#9-feature-pdf-template-editor--digital-signing)
10. [Feature: File Management & Google Drive Sync](#10-feature-file-management--google-drive-sync)
11. [Feature: CPA Fill-on-Behalf Mode](#11-feature-cpa-fill-on-behalf-mode)
12. [Feature: Team Management](#12-feature-team-management)
13. [Feature: Submission Readiness AI Agent](#13-feature-submission-readiness-ai-agent)
14. [Feature: Notifications & Automations](#14-feature-notifications--automations)
15. [Feature: Archiving & Multi-Year History](#15-feature-archiving--multi-year-history)
16. [Security & Access Control](#16-security--access-control)
17. [Infrastructure & DevOps](#17-infrastructure--devops)
18. [Error Monitoring](#18-error-monitoring)
19. [Known Issues & Constraints](#19-known-issues--constraints)
20. [Future Considerations](#20-future-considerations)

---

## 1. Executive Summary

This platform automates the annual tax document collection process for the accounting firm **Doron & Doron CPA**. Instead of manually emailing clients, chasing documents, and tracking progress in spreadsheets, the CPA generates a unique secure link for each client. The client opens the link (no login required), walks through a dynamic questionnaire, uploads required tax documents (Form 106, Form 867, pension confirmations, etc.), and optionally signs digital PDF forms (power of attorney, declarations). All collected files are then synced to the firm's Google Drive in an organized folder structure.

### Core Value Proposition

| Before (Manual) | After (Automated) |
|---|---|
| Email templates sent individually | One-click secure link generation |
| Clients reply with attachments in email | Structured upload portal with progress tracking |
| CPA manually files documents in Drive | Automatic Drive sync with folder hierarchy |
| Progress tracked in spreadsheets | Real-time dashboard with status tabs |
| Paper forms for signatures | Digital PDF signing with audit trail |
| No visibility into client progress | Live progress bars and status indicators |

---

## 2. Problem Statement

### Primary Problems Solved

1. **Document collection friction:** Clients often don't know exactly which documents they need. The questionnaire guides them step-by-step with contextual instructions (e.g., "Contact your employer for Form 106").

2. **Progress invisibility:** CPAs had no real-time view of which clients had started, how far they'd gotten, or what was missing.

3. **Manual filing overhead:** Every received document had to be manually saved, renamed, and organized in Google Drive folders.

4. **Signature collection:** Power of attorney forms, declarations, and other signed documents required physical printing, signing, and scanning.

5. **Multi-year management:** Clients return annually. The system must support multiple tax years per client without data collision.

6. **Conditional questioning:** Different business types (עוסק פטור vs. עוסק מורשה) require different document sets. The questionnaire must adapt.

### Non-Goals

- The platform does **not** prepare or file tax returns. It only collects documents and signed forms.
- The platform does **not** process payments. Pricing is displayed to clients but no payment flow exists.
- The platform does **not** replace the CPA's professional judgment. It organizes and presents collected data.

---

## 3. Target Users & Roles

### 3.1 CPA (Admin)
- **Authentication:** Base44 platform login (email/password via AuthProvider)
- **Capabilities:**
  - View dashboard of all clients and their submission progress
  - Add/edit/archive clients
  - Create new submissions (tax year cycles)
  - Edit questionnaire templates
  - Create/edit PDF signing templates
  - Fill questionnaires on behalf of clients (with audit trail)
  - Sync files to Google Drive
  - Invite team members
  - Approve submissions for IRA (Israel Revenue Authority) filing
  - Mark submissions as filed
  - Configure settings (Drive connection, base folder path)

### 3.2 Client (Unauthenticated)
- **Authentication:** Token-based URL access (no login required)
- **Capabilities:**
  - Access questionnaire via unique secure link: `/questionnaire?client={id}&token={token}`
  - Answer yes/no questions about their tax situation
  - Upload documents (PDF, images) directly from browser/mobile
  - Write free-text descriptions (e.g., additional income details)
  - Select options from single/multi-choice lists
  - Sign digital PDF forms (text fields, checkboxes, signatures)
  - View completion summary
  - Resume questionnaire at any time (auto-save)
  - Edit previous answers via step selector

### 3.3 Team Member (Admin)
- Same capabilities as CPA
- Invited via email by an existing admin
- All actions on client submissions are audited with the CPA's identity

---

## 4. System Architecture

### 4.1 Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18 + Vite + Tailwind CSS + shadcn/ui |
| **Backend (BaaS)** | Base44 platform (entities, functions, auth, automations) |
| **Backend Functions** | Deno Deploy (TypeScript) — `base44/functions/*/entry.ts` |
| **PDF Generation** | AWS Lambda (Node.js) — `lambda/pdf-generator/` |
| **PDF Library** | @pdfme (generator, schemas, ui) — server-side only on Lambda |
| **File Storage** | Base44 private storage (S3-backed) |
| **External Sync** | Google Drive API (OAuth app-user connector) |
| **Notifications** | Telegram Bot API |
| **Error Monitoring** | Sentry (@sentry/react + @sentry/vite-plugin) |
| **Version Control** | GitHub (2-way sync with Base44) |
| **CI/CD** | GitHub Actions (Lambda deployment) |
| **Infrastructure** | Terraform (AWS Lambda + API Gateway for test/prod) |

### 4.2 High-Level Data Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  CPA Dashboard │     │  Base44 Backend   │     │  Google Drive    │
│  (React SPA)   │────▶│  (Entities +      │────▶│  (File Sync)     │
│                │     │   Functions)      │     │                  │
└─────────────┘     └────────┬─────────┘     └─────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Client           │
                    │  Questionnaire    │
                    │  (Public, Token)  │
                    └────────┬──────────┘
                             │
                    ┌────────▼──────────┐
                    │  AWS Lambda        │
                    │  (PDF Render +     │
                    │   Generate)        │
                    └───────────────────┘
```

### 4.3 Route Architecture

The app has two separate route trees:

**Public routes (no auth):**
- `/questionnaire` — Main client questionnaire
- `/questionnaire/sign` — PDF signing page (lazy-loaded)

**Authenticated routes (CPA dashboard):**
- `/` — Dashboard (client list with status tabs)
- `/clients` — Client management (add, edit, archive)
- `/users` — Team management
- `/settings` — Google Drive connection, profile
- `/questionnaire-settings` — Questionnaire template editor
- `/pdf-templates` — PDF template editor (pdfme designer)
- `/cpa-fill` — Fill questionnaire on behalf of client

**Dev-only routes:**
- `/pdf-test`, `/pdf-sign-test`, `/questionnaire/sign-poc-*` — POC testing pages

### 4.4 Environment Separation

| Environment | Database | Lambda API | Purpose |
|---|---|---|---|
| **Production** | Production DB | `hickopn9f0.execute-api.il-central-1.amazonaws.com` | Live app at `app.ddcpa.co.il` |
| **Test/Dev** | Test DB (editor preview only) | `mr8yrlc9ic.execute-api.il-central-1.amazonaws.com` | Development & testing |

**Critical constraint:** Backend functions always query the **Production** database. The Test database is only accessible in the editor preview. Testing the full questionnaire flow requires either using the editor preview or creating temporary test clients in Production.

---

## 5. Data Model

### 5.1 Entity: Client

Stores client profile and onboarding state.

| Field | Type | Description |
|---|---|---|
| `full_name` | string (required) | Client's full name |
| `email` | string | Email address |
| `phone` | string | Phone number |
| `token` | string | Unique access token for questionnaire link (no password needed) |
| `tax_year` | number (default: 2024) | Active tax year for this client |
| `osek_type` | enum: `"עוסק פטור"` / `"עוסק מורשה"` | Business type — used for conditional questionnaire steps |
| `pricing` | number (default: 1500) | Annual report price in NIS (₪) |
| `status` | enum: `pending` / `in_progress` / `completed` / `ready_for_ira` / `reviewed` (default: `pending`) | Submission status |
| `notes` | string | Internal CPA notes |
| `last_activity` | date-time | Last activity timestamp |
| `is_archived` | boolean (default: false) | Whether client is archived |

**Built-in fields:** `id`, `created_date`, `updated_date`, `created_by_id`

### 5.2 Entity: Submission

Stores the actual questionnaire responses for a client + tax year. One client can have multiple submissions (one per tax year).

| Field | Type | Description |
|---|---|---|
| `client_id` | string (required) | Reference to Client |
| `tax_year` | number (default: 2024) | Tax year this submission covers |
| `cpa_status` | enum: `ready_for_ira` / `reviewed` | CPA-set status (overrides derived status) |
| `is_employee` | boolean | *(Legacy flat field)* Was employee |
| `form_106_uploaded` | boolean | *(Legacy)* |
| `form_106_files` | array[string] | *(Legacy)* |
| `multiple_employers` | boolean | *(Legacy)* |
| `has_pension_fund` | boolean | *(Legacy)* |
| `pension_files` | array[string] | *(Legacy)* |
| `has_stock_market` | boolean | *(Legacy)* |
| `form_867_uploaded` | boolean | *(Legacy)* |
| `form_867_files` | array[string] | *(Legacy)* |
| `has_life_insurance` | boolean | *(Legacy)* |
| `insurance_files` | array[string] | *(Legacy)* |
| `has_donations` | boolean | *(Legacy)* |
| `donation_files` | array[string] | *(Legacy)* |
| `has_additional_income` | boolean | *(Legacy)* |
| `additional_income_details` | string | *(Legacy)* |
| `step_completed` | number (default: 0) | Last completed step index |
| `completed_at` | date-time | Completion timestamp |
| `template_version` | number | Template version when submitted |
| `template_id` | string | Template ID when submitted |
| `responses` | string (JSON) | Dynamic responses: `{ stepId: { answer, files[], file_names[], text, selected[], title, emoji } }` |
| `pdf_inputs` | string (JSON) | *(Legacy)* PDF field values |
| `pdf_file_url` | string | *(Legacy)* Final signed PDF URL |
| `pdf_template_id` | string | *(Legacy)* |
| `signed_pdfs` | string (JSON array) | Signed PDF records: `[{ step_id, step_title, template_name, pdf_template_id, pdf_file_url, audit_trail, incomplete }]` |
| `cpa_audit_log` | string (JSON array) | CPA fill audit: `[{ cpa_email, cpa_name, step_id, timestamp, action }]` |
| `alert_sent` | boolean (default: false) | Whether completion notification was sent |
| `is_archived` | boolean (default: false) | Whether submission is archived |

**Legacy vs. Dynamic format:** The system supports both old flat-field submissions (where each question had dedicated boolean/array fields) and new dynamic submissions (where all responses are stored in a single `responses` JSON string keyed by step ID). The `submission-compat.js` module handles conversion transparently.

### 5.3 Entity: QuestionnaireTemplate

Versioned questionnaire templates. Only one is active at a time.

| Field | Type | Description |
|---|---|---|
| `version` | number (default: 1) | Template version number |
| `is_active` | boolean (default: true) | Whether this template is currently active |
| `steps` | string (required, JSON) | JSON-encoded array of step configurations |
| `created_by_email` | string | Email of the user who created this template |

**Built-in fields:** `id`, `created_date`, `updated_date`, `created_by_id`

### 5.4 Entity: PdfTemplate

PDF form templates for digital signing.

| Field | Type | Description |
|---|---|---|
| `name` | string (required) | Template display name |
| `template_json` | string (required, JSON) | JSON-encoded pdfme template (basePdf as file_uri ref, schemas, fieldMapping) |
| `is_active` | boolean (default: true) | Whether template is active and shown to clients |

### 5.5 Entity: SyncedDriveFile

Tracks which files have already been synced to Google Drive (prevents duplicates).

| Field | Type | Description |
|---|---|---|
| `submission_id` | string (required) | Reference to Submission |
| `original_file_url` | string (required) | Original file URI from Base44 storage (unique key) |
| `drive_file_id` | string (required) | Google Drive File ID |
| `drive_parent_folder_id` | string | Drive folder ID where file is located |
| `file_name_on_drive` | string | Name of file on Drive |
| `synced_at` | date-time | Sync timestamp |

### 5.6 Entity: User (Built-in)

| Field | Description |
|---|---|
| `id`, `created_date`, `full_name`, `email` | Built-in (read-only) |
| `role` | `"admin"` or `"user"` (default: `"admin"` for this app) |
| `drive_base_path` | Custom field — Google Drive base folder path (e.g., `"לקוחות/מיסים"`) |

---

## 6. Feature: CPA Dashboard

**Page:** `src/pages/CpaDashboard.jsx`  
**Route:** `/` (authenticated)

### 6.1 Overview

The dashboard is the CPA's primary interface. It displays all non-archived clients organized by submission status.

### 6.2 Status Pipeline

```
pending → in_progress → completed → ready_for_ira → reviewed
   │          │              │            │              │
   └──────────┴──────────────┘            │              │
         (Grouped as "בתהליך")            │              │
                                         ↓              ↓
                                  "מוכן להגשה לרמ"ש"  "הוגש"
```

**Status derivation logic (priority order):**
1. `submission.cpa_status` (if set by CPA — takes precedence)
2. `client.status` (legacy, if `ready_for_ira` or `reviewed`)
3. Progress-derived: `100%` → `completed`, `>0%` → `in_progress`, `0%` → `pending`

### 6.3 Dashboard Tabs

| Tab | Label (Hebrew) | Statuses Included |
|---|---|---|
| `in_progress` | בתהליך | `pending`, `in_progress`, `completed` |
| `ready_for_ira` | מוכן להגשה לרמ"ש | `ready_for_ira` |
| `reviewed` | הוגש | `reviewed` |

Each tab shows a count badge. The CPA can search clients by name or email.

### 6.4 Dashboard Header

- **Logo:** Doron & Doron brand image
- **Navigation buttons:** Settings, Questionnaire Settings, Clients, New Submission

### 6.5 Client Row (Expandable)

**Page:** `src/components/dashboard/ClientRow.jsx`

Each client appears as a row showing:
- Avatar (first letter of name)
- Client name + status badge + tax year + osek type + pricing
- Progress bar (percentage based on answered steps)
- Copy link button (generates/regenerates token if missing)

**When expanded, shows:**

1. **Year tabs** — If client has submissions for multiple tax years, tabs appear to switch between them
2. **Contact info** — Email (mailto), phone (tel) links
3. **Osek type & pricing** badges
4. **Progress breakdown** — Grid of all questionnaire steps with status indicators:
   - ✅ Green: Answered "yes" with files/complete
   - — Gray: Answered "no" (not relevant)
   - ⏳ Muted: Not yet answered
   - ⚠️ Amber: PDF signed but incomplete
   - CPA audit badge (if CPA filled this step)
5. **Files section** — All uploaded files grouped by step, with:
   - File preview modal (images shown inline, PDFs in iframe, others download)
   - Per-file open/download buttons (signed URLs)
   - "Download All (ZIP)" button — backend generates a ZIP archive
   - Signed PDFs are included in the ZIP
6. **Signed PDFs section** — List of signed digital forms with view/download
7. **Text responses** — Free-text answers (e.g., additional income details) displayed in blue callout
8. **Last activity** date
9. **Actions:**
   - **Change tax year** — Starts a new tax year (requires osek_type to be set)
   - **Archive submission** — Moves current year's submission to archive
   - **Restore submission** — Restores archived submission (with conflict resolution if active exists)
   - **Edit details** — Opens EditClientModal
   - **Fill on behalf** — Navigates to CPA fill mode
   - **Sync to Drive** — Syncs this submission's files to Google Drive
   - **Approve for IRA** — Sets status to `ready_for_ira` (only when `completed`)
   - **Mark as filed** — Sets status to `reviewed` (only when `ready_for_ira`)

### 6.6 New Submission Modal

**Page:** `src/components/dashboard/AddSubmissionModal.jsx`

- Search and select existing client
- Choose tax year (defaults to previous year)
- Warns if submission already exists for that year
- Updates client's `tax_year` and resets status to `pending`

---

## 7. Feature: Client Questionnaire (Public)

**Page:** `src/pages/ClientQuestionnaire.jsx`  
**Route:** `/questionnaire?client={id}&token={token}` (public, no auth)

### 7.1 Access Flow

1. CPA generates a link from the dashboard: `{origin}/questionnaire?client={clientId}&token={token}`
2. If no token exists, clicking "Copy Link" auto-generates one
3. Client opens link — no login required
4. System validates `client_id` + `token` via `getClientByToken` backend function
5. If invalid: shows error screen ("לינק לא תקין — פנה לרואה החשבון שלך")

### 7.2 Questionnaire Flow

```
Welcome Screen → Step 1 → Step 2 → ... → Step N → Completion Screen
     ↑                                                        │
     │                                                        │
     └──────────── Edit Answers (from completion) ────────────┘
```

**Steps array structure:** `[welcome, ...contentSteps, done]`

### 7.3 Template Resolution

On load, the system determines which template to use:

1. **If submission is completed** (`completed_at` exists): Load the historical template that was active when the submission was made (using `template_id` stored on the submission). This ensures the client always sees the same questions they answered.
2. **If submission is in-progress or new**: Load the current active template. Filter out responses for steps that no longer exist in the template.

### 7.4 Year Placeholder Resolution

All `{year}` placeholders in step titles, questions, and config descriptions are replaced with the client's actual tax year before rendering.

### 7.5 Conditional Step Filtering

Steps are filtered based on client attributes (see [§8.5](#85-conditional-display)).

### 7.6 Resume Logic

When a client returns to an in-progress questionnaire:
- Parse existing responses and signed PDFs
- Find the first unanswered step
- If `step_completed` is ahead of the first unanswered step (possible race condition), trust `step_completed`
- If the client has at least one answer, skip the welcome screen

### 7.7 Save Queue (Anti-Data-Loss)

All saves are chained through a `saveQueue` (Promise chaining) to prevent:
- Race conditions from rapid clicking "Continue"
- Concurrent update conflicts
- Answer loss when navigating quickly

Each save includes `step_completed`, `template_version`, and `template_id`.

### 7.8 Stale Submission Handling

If the CPA archives the submission while the client is filling it out, the `updateClientSubmission` function returns `{ error: 'submission_archived', reload: true }`. The client sees a "השאלון עודכן" screen prompting them to reload.

### 7.9 WhatsApp Webview Compatibility

The questionnaire is designed to work inside WhatsApp's in-app browser (WKWebView), which:
- Blocks `localStorage` (wrapped in try-catch)
- May have different rendering behavior
- Auth tokens are explicitly cleared to prevent SDK auto-authentication on public pages

### 7.10 File Upload

**Component:** `src/components/questionnaire/QuestionStep.jsx`

- Uploads go directly to the `uploadFile` backend function
- Client-side auth: `client_id` + `token` passed as URL query params
- Uses `XMLHttpRequest` for real-time upload progress tracking (per-file progress bars)
- Progress capped at 90% until server confirms (then 100%)
- Supports drag-and-drop and click-to-select
- Accepted formats: `.pdf, .jpg, .jpeg, .png, .heic`
- Files stored in Base44 private storage (S3-backed)
- Existing files can be removed before continuing

### 7.11 Step Selector

**Component:** `src/components/questionnaire/StepSelector.jsx`

A dropdown that allows clients to navigate back to previously completed steps. Shows:
- Current step (highlighted)
- Completed steps (✓)
- Incomplete steps (⚠)
- Unanswered steps (⏳)

### 7.12 Completion Screen

**Component:** `src/components/questionnaire/CompletionScreen.jsx`

- Shows "כל הכבוד!" (Congratulations!) message
- Summary of all answered steps with status
- Signed PDF status
- "Edit Answers" button to go back

---

## 8. Feature: Dynamic Questionnaire Templates

### 8.1 Overview

The CPA can fully customize the questionnaire without code changes. Templates are versioned — saving creates a new version and deactivates the previous one.

### 8.2 Step Configuration Schema

Each step in the template has the following structure:

```json
{
  "id": "employee",
  "emoji": "💼",
  "title": "עבודה כשכיר",
  "question": "האם היית שכיר בשנת {year}?",
  "yes_label": "כן, הייתי שכיר",
  "no_label": "לא, לא הייתי שכיר",
  "response_type": "upload",
  "upload_config": {
    "title": "טופס 106",
    "description": "יש לפנות למעסיק ולבקש טופס 106 לשנת {year}.",
    "upload_label": "העלאת טופס 106",
    "accept": ".pdf,.jpg,.jpeg,.png,.heic"
  },
  "text_config": null,
  "select_config": null,
  "pdf_sign_config": null,
  "condition": null,
  "skip_question": false,
  "enabled": true,
  "order": 0,
  "is_default": true
}
```

### 8.3 Response Types

| Type | Description | Config Field |
|---|---|---|
| `upload` | File upload (multiple files, with progress) | `upload_config` |
| `text` | Free-text textarea | `text_config` |
| `single_select` | Single-choice from options | `select_config` |
| `multi_select` | Multi-choice from options | `select_config` |
| `pdf_sign` | Digital PDF form signing | `pdf_sign_config` |
| `none` | Yes/No question only (no follow-up content) | — |

### 8.4 Skip Question Mode

For `upload` and `pdf_sign` response types, the CPA can enable `skip_question: true`:
- The yes/no question is hidden
- The step directly shows the upload/signing interface
- The answer is implicitly `true`

### 8.5 Conditional Display

Each step can have a `condition` object that determines visibility based on client attributes:

```json
{
  "condition": {
    "type": "osek_type",
    "field": "osek_type",
    "values": ["עוסק מורשה"]
  }
}
```

Currently supported condition types:
- `osek_type` — Shows step only if client's `osek_type` matches one of the `values`

**Filtering function:** `filterStepsByClientConditions(steps, client)` — applied both in the questionnaire and in the dashboard.

### 8.6 Default Steps (v1 Seed)

When no template exists, the system seeds with these default steps:

| # | ID | Title | Response Type |
|---|---|---|---|
| 0 | `employee` | עבודה כשכיר (Employee) | upload (Form 106) |
| 1 | `pension` | פנסיה / קרן השתלמות (Pension) | upload — **condition: עוסק מורשה only** |
| 2 | `stocks` | שוק ההון (Stock Market) | upload (Form 867) |
| 3 | `insurance` | ביטוח חיים (Life Insurance) | upload |
| 4 | `donations` | תרומות (Donations) | upload |
| 5 | `additional` | הכנסות נוספות (Additional Income) | text |
| 6 | `income_sources` | מקורות הכנסה (Income Sources) | multi_select |
| 7 | `education_status` | סטטוס לימודים (Education) | single_select |

### 8.7 Template Editor

**Component:** `src/components/dashboard/QuestionnaireEditor.jsx`  
**Page:** `src/pages/QuestionnaireSettings.jsx` (route: `/questionnaire-settings`)

Features:
- Drag-to-reorder steps (up/down arrows)
- Add custom steps (auto-generated IDs: `custom_xxxxxx`)
- Default steps can only be disabled, not deleted
- Edit all step fields (emoji, title, question, labels, response type, configs)
- Emoji picker (predefined set)
- Conditional display selector (osek type)
- Skip question toggle
- PDF template selector (for `pdf_sign` steps)
- Version history viewer
- Save creates a new version (deactivates previous)
- `{year}` placeholder hint displayed in editor

### 8.8 Version History

**Component:** `src/components/dashboard/VersionHistory.jsx`

- Lists all template versions
- Shows version number, creation date, creator email
- Previous versions are inactive but retained for historical reference

### 8.9 Template Persistence

**Backend function:** `saveQuestionnaireTemplate`
- Validates all steps have `id`, `title`, `question`
- Deactivates all currently active templates
- Increments version number
- Creates new template with `is_active: true`
- Steps stored as JSON string

**Backend function:** `getActiveTemplate`
- Returns the active template (highest version with `is_active: true`)
- If no template exists, creates and returns the default v1 seed

---

## 9. Feature: PDF Template Editor & Digital Signing

### 9.1 PDF Template Editor

**Page:** `src/pages/PdfTemplateEditor.jsx` (route: `/pdf-templates`)

Uses the **@pdfme Designer** library (lazy-loaded, ~2MB) to create PDF form templates.

**Workflow:**
1. CPA uploads a base PDF (e.g., power of attorney form)
2. CPA drags fields onto the PDF: text, checkbox, signature
3. CPA can map text fields to automatic data sources:
   - שנת המס (tax_year)
   - שם מלא (full_name)
   - אימייל (email)
   - טלפון (phone)
   - תעודת זהות (id_number)
   - תאריך היום (today)
4. Mapped fields are auto-filled from client data, set to `readOnly`, and the sidebar is locked
5. Signature fields are automatically set to `required: true`
6. Template saved with base PDF stored as a file_uri reference (not inline base64)
7. Template includes a `fieldMapping` object: `{ fieldName: "data_source" }`

**Template storage format:**
```json
{
  "name": "ייפוי כוח",
  "template_json": "{\"basePdf\":{\"__type\":\"file_uri\",\"value\":\"mp/...\"},\"schemas\":[[...]],\"fieldMapping\":{\"שם מלא\":\"full_name\"}}",
  "is_active": true
}
```

### 9.2 Digital PDF Signing (Client Side)

**Page:** `src/pages/PdfSignIframeOverlay.jsx` (route: `/questionnaire/sign`)

This is the client-facing PDF signing experience. It uses a **server-rendered image overlay** approach (zero client-side PDF rendering):

**Architecture:**
1. Client navigates to sign page with `client`, `token`, `step_id`, `template_id` params
2. System loads client data + PDF template
3. Requests the Lambda `/render-pages` endpoint to convert the base PDF to JPEG page images
4. Renders each page as an `<img>` with HTML overlay fields positioned by percentage

**Field types rendered:**
- **Text inputs** — Positioned over the image, auto-filled from client data if mapped
- **Checkboxes** — Clickable toggle overlays
- **Signature fields** — Opens a signature pad modal (LightweightSignaturePad component)

**Submission flow:**
1. Client fills all required fields
2. Validates required fields are filled
3. Sends template JSON + inputs to Lambda `/generate-pdf` endpoint
4. Lambda generates final PDF using @pdfme/generator with Heebo font
5. Returns PDF as base64 (API Gateway binary) or raw blob
6. Client uploads the generated PDF to Base44 storage via `uploadFile`
7. Creates a signed PDF record and updates the submission via `updateClientSubmission`
8. Record includes audit trail: timestamp, user agent, screen resolution
9. Redirects back to questionnaire with updated submission state

**Auto-fill logic:** Fields are auto-filled if:
- They have a `fieldMapping` entry matching a data source
- Their name starts with `sys:` prefix
- Their normalized name matches a known field (full_name, email, etc.)

### 9.3 PDF API (AWS Lambda)

**Location:** `lambda/pdf-generator/index.mjs`

**Endpoints:**

| Endpoint | Method | Purpose |
|---|---|---|
| `/render-pages` | POST | Converts base PDF to JPEG page images (using pdfjs-dist + canvas) |
| `/generate-pdf` | POST | Generates final signed PDF (using @pdfme/generator) |
| `/health` | GET | Health check |

**Environment routing:**
- Production (`app.ddcpa.co.il`): `hickopn9f0.execute-api.il-central-1.amazonaws.com`
- Test/Dev: `mr8yrlc9ic.execute-api.il-central-1.amazonaws.com`
- Override: `VITE_PDF_API_URL` env variable

**Lambda details:**
- Runtime: Node.js
- Dependencies: @pdfme/generator, @pdfme/schemas, pdfjs-dist, @napi-rs/canvas
- Heebo font loaded from bundled file (`fonts/Heebo-Regular.ttf`)
- Polyfills: `DOMMatrix`, `Path2D` (for pdfjs-dist compatibility)
- Canvas factory for server-side rendering
- CORS headers configurable via `CORS_ORIGIN` env variable
- Deployed via GitHub Actions CI/CD

### 9.4 Signed PDF Records

Each signed PDF is stored in the submission's `signed_pdfs` JSON array:

```json
{
  "step_id": "power_of_attorney",
  "step_title": "ייפוי כוח",
  "pdf_template_id": "abc123",
  "template_name": "ייפוי כוח",
  "pdf_file_url": "mp/signed-documents/...",
  "audit_trail": {
    "signed_at": "2026-01-15T10:30:00.000Z",
    "user_agent": "Mozilla/5.0...",
    "screen_resolution": "1920x1080"
  },
  "incomplete": false
}
```

- `incomplete: false` — All required fields were filled
- `incomplete: true` — Saved but some required fields are missing (client can return to complete)
- Legacy `pdf_inputs` are stripped from old records to avoid field size bloat

### 9.5 Backend Functions for PDF

| Function | Purpose |
|---|---|
| `getPdfTemplateById` | Fetch a specific PDF template by ID |
| `getActivePdfTemplates` | List all active PDF templates |
| `getTemplateFileUrl` | Generate signed URL for a template's base PDF (client-token auth) |
| `getSignedPdfUrl` | Generate signed URL for a client's signed PDF (client-token auth) |
| `createSignedUrl` | Generate signed URL for any private file (CPA auth) |

---

## 10. Feature: File Management & Google Drive Sync

### 10.1 File Upload

**Backend function:** `uploadFile`

**Dual authentication:**
1. **Client token** — `client_id` + `token` as URL query params (for public questionnaire)
2. **CPA JWT** — Bearer token in Authorization header (for dashboard)

Uploads to Base44 private storage via `Core.UploadPrivateFile`. Returns `{ file_uri }`.

### 10.2 File Access (Signed URLs)

All stored files are private URIs (prefix `mp/` or `private/`). Access requires generating time-limited signed URLs:

- **Client-side:** Via `getSignedPdfUrl` or `getTemplateFileUrl` backend functions (token-authenticated)
- **Dashboard:** Via `Core.CreateFileSignedUrl` integration (authenticated)
- **Default expiry:** 3600 seconds (1 hour)

### 10.3 Google Drive Integration

**Connector:** Google Drive (app-user OAuth, workspace-registered)  
**Connector ID:** `69fb22f94d2b7077430e5187`  
**Connector Name:** "Google Drive Sync"

**Connection flow:**
1. CPA navigates to Settings (`/settings`)
2. Clicks "Connect to Google Drive"
3. OAuth popup via `base44.connectors.connectAppUser(connectorId)`
4. After OAuth completes, connection is verified via `syncFilesToGoogleDrive` function with `check_connection: true`
5. Connected email is displayed
6. CPA can disconnect at any time

**Configuration:**
- **Base path:** CPA can set a Drive base folder path (e.g., `"לקוחות/מיסים"`)
- Stored on the User entity as `drive_base_path`

### 10.4 Drive Sync — Single Submission

**Backend function:** `syncFilesToGoogleDrive` (single mode)

**Folder structure created on Drive:**
```
{base_path} / {client_name} / {tax_year} / {document_type} / {file}
```

Example:
```
לקוחות/מיסים / ישראל ישראלי / 2024 / טופס 106 / טופס 106 - קובץ 1.pdf
לקוחות/מיסים / ישראל ישראלי / 2024 / ייפוי כוח / ייפוי כוח - חתום.pdf
```

**Sync logic:**
1. Collect all file URIs from submission (responses + signed PDFs)
2. Check `SyncedDriveFile` records to find already-synced files
3. Skip files that are already synced (deduplication)
4. Generate signed URLs for private files
5. Ensure folder structure exists (search or create folders, with caching)
6. Upload files to Drive via multipart upload API
7. Create `SyncedDriveFile` record for each uploaded file
8. Return counts: `{ uploadCount, skippedCount }`

### 10.5 Drive Sync — Batch (All Submissions)

**Backend function:** `syncFilesToGoogleDrive` (batch mode, `sync_all: true`)

**Component:** `src/components/dashboard/SyncAllDriveButton.jsx`

- Syncs all submissions that have `completed_at` or `step_completed >= 1`
- Loads submissions + clients in batches of 20
- Loads ALL `SyncedDriveFile` records in one query (no per-submission queries)
- Pre-filters submissions that actually need syncing
- Shared folder cache across all submissions
- Shared signed URL cache
- Parallelized uploads in batches of 5 (respects Drive rate limits)
- Progress indicator with counts

### 10.6 Bulk ZIP Download

**Backend function:** `downloadAllFiles`

- Generates a ZIP archive of all files for a client
- Uses `jszip` library server-side
- Generates signed URLs for each private file
- Determines file extension from content-type
- Filename: `{client_full_name}.zip`
- Includes signed PDFs in the ZIP (manually pushed into file list in ClientRow)

### 10.7 File Preview

**Component:** `FilePreviewModal` in `ClientRow.jsx`

- **Images** (jpg, png, heic, webp, gif): Displayed inline with `<img>`
- **PDFs**: Displayed in `<iframe>`
- **Other types**: Shows file type icon with download link
- All previews use signed URLs
- Includes download and open-in-new-tab buttons

---

## 11. Feature: CPA Fill-on-Behalf Mode

**Page:** `src/pages/CpaFillQuestionnaire.jsx` (route: `/cpa-fill?client={id}`)

### 11.1 Purpose

Allows a CPA to fill the questionnaire on behalf of a client (e.g., over the phone, or when the client sends documents via email).

### 11.2 Key Differences from Client Questionnaire

| Aspect | Client Questionnaire | CPA Fill Mode |
|---|---|---|
| Authentication | Token-based (no login) | CPA JWT (authenticated) |
| Welcome screen | Shown | Skipped (starts at step 1) |
| Save function | `updateClientSubmission` | `cpaSaveSubmission` |
| PDF signing | Full signing experience | Blocked (CPA sees message: "טפסי חתימה מיועדים ללקוח בלבד") |
| Audit trail | None | Every save logged with CPA email/name |
| Banner | None | Amber banner: "מילוי עבור הלקוח: {name} \| כל פעולה תתועד תחת: {cpa_email}" |

### 11.3 CPA Audit Log

**Backend function:** `cpaSaveSubmission`

Every save creates an audit entry:

```json
{
  "cpa_email": "cpa@ddcpa.co.il",
  "cpa_name": "דורון כהן",
  "step_id": "employee",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "action": "fill"
}
```

Entries are appended to `submission.cpa_audit_log` (JSON array). Displayed in the dashboard via `CpaAuditBadge` component.

### 11.4 CPA Audit Badge

**Component:** `src/components/dashboard/CpaAuditBadge.jsx`

- Shows "מילוי ע"י רו"ח" badge on steps filled by a CPA
- Expandable to show full audit log entries (CPA name, email, timestamp, action)

---

## 12. Feature: Team Management

**Page:** `src/pages/UserManagement.jsx` (route: `/users`)  
**Component:** `src/components/dashboard/TeamSection.jsx`

### 12.1 Capabilities

- **Invite CPA:** Enter email, sends invitation via `base44.users.inviteUser(email, "admin")`
- **View team members:** Lists all users with `role === "admin"`
- **Current user info:** Shows who is currently logged in
- **Delete member:** Button shown for non-current users (UI only, not yet wired to backend)

### 12.2 Roles

All users in this app are `admin` role. The `user` role is not used — the app is a single-firm tool where all team members have full access.

---

## 13. Feature: Submission Readiness AI Agent

**Agent:** `submission_readiness` (`base44/agents/submission_readiness.jsonc`)

### 13.1 Purpose

An AI agent that analyzes client tax submissions to determine readiness for CPA processing.

### 13.2 Capabilities

- Reads `Submission` and `Client` entities
- Cross-references client claims with uploaded documents
- Provides readiness status:
  - ✅ Ready (all questions answered, correct documents uploaded)
  - ⚠️ Incomplete (missing answers or documents)
  - ❌ Not Ready (mismatches between claims and documents)
- Lists specific issues and what the CPA needs to do next

### 13.3 UI Integration

**Component:** `src/components/dashboard/SubmissionReadinessChat.jsx`

- Chat interface for conversing with the agent
- Uses `base44.agents` SDK (subscribeToConversation, addMessage, getConversation)
- Messages rendered as chat bubbles

### 13.4 Permissions

- `Submission` entity: read only
- `Client` entity: read only

---

## 14. Feature: Notifications & Automations

### 14.1 Telegram Notification on Completion

**Backend function:** `notifySubmissionCompleted`

**Trigger:** Entity automation on `Submission` update (when `step_completed > 0` and `alert_sent === false`)

**Behavior:**
1. Detects newly completed submission
2. Fetches client info
3. Sends Telegram message to configured chat:

```
✅ הגשה מוכנה לסקירה

👤 ישראל ישראלי
📅 שנת מס: 2024
🏢 סוג עוסק: עוסק מורשה

→ [בדוק בדשבורד](app_url?client=client_id)
```

4. Sets `alert_sent: true` on the submission (prevents duplicate alerts)

**Environment variables required:**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `APP_URL`

### 14.2 Entity Automations

The system supports entity automations that trigger backend functions on entity changes (create/update/delete). Currently configured:
- Submission update → `notifySubmissionCompleted`

---

## 15. Feature: Archiving & Multi-Year History

### 15.1 Client Archiving

- Clients can be archived (soft delete via `is_archived: true`)
- Archived clients don't appear in the dashboard
- Archived clients appear in the Clients page archive view
- Can be restored at any time

### 15.2 Submission Archiving

- Individual submissions (tax years) can be archived
- Archived submissions don't appear as the "active" submission
- Can be restored with conflict resolution:
  - If an active submission exists for the same year, a dialog asks the CPA to choose:
    - **Restore** the archived one (and archive the currently active one)
    - **Keep** the current active one (leave archived as-is)

### 15.3 Multi-Year Support

- Each client has an active `tax_year`
- Multiple submissions can exist per client (one per year)
- "Change tax year" action updates the client's active year
- Year tabs appear in the expanded client row when multiple submissions exist
- When changing to a year that has an archived submission with a CPA status, that status is restored

### 15.4 Archive View

**Page:** `src/pages/ClientsPage.jsx` (route: `/clients`)

- Shows active clients by default
- Toggle to view archived clients and archived submissions
- Search by name, email, or phone
- Restore archived items
- Edit client details
- Archive/restore individual clients

### 15.5 Submission Deletion with Files

**Backend function:** `deleteSubmissionWithFiles`

- Collects all file URIs from a submission (legacy fields + dynamic responses + signed PDFs)
- Deletes all associated files from storage (fire-and-forget)
- Deletes the submission record

---

## 16. Security & Access Control

### 16.1 Authentication Models

| Context | Auth Method | Implementation |
|---|---|---|
| CPA Dashboard | Base44 AuthProvider (JWT) | `base44.auth.isAuthenticated()`, `base44.auth.redirectToLogin()` |
| Client Questionnaire | Token-based (URL params) | `client_id` + `token` validated server-side |
| File Upload (client) | Token in URL query | Validated in `uploadFile` function |
| File Upload (CPA) | JWT Bearer token | Validated in `uploadFile` function |
| Backend Functions | `createClientFromRequest(req)` | SDK handles auth context |

### 16.2 Token Security

- Tokens are random strings: `Math.random().toString(36).substring(2, 18)` (16 characters)
- Stored on the Client entity
- Can be regenerated by the CPA at any time
- Validated on every backend call that accepts client credentials
- If no token exists, the "Copy Link" button shows "תקן לינק" (Fix Link) in red

### 16.3 Public Page Security

- Auth tokens are explicitly cleared from `localStorage` on public questionnaire pages
- Prevents SDK auto-authentication
- Wrapped in try-catch for WhatsApp WKWebView compatibility

### 16.4 File Access Security

- All files stored as private URIs (S3-backed)
- Access requires signed URLs (time-limited, default 1 hour)
- Client-side access validated via token
- Dashboard access validated via JWT

---

## 17. Infrastructure & DevOps

### 17.1 Version Control

- **Repository:** GitHub (2-way sync with Base44)
- Commits synced automatically to Base44 deployment
- Branch: `main` (production)

### 17.2 CI/CD Pipeline

**GitHub Actions workflows:**

| Workflow | Purpose |
|---|---|
| `deploy-lambda.yml` | Deploy Lambda to test environment |
| `deploy-lambda-prod.yml` | Deploy Lambda to production environment |
| `rollback-prod.yml` | Rollback production Lambda to previous version |

### 17.3 Infrastructure as Code

**Terraform configurations:**

| Path | Environment |
|---|---|
| `infra/test/main.tf` | Test Lambda + API Gateway |
| `infra/prod/main.tf` | Production Lambda + API Gateway |

**AWS resources:**
- Lambda function (Node.js)
- API Gateway (HTTP API, binary support)
- IAM roles and permissions
- CloudWatch logs

### 17.4 Environment Variables

**App secrets (Base44 dashboard):**

| Secret | Purpose |
|---|---|
| `AWS_ACCESS_KEY_ID` | AWS access for Lambda deployment |
| `AWS_SECRET_ACCESS_KEY` | AWS secret for Lambda deployment |
| `AWS_REGION` | AWS region (il-central-1) |
| `APP_URL` | App URL for Telegram notification links |
| `TELEGRAM_BOT_TOKEN` | Telegram bot for notifications |
| `TELEGRAM_CHAT_ID` | Telegram chat ID for notifications |

**Lambda environment variables:**

| Variable | Purpose |
|---|---|
| `CORS_ORIGIN` | Allowed origin for CORS (prod: `app.ddcpa.co.il`) |

**Frontend environment variables:**

| Variable | Purpose |
|---|---|
| `VITE_BASE44_APP_ID` | Base44 app ID |
| `VITE_PDF_API_URL` | Override PDF Lambda API URL |

### 17.5 Build Configuration

- **Vite** with `@base44/vite-plugin`
- **Sentry** integration via `@sentry/vite-plugin` (source map upload)
- **Bundle optimization:** pdfme is lazy-loaded (~2MB, only when needed)
- **RTL support:** All pages use `dir="rtl"`
- **Font:** Heebo (Google Fonts), loaded in `src/index.css`

### 17.6 Design System

**Colors (HSL tokens in `src/index.css`):**
- Primary: `24 85% 58%` (warm orange)
- Accent: `173 45% 50%` (teal)
- Background: `33 40% 97%` (warm off-white)
- Success: `142 60% 45%`
- Warning: `38 90% 55%`
- Destructive: `0 75% 58%`

**Typography:** Heebo font family (300-800 weights)

---

## 18. Error Monitoring

### 18.1 Sentry Integration

**Packages:**
- `@sentry/react` — Frontend error capturing
- `@sentry/vite-plugin` — Build-time source map upload

**Implementation:**
- Initialized in `src/instrument.js`
- Error boundary wraps the app
- Specific error captures in critical paths (e.g., PDF signing page catch blocks)
- `Sentry.captureException()` called with tags for component identification

### 18.2 Known Error Handling

- **Stale submission:** Client sees reload prompt screen
- **Invalid token:** Client sees error screen with CPA contact message
- **PDF generation failure:** Alert shown to client, error captured by Sentry
- **Upload failure:** XHR error callback, progress bar stops
- **Drive sync failure:** Toast notification with error message

---

## 19. Known Issues & Constraints

### 19.1 Database Environment Isolation

- Backend functions always query the **Production** database
- The Test database is only available in the editor preview
- Testing the full questionnaire flow requires either:
  - Using the editor preview (Test DB)
  - Creating temporary test clients in Production
- Attempting to pass a `dev` flag to backend functions failed (they always hit Production)

### 19.2 Git Commit to Version Mapping

- There is no direct mapping between git commit hashes and Base44 auto-generated version labels
- Aligning git commit history timestamps with Base44 version history timestamps is the only way to identify the live commit

### 19.3 Legacy Field Size

- `pdf_inputs` in signed PDF records could exceed Base44 field size limits
- Solution: `pdf_inputs` is stripped from old records during save (legacy bloat cleanup)

### 19.4 PDF Signing POC Pages

- Multiple POC (proof of concept) signing approaches were developed:
  - `PdfSignPage.jsx` — Disabled (commented out in router)
  - `PdfSignPageMobile.jsx` — Dev only
  - `PdfSignCanvasOverlay.jsx` — Dev only
  - `PdfSignIframeOverlay.jsx` — **Production** (the active implementation)
- These POC files remain in the codebase for reference

### 19.5 pdfme Bundle Size

- The @pdfme library is ~2MB
- Lazy-loaded only when PDF template editor or signing is accessed
- Prefetch was disabled to prevent unnecessary loading

---

## 20. Future Considerations

### 20.1 Identified Opportunities

1. **Payment integration** — Pricing is displayed but no payment flow exists. Stripe or Wix Payments could be integrated.
2. **Automated reminders** — Scheduled automation to remind clients who haven't started/completed their questionnaire.
3. **Document OCR** — Automatically extract data from uploaded forms (106, 867) to pre-fill fields.
4. **Multi-language support** — Currently Hebrew-only; could add English for international clients.
5. **Mobile app** — The app is responsive but a native mobile app (iOS/Android) could improve the upload experience.
6. **Client self-service portal** — Beyond the questionnaire, a portal where clients can view past submissions.
7. **API for tax software integration** — Export collected data to tax preparation software.
8. **Automated document classification** — AI to categorize uploaded files automatically.

### 20.2 Technical Debt

1. **Legacy submission format** — The flat-field format (`is_employee`, `form_106_files`, etc.) is still supported via `submission-compat.js`. Could be migrated fully to dynamic responses.
2. **Duplicate DEFAULT_STEPS** — The default steps are defined in both `src/lib/default-template.js` and `src/lib/questionnaire-template.js` (the latter has additional steps and conditions). Should be consolidated.
3. **POC cleanup** — Multiple PDF signing POC files could be removed once the production approach is stable.
4. **Team member deletion** — The delete button in TeamSection is UI-only and not wired to a backend call.

---

## Appendix A: Backend Functions Reference

| Function | Auth | Purpose |
|---|---|---|
| `getClientByToken` | Token | Fetch client + active submission by client_id + token |
| `updateClientSubmission` | Token | Create/update submission (client-side saves) |
| `cpaSaveSubmission` | JWT | Create/update submission with CPA audit log |
| `uploadFile` | Token or JWT | Upload file to private storage |
| `downloadAllFiles` | JWT | Generate ZIP archive of client files |
| `syncFilesToGoogleDrive` | JWT + Drive OAuth | Sync files to Google Drive (single or batch) |
| `getActiveTemplate` | None | Get active questionnaire template (auto-creates default if none) |
| `getTemplateById` | None | Get specific template version by ID |
| `saveQuestionnaireTemplate` | JWT | Save new questionnaire template version |
| `getAllTemplateVersions` | JWT | List all template versions |
| `getPdfTemplateById` | None | Get PDF template by ID |
| `getActivePdfTemplates` | None | List active PDF templates |
| `getTemplateFileUrl` | Token | Get signed URL for PDF template's base file |
| `getSignedPdfUrl` | Token | Get signed URL for client's signed PDF |
| `createSignedUrl` | JWT | Get signed URL for any private file |
| `notifySubmissionCompleted` | Automation | Send Telegram notification on submission completion |
| `deleteSubmissionWithFiles` | JWT | Delete submission and all associated files |

---

## Appendix B: Frontend Route Reference

| Route | Component | Auth | Purpose |
|---|---|---|---|
| `/` | `CpaDashboard` | JWT | Main dashboard with client list |
| `/clients` | `ClientsPage` | JWT | Client management + archive |
| `/users` | `UserManagement` | JWT | Team management |
| `/settings` | `Settings` | JWT | Drive connection + profile |
| `/questionnaire-settings` | `QuestionnaireSettings` | JWT | Questionnaire template editor + history |
| `/pdf-templates` | `PdfTemplateEditor` | JWT | PDF template designer (pdfme) |
| `/cpa-fill` | `CpaFillQuestionnaire` | JWT | Fill questionnaire on behalf of client |
| `/questionnaire` | `ClientQuestionnaire` | Token | Client-facing questionnaire (public) |
| `/questionnaire/sign` | `PdfSignIframeOverlay` | Token | PDF signing page (public, lazy-loaded) |
| `/pdf-test` | `PdfTestPage` | None | Dev-only PDF testing |
| `/pdf-sign-test` | `PdfSignTest` | None | Dev-only signing test |
| `*` | `PageNotFound` | — | 404 page |

---

## Appendix C: Key Libraries & Dependencies

| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.2.0 | UI framework |
| `react-router-dom` | ^6.26.0 | Routing |
| `@tanstack/react-query` | ^5.84.1 | Data fetching/query state |
| `tailwindcss` | — | Styling |
| `@radix-ui/*` | various | UI primitives (shadcn/ui) |
| `lucide-react` | ^0.475.0 | Icons |
| `framer-motion` | ^11.16.4 | Animations |
| `@pdfme/common` | ^6.1.1 | PDF template engine |
| `@pdfme/generator` | ^6.1.1 | PDF generation (Lambda) |
| `@pdfme/schemas` | ^6.1.1 | PDF field schemas |
| `@pdfme/ui` | ^6.1.1 | PDF designer (template editor) |
| `@sentry/react` | ^10.63.0 | Error monitoring |
| `@base44/sdk` | ^0.8.37 | Base44 platform SDK |
| `jszip` | ^3.10.1 | ZIP archive generation (backend) |
| `canvas-confetti` | ^1.9.4 | Celebration effects |
| `react-leaflet` | ^4.2.1 | Maps (available, not currently used) |
| `@hello-pangea/dnd` | ^17.0.0 | Drag and drop (available) |
| `recharts` | ^2.15.4 | Charts (available) |

---

*This document was reverse-engineered from the application's source code and conversation history. It represents the current state of the system as of July 2026.*