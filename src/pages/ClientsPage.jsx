import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, ArrowRight, Pencil, Phone, Mail, Archive, ArchiveRestore } from "lucide-react";
import { Link } from "react-router-dom";
import AddClientModal from "@/components/dashboard/AddClientModal";
import EditClientModal from "@/components/dashboard/EditClientModal";
import { useToast } from "@/components/ui/use-toast";
import RestoreSubmissionDialog from "@/components/dashboard/RestoreSubmissionDialog";

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [restoreConflict, setRestoreConflict] = useState(null); // { toRestore, conflicting, clientName }
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [clientData, subData] = await Promise.all([
      base44.entities.Client.list("-created_date", 200),
      base44.entities.Submission.filter({ is_archived: true }, "-created_date", 200),
    ]);
    setClients(clientData || []);
    setSubmissions(subData || []);
    setLoading(false);
  };

  const loadClients = loadData;

  const handleArchive = async (client) => {
    await base44.entities.Client.update(client.id, { is_archived: true });
    toast({ title: "לקוח הועבר לארכיון", description: client.full_name });
    loadClients();
  };

  const handleRestore = async (client) => {
    await base44.entities.Client.update(client.id, { is_archived: false });
    toast({ title: "לקוח שוחזר", description: client.full_name });
    loadClients();
  };

  const activeClients = clients.filter(c => !c.is_archived);
  const archivedClients = clients.filter(c => c.is_archived);
  const displayList = showArchived ? archivedClients : activeClients;

  const filtered = displayList.filter(
    (c) =>
      c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search)
  );

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <div className="bg-white border-b border-border sticky top-0 z-10 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="rounded-xl">
                <ArrowRight className="w-4 h-4" />
              </Button>
            </Link>
            <h1 className="text-lg font-bold text-foreground">לקוחות</h1>
            <span className="text-sm text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{activeClients.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={showArchived ? "default" : "outline"}
              onClick={() => setShowArchived(!showArchived)}
              className="gap-2 rounded-xl"
            >
              <Archive className="w-4 h-4" />
              ארכיון {archivedClients.length > 0 && `(${archivedClients.length})`}
            </Button>
            {!showArchived && (
              <Button
                onClick={() => setShowAddModal(true)}
                className="bg-primary hover:bg-primary/90 text-white gap-2 rounded-xl"
              >
                <Plus className="w-4 h-4" />
                לקוח חדש
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="חיפוש לפי שם, מייל או טלפון..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-10 rounded-xl border-border bg-white"
          />
        </div>

        {/* Archive banner */}
        {showArchived && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-700 flex items-center gap-2">
            <Archive className="w-4 h-4 flex-shrink-0" />
            מציג ארכיון — לקוחות והגשות שהועברו לארכיון לא מופיעים בדשבורד הראשי
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-4 border border-border animate-pulse h-16" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            {search ? "לא נמצאו לקוחות תואמים" : showArchived ? "אין לקוחות בארכיון" : "אין לקוחות עדיין"}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((client) => (
              <div key={client.id} className={`bg-white rounded-2xl border p-4 flex items-center gap-3 hover:shadow-sm transition-shadow ${showArchived ? "border-amber-200 bg-amber-50/30" : "border-border"}`}>
                <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center flex-shrink-0 font-bold text-primary text-sm">
                  {client.full_name?.charAt(0) || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{client.full_name}</span>
                    {client.osek_type && (
                      <span className="text-xs bg-secondary text-secondary-foreground rounded-md px-2 py-0.5">{client.osek_type}</span>
                    )}
                    {client.pricing != null && (
                      <span className="text-xs bg-primary/10 text-primary rounded-md px-2 py-0.5">₪{Number(client.pricing).toLocaleString("he-IL")}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    {client.email && (
                      <a href={`mailto:${client.email}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                        <Mail className="w-3 h-3" />{client.email}
                      </a>
                    )}
                    {client.phone && (
                      <a href={`tel:${client.phone}`} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary">
                        <Phone className="w-3 h-3" />{client.phone}
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {showArchived ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-lg h-8 gap-1.5 text-xs text-green-700 border-green-200 hover:bg-green-50"
                      onClick={() => handleRestore(client)}
                    >
                      <ArchiveRestore className="w-3.5 h-3.5" />
                      שחזר
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="rounded-lg h-8 w-8"
                        onClick={() => setEditingClient(client)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="rounded-lg h-8 w-8 text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                        onClick={() => handleArchive(client)}
                        title="העבר לארכיון"
                      >
                        <Archive className="w-3.5 h-3.5" />
                      </Button>

                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Archived Submissions Section */}
      {showArchived && submissions.length > 0 && (
        <div className="max-w-4xl mx-auto px-4 pb-6 space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Archive className="w-4 h-4" />
            הגשות בארכיון ({submissions.filter(s =>
              !search ||
              clients.find(c => c.id === s.client_id)?.full_name?.toLowerCase().includes(search.toLowerCase())
            ).length})
          </h2>
          {submissions
            .filter(s => !search || clients.find(c => c.id === s.client_id)?.full_name?.toLowerCase().includes(search.toLowerCase()))
            .map((sub) => {
              const client = clients.find(c => c.id === sub.client_id);
              return (
                <div key={sub.id} className="bg-amber-50/40 rounded-2xl border border-amber-200 p-4 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0 font-bold text-amber-600 text-sm">
                    {client?.full_name?.charAt(0) || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">{client?.full_name || "לקוח לא ידוע"}</span>
                      <span className="text-xs bg-amber-100 text-amber-700 rounded-md px-2 py-0.5">שנת {sub.tax_year || 2024}</span>
                      {sub.cpa_status && (
                        <span className="text-xs bg-secondary text-secondary-foreground rounded-md px-2 py-0.5">{sub.cpa_status}</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      הועבר לארכיון — {new Date(sub.updated_date).toLocaleDateString("he-IL")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg h-8 gap-1.5 text-xs text-green-700 border-green-200 hover:bg-green-50"
                    onClick={async () => {
                      // Check for active submission with same client + year
                      const allActive = await base44.entities.Submission.filter({ client_id: sub.client_id, tax_year: sub.tax_year });
                      const conflict = allActive.find(s => !s.is_archived && s.id !== sub.id);
                      if (conflict) {
                        setRestoreConflict({ toRestore: sub, conflicting: conflict, clientName: client?.full_name || "לקוח" });
                      } else {
                        await base44.functions.invoke("restoreSubmission", {
                          submission_id: sub.id,
                        });
                        toast({ title: "הגשה שוחזרה", description: `${client?.full_name} — שנת ${sub.tax_year}` });
                        loadData();
                      }
                    }}
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                    שחזר
                  </Button>
                </div>
              );
            })}
        </div>
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
              toast({ title: "הגשה שוחזרה", description: `${restoreConflict.clientName} — שנת ${toRestore.tax_year}` });
            } else {
              // Keep existing active, leave the archived one in archive
              toast({ title: "הגשה הפעילה נשמרה ללא שינוי", description: `${restoreConflict.clientName} — שנת ${toRestore.tax_year}` });
            }
            setRestoreConflict(null);
            loadData();
          }}
        />
      )}

      {showAddModal && (
        <AddClientModal onClose={() => setShowAddModal(false)} onCreated={loadClients} />
      )}
      {editingClient && (
        <EditClientModal
          client={editingClient}
          onClose={() => setEditingClient(null)}
          onSaved={loadClients}
        />
      )}
    </div>
  );
}
