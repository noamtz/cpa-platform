# Submission Archiving & Conflict-Aware Restoration Flow

## Overview

Only one **active** (non-archived) submission may exist per `(client_id, tax_year)` pair at any time.
Archiving and restoring submissions is available to CPAs from the `/clients` page (archive view).

---

## Entities Involved

| Entity | Key Field | Notes |
|--------|-----------|-------|
| `Submission` | `is_archived: boolean` | Default `false`. Archived = hidden from dashboard & client |
| `Client` | `is_archived: boolean` | Archiving a client does not archive their submissions |

---

## CPA Flows

### 1. Archiving a Client

- CPA clicks the archive icon on a client row in `/clients`.
- `Client.is_archived` is set to `true`.
- **The client's submissions are NOT automatically archived** — they remain queryable separately.
- Archived clients do not appear in the main dashboard (`CpaDashboard`).
- Restoring an archived client (`is_archived → false`) makes them visible again with no data loss.

### 2. Archiving a Submission

- Submissions can be archived independently of their client.
- Archived submissions appear in the "הגשות בארכיון" section at the bottom of the `/clients` archive view.
- `getClientByToken` (backend) filters out archived submissions — clients cannot see or modify an archived submission.
- `updateClientSubmission` (backend) returns `{ error: 'submission_archived', reload: true }` with HTTP 409 if the submission being updated is found to be archived.

### 3. Restoring a Submission — No Conflict

1. CPA clicks **שחזר** on an archived submission.
2. System queries all submissions for `{ client_id, tax_year }`.
3. No active (non-archived) submission exists → proceed directly.
4. `Submission.is_archived` set to `false`.
5. Toast: "הגשה שוחזרה".

### 4. Restoring a Submission — With Conflict

If an active submission already exists for the same `(client_id, tax_year)`:

1. `RestoreSubmissionDialog` opens.
2. CPA is shown two options:
   - **שחזר הגשה זו** — activate the archived submission, archive the currently active one.
   - **שמור הגשה פעילה** — keep the existing active submission, leave the archived one in the archive.
3. On confirm:
   - `choice === "restore"`: `Promise.all([ unarchive toRestore, archive conflicting ])`
   - `choice === "keep"`: no database changes.
4. Dialog closes, data reloads.

**Invariant enforced**: After any restore operation, there is never more than one active submission per `(client_id, tax_year)`.

---

## Backend Guards

### `getClientByToken`
```js
// Filters out archived submissions when fetching the client's active questionnaire
const activeSubmissions = submissions.filter(s => !s.is_archived);
```
Clients who navigate to their questionnaire link while their submission is archived will see no existing progress and will start fresh (or the system creates a new submission).

### `updateClientSubmission`
When `submission_id` is provided in the request:
1. Fetch the submission by ID.
2. If it is archived → return `HTTP 409` with body `{ error: 'submission_archived', reload: true }`.
3. Do **not** fall through to create a new submission — the caller must handle the 409.

When no `submission_id` is provided (or after a previous submission was exhausted):
1. Query for any active submission for `(client_id, tax_year)`.
2. If found, update it.
3. If not found, create a new one with the current active template.

---

## Client-Side Stale Submission Handling

**Scenario**: Client opens the questionnaire → CPA restores a different submission (archiving the one the client is on) → client continues answering.

### Detection
`callFunction` in `ClientQuestionnaire` now passes through the full response body on non-2xx responses. When `updateClientSubmission` returns 409 with `{ reload: true }`:

```js
if (result?.reload) {
  setStaleSubmission(true);
  return; // abort the save
}
```

### UI Response
A full-screen blocking card is shown:
```
🔄 השאלון עודכן
רואה החשבון עדכן את השאלון שלך. יש לטעון מחדש כדי להמשיך.
[ טעינה מחדש ]
```
Clicking "טעינה מחדש" calls `window.location.reload()` — the client is re-fetched with the new active submission.

### Step Advance Guard
`handleNext` checks `staleSubmission` **after** awaiting `updateSubmission`. If stale, it does not advance to the next step:
```js
const handleNext = async (stepData) => {
  await updateSubmission(stepData);
  if (staleSubmission) return; // show stale screen instead
  setCurrentStep((prev) => prev + 1);
};
```

---

## Edge Cases & Invariants

| Scenario | Behavior |
|----------|----------|
| Client is mid-flow, CPA archives their submission | Next save returns 409 → stale screen shown |
| Client reloads after seeing stale screen | `getClientByToken` returns the new active submission |
| CPA restores while no active submission exists | Direct restore, no dialog |
| CPA restores while active submission exists | Conflict dialog → CPA chooses which to keep |
| Two rapid restore attempts | Second restore will also trigger conflict detection (invariant safe) |
| Archived client, active submissions | Submissions still appear in archive view; can be managed independently |

---

## Component Map

| File | Role |
|------|------|
| `pages/ClientsPage.jsx` | Archive UI, restore trigger, conflict detection |
| `components/dashboard/RestoreSubmissionDialog.jsx` | Conflict resolution dialog |
| `functions/getClientByToken` | Filters archived submissions from client-facing fetch |
| `functions/updateClientSubmission` | Rejects updates to archived submissions (409) |
| `pages/ClientQuestionnaire.jsx` | Handles 409, shows stale screen, guards step advance |