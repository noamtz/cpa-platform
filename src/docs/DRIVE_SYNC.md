# Google Drive Sync — Architecture & Developer Guide

## Overview

The Drive Sync feature allows CPA users to sync all client submission files (uploaded documents + signed PDFs) to their personal Google Drive account, organized in a clean folder hierarchy.

---

## Folder Structure on Drive

```
[Base Path (optional)] /
  └── שם_לקוח/
        └── שנת_מס/
              ├── [Step Title] /
              │     ├── [Step Title] - קובץ 1.pdf
              │     └── [Step Title] - קובץ 2.jpg
              └── טפסים חתומים /
                    └── [Template Name] - חתום.pdf
```

The base path is configurable per user (stored as `user.drive_base_path`). If empty, files are placed in the Drive root.

---

## Authentication

Uses an **App User OAuth Connector** (per-user Google Drive access):

- Connector ID: `69fb22f94d2b7077430e5187`
- Connector Name: `Google Drive Sync`
- OAuth Scopes: Google Drive file read/write

Each CPA user connects their own Google account via the Settings page. The OAuth token is retrieved server-side using:

```js
const { accessToken } = await base44.asServiceRole.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
```

---

## Backend Function: `syncFilesToGoogleDrive`

**File:** `functions/syncFilesToGoogleDrive.js`

Handles three operation modes via the request body:

### 1. Connection Check
```json
{ "check_connection": true }
```
Returns `{ connected: true, email: "user@gmail.com" }` or throws on failure.

### 2. Batch Sync (primary mode)
```json
{
  "sync_all": true,
  "submission_ids": [
    { "submission_id": "abc", "client_id": "xyz" },
    ...
  ]
}
```
Syncs all provided submissions in one function invocation.

### 3. Single Sync (legacy)
```json
{
  "submission_id": "abc",
  "client_id": "xyz"
}
```
Syncs a single submission. Used for one-off syncs.

---

## Batch Sync — Internal Flow

```
1. Load submissions + clients
   └── Batched in groups of 20 (parallel per chunk)

2. Load ALL SyncedDriveFile records in ONE query
   └── Build map: submission_id → Set<original_file_url>

3. Filter: only submissions with at least 1 un-synced file

4. For each submission needing sync:
   a. Batch-generate signed URLs (all private files in parallel)
   b. Build folder structure (client / year) using folder ID cache
   c. For each step: resolve folder (cached), queue upload task
   d. Execute uploads in parallel batches of 5
   e. Write SyncedDriveFile record to DB after each successful upload
```

---

## Key Optimizations

| Optimization | Detail |
|---|---|
| **Single DB read** | All `SyncedDriveFile` records loaded in one `.list()` call, then filtered in-memory |
| **Folder ID cache** | `folderCache` map (`"parentId/folderName" → folderId`) shared across all submissions in a run — eliminates redundant Drive search API calls |
| **Signed URL batching** | All private file URIs for a submission are signed in parallel before any upload starts |
| **Parallel uploads** | Files uploaded in concurrent batches of 5 — stays within Google Drive rate limits (~10 writes/sec) |
| **Early skip** | Submissions with no new files are skipped before any Drive API call is made |

---

## Deduplication: `SyncedDriveFile` Entity

Each successfully uploaded file is recorded in the `SyncedDriveFile` entity:

| Field | Description |
|---|---|
| `submission_id` | ID of the parent submission |
| `original_file_url` | Original Base44 file URI — used as the unique dedup key |
| `drive_file_id` | Google Drive file ID |
| `drive_parent_folder_id` | Google Drive folder ID where the file lives |
| `file_name_on_drive` | Display name on Drive |
| `synced_at` | Timestamp of upload |

On every sync run, synced URIs are loaded into a `Set` and checked before any upload — already-synced files are skipped instantly.

---

## File Types Handled

| Source | Field | Notes |
|---|---|---|
| Questionnaire uploads | `submission.responses[stepId].files[]` | Per-step file arrays |
| Signed PDFs | `submission.signed_pdfs[].pdf_file_url` | Organized by step/template name |

Private files (URIs starting with `mp/` or `private/`) are resolved to time-limited signed URLs before download.

---

## Frontend: Settings Page

**File:** `pages/Settings.jsx`

- Connect / Disconnect button via `base44.connectors.connectAppUser(CONNECTOR_ID)`
- After OAuth popup closes, auto-re-checks connection status
- Configurable base path saved to `user.drive_base_path`
- "Sync Drive" button triggers `SyncAllDriveButton` component

**File:** `components/dashboard/SyncAllDriveButton.jsx`

- Filters submissions: only those with `client_id` and at least `step_completed >= 1`
- Single call to `syncFilesToGoogleDrive` with `sync_all: true`
- Displays upload count and skipped count after completion

---

## Scalability Notes

| Scale | Expected Behavior |
|---|---|
| < 200 submissions | Fast — typically < 30s |
| 200–1000 submissions | ~1–2 minutes (mostly Drive upload time) |
| > 1000 submissions | Folder cache and batch uploads keep it manageable; SyncedDriveFile `.list(null, 10000)` is the upper limit to watch |

**Future consideration:** If `SyncedDriveFile` records exceed ~10,000, replace `.list(null, 10000)` with paginated loading or a DB-level filter by submission IDs.