import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { fileClient } from "@/api/file-client";
import { getStepProgress, getAllFiles, getStepSummary } from "@/lib/submission-compat";
import { DEFAULT_STEPS, getActiveSteps } from "@/lib/default-template";
import { filterStepsByClientConditions } from "@/lib/questionnaire-template";

import { useToast } from "@/components/ui/use-toast";
import { Badge as UntypedBadge } from "@/components/ui/badge";
import { Button as UntypedButton } from "@/components/ui/button";
import { Copy, Check, ChevronDown, ChevronUp, Phone, Mail, FileText, Download, ExternalLink, RefreshCw, X, Pencil, ClipboardEdit, Archive, CloudUpload } from "lucide-react";
import EditClientModal from "@/components/dashboard/EditClientModal";
import CpaAuditBadge from "@/components/dashboard/CpaAuditBadge";
import RestoreSubmissionDialog from "@/components/dashboard/RestoreSubmissionDialog";
import { Dialog, DialogContent as UntypedDialogContent, DialogDescription as UntypedDialogDescription, DialogFooter, DialogHeader, DialogTitle as UntypedDialogTitle } from "@/components/ui/dialog";

const Badge = /** @type {React.ComponentType<any>} */ (UntypedBadge);
const Button = /** @type {React.ComponentType<any>} */ (UntypedButton);
const DialogContent = /** @type {React.ComponentType<any>} */ (UntypedDialogContent);
const DialogDescription = /** @type {React.ComponentType<any>} */ (UntypedDialogDescription);
const DialogTitle = /** @type {React.ComponentType<any>} */ (UntypedDialogTitle);

function getFileExt(url) {
  const clean = url?.split('?')[0] || '';
  return clean.split('.').pop()?.toLowerCase() || 'file';
}

