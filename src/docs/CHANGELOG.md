# Changelog — Doron & Doron Tax Questionnaire Platform

All notable changes to this project are documented in this file.

---

## [2026-05-17] — Submission Archiving, Conflict-Aware Restoration & Stale Client Guard

### Added
- **`docs/SUBMISSION_ARCHIVING_FLOW.md`**: Full documentation of the archiving and restoration flow.
- **`RestoreSubmissionDialog` component**: When a CPA restores an archived submission while an active one already exists for the same `(client_id, tax_year)`, a dialog is shown asking which submission should remain active. The non-selected one is automatically archived. Enforces the invariant: only one active submission per client per tax year.
- **Stale submission detection on the client side**: If the CPA archives a client's active submission while they are mid-questionnaire, the next save returns HTTP 409 `{ reload: true }`. The client sees a full-screen "השאלון עודכן" card with a reload button instead of getting a silent error.

### Changed
- **`functions/getClientByToken`**: Now filters out archived submissions — clients cannot see or continue an archived questionnaire.
- **`functions/updateClientSubmission`**:
  - Fixed `const` → `let` destructuring bug that caused `"assignment to constant variable"` JS error.
  - When the `submission_id` in the request refers to an archived submission, returns `HTTP 409` with `{ error: 'submission_archived', reload: true }` instead of silently creating a new submission.
- **`pages/ClientQuestionnaire`**:
  - `callFunction` now passes through the full response body on non-2xx status codes (previously only returned `{ error }`, losing the `reload` flag).
  - `handleNext` guards against advancing the step if `staleSubmission` was set during the save.

### Files Changed
| File | Summary |
|------|---------|
| `pages/ClientsPage.jsx` | Restore button triggers conflict check; `RestoreSubmissionDialog` wired up |
| `components/dashboard/RestoreSubmissionDialog.jsx` | New — conflict resolution dialog |
| `functions/getClientByToken` | Filters `is_archived` submissions |
| `functions/updateClientSubmission` | 409 on archived submission_id; `const` bug fix |
| `pages/ClientQuestionnaire.jsx` | Full body passthrough on errors; stale guard in handleNext |
| `docs/SUBMISSION_ARCHIVING_FLOW.md` | New — full flow documentation |

> See full technical details in `docs/SUBMISSION_ARCHIVING_FLOW.md`

---

## [2026-05-13] — Answer Loss Fix, Dashboard PDF Step Visibility & Step Status Indicators

### Fixed

- **Answer loss on fast clicks (race condition)**: The questionnaire used optimistic UI — it advanced to the next step immediately while saving in the background. Clicking "המשך" quickly caused the current step index to update before the answer was persisted, resulting in `step_completed` being saved with the wrong value and the answer effectively lost on page refresh.
  - Fix: `handleNext` in `ClientQuestionnaire` now `await`s `updateSubmission` before advancing the step.
  - Fix: `updateSubmission` now returns a promise (via the save queue chain) so callers can reliably await completion.

- **PDF sign steps invisible in dashboard progress grid**: Steps with `response_type: "pdf_sign"` were excluded from `getStepSummary` and only shown in the grid if a `signed_pdfs` record existed. This meant:
  - Steps answered "לא" (no signing needed) — never appeared
  - Steps not yet reached — never appeared
  - Fix: `pdfStepItems` in `ClientRow` is now built by iterating all `pdf_sign` steps from `activeSteps` and checking both `signed_pdfs` records and `responses` (for "no" answers), so all states are always visible.

- **PDF sign step grid indicators for missing states**: Added correct color + icon for two previously-unhandled states:
  - Answered "No" → `—` gray (same as regular "no" answers)
  - Not yet answered → `⏳` light gray with border

### Files Changed
| File | Summary |
|------|---------|
| `pages/ClientQuestionnaire.jsx` | `handleNext` awaits save; `updateSubmission` returns promise |
| `components/dashboard/ClientRow.jsx` | PDF sign steps always shown in grid; all answer states handled |

