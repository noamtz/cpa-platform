import React, { useState, useEffect, useRef, lazy } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import WelcomeStep from "@/components/questionnaire/WelcomeStep";
import QuestionStep from "@/components/questionnaire/QuestionStep";
import ProgressBar from "@/components/questionnaire/ProgressBar";
import CompletionScreen from "@/components/questionnaire/CompletionScreen";
import StepSelector from "@/components/questionnaire/StepSelector";
import { DEFAULT_STEPS, resolveYearPlaceholders, getActiveSteps, filterStepsByClientConditions } from "@/lib/questionnaire-template";
import { getResponses } from "@/lib/submission-compat";
import { buildSteps, parseSignedPdfs, getResumeStepIndex, deriveStepStatuses } from "@/lib/questionnaire-steps";
import { createRecoverableSaveQueue } from "@/lib/questionnaire-save-queue";
import { startQuestionnaireWithSubmission } from "@/lib/questionnaire-start";
import { postPublicFunction } from "@/api/function-client";
import { fileClient } from "@/api/file-client";
import { useToast } from "@/components/ui/use-toast";

// Lazy-load PDF signing wrapper (pdfme is ~2MB)
const PdfSignStepWrapper = lazy(() => import("@/components/questionnaire/PdfSignStepWrapper"));

// [POC TEST] Temporarily disabled pdfme prefetch
// import("@/lib/pdfme-config").then(({ loadPdfme, loadHeeboFont }) => {
//   loadPdfme();
//   loadHeeboFont();
// });

