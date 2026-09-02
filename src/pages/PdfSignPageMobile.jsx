import React, { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { Loader2, ChevronRight, ChevronLeft, CheckCircle2, AlertCircle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import LightweightSignaturePad from "@/components/questionnaire/LightweightSignaturePad";
import { fileClient } from "@/api/file-client";
import { invokePublicFunction, loadPublicPdfTemplate } from "@/api/function-client";

/**
 * PdfSignPageMobile — POC-2: Guided Stepper UX
 *
 * Route: /questionnaire/sign-poc-wizard (dev only)
 *
 * Splits the screen:
 *  - Top 65vh: Native PDF iframe for reference/reading.
 *  - Bottom 35vh: A stepped workflow panel focusing on one editable field at a time.
 */

const POC_API = "/poc-api";

const callFunction = invokePublicFunction;

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
        position: field.position || { x: 0, y: 0 },
      });
    });
  });
  return fields;
}

export default function PdfSignPageMobile() {
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
  const [error, setError] = useState(null);
  const [client, setClient] = useState(routerState.client || null);
  const [submission, setSubmission] = useState(routerState.submission || null);
  const [templateJson, setTemplateJson] = useState(null);
  const [basePdfUrl, setBasePdfUrl] = useState(null);
  
  const [fields, setFields] = useState([]);
  const [fieldValues, setFieldValues] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Stepper UI States
  const [activeStepIdx, setActiveStepIdx] = useState(-1); // -1 = Welcome screen, -2 = Done summary screen
  const [sigPadActive, setSigPadActive] = useState(false);

  const sigPadRef = useRef(null);

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
      localStorage.removeItem("base44_access_token");
      localStorage.removeItem("token");

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

      const tmplData = await loadPublicPdfTemplate({
        client_id: clientId,
        token,
        template_id: templateId,
      });
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
    } catch (e) {
      console.error("PdfSignPageMobile load error", e);
      setError(e.message || "שגיאה בטעינת הטופס");
    } finally {
      setLoading(false);
    }
  };

  // Filter and sort editable fields (top-to-bottom order)
  const editableFields = fields
    .filter((f) => !f.readOnly)
    .sort((a, b) => {
      if (a.pageIdx !== b.pageIdx) return a.pageIdx - b.pageIdx;
      return a.position.y - b.position.y;
    });

  const handleChange = (fieldName, value) => {
    setFieldValues((prev) => ({ ...prev, [fieldName]: value }));
  };

  // Navigation handlers
  const handleStart = () => {
    if (editableFields.length > 0) {
      setActiveStepIdx(0);
    } else {
      setActiveStepIdx(-2); // Direct to finish if no editable fields
    }
  };

  const handleNext = () => {
    if (activeStepIdx < editableFields.length - 1) {
      setActiveStepIdx(activeStepIdx + 1);
    } else {
      setActiveStepIdx(-2); // End state reached
    }
  };

  const handlePrev = () => {
    if (activeStepIdx > 0) {
      setActiveStepIdx(activeStepIdx - 1);
    } else if (activeStepIdx === -2) {
      setActiveStepIdx(editableFields.length - 1);
    } else {
      setActiveStepIdx(-1); // Go back to welcome
    }
  };

  // Submit flow
  const handleSubmit = async () => {
    // Double check all required fields
    const missing = editableFields.filter((f) => {
      if (!f.required) return false;
      const val = fieldValues[f.name];
      return !val || String(val).trim() === "";
    });

    if (missing.length > 0) {
      alert(`יש למלא את השדות הבאים:\n• ${missing.map((f) => f.name).join("\n• ")}`);
      // Find the index of the first missing field to navigate to it
      const missingIdx = editableFields.findIndex((f) => f.name === missing[0].name);
      if (missingIdx !== -1) {
        setActiveStepIdx(missingIdx);
      }
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

      console.log("[PdfSignPageMobile] Sending to POC server...");
      const genRes = await fetch(`${POC_API}/generate-pdf`, {
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

      const pdfBlob = await genRes.blob();
      let pdfFileUrl = null;
      if (pdfBlob.size > 0 && submission?.id) {
        try {
          const file = new File([pdfBlob], `${templateName || "signed-form"}.pdf`, {
            type: "application/pdf",
          });
          pdfFileUrl = await fileClient.uploadPublicFile({
            file,
            clientId,
            token,
            submissionId: submission.id,
            purpose: "signed_pdf",
            stepId,
          });
        } catch (uploadErr) {
          console.error("[PdfSignPageMobile] Upload failed:", uploadErr);
        }
      }

      const record = {
        step_id: stepId,
        step_title: stepTitle,
        pdf_template_id: templateId,
        template_name: templateName,
        pdf_inputs: JSON.stringify([mergedInputs]),
        pdf_file_url: pdfFileUrl,
        audit_trail: {
          signed_at: new Date().toISOString(),
          user_agent: navigator.userAgent,
          screen_resolution: `${screen.width}x${screen.height}`,
          poc_mode: "guided_stepper",
        },
        incomplete: false,
      };

      const existingPdfs = submission?.signed_pdfs ? JSON.parse(submission.signed_pdfs) : [];
      const filtered = existingPdfs.filter((r) => r.step_id !== stepId);
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
      console.error("[PdfSignPageMobile] Submit error:", e);
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

  // Loading/Error/Done screens
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-gray-600 text-sm">טוען אשף חתימה...</p>
          <p className="text-gray-400 text-xs mt-1">⚡ POC-2: אשף מילוי מודרך</p>
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

  const activeField = editableFields[activeStepIdx];
  const activeValue = activeField ? fieldValues[activeField.name] : "";

  // Helper to trigger signature canvas popup
  const handleOpenSigPad = () => {
    setSigPadActive(true);
  };

  const handleSaveSignature = () => {
    if (sigPadRef.current) {
      if (sigPadRef.current.isEmpty()) {
        handleChange(activeField.name, "");
      } else {
        const dataUrl = sigPadRef.current.getDataUrl();
        handleChange(activeField.name, dataUrl);
        // Small delay then go next
        setTimeout(() => {
          handleNext();
        }, 300);
      }
    }
    setSigPadActive(false);
  };

  // Custom friendly label for fields if generic
  const getFieldLabel = (field, idx) => {
    if (field.type === "checkbox" || field.type === "check") {
      return `סעיף ${idx + 1}: אישור והצהרה`;
    }
    if (field.type === "signature") {
      return `חתימה בשדה: ${field.name}`;
    }
    return field.name;
  };

  // Adjust background PDF iframe depending on step (simulate scrolling to correct page)
  const pdfUrlWithPage = basePdfUrl
    ? `${basePdfUrl}#page=${(activeField?.pageIdx ?? 0) + 1}&toolbar=0&navpanes=0&scrollbar=0&view=FitH`
    : "";

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-gray-100" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-20 shadow-sm h-[56px] shrink-0">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{stepTitle}</p>
          <p className="text-xs text-gray-400">מילוי מודרך מהיר ומאובטח (POC-2)</p>
        </div>
        <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Guided Stepper</span>
      </div>

      {/* Main Split Layout */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top 65vh: PDF Viewer */}
        <div className="flex-1 min-h-[45vh] bg-gray-200 border-b border-gray-300 relative">
          {basePdfUrl ? (
            <iframe
              src={pdfUrlWithPage}
              title="PDF Viewport"
              className="w-full h-full border-none"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              לא ניתן להציג את קובץ ה-PDF
            </div>
          )}
        </div>

        {/* Bottom 35vh: Action Assistant Stepper */}
        <div className="h-[35vh] min-h-[200px] bg-white shadow-2xl flex flex-col z-10 border-t border-gray-200 relative shrink-0">
          {/* Welcome Screen (activeStepIdx === -1) */}
          {activeStepIdx === -1 && (
            <div className="flex-1 p-5 flex flex-col justify-between max-w-md mx-auto w-full">
              <div className="space-y-2 text-center mt-2">
                <h3 className="font-bold text-gray-800 text-base">שלום, יש למלא {editableFields.length} שדות במסמך</h3>
                <p className="text-xs text-gray-500">
                  נלווה אותך צעד אחר צעד למילוי השדות ולחתימה, ללא צורך בניווט מסובך.
                </p>
              </div>
              <div className="space-y-2 mb-3">
                <Button
                  onClick={handleStart}
                  className="w-full h-13 text-sm font-bold rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-md"
                >
                  התחל במילוי ➔
                </Button>
                <Button
                  onClick={goBack}
                  variant="ghost"
                  className="w-full h-9 text-xs text-gray-400"
                >
                  חזרה לשאלון
                </Button>
              </div>
            </div>
          )}

          {/* Stepper Wizard View (activeStepIdx >= 0) */}
          {activeStepIdx >= 0 && activeStepIdx < editableFields.length && (
            <div className="flex-1 flex flex-col justify-between p-4 max-w-md mx-auto w-full">
              {/* Stepper Progress Bar */}
              <div className="flex items-center justify-between text-[11px] text-gray-400 mb-2 shrink-0">
                <span className="font-bold text-indigo-600">שדה {activeStepIdx + 1} מתוך {editableFields.length}</span>
                <div className="flex-1 mx-3 h-1 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-300"
                    style={{ width: `${((activeStepIdx + 1) / editableFields.length) * 100}%` }}
                  />
                </div>
                <span>עמוד {activeField.pageIdx + 1}</span>
              </div>

              {/* Focused Active Field Body */}
              <div className="flex-1 flex flex-col justify-center py-2 min-h-0">
                <label className="block text-xs font-bold text-gray-500 mb-2 text-center">
                  {getFieldLabel(activeField, activeStepIdx)}
                  {activeField.required && <span className="text-red-500 mr-1">*</span>}
                </label>

                <div className="w-full">
                  {/* Checkbox Card */}
                  {(activeField.type === "checkbox" || activeField.type === "check") ? (
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={() => {
                          handleChange(activeField.name, true);
                          setTimeout(() => handleNext(), 300);
                        }}
                        className={`flex-1 max-w-[150px] py-4 rounded-2xl border-2 font-bold transition-all text-sm flex flex-col items-center gap-1 ${
                          activeValue === true || activeValue === "true"
                            ? "border-green-500 bg-green-50 text-green-700 shadow-inner"
                            : "border-gray-200 bg-white text-gray-700 hover:border-indigo-200"
                        }`}
                      >
                        <Check className="w-5 h-5" />
                        מאשר/ת
                      </button>
                      <button
                        onClick={() => {
                          handleChange(activeField.name, false);
                          setTimeout(() => handleNext(), 300);
                        }}
                        className={`flex-1 max-w-[150px] py-4 rounded-2xl border-2 font-bold transition-all text-sm flex flex-col items-center gap-1 ${
                          activeValue === false || activeValue === "false" || activeValue === ""
                            ? "border-red-400 bg-red-50 text-red-700"
                            : "border-gray-200 bg-white text-gray-700 hover:border-indigo-200"
                        }`}
                      >
                        <span className="text-base leading-none">✕</span>
                        לא מאשר/ת
                      </button>
                    </div>
                  ) : activeField.type === "signature" ? (
                    /* Signature Button */
                    <div className="flex justify-center">
                      <Button
                        onClick={handleOpenSigPad}
                        className={`w-full max-w-[280px] h-14 rounded-2xl border-2 flex items-center justify-center gap-2 text-sm font-bold transition-all ${
                          activeValue
                            ? "border-green-500 bg-green-50 text-green-700"
                            : "border-indigo-500 bg-indigo-50 text-indigo-700 animate-pulse"
                        }`}
                      >
                        {activeValue ? (
                          <>
                            <img src={activeValue} alt="signature" className="max-h-full max-w-full object-contain h-10 pointer-events-none" />
                            <span className="text-xs text-gray-400">(לחץ לעריכה)</span>
                          </>
                        ) : (
                          "✍️ לחצו כדי לחתום כאן"
                        )}
                      </Button>
                    </div>
                  ) : (
                    /* Default Text Input */
                    <div className="flex justify-center">
                      <input
                        type="text"
                        value={activeValue}
                        onChange={(e) => handleChange(activeField.name, e.target.value)}
                        className="w-full max-w-[320px] text-center text-base font-medium border-2 border-indigo-200 focus:border-indigo-500 bg-white px-4 py-3 rounded-2xl outline-none transition-colors"
                        placeholder={`הזינו ${activeField.name}`}
                        dir="auto"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleNext();
                        }}
                        autoFocus
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Navigation Controls */}
              <div className="flex items-center justify-between border-t border-gray-100 pt-3 mt-1 shrink-0">
                <Button
                  onClick={handlePrev}
                  variant="outline"
                  className="rounded-xl border-gray-200 h-10 px-3 text-xs"
                >
                  <ChevronRight className="w-4 h-4 ml-1" />
                  הקודם
                </Button>

                <div className="text-[10px] text-gray-400">
                  {activeField.required ? "⚠️ שדה חובה" : "אופציונלי"}
                </div>

                <Button
                  onClick={handleNext}
                  className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 h-10 px-3 text-xs"
                >
                  הבא
                  <ChevronLeft className="w-4 h-4 mr-1" />
                </Button>
              </div>
            </div>
          )}

          {/* End Summary View (activeStepIdx === -2) */}
          {activeStepIdx === -2 && (
            <div className="flex-1 p-5 flex flex-col justify-between max-w-md mx-auto w-full">
              <div className="space-y-2 text-center mt-2">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600 mb-1">
                  <Check className="w-6 h-6" />
                </div>
                <h3 className="font-bold text-gray-800 text-base">כל השדות מולאו בהצלחה!</h3>
                <p className="text-xs text-gray-500">
                  המסמך מוכן לחתימה סופית ושידור ל-CPA.
                </p>
              </div>
              <div className="space-y-2 mb-3">
                <Button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full h-13 text-sm font-bold rounded-2xl bg-green-600 hover:bg-green-700 text-white shadow-md disabled:opacity-50"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-5 h-5 animate-spin" />
                      מייצר PDF...
                    </span>
                  ) : (
                    "✓ השלם וחתום"
                  )}
                </Button>
                <button
                  onClick={handlePrev}
                  className="w-full text-center text-xs text-indigo-600 hover:underline font-semibold h-8"
                  disabled={submitting}
                >
                  חזור לעריכת השדות
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Signature Popup Modal (signNow style) */}
      {sigPadActive && (
        <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-gray-100 flex flex-col">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">✍️ ציירו את החתימה שלכם</h3>
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
                onClick={handleSaveSignature}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-11 font-bold shadow-sm"
              >
                שמור חתימה
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
