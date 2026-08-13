import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X, Search } from "lucide-react";

export default function AddSubmissionModal({ onClose, onCreated }) {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState(null);
  const [taxYear, setTaxYear] = useState(new Date().getFullYear() - 1);
  const [saving, setSaving] = useState(false);
  const [existingSubmissions, setExistingSubmissions] = useState([]);

  useEffect(() => {
    base44.entities.Client.list("-created_date", 200).then(setClients);
  }, []);

  useEffect(() => {
    if (selectedClient) {
      base44.entities.Submission.filter({ client_id: selectedClient.id }).then(setExistingSubmissions);
    } else {
      setExistingSubmissions([]);
    }
  }, [selectedClient]);

  const filtered = clients.filter(
    (c) =>
      c.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      c.email?.toLowerCase().includes(search.toLowerCase())
  );

  const alreadyExists = existingSubmissions.some((s) => s.tax_year === taxYear);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedClient) return;
    setSaving(true);

    // Update client's active tax year and reset status
    await base44.entities.Client.update(selectedClient.id, {
      tax_year: taxYear,
      status: "pending",
    });

    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">הגשה חדשה</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Client search */}
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">לקוח *</Label>
            {selectedClient ? (
              <div className="flex items-center justify-between bg-primary/10 rounded-xl px-3 py-2">
                <span className="text-sm font-medium text-primary">{selectedClient.full_name}</span>
                <button
                  type="button"
                  onClick={() => { setSelectedClient(null); setSearch(""); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="חפש לקוח..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-10 rounded-xl border-border"
                />
                {search && (
                  <div className="absolute top-full mt-1 right-0 left-0 bg-white border border-border rounded-xl shadow-lg z-10 max-h-48 overflow-y-auto">
                    {filtered.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">לא נמצאו לקוחות</div>
                    ) : (
                      filtered.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => { setSelectedClient(c); setSearch(""); }}
                          className="w-full text-right px-3 py-2 text-sm hover:bg-muted transition-colors flex items-center gap-2"
                        >
                          <div className="w-6 h-6 rounded-lg bg-secondary flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                            {c.full_name?.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium">{c.full_name}</div>
                            {c.email && <div className="text-xs text-muted-foreground">{c.email}</div>}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tax year */}
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">שנת מס *</Label>
            <Input
              type="number"
              value={taxYear}
              onChange={(e) => setTaxYear(parseInt(e.target.value))}
              className="rounded-xl border-border"
              min={2020}
              max={2030}
            />
            {alreadyExists && (
              <p className="text-xs text-amber-600 mt-1">⚠️ כבר קיימת הגשה ללקוח זה עבור שנת {taxYear}</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl">
              ביטול
            </Button>
            <Button
              type="submit"
              disabled={saving || !selectedClient || alreadyExists}
              className="flex-1 bg-primary hover:bg-primary/90 text-white rounded-xl"
            >
              {saving ? "יוצר..." : "צור הגשה"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}