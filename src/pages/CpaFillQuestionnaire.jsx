import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import QuestionStep from "@/components/questionnaire/QuestionStep";
import ProgressBar from "@/components/questionnaire/ProgressBar";
import CompletionScreen from "@/components/questionnaire/CompletionScreen";
import StepSelector from "@/components/questionnaire/StepSelector";
import { DEFAULT_STEPS, resolveYearPlaceholders, getActiveSteps, filterStepsByClientConditions } from "@/lib/questionnaire-template";
import { getResponses } from "@/lib/submission-compat";
import { buildSteps, parseSignedPdfs, getResumeStepIndex, deriveStepStatuses } from "@/lib/questionnaire-steps";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CpaFillQuestionnaire() {
  const urlParams = new URLSearchParams(window.location.search);
  const clientId = urlParams.get("client");
  const navigate = useNavigate();

  const [cpaUser, setCpaUser] = useState(null);
  const [client, setClient] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [currentStep, setCurrentStep] = useState(1); // skip welcome — CPA goes straight to steps
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [templateVersion, setTemplateVersion] = useState(null);
  const [templateId, setTemplateId] = useState(null);
  const [activeSteps, setActiveSteps] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const saveQueue = useRef(Promise.resolve());
  const pendingSavesRef = useRef(0);
  const submissionIdRef = useRef(null);
  const revisionRef = useRef(null);
  const currentStepRef = useRef(1);

  useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);
  useEffect(() => {
    submissionIdRef.current = submission?.id || null;
    revisionRef.current = submission?.revision || null;
  }, [submission]);

  useEffect(() => {
    if (!clientId) {
      setError("חסר מזהה לקוח");
      setLoading(false);
      return;
    }
    loadData();
  }, [clientId]);

  const loadData = async () => {
    setLoading(true);

    // Verify CPA is authenticated
    const user = await base44.auth.me();
    if (!user) {
      base44.auth.redirectToLogin();
      return;
    }
    setCpaUser(user);

    // Load client + submission directly via SDK (CPA has session)
    const [clientData, activeTemplateData] = await Promise.all([
      base44.entities.Client.filter({ id: clientId }),
      base44.functions.invoke("getActiveTemplate", {}),
    ]);

    const c = clientData?.[0];
    if (!c) {
      setError("לקוח לא נמצא");
      setLoading(false);
      return;
    }
    setClient(c);

    const taxYear = c.tax_year || 2024;
    const subs = await base44.entities.Submission.filter({ client_id: clientId, tax_year: taxYear });
    const sub = subs?.[0] || null;
    setSubmission(sub);
    submissionIdRef.current = sub?.id || null;
    revisionRef.current = sub?.revision || null;

    const tplData = sub?.completed_at && sub?.template_id
      ? await base44.functions.invoke("getTemplateById", {
          template_id: sub.template_id,
        })
      : activeTemplateData;

    // Resolve template
    let steps, version, tId;
    if (tplData?.data?.template?.steps) {
      version = tplData.data.template.version;
      tId = tplData.data.template.id;
      steps = getActiveSteps(tplData.data.template.steps);
    } else {
      version = 1;
      tId = null;
      steps = getActiveSteps(DEFAULT_STEPS);
    }
    setTemplateVersion(version);
    setTemplateId(tId);

    const resolved = resolveYearPlaceholders(steps, taxYear);
    const filtered = filterStepsByClientConditions(resolved, c);
    setActiveSteps(filtered);

    // Resume at first unanswered step
    if (sub) {
      const responses = getResponses(sub);
      const signedPdfsById = parseSignedPdfs(sub.signed_pdfs);
      const totalSteps = filtered.length + 2;
      const idx = getResumeStepIndex(filtered, responses, signedPdfsById, totalSteps);
      setCurrentStep(idx);
    } else {
      setCurrentStep(1);
    }

    setLoading(false);
  };

  const callCpaSave = async (stepId, data, completed = false) => {
    const { data: result } = await base44.functions.invoke(
      "cpaSaveSubmission",
      {
        client_id: clientId,
        submission_id: submissionIdRef.current,
        ...(submissionIdRef.current ? { revision: revisionRef.current } : {}),
        step_id: stepId,
        data: {
          ...data,
          step_completed: currentStepRef.current,
          template_version: templateVersion,
          template_id: templateId,
        },
        completed,
      },
    );
    return result;
  };

  const STEPS = buildSteps(activeSteps);

  const updateSubmission = async (stepId, data, completed = false) => {
    pendingSavesRef.current += 1;
    setIsSaving(true);
    const queued = saveQueue.current.then(async () => {
      const result = await callCpaSave(stepId, data, completed);
      if (result?.submission) {
        submissionIdRef.current = result.submission.id;
        revisionRef.current = result.submission.revision;
        setSubmission(result.submission);
      }
    });
    saveQueue.current = queued.catch(() => {});
    try {
      await queued;
      return true;
    } catch (saveError) {
      if (saveError?.status === 409) {
        await loadData();
        return false;
      }
      setError(saveError?.message || "שמירת השאלון נכשלה");
      return false;
    } finally {
      pendingSavesRef.current -= 1;
      if (pendingSavesRef.current === 0) setIsSaving(false);
    }
  };

  const handleNext = async (stepData, stepId) => {
    if (!(await updateSubmission(stepId, stepData))) return;
    setCurrentStep((prev) => prev + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleComplete = async (stepData, stepId) => {
    const saved = await updateSubmission(stepId, {
      ...stepData,
      step_completed: STEPS.length - 1,
      completed_at: new Date().toISOString(),
    }, true);
    if (!saved) return;
    setCurrentStep(STEPS.length - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // CPA marks a PDF sign step as "not required" (client signed outside the platform)
  const handleExemptPdfStep = (stepId, stepConfig) => {
    const existing = submission?.signed_pdfs ? JSON.parse(submission.signed_pdfs) : [];
    const filtered = existing.filter(r => r.step_id !== stepId);
    filtered.push({
      step_id: stepId,
      step_title: stepConfig?.title || "",
      pdf_template_id: stepConfig?.pdf_sign_config?.pdf_template_id || null,
      template_name: stepConfig?.pdf_sign_config?.template_name || "",
      pdf_file_url: null,
      audit_trail: {
        exempted_at: new Date().toISOString(),
        exempted_by_cpa: true,
        cpa_email: cpaUser?.email || "",
        cpa_name: cpaUser?.full_name || "",
      },
      exempted_by_cpa: true,
      incomplete: false,
    });
    const data = { signed_pdfs: JSON.stringify(filtered) };
    // If this step has a yes/no question (not skip_question), record answer=true
    if (!stepConfig?.skip_question) {
      const currentResponses = getResponses(submission);
      const updatedResponses = { ...currentResponses, [stepId]: { answer: true, title: stepConfig?.title || "", emoji: stepConfig?.emoji || "" } };
      data.responses = JSON.stringify(updatedResponses);
    }
    const isLastStep = currentStep === STEPS.length - 2;
    if (isLastStep) {
      handleComplete(data, stepId);
    } else {
      handleNext(data, stepId);
    }
  };

  // Undo a CPA exemption
  const handleUnexemptPdfStep = (stepId) => {
    const existing = submission?.signed_pdfs ? JSON.parse(submission.signed_pdfs) : [];
    const filtered = existing.filter(r => r.step_id !== stepId);
    updateSubmission(stepId, { signed_pdfs: JSON.stringify(filtered) });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center" dir="rtl">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">טוען...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center border border-border shadow-sm">
          <div className="text-4xl mb-4">😕</div>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" onClick={() => navigate("/")} className="gap-2">
            <ArrowRight className="w-4 h-4" /> חזרה לדשבורד
          </Button>
        </div>
      </div>
    );
  }

  const step = STEPS[currentStep];
  const contentSteps = STEPS.filter((s) => s.type === "question" || s.type === "pdf_sign");
  const progressIndex = Math.max(0, currentStep - 1);

  const responses = getResponses(submission);
  const signedPdfsById = parseSignedPdfs(submission?.signed_pdfs);
  const { completedStepIds, incompleteStepIds } = deriveStepStatuses(activeSteps, responses, signedPdfsById);

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* CPA Banner */}
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-amber-800 text-sm font-medium">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          מילוי עבור הלקוח: <span className="font-bold">{client?.full_name}</span>
          <span className="text-amber-600 font-normal">| כל פעולה תתועד תחת: {cpaUser?.full_name || cpaUser?.email}</span>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate("/")} className="gap-1.5 text-xs border-amber-300 text-amber-800 hover:bg-amber-100">
          <ArrowRight className="w-3 h-3" />
          יציאה
        </Button>
      </div>

      {/* Header */}
      <div className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <img
            src="/brand-image.jpg"
            alt="Doron & Doron"
            className="h-9 w-auto object-contain flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">
              שאלון שנתי {client?.tax_year || 2024} — {client?.full_name}
            </p>
            <p className="text-xs text-amber-600 truncate">מצב מילוי רו"ח</p>
          </div>
          {isSaving && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
              <div className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              שומר...
            </div>
          )}
        </div>
        {step?.type !== "done" && (
          <div className="max-w-lg mx-auto px-4 pb-3">
            <ProgressBar current={progressIndex} total={contentSteps.length} />
          </div>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {step?.type === "question" && (
          <>
            <div className="mb-4">
              <StepSelector
                steps={activeSteps}
                currentStepId={step.id}
                completedSteps={completedStepIds}
                incompleteSteps={incompleteStepIds}
                onSelectStep={setCurrentStep}
              />
            </div>
            <QuestionStep
              stepConfig={step.config}
              submission={submission}
              onNext={(data) => handleNext(data, step.id)}
              onComplete={(data) => handleComplete(data, step.id)}
              onBack={() => setCurrentStep((prev) => prev - 1)}
              onSkip={() => setCurrentStep((prev) => prev + 1)}
              isFirst={currentStep === 1}
              isLast={currentStep === STEPS.length - 2}
              clientId={clientId}
              token={client?.token || ""}
              signedRecord={signedPdfsById[step.config.id]}
              isCpaMode={true}
              onExemptPdf={() => handleExemptPdfStep(step.config.id, step.config)}
              onUnexemptPdf={() => handleUnexemptPdfStep(step.config.id)}
            />
          </>
        )}

        {step?.type === "pdf_sign" && (() => {
          const existingRecord = signedPdfsById[step.id];
          const isExempted = !!existingRecord?.exempted_by_cpa;

          if (isExempted) {
            return (
              <div className="bg-white rounded-3xl p-6 border border-blue-200 shadow-sm text-center" dir="rtl">
                <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">✅</span>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">{step.config?.title || "טופס לחתימה"}</h3>
                <p className="text-muted-foreground mb-4 text-sm">
                  סומן כלא נדרש ע"י רו"ח — הלקוח חתם מחוץ למערכת
                </p>
                <div className="flex flex-col gap-2">
                  <Button onClick={() => {
                    const isLast = currentStep === STEPS.length - 2;
                    if (isLast) handleComplete({}, step.id);
                    else { setCurrentStep((prev) => prev + 1); window.scrollTo({ top: 0, behavior: "smooth" }); }
                  }}>
                    {currentStep === STEPS.length - 2 ? "סיום ✨" : "המשך לשלב הבא"}
                  </Button>
                  <Button variant="ghost" onClick={() => handleUnexemptPdfStep(step.id)}>
                    בטל פטור
                  </Button>
                  <Button variant="ghost" onClick={() => setCurrentStep((prev) => prev - 1)}>
                    חזרה
                  </Button>
                </div>
              </div>
            );
          }

          return (
            <div className="bg-white rounded-3xl p-6 border border-amber-200 shadow-sm text-center" dir="rtl">
              <div className="text-4xl mb-3">📝</div>
              <h3 className="text-lg font-bold text-foreground mb-2">{step.config?.title || "טופס לחתימה"}</h3>
              <p className="text-muted-foreground mb-4 text-sm">
                טפסי חתימה מיועדים ללקוח בלבד. בקש מהלקוח לחתום ישירות דרך הלינק שלו, או סמן כלא נדרש אם הלקוח כבר חתם מחוץ למערכת.
              </p>
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => handleExemptPdfStep(step.id, step.config)}>
                  סמן כלא נדרש (פטור רו"ח)
                </Button>
                <Button variant="ghost" onClick={() => setCurrentStep((prev) => prev + 1)}>
                  דלג לשלב הבא
                </Button>
                <Button variant="ghost" onClick={() => setCurrentStep((prev) => prev - 1)}>
                  חזרה
                </Button>
              </div>
            </div>
          );
        })()}

        {step?.type === "done" && (
          <CompletionScreen
            client={client}
            submission={submission}
            steps={activeSteps}
            onEdit={() => setCurrentStep(1)}
          />
        )}
      </div>
    </div>
  );
}
