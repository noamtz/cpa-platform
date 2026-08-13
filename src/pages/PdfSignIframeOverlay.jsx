import React, { useState, useEffect, useRef } from "react";
import * as Sentry from "@sentry/react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { Loader2, ChevronRight, CheckCircle2, AlertCircle, Edit, Trash2, X, ClipboardEdit } from "lucide-react";
import { Button } from "@/components/ui/button";
import LightweightSignaturePad from "@/components/questionnaire/LightweightSignaturePad";

const PDF_API_PROD = "https://hickopn9f0.execute-api.il-central-1.amazonaws.com";
const PDF_API_TEST = "https://mr8yrlc9ic.execute-api.il-central-1.amazonaws.com";
const PDF_API = import.meta.env.VITE_PDF_API_URL
  || (window.location.hostname === "app.ddcpa.co.il" ? PDF_API_PROD : PDF_API_TEST);

// ─── Base44 Helpers ─────────────────────────────────────────────────────────
const callFunction = async (name, payload) => {
  const appId = import.meta.env.VITE_BASE44_APP_ID;
  const res = await fetch(`/api/apps/${appId}/functions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${name} failed with ${res.status}`);
  }
  return res.json();
};

function normalizeFieldName(name) {
  if (!name) return "";
  return name.replace(/\s+copy(?:\s+\d+)?$/i, "").trim();
}

function buildAutoFillMap(clientData) {
  return {
    full_name: clientData?.full_name || "",
    email: clientData?.email || "",
    phone: clientData?.phone || "",
    tax_year: String(clientData?.tax_year || new Date().getFullYear() - 1),
    id_number: clientData?.id_number || "",
    today: new Date().toLocaleDateString("he-IL"),
    שם_מלא: clientData?.full_name || "",
    אימייל: clientData?.email || "",
    טלפון: clientData?.phone || "",
    שנת_מס: String(clientData?.tax_year || new Date().getFullYear() - 1),
  };
}

function resolveFieldValue(field, fieldMapping, clientData) {
  const autoFillMap = buildAutoFillMap(clientData);
  const normName = normalizeFieldName(field.name);

  const mappedSource = fieldMapping?.[field.name] || fieldMapping?.[normName];
  if (mappedSource && autoFillMap[mappedSource] !== undefined) {
    return { value: autoFillMap[mappedSource], readOnly: true };
  }

  const isSys = field.name?.startsWith("sys:") || normName?.startsWith("sys:");
  if (isSys) {
    const rawKey = field.name?.startsWith("sys:") ? field.name : normName;
    const key = rawKey.slice(4).trim().replace(/\s+/g, "_");
    const val = autoFillMap[key] ?? "";
    return { value: val, readOnly: true };
  }

  const key = normName?.toLowerCase?.()?.replace(/\s+/g, "_");
  if (autoFillMap[key]) {
    return { value: autoFillMap[key], readOnly: !!autoFillMap[key] };
  }

  return { value: "", readOnly: false };
}

// ─── Extract fields with dimensions ──────────────────────────────────────────
function extractFields(schemas, fieldMapping, clientData) {
  const fields = [];
  schemas.forEach((pageSchemas, pageIdx) => {
    pageSchemas.forEach((field) => {
      const { value, readOnly } = resolveFieldValue(field, fieldMapping, clientData);
      const normName = normalizeFieldName(field.name);
      
      const isAutoFillField = fieldMapping?.[field.name] || fieldMapping?.[normName] || field.name?.startsWith("sys:") || normName.startsWith("sys:");
      const isEditableIfEmpty = isAutoFillField && !value;

      fields.push({
        name: field.name,
        type: field.type || "text",
        pageIdx,
        required: !!field.required,
        value,
        readOnly: isEditableIfEmpty ? false : (readOnly || !!field.readOnly),
        // Keep raw pdfme dimensions (in mm)
        position: field.position || { x: 0, y: 0 },
        width: field.width || 40,
        height: field.height || 10,
      });
    });
  });
  return fields;
}

