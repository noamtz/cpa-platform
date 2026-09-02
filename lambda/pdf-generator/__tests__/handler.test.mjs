import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, afterAll, vi } from "vitest";
import { loadImage } from "@napi-rs/canvas";
import pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";

import {
  createHandler,
  flattenInputs,
} from "../index.mjs";

const fixture = JSON.parse(
  readFileSync(new URL("../__fixtures__/rtl-multipage-case.json", import.meta.url)),
);
const corsOrigin = "https://example.cloudfront.net";
const originalCorsOrigin = process.env.CORS_ORIGIN;

function event(method, rawPath, body = undefined) {
  return {
    rawPath,
    requestContext: { http: { method, path: rawPath }, requestId: "gateway-id" },
    ...(body === undefined
      ? {}
      : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  };
}

function expectedCors() {
  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, sentry-trace, baggage, x-api-key",
  };
}

beforeEach(() => {
  process.env.CORS_ORIGIN = corsOrigin;
});

afterAll(() => {
  if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = originalCorsOrigin;
});

describe("PDF Lambda handler contract", () => {
  it("preserves OPTIONS, health, invalid JSON, and missing-field responses", async () => {
    const log = vi.fn();
    const handler = createHandler({ log });

    const preflight = await handler(event("OPTIONS", "/render-pages"));
    expect(preflight).toEqual({
      statusCode: 200,
      headers: expectedCors(),
      body: "OK",
    });

    const health = await handler(event("GET", "/health"));
    expect(health).toEqual({
      statusCode: 200,
      headers: { ...expectedCors(), "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, heeboLoaded: true }),
    });

    const invalid = await handler(event("POST", "/generate-pdf", "{"));
    expect(invalid).toEqual({
      statusCode: 400,
      headers: { ...expectedCors(), "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Invalid JSON body" }),
    });

    const missingGenerate = await handler(event("POST", "/generate-pdf", {}));
    expect(JSON.parse(missingGenerate.body)).toEqual({
      error: "Missing required fields: templateJson, basePdfUrl, inputs",
    });
    expect(missingGenerate.statusCode).toBe(400);
    expect(missingGenerate.headers).toMatchObject(expectedCors());

    const missingRender = await handler(event("POST", "/render-pages", {}));
    expect(missingRender.statusCode).toBe(400);
    expect(JSON.parse(missingRender.body)).toEqual({ error: "Missing basePdfUrl" });
    expect(missingRender.headers).toMatchObject(expectedCors());
    expect(log).toHaveBeenCalledTimes(5);
  });

  it("renders the two-page native fixture with ordered JPEGs and default dimensions", async () => {
    const handler = createHandler({ log: vi.fn() });
    const response = await handler(
      event("POST", "/render-pages", { basePdfUrl: fixture.basePdfUrl }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.headers).toEqual({
      ...expectedCors(),
      "Content-Type": "application/json",
    });
    const body = JSON.parse(response.body);
    expect(body.pageCount).toBe(2);
    expect(body.pages).toHaveLength(2);
    for (const [index, page] of body.pages.entries()) {
      const bytes = Buffer.from(page, "base64");
      expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
      const image = await loadImage(bytes);
      expect({ width: image.width, height: image.height }).toEqual(
        fixture.expected.defaultRender.pixelDimensions[index],
      );
    }
  });

  it("keeps page order and substitutes an exact 1x1 JPEG when one page fails", async () => {
    const canvasCalls = [];
    const createCanvas = (width, height) => ({
      width,
      height,
      getContext: () => ({}),
      toBuffer: (format, quality) => {
        canvasCalls.push({ width, height, format, quality });
        return Buffer.from(`jpeg:${width}x${height}:${quality}`);
      },
    });
    const viewport = vi.fn(({ scale }) => ({ width: 100 * scale, height: 200 * scale }));
    const pdfjs = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 2,
          getPage: async (pageNumber) => ({
            getViewport: viewport,
            render: () => {
              if (pageNumber === 1) throw new Error("synthetic page failure");
              return { promise: Promise.resolve() };
            },
          }),
        }),
      }),
    };
    const handler = createHandler({
      createCanvas,
      fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }),
      log: vi.fn(),
      pdfjs,
    });

    const response = await handler(
      event("POST", "/render-pages", { basePdfUrl: "https://redacted.invalid" }),
    );
    const body = JSON.parse(response.body);
    expect(response.statusCode).toBe(200);
    expect(body.pageCount).toBe(2);
    expect(body.pages.map((page) => Buffer.from(page, "base64").toString())).toEqual([
      "jpeg:1x1:50",
      "jpeg:150x300:80",
    ]);
    expect(viewport).toHaveBeenCalledWith({ scale: 1.5 });
    expect(canvasCalls).toContainEqual({
      width: 1,
      height: 1,
      format: "image/jpeg",
      quality: 50,
    });
  });

  it("preserves fetch failures and generation failures as JSON 500 responses", async () => {
    const fetchFailure = createHandler({
      fetch: async () => ({ ok: false, status: 403, statusText: "Forbidden" }),
      log: vi.fn(),
    });
    const render = await fetchFailure(
      event("POST", "/render-pages", { basePdfUrl: "https://redacted.invalid" }),
    );
    expect(render.statusCode).toBe(500);
    expect(JSON.parse(render.body)).toEqual({ error: "Failed to fetch PDF: 403" });
    expect(render.headers).toMatchObject(expectedCors());

    const generateFailure = createHandler({
      generate: async () => {
        throw new Error("synthetic generation failure");
      },
      log: vi.fn(),
    });
    const generated = await generateFailure(
      event("POST", "/generate-pdf", {
        templateJson: JSON.stringify(fixture.templateJson),
        basePdfUrl: fixture.basePdfUrl,
        inputs: fixture.inputs,
      }),
    );
    expect(generated.statusCode).toBe(500);
    expect(JSON.parse(generated.body)).toEqual({
      error: "synthetic generation failure",
    });
    expect(generated.headers).toMatchObject(expectedCors());
  });

  it("flattens inputs, injects Heebo, and preserves the binary proxy response", async () => {
    const calls = [];
    const handler = createHandler({
      generate: async (arguments_) => {
        calls.push(arguments_);
        return Buffer.from("%PDF-1.4\n%%EOF", "ascii");
      },
      log: vi.fn(),
    });
    const response = await handler(
      event("POST", "/generate-pdf", {
        templateJson: JSON.stringify(fixture.templateJson),
        basePdfUrl: fixture.basePdfUrl,
        inputs: fixture.inputs,
      }),
    );

    expect(response).toMatchObject({
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        ...expectedCors(),
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="signed-document.pdf"',
      },
    });
    expect(Buffer.from(response.body, "base64").toString("ascii")).toBe(
      "%PDF-1.4\n%%EOF",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].inputs).toEqual(flattenInputs(fixture.inputs));
    expect(calls[0].inputs).toHaveLength(1);
    expect(calls[0].options.font.Heebo.fallback).toBe(true);
    expect(calls[0].options.font.Heebo.data).toHaveLength(122_012);
  });

  it("generates one real two-page PDF from the synthetic RTL fixture", async () => {
    const handler = createHandler({ log: vi.fn() });
    const response = await handler(
      event("POST", "/generate-pdf", {
        templateJson: JSON.stringify(fixture.templateJson),
        basePdfUrl: fixture.basePdfUrl,
        inputs: fixture.inputs,
      }),
    );
    const pdfBytes = Buffer.from(response.body, "base64");
    expect(response.statusCode).toBe(200);
    expect(pdfBytes.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    const document = await pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) }).promise;
    expect(document.numPages).toBe(fixture.expected.pageCount);
  });

  it("logs aggregate measurements without URLs, fields, values, or raw errors", async () => {
    const log = vi.fn();
    let now = 100;
    const handler = createHandler({
      log,
      now: () => {
        now += 5;
        return now;
      },
    });
    await handler(
      event("POST", "/generate-pdf", {
        templateJson: JSON.stringify(fixture.templateJson),
        basePdfUrl: fixture.basePdfUrl,
        inputs: fixture.inputs,
      }),
      { awsRequestId: "request-123" },
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatchObject({
      event: "pdf_request",
      route: "generate-pdf",
      status: 200,
      durationMs: 5,
      pages: 2,
      requestId: "request-123",
    });
    const serialized = JSON.stringify(log.mock.calls[0][0]);
    for (const forbidden of [
      "basePdfUrl",
      "data:application/pdf",
      "rtl_text",
      "client_signature",
      "בדיקת עברית",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("PDF runtime assets", () => {
  it.each([
    ["Lambda", new URL("../fonts/Heebo-Regular.ttf", import.meta.url)],
    ["browser", new URL("../../../public/fonts/Heebo-Regular.ttf", import.meta.url)],
  ])("keeps the %s Heebo asset byte-identical", (_label, url) => {
    const bytes = readFileSync(url);
    expect(bytes).toHaveLength(122_012);
    expect(createHash("sha256").update(bytes).digest("hex").toUpperCase()).toBe(
      "18F930B583FA8FE6B40B2F8263B7AC6AFBAC07ADC91A12467874E7467D3ACE30",
    );
  });
});
