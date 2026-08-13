import React, { useState, useEffect, useRef, useCallback } from "react";

/**
 * Standalone PDF test page — no server, no auth, no Base44.
 * Tests the full CPA → System → Client flow:
 * 1. Designer: CPA uploads PDF and marks fields
 * 2. Field Mapping: CPA assigns each field as "system" or "client"
 * 3. Form: Client sees pre-filled system fields + fills their own
 * 4. Viewer: Preview + download final PDF
 */

// Lazy-loaded pdfme modules
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

/** Load Heebo font for Hebrew support */
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

function getFontOptions(fontData) {
  if (!fontData) return {};
  return {
    font: {
      Heebo: { data: fontData, fallback: true },
    },
  };
}

// Hebrew i18n labels for pdfme Designer/Form sidebar
const HEBREW_LABELS = {
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


// ========== SYSTEM FIELD OPTIONS ==========
const SYSTEM_FIELDS = [
  { value: "", label: "— בחרו —" },
  { value: "full_name", label: "שם מלא" },
  { value: "id_number", label: "ת.ז." },
  { value: "email", label: "אימייל" },
  { value: "phone", label: "טלפון" },
  { value: "tax_year", label: "שנת מס" },
  { value: "address", label: "כתובת" },
  { value: "date_today", label: "תאריך היום" },
  { value: "cpa_name", label: "שם רו\"ח" },
  { value: "cpa_license", label: "מס׳ רישיון רו\"ח" },
];

// Mock system data (in production, comes from Client + CPA entities)
const MOCK_SYSTEM_DATA = {
  full_name: "ישראל ישראלי",
  id_number: "012345678",
  email: "israel@example.com",
  phone: "050-1234567",
  tax_year: "2025",
  address: "רחוב הרצל 1, תל אביב",
  date_today: new Date().toLocaleDateString("he-IL"),
  cpa_name: "אברהם כהן, רו\"ח",
  cpa_license: "30563599",
};

function PdfTestPage() {
  const [tab, setTab] = useState("designer");
  const [loading, setLoading] = useState(true);
  const [savedTemplate, setSavedTemplate] = useState(null);
  const [savedInputs, setSavedInputs] = useState(null);
  const [statusMsg, setStatusMsg] = useState("");

  // Field mapping: { fieldName: { role: "system"|"client", systemKey: "full_name"|"" } }
  const [fieldMapping, setFieldMapping] = useState({});

  // Field navigation state
  const [currentFieldIdx, setCurrentFieldIdx] = useState(-1);
  const [totalFields, setTotalFields] = useState(0);

  const designerContainerRef = useRef(null);
  const formContainerRef = useRef(null);
  const viewerContainerRef = useRef(null);
  const designerRef = useRef(null);
  const formRef = useRef(null);
  const viewerRef = useRef(null);

  // Load pdfme + font on mount
  useEffect(() => {
    Promise.all([loadPdfme(), loadHeeboFont()]).then(() => {
      setLoading(false);
    }).catch((e) => {
      console.error("Failed to load pdfme:", e);
      setStatusMsg("שגיאה בטעינת pdfme: " + e.message);
    });
  }, []);

  // Init designer when tab switches to it and pdfme is loaded
  useEffect(() => {
    if (loading || tab !== "designer") return;
    if (designerRef.current) return;

    setTimeout(() => {
      const container = designerContainerRef.current;
      if (!container) return;

      const template = savedTemplate || {
        basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
        schemas: [[]],
      };

      designerRef.current = new Designer({
        domContainer: container,
        template,
        plugins: getPlugins(),
        options: {
          theme: { token: { colorPrimary: "#e8763a" } },
          labels: HEBREW_LABELS,
          ...getFontOptions(heeboFontData),
        },
      });
    }, 100);
  }, [loading, tab]);

  // ========== DESIGNER HANDLERS ==========
  const handleUploadPdf = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const pdfData = new Uint8Array(ev.target.result);
        if (designerRef.current) {
          const tpl = designerRef.current.getTemplate();
          designerRef.current.updateTemplate({ ...tpl, basePdf: pdfData });
        }
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  };

  const handleSaveTemplate = () => {
    if (!designerRef.current) return;
    const tpl = designerRef.current.getTemplate();
    setSavedTemplate(tpl);

    // Extract all field names and create default mapping
    const newMapping = {};
    tpl.schemas.forEach((pageSchemas) => {
      pageSchemas.forEach((field) => {
        if (!fieldMapping[field.name]) {
          // Auto-detect role from field type
          const fieldType = field.type || "";
          if (fieldType === "signature" || fieldType === "checkbox") {
            newMapping[field.name] = { role: "client", systemKey: "" };
          } else {
            newMapping[field.name] = { role: "system", systemKey: "" };
          }
        } else {
          newMapping[field.name] = fieldMapping[field.name];
        }
      });
    });
    setFieldMapping(newMapping);
    setTab("mapping");
    setStatusMsg("✅ תבנית נשמרה! הגדירו את סוג כל שדה");
  };

  // ========== FIELD MAPPING HANDLERS ==========
  const updateFieldRole = (fieldName, role) => {
    setFieldMapping((prev) => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], role, systemKey: role === "client" ? "" : prev[fieldName]?.systemKey || "" },
    }));
  };

  const updateFieldSystemKey = (fieldName, systemKey) => {
    setFieldMapping((prev) => ({
      ...prev,
      [fieldName]: { ...prev[fieldName], systemKey },
    }));
  };

  // ========== FIELD NAVIGATION ==========
  /**
   * Find all interactive field elements inside the pdfme Form container.
   * pdfme renders text fields with [contenteditable], checkboxes/signatures with
   * [tabindex], and some fields as <input> or <canvas>.
   */
  const getFormFieldElements = useCallback(() => {
    const container = formContainerRef.current;
    if (!container) return [];
    // Query all interactive elements that pdfme renders for form fields
    const elements = container.querySelectorAll(
      '[contenteditable="true"], [contenteditable="plaintext-only"], [tabindex]:not([tabindex="-1"]), input, textarea, canvas[style*="cursor"]'
    );
    // Filter out elements that are part of the toolbar/chrome, not actual fields
    return Array.from(elements).filter((el) => {
      // Must be visible
      if (el.offsetParent === null) return false;
      // Must have reasonable size (not tiny UI buttons)
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 5) return false;
      return true;
    });
  }, []);

  const handleNextField = useCallback(() => {
    const fields = getFormFieldElements();
    if (fields.length === 0) return;

    setTotalFields(fields.length);
    const nextIdx = currentFieldIdx + 1 >= fields.length ? 0 : currentFieldIdx + 1;
    setCurrentFieldIdx(nextIdx);

    const el = fields[nextIdx];
    if (!el) return;

    // Scroll into view
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Focus the element
    el.focus();

    // Add highlight effect
    el.style.outline = "3px solid #e8763a";
    el.style.outlineOffset = "2px";
    el.style.transition = "outline 0.3s ease";
    setTimeout(() => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    }, 1500);
  }, [currentFieldIdx, getFormFieldElements]);

  const handlePrevField = useCallback(() => {
    const fields = getFormFieldElements();
    if (fields.length === 0) return;

    setTotalFields(fields.length);
    const prevIdx = currentFieldIdx - 1 < 0 ? fields.length - 1 : currentFieldIdx - 1;
    setCurrentFieldIdx(prevIdx);

    const el = fields[prevIdx];
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.focus();

    el.style.outline = "3px solid #e8763a";
    el.style.outlineOffset = "2px";
    el.style.transition = "outline 0.3s ease";
    setTimeout(() => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    }, 1500);
  }, [currentFieldIdx, getFormFieldElements]);

  // Reset field index when form is loaded
  const resetFieldNav = () => {
    setCurrentFieldIdx(-1);
    setTotalFields(0);
  };

  // ========== FORM HANDLERS ==========
  const handleLoadForm = () => {
    if (!savedTemplate) {
      alert("יש ליצור תבנית קודם");
      return;
    }

    if (formRef.current) {
      formRef.current.destroy();
      formRef.current = null;
    }

    setTimeout(() => {
      const container = formContainerRef.current;
      if (!container) return;
      container.innerHTML = "";

      // Build inputs: system fields pre-filled, client fields empty
      const inputs = [{}];
      savedTemplate.schemas.forEach((pageSchemas, pageIdx) => {
        if (!inputs[pageIdx]) inputs[pageIdx] = {};
        pageSchemas.forEach((field) => {
          const mapping = fieldMapping[field.name];
          if (mapping?.role === "system" && mapping.systemKey) {
            inputs[pageIdx][field.name] = MOCK_SYSTEM_DATA[mapping.systemKey] || "";
          }
          // client fields left empty for user to fill
        });
      });

      // Clone template but preserve basePdf (Uint8Array can't survive JSON.stringify)
      const clientTemplate = {
        ...savedTemplate,
        schemas: JSON.parse(JSON.stringify(savedTemplate.schemas)),
      };
      clientTemplate.schemas.forEach((pageSchemas) => {
        pageSchemas.forEach((field) => {
          const mapping = fieldMapping[field.name];
          if (mapping?.role === "system") {
            field.readOnly = true;
          }
        });
      });

      formRef.current = new Form({
        domContainer: container,
        template: clientTemplate,
        inputs,
        plugins: getPlugins(),
        options: getFontOptions(heeboFontData),
      });

      setStatusMsg("✅ טופס נטען — שדות מערכת ממולאים, מלאו את שדות הלקוח");
      resetFieldNav();
      // Count fields after DOM settles
      setTimeout(() => {
        const fields = getFormFieldElements();
        setTotalFields(fields.length);
      }, 500);
    }, 100);
  };

  const handleGetInputs = () => {
    if (!formRef.current) {
      alert("יש לטעון טופס קודם");
      return;
    }
    const userInputs = formRef.current.getInputs();

    // Merge system-filled values back in (getInputs() may drop readOnly fields)
    const mergedInputs = userInputs.map((pageInputs, pageIdx) => {
      const merged = { ...pageInputs };
      const pageSchemas = savedTemplate.schemas[pageIdx] || [];
      pageSchemas.forEach((field) => {
        const mapping = fieldMapping[field.name];
        if (mapping?.role === "system" && mapping.systemKey && !merged[field.name]) {
          merged[field.name] = MOCK_SYSTEM_DATA[mapping.systemKey] || "";
        }
      });
      return merged;
    });

    // Debug: log what getInputs() actually returned
    console.log("Raw getInputs():", JSON.stringify(userInputs, null, 2));
    console.log("Merged inputs:", JSON.stringify(mergedInputs, null, 2));

    // Validate required fields — search ALL input pages for each field
    // (pdfme may not align page indices with schema page indices)
    const missingFields = [];
    savedTemplate.schemas.forEach((pageSchemas) => {
      pageSchemas.forEach((field) => {
        if (field.required) {
          // Search across all pages for this field's value
          const found = mergedInputs.some((pageInputs) => {
            const val = pageInputs?.[field.name];
            return val && (typeof val !== "string" || val.trim() !== "");
          });
          if (!found) {
            missingFields.push(field.name);
          }
        }
      });
    });

    if (missingFields.length > 0) {
      alert(`שדות חובה לא מולאו:\n• ${missingFields.join("\n• ")}`);
      setStatusMsg(`❌ ${missingFields.length} שדות חובה לא מולאו`);
      return;
    }

    setSavedInputs(mergedInputs);
    setStatusMsg("✅ תשובות נשמרו! עברו ללשונית תצוגה מקדימה");
    console.log("Final merged inputs:", mergedInputs);
    alert("תשובות נשמרו! עברו ללשונית 'תצוגה מקדימה'");
  };

  // ========== VIEWER HANDLERS ==========

  /**
   * pdfme treats each entry in `inputs[]` as a separate document to generate.
   * For a multi-page PDF, ALL field values must be in ONE object.
   * If we have [{field1:"a"}, {field2:"b"}], pdfme generates the PDF twice → doubled pages.
   * Fix: merge into [{field1:"a", field2:"b"}].
   */
  const flattenInputs = (inputs) => {
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
  };

  const handleLoadViewer = () => {
    if (!savedTemplate || !savedInputs) {
      alert("יש למלא טופס קודם");
      return;
    }

    if (viewerRef.current) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }

    setTimeout(() => {
      const container = viewerContainerRef.current;
      if (!container) return;
      container.innerHTML = "";

      viewerRef.current = new Viewer({
        domContainer: container,
        template: savedTemplate,
        inputs: flattenInputs(savedInputs),
        plugins: getPlugins(),
        options: getFontOptions(heeboFontData),
      });

      setStatusMsg("✅ תצוגה מקדימה — כך ייראה ה-PDF");
    }, 100);
  };

  const handleDownloadPdf = async () => {
    if (!savedTemplate || !savedInputs) {
      alert("יש למלא טופס קודם");
      return;
    }
    try {
      const pdf = await generate({
        template: savedTemplate,
        inputs: flattenInputs(savedInputs),
        plugins: getPlugins(),
        options: getFontOptions(heeboFontData),
      });
      const blob = new Blob([pdf.buffer], { type: "application/pdf" });

      // Generate audit trail
      const hashBuffer = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      const pdfHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0")).join("");

      let signerIp = "unknown";
      try {
        const ipRes = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(3000) });
        if (ipRes.ok) signerIp = (await ipRes.json()).ip || "unknown";
      } catch { /* optional */ }

      const auditTrail = {
        signed_at: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        signer_ip: signerIp,
        user_agent: navigator.userAgent,
        screen_resolution: `${screen.width}x${screen.height}`,
        pdf_hash_sha256: pdfHash,
        pdf_size_bytes: blob.size,
        signature_method: "pdfme_canvas_draw",
        audit_version: "1.0",
      };

      console.log("📋 Audit Trail:", auditTrail);
      console.table(auditTrail);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "signed-form.pdf";
      a.click();
      URL.revokeObjectURL(url);
      setStatusMsg(`✅ PDF הורד! Hash: ${pdfHash.substring(0, 16)}… | IP: ${signerIp}`);
    } catch (e) {
      console.error("PDF generation failed:", e);
      alert("שגיאה ביצירת PDF: " + e.message);
    }
  };

  // ========== EXTRACT FIELDS FROM TEMPLATE ==========
  const getAllFields = () => {
    if (!savedTemplate) return [];
    const fields = [];
    savedTemplate.schemas.forEach((pageSchemas, pageIdx) => {
      pageSchemas.forEach((field) => {
        fields.push({
          name: field.name,
          type: field.type || "text",
          page: pageIdx + 1,
        });
      });
    });
    return fields;
  };

  // ========== RENDER ==========
  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.header}>
          <div style={styles.logo}>₪</div>
          <div>
            <h1 style={styles.title}>בדיקת טפסי PDF</h1>
            <p style={styles.subtitle}>טוען...</p>
          </div>
        </div>
        <div style={styles.loading}>
          <div style={styles.spinner} />
          <span>טוען pdfme...</span>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: "designer", label: "1. 📐 עורך" },
    { id: "mapping", label: "2. 🏷️ מיפוי שדות" },
    { id: "form", label: "3. ✍️ טופס" },
    { id: "viewer", label: "4. 👁️ תצוגה" },
  ];

  const allFields = getAllFields();
  const systemCount = allFields.filter((f) => fieldMapping[f.name]?.role === "system").length;
  const clientCount = allFields.filter((f) => fieldMapping[f.name]?.role === "client").length;

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>₪</div>
        <div>
          <h1 style={styles.title}>בדיקת טפסי PDF</h1>
          <p style={styles.subtitle}>מצב בדיקה — ללא שרת</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              ...styles.tab,
              ...(tab === t.id ? styles.tabActive : {}),
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Status */}
      {statusMsg && <div style={styles.container}><div style={styles.status}>{statusMsg}</div></div>}

      {/* ===== 1. DESIGNER ===== */}
      <div style={{ display: tab === "designer" ? "block" : "none" }}>
        <div style={styles.container}>
          <div style={styles.info}>
            📐 <strong>שלב 1 — עורך (רו"ח):</strong> העלו PDF → הוסיפו שדות (Text, Checkbox, Signature) → שמרו.
          </div>
          <div style={styles.controls}>
            <button style={styles.btnOutline} onClick={handleUploadPdf}>📄 העלאת PDF</button>
            <button style={styles.btnPrimary} onClick={handleSaveTemplate}>💾 שמור ועבור למיפוי</button>
          </div>
        </div>
        <div ref={designerContainerRef} style={{ width: "100%", height: "calc(100vh - 250px)", direction: "ltr", overflow: "hidden" }} />
      </div>

      {/* ===== 2. FIELD MAPPING ===== */}
      {tab === "mapping" && (
        <div style={styles.container}>
          <div style={styles.info}>
            🏷️ <strong>שלב 2 — מיפוי שדות:</strong> לכל שדה, קבעו אם ממולא ע"י המערכת (אוטומטית) או ע"י הלקוח.
          </div>

          {allFields.length === 0 ? (
            <div style={{ ...styles.editorContainer, display: "flex", alignItems: "center", justifyContent: "center", padding: 40 }}>
              <span style={{ color: "#888" }}>אין שדות בתבנית — חזרו לעורך והוסיפו שדות</span>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                <div style={{ ...styles.badge, background: "#ebf8ff", color: "#2b6cb0", borderColor: "#bee3f8" }}>
                  🔧 מערכת: {systemCount}
                </div>
                <div style={{ ...styles.badge, background: "#fef3ec", color: "#c05621", borderColor: "#fbd38d" }}>
                  👤 לקוח: {clientCount}
                </div>
                <div style={{ ...styles.badge, background: "#f7fafc", color: "#718096", borderColor: "#e2e8f0" }}>
                  סה"כ: {allFields.length}
                </div>
              </div>

              {/* Field list */}
              <div style={{ background: "white", border: "1px solid #e8dfd4", borderRadius: 16, overflow: "hidden" }}>
                {allFields.map((field, idx) => {
                  const mapping = fieldMapping[field.name] || { role: "client", systemKey: "" };
                  const isSystem = mapping.role === "system";
                  return (
                    <div
                      key={field.name + idx}
                      style={{
                        padding: "14px 18px",
                        borderBottom: idx < allFields.length - 1 ? "1px solid #f0ebe3" : "none",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        background: isSystem ? "#f0f9ff" : "white",
                      }}
                    >
                      {/* Field info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 14, color: "#2d3748" }}>{field.name}</div>
                        <div style={{ fontSize: 11, color: "#a0aec0" }}>
                          {field.type} • עמוד {field.page}
                        </div>
                      </div>

                      {/* Role toggle */}
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          onClick={() => updateFieldRole(field.name, "system")}
                          style={{
                            ...styles.roleBtn,
                            ...(isSystem ? styles.roleBtnSystemActive : {}),
                          }}
                        >
                          🔧 מערכת
                        </button>
                        <button
                          onClick={() => updateFieldRole(field.name, "client")}
                          style={{
                            ...styles.roleBtn,
                            ...(!isSystem ? styles.roleBtnClientActive : {}),
                          }}
                        >
                          👤 לקוח
                        </button>
                      </div>

                      {/* System field selector */}
                      {isSystem && (
                        <select
                          value={mapping.systemKey || ""}
                          onChange={(e) => updateFieldSystemKey(field.name, e.target.value)}
                          style={styles.select}
                        >
                          {SYSTEM_FIELDS.map((sf) => (
                            <option key={sf.value} value={sf.value}>{sf.label}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Continue button */}
              <div style={{ marginTop: 16 }}>
                <button
                  style={styles.btnPrimary}
                  onClick={() => {
                    setTab("form");
                    setStatusMsg("✅ מיפוי נשמר! לחצו 'טען טופס' לראות את התוצאה");
                  }}
                >
                  ✅ סיום מיפוי → עבור לטופס
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===== 3. FORM ===== */}
      <div style={{ ...styles.container, display: tab === "form" ? "block" : "none" }}>
        <div style={styles.info}>
          ✍️ <strong>שלב 3 — טופס (צד לקוח):</strong> שדות מערכת ממולאים אוטומטית. הלקוח ממלא צ'קבוקסים, חותם, ומשלים שדות.
        </div>
        <div style={styles.controls}>
          <button style={styles.btnPrimary} onClick={handleLoadForm}>🔄 טען טופס</button>
          <button style={styles.btnGreen} onClick={handleGetInputs}>✅ קבל תשובות</button>
        </div>
        <div ref={formContainerRef} style={{ ...styles.editorContainer, direction: "ltr", position: "relative" }}>
          {!savedTemplate && (
            <div style={styles.loading}><span>יש ליצור תבנית קודם</span></div>
          )}
        </div>

        {/* Floating field navigation */}
        {formRef.current && (
          <div style={styles.fieldNav}>
            <button
              onClick={handlePrevField}
              style={styles.fieldNavBtn}
              title="שדה קודם"
            >
              ↑
            </button>
            <div style={styles.fieldNavCounter}>
              {currentFieldIdx >= 0 ? currentFieldIdx + 1 : "—"}/{totalFields}
            </div>
            <button
              onClick={handleNextField}
              style={{ ...styles.fieldNavBtn, ...styles.fieldNavBtnPrimary }}
              title="שדה הבא"
            >
              ↓ שדה הבא
            </button>
          </div>
        )}
      </div>

      {/* ===== 4. VIEWER ===== */}
      <div style={{ ...styles.container, display: tab === "viewer" ? "block" : "none" }}>
        <div style={styles.info}>
          👁️ <strong>שלב 4 — תצוגה מקדימה:</strong> כך ייראה ה-PDF הסופי.
        </div>
        <div style={styles.controls}>
          <button style={styles.btnPrimary} onClick={handleLoadViewer}>🔄 טען תצוגה</button>
          <button style={styles.btnGreen} onClick={handleDownloadPdf}>📥 הורד PDF</button>
        </div>
        <div ref={viewerContainerRef} style={{ ...styles.editorContainer, direction: "ltr" }}>
          {!savedInputs && (
            <div style={styles.loading}><span>יש למלא טופס קודם</span></div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { fontFamily: "'Heebo', sans-serif", background: "#f8f5f0", minHeight: "100vh", direction: "rtl" },
  header: { background: "white", borderBottom: "1px solid #e8dfd4", padding: "12px 24px", display: "flex", alignItems: "center", gap: "12px", position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" },
  logo: { width: 36, height: 36, background: "#e8763a", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontWeight: "bold", fontSize: 18 },
  title: { fontSize: 18, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 12, color: "#888", margin: 0 },
  tabs: { display: "flex", gap: 6, padding: "16px 24px", maxWidth: 1100, margin: "0 auto", flexWrap: "wrap" },
  tab: { padding: "8px 16px", borderRadius: 10, border: "2px solid #e8dfd4", background: "white", cursor: "pointer", fontFamily: "'Heebo', sans-serif", fontSize: 13, fontWeight: 600, transition: "all 0.2s" },
  tabActive: { borderColor: "#e8763a", background: "#fef3ec", color: "#e8763a" },
  container: { maxWidth: 1100, margin: "0 auto", padding: "0 24px 24px" },
  info: { background: "#ebf8ff", border: "1px solid #bee3f8", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#2b6cb0" },
  status: { background: "#f0fff4", border: "1px solid #c6f6d5", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#276749" },
  controls: { display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" },
  btnPrimary: { padding: "10px 20px", borderRadius: 12, border: "none", background: "#e8763a", color: "white", cursor: "pointer", fontFamily: "'Heebo', sans-serif", fontSize: 14, fontWeight: 600 },
  btnOutline: { padding: "10px 20px", borderRadius: 12, border: "2px solid #e8dfd4", background: "white", color: "#2d3748", cursor: "pointer", fontFamily: "'Heebo', sans-serif", fontSize: 14, fontWeight: 600 },
  btnGreen: { padding: "10px 20px", borderRadius: 12, border: "none", background: "#38a169", color: "white", cursor: "pointer", fontFamily: "'Heebo', sans-serif", fontSize: 14, fontWeight: 600 },
  editorContainer: { background: "white", border: "1px solid #e8dfd4", borderRadius: 16, overflow: "hidden", minHeight: 600 },
  loading: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400, color: "#888", flexDirection: "column", gap: 12 },
  spinner: { width: 40, height: 40, border: "4px solid #e8dfd4", borderTopColor: "#e8763a", borderRadius: "50%", animation: "spin 1s linear infinite" },
  badge: { padding: "6px 14px", borderRadius: 8, border: "1px solid", fontSize: 13, fontWeight: 600 },
  roleBtn: { padding: "6px 12px", borderRadius: 8, border: "2px solid #e2e8f0", background: "white", cursor: "pointer", fontFamily: "'Heebo', sans-serif", fontSize: 12, fontWeight: 600, color: "#718096", transition: "all 0.15s" },
  roleBtnSystemActive: { borderColor: "#3182ce", background: "#ebf8ff", color: "#2b6cb0" },
  roleBtnClientActive: { borderColor: "#dd6b20", background: "#fef3ec", color: "#c05621" },
  select: { padding: "6px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontFamily: "'Heebo', sans-serif", fontSize: 12, direction: "rtl", minWidth: 120 },
  // Field navigation floating bar
  fieldNav: {
    position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
    display: "flex", alignItems: "center", gap: 8,
    background: "white", border: "2px solid #e8dfd4", borderRadius: 16,
    padding: "8px 12px", boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    zIndex: 200, fontFamily: "'Heebo', sans-serif", direction: "rtl",
  },
  fieldNavBtn: {
    padding: "8px 14px", borderRadius: 10, border: "2px solid #e2e8f0",
    background: "white", cursor: "pointer", fontFamily: "'Heebo', sans-serif",
    fontSize: 13, fontWeight: 600, color: "#718096", transition: "all 0.15s",
    display: "flex", alignItems: "center", gap: 4,
  },
  fieldNavBtnPrimary: {
    background: "#e8763a", color: "white", borderColor: "#e8763a",
  },
  fieldNavCounter: {
    fontSize: 13, fontWeight: 700, color: "#4a5568",
    padding: "0 8px", minWidth: 40, textAlign: "center",
  },
};

export default PdfTestPage;