---

## [2026-05-11] — Submission-Centric Dashboard & 4-Stage Status Pipeline

### Added
- **`pages/ClientsPage.jsx`**: Dedicated client management page at `/clients` — list, search, edit, delete clients. Decoupled from submission tracking.
- **`components/dashboard/AddSubmissionModal.jsx`**: New entry point from dashboard — CPA picks an existing client + tax year to start a new submission. Validates no duplicate submission exists for that year.
- **`Submission.cpa_status` field**: CPA-set statuses (`ready_for_ira`, `reviewed`) are now stored on the `Submission` entity (per tax year), not on `Client`. Prevents multi-year state collision.

### Changed
- **Dashboard rewritten as submission-centric**: Each row = `(client, active tax year)` pair. `effectiveStatus` derived via priority chain: `submission.cpa_status` → `client.status` (legacy fallback) → progress-derived.
- **4-tab status pipeline** replacing the previous 3-tab layout:
  | Tab | Statuses |
  |-----|----------|
  | בתהליך | `pending`, `in_progress` |
  | מוכן לסקירה | `completed` (100%, awaiting CPA review) |
  | מוכן להגשה לרמ״ש | `ready_for_ira` |
  | הוגש | `reviewed` |
- **Fixed**: "מוכן לסקירה" submissions were incorrectly appearing in the "מוכן להגשה לרמ״ש" tab because both `completed` and `ready_for_ira` were grouped together. Now fully separated.

### Files Changed
| File | Summary |
|------|---------|
| `entities/Submission.json` | Added `cpa_status` field |
| `pages/CpaDashboard.jsx` | Full rewrite — submission rows, 4 tabs, AddSubmissionModal |
| `pages/ClientsPage.jsx` | New — client CRUD at `/clients` |
| `components/dashboard/AddSubmissionModal.jsx` | New — client + year picker |
| `App.jsx` | Added `/clients` route |

> See full technical details in `docs/SUBMISSION_CENTRIC_DASHBOARD.md`

---

## [2026-05-11] — PDF Sign Step Navigation Fixes

> 📝 *Documented by Antigravity agent*

### Fixed

- **Completed client re-signing PDF → sent to step 1 instead of completion screen**: `totalSteps` was computed from `resolvedSteps` (unfiltered), but `STEPS` is derived from `filteredSteps` (after condition filtering). When steps are filtered out, `currentStep` was set past the end of the `STEPS` array, causing `step` to be `undefined` and the UI to fall through to step 1. Fixed by computing `totalSteps` from `filteredSteps.length` instead of `resolvedSteps.length`.
- **`getResumeStepIndex` using wrong step list**: Was called with `resolvedSteps` (unfiltered) but needed `filteredSteps` to match the actual `STEPS` array used for rendering. Resume index could point to a step that doesn't exist in the filtered list.
- **Race condition: return from PdfSignPage always landing on step 1**: The `useEffect([location.state])` that handles `returnedSubmission` fired before `loadClientData` populated `activeSteps`. With `activeSteps = []`, `getResumeStepIndex` computed `totalSteps = 2` and always returned index 1. Added a guard: `if (activeSteps.length === 0) return;` — `loadClientData` already handles the merge correctly.
- **StepSelector dropdown missing on PDF sign steps**: The navigation dropdown (allowing clients to jump between steps) was only rendered for `question`-type steps. Added `StepSelector` to both the "already signed" summary card and the "first time" start card on `pdf_sign` steps.

### Files Changed
| File | Summary |
|------|---------|
| `src/pages/ClientQuestionnaire.jsx` | All four fixes above |

---

## [2026-05-11] — Resume Flow Fixes

> 📝 *Documented by Base44 AI agent*

### Fixed

