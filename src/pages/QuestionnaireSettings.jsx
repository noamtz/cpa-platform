import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, History, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import QuestionnaireEditor from "@/components/dashboard/QuestionnaireEditor";
import VersionHistory from "@/components/dashboard/VersionHistory";

export default function QuestionnaireSettings() {
  const navigate = useNavigate();
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <h1 className="text-xl font-bold text-foreground">הגדרות שאלון</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => navigate("/pdf-templates")}
              variant="outline"
              size="sm"
              className="gap-2 rounded-lg"
            >
              <FileText className="w-4 h-4" />
              טפסי PDF
            </Button>
            <Button
              onClick={() => setShowHistory(!showHistory)}
              variant="outline"
              size="sm"
              className="gap-2 rounded-lg"
            >
              <History className="w-4 h-4" />
              היסטוריה
            </Button>
          </div>
        </div>

        {showHistory ? (
          <div className="bg-white rounded-2xl border border-border p-6">
            <VersionHistory />
          </div>
        ) : (
          <QuestionnaireEditor />
        )}
      </div>
    </div>
  );
}