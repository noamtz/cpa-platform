import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

/**
 * Shown when restoring an archived submission (toRestore) conflicts with an existing
 * active submission (conflicting) for the same client + tax year.
 *
 * The CPA must pick which one stays active — the other gets archived.
 */
export default function RestoreSubmissionDialog({ toRestore, conflicting, clientName, onChoose, onCancel }) {
  const fmt = (sub) => {
    const date = sub?.updated_date || sub?.created_date;
    return date ? new Date(date).toLocaleDateString("he-IL", { day: "numeric", month: "long", year: "numeric" }) : "—";
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-lg" dir="rtl">
        <DialogHeader className="text-right">
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            התנגשות הגשות — שנת {toRestore.tax_year}
          </DialogTitle>
          <DialogDescription className="text-right mt-2 text-sm text-foreground">
            ל<strong>{clientName}</strong> כבר קיימת הגשה פעילה לשנת <strong>{toRestore.tax_year}</strong>.
            <br />
            בחר <strong>איזו הגשה תישאר פעילה</strong> — האחרת תועבר לארכיון.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {/* Option A: keep the one being restored */}
          <button
            onClick={() => onChoose("restore")}
            className="w-full text-right border-2 border-border hover:border-primary rounded-xl p-4 transition-all hover:bg-primary/5 space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs bg-green-100 text-green-700 rounded-md px-2 py-0.5 font-medium">שחזר זו</span>
              <span className="font-semibold text-sm text-foreground">הגשה מהארכיון</span>
            </div>
            <p className="text-xs text-muted-foreground">
              עודכן לאחרונה: {fmt(toRestore)}
              {toRestore.cpa_status && ` • סטטוס: ${toRestore.cpa_status}`}
            </p>
            <p className="text-xs text-amber-600">← ההגשה הפעילה הנוכחית תועבר לארכיון</p>
          </button>

          {/* Option B: keep the currently active one */}
          <button
            onClick={() => onChoose("keep_existing")}
            className="w-full text-right border-2 border-border hover:border-primary rounded-xl p-4 transition-all hover:bg-primary/5 space-y-1"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs bg-blue-100 text-blue-700 rounded-md px-2 py-0.5 font-medium">שמור זו</span>
              <span className="font-semibold text-sm text-foreground">הגשה פעילה נוכחית</span>
            </div>
            <p className="text-xs text-muted-foreground">
              עודכן לאחרונה: {fmt(conflicting)}
              {conflicting.cpa_status && ` • סטטוס: ${conflicting.cpa_status}`}
            </p>
            <p className="text-xs text-amber-600">← ההגשה מהארכיון תישאר בארכיון</p>
          </button>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onCancel} className="rounded-xl">ביטול</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}