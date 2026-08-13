# AuditFlow PDF pipeline

Use this when porting PDF templates, rendering, or signing. Keep heavy browser PDF tooling lazy-loaded and keep final page rendering/PDF generation behind the server-side PDF API. Preserve CORS responses and the current PDF response contract. Evidence: source `src/App.jsx`, `src/components/questionnaire/PdfFormStep.jsx`, and `lambda/pdf-generator/index.mjs`.

pdfme containers must have a fixed height with overflow handling, not `minHeight`, because its `ResizeObserver` can enter an unbounded render loop. Source `src/docs/PDF_MODULE.md` contains the failure evidence and manual verification notes.
