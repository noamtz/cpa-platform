# PDF Module — Architecture & Developer Guide

## Overview

The PDF module allows the CPA to upload PDF forms (e.g. power-of-attorney, declarations), mark interactive fields (text, checkbox, signature) using the **pdfme** designer, and present those forms to clients as part of the questionnaire flow. The client fills in the form, signs it, and the completed PDF is stored.

---

## Key Files

| File | Role |
|---|---|
| `lib/pdfme-config.js` | Shared utilities: lazy-loading pdfme, font, Hebrew labels, basePdf helpers |
| `pages/PdfTemplateEditor.jsx` | CPA-facing designer — create / edit PDF templates |
| `components/questionnaire/PdfFormStep.jsx` | Client-facing form — fill & sign the PDF |
| `functions/getActivePdfTemplates` | Returns all active `PdfTemplate` records |
| `functions/uploadFile` | Uploads a file to private storage, returns `file_uri` |
| `functions/createSignedUrl` | Generates a 1-hour signed URL from a `file_uri` |

---

## The `basePdf` Storage Problem & Solution

### Why We Don't Store Base64 in the Entity

pdfme's `Template.basePdf` is a `Uint8Array` (binary PDF bytes) in memory. The naïve approach — converting it to a Base64 string and storing it inside `template_json` on the `PdfTemplate` entity — quickly hits **Base44's entity field size limit** for any real-world PDF (typically several hundred KB to a few MB).

### Solution: File Storage + URI Reference

When saving a template, the binary PDF is **uploaded separately** via the `uploadFile` backend function, which stores it in Base44 private file storage and returns a `file_uri`. The `template_json` field then stores only a small JSON pointer instead of the raw bytes:

```json
{
  "basePdf": { "__type": "file_uri", "value": "private://apps/.../base.pdf" },
  "schemas": [...],
  "fieldMapping": {...}
}
```

When the template needs to be rendered (editor or client form), the pointer is resolved back to bytes via `resolveBasePdf()`.

---

## System Fields (`sys:` prefix)

System fields are auto-filled by the system and **read-only** for the client. The CPA names a field with a `sys:` prefix in the template editor.

### How to Use (CPA)

1. In the PDF template editor, create a Text field
2. Name it with the `sys:` prefix: e.g. `sys:שנת_מס`
3. Save the template

When the client opens the form, the field will be auto-filled with the correct value and locked (read-only).

### Supported System Fields

| Field Name | Resolves To |
|---|---|
| `sys:שנת_מס` / `sys:שנת_המס` / `sys:tax_year` | Client's tax year |
| `sys:שם_מלא` / `sys:שם_הלקוח` / `sys:full_name` | Client's full name |
| `sys:אימייל` / `sys:email` | Client's email |
| `sys:טלפון` / `sys:phone` | Client's phone |
| `sys:ת.ז.` / `sys:תעודת_זהות` / `sys:id_number` | Client's ID number |
| `sys:תאריך_היום` / `sys:today` | Today's date (Hebrew format) |

### Technical Details

- Defined in `lib/pdfme-config.js` → `SYSTEM_FIELD_RESOLVERS`
- Detected by `isSystemField()` → checks for `sys:` prefix
- Resolved by `resolveSystemField(fieldName, clientData)`
- `PdfFormStep.jsx` sets `field.readOnly = true` and fills the value during `initForm()`

---

## `resolveBasePdf(basePdf, appId, authContext?)` — How It Works

Defined in `lib/pdfme-config.js`. Has **two code paths** for security:

```js
export async function resolveBasePdf(basePdf, appId, authContext) {
  // If it's already bytes / a blank-page object, return as-is
  if (!basePdf || typeof basePdf !== "object" || basePdf.__type !== "file_uri") {
    return basePdf;
  }

  if (authContext?.client_id && authContext?.token && authContext?.template_id) {
    // SECURE PATH: Client page → validates ownership via getTemplateFileUrl
    const signRes = await fetch(`/api/apps/${appId}/functions/getTemplateFileUrl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id, token, template_id }),
    });
    // ...
  } else {
    // CPA DASHBOARD PATH: authenticated, uses general createSignedUrl
    const signRes = await fetch(`/api/apps/${appId}/functions/createSignedUrl`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_uri: basePdf.value }),
    });
    // ...
  }
}
```

The signed URL expires in **1 hour**.

> **See `src/docs/SECURITY.md` for the full file access security model.**

---

## Environment Differences: Base44 vs Localhost

### On Base44 (production / preview)

- All API calls to `/api/apps/${appId}/functions/...` are routed to the deployed Deno backend functions by the Base44 platform.
- `VITE_BASE44_APP_ID` is injected automatically at build time.
- `uploadFile` writes to **Base44 private storage** and returns a real `file_uri` (e.g. `private://...`).
- `createSignedUrl` calls `base44.asServiceRole.integrations.Core.CreateFileSignedUrl` — this works because the SDK is authenticated via the service role token available in the Deno runtime.
- The signed URL returned is a short-lived HTTPS URL served by Base44's storage CDN, accessible by the browser.

### On Localhost (development)

- `VITE_BASE44_APP_ID` is still set via `.env` / Vite config, so fetch calls to `/api/apps/${appId}/functions/...` proxy to the **hosted** Base44 backend (same app, remote functions).
- There is **no local Deno runtime** — the frontend always calls the remote deployed functions, even in dev mode.
- This means `uploadFile` and `createSignedUrl` work identically in dev vs production as long as the functions are deployed.
- The only local-only route is `/pdf-test` (guarded by `import.meta.env.DEV`) which is a test harness page — it is never bundled into the production build.

### Summary Table

| Aspect | Base44 (production) | Localhost (dev) |
|---|---|---|
| Frontend origin | `https://your-app.base44.app` | `http://localhost:5173` |
| `/api/apps/.../functions/*` | Base44 edge routing | Proxied to remote Base44 |
| PDF file storage | Base44 private storage | Same (remote) |
| `createSignedUrl` | Works via service role SDK | Works via same remote function |
| `VITE_BASE44_APP_ID` | Auto-injected | Must be set in `.env` |
| `/pdf-test` route | Not available | Available (DEV guard) |

---

## Save Flow (CPA Editor)

```
1. CPA uploads a PDF → FileReader → Uint8Array in memory
2. On Save: Uint8Array is POSTed to /functions/uploadFile → returns { file_uri }
3. template_json is built: { basePdf: { __type: "file_uri", value: file_uri }, schemas, ... }
4. PdfTemplate entity is created/updated with this compact template_json
```

## Load / Render Flow (Editor & Client)

```
1. template_json is fetched from PdfTemplate entity
2. JSON.parse → detect basePdf.__type === "file_uri"
3. POST /functions/createSignedUrl with file_uri → returns { signed_url }
4. fetch(signed_url) → ArrayBuffer → Uint8Array
5. Pass to pdfme Designer / Form / Viewer / generate()
```

---

## `parseBasePdf` vs `resolveBasePdf`

| Function | Async | Purpose |
|---|---|---|
| `parseBasePdf(basePdf)` | No | Legacy sync helper — converts Base64 string to Uint8Array. Still valid if an old template stored raw Base64 (before the file_uri migration). Does NOT resolve `file_uri` references. |
| `resolveBasePdf(basePdf, appId, authContext?)` | **Yes** | The current standard. Handles `file_uri` pointers by fetching a signed URL and returning bytes. When `authContext` is provided (client pages), uses the secure `getTemplateFileUrl` endpoint. When omitted (CPA dashboard), uses `createSignedUrl`. Falls through to the raw value for anything that isn't a `file_uri` object. |

**Always use `resolveBasePdf` in new code.** `parseBasePdf` is kept for backwards compatibility only.
**Always pass `authContext` from client-facing pages.** See `SECURITY.md` for details.

---

## Development Workflow

> **Development Rule:** Always prototype new PDF features in `/pdf-test` first.
> The user tests manually. Once verified, integrate into the production components.