function FilePreviewModal({ url, label, onClose }) {
  const ext = getFileExt(url);
  const isImage = ['jpg', 'jpeg', 'png', 'heic', 'webp', 'gif'].includes(ext);
  const isPdf = ext === 'pdf';

  const handleDownload = async () => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = label;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Download failed:', err);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-sm text-foreground truncate">{label}</span>
          <div className="flex items-center gap-2">
            <button onClick={handleDownload} className="text-primary hover:text-primary/80 p-1" title="הורדה">
              <Download className="w-4 h-4" />
            </button>
            <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 p-1" title="פתיחה בכרטיסייה">
              <ExternalLink className="w-4 h-4" />
            </a>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto flex items-center justify-center bg-muted/30 p-4">
          {isImage && (
            <img src={url} alt={label} className="max-w-full max-h-[70vh] object-contain rounded-lg" />
          )}
          {isPdf && (
            <iframe src={url} className="w-full h-[70vh] rounded-lg border border-border" title={label} />
          )}
          {!isImage && !isPdf && (
            <div className="text-center space-y-3">
              <FileText className="w-16 h-16 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground text-sm">לא ניתן להציג קובץ מסוג <strong>.{ext}</strong> בדפדפן</p>
              <a href={url} download className="inline-flex items-center gap-2 text-primary text-sm font-medium hover:underline">
                <Download className="w-4 h-4" />
                הורד קובץ
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Default steps used as fallback for displaying submissions
const FALLBACK_STEPS = getActiveSteps(DEFAULT_STEPS);

export default function ClientRow({ client, submission, allSubmissions = [], statusConfig, onRefresh, templateSteps }) {
  // Parse CPA audit log from the displayed submission
  const getCpaAuditByStep = (sub) => {
    if (!sub?.cpa_audit_log) return {};
    try {
      const log = JSON.parse(sub.cpa_audit_log);
      const byStep = {};
      for (const entry of log) {
        if (!entry.step_id) continue;
        if (!byStep[entry.step_id]) byStep[entry.step_id] = [];
        byStep[entry.step_id].push(entry);
      }
      return byStep;
    } catch { return {}; }
  };
  // Use provided template steps or fallback to defaults, then filter by client conditions
  const baseSteps = templateSteps && templateSteps.length > 0 ? templateSteps : FALLBACK_STEPS;
  const activeSteps = filterStepsByClientConditions(baseSteps, client);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [viewingSubmission, setViewingSubmission] = useState(null); // null = current year
  const [downloading, setDownloading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [changingYear, setChangingYear] = useState(false);
  const [previewFile, setPreviewFile] = useState(null); // { url, label }
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [osekTypeModalOpen, setOsekTypeModalOpen] = useState(false);
  const [restoreConflict, setRestoreConflict] = useState(null);
  const { toast } = useToast();

  // The submission currently being displayed in the expanded panel
  const displayedSubmission = viewingSubmission ?? submission;
  const getSignedUrl = async ({
    stepId,
    source = "response",
    fileIndex = undefined,
  }) => {
    try {
      const { signed_url } = await fileClient.getCpaSubmissionFileUrl({
        submission_id: displayedSubmission.id,
        source,
        step_id: stepId,
        ...(source === "response" ? { file_index: fileIndex } : {}),
      });
      return signed_url;
    } catch {
      return null;
    }
  };
  const progress = getStepProgress(submission, activeSteps);
  const displayedProgress = getStepProgress(displayedSubmission, activeSteps);

  // Historical submissions = all except the current active year
  const pastSubmissions = allSubmissions.filter((s) => s.id !== submission?.id);

  const handleChangeYear = async (e) => {
    e.stopPropagation();
    if (!client.osek_type) {
      setOsekTypeModalOpen(true);
      return;
    }
    const newYear = prompt(`שנת המס הנוכחית: ${client.tax_year || 2024}\nהזן שנת מס חדשה:`);
    if (!newYear || Number.isNaN(Number(newYear))) return;
    setChangingYear(true);
    await base44.functions.invoke("changeClientTaxYear", {
      client_id: client.id,
      tax_year: parseInt(newYear),
    });
    toast({ title: 'שנת המס עודכנה', description: `${client.full_name} — שנת ${newYear}` });
    onRefresh();
    setChangingYear(false);
  };

  const handleDownloadAll = async () => {
    setDownloading(true);
    try {
      await fileClient.downloadSubmissionZip(displayedSubmission.id);

    } catch (err) {
      toast({ title: 'שגיאה', description: err.message, variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };



  const getLink = () => {
    const base = window.location.origin;
    return `${base}/questionnaire?client=${client.id}&token=${client.token || ""}`;
  };

  const copyLink = async (e) => {
    e.stopPropagation();
    if (!client.token) {
      await regenerateToken(e);
      return;
    }
    await navigator.clipboard.writeText(getLink());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerateToken = async (e) => {
    e?.stopPropagation();
    const newToken = Math.random().toString(36).substring(2, 18);
    await base44.entities.Client.update(client.id, { token: newToken });
    toast({ title: "טוקן נוצר", description: "הלינק מוכן להעתקה עכשיו" });
    onRefresh();
  };





  // CPA status is stored on the submission; fall back to client.status for legacy data
  const cpaStatus = submission?.cpa_status || ((['ready_for_ira', 'reviewed'].includes(client.status)) ? client.status : null);

  // Override display status based on actual progress — but don't downgrade CPA-set statuses
  let displayStatus = cpaStatus || client.status;
  if (!['ready_for_ira', 'reviewed'].includes(displayStatus)) {
    if (submission && progress === 100) {
      displayStatus = 'completed';
    } else if (submission && progress < 100) {
      displayStatus = 'in_progress';
    }
  }
  const displayConfig = statusConfig[displayStatus] || statusConfig["pending"];
  const Icon = displayConfig.icon;

  return (
    <div className="bg-white rounded-2xl border border-border overflow-hidden hover:shadow-md transition-shadow">
      {/* Main row */}
      <div
        className="p-4 flex items-center gap-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Avatar */}
        <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0 font-bold text-primary text-sm">
          {client.full_name?.charAt(0) || "?"}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground truncate">{client.full_name}</span>
            <Badge className={`text-xs border ${displayConfig.color} font-medium`}>
              {displayConfig.label}
            </Badge>
            {submission && (
              <span className="text-xs text-muted-foreground">— שנת {submission.tax_year || 2024}</span>
            )}
            {client.osek_type && (
              <span className="text-xs bg-secondary text-secondary-foreground rounded-md px-2 py-0.5 font-medium">{client.osek_type}</span>
            )}
            {client.pricing != null && (
              <span className="text-xs bg-primary/10 text-primary rounded-md px-2 py-0.5 font-medium">₪{Number(client.pricing).toLocaleString("he-IL")}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 bg-muted rounded-full h-1.5 max-w-32">
              <div
                className="bg-primary h-1.5 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">{progress}%</span>
          </div>
        </div>

        {/* Expand */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={!client.token ? "destructive" : "outline"}
            onClick={copyLink}
            className="gap-1.5 rounded-lg text-xs h-8"
          >
            {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
            {copied ? "הועתק!" : !client.token ? "תקן לינק" : "לינק"}
          </Button>
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border p-4 bg-muted/30 space-y-3">

          {/* Year tabs — only shown if there are multiple submissions */}
          {allSubmissions.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setViewingSubmission(null)}
                className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                  !viewingSubmission
                    ? "bg-primary text-white border-primary"
                    : "bg-white text-muted-foreground border-border hover:border-primary hover:text-primary"
                }`}
              >
                שנת {submission?.tax_year || client.tax_year || 2024} (נוכחי)
              </button>
              {pastSubmissions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setViewingSubmission(s)}
                  className={`text-xs px-3 py-1 rounded-full font-medium border transition-colors ${
                    viewingSubmission?.id === s.id
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-muted-foreground border-border hover:border-primary hover:text-primary"
                  }`}
                >
                  שנת {s.tax_year}
                </button>
              ))}
            </div>
          )}

          {/* Contact */}
          <div className="flex flex-wrap gap-4 text-sm">
            {client.email && (
              <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-primary">
                <Mail className="w-3.5 h-3.5" />
                {client.email}
              </a>
            )}
            {client.phone && (
              <a href={`tel:${client.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-primary">
                <Phone className="w-3.5 h-3.5" />
                {client.phone}
              </a>
            )}
          </div>

          {/* Osek type & pricing */}
          {(client.osek_type || client.pricing) && (
            <div className="flex flex-wrap gap-3 text-sm">
              {client.osek_type && (
                <span className="bg-secondary text-secondary-foreground rounded-lg px-3 py-1 text-xs font-medium">
                  {client.osek_type}
                </span>
              )}
              {client.pricing !== undefined && client.pricing !== null && (
                <span className="bg-primary/10 text-primary rounded-lg px-3 py-1 text-xs font-medium">
                  ₪{Number(client.pricing).toLocaleString("he-IL")}
                </span>
              )}
            </div>
          )}

          {/* Progress breakdown */}
          {displayedSubmission && (() => {
            const cpaAuditByStep = getCpaAuditByStep(displayedSubmission);
            // Exclude pdf_sign steps from summary — they're shown separately via pdfStepItems
            const pdfSignStepIds = new Set(activeSteps.filter(s => s.response_type === 'pdf_sign').map(s => s.id));
            const summary = getStepSummary(displayedSubmission, activeSteps).filter(item => !pdfSignStepIds.has(item.stepId));

            // Build PDF sign step entries — from signed_pdfs records + "no" answers + unanswered
            const signedPdfsMap = {};
            if (displayedSubmission.signed_pdfs) {
              try {
                JSON.parse(displayedSubmission.signed_pdfs).forEach(r => { signedPdfsMap[r.step_id] = r; });
              } catch {}
            }
            const displayedResponses = (() => { try { return JSON.parse(displayedSubmission.responses || '{}'); } catch { return {}; } })();
            const pdfStepItems = activeSteps
              .filter(s => s.response_type === 'pdf_sign')
              .map(s => {
                const record = signedPdfsMap[s.id];
                const resp = displayedResponses[s.id];
                if (record) {
                  return { stepId: s.id, emoji: s.emoji || "📄", label: s.title || record.template_name, answer: true, isPdf: true, incomplete: record.incomplete, exempted: !!record.exempted_by_cpa };
                } else if (resp?.answer === false) {
                  return { stepId: s.id, emoji: s.emoji || "📄", label: s.title, answer: false, isPdf: true };
                } else {
                  return { stepId: s.id, emoji: s.emoji || "📄", label: s.title, answer: undefined, isPdf: true };
                }
              });

            const allItems = /** @type {any[]} */ ([...summary, ...pdfStepItems]);
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {allItems.map((item) => (
                  <div
                    key={item.stepId}
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${
                      item.isPdf && item.exempted
                        ? "bg-blue-50 text-blue-700 border border-blue-200"
                        : item.isPdf && item.incomplete
                        ? "bg-amber-50 text-amber-700 border border-amber-200"
                        : item.answer === false
                        ? "bg-muted text-muted-foreground"
                        : item.answer === true
                        ? "bg-green-50 text-green-700 border border-green-200"
                        : item.answer === undefined
                        ? "bg-muted/60 text-muted-foreground border border-border"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    {item.isPdf
                      ? (item.answer === false ? "— " : item.exempted ? "✓ " : item.answer && !item.incomplete ? "✓ " : item.incomplete ? "⚠ " : "⏳ ")
                      : (item.answer === undefined ? "⏳ " : item.answer === false ? "— " : "✓ ")
                    }
                    {item.emoji} {item.label}
                    <CpaAuditBadge auditEntries={cpaAuditByStep[item.stepId]} />
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Files section */}
          {displayedSubmission && (() => {
            const fileGroups = getAllFiles(displayedSubmission, activeSteps).map(
              (group) => ({ ...group, source: "response" }),
            );

            // Add signed PDFs to fileGroups so they're included in the ZIP download
            if (displayedSubmission.signed_pdfs) {
              try {
                JSON.parse(displayedSubmission.signed_pdfs).forEach((record) => {
                  if (record.pdf_file_url) {
                    fileGroups.push({
                      stepId: record.step_id,
                      label: record.step_title || record.template_name || "טופס חתום",
                      files: [record.pdf_file_url],
                      file_names: [`${record.step_title || "טופס חתום"}.pdf`],
                      source: "signed_pdf",
                    });
                  }
                });
              } catch {}
            }

            if (fileGroups.length === 0) return null;

            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-foreground">📎 קבצים שהועלו</p>
                  <button
                    onClick={handleDownloadAll}
                    disabled={downloading}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {downloading ? 'מכין ZIP...' : 'הורד הכל (ZIP)'}
                  </button>
                </div>
                {fileGroups.map((group) => (
                  <div key={group.stepId} className="bg-white rounded-xl border border-border p-3 space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">{group.label}</p>
                    {group.files.map((fileUri, idx) => {
                      const ext = getFileExt(fileUri);
                      const fileName = group.file_names?.[idx] || `קובץ ${idx + 1}`;
                      const fileLabel = `${group.label} — ${fileName}`;
                      return (
                        <div
                          key={idx}
                          className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 cursor-pointer hover:bg-primary/5 transition-colors"
                          onClick={async () => {
                            const signedUrl = await getSignedUrl({
                              stepId: group.stepId,
                              source: group.source,
                              fileIndex: idx,
                            });
                            if (signedUrl) setPreviewFile({ url: signedUrl, label: fileLabel });
                          }}
                        >
                          <FileText className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          <span className="text-xs text-foreground flex-1 truncate" title={fileName}>{fileName}</span>
                          <span className="text-xs font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded uppercase">{ext}</span>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const signedUrl = await getSignedUrl({
                                stepId: group.stepId,
                                source: group.source,
                                fileIndex: idx,
                              });
                              if (signedUrl) window.open(signedUrl, '_blank');
                            }}
                            className="text-primary hover:text-primary/80"
                            title="פתיחה"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const signedUrl = await getSignedUrl({
                                stepId: group.stepId,
                                source: group.source,
                                fileIndex: idx,
                              });
                              if (!signedUrl) return;
                              const res = await fetch(signedUrl);
                              if (!res.ok) return;
                              const blob = await res.blob();
                              const a = document.createElement('a');
                              a.href = URL.createObjectURL(blob);
                              a.download = `${group.label}_${idx + 1}.${ext}`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                            }}
                            className="text-primary hover:text-primary/80"
                            title="הורדה"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Signed PDFs section */}
          {displayedSubmission?.signed_pdfs && (() => {
            let signedPdfs = [];
            try { signedPdfs = JSON.parse(displayedSubmission.signed_pdfs); } catch {}
            if (!signedPdfs.length) return null;

            return (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground">✍️ טפסים חתומים</p>
                {signedPdfs.map((record) => {
                  const isComplete = !record.incomplete;
                  const hasFile = !!record.pdf_file_url;
                  return (
                    <div
                      key={record.step_id}
                      className={`rounded-xl border p-3 space-y-1.5 ${
                        isComplete ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">
                          {isComplete ? "✅" : "⚠️"} {record.step_title || record.template_name || "טופס חתום"}
                        </span>
                        <span className={`text-xs font-medium ${isComplete ? "text-green-700" : "text-amber-700"}`}>
                          {isComplete ? "נחתם" : "לא הושלם"}
                        </span>
                      </div>
                      {hasFile && (
                        <div
                          className="flex items-center gap-2 bg-white/60 rounded-lg px-3 py-2 cursor-pointer hover:bg-white transition-colors"
                          onClick={async () => {
                            const signedUrl = await getSignedUrl({
                              stepId: record.step_id,
                              source: "signed_pdf",
                            });
                            if (signedUrl) setPreviewFile({ url: signedUrl, label: record.step_title || "טופס חתום" });
                          }}
                        >
                          <FileText className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          <span className="text-xs text-foreground flex-1">הצג טופס חתום</span>
                          <span className="text-xs font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded uppercase">pdf</span>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const signedUrl = await getSignedUrl({
                                stepId: record.step_id,
                                source: "signed_pdf",
                              });
                              if (signedUrl) window.open(signedUrl, '_blank');
                            }}
                            className="text-primary hover:text-primary/80"
                            title="פתיחה"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              const signedUrl = await getSignedUrl({
                                stepId: record.step_id,
                                source: "signed_pdf",
                              });
                              if (!signedUrl) return;
                              const res = await fetch(signedUrl);
                              if (!res.ok) return;
                              const blob = await res.blob();
                              const a = document.createElement('a');
                              a.href = URL.createObjectURL(blob);
                              a.download = `${record.step_title || "signed-form"}.pdf`;
                              document.body.appendChild(a);
                              a.click();
                              document.body.removeChild(a);
                            }}
                            className="text-primary hover:text-primary/80"
                            title="הורדה"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {!hasFile && (
                        <p className="text-xs text-muted-foreground">קובץ PDF לא נוצר (הטופס לא הושלם)</p>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/* Text responses (e.g., additional income notes) */}
          {displayedSubmission && (() => {
            const pdfSignStepIds2 = new Set(activeSteps.filter(s => s.response_type === 'pdf_sign').map(s => s.id));
            const summary = getStepSummary(displayedSubmission, activeSteps).filter(item => !pdfSignStepIds2.has(item.stepId));
            const textItems = summary.filter(s => s.answer === true && s.text);
            if (textItems.length === 0) return null;
            return textItems.map(item => (
              <div key={item.stepId} className="bg-blue-50 rounded-xl p-3 text-sm text-blue-700 border border-blue-200">
                <span className="font-medium">{item.emoji} {item.label}: </span>
                {item.text}
              </div>
            ));
          })()}

          {/* Last activity */}
          {client.last_activity && (
            <p className="text-xs text-muted-foreground">
              פעילות אחרונה:{" "}
              {new Date(client.last_activity).toLocaleDateString("he-IL", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          )}

          {/* Actions */}
          <div className="flex justify-between items-center pt-1 gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={handleChangeYear}
                disabled={changingYear}
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                שנת מס: {client.tax_year || 2024} — החלף שנה
              </button>
              {displayedSubmission && !displayedSubmission.is_archived && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`לארכב את הגשת שנת ${displayedSubmission.tax_year}?`)) return;
                    await base44.entities.Submission.update(displayedSubmission.id, { is_archived: true });
                    toast({ title: "הגשה הועברה לארכיון", description: `שנת ${displayedSubmission.tax_year}` });
                    onRefresh();
                  }}
                  className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1"
                >
                  <Archive className="w-3 h-3" />
                  ארכב הגשה
                </button>
              )}
              {displayedSubmission?.is_archived && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const allActive = await base44.entities.Submission.filter({ client_id: client.id, tax_year: displayedSubmission.tax_year });
                    const conflict = allActive.find(s => !s.is_archived && s.id !== displayedSubmission.id);
                    if (conflict) {
                      setRestoreConflict({ toRestore: displayedSubmission, conflicting: conflict, clientName: client.full_name });
                    } else {
                      await base44.functions.invoke("restoreSubmission", {
                        submission_id: displayedSubmission.id,
                      });
                      toast({ title: "הגשה שוחזרה", description: `שנת ${displayedSubmission.tax_year}` });
                      onRefresh();
                    }
                  }}
                  className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1"
                >
                  <Archive className="w-3 h-3" />
                  שחזר הגשה
                </button>
              )}
              {client.status === 'completed' && !submission && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    await base44.entities.Client.update(client.id, { status: 'pending' });
                    onRefresh();
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                  title="איפוס סטטוס"
                >
                  <RefreshCw className="w-3 h-3" />
                  איפוס סטטוס
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setEditModalOpen(true); }}
                className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" />
                עריכת פרטים
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  window.location.href = `/cpa-fill?client=${client.id}`;
                }}
                className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1 font-medium"
              >
                <ClipboardEdit className="w-3 h-3" />
                מלא עבור לקוח
              </button>
              {displayedSubmission && (
                <button
                  disabled={syncing}
                  onClick={async (e) => {
                    e.stopPropagation();
                    setSyncing(true);
                    try {
                      const res = await base44.functions.invoke('syncFilesToGoogleDrive', {
                        submission_id: displayedSubmission.id,
                        client_id: client.id,
                      });
                      const { uploadCount = 0, skippedCount = 0 } = res.data || {};
                      const desc = uploadCount > 0
                        ? `${uploadCount} קבצים הועלו לדרייב בהצלחה${skippedCount > 0 ? `, ${skippedCount} כבר קיימים` : ''}`
                        : skippedCount > 0
                        ? `כל ${skippedCount} הקבצים כבר קיימים בדרייב`
                        : "לא נמצאו קבצים לסנכרון";
                      toast({ title: "✅ סנכרון הושלם", description: desc });
                    } catch (err) {
                      toast({ title: "שגיאה בסנכרון", description: err.message, variant: "destructive" });
                    } finally {
                      setSyncing(false);
                    }
                  }}
                  className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium disabled:opacity-50"
                >
                  <CloudUpload className="w-3 h-3" />
                  {syncing ? "מסנכרן..." : "סנכרן לדרייב"}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {(displayStatus === "completed") && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!submission) return;
                    await base44.functions.invoke("transitionSubmissionStatus", {
                      client_id: client.id,
                      submission_id: submission.id,
                      status: "ready_for_ira",
                    });
                    onRefresh();
                  }}
                  className="text-xs bg-purple-600 text-white hover:bg-purple-700 rounded-lg px-3 py-1.5 font-medium flex items-center gap-1"
                >
                  ✓ אשר להגשה לרמ״ש
                </button>
              )}
              {(cpaStatus === "ready_for_ira" || client.status === "ready_for_ira") && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!submission) return;
                    await base44.functions.invoke("transitionSubmissionStatus", {
                      client_id: client.id,
                      submission_id: submission.id,
                      status: "reviewed",
                    });
                    onRefresh();
                  }}
                  className="text-xs bg-gray-600 text-white hover:bg-gray-700 rounded-lg px-3 py-1.5 font-medium flex items-center gap-1"
                >
                  ✓ סמן כהוגש
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {editModalOpen && (
        <EditClientModal
          client={client}
          onClose={() => setEditModalOpen(false)}
          onSaved={onRefresh}
        />
      )}

      {previewFile && (
        <FilePreviewModal
          url={previewFile.url}
          label={previewFile.label}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {restoreConflict && (
        <RestoreSubmissionDialog
          toRestore={restoreConflict.toRestore}
          conflicting={restoreConflict.conflicting}
          clientName={restoreConflict.clientName}
          onCancel={() => setRestoreConflict(null)}
          onChoose={async (choice) => {
            const { toRestore, conflicting } = restoreConflict;
            if (choice === "restore") {
              await base44.functions.invoke("restoreSubmission", {
                submission_id: toRestore.id,
                conflicting_submission_id: conflicting.id,
              });
              toast({ title: "הגשה שוחזרה", description: `שנת ${toRestore.tax_year}` });
            } else {
              toast({ title: "הגשה הפעילה נשמרה ללא שינוי" });
            }
            setRestoreConflict(null);
            onRefresh();
          }}
        />
      )}

      <Dialog open={osekTypeModalOpen} onOpenChange={setOsekTypeModalOpen}>
         <DialogContent className="max-w-md" dir="rtl">
           <DialogHeader className="text-right">
             <DialogTitle className="text-right">⚠️ דרוש סוג עוסק</DialogTitle>
             <DialogDescription className="text-right space-y-3 mt-4">
               <p>לא ניתן להתחיל שנת מס חדשה ללקוח <strong>{client.full_name}</strong> בלי להגדיר את סוג העוסק שלו קודם.</p>
               <p className="text-sm">הסיבה: אתה השתמשת בתנאי הצגה חדש בשאלון המבוסס על סוג העוסק. לקוחות ישנים חסרים מידע זה בחשבונם.</p>
               <p className="text-sm font-medium text-primary">אנא עדכן את סוג העוסק בעריכת הפרטים ואז תוכל להתחיל שנת מס חדשה.</p>
             </DialogDescription>
           </DialogHeader>
           <DialogFooter className="flex-row-reverse gap-2">
             <Button
               onClick={() => {
                 setOsekTypeModalOpen(false);
                 setEditModalOpen(true);
               }}
               className="bg-primary hover:bg-primary/90 text-white"
             >
               עריכת סוג עוסק
             </Button>
             <Button variant="outline" onClick={() => setOsekTypeModalOpen(false)}>
               סגור
             </Button>
           </DialogFooter>
         </DialogContent>
       </Dialog>

    </div>
  );
}
