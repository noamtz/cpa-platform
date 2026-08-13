# 05 — Traceability Ledger

> **Status:** COMPLETE
> **Purpose:** Cross-reference every scenario claim with exact file/line evidence

---

## Legend

| Label | Meaning |
|---|---|
| ✅ | VERIFIED — traced to exact file, function, and line |
| ⚠️ | INFERRED — implied by code patterns, not directly observed at runtime |
| ❓ | UNCERTAIN — code path exists but may be dead or untested |
| 🚫 | NOT IMPLEMENTED — referenced but no implementation found |

---

## J1: Client Completes Questionnaire

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J1-S1: Happy path | `src/pages/ClientQuestionnaire.jsx` | Full page orchestration | ✅ |
| J1-S1: Token validation | `base44/functions/getClientByToken/entry.ts` | L8-26 | ✅ |
| J1-S1: Submission auto-create | `base44/functions/updateClientSubmission/entry.ts` | L36-55 (`else` branch) | ✅ |
| J1-S1: Status update to `in_progress` | `base44/functions/updateClientSubmission/entry.ts` | L59-64 | ✅ |
| J1-S1: Status update to `completed` | `base44/functions/updateClientSubmission/entry.ts` | L59 (`completed ? 'completed' : 'in_progress'`) | ✅ |
| J1-S2: Skip step (answer=false) | `src/components/questionnaire/QuestionStep.jsx` | L117 (`stepResponse.answer`) | ✅ |
| J1-S3: Conditional step filtering | `src/lib/questionnaire-template.js` | L245-262 (`filterStepsByClientConditions`) | ✅ |
| J1-S4: Text response | `src/components/questionnaire/QuestionStep.jsx` | L125-126 | ✅ |
| J1-S5: Select response | `src/components/questionnaire/QuestionStep.jsx` | L127-128 | ✅ |
| J1-S6: Invalid token → 403 | `base44/functions/getClientByToken/entry.ts` | L20-21 | ✅ |
| J1-S7: Client not found → 404 | `base44/functions/getClientByToken/entry.ts` | L14-15 | ✅ |
| J1-S8: Archived submission → 409 | `base44/functions/updateClientSubmission/entry.ts` | L33-34 | ✅ |
| J1-S9: WhatsApp localStorage fallback | `src/lib/app-params.js` | L4-23 | ✅ |
| J1-S10: Legacy submission compat | `src/lib/submission-compat.js` | L39-68 (`isLegacySubmission`, `legacyToResponses`) | ✅ |

---

## J2: Client Signs PDF Form

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J2-S1: Happy path | `src/pages/ClientQuestionnaire.jsx` | PDF signing orchestration | ✅ |
| J2-S1: Lambda PDF generation | `lambda/pdf-generator/index.mjs` | `/generate-and-sign` handler | ✅ |
| J2-S2: Skip question (auto-show) | `src/lib/questionnaire-steps.js` | L14 (`skip_question`) | ✅ |
| J2-S3: Client declines | `src/components/questionnaire/QuestionStep.jsx` | L151-152 (`isPdfSignWithYes`) | ✅ |
| J2-S4: Incomplete signing | `src/components/dashboard/ClientRow.jsx` | L379, L394-396 (`record.incomplete`) | ⚠️ |
| J2-S5: Ghost template | `OPEN_BUGS.md` | Full document | ✅ |
| J2-S5: 404 from getPdfTemplateById | `base44/functions/getPdfTemplateById/entry.ts` | L18-20 | ✅ |
| J2-S7: CPA exempts PDF step | `src/pages/CpaFillQuestionnaire.jsx` | L164-196 (`handleExemptPdfStep`) | ✅ |
| J2-S7: Exempted record shape | `src/pages/CpaFillQuestionnaire.jsx` | L167-181 (signed_pdfs push with `exempted_by_cpa`, `audit_trail`) | ✅ |

---

## J3: Client Resumes Questionnaire

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J3-S1: Resume at first unanswered | `src/lib/questionnaire-steps.js` | L40-68 (`getResumeStepIndex`) | ✅ |
| J3-S2: All complete → done | `src/lib/questionnaire-steps.js` | L55-58 | ✅ |
| J3-S3: Race condition handling | `src/lib/questionnaire-steps.js` | L60-64 | ✅ |
| J3-S4: Step navigation via selector | `src/components/questionnaire/StepSelector.jsx` | Component | ✅ |