// ─── Lightweight page component — just an <img> + field overlays ────────────
// Zero client-side PDF rendering. The server sends pre-rendered JPEG images.
function PdfPageImage({ imageUrl, pageIdx, pageSize, fields, fieldValues, handleChange, openSignaturePad }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-500 font-semibold mr-1">עמוד {pageIdx + 1}</p>
      
      {/* PDF Page Container with exact aspect ratio */}
      <div 
        className="relative bg-white shadow-md border border-gray-300 mx-auto overflow-hidden rounded-lg select-none"
        style={{
          width: "100%",
          aspectRatio: `${pageSize.width} / ${pageSize.height}`
        }}
      >
        {/* Background Layer: Server-rendered page image — fills container exactly */}
        <img
          src={imageUrl}
          alt={`עמוד ${pageIdx + 1}`}
          className="absolute inset-0 w-full h-full object-fill"
          draggable={false}
        />

        {/* Interaction Layer: HTML overlays — percentage positioning aligns with image */}
        <div className="absolute inset-0 pointer-events-none z-10">
          {fields.map((field) => {
            const isReadOnly = field.readOnly;
            const val = fieldValues[field.name];

            // Convert millimeter positions to percentages of the page
            const style = {
              position: "absolute",
              left: `${(field.position.x / pageSize.width) * 100}%`,
              top: `${(field.position.y / pageSize.height) * 100}%`,
              width: `${(field.width / pageSize.width) * 100}%`,
              height: `${(field.height / pageSize.height) * 100}%`,
              pointerEvents: "auto",
            };

            if (field.type === "signature") {
              return (
                <button
                  key={field.name}
                  onClick={() => openSignaturePad(field.name)}
                  style={style}
                  className={`flex flex-col items-center justify-center border-2 rounded text-[10px] font-bold transition-all ${
                    val 
                      ? "border-green-500 bg-green-50/70 text-green-700" 
                      : field.required
                        ? "border-red-400 bg-red-50/50 hover:bg-red-50 text-red-700 animate-pulse"
                        : "border-blue-400 bg-blue-50/50 hover:bg-blue-50 text-blue-700"
                  }`}
                  title={`לחצו לחתימה על שדה ${field.name}`}
                >
                  {val ? (
                    <img src={val} alt="signature" className="max-h-full max-w-full object-contain pointer-events-none" />
                  ) : (
                    <span>✍️ חתמו כאן</span>
                  )}
                </button>
              );
            }

            if (field.type === "checkbox") {
              const isChecked = val === true || val === "true";
              return (
                <div
                  key={field.name}
                  onClick={() => handleChange(field.name, !isChecked)}
                  style={style}
                  className={`border-2 rounded flex items-center justify-center cursor-pointer transition-all ${
                    isChecked
                      ? "border-green-500 bg-green-500 text-white"
                      : field.required
                        ? "border-red-400 bg-red-50/20"
                        : "border-blue-400 bg-blue-50/20"
                  }`}
                >
                  {isChecked && (
                    <svg className="w-full h-full p-0.5 stroke-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              );
            }

            // Default text / textarea fields
            return (
              <input
                key={field.name}
                type="text"
                value={val}
                disabled={isReadOnly}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={isReadOnly ? "" : field.name}
                style={style}
                className={`text-center font-medium border rounded px-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                  isReadOnly 
                    ? "border-transparent bg-transparent text-gray-800 font-semibold cursor-not-allowed" 
                    : field.required && !val
                      ? "border-red-400 bg-red-50/60"
                      : "border-blue-300 bg-blue-50/60 focus:bg-white"
                }`}
                dir="auto"
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function PdfSignIframeOverlay() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const clientId = searchParams.get("client");
  const token = searchParams.get("token");
  const stepId = searchParams.get("step_id");
  const templateId = searchParams.get("template_id");
  const templateName = searchParams.get("template_name") || "";
  const stepTitle = searchParams.get("step_title") || "טופס לחתימה";

  const routerState = location.state || {};

  // ─── State ─────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [loadingMsg, setLoadingMsg] = useState("טוען...");
  const [error, setError] = useState(null);
  const [client, setClient] = useState(routerState.client || null);
  const [submission, setSubmission] = useState(routerState.submission || null);
  const [templateJson, setTemplateJson] = useState(null);
  const [basePdfUrl, setBasePdfUrl] = useState(null);
  
  const [pageImages, setPageImages] = useState([]); // base64 JPEG images from server
  const [pageCount, setPageCount] = useState(1);
  const [pageSize, setPageSize] = useState({ width: 210, height: 297 }); // default A4
  const [fields, setFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Active signature capture state
  const [activeSigField, setActiveSigField] = useState(null); // field name
  const sigPadRef = useRef(null);

  // "Fill Fields" modal state (from original PdfFormStep)
  const [fieldsModalOpen, setFieldsModalOpen] = useState(false);
  const [modalFields, setModalFields] = useState([]);

  // ─── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!clientId || !token || !stepId || !templateId) {
      setError("פרמטרים חסרים בלינק");
      setLoading(false);
      return;
    }
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // Clear Base44 auth tokens to prevent SDK auto-auth on public page
      // Wrapped in try-catch: WhatsApp's WKWebView blocks localStorage (SecurityError)
      try {
        localStorage.removeItem("base44_access_token");
        localStorage.removeItem("token");
      } catch (e) { /* localStorage unavailable (WKWebView) — safe to ignore */ }

      let clientData = client;
      let submissionData = submission;
      if (!clientData) {
        const clientRes = await callFunction("getClientByToken", { client_id: clientId, token });
        if (clientRes?.error) throw new Error(clientRes.error);
        if (!clientRes?.client) throw new Error("Client not found");
        clientData = clientRes.client;
        submissionData = clientRes.submission || null;
        setClient(clientData);
        setSubmission(submissionData);
      }

      const appId = import.meta.env.VITE_BASE44_APP_ID;
      const tmplRes = await fetch(`/api/apps/${appId}/functions/getPdfTemplateById`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId }),
      });
      if (!tmplRes.ok) throw new Error("Failed to load PDF template");
      const tmplData = await tmplRes.json();
      if (!tmplData?.template) throw new Error("Template not found");
      const template = tmplData.template;

      const parsedTemplate = JSON.parse(template.template_json);
      let pdfSignedUrl = null;

      if (parsedTemplate.basePdf?.__type === "file_uri") {
        const signRes = await callFunction("getTemplateFileUrl", {
          client_id: clientId,
          token,
          template_id: templateId,
        });
        pdfSignedUrl = signRes?.signed_url || null;
      }

      setBasePdfUrl(pdfSignedUrl);
      setTemplateJson(template.template_json);

      // If pdfme version contains width/height config, use it. Otherwise, default A4
      if (parsedTemplate.width && parsedTemplate.height) {
        setPageSize({ width: parsedTemplate.width, height: parsedTemplate.height });
      }

      const extractedFields = extractFields(
        parsedTemplate.schemas || [],
        parsedTemplate.fieldMapping || {},
        clientData
      );

      const initialValues = {};
      extractedFields.forEach((f) => {
        initialValues[f.name] = f.value || "";
      });

      setFields(extractedFields);
      setFieldValues(initialValues);

      // Request server-rendered page images (zero client-side PDF rendering)
      if (pdfSignedUrl) {
        setLoadingMsg("מכין תצוגה מקדימה של המסמך...");
        const renderRes = await fetch(`${PDF_API}/render-pages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ basePdfUrl: pdfSignedUrl }),
        });
        if (!renderRes.ok) {
          const errData = await renderRes.json().catch(() => ({}));
          throw new Error(errData.error || "שגיאה בהכנת תצוגה מקדימה");
        }
        const renderData = await renderRes.json();
        setPageImages(renderData.pages.map(b64 => `data:image/jpeg;base64,${b64}`));
        setPageCount(renderData.pageCount);
      } else if (parsedTemplate.schemas) {
        setPageCount(parsedTemplate.schemas.length);
      }
    } catch (e) {
      console.error("PdfSignIframeOverlay: load error", e);
      Sentry.captureException(e, { tags: { component: "PdfSignIframeOverlay" } });
      setError(e.message || "שגיאה בטעינת הטופס");
    } finally {
      setLoading(false);
    }
  };

  // ─── Actions ───────────────────────────────────────────────────────────────
  const handleChange = (fieldName, value) => {
    setFieldValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  const openSignaturePad = (fieldName) => {
    setActiveSigField(fieldName);
  };

  const closeSignaturePad = () => {
    setActiveSigField(null);
  };

  const saveSignature = () => {
    if (sigPadRef.current) {
      if (sigPadRef.current.isEmpty()) {
        handleChange(activeSigField, "");
      } else {
        handleChange(activeSigField, sigPadRef.current.getDataUrl());
      }
    }
    setActiveSigField(null);
  };

  const clearSignature = (fieldName) => {
    handleChange(fieldName, "");
  };

  // ─── Fill Fields Modal ─────────────────────────────────────────────────────
  const openFieldsModal = () => {
    const editableTextFields = fields.filter((f) => {
      if (f.readOnly) return false;
      if (f.type === "signature" || f.type === "checkbox") return false;
      return true;
    });

    if (editableTextFields.length === 0) {
      alert("אין שדות טקסט הניתנים למילוי בטופס זה");
      return;
    }

    setModalFields(
      editableTextFields.map((f) => ({
        name: f.name,
        value: fieldValues[f.name] || "",
        required: f.required,
      }))
    );
    setFieldsModalOpen(true);
  };

  const applyFieldsModal = () => {
    const updated = { ...fieldValues };
    modalFields.forEach(({ name, value }) => {
      updated[name] = value;
    });
    setFieldValues(updated);
    setFieldsModalOpen(false);
  };

  const updateModalField = (index, value) => {
    setModalFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, value } : f))
    );
  };

  const closeFieldsModal = () => {
    setFieldsModalOpen(false);
  };

  // ─── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const missing = fields.filter((f) => {
      if (!f.required) return false;
      const val = fieldValues[f.name];
      return !val || String(val).trim() === "";
    });

    if (missing.length > 0) {
      alert(`יש למלא את השדות הבאים:\n• ${missing.map((f) => f.name).join("\n• ")}`);
      return;
    }

    setSubmitting(true);

    try {
      const mergedInputs = {};

      fields.forEach((f) => {
        const val = fieldValues[f.name];
        if (f.type === "checkbox") {
          const isChecked = val === true || val === "true";
          mergedInputs[f.name] = isChecked ? "true" : "false";
        } else {
          mergedInputs[f.name] = val || "";
        }
      });

      const parsedTemplate = JSON.parse(templateJson);
      if (parsedTemplate.schemas) {
        parsedTemplate.schemas.forEach((pageSchemas) => {
          pageSchemas.forEach((field) => {
            const fieldVal = mergedInputs[field.name];
            if (field.type === "signature" || field.type === "checkbox") {
              field.readOnly = false;
            } else if (field.readOnly || field.name?.startsWith("sys:") || parsedTemplate.fieldMapping?.[field.name]) {
              field.content = String(fieldVal || "");
              field.readOnly = true;
            } else {
              field.content = "";
              field.readOnly = false;
            }
          });
        });
      }
      const processedTemplateJson = JSON.stringify(parsedTemplate);

      console.log("[PdfSignIframeOverlay] Sending to PDF API...");
      const genRes = await fetch(`${PDF_API}/generate-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateJson: processedTemplateJson,
          basePdfUrl,
          inputs: [mergedInputs],
        }),
      });

      if (!genRes.ok) {
        const errData = await genRes.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${genRes.status}`);
      }

      // Lambda returns base64-encoded PDF; local poc-server returns raw blob
      let pdfBlob;
      const contentType = genRes.headers.get("content-type") || "";
      if (contentType.includes("application/pdf")) {
        pdfBlob = await genRes.blob();
      } else {
        // API Gateway may return base64 as JSON or raw base64 text
        const text = await genRes.text();
        const base64 = text.replace(/^"|"$/g, "");
        const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        pdfBlob = new Blob([bytes], { type: "application/pdf" });
      }
      console.log(`[PdfSignIframeOverlay] PDF generated: ${pdfBlob.size} bytes`);

      let pdfFileUrl = null;
      if (pdfBlob.size > 0) {
        try {
          const appId = import.meta.env.VITE_BASE44_APP_ID;
          const formData = new FormData();
          formData.append("file", pdfBlob, `${templateName || "signed-form"}.pdf`);
          const uploadRes = await fetch(
            `/api/apps/${appId}/functions/uploadFile?client_id=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}`,
            { method: "POST", body: formData }
          );
          if (uploadRes.ok) {
            const { file_uri } = await uploadRes.json();
            pdfFileUrl = file_uri;
          }
        } catch (uploadErr) {
          console.error("[PdfSignIframeOverlay] Upload failed:", uploadErr);
        }
      }

      const record = {
        step_id: stepId,
        step_title: stepTitle,
        pdf_template_id: templateId,
        template_name: templateName,
        pdf_file_url: pdfFileUrl,
        audit_trail: {
          signed_at: new Date().toISOString(),
          user_agent: navigator.userAgent,
          screen_resolution: `${screen.width}x${screen.height}`,
        },
        incomplete: false,
      };

      const existingPdfs = submission?.signed_pdfs ? JSON.parse(submission.signed_pdfs) : [];
      // Strip pdf_inputs from old records (legacy bloat that exceeds Base44 field limits)
      const filtered = existingPdfs
        .filter((r) => r.step_id !== stepId)
        .map(({ pdf_inputs, ...rest }) => rest);
      filtered.push(record);
      const updatedSignedPdfs = JSON.stringify(filtered);

      await callFunction("updateClientSubmission", {
        client_id: clientId,
        token,
        submission_id: submission?.id || null,
        data: { signed_pdfs: updatedSignedPdfs },
      });

      setDone(true);

      setTimeout(() => {
        navigate(
          `/questionnaire?client=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}`,
          { state: { returnedSubmission: { ...submission, signed_pdfs: updatedSignedPdfs } }, replace: true }
        );
      }, 2000);
    } catch (e) {
      console.error("[PdfSignIframeOverlay] Submit error:", e);
      alert(`שגיאה: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const goBack = () => {
    navigate(`/questionnaire?client=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}`, {
      state: { returnedSubmission: submission },
      replace: true,
    });
  };

  // ─── Loading / Error states ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-gray-600 text-sm">טוען מסמך דיגיטלי...</p>

        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center border border-gray-200 shadow-sm">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-900 mb-2">שגיאה</h2>
          <p className="text-gray-500 mb-4">{error}</p>
          <Button onClick={goBack} variant="outline" className="rounded-xl">
            <ChevronRight className="w-4 h-4 ml-1" />
            חזרה לשאלון
          </Button>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center border border-gray-200 shadow-sm">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h2 className="text-lg font-bold text-gray-900 mb-2">הטופס נחתם בהצלחה!</h2>
          <p className="text-gray-500 text-sm">מועבר חזרה לשאלון...</p>
        </div>
      </div>
    );
  }

  // Calculate pages list to render
  const pages = Array.from({ length: pageCount }, (_, i) => i);

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20 shadow-sm">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{stepTitle}</p>
          <p className="text-xs text-gray-400">מלאו את השדות וחתמו</p>
        </div>
        <Button
          onClick={openFieldsModal}
          size="sm"
          variant="outline"
          className="border-blue-400 text-blue-600 rounded-xl px-3 h-10 text-sm font-semibold gap-1.5 hover:bg-blue-50"
        >
          <ClipboardEdit className="w-4 h-4" />
          מילוי שדות
        </Button>
      </div>

      {/* Main content - Scrollable PDF pages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-8 max-w-3xl mx-auto w-full">
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs text-yellow-800 text-center">
          💡 ניתן להזין טקסט, לסמן תיבות ולחתום ישירות בתוך השדות המודגשים על גבי הדף.
        </div>

        {pages.map((pageIdx) => {
          const pageFields = fields.filter((f) => f.pageIdx === pageIdx);
          const imageUrl = pageImages[pageIdx];

          return (
            <PdfPageImage
              key={pageIdx}
              imageUrl={imageUrl}
              pageIdx={pageIdx}
              pageSize={pageSize}
              fields={pageFields}
              fieldValues={fieldValues}
              handleChange={handleChange}
              openSignaturePad={openSignaturePad}
            />
          );
        })}
      </div>

      {/* Sticky Bottom Actions */}
      <div className="bg-white border-t border-gray-200 px-4 py-4 sticky bottom-0 z-20 shadow-md">
        <div className="max-w-md mx-auto space-y-3">
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full h-14 text-base font-bold rounded-2xl bg-green-600 hover:bg-green-700 text-white shadow-sm disabled:opacity-50"
          >
            {submitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                מעבד חתימות...
              </span>
            ) : (
              "✓ השלם וחתום"
            )}
          </Button>
          <Button
            onClick={goBack}
            variant="ghost"
            className="w-full h-11 text-sm text-gray-500 rounded-2xl"
            disabled={submitting}
          >
            ביטול וחזרה
          </Button>
        </div>
      </div>

      {/* Signature Modal Overlay (signNow Style Popup) */}
      {activeSigField && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-gray-100 flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">✍️ ציירו את החתימה שלכם</h3>
              <button onClick={closeSignaturePad} className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-5 bg-gray-50 flex-1 flex flex-col items-center">
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden w-full shadow-inner p-1">
                <LightweightSignaturePad
                  ref={sigPadRef}
                  height={180}
                />
              </div>
              <p className="text-[11px] text-gray-400 mt-2 text-center">ציירו בתוך המסגרת בעזרת האצבע או עט מגע</p>
            </div>

            <div className="px-5 py-4 border-t border-gray-100 bg-gray-50/50 flex gap-3">
              <Button
                variant="outline"
                onClick={() => sigPadRef.current?.clear()}
                className="flex-1 rounded-xl h-11 text-gray-600"
              >
                נקה
              </Button>
              <Button
                onClick={saveSignature}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-11 font-bold shadow-sm"
              >
                שמור חתימה
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== FILL FIELDS MODAL (Bottom Sheet) ===== */}
      {fieldsModalOpen && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end justify-center" onClick={closeFieldsModal}>
          <div
            className="bg-white w-full max-w-lg rounded-t-2xl flex flex-col max-h-[85vh] animate-in slide-in-from-bottom"
            dir="rtl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <ClipboardEdit className="w-5 h-5 text-blue-600" />
                מילוי שדות
              </h3>
              <button
                onClick={closeFieldsModal}
                className="text-gray-400 hover:text-gray-600 text-lg px-2 rounded-full hover:bg-gray-100 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable fields list */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {modalFields.map((field, idx) => (
                <div key={field.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">
                    {field.name}
                    {field.required && <span className="text-red-500 mr-1">*</span>}
                  </label>
                  <input
                    type="text"
                    value={field.value}
                    onChange={(e) => updateModalField(idx, e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-gray-50"
                    dir="auto"
                    placeholder={`הזינו ${field.name}`}
                  />
                </div>
              ))}

              {modalFields.length === 0 && (
                <p className="text-center text-gray-400 py-8">אין שדות טקסט הניתנים למילוי</p>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3 px-4 py-4 border-t border-gray-200 flex-shrink-0">
              <Button
                onClick={closeFieldsModal}
                variant="outline"
                className="flex-1 rounded-xl h-12 text-gray-600"
              >
                ביטול
              </Button>
              <Button
                onClick={applyFieldsModal}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white rounded-xl h-12 font-bold shadow-sm"
              >
                החל שינויים
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
