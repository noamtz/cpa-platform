import React, { useState, useEffect, useRef, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { fileClient } from "@/api/file-client";
import { useNavigate } from "react-router-dom";
import { Button as UntypedButton } from "@/components/ui/button";
import { Input as UntypedInput } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { motion } from "framer-motion";
import {
  ChevronRight, Save, Upload, FileText, Plus, Trash2, Loader2,
  Eye
} from "lucide-react";

import {
  loadPdfme,
  getPdfmeModules,
  getPlugins,
  getFontConfig,
  HEBREW_LABELS,
} from "@/lib/pdfme-config";

const Button = /** @type {React.ComponentType<any>} */ (UntypedButton);
const Input = /** @type {React.ComponentType<any>} */ (UntypedInput);

export default function PdfTemplateEditor() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const containerRef = useRef(null);
  const designerRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadingTemplate, setLoadingTemplate] = useState(null); // Track which template is loading
  const [templateName, setTemplateName] = useState("");
  const [existingTemplates, setExistingTemplates] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [showList, setShowList] = useState(true);
  const [authChecked, setAuthChecked] = useState(false);
  const [fieldMapping, setFieldMapping] = useState({}); // { fieldName: "tax_year" }
  const [selectedFieldName, setSelectedFieldName] = useState(null);

  // Check auth
  useEffect(() => {
    (async () => {
      const isAuthed = await base44.auth.isAuthenticated();
      if (!isAuthed) {
        base44.auth.redirectToLogin();
        return;
      }
      setAuthChecked(true);
    })();
  }, []);

  // Load existing templates
  useEffect(() => {
    if (!authChecked) return;
    loadTemplates();
  }, [authChecked]);

  const loadTemplates = async () => {
    try {
      const templates = await base44.entities.PdfTemplate.list("-created_date", 50);
      setExistingTemplates(templates || []);
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
    setLoading(false);
  };

  const initDesigner = useCallback(async (templateJson = null) => {
    setShowList(false);
    setLoading(true);

    await loadPdfme();
    const { Designer } = getPdfmeModules();
    const font = await getFontConfig();

    // Destroy any existing designer instance
    if (designerRef.current) {
      designerRef.current.destroy();
      designerRef.current = null;
    }

    // Wait for DOM container to render
    await new Promise((r) => setTimeout(r, 100));

    const domContainer = containerRef.current;
    if (!domContainer) {
      setLoading(false);
      return;
    }

    // Default blank template or load existing
    const template = templateJson || {
      basePdf: { width: 210, height: 297, padding: [10, 10, 10, 10] },
      schemas: [[]],
    };

    const options = {
      theme: {
        token: {
          colorPrimary: "#e8763a",
        },
      },
      labels: HEBREW_LABELS,
    };

    if (font) {
      options.font = font;
    }

    try {
      designerRef.current = new Designer({
        domContainer,
        template,
        plugins: getPlugins(),
        options,
      });

      // Hook into Designer updates to auto-set required=true for signature fields
      const origUpdateTemplate = designerRef.current.updateTemplate.bind(designerRef.current);
      designerRef.current.updateTemplate = function(updatedTemplate) {
        let hasSignatureChange = false;
        updatedTemplate.schemas?.forEach((pageSchemas) => {
          pageSchemas?.forEach((field) => {
            if (field.type === 'signature' && !field.required) {
              field.required = true;
              hasSignatureChange = true;
            }
          });
        });
        return origUpdateTemplate(updatedTemplate);
      };
    } catch (e) {
      console.error("Failed to init Designer:", e);
      toast({ title: "שגיאה", description: "לא ניתן לטעון את עורך ה-PDF", variant: "destructive" });
    }

    setLoading(false);
    setLoadingTemplate(null);

    // Inject data-source dropdown into pdfme's sidebar when a field is selected
    const INJECT_ID = '__field-mapping-inject';
    const fieldMappingRef = { current: fieldMapping }; // mutable ref for closure
    containerRef.current._fieldMappingRef = fieldMappingRef;
    // Store original field names so we can restore on deselect
    const originalNamesRef = containerRef.current._originalNames || {};
    containerRef.current._originalNames = originalNamesRef;

    // Source labels for field name and content
    const SOURCE_LABELS = {
      tax_year: 'שנת המס',
      full_name: 'שם מלא',
      email: 'אימייל',
      phone: 'טלפון',
      id_number: 'תעודת זהות',
      today: 'תאריך היום',
    };

    const injectDataSourceDropdown = () => {
      // Remove previous injection
      const existing = document.getElementById(INJECT_ID);
      if (existing) existing.remove();

      // Find pdfme's sidebar — it contains the field name input
      const allInputs = domContainer.querySelectorAll('input');
      let nameInput = null;
      for (const inp of allInputs) {
        if (inp.type === 'text' && inp.value && !inp.value.match(/^\d+(\.\d+)?$/)) {
          nameInput = inp;
          break;
        }
      }
      if (!nameInput) return null;

      const currentFieldName = nameInput.value;
      setSelectedFieldName(currentFieldName);

      // ── Requirement 2: Only show dropdown for Text type ──
      // Check field type from pdfme's template object (reliable, not DOM-based)
      let isTextType = true;
      if (designerRef.current) {
        const tmpl = designerRef.current.getTemplate();
        const field = tmpl.schemas.flat().find(f => f.name === currentFieldName);
        if (field && field.type && field.type.toLowerCase() !== 'text') {
          isTextType = false;
        }
      }

      // Create the injection container
      const wrapper = document.createElement('div');
      wrapper.id = INJECT_ID;
      wrapper.dir = 'rtl';
      wrapper.style.cssText = 'padding:8px 12px;margin:8px 0;background:#fef9f0;border:1px solid #e8763a30;border-radius:8px;';
      wrapper.addEventListener('click', (e) => e.stopPropagation());
      wrapper.addEventListener('mousedown', (e) => e.stopPropagation());

      const labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:12px;color:#888;margin-bottom:4px;font-weight:600;';
      labelEl.textContent = '📋 מקור מידע אוטומטי';
      wrapper.appendChild(labelEl);

      if (!isTextType) {
        // Non-text field: show disabled message
        const msg = document.createElement('div');
        msg.style.cssText = 'font-size:11px;color:#999;padding:4px 0;';
        msg.textContent = '⚠️ זמין רק עבור שדות טקסט';
        wrapper.appendChild(msg);
      } else {
        // Text field: show the dropdown
        const select = document.createElement('select');
        select.setAttribute('data-inject', 'true');
        select.style.cssText = 'width:100%;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px;background:#fff;direction:rtl;cursor:pointer;';

        const sources = [
          ['', 'ללא (ימולא ידנית)'],
          ['tax_year', '📅 שנת המס'],
          ['full_name', '👤 שם מלא'],
          ['email', '📧 אימייל'],
          ['phone', '📱 טלפון'],
          ['id_number', '🪪 תעודת זהות'],
          ['today', '📆 תאריך היום'],
        ];

        sources.forEach(([val, lbl]) => {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = lbl;
          select.appendChild(opt);
        });

        const currentMapping = fieldMappingRef.current[currentFieldName] || '';
        select.value = currentMapping;

        // ── Requirement 1: Uncheck + dim checkboxes if already mapped ──
        if (currentMapping) {
          setTimeout(() => {
            lockSidebar(true, domContainer, INJECT_ID);
          }, 50);
        }

        select.addEventListener('change', (e) => {
          e.stopPropagation();
          const val = /** @type {HTMLSelectElement} */ (e.target).value;

          if (val) {
            // ── Requirement 3: Rename field to Hebrew label ──
            const hebrewLabel = SOURCE_LABELS[val] || val;
            const newName = generateUniqueName(hebrewLabel, currentFieldName);

            // Save original name for restore
            originalNamesRef[newName] = originalNamesRef[currentFieldName] || currentFieldName;
            delete originalNamesRef[currentFieldName];

            // ── Requirement 4: Set content to {label} ──
            // ── Requirement 1: Uncheck editable, set readOnly ──
            const tmpl = designerRef.current.getTemplate();
            tmpl.schemas.forEach((page) => {
              page.forEach((field) => {
                if (field.name === currentFieldName) {
                  field.name = newName;
                  field.content = `{${hebrewLabel}}`;
                  field.readOnly = true;
                }
              });
            });
            designerRef.current.updateTemplate(tmpl);

            // Update mapping
            setFieldMapping((prev) => {
              const next = { ...prev };
              delete next[currentFieldName];
              next[newName] = val;
              fieldMappingRef.current = next;
              return next;
            });
          } else {
            // ── Deselect: restore original name ──
            const origName = originalNamesRef[currentFieldName] || currentFieldName;
            delete originalNamesRef[currentFieldName];

            const tmpl = designerRef.current.getTemplate();
            tmpl.schemas.forEach((page) => {
              page.forEach((field) => {
                if (field.name === currentFieldName) {
                  field.name = origName;
                  field.content = '';
                  field.readOnly = false;
                }
              });
            });
            designerRef.current.updateTemplate(tmpl);

            // Clear mapping
            setFieldMapping((prev) => {
              const next = { ...prev };
              delete next[currentFieldName];
              fieldMappingRef.current = next;
              return next;
            });
          }
        });

        wrapper.appendChild(select);

        // Status text
        const status = document.createElement('div');
        status.className = 'mapping-status';
        status.style.cssText = 'font-size:11px;color:#16a34a;margin-top:4px;';
        const hasMapping = !!currentMapping;
        status.textContent = hasMapping ? '✅ ימולא אוטומטית ולא ניתן לעריכה ע"י הלקוח' : '';
        status.style.display = hasMapping ? 'block' : 'none';
        wrapper.appendChild(status);
      }

      // Insert at the TOP of the sidebar
      const sidebar = nameInput.closest('[style*="overflow"]') || nameInput.closest('[style*="height"]');
      if (sidebar) {
        sidebar.prepend(wrapper);
      } else {
        let sidebarRoot = nameInput.parentElement;
        while (sidebarRoot?.parentElement && sidebarRoot.parentElement !== domContainer) {
          sidebarRoot = sidebarRoot.parentElement;
        }
        if (sidebarRoot) {
          sidebarRoot.prepend(wrapper);
        }
      }
      return currentFieldName;
    };

    // Generate unique Hebrew field name
    const generateUniqueName = (baseName, selfName) => {
      if (!designerRef.current) return baseName;
      const tmpl = designerRef.current.getTemplate();
      const allNames = tmpl.schemas.flat().map(f => f.name).filter(n => n !== selfName);
      if (!allNames.includes(baseName)) return baseName;
      let i = 2;
      while (allNames.includes(`${baseName} ${i}`)) i++;
      return `${baseName} ${i}`;
    };

    // Lock/unlock sidebar: uncheck+disable checkboxes, dim Name+Type
    const lockSidebar = (locked, container, injectId) => {
      const dim = locked ? '0.35' : '1';
      const pe = locked ? 'none' : 'auto';

      // Find Name input
      const nameInp = container.querySelector('input[type="text"]');
      if (nameInp && !nameInp.value.match(/^\d+(\.\d+)?$/)) {
        nameInp.disabled = locked;
        nameInp.style.opacity = dim;
        nameInp.style.pointerEvents = pe;
        if (nameInp.parentElement) nameInp.parentElement.style.opacity = dim;
      }

      // Dim Type select (skip our injected dropdown via data attribute)
      const selects = container.querySelectorAll('select');
      for (const sel of selects) {
        if (sel.getAttribute('data-inject') === 'true') continue;
        if (sel.closest('#' + injectId)) continue;
        sel.disabled = locked;
        sel.style.opacity = dim;
        sel.style.pointerEvents = pe;
        if (sel.parentElement) sel.parentElement.style.opacity = dim;
        break;
      }

      // Uncheck + disable first 2 checkboxes
      const cbs = container.querySelectorAll('input[type="checkbox"]');
      for (let i = 0; i < Math.min(2, cbs.length); i++) {
        if (locked) {
          // Uncheck the checkbox by dispatching a click if it's checked
          if (cbs[i].checked) {
            cbs[i].click(); // triggers pdfme's internal handler
          }
        }
        cbs[i].disabled = locked;
        // Dim the whole row
        let row = cbs[i].parentElement;
        while (row && row.childElementCount <= 1 && row.parentElement) {
          row = row.parentElement;
        }
        if (row) {
          row.style.opacity = dim;
          row.style.pointerEvents = pe;
        }
      }
    };

    // Click handler for field selection
    const handleClick = (e) => {
      if (e.target.closest('#' + INJECT_ID)) return;
      setTimeout(injectDataSourceDropdown, 200);
    };
    domContainer.addEventListener('click', handleClick);

    // MutationObserver — ALWAYS re-inject (debounced) when sidebar DOM changes
    // so we pick up the correct field type when switching between fields
    let _injecting = false;
    let _debounceTimer = null;
    const origInject = injectDataSourceDropdown;
    // Wrap injection to set guard flag
    const guardedInject = () => {
      _injecting = true;
      origInject();
      // Reset flag after a tick (our DOM changes will have triggered observer by then)
      requestAnimationFrame(() => { _injecting = false; });
    };

    const observer = new MutationObserver(() => {
      if (_injecting) return; // Don't re-inject from our own DOM changes
      clearTimeout(_debounceTimer);
      _debounceTimer = setTimeout(guardedInject, 350);
    });
    observer.observe(domContainer, { childList: true, subtree: true });

    // Cleanup
    const cleanup = () => {
      domContainer.removeEventListener('click', handleClick);
      observer.disconnect();
      clearTimeout(_debounceTimer);
      const el = document.getElementById(INJECT_ID);
      if (el) el.remove();
    };
    containerRef.current._cleanup = cleanup;
  }, [toast]);

  const handleNewTemplate = () => {
    setEditingId(null);
    setTemplateName("");
    setFieldMapping({});
    initDesigner();
  };

  const handleEditTemplate = async (template) => {
    setLoadingTemplate(template.id);
    setEditingId(template.id);
    setTemplateName(template.name);
    try {
      const parsed = JSON.parse(template.template_json);

      // Resolve file_uri basePdf reference back to Uint8Array
      if (parsed.basePdf?.__type === "file_uri") {
        const { signed_url } = await fileClient.getCpaTemplateFileUrl(template.id);
        const pdfRes = await fetch(signed_url);
        const arrayBuffer = await pdfRes.arrayBuffer();
        parsed.basePdf = new Uint8Array(arrayBuffer);
      }

      // Load fieldMapping if present
      setFieldMapping(parsed.fieldMapping || {});

      initDesigner(parsed);
    } catch (e) {
      console.error("Failed to load template:", e);
      toast({ title: "שגיאה", description: "לא ניתן לטעון את תבנית ה-PDF", variant: "destructive" });
      setLoadingTemplate(null);
    }
  };

  const handleUploadBasePdf = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf";
    input.onchange = async (e) => {
      const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (ev) => {
        const result = ev.target?.result;
        if (!(result instanceof ArrayBuffer)) return;
        const pdfData = new Uint8Array(result);

        // Update the designer's base PDF
        if (designerRef.current) {
          const currentTemplate = designerRef.current.getTemplate();
          const newTemplate = {
            ...currentTemplate,
            basePdf: pdfData,
          };
          designerRef.current.updateTemplate(newTemplate);
        } else {
          // Init new designer with this PDF
          await loadPdfme();
          initDesigner({
            basePdf: pdfData,
            schemas: [[]],
          });
        }
      };
      reader.readAsArrayBuffer(file);
    };
    input.click();
  };

  const handleSave = async () => {
    if (!designerRef.current) return;
    if (!templateName.trim()) {
      toast({ title: "שגיאה", description: "יש להזין שם לטופס", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const template = designerRef.current.getTemplate();
      // Upload basePdf as a file if it's binary data
      let basePdfRef = template.basePdf;
      if (basePdfRef instanceof Uint8Array || basePdfRef instanceof ArrayBuffer) {
        const bytes = basePdfRef instanceof ArrayBuffer ? new Uint8Array(basePdfRef) : basePdfRef;
        const fileBytes = Uint8Array.from(bytes).buffer;
        const file = new File([fileBytes], "base.pdf", { type: "application/pdf" });
        const file_uri = await fileClient.uploadCpaFile({
          file,
          ownerType: "pdf_template",
          ownerId: editingId || "pending",
          purpose: "pdf_template",
        });
        basePdfRef = { __type: "file_uri", value: file_uri };
      }

      const templateToSave = {
        ...template,
        basePdf: basePdfRef,
        fieldMapping: fieldMapping, // system field bindings
      };

      const payload = {
        name: templateName.trim(),
        template_json: JSON.stringify(templateToSave),
        is_active: true,
      };

      if (editingId) {
        await base44.entities.PdfTemplate.update(editingId, payload);
        toast({ title: "נשמר ✅", description: `תבנית "${templateName}" עודכנה` });
      } else {
        const created = await base44.entities.PdfTemplate.create(payload);
        setEditingId(created.id);
        toast({ title: "נשמר ✅", description: `תבנית "${templateName}" נוצרה` });
      }

      await loadTemplates();
    } catch (e) {
      console.error("Save failed:", e);
      toast({ title: "שגיאה", description: e.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    if (!confirm("למחוק את התבנית?")) return;
    try {
      await base44.entities.PdfTemplate.delete(id);
      toast({ title: "נמחק", description: "התבנית נמחקה" });
      await loadTemplates();
    } catch (e) {
      toast({ title: "שגיאה", description: e.message, variant: "destructive" });
    }
  };

  const handleBackToList = () => {
    if (containerRef.current?._cleanup) {
      containerRef.current._cleanup();
    }
    if (designerRef.current) {
      designerRef.current.destroy();
      designerRef.current = null;
    }
    setShowList(true);
    setEditingId(null);
    setTemplateName("");
    setFieldMapping({});
    setSelectedFieldName(null);
  };

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
      <div className="bg-white border-b border-border sticky top-0 z-20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => showList ? navigate("/questionnaire-settings") : handleBackToList()}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <FileText className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">
                {showList ? "טפסי PDF לחתימה" : (editingId ? "עריכת טופס" : "טופס חדש")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {showList ? "ניהול טפסים לחתימת לקוחות" : "סמנו שדות על ה-PDF"}
              </p>
            </div>
          </div>

          {!showList && (
            <div className="flex items-center gap-2">
              <Input
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="שם הטופס..."
                className="w-48 rounded-xl text-sm"
                dir="rtl"
              />
              <Button
                onClick={handleUploadBasePdf}
                variant="outline"
                size="sm"
                className="gap-1.5 rounded-xl"
              >
                <Upload className="w-4 h-4" />
                העלאת PDF
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving}
                size="sm"
                className="bg-primary hover:bg-primary/90 text-white gap-1.5 rounded-xl"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {saving ? "שומר..." : "שמור"}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Template list view */}
      {showList && (
        <div className="max-w-3xl mx-auto px-4 py-8">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-4"
          >
            {/* New template button */}
            <button
              onClick={handleNewTemplate}
              className="w-full border-2 border-dashed border-border hover:border-primary/40 rounded-2xl p-6 flex items-center justify-center gap-3 text-muted-foreground hover:text-primary transition-colors group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 group-hover:bg-primary/20 flex items-center justify-center transition-colors">
                <Plus className="w-6 h-6 text-primary" />
              </div>
              <div className="text-right">
                <span className="font-semibold text-foreground block">טופס PDF חדש</span>
                <span className="text-xs">העלו PDF, סמנו שדות לטקסט, צ׳קבוקס וחתימה</span>
              </div>
            </button>

            {/* Existing templates */}
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : existingTemplates.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>עדיין אין טפסים. צרו את הטופס הראשון!</p>
              </div>
            ) : (
              existingTemplates.map((t) => (
                <div
                  key={t.id}
                  className="bg-white rounded-2xl p-4 border border-border shadow-sm flex items-center gap-4 hover:border-primary/30 transition-colors"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground truncate">{t.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t.is_active ? "🟢 פעיל" : "⚪ לא פעיל"} • נוצר {new Date(t.created_date).toLocaleDateString("he-IL")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      onClick={() => handleEditTemplate(t)}
                      disabled={loadingTemplate === t.id}
                      variant="outline"
                      size="sm"
                      className="gap-1.5 rounded-xl"
                    >
                      {loadingTemplate === t.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                      {loadingTemplate === t.id ? "טוען..." : "עריכה"}
                    </Button>
                    <Button
                      onClick={() => handleDelete(t.id)}
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-red-50 rounded-xl"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}

            {/* Info box */}
            <div className="bg-muted/50 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
              <p>📄 <strong>איך זה עובד:</strong></p>
              <p>1. העלו טופס PDF (ייפוי כוח, הצהרה, וכו׳)</p>
              <p>2. סמנו שדות: טקסט (ימולא אוטומטית), צ׳קבוקס, חתימה</p>
              <p>3. הלקוח יקבל את הטופס בשאלון, ימלא ויחתום</p>
              <p>4. ה-PDF הסופי נשמר אוטומטית</p>
            </div>
          </motion.div>
        </div>
      )}

      {/* Designer view */}
      {!showList && (
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: "calc(100vh - 65px)", direction: "ltr" }}
        >
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
                <p className="text-muted-foreground text-sm">טוען עורך PDF...</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
