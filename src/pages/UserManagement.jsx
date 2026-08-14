import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Loader2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import TeamSection from "@/components/dashboard/TeamSection";

export default function UserManagement() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const isAuthed = await base44.auth.isAuthenticated();
    if (!isAuthed) {
      base44.auth.redirectToLogin();
      return;
    }
    setLoading(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-border sticky top-0 z-10 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-foreground">ניהול צוות</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        <TeamSection />
      </div>
    </div>
  );
}