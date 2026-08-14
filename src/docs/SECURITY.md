# Security Model — File Access & Client Permissions

> **Last updated:** 2026-05-06
> **Scope:** Client-facing (questionnaire + signing) file access controls.
> Always read this document before modifying any file-serving endpoints or client-facing pages.

---

## 1. Guiding Principles

1. **Zero Trust for Clients** — Clients have NO default file access. Every file request must be validated server-side.
2. **No User-Supplied File URIs** — A client's browser never sends a `file_uri` to the server. The server resolves URIs internally from validated entity data.
3. **Whitelist-Only Access** — Clients can only access files through specific, purpose-built endpoints that enforce ownership via `client_id + token`.
4. **CPA Dashboard Is Separate** — CPA-authenticated endpoints (`createSignedUrl`, `CreateFileSignedUrl` via SDK) remain available for the dashboard. These require Base44 auth and are never called from public pages.

---

## 2. Two User Contexts

| Context | Auth Model | File Access Model |
|---|---|---|
| **CPA Dashboard** | Base44 login (JWT in `base44_access_token`) | Full access via SDK (`CreateFileSignedUrl`) or `createSignedUrl` backend function |
| **Client Questionnaire** | URL token (`?client=...&token=...`) | **Whitelist-only** — two specific backend functions (see below) |

> [!CAUTION]
> The client questionnaire explicitly clears `base44_access_token` and `token` from localStorage on load. This prevents the Base44 SDK from making authenticated calls from the client's browser.

---

## 3. Whitelisted Client Endpoints

### 3.1 `getSignedPdfUrl` — View Own Signed PDFs

**Purpose:** Allows a client to view a PDF they previously signed.

| Field | Value |
|---|---|
| **Path** | `base44/functions/getSignedPdfUrl/entry.ts` |
| **Input** | `{ client_id, token, step_id }` |
| **Validation** | 1. Client exists with matching `token` → 2. Submission found for client → 3. `signed_pdfs` JSON contains a record with matching `step_id` → 4. That record has a `pdf_file_url` |
| **Returns** | `{ signed_url }` — 1-hour expiring URL for that specific PDF file |

**What it blocks:**
- ❌ Arbitrary `file_uri` injection — the URI is resolved from the submission's `signed_pdfs` field server-side
- ❌ Cross-client access — token must match the specific client
- ❌ Accessing non-existent steps — step_id must exist in the signed_pdfs array

**Used by:** `ClientQuestionnaire.jsx` → "📄 צפייה בטופס החתום" button

---

### 3.2 `getTemplateFileUrl` — Load PDF Template During Signing

**Purpose:** Allows the signing page to load the base PDF template file needed for pdfme rendering.

| Field | Value |
|---|---|
| **Path** | `base44/functions/getTemplateFileUrl/entry.ts` |
| **Input** | `{ client_id, token, template_id }` |
| **Validation** | 1. Client exists with matching `token` → 2. PdfTemplate exists with matching `template_id` → 3. Template has a `base_pdf` field (file_uri or direct reference) |
| **Returns** | `{ signed_url }` — 1-hour expiring URL for the template's base PDF file |

**What it blocks:**
- ❌ Arbitrary `file_uri` injection — the URI is resolved from the template entity's `base_pdf` field server-side
- ❌ Template enumeration without a valid client token
- ❌ Accessing non-existent templates

**Used by:** `pdfme-config.js` → `resolveBasePdf()` when `authContext` is provided

---

## 4. File Access Flow Diagrams

### Client Views Signed PDF

```
Browser                          Server (getSignedPdfUrl)
  │                                │
  ├─ POST { client_id,            │
  │        token,                  │
  │        step_id }  ───────────► │
  │                                ├─ Validate client + token
  │                                ├─ Load submission for client
  │                                ├─ Parse signed_pdfs JSON
  │                                ├─ Find record where step_id matches
  │                                ├─ Extract pdf_file_url from record
  │                                ├─ CreateFileSignedUrl(pdf_file_url)
  │                                │
  │ ◄─────── { signed_url } ───── │
  │                                │
  ├─ window.open(signed_url)       │
```