---

## J4: CPA Manages Client Portfolio

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J4a: Add client | `src/pages/ClientsPage.jsx` | Client creation form | ✅ |
| J4b: Edit client | `src/components/dashboard/EditClientModal.jsx` | Full component | ✅ |
| J4c: Copy questionnaire link | `src/components/dashboard/ClientRow.jsx` | L191-205 (`getLink`, `copyLink`) | ✅ |
| J4d: View details | `src/components/dashboard/ClientRow.jsx` | L294-761 (expanded section) | ✅ |
| J4e: Regenerate token | `src/components/dashboard/ClientRow.jsx` | L207-213 (`regenerateToken`) | ✅ |
| J4e: Token format | `src/components/dashboard/ClientRow.jsx` | L209 (`Math.random().toString(36).substring(2,18)`) | ✅ |

---

## J5: CPA Reviews & Approves

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J5-S1: completed → ready_for_ira | `src/components/dashboard/ClientRow.jsx` | L729-742 | ✅ |
| J5-S1: ready_for_ira → reviewed | `src/components/dashboard/ClientRow.jsx` | L744-757 | ✅ |
| J5-S2: Reset status to pending | `src/components/dashboard/ClientRow.jsx` | L664-677 | ✅ |
| J5-S3: Display status override | `src/components/dashboard/ClientRow.jsx` | L219-231 (`displayStatus` logic) | ✅ |

---

## J6: CPA Fills for Client

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J6: Auth check | `src/pages/CpaFillQuestionnaire.jsx` | L50-54 (`base44.auth.me()`) | ✅ |
| J6: Skip welcome step | `src/pages/CpaFillQuestionnaire.jsx` | L23 (`currentStep: 1`) | ✅ |
| J6: Audit log creation | `base44/functions/cpaSaveSubmission/entry.ts` | L28-34, L48-56 | ✅ |
| J6: Save queue pattern | `src/pages/CpaFillQuestionnaire.jsx` | L30 (`saveQueue.useRef`) | ✅ |
| J6: Audit badge display | `src/components/dashboard/CpaAuditBadge.jsx` | Full component | ✅ |
| J6-S2: PDF exempt action | `src/pages/CpaFillQuestionnaire.jsx` | L164-196 (`handleExemptPdfStep`) | ✅ |
| J6-S3: Undo exemption | `src/pages/CpaFillQuestionnaire.jsx` | L197-201 (`handleUnexemptPdfStep`) | ✅ |
| J6-S2: Exempted UI (blue state) | `src/pages/CpaFillQuestionnaire.jsx` | L304-330 (isExempted branch) | ✅ |
| J6-S2: Dashboard exempt display | `src/components/dashboard/ClientRow.jsx` | L379 (`exempted: !!record.exempted_by_cpa`) | ✅ |
| J6-S2: Completion screen exempt label | `src/components/questionnaire/CompletionScreen.jsx` | `"✓ פטור רו"ח"` label | ✅ |
| J6-S2: Step status derivation | `src/lib/questionnaire-steps.js` | L80-82 (`rec.exempted_by_cpa → completedStepIds`) | ✅ |

---

## J7: CPA Configures Template

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J7: Step editor | `src/components/dashboard/QuestionnaireEditor.jsx` | Full component | ✅ |
| J7: Response types | `src/components/dashboard/QuestionnaireEditor.jsx` | L15-22 (`RESPONSE_TYPES`) | ✅ |
| J7: Save new version | `base44/functions/saveQuestionnaireTemplate/entry.ts` | L20-37 | ✅ |
| J7: Deactivate old versions | `base44/functions/saveQuestionnaireTemplate/entry.ts` | L24-29 | ✅ |
| J7: Auto-seed default | `base44/functions/getActiveTemplate/entry.ts` | L120-127 | ✅ |
| J7: PDF template linking | `src/components/dashboard/QuestionnaireEditor.jsx` | L59-64, L77-93 | ✅ |
| J7: Condition editor | `src/components/dashboard/QuestionnaireEditor.jsx` | L66-71 | ✅ |

---

