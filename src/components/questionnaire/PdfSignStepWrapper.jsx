import React, { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import PdfFormStep from "@/components/questionnaire/PdfFormStep";
import { buildAuditTrail } from "@/lib/pdfme-config";

/**
 * PdfSignStepWrapper — Loads a PdfTemplate by ID (from step config),
 * then renders PdfFormStep. When the client signs, it builds a
 * signed_pdfs record with audit trail and passes it up.
 */
export default function PdfSignStepWrapper({ step, client, submission, onComplete, onBack }) {
  const [pdfTemplate, setPdfTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const templateId = step.config?.pdf_sign_config?.pdf_template_id;
  const templateName = step.config?.pdf_sign_config?.template_name || "";

  useEffect(() => {
    if (!templateId) {
      setError("לא הוגדרה תבנית PDF לשלב זה");
      setLoading(false);
      return;
    }
    loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    setLoading(true);
    try {
      const appId = import.meta.env.VITE_BASE44_APP_ID;
      const res = await fetch(`/api/apps/${appId}/functions/getPdfTemplateById`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId }),
      });
      if (!res.ok) throw new Error("Failed to load PDF template");
      const data = await res.json();
      if (data?.template) {
        setPdfTemplate(data.template);
      } else {
        throw new Error("Template not found");
      }
    } catch (e) {
      console.error("PdfSignStepWrapper: Failed to load template:", e);
      setError("שגיאה בטעינת תבנית PDF");
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">טוען טופס לחתימה...</p>
        </div>
      </div>
    );
  }

  if (error || !pdfTemplate) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-border shadow-sm text-center">
        <div className="text-4xl mb-3">😕</div>
        <h3 className="text-lg font-bold text-foreground mb-2">שגיאה</h3>
        <p className="text-muted-foreground mb-4">{error || "תבנית PDF לא נמצאה"}</p>
        {onBack && (
          <button
            onClick={onBack}
            className="text-primary hover:underline text-sm"
          >
            חזרה
          </button>
        )}
      </div>
    );
  }

  // Get existing inputs for this specific step (if re-visiting)
  const existingSignedPdfs = submission?.signed_pdfs
    ? JSON.parse(submission.signed_pdfs)
    : [];
  const existingRecord = existingSignedPdfs.find((r) => r.step_id === step.id);
  const existingInputs = existingRecord?.pdf_inputs || null;

  return (
    <PdfFormStep
      pdfTemplate={pdfTemplate}
      clientData={client}
      existingInputs={existingInputs}
      onComplete={async (pdfInputsJson, pdfBlob, auditTrail, options = {}) => {
        // Build the signed PDF record for this step
        const record = {
          step_id: step.id,
          step_title: step.config?.title || "",
          pdf_template_id: templateId,
          template_name: templateName,
          pdf_inputs: pdfInputsJson,
          pdf_file_url: null, // Will be set after upload
          audit_trail: auditTrail,
          incomplete: !!options.incomplete,
        };

        // Upload the signed PDF blob (skip if incomplete — no blob)
        if (pdfBlob) {
          try {
            const appId = import.meta.env.VITE_BASE44_APP_ID;
            const formData = new FormData();
            formData.append("file", pdfBlob, `${templateName || "signed-form"}.pdf`);
            // Client auth flow: pass client_id + token as URL params
            const uploadUrl = client?.id && client?.token
              ? `/api/apps/${appId}/functions/uploadFile?client_id=${encodeURIComponent(client.id)}&token=${encodeURIComponent(client.token)}`
              : `/api/apps/${appId}/functions/uploadFile`;
            const uploadRes = await fetch(uploadUrl, {
              method: "POST",
              body: formData,
            });
            if (uploadRes.ok) {
              const { file_uri } = await uploadRes.json();
              record.pdf_file_url = file_uri;
            }
          } catch (e) {
            console.error("Failed to upload signed PDF:", e);
          }
        }

        // Pass the complete record up
        onComplete(record);
      }}
      onBack={onBack}
    />
  );
}
