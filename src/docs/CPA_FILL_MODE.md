# CPA Fill Mode — Feature Documentation

## Overview

CPA Fill Mode allows a logged-in CPA to fill out or complete parts of a client's questionnaire on the client's behalf. This is useful when:
- A client is stuck on a specific question
- The CPA has a document already in hand and wants to upload it directly
- A client is not tech-savvy and needs assisted data entry

---

## Architecture

### Entry Point
- **Dashboard → Client Row**: A "מלא עבור לקוח" (Fill for Client) button opens `CpaFillQuestionnaire` page.
- Route: `/cpa-fill?client=<clientId>`
- Auth required: only authenticated CPA users can access this page.

### Reuse of Questionnaire Flow
`CpaFillQuestionnaire` (`pages/CpaFillQuestionnaire.jsx`) reuses all the existing questionnaire components:
- `QuestionStep` — exact same component the client sees
- `PdfSignStepWrapper` — PDF signing flow
- `StepSelector` — step navigation
- `ProgressBar` — completion indicator

The key differences from the client-facing `ClientQuestionnaire`:
1. **Authenticated via CPA session** (no token-based access)
2. **Updates go through `cpaSaveSubmission`** backend function which records the CPA's identity
3. **No auth clearing** — the client access token is NOT removed from localStorage
4. **CPA banner** — a visible yellow banner at the top reminds the CPA they are filling on behalf of the client

### Backend — `cpaSaveSubmission` Function
A new backend function that:
1. Verifies the caller is an authenticated CPA (any logged-in user can fill — no admin restriction since multiple CPAs may share a firm account)
2. Appends an audit entry to `cpa_audit_log` on the submission with:
   - `cpa_email`: the email of the logged-in CPA
   - `cpa_name`: the full name of the logged-in CPA
   - `step_id`: which step was filled
   - `timestamp`: ISO datetime of the save
   - `action`: `"fill"` | `"upload"` | `"complete"`
3. Saves the submission data (same as `updateClientSubmission` but with audit log appended)

### Audit Log Storage
The `Submission` entity has a new field: `cpa_audit_log` (JSON string — array of audit entries).

```json
[
  {
    "cpa_email": "moshe@doron.co.il",
    "cpa_name": "משה דורון",
    "step_id": "employee",
    "timestamp": "2026-05-11T14:32:00.000Z",
    "action": "fill"
  }
]
```

---

## Dashboard Visibility

In `ClientRow`, each step badge in the progress breakdown section now shows a visual indicator if it was filled by a CPA:
- A 👩‍💼 icon + the CPA's name appears below steps that were CPA-filled
- Steps filled entirely by the client show no extra indicator
- The audit trail is available on hover/tooltip

---

## Security Considerations
- CPA Fill requires a valid Base44 session — anonymous users cannot access it
- The `/cpa-fill` route is in the **authenticated** section of `App.jsx` (same as the dashboard)
- The `cpaSaveSubmission` function verifies `base44.auth.me()` and returns 401 if not authenticated
- Clients cannot POST to `cpaSaveSubmission` because they do not have a Base44 session token

---

## Data Flow

```
CPA clicks "מלא עבור לקוח"
  → CpaFillQuestionnaire loads (authenticated)
  → Loads client + submission via SDK (no token needed — CPA has session)
  → Renders same questionnaire UI
  → On each step answer → calls cpaSaveSubmission(clientId, stepId, data)
  → cpaSaveSubmission appends audit entry + saves submission
  → Dashboard ClientRow reads cpa_audit_log + highlights CPA-filled steps
```

---

## Files Changed / Added

| File | Description |
|------|-------------|
| `pages/CpaFillQuestionnaire.jsx` | New CPA-authenticated questionnaire fill page |
| `functions/cpaSaveSubmission.js` | New backend function with audit logging |
| `entities/Submission.json` | Added `cpa_audit_log` field |
| `components/dashboard/ClientRow.jsx` | CPA fill button + audit badge display |
| `App.jsx` | New `/cpa-fill` route |
| `docs/CPA_FILL_MODE.md` | This file |