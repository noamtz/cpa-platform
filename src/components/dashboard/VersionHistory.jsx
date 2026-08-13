import React, { useState, useEffect } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function VersionHistory() {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [viewingVersion, setViewingVersion] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    loadVersions();
  }, []);

  const loadVersions = async () => {
    setLoading(true);
    try {
      const appId = import.meta.env.VITE_BASE44_APP_ID;
      const res = await fetch(`/api/apps/${appId}/functions/getAllTemplateVersions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("base44_access_token")}`,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        throw new Error("Failed to load versions");
      }

      const data = await res.json();
      setVersions(data.versions || []);
    } catch (err) {
      toast({ title: "שגיאה", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const viewVersionDetails = async (versionId) => {
    try {
      const appId = import.meta.env.VITE_BASE44_APP_ID;
      const res = await fetch(`/api/apps/${appId}/functions/getTemplateById`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("base44_access_token")}`,
        },
        body: JSON.stringify({ template_id: versionId }),
      });

      if (!res.ok) {
        throw new Error("Failed to load template details");
      }

      const data = await res.json();
      setViewingVersion(data.template);
    } catch (err) {
      toast({ title: "שגיאה", description: err.message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-foreground">הגרסאות הקודמות</h3>
        <button
          onClick={loadVersions}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" />
          רענן
        </button>
      </div>

      <AnimatePresence>
        {versions.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            אין גרסאות קודמות
          </div>
        ) : (
          <div className="space-y-2">
            {versions.map((v, idx) => (
              <motion.div
                key={v.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl border border-border p-3 flex items-center justify-between hover:shadow-sm transition-shadow"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-foreground">גרסה {v.version}</span>
                    {v.is_active && (
                      <Badge className="text-[10px] bg-green-100 text-green-700 border-green-200">
                        פעילה
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                    <span>{v.steps_count} שלבים</span>
                    {v.created_at && (
                      <span>
                        {new Date(v.created_at).toLocaleDateString("he-IL", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                    {v.created_by_email && (
                      <span>עדכן: {v.created_by_email}</span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => viewVersionDetails(v.id)}
                  className="gap-1.5 rounded-lg text-xs h-8"
                >
                  <Eye className="w-3 h-3" />
                  צפה
                </Button>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* Version details modal */}
      {viewingVersion && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setViewingVersion(null)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-auto border border-border shadow-lg"
          >
            <div className="sticky top-0 bg-white border-b border-border p-4 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-foreground">גרסה {viewingVersion.version}</h3>
                {viewingVersion.created_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(viewingVersion.created_at).toLocaleDateString("he-IL")}
                  </p>
                )}
              </div>
              <button
                onClick={() => setViewingVersion(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
            <div className="p-4 space-y-3">
              {viewingVersion.steps?.map((step, idx) => (
                <div key={idx} className="border border-border rounded-xl p-3 bg-muted/30">
                  <div className="flex items-start gap-3">
                    <span className="text-xl">{step.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{step.title}</span>
                        {!step.enabled && (
                          <Badge className="text-[10px] bg-muted text-muted-foreground">
                            מושבת
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{step.question}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        סוג: {step.response_type === "upload" ? "העלאת קובץ" : step.response_type === "text" ? "טקסט" : "כן/לא"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}