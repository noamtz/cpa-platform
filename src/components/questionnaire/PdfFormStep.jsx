import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Loader2, ChevronRight, ChevronDown, ChevronUp, Check, FileText } from "lucide-react";

import {
  loadPdfme,
  getPdfmeModules,
  getPlugins,
  getFontConfig,
  parseBasePdf,
  resolveBasePdf,
  validateRequiredFields,
  flattenInputs,
  buildAuditTrail,
  isSystemField,
  resolveSystemField,
  HEBREW_LABELS,
} from "@/lib/pdfme-config";

/**
 * PdfFormStep — Client fills a PDF form (checkboxes, signature).
 *
 * Props:
 * - pdfTemplate: the PdfTemplate entity record (with template_json)
 * - clientData: { full_name, email, phone, tax_year }
 * - existingInputs: previously saved inputs (from submission.pdf_inputs)
 * - onComplete: (pdfInputs: string, pdfBlob: Blob) => void
 * - onBack: () => void
 */
export default function PdfFormStep({
  pdfTemplate,
  clientData,
  existingInputs,
  onComplete,
  onBack,
  authContext, // { client_id, token, template_id } for secure file access
}) {
  const [mode, setMode] = useState("loading"); // loading → form → preview → generating → done
  const [loadingStep, setLoadingStep] = useState(""); // loading sub-status for UX
  const [error, setError] = useState(null);
  const [savedInputs, setSavedInputs] = useState(null);
  const [templateDataCache, setTemplateDataCache] = useState(null);
  const [signing, setSigning] = useState(false); // prevents double-click on סיום

  // Field navigation
  const [currentFieldIdx, setCurrentFieldIdx] = useState(-1);
  const [totalFields, setTotalFields] = useState(0);

  // Mobile "fill all fields" modal
  const [fieldsModal, setFieldsModal] = useState({ open: false, fields: [] });
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);

  // Listen for screen resize to update isMobile
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);



  const formContainerRef = useRef(null);
  const viewerContainerRef = useRef(null);
  const formInstanceRef = useRef(null);
  const viewerInstanceRef = useRef(null);
  const openFieldsModalRef = useRef(null);
  const signingRef = useRef(false); // mutable guard for double-click prevention

  useEffect(() => {
    if (!pdfTemplate) return;
    initForm();
    return () => {
      if (formInstanceRef.current) {
        formInstanceRef.current.destroy();
        formInstanceRef.current = null;
      }
      if (viewerInstanceRef.current) {
        viewerInstanceRef.current.destroy();
        viewerInstanceRef.current = null;
      }
    };
  }, [pdfTemplate]);

  const initForm = async () => {
    setMode("loading");
    try {
      setLoadingStep("מכין את מנוע הטפסים...");
      await loadPdfme();
      const { Form } = getPdfmeModules();
      const font = await getFontConfig();

      setLoadingStep("מוריד את הטופס...");
      const templateData = JSON.parse(pdfTemplate.template_json);
      templateData.basePdf = await resolveBasePdf(parseBasePdf(templateData.basePdf), authContext);
      setTemplateDataCache(templateData);

      // Build initial inputs from client data (auto-fill text fields)
      const initialInputs = existingInputs
        ? (typeof existingInputs === "string" ? JSON.parse(existingInputs) : existingInputs)
        : [{}];

      // Auto-fill known fields from client data
      if (clientData && templateData.schemas) {
        // Field mapping from template editor (CPA-configured data sources)
        const fMapping = templateData.fieldMapping || {};

        const autoFillMap = {
          full_name: clientData.full_name || "",
          email: clientData.email || "",
          phone: clientData.phone || "",
          tax_year: String(clientData.tax_year || 2024),
          id_number: clientData.id_number || "",
          today: new Date().toLocaleDateString("he-IL"),
          שם_מלא: clientData.full_name || "",
          אימייל: clientData.email || "",
          טלפון: clientData.phone || "",
          שנת_מס: String(clientData.tax_year || 2024),
        };

        // For each page (schema group), fill matching field names
        templateData.schemas.forEach((pageSchemas, pageIdx) => {
          if (!initialInputs[pageIdx]) initialInputs[pageIdx] = {};
          pageSchemas.forEach((field) => {
            // 1. Field mapping (CPA-configured via editor dropdown)
            const mappedSource = fMapping[field.name];
            if (mappedSource && autoFillMap[mappedSource] !== undefined) {
              const val = autoFillMap[mappedSource];
              initialInputs[pageIdx][field.name] = val;
              if (val) {
                // If we have data, lock it and set it as static content
                field.content = val;
                field.readOnly = true;
              } else {
                // If no data, clear the {placeholder} and let the client fill it
                field.content = "";
                field.readOnly = false;
              }
              return;
            }

            // 2. System fields (sys:xxx prefix) — fallback/legacy
            if (isSystemField(field.name)) {
              const sysValue = resolveSystemField(field.name, clientData);
              if (sysValue !== null) {
                initialInputs[pageIdx][field.name] = sysValue;
                field.content = sysValue; // also set content for readOnly
              }
              field.readOnly = true;
              return;
            }

            // 3. Regular auto-fill by name convention (editable)
            const key = field.name?.toLowerCase?.()?.replace(/\s+/g, "_");
            if (autoFillMap[key] && !initialInputs[pageIdx][field.name]) {
              initialInputs[pageIdx][field.name] = autoFillMap[key];
            }
          });
        });
      }

      // Deep clone template for Form (preserve basePdf Uint8Array)
      const formTemplate = {
        ...templateData,
        schemas: templateData.schemas.map((page) =>
          page.map((field) => ({ ...field }))
        ),
      };
      
      setTemplateDataCache(formTemplate);

      // Wait for container to be available
      setLoadingStep("מציג את הטופס...");
      await new Promise((r) => setTimeout(r, 150));

      if (!formContainerRef.current) {
        setError("שגיאה בטעינת הטופס");
        return;
      }

      const formOptions = {
        domContainer: formContainerRef.current,
        template: formTemplate,
        inputs: initialInputs,
        plugins: getPlugins(),
        options: {
          labels: HEBREW_LABELS,
        },
      };

      if (font) {
        formOptions.options.font = font;
      }

      formInstanceRef.current = new Form(formOptions);
      setMode("form");

      // Count fields for navigation
      setTimeout(() => {
        const fields = getFormFieldElements();
        setTotalFields(fields.length);
        setCurrentFieldIdx(-1);
      }, 500);
    } catch (e) {
      console.error("Failed to init PDF form:", e);
      setError("שגיאה בטעינת טופס ה-PDF");
    }
  };

  /**
   * MOBILE TEXT INPUT — "Fill Fields" Modal
   *
   * On mobile, instead of fighting pdfme's contenteditable keyboard issues,
   * we show a floating button that opens a full-screen modal with native
   * inputs for all text fields from the template schema. The user fills
   * them in comfortably, then we write the values back to pdfme.
   */
  const openFieldsModal = () => {
    if (!formInstanceRef.current || !templateDataCache) return;

    const currentInputs = formInstanceRef.current.getInputs();
    const fMapping = templateDataCache.fieldMapping || {};
    const fields = [];

    templateDataCache.schemas.forEach((pageSchemas, pageIdx) => {
      pageSchemas.forEach((field) => {
        // Skip fields that are actually locked/auto-filled
        if (field.readOnly) return;
        if (isSystemField(field.name)) return;
        // Include all text-like fields
        const type = field.type || "text";
        if (type === "text" || type === "multiVariableText" || type === "textarea") {
          fields.push({
            name: field.name,
            pageIdx,
            value: currentInputs[pageIdx]?.[field.name] || "",
            type,
            required: !!field.required,
          });
        }
      });
    });

    // If no editable text fields found, show a message rather than silently failing
    if (fields.length === 0) {
      alert("אין שדות טקסט הניתנים למילוי בטופס זה");
      return;
    }
    setFieldsModal({ open: true, fields });
  };
  // Keep ref in sync so event listeners always call the latest version
  openFieldsModalRef.current = openFieldsModal;

  const applyFieldsModal = () => {
    if (!formInstanceRef.current) return;

    const currentInputs = formInstanceRef.current.getInputs();
    const updatedInputs = currentInputs.map((page) => ({ ...page }));

    fieldsModal.fields.forEach(({ name, pageIdx, value }) => {
      if (!updatedInputs[pageIdx]) updatedInputs[pageIdx] = {};
      updatedInputs[pageIdx][name] = value;
    });

    formInstanceRef.current.setInputs(updatedInputs);
    setFieldsModal({ open: false, fields: [] });
  };

  const closeFieldsModal = () => {
    setFieldsModal({ open: false, fields: [] });
  };

  const updateFieldValue = (index, value) => {
    setFieldsModal((prev) => ({
      ...prev,
      fields: prev.fields.map((f, i) => (i === index ? { ...f, value } : f)),
    }));
  };