- **Client resume from last step on return visit**: When a client who had already started the questionnaire returned via their link, the system was sending them back to the Welcome screen (step 0) even though answers were already saved. Updated `ClientQuestionnaire` to detect if the client has at least one saved answer or signed PDF, and skip the welcome screen — taking them directly to their next unanswered step.
  - Logic: `hasStarted = Object.keys(responses).length > 0 || Object.keys(signedPdfsById).length > 0`
  - If `hasStarted`, `currentStep` is set to `getResumeStepIndex(...)` result; otherwise step 0 (welcome).

- **After signing a PDF, client was redirected to step 1 instead of the next step**: When returning from `PdfSignPage`, the `useEffect` that handled `location.state.returnedSubmission` was computing the resume index from stale `submission` state (before the `signed_pdfs` merge). Fixed by computing `getResumeStepIndex` *inside* the `setSubmission` updater callback, using the freshly merged submission object. This ensures the correct next-step index is derived from up-to-date signed PDF data.

### Technical Details
- Both fixes are in `pages/ClientQuestionnaire.jsx`
- No backend changes required — pure frontend state management corrections
- `getResumeStepIndex` (from `lib/questionnaire-steps.js`) correctly finds the first unanswered step; the bugs were in when/how it was called

---

## [2026-05-10] — Signature Fields Required by Default

### Added
- **Auto-required signature fields**: When a CPA adds a new signature box to a PDF template, it is automatically marked as `required: true`. This ensures all signature fields must be filled before submission and prevents accidental incomplete forms.
  - Applied retroactively via `updateTemplate()` wrapper in `PdfTemplateEditor`
  - Only applies to signature type fields (text, checkbox fields remain configurable)

---

## [2026-05-10] — PDF Signature Validation Hardening

### Fixed
- **Required field validation bypass on סיום (Finish)**: The "סיום" button in `PdfFormStep` could proceed without filling required fields, including empty signature canvases and blank text IDs. Updated `validateRequiredFields()` to:
  - Reject signature fields with base64 data < 500 bytes (empty canvas typically produces <100 bytes)
  - Reject whitespace-only text fields (trimmed strings must be non-empty)
  - Explicitly validate against `undefined`, `null`, empty strings, and empty objects
  - Check that text-based IDs cannot be bypassed via spaces or minimal data
- **Validation now strictly enforces**: No submission can proceed to signed PDF state if any required field is missing valid data

---

## [2026-05-10] — PdfFormStep UI Fixes & Mobile Field Modal Improvements

### Fixed
- **"מילוי שדות" modal — empty modal bug**: The modal was incorrectly skipping all CPA-mapped fields (fields with a `fieldMapping` entry), even when they had no auto-fill data and were editable. Removed the overly-broad `fMapping[field.name]` guard so that only truly locked (`field.readOnly`) and system (`sys:` prefix) fields are excluded.
- **"תעודת זהות" not appearing in modal**: ID-number field mapped by the CPA but not present in client data was invisible to the client. Now correctly shows up in the modal for manual entry.
- **Re-editing a field triggers "אין שדות" alert**: After filling a CPA-mapped field through the modal, opening the modal again would detect the now-populated value and skip the field, resulting in an empty modal and a confusing alert. Fixed by removing the value-presence check — all non-readOnly, non-system fields always appear in the modal regardless of whether they already have a value.
- **z-index stacking**: Fixed unresponsive buttons in `PdfFormStep` by raising the fullscreen container's `z-index` to `50`, ensuring it sits above other page elements and correctly receives click events.

---

## [2026-05-10] — Multi-Year Submission History in Dashboard

### Added
- **Year-tab navigation in `ClientRow`**: When a client has submissions across multiple tax years, expandable row now shows tab buttons at the top — one for the current year (marked "נוכחי") and one for each past year.
- **`viewingSubmission` state**: Tracks which historical submission the CPA is currently inspecting (`null` = current year).
- **`displayedSubmission` derived variable**: All content sections (progress breakdown, uploaded files, signed PDFs, text responses) now read from `displayedSubmission` instead of the current-year `submission` directly, so they automatically switch when a tab is clicked.