export default function ClientQuestionnaire() {
  const urlParams = new URLSearchParams(window.location.search);
  const clientId = urlParams.get("client");
  const token = urlParams.get("token");
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();

  // Prevent SDK from auto-authenticating on the public questionnaire page
  // Wrapped in try-catch: WhatsApp's WKWebView blocks localStorage (SecurityError)
  useEffect(() => {
    try {
      localStorage.removeItem('base44_access_token');
      localStorage.removeItem('token');
    } catch (e) { /* localStorage unavailable (WKWebView) — safe to ignore */ }
  }, []);

  // Prevent browser from navigating away when files are dropped outside the upload zone
  useEffect(() => {
    const prevent = (e) => { e.preventDefault(); };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  const [client, setClient] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [templateVersion, setTemplateVersion] = useState(null);
  const [templateId, setTemplateId] = useState(null);
  const [activeSteps, setActiveSteps] = useState([]); // resolved steps from template
  const [pdfViewLoading, setPdfViewLoading] = useState({}); // { stepId: true/false }
  const [isSaving, setIsSaving] = useState(false);
  const saveQueue = useRef(createRecoverableSaveQueue());

  const STEPS = buildSteps(activeSteps);

  useEffect(() => {
    if (!clientId) {
      setError("לינק שגוי — פנה לרואה החשבון שלך");
      setLoading(false);
      return;
    }
    loadClientData();
  }, [clientId]);

  const callFunction = async (name, payload) => {
    const result = await postPublicFunction(name, payload);
    return result.body;
  };

  const loadClientData = async () => {
    setLoading(true);

    // Load client data and template in parallel
    const [clientData, templateData] = await Promise.all([
      callFunction('getClientByToken', { client_id: clientId, token }),
      callFunction('getActiveTemplate', { client_id: clientId, token }),
    ]);

    if (clientData?.error) {
      setError(clientData.error);
      setLoading(false);
      return;
    }

    let { client: c, submission: sub } = clientData;
    setClient(c);

    // Determine which template to use
    const taxYear = c?.tax_year || 2024;
    let steps;
    let version;
    let tId;

    // If submission is completed, use its stored template ID
    // Otherwise, use the current active template
    if (sub?.completed_at && sub?.template_id) {
      tId = sub.template_id;
      const historicalData = await callFunction('getTemplateById', {
        client_id: clientId,
        token,
        template_id: sub.template_id,
      });
      if (historicalData?.template?.steps) {
        version = historicalData.template.version;
        steps = getActiveSteps(historicalData.template.steps);
      } else {
        // Fallback if historical template not found
        version = sub.template_version || 1;
        steps = getActiveSteps(DEFAULT_STEPS);
      }
    } else {
      // In-progress: use current active template
      tId = templateData?.template?.id || null;
      if (templateData?.template?.steps) {
        version = templateData.template.version;
        steps = getActiveSteps(templateData.template.steps);
      } else {
        version = 1;
        steps = getActiveSteps(DEFAULT_STEPS);
      }

      // For in-progress submissions, filter out questions that no longer exist in the template
      if (sub && sub.responses) {
        const responses = JSON.parse(sub.responses);
        const stepIds = steps.map(s => s.id);
        // Only keep responses for steps that still exist
        const filteredResponses = {};
        Object.keys(responses).forEach(stepId => {
          if (stepIds.includes(stepId)) {
            filteredResponses[stepId] = responses[stepId];
          }
        });
        // Update submission with filtered responses
        if (Object.keys(filteredResponses).length < Object.keys(responses).length) {
          sub = { ...sub, responses: JSON.stringify(filteredResponses) };
        }
      }
    }

    setTemplateVersion(version);
    setTemplateId(tId);
    const resolvedSteps = resolveYearPlaceholders(steps, taxYear);
    const filteredSteps = filterStepsByClientConditions(resolvedSteps, c);
    setActiveSteps(filteredSteps);

    // Total steps = welcome + filteredSteps + done
    // Must use filteredSteps (not resolvedSteps) because STEPS is derived from activeSteps = filteredSteps
    const totalSteps = filteredSteps.length + 2;

    if (sub) {
      // If returning from sign page, merge the updated signed_pdfs
      const returnedSub = location.state?.returnedSubmission;
      if (returnedSub?.signed_pdfs) {
        sub = { ...sub, ...returnedSub };
      }
      setSubmission(sub);
      if (sub.completed_at) {
        setCurrentStep(totalSteps - 1);
      } else {
        const responses = getResponses(sub);
        const signedPdfsById = parseSignedPdfs(sub.signed_pdfs);
        const resumeIdx = getResumeStepIndex(filteredSteps, responses, signedPdfsById, totalSteps, sub.step_completed || 0);
        // If the client has started (at least one answer), skip the welcome screen
        const hasStarted = Object.keys(responses).length > 0 || Object.keys(signedPdfsById).length > 0;
        setCurrentStep(hasStarted ? resumeIdx : 0);
      }
    } else {
      setCurrentStep(0);
    }
    setLoading(false);
  };

  // When returning from PdfSignPage, pick up the updated submission from router state
  useEffect(() => {
    const returnedSub = location.state?.returnedSubmission;
    if (!returnedSub?.signed_pdfs) return;

    // Guard: activeSteps must be populated (by loadClientData) before we can
    // compute a meaningful resume index.  On initial mount activeSteps is []
    // which would incorrectly resolve to step 1.  loadClientData already
    // handles the returnedSubmission merge, so we can safely skip here.
    if (activeSteps.length === 0) return;

    // Merge updated signed_pdfs and compute resume index using the fresh merged data
    setSubmission((prev) => {
      if (!prev) return prev;
      const merged = { ...prev, ...returnedSub };

      const responses = getResponses(merged);
      const signedPdfsById = parseSignedPdfs(merged.signed_pdfs);
      const totalSteps = activeSteps.length + 2;
      const resumeIdx = getResumeStepIndex(activeSteps, responses, signedPdfsById, totalSteps, merged.step_completed || 0);
      setCurrentStep(resumeIdx);

      return merged;
    });

    // Clear the router state so this effect doesn't re-fire
    window.history.replaceState({}, "", window.location.href);
  }, [location.state]);

  // Capture latest submission id in a ref so queued saves always use the most recent id
  const submissionIdRef = useRef(null);
  const submissionVersionRef = useRef(null);
  useEffect(() => {
    submissionIdRef.current = submission?.id || null;
    submissionVersionRef.current = submission?._version || null;
  }, [submission]);

  const [staleSubmission, setStaleSubmission] = useState(false);

  const updateSubmission = (data, completed = false) => {
    setIsSaving(true);
    // Chain onto the queue and return a promise that resolves when THIS save completes
    const thisSave = saveQueue.current.enqueue(async () => {
      const result = await callFunction('updateClientSubmission', {
        client_id: clientId,
        token,
        submission_id: submissionIdRef.current,
        _version: submissionIdRef.current ? submissionVersionRef.current : undefined,
        data: {
          ...data,
          step_completed: currentStep,
          template_version: templateVersion,
          template_id: templateId,
        },
        completed,
      });
      if (result?.reload) {
        // The submission we had was archived by the CPA — force a reload
        setStaleSubmission(true);
        return false;
      }
      if (result?.error) {
        setError(result.error);
        return false;
      }
      if (result?.submission) {
        submissionIdRef.current = result.submission.id;
        submissionVersionRef.current = result.submission._version;
        setSubmission(result.submission);
        return result.submission;
      }
      return false;
    });
    return thisSave
      .catch(() => {
        toast({
          title: "השמירה נכשלה",
          description: "לא הצלחנו לשמור את התשובה. אפשר לנסות שוב.",
          variant: "destructive",
        });
        return false;
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  const handleNext = async (stepData) => {
    // Save first, then advance — prevents answer loss on fast clicks
    const savedSubmission = await updateSubmission(stepData);
    if (!savedSubmission) return false;
    setCurrentStep((prev) => prev + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return savedSubmission;
  };

  const handleStart = () =>
    startQuestionnaireWithSubmission({
      submission,
      createSubmission: () => updateSubmission({}),
      showFirstStep: () => setCurrentStep(1),
    });

  const handleComplete = async (stepData) => {
    const finalData = {
      ...stepData,
      step_completed: STEPS.length - 1,
      completed_at: new Date().toISOString(),
      template_version: templateVersion,
      template_id: templateId,
    };
    const savedSubmission = await updateSubmission(finalData, true);
    if (!savedSubmission) return false;
    setCurrentStep(STEPS.length - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
    return savedSubmission;
  };

  if (staleSubmission) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center border border-border shadow-sm">
          <div className="text-4xl mb-4">🔄</div>
          <h2 className="text-lg font-bold text-foreground mb-2">השאלון עודכן</h2>
          <p className="text-muted-foreground mb-6">רואה החשבון עדכן את השאלון שלך. יש לטעון מחדש כדי להמשיך.</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm"
          >
            טעינה מחדש
          </button>
        </div>
      </div>
    );
  }

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
          <h2 className="text-lg font-bold text-foreground mb-2">אופס</h2>
          <p className="text-muted-foreground">{error}</p>
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
              שאלון שנתי {client?.tax_year || 2024}
            </p>
            {client?.full_name && (
              <p className="text-xs text-muted-foreground truncate">שלום, {client.full_name.split(" ")[0]} 👋</p>
            )}
          </div>
          {isSaving && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
              <div className="w-3 h-3 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
              שומר...
            </div>
          )}
        </div>
        {step.type !== "welcome" && step.type !== "done" && (
          <div className="max-w-lg mx-auto px-4 pb-3">
            <ProgressBar current={progressIndex} total={contentSteps.length} />
          </div>
        )}
      </div>

      <div className="max-w-lg mx-auto px-4 py-6">
        {step.type === "welcome" && (
          <WelcomeStep client={client} onStart={handleStart} isStarting={isSaving} />
        )}

        {step.type === "question" && (
          <>
            {/* Step selector for completed steps */}
            {submission && (
              <div className="mb-4">
                <StepSelector
                  steps={activeSteps}
                  currentStepId={step.id}
                  completedSteps={completedStepIds}
                  incompleteSteps={incompleteStepIds}
                  onSelectStep={setCurrentStep}
                />
              </div>
            )}
            <QuestionStep
              stepConfig={step.config}
              submission={submission}
              onNext={handleNext}
              onComplete={handleComplete}
              onBack={() => setCurrentStep((prev) => prev - 1)}
              onSkip={() => setCurrentStep((prev) => prev + 1)}
              isFirst={currentStep === 1}
              isLast={currentStep === STEPS.length - 2}
              clientId={clientId}
              token={token}
              signedRecord={signedPdfsById[step.id] || null}
            />
          </>
        )}

        {step.type === "pdf_sign" && (() => {
          const cfg = step.config?.pdf_sign_config || {};
          const existingRecord = signedPdfsById[step.id];

          const stepSelector = submission && (
            <div className="mb-4">
              <StepSelector
                steps={activeSteps}
                currentStepId={step.id}
                completedSteps={completedStepIds}
                incompleteSteps={incompleteStepIds}
                onSelectStep={setCurrentStep}
              />
            </div>
          );

          // If already signed (complete or incomplete), show summary — don't auto-redirect
          if (existingRecord) {
            const isComplete = !existingRecord.incomplete;
            const hasFile = !!existingRecord.pdf_file_url;
            return (
              <>
              {stepSelector}
              <div className="bg-white rounded-3xl p-6 border border-border shadow-sm text-center" dir="rtl">
                <div className={`w-16 h-16 rounded-full ${isComplete ? "bg-green-100" : "bg-amber-100"} flex items-center justify-center mx-auto mb-4`}>
                  <span className="text-3xl">{isComplete ? "✅" : "⚠️"}</span>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">
                  {step.config?.title || "טופס לחתימה"}
                </h3>
                <p className="text-muted-foreground mb-4">
                  {isComplete ? "הטופס נחתם בהצלחה" : "הטופס נשמר אך לא הושלם — ישנם שדות חובה שלא מולאו"}
                </p>
                <div className="flex flex-col gap-2">
                  {hasFile && (
                    <button
                      disabled={pdfViewLoading[step.id]}
                      onClick={async () => {
                        setPdfViewLoading(prev => ({ ...prev, [step.id]: true }));
                        try {
                          const { signed_url } =
                            await fileClient.getPublicSignedPdfUrl({
                              client_id: clientId,
                              token,
                              step_id: step.id,
                            });
                          if (signed_url) window.open(signed_url, "_blank");
                        } catch (e) {
                          console.error("Failed to open signed PDF:", e);
                        } finally {
                          setPdfViewLoading(prev => ({ ...prev, [step.id]: false }));
                        }
                      }}
                      className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {pdfViewLoading[step.id] ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          טוען את הטופס...
                        </>
                      ) : (
                        <>📄 צפייה בטופס החתום</>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      navigate(`/questionnaire/sign?client=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}&step_id=${encodeURIComponent(step.id)}&template_id=${encodeURIComponent(cfg.pdf_template_id || "")}&template_name=${encodeURIComponent(cfg.template_name || "")}&step_title=${encodeURIComponent(step.config?.title || "")}`, {
                        state: { client, submission, stepConfig: step.config }
                      });
                    }}
                    className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm"
                  >
                    {isComplete ? "חתימה מחדש" : "חזרה להשלמת הטופס"}
                  </button>
                  <button
                    onClick={async () => {
                      const isLastStep = currentStep === STEPS.length - 2;
                      if (isLastStep) {
                        await handleComplete({});
                      } else {
                        setCurrentStep((prev) => prev + 1);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }
                    }}
                    className="w-full border border-border text-foreground rounded-xl py-3 font-semibold text-sm"
                  >
                    {currentStep === STEPS.length - 2 ? "סיום ✨" : "המשך לשלב הבא"}
                  </button>
                </div>
              </div>
              </>
            );
          }

          // First time — show start card
          return (
            <>
            {stepSelector}
            <div className="bg-white rounded-3xl p-6 border border-border shadow-sm text-center" dir="rtl">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl">📝</span>
              </div>
              <h3 className="text-lg font-bold text-foreground mb-2">
                {step.config?.title || "טופס לחתימה"}
              </h3>
              <p className="text-muted-foreground mb-4">
                יש למלא את השדות הנדרשים ולחתום על הטופס
              </p>
              <button
                onClick={() => {
                  navigate(`/questionnaire/sign?client=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}&step_id=${encodeURIComponent(step.id)}&template_id=${encodeURIComponent(cfg.pdf_template_id || "")}&template_name=${encodeURIComponent(cfg.template_name || "")}&step_title=${encodeURIComponent(step.config?.title || "")}`, {
                    state: { client, submission, stepConfig: step.config }
                  });
                }}
                className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm"
              >
                התחל תהליך חתימה
              </button>
            </div>
            </>
          );
        })()}

        {step.type === "done" && (
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
