import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { CloudUpload, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

export default function SyncAllDriveButton({ submissions }) {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState(null); // { synced, failed, errors: [{clientId, error}] }
  const [showErrors, setShowErrors] = useState(false);

  const handleSyncAll = async () => {
    setSyncing(true);
    setResult(null);
    setShowErrors(false);

    const toSync = submissions.filter((s) => s.client_id && (s.completed_at || s.step_completed >= 1));
    setProgress({ current: toSync.length, total: toSync.length });

    try {
      const res = await base44.functions.invoke("syncFilesToGoogleDrive", {
        sync_all: true,
        submission_ids: toSync.map((s) => ({ submission_id: s.id, client_id: s.client_id })),
      });
      const d = res?.data;
      setResult({ synced: d?.uploadCount || 0, skipped: d?.skippedCount || 0, failed: 0, total: toSync.length, errors: [] });
    } catch (err) {
      setResult({ synced: 0, skipped: 0, failed: 1, total: toSync.length, errors: [{ clientId: "כל ההגשות", error: err?.message || "שגיאה לא ידועה" }] });
    }

    setSyncing(false);
  };

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        className="w-full gap-2 rounded-xl"
        onClick={handleSyncAll}
        disabled={syncing}
      >
        {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudUpload className="w-4 h-4" />}
        {syncing ? `מסנכרן... ${progress.current}/${progress.total}` : "סנכרן Drive"}
      </Button>

      {syncing && progress.total > 0 && (
        <div className="space-y-1">
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-2 rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground text-center">{progressPct}%</p>
        </div>
      )}

      {result && (
        <div className="space-y-2">
          <div className={`flex items-center gap-2 text-sm rounded-xl px-3 py-2 border ${result.failed === 0 ? "text-green-700 bg-green-50 border-green-200" : "text-amber-700 bg-amber-50 border-amber-200"}`}>
            {result.failed === 0 ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            <span className="flex-1">
              {result.synced > 0 && `עלו ${result.synced} קבצים חדשים`}
              {result.synced === 0 && result.skipped > 0 && `הכל מסונכרן`}
              {result.skipped > 0 && ` · ${result.skipped} כבר קיימים`}
              {result.failed > 0 && ` · ${result.failed} נכשלו`}
            </span>
            {result.failed > 0 && (
              <button onClick={() => setShowErrors((v) => !v)} className="text-amber-700 hover:text-amber-900">
                {showErrors ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
          </div>

          {showErrors && result.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
              <p className="text-xs font-semibold text-red-700 mb-1">פירוט השגיאות:</p>
              {result.errors.map((e, i) => (
                <div key={i} className="text-xs text-red-600 bg-white rounded-lg px-3 py-2 border border-red-100">
                  <span className="font-mono text-red-400 text-[10px] block mb-0.5">לקוח: {e.clientId}</span>
                  {e.error}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}