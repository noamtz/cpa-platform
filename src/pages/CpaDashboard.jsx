import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Loader2, Plus, Search, Users, Settings, ClipboardList, Eye, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import ClientRow from "@/components/dashboard/ClientRow";
import AddSubmissionModal from "@/components/dashboard/AddSubmissionModal";
import { getStepProgress } from "@/lib/submission-compat";
import { DEFAULT_STEPS, getActiveSteps } from "@/lib/default-template";
import { filterStepsByClientConditions } from "@/lib/questionnaire-template";

const STATUS_CONFIG = {
  pending:      { label: "ממתין להתחלה",          color: "bg-amber-100 text-amber-700 border-amber-200",   icon: Clock },
  in_progress:  { label: "בתהליך",                 color: "bg-blue-100 text-blue-700 border-blue-200",     icon: AlertCircle },
  completed:    { label: "מוכן לסקירה ✓",          color: "bg-green-100 text-green-700 border-green-200",  icon: CheckCircle2 },
  ready_for_ira:{ label: "מוכן להגשה לרמ״ש",      color: "bg-purple-100 text-purple-700 border-purple-200",icon: Eye },
  reviewed:     { label: "הוגש ✓",                 color: "bg-gray-100 text-gray-600 border-gray-200",     icon: CheckCircle2 },
};

export default function CpaDashboard() {
  const [clients, setClients] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [templateSteps, setTemplateSteps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("in_progress");
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => { checkAuthAndLoad(); }, []);

  const checkAuthAndLoad = async () => {
    const isAuthed = await base44.auth.isAuthenticated();
    if (!isAuthed) { base44.auth.redirectToLogin(); return; }
    setAuthChecked(true);
    loadData();
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [c, s, tpl] = await Promise.all([
        base44.entities.Client.list("-created_date", 200),
        base44.entities.Submission.list("-created_date", 200),
        base44.functions.invoke("getActiveTemplate", {}).catch(() => null),
      ]);
      setClients(c || []);
      setSubmissions(s || []);
      const steps = tpl?.data?.template?.steps;
      if (Array.isArray(steps)) setTemplateSteps(steps);
    } catch {
      setClients([]); setSubmissions([]);
    }
    setLoading(false);
  };

  // Build a flat list of "submission rows" — one per (client, active tax year)
  // Each row: { client, submission (may be null), effectiveStatus, progress }
  const submissionRows = clients.filter(c => !c.is_archived).map((client) => {
    const taxYear = client.tax_year || 2024;
    const submission = submissions.find((s) => s.client_id === client.id && s.tax_year === taxYear && !s.is_archived) || null;
    const allSubmissions = submissions.filter((s) => s.client_id === client.id);

    const baseSteps = templateSteps.length > 0 ? templateSteps : getActiveSteps(DEFAULT_STEPS);
    const activeSteps = filterStepsByClientConditions(baseSteps, client);
    const progress = submission ? getStepProgress(submission, activeSteps) : 0;

    // Effective status: submission.cpa_status > client.status (legacy) > progress-derived
    let effectiveStatus = submission?.cpa_status
      || (['ready_for_ira', 'reviewed'].includes(client.status) ? client.status : null)
      || (progress === 100 ? 'completed' : progress > 0 ? 'in_progress' : 'pending');

    return { client, submission, allSubmissions, effectiveStatus, progress };
  });

  const filtered = submissionRows.filter(({ client }) =>
    client.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    client.email?.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    in_progress:   filtered.filter(r => ["pending", "in_progress", "completed"].includes(r.effectiveStatus)).length,
    ready_for_ira: filtered.filter(r => r.effectiveStatus === "ready_for_ira").length,
    reviewed:      filtered.filter(r => r.effectiveStatus === "reviewed").length,
  };

  const tabRows = filtered.filter(({ effectiveStatus }) => {
    if (activeTab === "in_progress")   return ["pending", "in_progress", "completed"].includes(effectiveStatus);
    if (activeTab === "ready_for_ira") return effectiveStatus === "ready_for_ira";
    if (activeTab === "reviewed")      return effectiveStatus === "reviewed";
    return true;
  });

  if (!authChecked) {
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
            <img
              src="/brand-image.jpg"
              alt="Doron & Doron"
              className="h-10 w-auto object-contain"
            />
          </div>
          <div className="flex items-center gap-2">
            <Link to="/settings">
              <Button variant="outline" size="icon" className="rounded-xl"><Settings className="w-4 h-4" /></Button>
            </Link>
            <Link to="/questionnaire-settings">
              <Button variant="outline" size="icon" className="rounded-xl" title="הגדרות שאלון">
                <ClipboardList className="w-4 h-4" />
              </Button>
            </Link>
            <Link to="/clients">
              <Button variant="outline" className="gap-2 rounded-xl">
                <Users className="w-4 h-4" />
                לקוחות
              </Button>
            </Link>
            <Button
              onClick={() => setShowAddModal(true)}
              className="bg-primary hover:bg-primary/90 text-white gap-2 rounded-xl"
            >
              <Plus className="w-4 h-4" />
              הגשה חדשה
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {/* Tabs */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { key: "in_progress",   label: "בתהליך",              value: stats.in_progress,   color: "text-blue-600",   activeBg: "bg-blue-600",   inactiveBg: "bg-blue-50 hover:bg-blue-100" },
            { key: "ready_for_ira", label: 'מוכן להגשה לרמ"ש',   value: stats.ready_for_ira, color: "text-purple-600", activeBg: "bg-purple-600", inactiveBg: "bg-purple-50 hover:bg-purple-100" },
            { key: "reviewed",      label: "הוגש",                 value: stats.reviewed,      color: "text-gray-600",   activeBg: "bg-gray-600",   inactiveBg: "bg-gray-50 hover:bg-gray-100" },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-2xl p-4 border border-border text-right transition-colors ${
                activeTab === tab.key
                  ? `${tab.activeBg} text-white border-transparent`
                  : `${tab.inactiveBg} bg-white`
              }`}
            >
              <div className={`text-2xl font-bold ${activeTab === tab.key ? "text-white" : tab.color}`}>{tab.value}</div>
              <div className={`text-sm mt-1 ${activeTab === tab.key ? "text-white/80" : "text-muted-foreground"}`}>{tab.label}</div>
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="חיפוש לקוח..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-10 rounded-xl border-border bg-white"
          />
        </div>

        {/* Submission rows */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-4 border border-border animate-pulse h-20" />
            ))}
          </div>
        ) : tabRows.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-muted-foreground">
              {search ? "לא נמצאו הגשות תואמות" : "אין הגשות בקטגוריה זו"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {tabRows.map(({ client, submission, allSubmissions }) => (
              <ClientRow
                key={client.id}
                client={client}
                submission={submission}
                allSubmissions={allSubmissions}
                statusConfig={STATUS_CONFIG}
                onRefresh={loadData}
                templateSteps={templateSteps}
              />
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <AddSubmissionModal
          onClose={() => setShowAddModal(false)}
          onCreated={loadData}
        />
      )}
    </div>
  );
}
