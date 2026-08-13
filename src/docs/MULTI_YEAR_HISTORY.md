# Multi-Year Submission History — Feature Guide

_Added: 2026-05-10_

---

## Overview

Previously, the CPA dashboard `ClientRow` component only displayed the **current tax year** submission for a client. When the CPA changed a client to a new tax year, the old submission data was still stored in the database but had no way to be viewed from the UI.

This update introduces a **year-tab navigation** inside the expanded `ClientRow` panel, allowing CPAs to browse and inspect every historical submission a client has submitted — without leaving the dashboard.

---

## What Changed

### `components/dashboard/ClientRow`

#### New State Variable
```js
const [viewingSubmission, setViewingSubmission] = useState(null); // null = current year
```
- `null` means "show the current/active submission" (the one passed in via the `submission` prop).
- When a historical tab is clicked, `viewingSubmission` is set to that past `Submission` object.

#### New Derived Variable
```js
const displayedSubmission = viewingSubmission ?? submission;
```
All content-rendering sections (progress breakdown, files, signed PDFs, text responses, delete actions) now use `displayedSubmission` instead of `submission` directly, so they automatically reflect whichever year the CPA has selected.

#### Year Tabs UI
Rendered at the top of the expanded panel **only when `allSubmissions.length > 1`**:

```jsx
{allSubmissions.length > 1 && (
  <div className="flex gap-1.5 flex-wrap">
    <button onClick={() => setViewingSubmission(null)} ...>
      שנת {submission?.tax_year} (נוכחי)
    </button>
    {pastSubmissions.map((s) => (
      <button key={s.id} onClick={() => setViewingSubmission(s)} ...>
        שנת {s.tax_year}
      </button>
    ))}
  </div>
)}
```

Active tab has `bg-primary text-white` styling; inactive tabs are outlined.

#### `pastSubmissions` Derived List
```js
const pastSubmissions = allSubmissions.filter((s) => s.id !== submission?.id);
```
Excludes the current year's submission so it doesn't appear in the historical tabs (it already has its own "נוכחי" button).

#### Updated Sections (all now use `displayedSubmission`)
| Section | Before | After |
|---|---|---|
| Progress breakdown grid | `getStepSummary(submission, ...)` | `getStepSummary(displayedSubmission, ...)` |
| Files (📎) | `getAllFiles(submission, ...)` | `getAllFiles(displayedSubmission, ...)` |
| Signed PDFs (✍️) | `submission?.signed_pdfs` | `displayedSubmission?.signed_pdfs` |
| Text responses | `getStepSummary(submission, ...)` | `getStepSummary(displayedSubmission, ...)` |
| Delete submission button label | `"מחיקת הגשה"` | `` `מחיקת הגשה ${displayedSubmission.tax_year}` `` |
| Delete confirmation dialog | `submission?.tax_year` | `displayedSubmission?.tax_year` |

#### Delete Logic Improvements
The `confirmDelete` function was updated to handle the multi-year scenario correctly:

```js
if (deleteMode === 'submission') {
  await base44.functions.invoke('deleteSubmissionWithFiles', {
    submission_id: displayedSubmission.id,
  });

  // Only reset client status to "pending" if we deleted the CURRENT year
  if (displayedSubmission.id === submission?.id) {
    await base44.entities.Client.update(client.id, { status: 'pending' });
  }

  setViewingSubmission(null); // reset tab to current year after deletion
}

// For full client delete — iterate all submissions
if (deleteMode === 'client') {
  for (const s of allSubmissions) {
    await base44.functions.invoke('deleteSubmissionWithFiles', { submission_id: s.id });
  }
  await base44.entities.Client.delete(client.id);
}
```

**Key fix**: Previously, deleting any submission would blindly reset the client's status to `pending`. Now this only happens when the *current* year's submission is deleted. Deleting a historical submission leaves the current year's status untouched.

**Key fix**: Full client deletion now correctly iterates `allSubmissions` (all years) instead of deleting only the current year's submission before removing the client record.

---

## Data Flow

```
CpaDashboard
  ↓ fetches all submissions per client
  ↓ groups them by client_id
  ↓ passes:
    submission     = the submission matching client.tax_year (current)
    allSubmissions = all submissions for this client (all years)

ClientRow
  ↓ viewingSubmission state (null = current year)
  ↓ displayedSubmission = viewingSubmission ?? submission
  ↓ renders tabs if allSubmissions.length > 1
  ↓ all content sections read from displayedSubmission
```

---

## UX Behaviour

1. Client has **only one submission** → No tabs shown; behaviour identical to before this update.
2. Client has **multiple submissions** → Year tabs appear at the top of the expanded panel.
3. Clicking a past-year tab → All content (progress, files, PDFs) switches to reflect that year's data.
4. Deleting a **past-year submission** → Only that submission+files are removed; client status is unchanged; tab resets to current year.
5. Deleting the **current-year submission** → Submission+files removed; client status reset to `pending`; tab resets to current year.
6. Deleting the **entire client** → All submissions across all years are deleted first, then the client record.

---

## No Backend Changes Required

This feature is entirely **frontend-only**. The `allSubmissions` data was already being fetched by `CpaDashboard` and passed down as a prop — it just wasn't being used for multi-year navigation previously.