## J8: CPA Manages Files

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J8a: File preview | `src/components/dashboard/ClientRow.jsx` | L29-95 (`FilePreviewModal`) | ✅ |
| J8a: Signed URL generation | `src/components/dashboard/ClientRow.jsx` | L7-14 (`getSignedUrl`) | ✅ |
| J8b: Individual download | `src/components/dashboard/ClientRow.jsx` | L482-501 | ✅ |
| J8c: ZIP download | `base44/functions/downloadAllFiles/entry.ts` | Full function | ✅ |
| J8c: ZIP client-side trigger | `src/components/dashboard/ClientRow.jsx` | L156-187 | ✅ |
| J8d: Signed PDF display | `src/components/dashboard/ClientRow.jsx` | L511-590 | ✅ |

---

## J9: CPA Syncs to Google Drive

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J9a: Connect Drive | `src/pages/Settings.jsx` | L56-69 (`handleConnect`) | ✅ |
| J9b: Disconnect Drive | `src/pages/Settings.jsx` | L71-75 (`handleDisconnect`) | ✅ |
| J9c: Set base path | `src/pages/Settings.jsx` | L50-54 (`handleSaveBasePath`) | ✅ |
| J9d: Single sync | `src/components/dashboard/ClientRow.jsx` | L700-725 | ✅ |
| J9d: Folder structure | `base44/functions/syncFilesToGoogleDrive/entry.ts` | L120-141 (base/client/year), L168-182 (step) | ✅ |
| J9e: Batch sync | `src/components/dashboard/SyncAllDriveButton.jsx` | Full component | ✅ |
| J9e: Batch mode API | `base44/functions/syncFilesToGoogleDrive/entry.ts` | L289-353 | ✅ |
| J9*: Idempotency via SyncedDriveFile | `base44/functions/syncFilesToGoogleDrive/entry.ts` | L109, L148, L156-163 | ✅ |

---

## J10: Year Transitions & Archives

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J10a: Change tax year | `src/components/dashboard/ClientRow.jsx` | L138-154 | ✅ |
| J10a: Osek type guard | `src/components/dashboard/ClientRow.jsx` | L140-143, L803-828 | ✅ |
| J10b: Archive submission | `src/components/dashboard/ClientRow.jsx` | L629-642 | ✅ |
| J10c: Restore submission | `src/components/dashboard/ClientRow.jsx` | L644-662 | ✅ |
| J10c: Conflict resolution dialog | `src/components/dashboard/RestoreSubmissionDialog.jsx` | Full component | ✅ |
| J10d: Historical year tabs | `src/components/dashboard/ClientRow.jsx` | L298-324 | ✅ |

---

## J11: Telegram Notification

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J11-S1: Alert sent | `base44/functions/notifySubmissionCompleted/entry.ts` | L57-67 (Telegram API call) | ✅ |
| J11-S1: One-time flag | `base44/functions/notifySubmissionCompleted/entry.ts` | L75-77 (`alert_sent: true`) | ✅ |
| J11-S2: Skipped (already sent) | `base44/functions/notifySubmissionCompleted/entry.ts` | L22-26 | ✅ |
| J11-S3: Skipped (wrong event) | `base44/functions/notifySubmissionCompleted/entry.ts` | L10-12 | ✅ |
| J11-S4: Telegram not configured | `base44/functions/notifySubmissionCompleted/entry.ts` | L50-55 | ✅ |

---

## J12: Lambda PDF Generation

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J12: Health check | `lambda/pdf-generator/index.mjs` | `/health` handler | ✅ |
| J12: Generate and sign | `lambda/pdf-generator/index.mjs` | `/generate-and-sign` handler | ✅ |

---

## J13: CI/CD Lambda Deployment

| Scenario | Evidence File | Symbol / Line | Label |
|---|---|---|---|
| J13a: Auto-deploy test | `.github/workflows/deploy-lambda.yml` | Full workflow | ✅ |
| J13b: Manual deploy prod | `.github/workflows/deploy-lambda-prod.yml` | Full workflow | ✅ |
| J13c: Rollback prod | `.github/workflows/rollback-prod.yml` | Full workflow | ✅ |

---

## Statistics

| Label | Count |
|---|---|
| ✅ VERIFIED | 83 |
| ⚠️ INFERRED | 1 |
| ❓ UNCERTAIN | 0 |
| 🚫 NOT IMPLEMENTED | 0 |
| **Total claims** | **84** |