// ========== FIELD NAVIGATION ==========
const getFormFieldElements = useCallback(() => {
  const container = formContainerRef.current;
  if (!container) return [];
  const elements = container.querySelectorAll(
    '[contenteditable="true"], [contenteditable="plaintext-only"], [tabindex]:not([tabindex="-1"]), input, textarea, canvas[style*="cursor"]'
  );
  return Array.from(elements).filter((el) => {
    if (el.offsetParent === null) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 10 && rect.height >= 5;
  });
}, []);

const navigateToField = useCallback((direction) => {
  const fields = getFormFieldElements();
  if (fields.length === 0) return;
  setTotalFields(fields.length);

  const nextIdx = direction === "next"
    ? (currentFieldIdx + 1 >= fields.length ? 0 : currentFieldIdx + 1)
    : (currentFieldIdx - 1 < 0 ? fields.length - 1 : currentFieldIdx - 1);
  setCurrentFieldIdx(nextIdx);

  const el = fields[nextIdx];
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.focus();
  el.style.outline = "3px solid var(--primary, #e8763a)";
  el.style.outlineOffset = "2px";
  el.style.transition = "outline 0.3s ease";
  setTimeout(() => {
    el.style.outline = "";
    el.style.outlineOffset = "";
  }, 1500);
}, [currentFieldIdx, getFormFieldElements]);