### Changed
- **Delete logic — historical submissions**: Deleting a past-year submission no longer incorrectly resets the client's status to `pending`; status reset only happens when the *current* year's submission is deleted.
- **Delete logic — full client deletion**: Now correctly iterates `allSubmissions` (all years) before deleting the client record, preventing orphaned submission/file records.
- After deleting any submission, `viewingSubmission` is reset to `null` (current year tab).

### Technical Details
- Feature is **frontend-only** — no new backend functions or entity changes required.
- Tabs are hidden when a client has only one submission (zero visual change for most clients).
- See `docs/MULTI_YEAR_HISTORY.md` for full architecture and data flow documentation.

---

## [2026-05-07] — Dynamic Questionnaire Model Extension

### Added
- **Multi-select question type**: Allows clients to select multiple options from a configurable list
- **Single-select question type**: Allows clients to select exactly one option from a list
- **Conditional step visibility**: Steps can now be shown/hidden based on client attributes (`osek_type`)

### Changed
- **QuestionStep component**: Extended to render select configurations
- **QuestionnaireEditor**: Added UI for managing select options and condition settings
- **ClientQuestionnaire**: Filters steps by client conditions before rendering

---

## [2026-05-06] — System Fields & PDF Signing Hardening

### Added
- **Dynamic System Field Mapping (CPA Editor)** — CPAs can bind text fields to automatic data sources (שנת המס, שם מלא, אימייל, טלפון, תעודת זהות, תאריך היום) via a dropdown injected at the top of the pdfme sidebar.
- **Text-only restriction** — system field dropdown is disabled for non-text field types (image, signature, checkbox).
- **Unique Hebrew naming** — mapped fields are renamed to their Hebrew label (e.g. "שנת המס"); duplicates get incremental suffix ("שנת המס 2").
- **Sidebar lockdown** — when a field is system-mapped, "Editable" and "Required" checkboxes are unchecked, disabled, and dimmed. Name input and Type selector are also locked.
- **Deselection restore** — removing a system mapping restores the original field name, content, and unlocks all sidebar controls.
- **Client-side auto-population** — system-mapped fields are pre-filled with the client's actual data when they open the PDF form to sign.
- **Smart field locking** — populated fields are read-only; fields with missing client data remain editable so the client can fill them manually.
- **Default text alignment** — all new text fields default to horizontal center + vertical middle alignment.
- **Signed PDF view spinner** — "צפייה בטופס החתום" button now shows a loading animation while fetching the signed PDF URL.
- **`fieldMapping` persistence** — system field bindings are saved as part of the template JSON.

### Fixed
- **uploadFile 401 error (CPA)** — added `Authorization: Bearer <token>` header to the template editor's PDF upload call.
- **uploadFile 401 error (Client)** — added `client_id` + `token` URL params to `PdfSignStepWrapper` upload call.
- **System fields showing placeholders in signed PDF** — all PDF generation paths (Preview, Approve & Sign, Direct Sign, Download) now use the cached template with populated `field.content` instead of re-parsing the raw database template.
- **System fields invisible after population** — fixed pdfme's readOnly rendering by setting `field.content = val` (not clearing it) so static text renders correctly.
- **MutationObserver re-injection loop** — added debounce (350ms) and `_injecting` guard flag to prevent infinite DOM injection cycles when switching between fields.
- **Field type detection** — switched from DOM-based detection to `designerRef.current.getTemplate()` for reliable field type checking.

### Files Changed
| File | Summary |
|------|---------|
| `src/pages/PdfTemplateEditor.jsx` | System field dropdown, sidebar locking, unique naming, field mapping |
| `src/components/questionnaire/PdfFormStep.jsx` | Client-side population, template caching, all generation paths |
| `src/components/questionnaire/PdfSignStepWrapper.jsx` | Client auth for uploadFile |
| `src/pages/ClientQuestionnaire.jsx` | PDF view loading spinner, pdfViewLoading state |
| `src/lib/pdfme-config.js` | Default text alignment, mergeSystemInputs helper |
| `src/docs/PDF_MODULE.md` | Documentation updates |

