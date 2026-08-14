/**
 * PDF Mobile POC Server
 *
 * Runs on http://localhost:3001
 * Vite proxies /poc-api/* → http://localhost:3001/*
 *
 * Endpoints:
 *   GET  /health              — health check
 *   POST /generate-pdf        — takes template + inputs → returns signed PDF blob
 *   POST /render-pages        — takes base PDF URL → returns page images (JPEG base64)
 */

import express from "express";
import cors from "cors";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { generate } from "@pdfme/generator";
import * as pdfmeSchemas from "@pdfme/schemas";
import { createCanvas, DOMMatrix, Path2D } from "@napi-rs/canvas";

// Polyfill globals for pdfjs-dist (it looks for `canvas` package by name)
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
if (!globalThis.Path2D) globalThis.Path2D = Path2D;

import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 3001;

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "100mb" })); // signatures + PDF base64 can be large

// ─── Load Heebo font once at startup ─────────────────────────────────────────
const heeboPath = join(__dirname, "../public/fonts/Heebo-Regular.ttf");
let heeboFontBuffer = null;
if (existsSync(heeboPath)) {
  heeboFontBuffer = readFileSync(heeboPath);
  console.log("✅ Heebo font loaded from", heeboPath);
} else {
  console.warn("⚠️  Heebo font not found at", heeboPath, "— using default font");
}

// ─── pdfme plugins (server-side, only pdf() functions are called, not ui()) ──
const PLUGINS = {
  Text: pdfmeSchemas.text,
  Image: pdfmeSchemas.image,
  Signature: pdfmeSchemas.signature,
  Checkbox: pdfmeSchemas.checkbox,
};

// ─── Health check ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ ok: true, heeboLoaded: !!heeboFontBuffer });
});

// ─── POST /generate-pdf ───────────────────────────────────────────────────────
/**
 * Body:
 * {
 *   templateJson:  string    — template.template_json (pdfme template, basePdf NOT resolved)
 *   basePdfUrl:    string    — signed URL to the base PDF file
 *   inputs:        object[]  — array of page input objects (field name → value)
 *                             signature field value = "data:image/png;base64,..."
 * }
 *
 * Response: application/pdf blob
 */
app.post("/generate-pdf", async (req, res) => {
  const { templateJson, basePdfUrl, inputs } = req.body;

  if (!templateJson || !basePdfUrl || !inputs) {
    return res.status(400).json({ error: "Missing required fields: templateJson, basePdfUrl, inputs" });
  }

  try {
    // 1. Fetch the base PDF from the signed URL
    console.log("[generate-pdf] Fetching base PDF from signed URL...");
    const pdfRes = await fetch(basePdfUrl);
    if (!pdfRes.ok) throw new Error(`Failed to fetch base PDF: ${pdfRes.status} ${pdfRes.statusText}`);
    const pdfBuffer = await pdfRes.arrayBuffer();
    const basePdf = new Uint8Array(pdfBuffer);
    console.log(`[generate-pdf] Base PDF fetched: ${basePdf.length} bytes`);

    // 2. Parse the template JSON
    const template = JSON.parse(templateJson);
    template.basePdf = basePdf;

    // 3. Build options (font if available)
    const options = {};
    if (heeboFontBuffer) {
      options.font = {
        Heebo: { data: heeboFontBuffer, fallback: true },
      };
    }

    // 4. Flatten inputs — pdfme generator needs all fields in a single object
    //    to avoid generating multiple copies of the PDF
    const flatInputs = flattenInputs(inputs);
    console.log("[generate-pdf] Generating PDF with inputs:", Object.keys(flatInputs[0] || {}));

    // 5. Generate
    const pdfBytes = await generate({
      template,
      inputs: flatInputs,
      plugins: PLUGINS,
      options,
    });

    console.log(`[generate-pdf] ✅ PDF generated: ${pdfBytes.length} bytes`);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="signed-document.pdf"');
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error("[generate-pdf] ❌ Error:", err);
    res.status(500).json({ error: err.message || "PDF generation failed" });
  }
});