const handlePreview = async () => {
  if (!formInstanceRef.current) return;

  const userInputs = formInstanceRef.current.getInputs();

  // Re-inject system auto-filled values that getInputs() may drop
  const templateData = templateDataCache || JSON.parse(pdfTemplate.template_json);
  const mergedInputs = userInputs.map((pageInputs, pageIdx) => {
    const merged = { ...pageInputs };
    const pageSchemas = templateData.schemas[pageIdx] || [];
    // Re-fill auto-fill fields from clientData
    if (clientData) {
      const autoFillMap = {
        full_name: clientData.full_name || "",
        email: clientData.email || "",
        phone: clientData.phone || "",
        tax_year: String(clientData.tax_year || 2024),
        שם_מלא: clientData.full_name || "",
        אימייל: clientData.email || "",
        טלפון: clientData.phone || "",
        שנת_מס: String(clientData.tax_year || 2024),
      };
      pageSchemas.forEach((field) => {
        const key = field.name?.toLowerCase?.()?.replace(/\s+/g, "_");
        if (autoFillMap[key] && !merged[field.name]) {
          merged[field.name] = autoFillMap[key];
        }
      });
    }
    return merged;
  });

  // Validate required fields before proceeding
  const missingFields = validateRequiredFields(templateData.schemas, mergedInputs);
  if (missingFields.length > 0) {
    alert(`שדות חובה לא מולאו:\n• ${missingFields.join("\n• ")}`);
    return;
  }

  setSavedInputs(mergedInputs);
  setMode("preview");

  await loadPdfme();
  const { Viewer } = getPdfmeModules();
  const font = await getFontConfig();

  // Wait for viewer container
  await new Promise((r) => setTimeout(r, 150));

  if (!viewerContainerRef.current) return;

  try {
    if (!templateDataCache) throw new Error("Template not loaded");
    const viewerTemplate = {
      ...templateDataCache,
      schemas: templateDataCache.schemas.map((page) => page.map((field) => ({ ...field })))
    };

    if (viewerInstanceRef.current) {
      viewerInstanceRef.current.destroy();
    }

    const viewerOptions = {
      domContainer: viewerContainerRef.current,
      template: viewerTemplate,
      inputs: flattenInputs(mergedInputs),
      plugins: getPlugins(),
      options: {
        labels: HEBREW_LABELS,
      },
    };

    if (font) {
      viewerOptions.options.font = font;
    }

    viewerInstanceRef.current = new Viewer(viewerOptions);
  } catch (e) {
    console.error("Failed to init viewer:", e);
    setError("שגיאה בהצגת תצוגה מקדימה");
  }
};

