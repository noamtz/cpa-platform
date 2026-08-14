# Submission-Centric Dashboard & Client Management Refactor

> Added: 2026-05-11

---

## Overview

The CPA dashboard was refactored from a **client-centric** model to a **submission-centric** model. Additionally, client management was extracted into a dedicated page, and the status pipeline was split into 4 clearly separated workflow stages.

---

## Problem with the Previous Architecture

The original dashboard had one row per **client**. Status (`ready_for_ira`, `reviewed`) was stored directly on the `Client` entity. This caused two key issues:

1. **Multi-year state collision** — switching a client to a new tax year overwrote the CPA-defined status on the client record, making it impossible to distinguish "this client was submitted for 2024" vs "this client is in progress for 2025".
2. **Mixed display** — "מוכן לסקירה" (100% complete, awaiting CPA review) and "מוכן להגשה לרמ״ש" (CPA-approved for IRA filing) were grouped into the same dashboard tab, making the CPA's work queue ambiguous.

---

## New Architecture

### Entities

#### `Submission.cpa_status`
A new field was added to the `Submission` entity:

```json
"cpa_status": {
  "type": "string",
  "enum": ["ready_for_ira", "reviewed"],
  "description": "סטטוס שהוגדר ידנית ע\"י רו\"ח עבור שנה זו"
}
```

This means CPA-set status is always tied to a **specific submission** (i.e., a specific client + tax year), not the client record itself. The `Client.status` field is retained for backward compatibility only.

### Status Derivation Logic

Each dashboard row derives an `effectiveStatus` using the following priority chain (in `CpaDashboard.jsx`):

```js
let effectiveStatus =
  submission?.cpa_status                                          // 1. Explicit CPA status on submission
  || (['ready_for_ira', 'reviewed'].includes(client.status)       // 2. Legacy CPA status on client (backward compat)
      ? client.status : null)
  || (progress === 100 ? 'completed'                              // 3. Derived from questionnaire progress
      : progress > 0   ? 'in_progress'
                       : 'pending');
```

---

## Dashboard Tabs — 4-Stage Pipeline

The dashboard now has **3 mutually exclusive tabs**:

| Tab | Key | Statuses Included | Meaning |
|-----|-----|-------------------|---------|
| בתהליך | `in_progress` | `pending`, `in_progress`, `completed` | Active work — client in progress or finished awaiting CPA review |
| מוכן להגשה לרמ״ש | `ready_for_ira` | `ready_for_ira` | CPA approved — ready to file with IRA |
| הוגש | `reviewed` | `reviewed` | Filed with IRA |

Counts are computed per-tab in `CpaDashboard.jsx`:

```js
const stats = {
  in_progress:   filtered.filter(r => ["pending", "in_progress", "completed"].includes(r.effectiveStatus)).length,
  ready_for_ira: filtered.filter(r => r.effectiveStatus === "ready_for_ira").length,
  reviewed:      filtered.filter(r => r.effectiveStatus === "reviewed").length,
};
```

---

## Dashboard Row Model

Each row in the dashboard represents one **active submission** = `(client, client.tax_year)` pair. Built in `CpaDashboard.jsx`:

```js
const submissionRows = clients.map((client) => {
  const taxYear = client.tax_year || 2024;
  const submission = submissions.find(
    s => s.client_id === client.id && s.tax_year === taxYear
  ) || null;
  const allSubmissions = submissions.filter(s => s.client_id === client.id);
  // ... derive effectiveStatus and progress
  return { client, submission, allSubmissions, effectiveStatus, progress };
});
```

`allSubmissions` (all years) is passed to `ClientRow` to power the year-tab history navigation.

---

## New Pages & Components

### `pages/ClientsPage.jsx`
A dedicated client management page at `/clients`:
- Lists all clients with name, osek type, pricing, contact info
- Search by name / email / phone
- Edit and delete clients directly
- "לקוח חדש" button opens `AddClientModal`
- Linked from the dashboard header via "לקוחות" button

### `components/dashboard/AddSubmissionModal.jsx`
Replaces the old `AddClientModal` as the primary entry point from the dashboard:
- CPA picks an **existing client** via search-as-you-type dropdown
- CPA selects a **tax year** (defaults to current year − 1)
- Validates that a submission doesn't already exist for the chosen client + year
- On confirm: updates `client.tax_year` and resets `client.status` to `pending`
- Does **not** create a `Submission` record directly — the submission is created lazily by `updateClientSubmission` when the client first saves a questionnaire answer

---

## Status Transition Actions (in `ClientRow`)

| From | Action | Effect |
|------|--------|--------|
| `completed` | "אשר להגשה לרמ״ש" | Sets `submission.cpa_status = "ready_for_ira"` AND `client.status = "ready_for_ira"` |
| `ready_for_ira` | "סמן כהוגש" | Sets `submission.cpa_status = "reviewed"` AND `client.status = "reviewed"` |

Both fields are updated in parallel (`Promise.all`) to maintain backward compatibility with legacy code that reads `client.status`.

---

## Files Changed

| File | Change |
|------|--------|
| `entities/Submission.json` | Added `cpa_status` field |
| `pages/CpaDashboard.jsx` | Full rewrite — submission-centric rows, 4-tab pipeline, `AddSubmissionModal` |
| `pages/ClientsPage.jsx` | New — dedicated client CRUD page at `/clients` |
| `components/dashboard/AddSubmissionModal.jsx` | New — pick client + year for new submission |
| `components/dashboard/ClientRow.jsx` | `effectiveStatus` derived from `submission.cpa_status` with client.status fallback |
| `App.jsx` | Added `/clients` route |

---

## Backward Compatibility

- All existing `Client.status` values are preserved and still read as a fallback
- Clients with no `Submission` record still appear in the dashboard (as `pending`)
- The `cpa_status` field is optional on `Submission` — if absent, status is derived from progress