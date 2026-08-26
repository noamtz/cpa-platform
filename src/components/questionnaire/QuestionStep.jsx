import React, { useState, useRef, useEffect } from "react";
import { Button as UntypedButton } from "@/components/ui/button";
import { Textarea as UntypedTextarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, FileText, Check, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { getResponses } from "@/lib/submission-compat";
import { useNavigate } from "react-router-dom";
import { fileClient } from "@/api/file-client";

const Button = /** @type {React.ComponentType<any>} */ (UntypedButton);
const Textarea = /** @type {React.ComponentType<any>} */ (UntypedTextarea);

export default function QuestionStep({ stepConfig, submission, onNext, onComplete, onBack, isFirst, isLast, onSkip, clientId, token, signedRecord, isCpaMode = false, onExemptPdf = undefined, onUnexemptPdf = undefined }) {
  const stepId = stepConfig.id;
  const navigate = useNavigate();

  // Get existing response for this step from submission
  const responses = getResponses(submission);
  const existingResponse = responses[stepId];
  const existingAnswer = existingResponse?.answer;
  const existingFiles = existingResponse?.files || [];
  const existingFileNames = existingResponse?.file_names || [];
  const existingText = existingResponse?.text || "";

  // If skip_question is set, the answer is always implicitly "true"
  const skipQuestion = !!stepConfig.skip_question;
  const isAlreadyAnswered = existingAnswer !== undefined;
  const [answer, setAnswer] = useState(skipQuestion ? true : (existingAnswer !== undefined ? existingAnswer : null));
  const [files, setFiles] = useState([]); // only NEW files for THIS step session — [{uri, name}]
  const [textValue, setTextValue] = useState(existingText);
  const [selectedOptions, setSelectedOptions] = useState(existingResponse?.selected || []);
  const [uploading, setUploading] = useState(false);
  const [fileProgresses, setFileProgresses] = useState([]); // [{name, size, percent}]
  const [saving, setSaving] = useState(false);
  const [removedFiles, setRemovedFiles] = useState([]); // Track files to remove
  const fileRef = useRef(null);

  // Reset state when moving to a different step
  useEffect(() => {
    const resp = getResponses(submission);
    const stepResp = resp[stepId];
    setFiles([]);
    setRemovedFiles([]);
    setAnswer(skipQuestion ? true : (stepResp?.answer !== undefined ? stepResp.answer : null));
    setTextValue(stepResp?.text || "");
    setSelectedOptions(stepResp?.selected || []);
  }, [stepId]);

  if (!stepConfig) return null;

  const handleFileUpload = async (e) => {
    const selectedFiles = Array.from(e.target.files);
    if (!selectedFiles.length) return;
    setUploading(true);

    // Initialize per-file progress
    setFileProgresses(selectedFiles.map(f => ({
      name: f.name,
      size: (f.size / 1024).toFixed(0),
      percent: 0,
    })));

    try {
      const uploadOne = (file, index) => {
        const common = {
          file,
          purpose: "questionnaire_document",
          stepId,
          onProgress: (percent) =>
            setFileProgresses((prev) =>
              prev.map((item, itemIndex) =>
                itemIndex === index ? { ...item, percent } : item,
              ),
            ),
        };
        return isCpaMode
          ? fileClient.uploadCpaFile({
              ...common,
              ownerType: "submission",
              ownerId: submission.id,
            })
          : fileClient.uploadPublicFile({
              ...common,
              clientId,
              token,
              submissionId: submission.id,
            });
      };
      const uploaded = await Promise.all(
        selectedFiles.map((file, index) =>
          uploadOne(file, index).then((uri) => ({ uri, name: file.name })),
        ),
      );
      setFiles((prev) => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
      setFileProgresses([]);
    }
  };

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));
  const getFileName = (uri) => {
    // Try to extract original filename from URI/URL path
    try {
      const decoded = decodeURIComponent(uri);
      const parts = decoded.split('/');
      const last = parts[parts.length - 1].split('?')[0];
      // Strip leading timestamp/uuid prefix if present (e.g. "1234567890_myfile.pdf")
      return last.replace(/^\d+_/, '');
    } catch {
      return uri;
    }
  };
  const removeExistingFile = (idx) => {
    const fileToRemove = existingFiles[idx];
    setRemovedFiles((prev) => [...prev, fileToRemove]);
  };

  const handleContinue = async () => {
    // Build response for this step
    const stepResponse = { answer, title: stepConfig.title, emoji: stepConfig.emoji };

    if (answer && stepConfig.response_type === "upload" && stepConfig.upload_config) {
      const keptIndices = existingFiles.map((f, i) => i).filter(i => !removedFiles.includes(existingFiles[i]));
      const filteredExisting = keptIndices.map(i => existingFiles[i]);
      const filteredExistingNames = keptIndices.map(i => existingFileNames[i] || getFileName(existingFiles[i]));
      stepResponse.files = [...filteredExisting, ...files.map(f => f.uri)];
      stepResponse.file_names = [...filteredExistingNames, ...files.map(f => f.name)];
    } else if (answer && stepConfig.response_type === "text" && stepConfig.text_config) {
      stepResponse.text = textValue;
    } else if (answer && (stepConfig.response_type === "single_select" || stepConfig.response_type === "multi_select") && stepConfig.select_config) {
      stepResponse.selected = selectedOptions;
    }

    // Merge into full responses
    const currentResponses = getResponses(submission);
    const updatedResponses = { ...currentResponses, [stepId]: stepResponse };

    const data = {
      responses: JSON.stringify(updatedResponses),
    };

    setSaving(true);
    try {
      if (isLast) {
        await onComplete(data);
      } else {
        await onNext(data);
      }
    } finally {
      setSaving(false);
    }
  };

  const isPdfSignWithYes = stepConfig.response_type === "pdf_sign" && answer === true;
  const canContinue = (skipQuestion || answer !== null) && !uploading && (!isPdfSignWithYes || !!signedRecord);

  const uploadConfig = stepConfig.upload_config;
  const textConfig = stepConfig.text_config;
  const selectConfig = stepConfig.select_config;
  const acceptTypes = uploadConfig?.accept || ".pdf,.jpg,.jpeg,.png,.heic";

  return (
    <motion.div
      key={stepId}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="space-y-4"
    >
      {/* Question card — hidden when skip_question is on */}
      {!skipQuestion && (
        <div className="bg-white rounded-3xl p-6 border border-border shadow-sm">
          <div className="text-4xl mb-3 text-center">{stepConfig.emoji}</div>
          <h2 className="text-xl font-bold text-foreground text-center mb-5">{stepConfig.question}</h2>

          {/* Yes/No buttons */}
          <div className="grid grid-cols-1 gap-3">
            {[
              { value: true, label: stepConfig.yes_label, emoji: "✅" },
              { value: false, label: stepConfig.no_label, emoji: "⏭️" },
            ].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setAnswer(opt.value)}
                disabled={saving || uploading}
                className={`w-full rounded-2xl p-4 border-2 text-right flex items-center gap-3 transition-all ${
                  answer === opt.value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border hover:border-primary/40 text-foreground"
                } ${(saving || uploading) ? "opacity-50 cursor-not-allowed" : ""}`}
              >
                <span className="text-xl">{opt.emoji}</span>
                <span className="font-medium text-sm">{opt.label}</span>
                {answer === opt.value && (
                  <Check className="w-4 h-4 text-primary mr-auto" />
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Title header for skip_question steps */}
      {skipQuestion && (
        <div className="bg-white rounded-3xl px-6 py-4 border border-border shadow-sm flex items-center gap-3">
          <span className="text-3xl">{stepConfig.emoji}</span>
          <h2 className="text-lg font-bold text-foreground">{stepConfig.title}</h2>
        </div>
      )}

      {/* Conditional content */}
      <AnimatePresence>
        {answer === true && stepConfig.response_type === "upload" && uploadConfig && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-3xl p-6 border border-border shadow-sm overflow-hidden"
          >
            <h3 className="font-bold text-foreground mb-1">{uploadConfig.title}</h3>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed whitespace-pre-line">
              {uploadConfig.description}
            </p>

            {/* Existing files */}
            {existingFiles.length > 0 && (
              <div className="space-y-2 mb-3">
                <p className="text-xs text-muted-foreground font-medium">קבצים שהועלו קודם:</p>
                {existingFiles.map((f, i) => (
                 removedFiles.includes(f) ? null : (
                   <div key={i} className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2">
                     <FileText className="w-4 h-4 text-green-600 flex-shrink-0" />
                     <span className="text-xs text-green-700 flex-1 truncate" title={existingFileNames[i] || getFileName(f)}>{existingFileNames[i] || getFileName(f)}</span>
                     <button onClick={() => removeExistingFile(i)} className="text-red-500 hover:text-red-700">
                       <Trash2 className="w-4 h-4" />
                     </button>
                   </div>
                 )
                ))}
              </div>
            )}

            {/* New uploads */}
            {files.length > 0 && (
              <div className="space-y-2 mb-3">
                {files.map((f, i) => (
                 <div key={i} className="flex items-center gap-2 bg-primary/5 rounded-xl px-3 py-2">
                   <FileText className="w-4 h-4 text-primary flex-shrink-0" />
                   <span className="text-xs text-foreground flex-1 truncate" title={f.name}>{f.name}</span>
                   <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">
                     <X className="w-4 h-4" />
                   </button>
                 </div>
                ))}
              </div>
            )}

            {/* Upload area */}
            <div
              onClick={() => !uploading && fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (uploading) return;
                const droppedFiles = Array.from(e.dataTransfer.files);
                if (droppedFiles.length) {
                  handleFileUpload({ target: { files: droppedFiles } });
                }
              }}
              className={`w-full border-2 border-dashed rounded-2xl p-5 flex flex-col items-center gap-2 transition-all ${uploading ? "border-primary/40 bg-primary/5 cursor-default" : "border-border hover:border-primary/50 hover:bg-primary/5 cursor-pointer"}`}
            >
              {uploading ? (
                <div className="w-full space-y-3">
                  {fileProgresses.map((fp, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-foreground truncate max-w-[70%]">{fp.name}</span>
                        <span className="text-xs text-muted-foreground">{fp.size} KB • {fp.percent}%</span>
                      </div>
                      <div className="w-full bg-muted rounded-full h-2">
                        <div
                          className="bg-primary h-2 rounded-full transition-all duration-200"
                          style={{ width: `${fp.percent}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <Upload className="w-6 h-6 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{uploadConfig.upload_label}</span>
                  <span className="text-xs text-muted-foreground">PDF, תמונה, סריקה</span>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              multiple
              className="hidden"
              accept={acceptTypes}
              onChange={handleFileUpload}
            />
          </motion.div>
        )}

        {answer === true && stepConfig.response_type === "text" && textConfig && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-3xl p-6 border border-border shadow-sm overflow-hidden"
          >
            <h3 className="font-bold text-foreground mb-1">{textConfig.title}</h3>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed whitespace-pre-line">
              {textConfig.description}
            </p>
            <Textarea
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              placeholder={textConfig.placeholder || ""}
              className="rounded-xl border-border min-h-24 resize-none"
              rows={textConfig.rows || 4}
            />
          </motion.div>
        )}

        {answer === true && (stepConfig.response_type === "single_select" || stepConfig.response_type === "multi_select") && selectConfig && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-3xl p-6 border border-border shadow-sm overflow-hidden"
          >
            <h3 className="font-bold text-foreground mb-1">{selectConfig.title}</h3>
            <p className="text-sm text-muted-foreground mb-4 leading-relaxed whitespace-pre-line">
              {selectConfig.description}
            </p>
            <div className="space-y-2">
              {selectConfig.options?.map((option, idx) => {
                const isSelected = selectedOptions.includes(option);
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      if (stepConfig.response_type === "single_select") {
                        setSelectedOptions([option]);
                      } else {
                        setSelectedOptions(isSelected
                          ? selectedOptions.filter(o => o !== option)
                          : [...selectedOptions, option]
                        );
                      }
                    }}
                    className={`w-full rounded-xl p-4 border-2 text-right flex items-center gap-3 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5 text-foreground"
                        : "border-border hover:border-primary/40 text-foreground"
                    }`}
                  >
                    <span className="text-xl">{isSelected ? "✅" : "⚪"}</span>
                    <span className="font-medium text-sm flex-1">{option}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}

        {answer === false && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="bg-muted/60 rounded-2xl px-4 py-3 text-sm text-muted-foreground text-center"
          >
            סעיף זה לא רלוונטי עבורך — ממשיכים 👍
          </motion.div>
        )}

        {answer === true && stepConfig.response_type === "pdf_sign" && stepConfig.pdf_sign_config && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="bg-white rounded-3xl p-6 border border-border shadow-sm overflow-hidden text-center"
          >
            {isCpaMode && signedRecord?.exempted_by_cpa ? (
              <>
                <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">✅</span>
                </div>
                <h3 className="text-lg font-bold text-foreground mb-2">
                  {stepConfig.title || "טופס לחתימה"}
                </h3>
                <p className="text-muted-foreground mb-4">
                  סומן כלא נדרש ע"י רו"ח — הלקוח חתם מחוץ למערכת
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={onUnexemptPdf}
                    className="w-full bg-blue-600 text-white rounded-xl py-3 font-semibold text-sm"
                  >
                    בטל פטור
                  </button>
                </div>
              </>
            ) : signedRecord ? (() => {
              const isComplete = !signedRecord.incomplete;
              const hasFile = !!signedRecord.pdf_file_url;
              return (
                <>
                  <div className={`w-16 h-16 rounded-full ${isComplete ? "bg-green-100" : "bg-amber-100"} flex items-center justify-center mx-auto mb-4`}>
                    <span className="text-3xl">{isComplete ? "✅" : "⚠️"}</span>
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-2">
                    {stepConfig.title || "טופס לחתימה"}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    {isComplete ? "הטופס נחתם בהצלחה" : "הטופס נשמר אך לא הושלם — ישנם שדות חובה שלא מולאו"}
                  </p>
                  <div className="flex flex-col gap-2">
                    {hasFile && (
                      <button
                        onClick={async () => {
                          try {
                            const { signed_url } = isCpaMode
                              ? await fileClient.getCpaSubmissionFileUrl({
                                  submission_id: submission.id,
                                  source: "signed_pdf",
                                  step_id: stepConfig.id,
                                })
                              : await fileClient.getPublicSignedPdfUrl({
                                  client_id: clientId,
                                  token,
                                  step_id: stepConfig.id,
                                });
                            if (signed_url) window.open(signed_url, "_blank");
                          } catch (e) {
                            console.error("Failed to open signed PDF:", e);
                          }
                        }}
                        className="w-full bg-green-600 text-white rounded-xl py-3 font-semibold text-sm flex items-center justify-center gap-2"
                      >
                        📄 צפייה בטופס החתום
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const cfg = stepConfig.pdf_sign_config || {};
                        navigate(`/questionnaire/sign?client=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}&step_id=${encodeURIComponent(stepConfig.id)}&template_id=${encodeURIComponent(cfg.pdf_template_id || "")}&template_name=${encodeURIComponent(cfg.template_name || "")}&step_title=${encodeURIComponent(stepConfig.title || "")}`, {
                          state: { submission, stepConfig }
                        });
                      }}
                      className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm"
                    >
                      {isComplete ? "חתימה מחדש" : "חזרה להשלמת הטופס"}
                    </button>
                    {isCpaMode && (
                      <button
                        onClick={onExemptPdf}
                        className="w-full border border-blue-300 text-blue-700 rounded-xl py-3 font-semibold text-sm"
                      >
                        סמן כלא נדרש (פטור רו"ח)
                      </button>
                    )}
                  </div>
                </>
              );
            })() : (
              <>
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <span className="text-3xl">📝</span>
                </div>
                <h3 className="font-bold text-foreground mb-1">{stepConfig.title}</h3>
                <p className="text-sm text-muted-foreground mb-4">יש למלא את השדות הנדרשים ולחתום על הטופס</p>
                <button
                  onClick={async () => {
                    // Save answer=true before navigating to signing page
                    const currentResponses = getResponses(submission);
                    const updatedResponses = { ...currentResponses, [stepId]: { answer: true, title: stepConfig.title, emoji: stepConfig.emoji } };
                    const savedSubmission = await onNext({ responses: JSON.stringify(updatedResponses) });
                    if (savedSubmission === false) return;
                    const cfg = stepConfig.pdf_sign_config || {};
                    navigate(`/questionnaire/sign?client=${encodeURIComponent(clientId)}&token=${encodeURIComponent(token)}&step_id=${encodeURIComponent(stepId)}&template_id=${encodeURIComponent(cfg.pdf_template_id || "")}&template_name=${encodeURIComponent(cfg.template_name || "")}&step_title=${encodeURIComponent(stepConfig.title || "")}`, {
                      state: { submission: savedSubmission || submission, stepConfig }
                    });
                  }}
                  className="w-full bg-primary text-white rounded-xl py-3 font-semibold text-sm"
                >
                  התחל תהליך חתימה
                </button>
                {isCpaMode && (
                  <button
                    onClick={onExemptPdf}
                    className="w-full border border-blue-300 text-blue-700 rounded-xl py-3 font-semibold text-sm"
                  >
                    סמן כלא נדרש (פטור רו"ח)
                  </button>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation buttons */}
      <div className="flex gap-3">
        {!isFirst && (
          <Button
            onClick={onBack}
            variant="outline"
            size="lg"
            className="rounded-2xl h-14 px-5"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        )}
        {isAlreadyAnswered && answer !== null && (
          <Button
            onClick={onSkip}
            variant="ghost"
            size="lg"
            className="rounded-2xl h-14 px-4 text-muted-foreground hover:text-foreground"
          >
            דלג ⏭️
          </Button>
        )}
        <Button
          onClick={handleContinue}
          disabled={!canContinue || saving}
          size="lg"
          className="flex-1 bg-primary hover:bg-primary/90 text-white rounded-2xl h-14 text-base font-semibold gap-2 shadow-sm"
        >
          {saving ? (
            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              {isLast ? "סיום ✨" : "המשך"}
              {!isLast && <ChevronLeft className="w-5 h-5" />}
            </>
          )}
        </Button>
      </div>
    </motion.div>
  );
}
