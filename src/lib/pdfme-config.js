/**
 * Shared pdfme configuration — Hebrew labels, font loading, plugins.
 * Used by PdfTemplateEditor (CPA) and PdfFormStep (Client).
 */

import { fileClient } from "@/api/file-client";

// ========== LAZY-LOADED MODULES ==========
let Designer, Form, Viewer, text, image, signature, check, generate;
let pdfmeLoadPromise = null;

export async function loadPdfme() {
  if (Designer) return;
  if (pdfmeLoadPromise) return pdfmeLoadPromise;
  pdfmeLoadPromise = (async () => {
    const [uiMod, schemasMod, genMod] = await Promise.all([
      import("@pdfme/ui"),
      import("@pdfme/schemas"),
      import("@pdfme/generator"),
    ]);
    Designer = uiMod.Designer;
    Form = uiMod.Form;
    Viewer = uiMod.Viewer;
    text = schemasMod.text;
    image = schemasMod.image;
    signature = schemasMod.signature;
    check = schemasMod.checkbox;
    generate = genMod.generate;
  })();
  return pdfmeLoadPromise;
}

export function getPdfmeModules() {
  return { Designer, Form, Viewer, generate };
}

export function getPlugins() {
  // Wrap text plugin to default alignment=center, verticalAlignment=middle
  const centeredText = text ? {
    ...text,
    propPanel: {
      ...text.propPanel,
      defaultSchema: {
        ...(text.propPanel?.defaultSchema || {}),
        alignment: 'center',
        verticalAlignment: 'middle',
      },
    },
  } : text;
  return { Text: centeredText, Image: image, Signature: signature, Checkbox: check };
}

// ========== FONT ==========
let heeboFontData = null;

export async function loadHeeboFont() {
  if (heeboFontData) return heeboFontData;
  try {
    const res = await fetch("/fonts/Heebo-Regular.ttf");
    if (res.ok) heeboFontData = await res.arrayBuffer();
  } catch (e) {
    console.warn("Could not load Heebo font:", e);
  }
  return heeboFontData;
}

export async function getFontConfig() {
  const fontData = await loadHeeboFont();
  if (!fontData) return undefined;
  return { Heebo: { data: fontData, fallback: true } };
}

export function getFontOptions(fontData) {
  if (!fontData) return {};
  return {
    font: { Heebo: { data: fontData, fallback: true } },
  };
}

// ========== HEBREW LABELS ==========
export const HEBREW_LABELS = {
  editField: "עריכת שדה",
  fieldsList: "רשימת שדות",
  type: "סוג",
  editable: "ניתן לעריכה",
  required: "שדה חובה",
  edit: "עריכה",
  plsInputName: "נא להזין שם",
  fieldMustUniq: "שם השדה אינו ייחודי",
  notUniq: "(שם לא ייחודי)",
  noKeyName: "ללא שם",
  width: "רוחב",
  height: "גובה",
  opacity: "שקיפות",
  rotate: "סיבוב",
  errorOccurred: "אירעה שגיאה",
  addPageAfter: "הוסף עמוד אחרי",
  removePage: "מחק עמוד נוכחי",
  removePageConfirm: "האם למחוק עמוד זה? לא ניתן לבטל פעולה זו.",
  commitBulkUpdateFieldName: "שמור שינויים",
  bulkUpdateFieldName: "עדכון שמות שדות",
  "schemas.color": "צבע",
  "schemas.borderWidth": "עובי מסגרת",
  "schemas.borderColor": "צבע מסגרת",
  "schemas.backgroundColor": "צבע רקע",
  "schemas.textColor": "צבע טקסט",
  "schemas.bgColor": "צבע רקע",
  "schemas.horizontal": "אופקי",
  "schemas.vertical": "אנכי",
  "schemas.left": "שמאל",
  "schemas.center": "מרכז",
  "schemas.right": "ימין",
  "schemas.top": "למעלה",
  "schemas.middle": "אמצע",
  "schemas.bottom": "למטה",
  "schemas.padding": "ריפוד",
  "schemas.text.fontName": "גופן",
  "schemas.text.size": "גודל",
  "schemas.text.spacing": "מרווח",
  "schemas.text.textAlign": "יישור טקסט",
  "schemas.text.verticalAlign": "יישור אנכי",
  "schemas.text.lineHeight": "גובה שורה",
  "schemas.text.dynamicFontSize": "גודל גופן דינמי",
  "schemas.text.format": "עיצוב",
  "schemas.text.plain": "רגיל",
  "schemas.radius": "עיגול פינות",
};

