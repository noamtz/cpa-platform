import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { getResponses, getStepSummary } from "@/lib/submission-compat";

export default function CompletionScreen({ client, submission, steps, onEdit }) {
  const summary = steps && steps.length > 0
    ? getStepSummary(submission, steps).filter(item => item.answer !== undefined)
    : [];

  // Get signed PDF records
  const signedPdfs = submission?.signed_pdfs ? JSON.parse(submission.signed_pdfs) : [];

  // Build PDF sign step summaries from the steps list
  const pdfSteps = steps
    ?.filter(s => s.response_type === "pdf_sign")
    .map(s => {
      const record = signedPdfs.find(r => r.step_id === s.id);
      return {
        stepId: s.id,
        label: s.title || s.pdf_sign_config?.template_name || "טופס לחתימה",
        emoji: s.emoji || "📄",
        signed: !!record,
        incomplete: !!record?.incomplete,
        exempted: !!record?.exempted_by_cpa,
      };
    }) || [];

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-5 text-center"
    >
      <div className="bg-white rounded-3xl p-8 border border-border shadow-sm">
        <div className="text-6xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-foreground mb-2">כל הכבוד!</h1>
        <p className="text-muted-foreground leading-relaxed">
          סיימת את השאלון בהצלחה.
          <br />
          <strong className="text-foreground">רואה החשבון שלך יעבור על המסמכים</strong> ויצור איתך קשר אם יצטרך משהו נוסף.
        </p>
      </div>

      {/* Summary */}
      {(summary.length > 0 || pdfSteps.length > 0) && (
        <div className="bg-white rounded-3xl p-5 border border-border shadow-sm text-right">
          <h2 className="font-bold text-foreground mb-4 text-base">סיכום הגשה</h2>
          <div className="space-y-2">
            {summary.map((item) => (
              <div key={item.stepId} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="text-sm text-foreground font-medium">
                  {item.emoji} {item.label}
                </span>
                {item.answer === false ? (
                  <span className="text-xs text-muted-foreground">לא רלוונטי</span>
                ) : item.answer === true ? (
                  <span className="text-xs text-green-600 font-medium">
                    ✓ {item.hasFiles ? `${item.fileCount} קבצים` : item.text ? "פורט" : "סומן"}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </div>
            ))}

            {/* PDF Sign Steps */}
            {pdfSteps.map((item) => (
              <div key={item.stepId} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                <span className="text-sm text-foreground font-medium">
                  {item.emoji} {item.label}
                </span>
                {item.signed && item.exempted ? (
                  <span className="text-xs text-blue-600 font-medium">✓ פטור רו"ח</span>
                ) : item.signed && !item.incomplete ? (
                  <span className="text-xs text-green-600 font-medium">✓ נחתם</span>
                ) : item.incomplete ? (
                  <span className="text-xs text-amber-500 font-medium">⚠ לא הושלם</span>
                ) : (
                  <span className="text-xs text-muted-foreground">טרם נחתם</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-primary/10 rounded-2xl p-4 text-sm text-primary font-medium">
        💌 נשמח לעמוד לרשותך בכל שאלה!
      </div>

      <Button
        onClick={onEdit}
        variant="outline"
        size="lg"
        className="w-full rounded-2xl h-12 text-base font-semibold"
      >
        ✏️ עריכת תשובות
      </Button>
    </motion.div>
  );
}