const handleApproveAndSign = async () => {
  if (!savedInputs) return;
  setMode("generating");

  try {
    await loadPdfme();
    const { generate } = getPdfmeModules();
    const font = await getFontConfig();

    if (!templateDataCache) throw new Error("Template not loaded");
    const templateData = {
      ...templateDataCache,
      schemas: templateDataCache.schemas.map((page) => page.map((field) => ({ ...field })))
    };

    const genOptions = {
      template: templateData,
      inputs: flattenInputs(savedInputs),
      plugins: getPlugins(),
    };

    if (font) {
      genOptions.options = { font };
    }

    const pdfBytes = await generate(genOptions);
    const blob = new Blob([pdfBytes.buffer], { type: "application/pdf" });

    // Build audit trail for legal defensibility
    const auditTrail = await buildAuditTrail(blob, {
      name: clientData?.full_name || "",
      email: clientData?.email || "",
      phone: clientData?.phone || "",
    });
    console.log("Audit trail:", auditTrail);

    // Callback to parent with the inputs, PDF blob, and audit trail
    if (onComplete) {
      await onComplete(JSON.stringify(savedInputs), blob, auditTrail);
    }

    setMode("done");
  } catch (e) {
    console.error("Failed to generate PDF:", e);
    setError("שגיאה ביצירת ה-PDF");
    setMode("preview"); // go back to preview
  }
};

const handleBackToForm = () => {
  if (viewerInstanceRef.current) {
    viewerInstanceRef.current.destroy();
    viewerInstanceRef.current = null;
  }
  setMode("form");
};

