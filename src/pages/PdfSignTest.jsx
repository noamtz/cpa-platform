import React, { useState, useEffect, useRef } from "react";

/**
 * Isolated test — same inline pdfme approach as PdfTestPage,
 * but loads template from API instead of local file.
 * If this works without growing requests, the issue is in PdfFormStep/pdfme-config.
 * If this also has growing requests, the issue is pdfme + API-loaded templates.
 */

// OWN copy of pdfme modules (same as PdfTestPage)
let Designer, Form, Viewer, text, image, signature, check, generate;

async function loadPdfme() {
  if (Designer) return;
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
}

function getPlugins() {
  return { Text: text, Image: image, Signature: signature, Checkbox: check };
}

let heeboFontData = null;
async function loadHeeboFont() {
  if (heeboFontData) return heeboFontData;
  try {
    const res = await fetch("/fonts/Heebo-Regular.ttf");
    if (res.ok) heeboFontData = await res.arrayBuffer();
  } catch (e) {
    console.warn("Could not load Heebo font:", e);
  }
  return heeboFontData;
}

const HEBREW_LABELS = {
  editField: "עריכת שדה",
  fieldsList: "רשימת שדות",
  type: "סוג",
  required: "שדה חובה",
  edit: "עריכה",
};

const TEMPLATE_ID = "69f8a828f229be741bfb8798";

export default function PdfSignTest() {
  const formRef = useRef(null);
  const formInstanceRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    init();
    return () => {
      if (formInstanceRef.current) {
        formInstanceRef.current.destroy();
        formInstanceRef.current = null;
      }
    };
  }, []);

  const init = async () => {
    try {
      console.log("[PdfSignTest] Starting...");
      
      // 1. Load pdfme
      await loadPdfme();
      const fontData = await loadHeeboFont();
      console.log("[PdfSignTest] pdfme loaded");

      // 2. Load template from API
      const appId = import.meta.env.VITE_BASE44_APP_ID;
      const res = await fetch(`/api/apps/${appId}/functions/getPdfTemplateById`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: TEMPLATE_ID }),
      });
      if (!res.ok) throw new Error("Failed to load template");
      const data = await res.json();
      const template = data.template;
      console.log("[PdfSignTest] Template loaded:", template?.name);

      // 3. Parse template_json
      const tpl = JSON.parse(template.template_json);
      console.log("[PdfSignTest] basePdf type:", typeof tpl.basePdf,
        typeof tpl.basePdf === "object" ? tpl.basePdf?.__type : "");

      // 4. Resolve basePdf (same logic as resolveBasePdf)
      if (tpl.basePdf && typeof tpl.basePdf === "object" && tpl.basePdf.__type === "file_uri") {
        console.log("[PdfSignTest] Resolving file_uri...");
        const signRes = await fetch(`/api/apps/${appId}/functions/createSignedUrl`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_uri: tpl.basePdf.value }),
        });
        const { signed_url } = await signRes.json();
        const pdfRes = await fetch(signed_url);
        const arrayBuffer = await pdfRes.arrayBuffer();
        tpl.basePdf = new Uint8Array(arrayBuffer);
        console.log("[PdfSignTest] basePdf resolved to Uint8Array, len:", tpl.basePdf.length);
      } else if (typeof tpl.basePdf === "string") {
        // base64
        const binary = atob(tpl.basePdf);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        tpl.basePdf = bytes;
        console.log("[PdfSignTest] basePdf decoded from base64, len:", bytes.length);
      }

      // 5. Wait for DOM
      await new Promise((r) => setTimeout(r, 200));
      if (!formRef.current) throw new Error("No container");

      // 6. Create Form (exact same pattern as PdfTestPage)
      const formOptions = {
        domContainer: formRef.current,
        template: tpl,
        inputs: [{}],
        plugins: getPlugins(),
        options: {
          ...(fontData ? { font: { Heebo: { data: fontData, fallback: true } } } : {}),
          labels: HEBREW_LABELS,
        },
      };

      console.log("[PdfSignTest] Creating Form...");
      formInstanceRef.current = new Form(formOptions);
      console.log("[PdfSignTest] Form created!");
      setStatus("ready");
    } catch (e) {
      console.error("[PdfSignTest] Error:", e);
      setError(e.message);
      setStatus("error");
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
      <h1>PDF Sign Test (Inline pdfme, API template)</h1>
      <p>Status: <strong>{status}</strong></p>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <div
        ref={formRef}
        style={{ width: "100%", height: "calc(100vh - 150px)", border: "1px solid #ccc", marginTop: 20, overflow: "hidden" }}
      />
    </div>
  );
}
