import React, { useState, useEffect, Suspense } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import PdfFormStep from "@/components/questionnaire/PdfFormStep";

const callFunction = async (name, payload) => {
  const appId = import.meta.env.VITE_BASE44_APP_ID;
  const res = await fetch(`/api/apps/${appId}/functions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Server error");
  }
  return res.json();
};

/**
 * PdfSignPage — Standalone page for PDF signing.
 * URL: /questionnaire/sign?client=X&token=Y&step_id=Z&template_id=W&step_title=T
 *
 * Loads the PDF template, renders PdfFormStep as a full page,
 * saves the signed record back to the submission, then navigates back.
 */
export default function PdfSignPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();

  const clientId = searchParams.get("client");
  const token = searchParams.get("token");
  const stepId = searchParams.get("step_id");
  const templateId = searchParams.get("template_id");
  const templateName = searchParams.get("template_name") || "";
  const stepTitle = searchParams.get("step_title") || "טופס לחתימה";

  // Use router state if available (passed from questionnaire) — avoids redundant API calls
  const routerState = location.state || {};

  const [pdfTemplate, setPdfTemplate] = useState(null);
  const [client, setClient] = useState(routerState.client || null);
  const [submission, setSubmission] = useState(routerState.submission || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // Prevent SDK from auto-authenticating on the public signing page
  useEffect(() => {
    localStorage.removeItem('base44_access_token');
    localStorage.removeItem('token');
  }, []);

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
      // Only fetch client/submission if not passed via router state
      if (!client) {
        const clientRes = await callFunction("getClientByToken", {
          client_id: clientId,
          token,
        });
        if (clientRes?.error) throw new Error(clientRes.error);
        if (!clientRes?.client) throw new Error("Client not found");
        setClient(clientRes.client);
        setSubmission(clientRes.submission || null);
      }

      // Always load PDF template (not available in router state)
      const appId = import.meta.env.VITE_BASE44_APP_ID;
      const res = await fetch(`/api/apps/${appId}/functions/getPdfTemplateById`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template_id: templateId }),
      });
      if (!res.ok) throw new Error("Failed to load PDF template");
      const data = await res.json();
      if (!data?.template) throw new Error("Template not found");
      setPdfTemplate(data.template);
    } catch (e) {
      console.error("PdfSignPage: Failed to load:", e);
      setError(e.message || "שגיאה בטעינת הטופס");
    }
    setLoading(false);
  };

  const goBack = (updatedSubmission) => {
    // Navigate back via React Router — pass updated submission so questionnaire doesn't reload
    navigate(`/questionnaire?client=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}`, {
      state: { returnedSubmission: updatedSubmission || submission },
      replace: true,
    });
  };

  const handleComplete = async (pdfInputsJson, pdfBlob, auditTrail) => {
    setSaving(true);

    const record = {
      step_id: stepId,
      step_title: stepTitle,
      pdf_template_id: templateId,
      template_name: templateName,
      pdf_inputs: pdfInputsJson,
      pdf_file_url: null,
      audit_trail: auditTrail,
      incomplete: false,
    };

    // Upload PDF blob if present
    if (pdfBlob) {
      try {
        const appId = import.meta.env.VITE_BASE44_APP_ID;
        const formData = new FormData();
        formData.append("file", pdfBlob, `${templateName || "signed-form"}.pdf`);
        const uploadRes = await fetch(`/api/apps/${appId}/functions/uploadFile?client_id=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}`, {
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

    // Save to submission
    let updatedSubmission = submission;
    try {
      const existingPdfs = submission?.signed_pdfs
        ? JSON.parse(submission.signed_pdfs)
        : [];
      const filtered = existingPdfs.filter((r) => r.step_id !== stepId);
      filtered.push(record);
      const updatedSignedPdfs = JSON.stringify(filtered);

      await callFunction("updateClientSubmission", {
        client_id: clientId,
        token,
        submission_id: submission?.id || null,
        data: {
          signed_pdfs: updatedSignedPdfs,
        },
      });

      // Build updated submission for passing back
      updatedSubmission = { ...submission, signed_pdfs: updatedSignedPdfs };
    } catch (e) {
      console.error("Failed to save signed PDF record:", e);
    }

    setSaving(false);

    // Navigate back with updated data
    goBack(updatedSubmission);
  };

  // Get existing inputs for this step
  const existingSignedPdfs = submission?.signed_pdfs
    ? JSON.parse(submission.signed_pdfs)
    : [];
  const existingRecord = existingSignedPdfs.find((r) => r.step_id === stepId);
  const existingInputs = existingRecord?.pdf_inputs || null;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">טוען טופס לחתימה...</p>
        </div>
      </div>
    );
  }

  if (error || !pdfTemplate) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center border border-border shadow-sm">
          <div className="text-4xl mb-4">😕</div>
          <h2 className="text-lg font-bold text-foreground mb-2">שגיאה</h2>
          <p className="text-muted-foreground mb-4">{error || "תבנית PDF לא נמצאה"}</p>
          <Button onClick={goBack} variant="outline" className="rounded-xl">
            <ChevronRight className="w-4 h-4 ml-1" />
            חזרה לשאלון
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <PdfFormStep
        pdfTemplate={pdfTemplate}
        clientData={client}
        existingInputs={existingInputs}
        onComplete={handleComplete}
        onBack={() => goBack()}
        authContext={{ client_id: clientId, token, template_id: templateId }}
      />
    </div>
  );
}