---

## [2026-05-06] — Questionnaire Architecture Refactor

### Refactored
- Split questionnaire logic into three focused libraries:
  - `lib/questionnaire-template.js`: Template parsing, placeholder resolution, step filtering
  - `lib/questionnaire-steps.js`: Step state management, resume logic, PDF signing tracking
  - `lib/submission-compat.js`: Data compatibility layer, response extraction, progress calculation

---

## [2026-05-05] — PDF Signing Module

### Added
- **PdfTemplate entity**: Stores PDF form templates with interactive field definitions
- **PDF signing workflow**: `PdfSignPage`, `PdfFormStep`, `PdfSignStepWrapper`
- **System fields (`sys:` prefix)**: Auto-filled read-only fields (tax year, full name, today's date)
- **Audit trail**: Each signed PDF records step_id, template_name, pdf_file_url, pdf_inputs, audit_trail, incomplete flag
- **Backend functions**: `getActivePdfTemplates`, `getPdfTemplateById`, `getTemplateFileUrl`, `getSignedPdfUrl`

### Security
- File access control with ownership validation before granting signed URLs
- All PDF downloads use time-limited (1 hour) signed URLs
- PDFs stored in Base44 private file storage

### Documentation
- `docs/PDF_MODULE.md`: Complete architecture and developer guide
- `docs/SECURITY.md`: File access security model documentation

---

## [2026-05-01] — Questionnaire Template System

### Added
- **QuestionnaireTemplate entity**: Versioned questionnaire definitions
- **Template versioning**: Historical snapshots preserved when clients complete questionnaires
- **Backend functions**: `saveQuestionnaireTemplate`, `getActiveTemplate`, `getAllTemplateVersions`, `getTemplateById`
- **QuestionnaireEditor component**: Visual step builder with drag-and-drop reordering

---

## [2026-04-28] — Google Drive Sync Integration

### Added
- **App User Connector**: "Google Drive Sync" (ID: `69fb22f94d2b7077430e5187`)
- **syncFilesToGoogleDrive function**: Batch syncs all submission files to connected Google Drive
  - Folder structure: `/Doron & Doron/{TaxYear}/{ClientName}/`
- **SyncAllDriveButton component**: Dashboard UI for batch synchronization

---

## [2026-04-20] — Client Management Dashboard

### Added
- **CpaDashboard page**: Client list with status badges, progress indicators, filters, search
- **ClientRow component**: Expandable row with file preview, ZIP download, questionnaire link
- **AddClientModal**: Bulk CSV import + manual creation with auto-generated tokens
- **EditClientModal**: Edit client details, tax year, internal notes
- **Backend functions**: `getClientByToken`, `updateClientSubmission`, `deleteSubmissionWithFiles`, `downloadAllFiles`

---

## [2026-04-15] — Initial Platform Setup

### Added
- React + Vite + Tailwind CSS with Hebrew RTL support (Heebo font)
- Entity schema: `Client`, `Submission`, `PdfTemplate`, `QuestionnaireTemplate`, `User`
- Role-based access control + token-based client access (no login for questionnaire)
- Warm color palette (orange primary, teal accent), dark mode support

---

## Architecture Principles

### File Storage Strategy
- Never store large files in entity fields — use Base44 private file storage with `file_uri` references
- Time-limited (1 hour) signed URLs for secure downloads
- Ownership validation before granting file access

### Data Compatibility
- Legacy flat fields preserved during migration period
- `submission-compat.js` bridges old and new response formats
- Template versions ensure historical accuracy

### Security Model
- Token-based client access (no auth required for public questionnaire)
- CPA dashboard protected via Base44 role-based auth
- All PDF signatures include timestamped audit logs