// ========== BASE PDF PARSING ==========
/**
 * Reconstruct basePdf from stored base64 string, Uint8Array, or dimensions object.
 */
export function parseBasePdf(basePdf) {
  if (!basePdf) return undefined;
  if (basePdf instanceof Uint8Array || basePdf instanceof ArrayBuffer) return basePdf;
  if (typeof basePdf === "object" && basePdf.width) return basePdf;
  // Stored as a file_uri reference — caller must resolve via createSignedUrl first
  if (typeof basePdf === "object" && basePdf.__type === "file_uri") return basePdf;
  if (typeof basePdf === "string") {
    try {
      const binary = atob(basePdf);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    } catch {
      return basePdf;
    }
  }
  return basePdf;
}

// Cache for resolved base PDFs keyed by file_uri value
const resolvedPdfCache = new Map();

/**
 * Resolve a basePdf that may be a { __type: "file_uri", value } reference.
 * Fetches the signed URL and returns a Uint8Array. Result is cached in memory.
 * 
 * @param basePdf - The basePdf value from the template
 * @param authContext - Required public { client_id, token, template_id } or CPA
 *                      { cpa: true, template_id } locator context.
 */
export async function resolveBasePdf(basePdf, authContext) {
  if (!basePdf || typeof basePdf !== "object" || basePdf.__type !== "file_uri") {
    return basePdf;
  }
  const cacheKey = basePdf.value;
  if (resolvedPdfCache.has(cacheKey)) {
    return resolvedPdfCache.get(cacheKey);
  }

  let signed_url;

  if (authContext?.client_id && authContext?.token && authContext?.template_id) {
    ({ signed_url } = await fileClient.getPublicTemplateFileUrl({
      client_id: authContext.client_id,
      token: authContext.token,
      template_id: authContext.template_id,
    }));
  } else if (authContext?.cpa && authContext?.template_id) {
    ({ signed_url } = await fileClient.getCpaTemplateFileUrl(
      authContext.template_id,
    ));
  } else {
    throw new Error("Missing authorized PDF template context");
  }

  const pdfRes = await fetch(signed_url);
  const arrayBuffer = await pdfRes.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  resolvedPdfCache.set(cacheKey, bytes);
  return bytes;
}

// ========== SYSTEM FIELDS ==========
/**
 * System fields are auto-filled and read-only for the client.
 * CPA names them with a "sys:" prefix in the template editor.
 * Example: "sys:שנת_מס" → resolves to clientData.tax_year
 *
 * Supported system field keys (after "sys:" prefix):
 */
const SYSTEM_FIELD_RESOLVERS = {
  // Hebrew names
  "שנת_מס": (d) => String(d.tax_year || 2024),
  "שנת_המס": (d) => String(d.tax_year || 2024),
  "שם_מלא": (d) => d.full_name || "",
  "שם_הלקוח": (d) => d.full_name || "",
  "אימייל": (d) => d.email || "",
  "טלפון": (d) => d.phone || "",
  "ת.ז.": (d) => d.id_number || "",
  "תעודת_זהות": (d) => d.id_number || "",
  // English names
  "tax_year": (d) => String(d.tax_year || 2024),
  "full_name": (d) => d.full_name || "",
  "email": (d) => d.email || "",
  "phone": (d) => d.phone || "",
  "id_number": (d) => d.id_number || "",
  // Date helpers
  "תאריך_היום": () => new Date().toLocaleDateString("he-IL"),
  "today": () => new Date().toLocaleDateString("he-IL"),
};

/**
 * Check if a field name is a system field (starts with "sys:")
 */
export function isSystemField(fieldName) {
  return fieldName?.startsWith?.("sys:");
}

/**
 * Extract the system key from a field name (remove "sys:" prefix, normalize)
 */
export function getSystemFieldKey(fieldName) {
  if (!isSystemField(fieldName)) return null;
  return fieldName.slice(4).trim().replace(/\s+/g, "_");
}

/**
 * Resolve a system field's value from client data.
 * Returns the value string, or null if not a recognized system field.
 */
export function resolveSystemField(fieldName, clientData) {
  const key = getSystemFieldKey(fieldName);
  if (!key) return null;
  const resolver = SYSTEM_FIELD_RESOLVERS[key];
  return resolver ? resolver(clientData) : null;
}

/**
 * Get all supported system field keys (for documentation/UI hints)
 */
export function getSystemFieldKeys() {
  return Object.keys(SYSTEM_FIELD_RESOLVERS);
}

