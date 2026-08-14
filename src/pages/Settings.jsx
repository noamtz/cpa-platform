import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Link, ChevronRight, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import SyncAllDriveButton from "@/components/dashboard/SyncAllDriveButton";

export default function Settings() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connectedEmail, setConnectedEmail] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const [basePath, setBasePath] = useState("");
  const [savingBasePath, setSavingBasePath] = useState(false);
  const [submissions, setSubmissions] = useState([]);

  const checkConnection = async () => {
    setCheckingConnection(true);
    try {
      const res = await base44.functions.invoke('syncFilesToGoogleDrive', { check_connection: true });
      setConnected(true);
      setConnectedEmail(res.data?.email || null);
    } catch {
      setConnected(false);
      setConnectedEmail(null);
    } finally {
      setCheckingConnection(false);
    }
  };

  useEffect(() => {
    base44.auth.me().then(async (u) => {
      if (!u) {
        base44.auth.redirectToLogin("/settings");
        return;
      }
      setUser(u);
      setBasePath(u.drive_base_path || "");
      await Promise.all([
        checkConnection(),
        base44.entities.Submission.list("-created_date", 200).then(setSubmissions).catch(() => {}),
      ]);
      setLoading(false);
    });
  }, []);

  const handleSaveBasePath = async () => {
    setSavingBasePath(true);
    await base44.auth.updateMe({ drive_base_path: basePath });
    setSavingBasePath(false);
  };

  const handleConnect = async () => {
    setConnecting(true);
    const url = await base44.connectors.connectAppUser("69fb22f94d2b7077430e5187");
    const popup = window.open(url, "_blank");
    
    const timer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(timer);
        setConnecting(false);
        // Small delay to allow token to propagate after OAuth completes
        setTimeout(() => checkConnection(), 1500);
      }
    }, 500);
  };

  const handleDisconnect = async () => {
    await base44.connectors.disconnectAppUser("69fb22f94d2b7077430e5187");
    setConnected(false);
    setConnectedEmail(null);
  };

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

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-border sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold text-foreground">הגדרות</h1>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Google Drive Section */}
        <div className="bg-white rounded-2xl border border-border p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground mb-1">Google Drive</h2>
              <p className="text-sm text-muted-foreground">
                חבר את חשבון ה-Google Drive שלך כדי לסנכרן אוטומטית קבצי לקוחות
              </p>
            </div>
            {/* Connection status badge */}
            {checkingConnection ? (
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            ) : connected ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> מחובר
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground bg-muted border border-border rounded-full px-3 py-1">
                <XCircle className="w-3.5 h-3.5" /> לא מחובר
              </span>
            )}
          </div>

          {/* Connected account info */}
          {connected && connectedEmail && (
            <div className="bg-green-50 rounded-xl p-4 border border-green-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-700">חשבון מחובר</p>
                  <p className="text-xs text-green-600">{connectedEmail}</p>
                </div>
              </div>
              <Button
                onClick={handleDisconnect}
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive border-destructive/30"
              >
                התנתק
              </Button>
            </div>
          )}

          {/* Base path config */}
          {connected && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">תיקיית בסיס ב-Drive</label>
              <p className="text-xs text-muted-foreground">השאר ריק כדי לשמור בתיקיית השורש. לדוגמה: <span className="font-mono bg-muted px-1 rounded">לקוחות/מיסים</span></p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={basePath}
                  onChange={(e) => setBasePath(e.target.value)}
                  placeholder="לדוגמה: לקוחות/מיסים"
                  className="flex-1 border border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  dir="ltr"
                />
                <Button
                  onClick={handleSaveBasePath}
                  disabled={savingBasePath}
                  size="sm"
                  variant="outline"
                >
                  {savingBasePath ? "שומר..." : "שמור"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                {basePath ? `${basePath} / ` : ""}שם_לקוח / שנת_מס / סוג_מסמך
              </p>
            </div>
          )}

          {/* Folder structure info */}
          {!connected && (
            <div className="bg-muted/50 rounded-xl p-4 space-y-2 text-sm text-muted-foreground">
              <p>📁 קבצים יסונכרנו בארגון זה:</p>
              <p className="text-xs font-mono bg-muted px-2 py-1 rounded">
                שם_לקוח / שנת_מס / סוג_מסמך
              </p>
            </div>
          )}

          {/* Sync section */}
          {connected && (
            <div className="space-y-2 pt-2 border-t border-border">
              <p className="text-sm font-medium text-foreground">סנכרון קבצים ל-Drive</p>
              <p className="text-xs text-muted-foreground">סנכרן את כל הגשות הלקוחות שהושלמו לתיקיית ה-Drive שלך</p>
              <SyncAllDriveButton submissions={submissions} />
            </div>
          )}

          {!connected && (
            <Button
              onClick={handleConnect}
              disabled={connecting}
              className="w-full bg-primary hover:bg-primary/90 rounded-xl h-10 gap-2"
            >
              <Link className="w-4 h-4" />
              {connecting ? "מתחבר..." : "חיבור ל-Google Drive"}
            </Button>
          )}
        </div>

        {/* Profile Section */}
        <div className="bg-white rounded-2xl border border-border p-6 space-y-4">
          <h2 className="text-lg font-bold text-foreground">פרטי חשבון</h2>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">שם</p>
              <p className="text-sm font-medium text-foreground">{user?.full_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">דוא״ל</p>
              <p className="text-sm font-medium text-foreground">{user?.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">תפקיד</p>
              <p className="text-sm font-medium text-foreground capitalize">{user?.role}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}