### Client Loads PDF Template (Signing Page)

```
Browser (PdfFormStep)             Server (getTemplateFileUrl)
  │                                │
  ├─ POST { client_id,            │
  │        token,                  │
  │        template_id } ────────► │
  │                                ├─ Validate client + token
  │                                ├─ Load PdfTemplate entity
  │                                ├─ Extract base_pdf file_uri from template
  │                                ├─ CreateFileSignedUrl(base_pdf_uri)
  │                                │
  │ ◄─────── { signed_url } ───── │
  │                                │
  ├─ fetch(signed_url)             │
  ├─ arrayBuffer → Uint8Array     │
  ├─ Pass to pdfme renderer       │
```

---

## 5. The `resolveBasePdf` Dual-Path System

`resolveBasePdf(basePdf, appId, authContext)` in `lib/pdfme-config.js` has two code paths:

| Path | When | Endpoint | Security |
|---|---|---|---|
| **Secure (client)** | `authContext` has `client_id + token + template_id` | `getTemplateFileUrl` | Server validates ownership |
| **Direct (CPA)** | `authContext` is `undefined` | `createSignedUrl` | CPA is already authenticated |

```js
if (authContext?.client_id && authContext?.token && authContext?.template_id) {
  // Secure path → getTemplateFileUrl (validates ownership)
} else {
  // CPA dashboard path → createSignedUrl (requires auth)
}
```

---

## 6. Endpoints Clients CANNOT Access

| Endpoint | Why Blocked |
|---|---|
| `createSignedUrl` | Accepts arbitrary `file_uri` from caller — only used by CPA dashboard (authenticated) |
| `CreateFileSignedUrl` (SDK) | Requires Base44 auth token — client questionnaire clears auth tokens on load |
| `uploadFile` | No auth required but only accepts file uploads — doesn't return file contents |
| `downloadAllFiles` | Requires Base44 auth header |
| `syncFilesToGoogleDrive` | Requires Base44 auth + Google connector |

---

## 7. Frontend Security Measures

### Auth Token Clearing
Both `ClientQuestionnaire.jsx` and `PdfSignPage.jsx` clear stored tokens on mount:
```js
useEffect(() => {
  localStorage.removeItem('base44_access_token');
  localStorage.removeItem('token');
}, []);
```
This prevents the Base44 SDK from making authenticated API calls from the client's browser.

### authContext Propagation
`PdfSignPage.jsx` passes auth credentials down to `PdfFormStep`:
```jsx
<PdfFormStep
  authContext={{ client_id: clientId, token, template_id: templateId }}
  // ...
/>
```
`PdfFormStep` passes this to all `resolveBasePdf()` calls, ensuring every template file fetch goes through the validated `getTemplateFileUrl` endpoint.

---

## 8. Attack Vector Analysis

| Attack | Blocked By |
|---|---|
| **Inject arbitrary file_uri** | No endpoint accepts `file_uri` from clients. All URIs resolved server-side. |
| **Access another client's files** | `client_id + token` validation. Token is a per-client secret. |
| **Enumerate templates** | `getTemplateFileUrl` requires valid `client_id + token`. |
| **Access uploaded documents** (form 106, etc.) | No client-facing endpoint serves uploaded files. Only CPA dashboard can view these. |
| **Use browser devtools to call createSignedUrl** | Auth tokens are cleared on questionnaire load. `createSignedUrl` function itself doesn't require auth, but it's not called from any client-facing code. The function could be hardened further (see recommendations). |

---

## 9. Future Recommendations

1. **Add auth requirement to `createSignedUrl`** — Currently this function doesn't validate the caller. Adding `await base44.auth.me()` check would prevent unauthenticated calls entirely. This is the last remaining gap.
2. **Rate limiting** — Consider adding rate limits to `getSignedPdfUrl` and `getTemplateFileUrl` to prevent brute-force token guessing.
3. **Audit logging** — Log all file access attempts (successful and failed) for security monitoring.
4. **Token rotation** — Consider rotating client tokens after questionnaire completion to prevent replay attacks.