> [!IMPORTANT]
> **AI Agent Rule:** Do NOT use the browser agent to test PDF features.
> The user will test manually using the `/pdf-test` page every time a feature is added.
> Just implement the code and let the user know what to test.

```
┌─────────────────────────────────────────────────────┐
│  1. PROTOTYPE in /pdf-test                          │
│     • Full 4-step wizard (Designer → Mapping →      │
│       Form → Viewer)                                │
│     • No auth, no backend, mock data                │
│     • Iterate until feature works correctly         │
├─────────────────────────────────────────────────────┤
│  2. VERIFY manually                                 │
│     • Upload real PDF                               │
│     • Add fields, set required, set system/client   │
│     • Fill form, check validation                   │
│     • Preview, download, verify output              │
├─────────────────────────────────────────────────────┤
│  3. INTEGRATE into production                       │
│     • Extract reusable logic → pdfme-config.js      │
│     • Update PdfTemplateEditor.jsx (CPA)            │
│     • Update PdfFormStep.jsx (Client)               │
│     • Test E2E with real backend                    │
└─────────────────────────────────────────────────────┘
```

### Accessing the Test Page

- **URL:** `http://localhost:5173/pdf-test`
- **Route:** Defined in `App.jsx`
- **No auth required** — purely client-side

### Manual Testing Checklist

After adding a new feature to the test page, follow these steps:

1. Open `http://localhost:5173/pdf-test`
2. **Designer tab:** Upload a PDF → add text fields, checkboxes, signature fields
3. **Save:** Click "שמור ועבור למיפוי"
4. **Mapping tab:** Assign system vs client roles
5. **Form tab:** Click "טען טופס" → fill client fields → test the new feature
6. **Accept:** Click "קבל תשובות" → verify validation
7. **Viewer tab:** Click "טען תצוגה" → verify all data shows
8. **Download:** Click "הורד PDF" → open and verify the final output

---

## E-Signature Legal Framework (Israel)

### Israeli Electronic Signature Law (חוק חתימה אלקטרונית, תשס"א-2001)

Israeli law recognizes three tiers of electronic signatures:

| Tier | Hebrew | What It Is | Court Validity |
|------|--------|-----------|----------------|
| 1. Basic | חתימה אלקטרונית רגילה | Drawn image, checkbox, "I agree" | Accepted, but weaker — other party can dispute |
| 2. Secure | חתימה אלקטרונית מאובטחת | Cryptographic signature with private key | Strong presumption of validity |
| 3. Certified | חתימה אלקטרונית מאושרת | Secure + certificate from licensed CA | Equivalent to handwritten signature |

### Current Implementation: Tier 1 + Audit Trail

Our system uses **Tier 1** (canvas-drawn signature via pdfme) enhanced with a comprehensive **audit trail** that strengthens legal defensibility. Israeli courts regularly accept basic e-signatures for tax-related authorizations when backed by identity verification and audit logs.

### Audit Trail Record

Generated automatically on every PDF signing via `buildAuditTrail()` in `pdfme-config.js`:

```json
{
  "signed_at": "2025-05-04T14:30:00.000Z",
  "timezone": "Asia/Jerusalem",
  "signer_name": "ישראל ישראלי",
  "signer_email": "israel@example.com",
  "signer_phone": "050-1234567",
  "signer_ip": "84.228.xxx.xxx",
  "user_agent": "Mozilla/5.0 ...",
  "screen_resolution": "1920x1080",
  "pdf_hash_sha256": "a1b2c3d4e5f6...",
  "pdf_size_bytes": 245632,
  "signature_method": "pdfme_canvas_draw",
  "audit_version": "1.0"
}
```

| Field | Purpose |
|-------|---------|
| `signed_at` + `timezone` | Exact moment of signing |
| `signer_name/email/phone` | Identity from questionnaire link |
| `signer_ip` | Network location (via ipify.org, 3s timeout) |
| `user_agent` | Browser/device fingerprint |
| `pdf_hash_sha256` | Tamper-proof: proves document wasn't modified |
| `pdf_size_bytes` | Additional integrity check |