const handleDownloadPreview = async () => {
  if (!savedInputs) return;
  try {
    await loadPdfme();
    const { generate } = getPdfmeModules();
    if (!templateDataCache) return;
    const templateData = {
      ...templateDataCache,
      schemas: templateDataCache.schemas.map((page) => page.map((field) => ({ ...field })))
    };
    const font = await getFontConfig();
    const genOptions = { template: templateData, inputs: flattenInputs(savedInputs), plugins: getPlugins() };
    if (font) genOptions.options = { font };
    const pdfBytes = await generate(genOptions);
    const blob = new Blob([pdfBytes.buffer], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${pdfTemplate.name || "form"}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download failed:", e);
  }
};

/**
 * Direct sign — skips preview, gets inputs from form, validates, generates PDF
 */
const handleDirectSign = async () => {
  if (!formInstanceRef.current || signingRef.current) return;
  signingRef.current = true;
  setSigning(true);

  const userInputs = formInstanceRef.current.getInputs();
  const templateData = templateDataCache || JSON.parse(pdfTemplate.template_json);

  // Re-inject auto-filled values
  const mergedInputs = userInputs.map((pageInputs, pageIdx) => {
    const merged = { ...pageInputs };
    const pageSchemas = templateData.schemas[pageIdx] || [];
    if (clientData) {
      const autoFillMap = {
        full_name: clientData.full_name || "",
        email: clientData.email || "",
        phone: clientData.phone || "",
        tax_year: String(clientData.tax_year || 2024),
        שם_מלא: clientData.full_name || "",
        אימייל: clientData.email || "",
        טלפון: clientData.phone || "",
        שנת_מס: String(clientData.tax_year || 2024),
      };
      pageSchemas.forEach((field) => {
        const key = field.name?.toLowerCase?.()?.replace(/\s+/g, "_");
        if (autoFillMap[key] && !merged[field.name]) {
          merged[field.name] = autoFillMap[key];
        }
      });
    }
    return merged;
  });

  // Validate required fields — block if any are missing (no bypass allowed)
  const missingFields = validateRequiredFields(templateData.schemas, mergedInputs);
  if (missingFields.length > 0) {
    alert(`יש למלא את כל שדות החובה לפני השלמה:\n• ${missingFields.join("\n• ")}`);
    signingRef.current = false;
    setSigning(false);
    return;
  }

  setSavedInputs(mergedInputs);
  setMode("generating");

  try {
    await loadPdfme();
    const { generate } = getPdfmeModules();
    const font = await getFontConfig();

    if (!templateDataCache) throw new Error("Template not loaded");
    const genTemplate = {
      ...templateDataCache,
      schemas: templateDataCache.schemas.map((page) => page.map((field) => ({ ...field })))
    };

    const genOptions = {
      template: genTemplate,
      inputs: flattenInputs(mergedInputs),
      plugins: getPlugins(),
    };
    if (font) genOptions.options = { font };

    const pdfBytes = await generate(genOptions);
    const blob = new Blob([pdfBytes.buffer], { type: "application/pdf" });

    const auditTrail = await buildAuditTrail(blob, {
      name: clientData?.full_name || "",
      email: clientData?.email || "",
      phone: clientData?.phone || "",
    });

    if (onComplete) {
      await onComplete(JSON.stringify(mergedInputs), blob, auditTrail);
    }
    setMode("done");
    signingRef.current = false;
    setSigning(false);
  } catch (e) {
    console.error("Failed to generate PDF:", e);
    setError("שגיאה ביצירת ה-PDF");
    setMode("form");
    signingRef.current = false;
    setSigning(false);
  }
};



if (error) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="bg-white rounded-3xl p-8 border border-border shadow-sm text-center"
    >
      <div className="text-4xl mb-3">😕</div>
      <h3 className="text-lg font-bold text-foreground mb-2">שגיאה</h3>
      <p className="text-muted-foreground mb-4">{error}</p>
      {onBack && (
        <Button onClick={onBack} variant="outline" className="rounded-xl">
          <ChevronRight className="w-4 h-4 ml-1" />
          חזרה
        </Button>
      )}
    </motion.div>
  );
}

const isFullscreen = mode === "form";