// ========== FIELD VALIDATION ==========
/**
 * Validate that all required fields have values.
 * Searches ALL input pages for each field (pdfme may not align page indices).
 * Returns array of missing field names, or empty array if all ok.
 */
export function validateRequiredFields(schemas, inputs) {
  const missing = [];
  schemas.forEach((pageSchemas, pageIdx) => {
    pageSchemas.forEach((field) => {
      if (field.required) {
        // Check if ANY input page has a non-empty value for this field
        const found = inputs.some((pageInputs, inputPageIdx) => {
          if (!pageInputs) return false;
          const val = pageInputs[field.name];
          
          // Completely empty — reject
          if (val === undefined || val === null || val === "") return false;
          
          // Empty string or whitespace-only — reject
          if (typeof val === "string") {
            const trimmed = val.trim();
            if (trimmed === "") return false;
            
            // Signature as base64 PNG: reject if empty canvas or just header
            if (val.startsWith("data:image/png;base64,")) {
              const base64Data = val.replace("data:image/png;base64,", "");
              // Empty signature canvas is very small (<500 bytes), valid is >1000
              if (base64Data.length < 500) return false;
            }
          }
          
          // Object type (shouldn't happen for required fields) — reject if empty
          if (typeof val === "object" && Object.keys(val || {}).length === 0) return false;
          
          return true;
        });
        
        if (!found) {
          missing.push(field.name);
        }
      }
    });
  });
  return missing;
}

// ========== INPUT FLATTENING ==========
/**
 * pdfme treats each entry in `inputs[]` as a separate document to stamp.
 * For a multi-page PDF, ALL field values must be in a SINGLE object.
 * If we pass [{field1:"a"}, {field2:"b"}] to generate(), it produces the PDF twice.
 * This helper merges all entries into [{field1:"a", field2:"b"}].
 */
export function flattenInputs(inputs) {
  if (!inputs || inputs.length <= 1) return inputs;
  const merged = {};
  inputs.forEach((pageInputs) => {
    Object.entries(pageInputs || {}).forEach(([key, val]) => {
      if (val !== undefined && val !== "") {
        merged[key] = val;
      }
    });
  });
  return [merged];
}

// ========== SYSTEM DATA MERGE ==========
/**
 * Merge system-auto-filled values into form inputs.
 * pdfme's getInputs() may drop readOnly fields, so we re-inject them.
 */
export function mergeSystemInputs(userInputs, schemas, fieldMapping, systemData) {
  return userInputs.map((pageInputs, pageIdx) => {
    const merged = { ...pageInputs };
    const pageSchemas = schemas[pageIdx] || [];
    pageSchemas.forEach((field) => {
      const mapping = fieldMapping?.[field.name];
      if (mapping?.role === "system" && mapping.systemKey && !merged[field.name]) {
        merged[field.name] = systemData[mapping.systemKey] || "";
      }
    });
    return merged;
  });
}

// ========== AUDIT TRAIL ==========
/**
 * Generate a SHA-256 hash of a PDF Blob for tamper-proof verification.
 * Proves the document wasn't modified after signing.
 */
export async function hashPdfBlob(blob) {
  const buffer = await blob.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Fetch the signer's public IP address via a free API.
 * Falls back gracefully if blocked by CORS/ad-blockers.
 */
export async function getSignerIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      return data.ip || "unknown";
    }
  } catch {
    // Silently fail — IP is optional metadata
  }
  return "unknown";
}

/**
 * Build a complete audit trail record for a signed PDF.
 * This strengthens legal defensibility of the e-signature under
 * Israeli Electronic Signature Law (חוק חתימה אלקטרונית, תשס"א-2001).
 *
 * @param {Blob} pdfBlob - The generated PDF blob
 * @param {object} signerInfo - { name, email, phone } of the signer
 * @returns {Promise<object>} Audit trail record
 */
export async function buildAuditTrail(pdfBlob, signerInfo = {}) {
  const [pdfHash, signerIp] = await Promise.all([
    hashPdfBlob(pdfBlob),
    getSignerIp(),
  ]);

  return {
    // When
    signed_at: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

    // Who
    signer_name: signerInfo.name || "",
    signer_email: signerInfo.email || "",
    signer_phone: signerInfo.phone || "",

    // Where / How
    signer_ip: signerIp,
    user_agent: navigator.userAgent,
    screen_resolution: `${screen.width}x${screen.height}`,

    // What
    pdf_hash_sha256: pdfHash,
    pdf_size_bytes: pdfBlob.size,

    // Verification
    signature_method: "pdfme_canvas_draw",
    audit_version: "1.0",
  };
}