### Audit Trail Utilities (`pdfme-config.js`)

| Export | Purpose |
|--------|---------|
| `hashPdfBlob(blob)` | SHA-256 hash via Web Crypto API |
| `getSignerIp()` | Fetch IP via `api.ipify.org`, fails gracefully |
| `buildAuditTrail(blob, signerInfo)` | Assemble full audit record |

**Status:** ✅ Test page (console.log + status bar) | ✅ Production (passed to `onComplete`)

### Future: Tier 3 (Certified Digital Signature)

For legally equivalent-to-handwritten signatures, integrate with a licensed Israeli CA:
- **Comsign** (קומסיין) — most popular in Israel
- **eValue** — another licensed provider
- **DocuSign** with Israeli compliance module

These embed a cryptographic certificate (PKCS#7/CMS) into the PDF that Adobe Reader verifies.

> [!NOTE]
> For CPA tax forms (ייפוי כוח, הצהרות), Tier 1 + audit trail is standard industry practice.
> Tier 3 is mainly needed for real estate, banking, and government filings.

---

## Critical Technical Gotchas

### Template Deep Clone
When initializing `Form`, the template must be deep-cloned to prevent schema mutations from corrupting the original. But `basePdf` (Uint8Array) must NOT be cloned via `JSON.parse(JSON.stringify())` — it would be destroyed.

```js
const formTemplate = {
  ...templateData,
  schemas: templateData.schemas.map((page) =>
    page.map((field) => ({ ...field }))
  ),
};
// basePdf is shared by reference — this is correct
```

### LTR Container for pdfme
pdfme's internal layout breaks in RTL context. The container div must have `direction: "ltr"` even though the app is RTL:

```jsx
<div ref={containerRef} style={{ direction: "ltr" }} />
```

### Multi-Page PDF Input Flattening
pdfme treats each entry in `inputs[]` as a separate document to generate. For a 3-page PDF with `[{a}, {b}, {c}]`, it produces 9 pages (3×3). Use `flattenInputs()` to merge into `[{a, b, c}]`.

### ⚠️ CRITICAL: Container Must Have FIXED Height (Never `minHeight`)

> [!CAUTION]
> **This bug caused 2+ hours of debugging and near-unrecoverable browser crashes.**
> Do NOT use `minHeight` on any pdfme container. Use a fixed `height` with `overflow: hidden`.

**Bug:** pdfme uses an internal `ResizeObserver`. When the container has `minHeight`, pdfme renders content → container height grows → ResizeObserver fires → pdfme re-renders → container grows more → **infinite loop**. This creates thousands of blob/data URLs, consumes 2+ GB of memory, and crashes the browser tab within seconds.

**Symptoms:**
- Network tab shows infinitely growing `blob:` and `data:text/javascript` requests
- Memory usage climbs past 2 GB and the tab becomes unresponsive
- The pdfme container (grey box) visually grows without bound
- The page spinner never resolves despite `Status: ready`

**Fix:** Always use a **fixed height** and `overflow: hidden`:
```jsx
// ✅ CORRECT — fixed height, no resize loop
<div ref={containerRef} style={{
  height: "calc(100vh - 300px)",
  overflow: "hidden",
  direction: "ltr",
}} />

// ❌ WRONG — causes infinite render loop + browser crash
<div ref={containerRef} style={{
  minHeight: "500px",
  direction: "ltr",
}} />
```

**Affected components:**
- `PdfFormStep.jsx` — Form container + Viewer container
- `PdfSignTest.jsx` — Test page container
- Any future component using `@pdfme/ui` `Form`, `Designer`, or `Viewer`

### Zoom
pdfme handles zoom internally with `+`/`-` buttons. Do NOT set `zoomLevel` or `maxZoom` manually — it causes blurring artifacts.

### Font Asset
`public/fonts/Heebo-Regular.ttf` must be present. If missing, text renders in the default font (no Hebrew support). Ensure this file is included in any deployment.