return (
  <>
    {/* ===== FULL-PAGE FORM — takes over entire viewport ===== */}
    <div
      className="bg-background flex flex-col"
      dir="rtl"
      style={{
        display: isFullscreen ? "flex" : "none",
        height: "100dvh",
        width: "100vw",
        position: "fixed",
        top: 0,
        left: 0,
        zIndex: 50,
      }}
    >
      {/* Compact top bar with Done button */}
      <div
        className="bg-white border-b border-border px-3 py-3 flex items-center gap-2 flex-shrink-0 relative z-10"
        style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {pdfTemplate.name || "טופס לחתימה"}
          </p>
          <p className="text-xs text-muted-foreground">מלאו את השדות וחתמו</p>
        </div>
        <Button
          onClick={openFieldsModal}
          size="sm"
          variant="outline"
          className="border-primary text-primary rounded-xl px-3 h-11 text-sm font-semibold gap-1.5"
        >
          📝 מילוי שדות
        </Button>
        <Button
          onClick={handleDirectSign}
          size="sm"
          disabled={signing}
          className="bg-green-600 hover:bg-green-700 text-white rounded-xl px-5 h-11 text-sm font-semibold gap-1.5 shadow-sm disabled:opacity-50"
        >
          {signing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
          סיום
        </Button>
      </div>

      {/* Form container — ALWAYS in the DOM, pdfme attaches once during init */}
      <div
        ref={formContainerRef}
        style={{
          display: mode === "form" ? "block" : "none",
          direction: "ltr",
          isolation: "isolate",
          position: "relative",
          zIndex: 0,
        }}
        className="flex-1 overflow-hidden"
      />

        {/* Desktop: floating field navigation */}
        {mode === "form" && !isMobile && totalFields > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 bg-white border-2 border-border rounded-2xl px-3 py-2 shadow-lg" dir="rtl">
            <button
              onClick={() => navigateToField("prev")}
              className="p-2 rounded-xl border border-border hover:bg-muted transition-colors"
              title="שדה קודם"
            >
              <ChevronUp className="w-4 h-4 text-muted-foreground" />
            </button>
            <span className="text-sm font-bold text-foreground px-2 min-w-[40px] text-center">
              {currentFieldIdx >= 0 ? currentFieldIdx + 1 : "—"}/{totalFields}
            </span>
            <button
              onClick={() => navigateToField("next")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
              title="שדה הבא"
            >
              <ChevronDown className="w-4 h-4" />
              שדה הבא
            </button>
          </div>
        )}

        {/* ===== MOBILE FIELDS MODAL ===== */}
        {fieldsModal.open && (
          <div className="fixed inset-0 z-[70] bg-black/50 flex items-end justify-center">
            <div
              className="bg-white w-full max-w-lg rounded-t-2xl flex flex-col max-h-[85vh]"
              dir="rtl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
                <h3 className="text-base font-bold text-foreground">📝 מילוי שדות</h3>
                <button
                  onClick={closeFieldsModal}
                  className="text-muted-foreground hover:text-foreground text-lg px-2"
                >
                  ✕
                </button>
              </div>

              {/* Scrollable fields */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                {fieldsModal.fields.map((field, idx) => (
                  <div key={`${field.pageIdx}-${field.name}`}>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {field.name}
                      {field.required && <span className="text-red-500 mr-1">*</span>}
                    </label>
                    <input
                      type="text"
                      value={field.value}
                      onChange={(e) => updateFieldValue(idx, e.target.value)}
                      className="w-full border border-border rounded-xl px-4 py-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-primary bg-muted/30"
                      dir="auto"
                      placeholder={`הזינו ${field.name}`}
                    />
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2 px-4 py-3 border-t border-border flex-shrink-0">
                <Button
                  onClick={closeFieldsModal}
                  variant="outline"
                  className="flex-1 rounded-xl h-11"
                >
                  ביטול
                </Button>
                <Button
                  onClick={applyFieldsModal}
                  className="flex-1 bg-primary text-white rounded-xl h-11 font-semibold"
                >
                  החל שינויים
                </Button>
              </div>
            </div>
          </div>
        )}


    </div>

    {/* ===== INLINE CONTENT — loading, generating, done ===== */}
    {!isFullscreen && (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        {/* Title card */}
        <div className="bg-white rounded-3xl p-5 border border-border shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <FileText className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">{pdfTemplate.name || "טופס לחתימה"}</h2>
              <p className="text-xs text-muted-foreground">
                {mode === "generating" && "יוצר PDF..."}
                {mode === "done" && "הטופס נחתם בהצלחה!"}
                {mode === "loading" && "טוען..."}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 mt-3">
            {["form", "preview", "done"].map((step, i) => (
              <div
                key={step}
                className={`h-2 rounded-full transition-all ${(mode === step || (mode === "generating" && step === "done"))
                  ? "w-8 bg-primary"
                  : (["form", "preview", "done"].indexOf(mode) > i || mode === "done")
                    ? "w-2 bg-primary/40"
                    : "w-2 bg-muted"
                  }`}
              />
            ))}
          </div>
        </div>

        {/* Loading */}
        {mode === "loading" && (
          <div className="flex items-center justify-center py-16">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{loadingStep || "טוען טופס..."}</p>
              <p className="text-muted-foreground/60 text-xs mt-2">הטעינה עשויה לקחת מספר שניות</p>
            </div>
          </div>
        )}

        {/* Generating */}
        {mode === "generating" && (
          <div className="bg-white rounded-3xl p-12 border border-border shadow-sm text-center">
            <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto mb-4" />
            <p className="text-foreground font-semibold">יוצר את ה-PDF הסופי...</p>
            <p className="text-sm text-muted-foreground mt-1">אנא המתינו</p>
          </div>
        )}

        {/* Done */}
        {mode === "done" && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-3xl p-8 border border-border shadow-sm text-center"
          >
            <>
              <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">הטופס נחתם בהצלחה! ✅</h3>
              <p className="text-muted-foreground mb-4">הטופס נשמר ויועבר לרואה החשבון</p>
            </>
          </motion.div>
        )}
      </motion.div>
    )}
  </>
);
}
