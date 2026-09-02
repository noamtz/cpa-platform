/**
 * AWS Lambda — PDF Generator
 *
 * Preserves the Terraform-managed renderer/generator HTTP contract while also
 * serving the dedicated SST PDF API. The function is intentionally compute-only:
 * callers supply an already-authorized, short-lived base PDF URL.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "@pdfme/generator";
import * as pdfmeSchemas from "@pdfme/schemas";
import { createCanvas, DOMMatrix, Path2D } from "@napi-rs/canvas";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
if (!globalThis.Path2D) globalThis.Path2D = Path2D;

const { default: pdfjsLib } = await import("pdfjs-dist/legacy/build/pdf.js");

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

let heeboFontBuffer = null;
try {
  heeboFontBuffer = readFileSync(
    join(moduleDirectory, "fonts", "Heebo-Regular.ttf"),
  );
  console.info(
    JSON.stringify({
      event: "pdf_font_init",
      loaded: true,
      bytes: heeboFontBuffer.length,
    }),
  );
} catch {
  console.warn(JSON.stringify({ event: "pdf_font_init", loaded: false }));
}

const PLUGINS = {
  Text: pdfmeSchemas.text,
  Image: pdfmeSchemas.image,
  Signature: pdfmeSchemas.signature,
  Checkbox: pdfmeSchemas.checkbox,
};

const defaultDependencies = {
  createCanvas,
  fetch: (...arguments_) => globalThis.fetch(...arguments_),
  generate,
  log: (measurement) => console.info(JSON.stringify(measurement)),
  now: () => performance.now(),
  pdfjs: pdfjsLib,
};

/** Merge multi-page inputs so pdfme generates one document, not one per page. */
export function flattenInputs(inputs) {
  if (!inputs || inputs.length <= 1) return inputs;
  const merged = {};
  inputs.forEach((pageInputs) => {
    Object.entries(pageInputs || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== "") merged[key] = value;
    });
  });
  return [merged];
}

/** Preserve the handler-owned Safari-compatible CORS response contract. */
export function corsHeaders() {
  const origin = process.env.CORS_ORIGIN || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, sentry-trace, baggage, x-api-key",
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function routeLabel(event) {
  if (event.requestContext?.http?.method === "OPTIONS") return "options";
  const path = event.rawPath || event.requestContext?.http?.path || "";
  if (path.endsWith("/health")) return "health";
  if (path.endsWith("/render-pages")) return "render-pages";
  return "generate-pdf";
}

function requestBytes(event) {
  if (typeof event.body === "string") return Buffer.byteLength(event.body);
  if (event.body === undefined || event.body === null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(event.body));
  } catch {
    return 0;
  }
}

function responseBytes(response) {
  if (typeof response.body !== "string") return 0;
  return response.isBase64Encoded
    ? Buffer.byteLength(response.body, "base64")
    : Buffer.byteLength(response.body);
}

function safePageCount(route, requestBody, response) {
  if (route === "render-pages" && response.statusCode === 200) {
    try {
      const parsed = JSON.parse(response.body);
      return Number.isInteger(parsed.pageCount) ? parsed.pageCount : null;
    } catch {
      return null;
    }
  }
  if (route === "generate-pdf" && requestBody?.templateJson) {
    try {
      const template =
        typeof requestBody.templateJson === "string"
          ? JSON.parse(requestBody.templateJson)
          : requestBody.templateJson;
      return Array.isArray(template.schemas) ? template.schemas.length : null;
    } catch {
      return null;
    }
  }
  return null;
}

function emitMeasurement({
  dependencies,
  event,
  context,
  route,
  requestBody,
  response,
  startedAt,
}) {
  const configuredMemory = Number(
    process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || 0,
  );
  dependencies.log({
    event: "pdf_request",
    route,
    status: response.statusCode,
    durationMs: Math.max(
      0,
      Math.round((dependencies.now() - startedAt) * 100) / 100,
    ),
    inputBytes: requestBytes(event),
    outputBytes: responseBytes(response),
    pages: safePageCount(route, requestBody, response),
    rssBytes: process.memoryUsage().rss,
    functionMemoryMb: configuredMemory || null,
    requestId:
      context?.awsRequestId || event.requestContext?.requestId || "local",
  });
}

