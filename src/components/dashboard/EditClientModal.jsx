import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";

export default function EditClientModal({ client, onClose, onSaved }) {
  const [form, setForm] = useState({
    full_name: client.full_name || "",
    email: client.email || "",
    phone: client.phone || "",
    tax_year: client.tax_year || 2024,
    osek_type: client.osek_type || "",
    pricing: client.pricing ?? 1500,
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.osek_type) {
      alert("דרוש לבחור סוג עוסק");
      return;
    }
    setSaving(true);
    const { tax_year, ...profile } = form;
    try {
      await base44.functions.invoke("updateClientDetails", {
        client_id: client.id,
        revision: client.revision,
        profile,
        ...(tax_year === client.tax_year ? {} : { tax_year }),
      });
      onSaved();
      onClose();
    } catch {
      alert("שמירת פרטי הלקוח נכשלה. נא לרענן ולנסות שוב.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-bold text-foreground">עריכת פרטי לקוח</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">שם מלא *</Label>
            <Input
              required
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
              placeholder="ישראל ישראלי"
              className="rounded-xl border-border"
            />
          </div>
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">מייל</Label>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="israel@example.com"
              className="rounded-xl border-border"
            />
          </div>
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">טלפון</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="050-0000000"
              className="rounded-xl border-border"
            />
          </div>
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">שנת מס</Label>
            <Input
              type="number"
              value={form.tax_year}
              onChange={(e) => setForm({ ...form, tax_year: parseInt(e.target.value) })}
              className="rounded-xl border-border"
            />
          </div>
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">סוג עוסק *</Label>
            <select
              value={form.osek_type}
              onChange={(e) => setForm({ ...form, osek_type: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">לא נבחר</option>
              <option value="עוסק פטור">עוסק פטור</option>
              <option value="עוסק מורשה">עוסק מורשה</option>
            </select>
          </div>
          <div>
            <Label className="text-sm font-medium text-foreground mb-1.5 block">תמחור (₪)</Label>
            <Input
              type="number"
              value={form.pricing}
              onChange={(e) => setForm({ ...form, pricing: parseFloat(e.target.value) || 0 })}
              className="rounded-xl border-border"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1 rounded-xl">
              ביטול
            </Button>
            <Button type="submit" disabled={saving} className="flex-1 bg-primary hover:bg-primary/90 text-white rounded-xl">
              {saving ? "שומר..." : "שמירה"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
