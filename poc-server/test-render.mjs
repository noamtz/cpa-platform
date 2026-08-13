/**
 * Quick test: render a sample PDF page using pdfjs-dist + canvas on Node.js
 */
import { createCanvas } from "@napi-rs/canvas";
import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use a simple test PDF — the base PDF from public/ or any local file
// For this test, we'll create a minimal PDF in memory
const minimalPdf = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n206\n%%EOF",
  "ascii"
);

const canvasFactory = {
  create(width, height) {
    console.log(`  canvasFactory.create(${width}, ${height})`);
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

async function test() {
  try {
    console.log("Loading PDF...");
    const doc = await pdfjsLib.getDocument({
      data: new Uint8Array(minimalPdf),
      useSystemFonts: true,
      isEvalSupported: false,
      canvasFactory,
    }).promise;
    console.log(`PDF loaded: ${doc.numPages} pages`);

    const page = await doc.getPage(1);
    console.log("Got page 1");
    
    const viewport = page.getViewport({ scale: 1.5 });
    console.log(`Viewport: ${viewport.width} x ${viewport.height}`);

    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const context = canvas.getContext("2d");
    console.log("Canvas created, rendering...");

    const renderTask = page.render({
      canvasContext: context,
      viewport,
      canvasFactory,
    });
    
    console.log("renderTask type:", typeof renderTask);
    console.log("renderTask.promise type:", typeof renderTask?.promise);
    
    if (renderTask.promise) {
      await renderTask.promise;
    } else {
      await renderTask;
    }
    console.log("Render complete!");

    const jpegBuffer = canvas.toBuffer("image/jpeg", { quality: 0.80 });
    console.log(`JPEG: ${Math.round(jpegBuffer.length / 1024)}KB`);
    console.log("✅ Test passed!");
  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error("Stack:", err.stack);
  }
}

test();