export function createCanvasFactory(canvasCreator = createCanvas) {
  return {
    create(width, height) {
      const canvas = canvasCreator(width, height);
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
}

export async function handleRenderPages(
  body,
  dependencies = defaultDependencies,
) {
  const { basePdfUrl, scale: requestedScale, quality: requestedQuality } =
    body || {};
  if (!basePdfUrl) return jsonResponse(400, { error: "Missing basePdfUrl" });

  const scale = requestedScale || 1.5;
  const quality = requestedQuality || 0.8;
  const canvasFactory = createCanvasFactory(dependencies.createCanvas);

  try {
    const pdfResponse = await dependencies.fetch(basePdfUrl);
    if (!pdfResponse.ok) {
      throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
    }
    const pdfBytes = new Uint8Array(await pdfResponse.arrayBuffer());
    const document = await dependencies.pdfjs.getDocument({
      data: pdfBytes,
      useSystemFonts: true,
      isEvalSupported: false,
      canvasFactory,
    }).promise;

    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      try {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale });
        const canvas = dependencies.createCanvas(
          Math.floor(viewport.width),
          Math.floor(viewport.height),
        );
        const renderTask = page.render({
          canvasContext: canvas.getContext("2d"),
          viewport,
          canvasFactory,
        });
        await (renderTask.promise || renderTask);
        const jpeg = canvas.toBuffer(
          "image/jpeg",
          Math.round(quality * 100),
        );
        pages.push(jpeg.toString("base64"));
      } catch {
        const fallback = dependencies.createCanvas(1, 1);
        pages.push(
          fallback.toBuffer("image/jpeg", 50).toString("base64"),
        );
      }
    }

    return jsonResponse(200, { pages, pageCount: document.numPages });
  } catch (error) {
    return jsonResponse(500, {
      error: error.message || "Failed to render pages",
    });
  }
}

export async function handleGeneratePdf(
  body,
  dependencies = defaultDependencies,
) {
  const { templateJson, basePdfUrl, inputs } = body || {};
  if (!templateJson || !basePdfUrl || !inputs) {
    return jsonResponse(400, {
      error: "Missing required fields: templateJson, basePdfUrl, inputs",
    });
  }

  try {
    const pdfResponse = await dependencies.fetch(basePdfUrl);
    if (!pdfResponse.ok) {
      throw new Error(
        `Failed to fetch base PDF: ${pdfResponse.status} ${pdfResponse.statusText}`,
      );
    }
    const basePdf = new Uint8Array(await pdfResponse.arrayBuffer());
    const template =
      typeof templateJson === "string"
        ? JSON.parse(templateJson)
        : structuredClone(templateJson);
    template.basePdf = basePdf;

    const options = {};
    if (heeboFontBuffer) {
      options.font = {
        Heebo: { data: heeboFontBuffer, fallback: true },
      };
    }

    const pdfBytes = await dependencies.generate({
      template,
      inputs: flattenInputs(inputs),
      plugins: PLUGINS,
      options,
    });

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
  } catch (error) {
    return jsonResponse(500, {
      error: error.message || "PDF generation failed",
    });
  }
}

export function createHandler(overrides = {}) {
  const dependencies = { ...defaultDependencies, ...overrides };
  return async function pdfHandler(event, context = {}) {
    const startedAt = dependencies.now();
    const route = routeLabel(event);
    let requestBody;
    let response;

    if (route === "options") {
      response = { statusCode: 200, headers: corsHeaders(), body: "OK" };
    } else if (route === "health") {
      response = jsonResponse(200, {
        ok: true,
        heeboLoaded: Boolean(heeboFontBuffer),
      });
    } else {
      try {
        requestBody =
          typeof event.body === "string" ? JSON.parse(event.body) : event.body;
      } catch {
        response = jsonResponse(400, { error: "Invalid JSON body" });
      }

      if (!response) {
        response =
          route === "render-pages"
            ? await handleRenderPages(requestBody, dependencies)
            : await handleGeneratePdf(requestBody, dependencies);
      }
    }

    emitMeasurement({
      dependencies,
      event,
      context,
      route,
      requestBody,
      response,
      startedAt,
    });
    return response;
  };
}

export const handler = createHandler();
