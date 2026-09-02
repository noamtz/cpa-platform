import { describe, expect, it, vi } from "vitest";

import {
  generatePdf,
  legacyPdfApiUrls,
  renderPdfPages,
  resolvePdfApiUrl,
} from "../pdf-api";

const pdfBytes = new TextEncoder().encode("%PDF-1.4\n%%EOF");

describe("resolvePdfApiUrl", () => {
  it("gives a non-empty configured value highest priority and removes trailing slashes", () => {
    expect(
      resolvePdfApiUrl({
        configured: "/pdf///",
        hostname: "app.ddcpa.co.il",
      }),
    ).toBe("/pdf");
    expect(
      resolvePdfApiUrl({
        configured: "https://pdf.example.test/",
        hostname: "localhost",
      }),
    ).toBe("https://pdf.example.test");
  });

  it("uses the legacy production endpoint only on the production hostname", () => {
    expect(
      resolvePdfApiUrl({ configured: "", hostname: "app.ddcpa.co.il" }),
    ).toBe(legacyPdfApiUrls.production);
    expect(
      resolvePdfApiUrl({ configured: "   ", hostname: "localhost" }),
    ).toBe(legacyPdfApiUrls.test);
    expect(
      resolvePdfApiUrl({ configured: undefined, hostname: "preview.example" }),
    ).toBe(legacyPdfApiUrls.test);
  });
});

describe("renderPdfPages", () => {
  it("sends the exact request and returns ordered page JSON", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ pages: ["first", "second"], pageCount: 2 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await renderPdfPages({
      baseUrl: "/pdf/",
      basePdfUrl: "https://signed.example/base.pdf",
      fetchImpl,
    });
    expect(result).toEqual({ pages: ["first", "second"], pageCount: 2 });
    expect(fetchImpl).toHaveBeenCalledWith("/pdf/render-pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ basePdfUrl: "https://signed.example/base.pdf" }),
    });
  });

  it("preserves endpoint errors and rejects malformed success responses", async () => {
    await expect(
      renderPdfPages({
        baseUrl: "/pdf",
        basePdfUrl: "redacted",
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "render failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toThrow("render failed");

    await expect(
      renderPdfPages({
        baseUrl: "/pdf",
        basePdfUrl: "redacted",
        fetchImpl: async () =>
          new Response(JSON.stringify({ pages: ["only"], pageCount: 2 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toThrow("Invalid PDF render response");
  });
});

describe("generatePdf", () => {
  it("returns a raw application/pdf response and preserves the request body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(pdfBytes, {
        status: 200,
        headers: { "Content-Type": "application/pdf" },
      }),
    );
    const input = {
      baseUrl: "/pdf",
      templateJson: "{\"schemas\":[]}",
      basePdfUrl: "https://signed.example/base.pdf",
      inputs: [{ field: "value" }],
      fetchImpl,
    };
    const blob = await generatePdf(input);
    expect(blob.type).toBe("application/pdf");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(pdfBytes);
    expect(fetchImpl).toHaveBeenCalledWith("/pdf/generate-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateJson: input.templateJson,
        basePdfUrl: input.basePdfUrl,
        inputs: input.inputs,
      }),
    });
  });

  it.each([
    ["raw text", Buffer.from(pdfBytes).toString("base64")],
    ["quoted text", JSON.stringify(Buffer.from(pdfBytes).toString("base64"))],
    [
      "proxy object",
      JSON.stringify({
        isBase64Encoded: true,
        body: Buffer.from(pdfBytes).toString("base64"),
      }),
    ],
  ])("decodes the inherited %s base64 response", async (_label, responseBody) => {
    const blob = await generatePdf({
      baseUrl: "https://legacy.example",
      templateJson: "{}",
      basePdfUrl: "redacted",
      inputs: [{}],
      fetchImpl: async () => new Response(responseBody, { status: 200 }),
    });
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(pdfBytes);
  });

  it("preserves JSON errors and rejects malformed PDF responses", async () => {
    await expect(
      generatePdf({
        baseUrl: "/pdf",
        templateJson: "{}",
        basePdfUrl: "redacted",
        inputs: [{}],
        fetchImpl: async () =>
          new Response(JSON.stringify({ error: "generation failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
      }),
    ).rejects.toThrow("generation failed");

    await expect(
      generatePdf({
        baseUrl: "/pdf",
        templateJson: "{}",
        basePdfUrl: "redacted",
        inputs: [{}],
        fetchImpl: async () => new Response("not-a-pdf", { status: 200 }),
      }),
    ).rejects.toThrow("Invalid PDF generation response");
  });
});
