import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronUp, ChevronDown, Plus, Trash2, Save, Eye, EyeOff,
  Pencil, X, Upload, FileText, Type, PenTool, Loader2
} from "lucide-react";
import { DEFAULT_STEPS } from "@/lib/questionnaire-template";

const RESPONSE_TYPES = [
  { value: "upload", label: "העלאת קובץ", icon: Upload, emoji: "📎" },
  { value: "text", label: "תשובה טקסטית", icon: Type, emoji: "📝" },
  { value: "single_select", label: "בחירה יחידה", icon: FileText, emoji: "🔘" },
  { value: "multi_select", label: "בחירה מרובה", icon: FileText, emoji: "☑️" },
  { value: "pdf_sign", label: "חתימה על PDF", icon: PenTool, emoji: "✍️" },
  { value: "none", label: "כן/לא בלבד", icon: FileText, emoji: "✅" },
];

const DEFAULT_EMOJIS = ["💼", "🏦", "📈", "🛡️", "❤️", "💰", "🏠", "🚗", "📋", "🎓", "👶", "💊", "✈️", "📱", "🔧"];

function generateStepId() {
  return "custom_" + Math.random().toString(36).substring(2, 8);
}

function StepEditor({ step, index, total, onUpdate, onRemove, onMoveUp, onMoveDown, isDefault }) {
  const [editing, setEditing] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const update = (field, value) => {
    onUpdate({ ...step, [field]: value });
  };

  const updateUploadConfig = (field, value) => {
    onUpdate({
      ...step,
      upload_config: { ...(step.upload_config || {}), [field]: value },
    });
  };

  const updateTextConfig = (field, value) => {
    onUpdate({
      ...step,
      text_config: { ...(step.text_config || {}), [field]: value },
    });
  };

  const updateSelectConfig = (field, value) => {
    onUpdate({
      ...step,
      select_config: { ...(step.select_config || {}), [field]: value },
    });
  };

  const updatePdfSignConfig = (field, value) => {
    onUpdate({
      ...step,
      pdf_sign_config: { ...(step.pdf_sign_config || {}), [field]: value },
    });
  };

  const updateCondition = (field, value) => {
    onUpdate({
      ...step,
      condition: { ...(step.condition || {}), [field]: value },
    });
  };

  // Load available PDF templates when editing a pdf_sign step
  const [pdfTemplates, setPdfTemplates] = useState([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  useEffect(() => {
    if (editing && step.response_type === "pdf_sign" && pdfTemplates.length === 0) {
      loadPdfTemplates();
    }
  }, [editing, step.response_type]);

  const loadPdfTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const templates = await base44.entities.PdfTemplate.list();
      setPdfTemplates(templates || []);
    } catch (e) {
      console.error("Failed to load PDF templates:", e);
      setPdfTemplates([]);
    }
    setLoadingTemplates(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`bg-white rounded-2xl border ${step.enabled ? "border-border" : "border-border/50 opacity-60"} overflow-hidden transition-all`}
    >
      {/* Step header */}
      <div className="p-4 flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <button
            onClick={() => onMoveUp()}
            disabled={index === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => onMoveDown()}
            disabled={index === total - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-20 transition-colors"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>

        <div className="text-2xl">
          {step.emoji}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground truncate">{step.title}</span>
            <Badge className={`text-[10px] ${step.enabled ? "bg-green-100 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border"}`}>
              {step.enabled ? "פעיל" : "מושבת"}
            </Badge>

          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{step.question}</p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => update("enabled", !step.enabled)}
            className={`p-1.5 rounded-lg transition-colors ${step.enabled ? "text-green-600 hover:bg-green-50" : "text-muted-foreground hover:bg-muted"}`}
            title={step.enabled ? "השבת שלב" : "הפעל שלב"}
          >
            {step.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          <button
            onClick={() => setEditing(!editing)}
            className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="ערוך"
          >
            {editing ? <X className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onRemove()}
            className="p-1.5 rounded-lg text-destructive hover:bg-red-50 transition-colors"
            title="מחק שלב"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Expanded editor */}
      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t border-border p-4 space-y-4 bg-muted/20">
              {/* Emoji + Title */}
              <div className="grid grid-cols-[auto_1fr] gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">איקון</label>
                  <div className="relative">
                    <button
                      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                      className="w-12 h-10 rounded-xl border border-border bg-white hover:bg-muted flex items-center justify-center text-2xl transition-colors"
                    >
                      {step.emoji}
                    </button>
                    {showEmojiPicker && (
                      <div className="absolute top-full mt-1 right-0 bg-white border border-border rounded-xl shadow-lg p-2 z-50 grid grid-cols-5 gap-1 w-48">
                        {DEFAULT_EMOJIS.map((e) => (
                          <button
                            key={e}
                            onClick={() => {
                              update("emoji", e);
                              setShowEmojiPicker(false);
                            }}
                            className="text-xl hover:bg-muted rounded-lg p-1.5 transition-colors"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">כותרת השלב</label>
                  <Input
                    value={step.title}
                    onChange={(e) => update("title", e.target.value)}
                    className="rounded-xl"
                    dir="rtl"
                  />
                </div>
              </div>

              {/* Skip question toggle — only for upload and pdf_sign */}
              {(step.response_type === "upload" || step.response_type === "pdf_sign") && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-blue-800">ללא שאלת כן/לא</p>
                    <p className="text-xs text-blue-600 mt-0.5">המשימה תוצג ישירות ללקוח בלי לשאול קודם אם רלוונטי</p>
                  </div>
                  <button
                    onClick={() => update("skip_question", !step.skip_question)}
                    className={`w-12 h-6 rounded-full transition-colors flex-shrink-0 relative ${step.skip_question ? "bg-blue-500" : "bg-border"}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${step.skip_question ? "right-0.5" : "left-0.5"}`} />
                  </button>
                </div>
              )}

              {/* Question — hidden when skip_question is on */}
              {!step.skip_question && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">שאלה (השתמש ב- {"{year}"} למילוי אוטומטי של שנת המס)</label>
                  <Textarea
                    value={step.question}
                    onChange={(e) => update("question", e.target.value)}
                    className="rounded-xl resize-none"
                    rows={2}
                    dir="rtl"
                  />
                </div>
              )}

              {/* Yes/No labels — hidden when skip_question is on */}
              {!step.skip_question && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">תשובת ״כן״</label>
                    <Input
                      value={step.yes_label}
                      onChange={(e) => update("yes_label", e.target.value)}
                      className="rounded-xl"
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">תשובת ״לא״</label>
                    <Input
                      value={step.no_label}
                      onChange={(e) => update("no_label", e.target.value)}
                      className="rounded-xl"
                      dir="rtl"
                    />
                  </div>
                </div>
              )}

              {/* Response type */}
              <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">סוג תשובה (כשהלקוח עונה ״כן״)</label>
                <div className="grid grid-cols-4 gap-2">
                  {RESPONSE_TYPES.map((rt) => (
                    <button
                      key={rt.value}
                      onClick={() => {
                        update("response_type", rt.value);
                        if (rt.value === "upload" && !step.upload_config) {
                          onUpdate({
                            ...step,
                            response_type: rt.value,
                            upload_config: { title: "", description: "", upload_label: "העלאת קובץ", accept: ".pdf,.jpg,.jpeg,.png,.heic" },
                            text_config: null,
                            pdf_sign_config: null,
                          });
                        } else if (rt.value === "text" && !step.text_config) {
                          onUpdate({
                            ...step,
                            response_type: rt.value,
                            upload_config: null,
                            text_config: { title: "", description: "", placeholder: "", rows: 4 },
                            pdf_sign_config: null,
                            select_config: null,
                          });
                        } else if ((rt.value === "single_select" || rt.value === "multi_select") && !step.select_config) {
                          onUpdate({
                            ...step,
                            response_type: rt.value,
                            upload_config: null,
                            text_config: null,
                            pdf_sign_config: null,
                            select_config: { title: "", description: "", options: ["אפשרות 1", "אפשרות 2", "אפשרות 3"] },
                          });
                        } else if (rt.value === "pdf_sign" && !step.pdf_sign_config) {
                          onUpdate({
                            ...step,
                            response_type: rt.value,
                            upload_config: null,
                            text_config: null,
                            pdf_sign_config: { pdf_template_id: "", template_name: "" },
                          });
                          if (pdfTemplates.length === 0) loadPdfTemplates();
                        } else {
                          onUpdate({ ...step, response_type: rt.value });
                        }
                      }}
                      className={`rounded-xl p-3 border-2 text-center text-xs font-medium transition-all ${
                        step.response_type === rt.value
                          ? "border-primary bg-primary/5 text-foreground"
                          : "border-border hover:border-primary/30 text-muted-foreground"
                      }`}
                    >
                      <span className="text-lg block mb-1">{rt.emoji}</span>
                      {rt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Upload config */}
              {step.response_type === "upload" && (
                <div className="space-y-3 bg-white rounded-xl p-3 border border-border">
                  <p className="text-xs font-semibold text-foreground">הגדרות העלאת קובץ</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">כותרת</label>
                    <Input
                      value={step.upload_config?.title || ""}
                      onChange={(e) => updateUploadConfig("title", e.target.value)}
                      className="rounded-xl"
                      placeholder="למשל: טופס 106"
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">הסבר ללקוח</label>
                    <Textarea
                      value={step.upload_config?.description || ""}
                      onChange={(e) => updateUploadConfig("description", e.target.value)}
                      className="rounded-xl resize vertical"
                      rows={3}
                      placeholder="הסבר ללקוח מאיפה להשיג את המסמך..."
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">כיתוב כפתור העלאה</label>
                    <Input
                      value={step.upload_config?.upload_label || ""}
                      onChange={(e) => updateUploadConfig("upload_label", e.target.value)}
                      className="rounded-xl"
                      placeholder="למשל: העלאת טופס 106"
                      dir="rtl"
                    />
                  </div>
                </div>
              )}

              {/* Text config */}
              {step.response_type === "text" && (
                <div className="space-y-3 bg-white rounded-xl p-3 border border-border">
                  <p className="text-xs font-semibold text-foreground">הגדרות שדה טקסט</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">כותרת</label>
                    <Input
                      value={step.text_config?.title || ""}
                      onChange={(e) => updateTextConfig("title", e.target.value)}
                      className="rounded-xl"
                      placeholder="למשל: פרטי הכנסות נוספות"
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">הסבר ללקוח</label>
                    <Textarea
                      value={step.text_config?.description || ""}
                      onChange={(e) => updateTextConfig("description", e.target.value)}
                      className="rounded-xl resize vertical"
                      rows={3}
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">טקסט placeholder</label>
                    <Input
                      value={step.text_config?.placeholder || ""}
                      onChange={(e) => updateTextConfig("placeholder", e.target.value)}
                      className="rounded-xl"
                      dir="rtl"
                    />
                  </div>
                </div>
              )}

              {/* Select config (single/multi) */}
              {(step.response_type === "single_select" || step.response_type === "multi_select") && (
                <div className="space-y-3 bg-white rounded-xl p-3 border border-border">
                  <p className="text-xs font-semibold text-foreground">הגדרות בחירה</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">כותרת</label>
                    <Input
                      value={step.select_config?.title || ""}
                      onChange={(e) => updateSelectConfig("title", e.target.value)}
                      className="rounded-xl"
                      placeholder="למשל: בחר את המקורות הרלוונטיים"
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">הסבר ללקוח</label>
                    <Textarea
                      value={step.select_config?.description || ""}
                      onChange={(e) => updateSelectConfig("description", e.target.value)}
                      className="rounded-xl resize vertical"
                      rows={3}
                      dir="rtl"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-2 block">אפשרויות תשובה</label>
                    <div className="space-y-2">
                      {step.select_config?.options?.map((opt, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Input
                            value={opt}
                            onChange={(e) => {
                              const newOptions = [...step.select_config.options];
                              newOptions[idx] = e.target.value;
                              updateSelectConfig("options", newOptions);
                            }}
                            className="rounded-xl flex-1"
                            dir="rtl"
                            placeholder={`אפשרות ${idx + 1}`}
                          />
                          <button
                            onClick={() => {
                              const newOptions = step.select_config.options.filter((_, i) => i !== idx);
                              updateSelectConfig("options", newOptions);
                            }}
                            className="p-2 text-destructive hover:bg-red-50 rounded-lg transition-colors"
                            disabled={step.select_config.options.length <= 2}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const newOptions = [...(step.select_config?.options || []), `אפשרות ${(step.select_config?.options?.length || 0) + 1}`];
                        updateSelectConfig("options", newOptions);
                      }}
                      className="w-full mt-2 border-2 border-dashed border-border hover:border-primary/40 rounded-xl p-2 text-sm text-muted-foreground hover:text-primary transition-colors"
                    >
                      <Plus className="w-4 h-4 inline ml-1" />
                      הוסף אפשרות
                    </button>
                  </div>
                </div>
              )}

              {/* PDF Sign config */}
              {step.response_type === "pdf_sign" && (
                <div className="space-y-3 bg-white rounded-xl p-3 border border-border">
                  <p className="text-xs font-semibold text-foreground">הגדרות חתימה על PDF</p>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">בחר תבנית PDF</label>
                    {loadingTemplates ? (
                      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        טוען תבניות...
                      </div>
                    ) : pdfTemplates.length === 0 ? (
                      <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-2">
                        ⚠️ אין תבניות PDF — יש ליצור תבנית בעמוד <strong>טפסי PDF</strong> קודם
                      </div>
                    ) : (
                      <select
                        value={step.pdf_sign_config?.pdf_template_id || ""}
                        onChange={(e) => {
                          const selected = pdfTemplates.find((t) => t.id === e.target.value);
                          onUpdate({
                            ...step,
                            pdf_sign_config: {
                              ...(step.pdf_sign_config || {}),
                              pdf_template_id: e.target.value,
                              template_name: selected?.name || "",
                            },
                          });
                        }}
                        className="w-full rounded-xl border border-border px-3 py-2 text-sm bg-white"
                        dir="rtl"
                      >
                        <option value="">— בחר תבנית —</option>
                        {pdfTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name || `תבנית ${t.id}`}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {step.pdf_sign_config?.pdf_template_id && (
                    <div className="text-xs text-green-600 bg-green-50 rounded-lg p-2">
                      ✅ תבנית נבחרה: <strong>{step.pdf_sign_config.template_name || step.pdf_sign_config.pdf_template_id}</strong>
                    </div>
                  )}
                </div>
              )}

              {/* Condition settings */}
              <div className="space-y-3 bg-white rounded-xl p-3 border border-border">
                <div className="flex items-start gap-2">
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-foreground mb-2">🎯 הצגה מותנית - לאיזה סוג עוסק?</p>
                    <p className="text-xs text-muted-foreground mb-3 leading-relaxed">בחר לאיזה סוג עוסק מוקדש שלב זה. לקוח מסוג אחר לא יראה את השאלה הזו ולא תיכלל בהתקדמות שלו.</p>
                  </div>
                </div>

                <div>
                   <select
                     value={step.condition?.type === "osek_type" ? step.condition.values?.[0] || "" : ""}
                     onChange={(e) => {
                       const value = e.target.value;
                       if (value) {
                         onUpdate({
                           ...step,
                           condition: {
                             type: "osek_type",
                             field: "osek_type",
                             values: [value],
                           },
                         });
                       } else {
                         onUpdate({
                           ...step,
                           condition: null,
                         });
                       }
                     }}
                     className="w-full rounded-xl border border-border px-3 py-3 text-sm bg-white font-medium"
                     dir="rtl"
                   >
                     <option value="">— לכל סוגי העוסקים (ללא תנאי) —</option>
                     <option value="עוסק מורשה">🔒 עוסק מורשה בלבד</option>
                     <option value="עוסק פטור">🔒 עוסק פטור בלבד</option>
                   </select>
                 </div>

                {step.condition?.type === "osek_type" && step.condition.values?.[0] && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1">
                    <p className="font-semibold">⚠️ שאלה זו מוגבלת</p>
                    <p>יוצגת רק ללקוחות <strong>{step.condition.values[0]}</strong></p>
                    <p>לקוחות מסוג אחר לא יראו שאלה זו וזה לא יספר לעבורם בהתקדמות</p>
                  </div>
                )}
              </div>
              </div>
              </motion.div>
              )}
              </AnimatePresence>
    </motion.div>
  );
}

export default function QuestionnaireEditor() {
  const [steps, setSteps] = useState([]);
  const [templateVersion, setTemplateVersion] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const { toast } = useToast();

  // Default step IDs (these can only be disabled, not deleted)
  const DEFAULT_STEP_IDS = DEFAULT_STEPS.map((s) => s.id);

  useEffect(() => {
    loadTemplate();
  }, []);

  const loadTemplate = async () => {
    setLoading(true);
    try {
      const { data } = await base44.functions.invoke("getActiveTemplate", {});
      if (data?.template?.steps) {
        setSteps(data.template.steps);
        setTemplateVersion(data.template.version);
      } else {
        setSteps([...DEFAULT_STEPS]);
        setTemplateVersion(0);
      }
    } catch {
      setSteps([...DEFAULT_STEPS]);
      setTemplateVersion(0);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Recompute order before saving
      const orderedSteps = steps.map((s, i) => ({ ...s, order: i }));

      const { data } = await base44.functions.invoke(
        "saveQuestionnaireTemplate",
        { steps: orderedSteps },
      );

      if (data?.error) {
        toast({ title: "שגיאה", description: data.error, variant: "destructive" });
      } else if (data?.template) {
        setTemplateVersion(data.template.version);
        setHasChanges(false);
        toast({ title: "נשמר בהצלחה ✅", description: `גרסה ${data.template.version} נוצרה` });
      } else {
        toast({ title: "שגיאה", description: "תגובה לא צפויה מהשרת", variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "שגיאה", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const updateStep = (index, updatedStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? updatedStep : s)));
    setHasChanges(true);
  };

  const removeStep = (index) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const moveStep = (index, direction) => {
    const newSteps = [...steps];
    const target = index + direction;
    if (target < 0 || target >= newSteps.length) return;
    [newSteps[index], newSteps[target]] = [newSteps[target], newSteps[index]];
    setSteps(newSteps);
    setHasChanges(true);
  };

  const addStep = () => {
    const newStep = {
      id: generateStepId(),
      emoji: "📋",
      title: "שלב חדש",
      question: "האם...?",
      yes_label: "כן",
      no_label: "לא",
      response_type: "upload",
      upload_config: {
        title: "",
        description: "",
        upload_label: "העלאת קובץ",
        accept: ".pdf,.jpg,.jpeg,.png,.heic",
      },
      text_config: null,
      select_config: null,
      pdf_sign_config: null,
      condition: null, // No condition by default
      enabled: true,
      order: steps.length,
    };
    setSteps((prev) => [...prev, newStep]);
    setHasChanges(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const enabledCount = steps.filter((s) => s.enabled).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-foreground">עריכת שאלון</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {enabledCount} שלבים פעילים • גרסה {templateVersion || 1}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="bg-primary hover:bg-primary/90 text-white rounded-xl gap-2"
          >
            {saving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? "שומר..." : "שמור שינויים"}
          </Button>
        </div>
      </div>

      {hasChanges && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-700 font-medium flex items-center gap-2">
          ⚠️ יש שינויים שלא נשמרו — שינויים ייכנסו לתוקף רק לאחר שמירה
        </div>
      )}

      {/* Steps list */}
      <div className="space-y-3">
        <AnimatePresence>
          {steps.map((step, index) => (
            <StepEditor
              key={step.id}
              step={step}
              index={index}
              total={steps.length}
              isDefault={DEFAULT_STEP_IDS.includes(step.id)}
              onUpdate={(updated) => updateStep(index, updated)}
              onRemove={() => removeStep(index)}
              onMoveUp={() => moveStep(index, -1)}
              onMoveDown={() => moveStep(index, 1)}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Add step button */}
      <button
        onClick={addStep}
        className="w-full border-2 border-dashed border-border hover:border-primary/40 rounded-2xl p-4 flex items-center justify-center gap-2 text-muted-foreground hover:text-primary transition-colors"
      >
        <Plus className="w-5 h-5" />
        <span className="font-medium text-sm">הוסף שלב חדש</span>
      </button>

      {/* Info */}
      <div className="bg-muted/50 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
        <p>💡 <strong>טיפ:</strong> שלבי ברירת מחדל לא ניתנים למחיקה, רק להשבתה.</p>
        <p>📌 שינויים משפיעים רק על שאלונים חדשים. לקוחות שכבר מילאו שאלון ימשיכו לראות את הגרסה הקודמת.</p>
        <p>🔢 השתמש ב- <code className="bg-muted px-1 rounded">{"{year}"}</code> בטקסט כדי להציג אוטומטית את שנת המס.</p>
      </div>
    </div>
  );
}
