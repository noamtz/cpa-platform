/**
 * AWS Lambda — PDF Generator
 *
 * Receives a pdfme template + field inputs + signed base PDF URL,
 * generates the final signed PDF server-side, and returns it as base64.
 *
 * Replaces the local poc-server/server.mjs for production use.
 * Deployed via GitHub Actions CI/CD on push to main.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { generate } from "@pdfme/generator";
import * as pdfmeSchemas from "@pdfme/schemas";
import { createCanvas, DOMMatrix, Path2D } from "@napi-rs/canvas";

// Polyfill globals for pdfjs-dist (it looks for `canvas` package by name)
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
if (!globalThis.Path2D) globalThis.Path2D = Path2D;

import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load Heebo font once (stays warm between invocations) ────────────────────
let heeboFontBuffer = null;
try {
  heeboFontBuffer = readFileSync(join(__dirname, "fonts", "Heebo-Regular.ttf"));
  console.log("✅ Heebo font loaded");
} catch (e) {
  console.warn("⚠️ Heebo font not found — using default font");
}

// ─── pdfme plugins ────────────────────────────────────────────────────────────
const PLUGINS = {
  Text: pdfmeSchemas.text,
  Image: pdfmeSchemas.image,
  Signature: pdfmeSchemas.signature,
  Checkbox: pdfmeSchemas.checkbox,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Merge multi-page inputs into a single object so pdfme generates one PDF.
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

/**
 * Build CORS headers from environment or allow all in test.
 */
function corsHeaders() {
  const origin = process.env.CORS_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, sentry-trace, baggage, x-api-key",
  };
}

// ─── Lambda Handler ───────────────────────────────────────────────────────────
export async function handler(event) {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders(), body: "OK" };
  }

  // Health check
  const path = event.rawPath || event.requestContext?.http?.path || "";
  if (path.endsWith("/health")) {
    return {
      statusCode: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, heeboLoaded: !!heeboFontBuffer }),
    };
  }

  // Parse request body
  let body;
  try {
    body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  // ─── /render-pages ──────────────────────────────────────────────────────────
  if (path.endsWith("/render-pages")) {
    return handleRenderPages(body);
  }

  // ─── /generate-pdf (default) ────────────────────────────────────────────────



  const { templateJson, basePdfUrl, inputs } = body || {};

  if (!templateJson || !basePdfUrl || !inputs) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing required fields: templateJson, basePdfUrl, inputs" }),
    };
  }

  try {
    // 1. Fetch base PDF from signed URL
    console.log("[generate-pdf] Fetching base PDF...");
    const pdfRes = await fetch(basePdfUrl);
    if (!pdfRes.ok) {
      throw new Error(`Failed to fetch base PDF: ${pdfRes.status} ${pdfRes.statusText}`);
    }
    const pdfBuffer = await pdfRes.arrayBuffer();
    const basePdf = new Uint8Array(pdfBuffer);
    console.log(`[generate-pdf] Base PDF: ${basePdf.length} bytes`);

    // 2. Parse template and inject base PDF
    const template = JSON.parse(templateJson);
    template.basePdf = basePdf;

    // 3. Build options
    const options = {};
    if (heeboFontBuffer) {
      options.font = {
        Heebo: { data: heeboFontBuffer, fallback: true },
      };
    }

    // 4. Flatten inputs
    const flatInputs = flattenInputs(inputs);
    console.log("[generate-pdf] Fields:", Object.keys(flatInputs[0] || {}));

    // 5. Generate PDF
    const pdfBytes = await generate({
      template,
      inputs: flatInputs,
      plugins: PLUGINS,
      options,
    });

    console.log(`[generate-pdf] ✅ Generated: ${pdfBytes.length} bytes`);

    // 6. Return as base64 (API Gateway binary support)
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="signed-document.pdf"',
      },
      isBase64Encoded: true,
      body: Buffer.from(pdfBytes).toString("base64"),
    };
  } catch (err) {
    console.error("[generate-pdf] ❌ Error:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "PDF generation failed" }),
    };
  }
}

// ─── Canvas factory for pdfjs-dist ────────────────────────────────────────────
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

// ─── /render-pages handler ────────────────────────────────────────────────────
async function handleRenderPages(body) {
  const { basePdfUrl, scale: reqScale, quality: reqQuality } = body || {};

  if (!basePdfUrl) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Missing basePdfUrl" }),
    };
  }

  const scale = reqScale || 1.5;
  const quality = reqQuality || 0.80;

  try {
    console.log("[render-pages] Fetching PDF...");
    const pdfRes = await fetch(basePdfUrl);
    if (!pdfRes.ok) throw new Error(`Failed to fetch PDF: ${pdfRes.status}`);
    const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());
    console.log(`[render-pages] PDF fetched: ${pdfBytes.length} bytes`);

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
        if (renderTask.promise) {
          await renderTask.promise;
        } else {
          await renderTask;
        }

        const jpegBuffer = canvas.toBuffer("image/jpeg", Math.round(quality * 100));
        pages.push(jpegBuffer.toString("base64"));
        console.log(`[render-pages] Page ${i}: ${Math.round(jpegBuffer.length / 1024)}KB`);
      } catch (pageErr) {
        console.error(`[render-pages] ⚠️ Page ${i} failed:`, pageErr.message);
        const fallback = createCanvas(1, 1);
        pages.push(fallback.toBuffer("image/jpeg", 50).toString("base64"));
      }
    }

    console.log(`[render-pages] ✅ Rendered ${pages.length} pages`);
    return {
      statusCode: 200,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ pages, pageCount: doc.numPages }),
    };
  } catch (err) {
    console.error("[render-pages] ❌ Error:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Failed to render pages" }),
    };
  }
}