// ─── POST /render-pages ──────────────────────────────────────────────────────
/**
 * Renders PDF pages as lightweight JPEG images server-side.
 * The client receives ready-to-display images instead of having to render
 * the PDF itself — critical for weak phones in WhatsApp WebView.
 *
 * Body:
 * {
 *   basePdfUrl:  string  — signed URL to the base PDF file
 *   scale:       number  — optional render scale (default: 1.5)
 *   quality:     number  — optional JPEG quality 0-1 (default: 0.80)
 * }
 *
 * Response: { pages: string[], pageCount: number }
 *   pages[i] = base64-encoded JPEG image of page i
 */
const canvasFactory = {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  },
  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  },
  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  },
};

app.post("/render-pages", async (req, res) => {
  const { basePdfUrl, scale: reqScale, quality: reqQuality } = req.body;

  if (!basePdfUrl) {
    return res.status(400).json({ error: "Missing basePdfUrl" });
  }

  const scale = reqScale || 1.5;
  const quality = reqQuality || 0.80;

  try {
    console.log("[render-pages] Fetching PDF...");
    const pdfRes = await fetch(basePdfUrl);
    if (!pdfRes.ok) throw new Error(`Failed to fetch PDF: ${pdfRes.status}`);
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    console.log(`[render-pages] PDF fetched: ${pdfBytes.length} bytes`);

    // Load PDF with pdf.js (Node.js mode — no web worker needed)
    const doc = await pdfjsLib.getDocument({
      data: pdfBytes,
      useSystemFonts: true,
      isEvalSupported: false,
      canvasFactory,
    }).promise;

    console.log(`[render-pages] PDF loaded: ${doc.numPages} pages, scale=${scale}`);

    const pages = [];

    for (let i = 1; i <= doc.numPages; i++) {
      try {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale });

        const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
        const context = canvas.getContext("2d");

        const renderTask = page.render({
          canvasContext: context,
          viewport,
          canvasFactory,
        });
        // pdfjs-dist v3: renderTask.promise; v2: renderTask is thenable
        if (renderTask.promise) {
          await renderTask.promise;
        } else {
          await renderTask;
        }

        const jpegBuffer = canvas.toBuffer("image/jpeg", Math.round(quality * 100));
        pages.push(jpegBuffer.toString("base64"));

        console.log(`[render-pages] Page ${i}: ${Math.round(jpegBuffer.length / 1024)}KB`);
      } catch (pageErr) {
        console.error(`[render-pages] ⚠️ Page ${i} render failed:`, pageErr.message);
        // Push a 1x1 transparent placeholder so page count stays correct
        const fallback = createCanvas(1, 1);
        pages.push(fallback.toBuffer("image/jpeg", 50).toString("base64"));
      }
    }

    console.log(`[render-pages] ✅ Rendered ${pages.length} pages`);
    res.json({ pages, pageCount: doc.numPages });
  } catch (err) {
    console.error("[render-pages] ❌ Error:", err);
    res.status(500).json({ error: err.message || "Failed to render pages" });
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Merge multi-page inputs into a single object so pdfme generates one PDF
 * (not one copy per page). Matches the flattenInputs() in pdfme-config.js.
 */
function flattenInputs(inputs) {
  if (!inputs || inputs.length <= 1) return inputs;
  const merged = {};
  inputs.forEach((pageInputs) => {
    Object.entries(pageInputs || {}).forEach(([key, val]) => {
      if (val !== undefined && val !== "") {
        merged[key] = val;
      }
    });
  });
  return [merged];
}

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 PDF POC Server running on http://localhost:${PORT}`);
  console.log(`   POST http://localhost:${PORT}/generate-pdf`);
  console.log(`   POST http://localhost:${PORT}/render-pages`);
  console.log(`   GET  http://localhost:${PORT}/health\n`);
});
