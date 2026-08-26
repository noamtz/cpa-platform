const LEGACY_PDF_API_PROD =
  "https://hickopn9f0.execute-api.il-central-1.amazonaws.com";
const LEGACY_PDF_API_TEST =
  "https://mr8yrlc9ic.execute-api.il-central-1.amazonaws.com";

function withoutTrailingSlashes(value) {
  return value.replace(/\/+$/, "");
}

export function resolvePdfApiUrl({ configured, hostname }) {
  const explicit = typeof configured === "string" ? configured.trim() : "";
  if (explicit) return withoutTrailingSlashes(explicit);
  return hostname === "app.ddcpa.co.il"
    ? LEGACY_PDF_API_PROD
    : LEGACY_PDF_API_TEST;
}

function endpoint(baseUrl, path) {
  return `${withoutTrailingSlashes(baseUrl)}${path}`;
}

async function responseError(response, fallback) {
  try {
    const body = await response.json();
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    // Preserve the current caller fallback when an endpoint returns non-JSON.
  }
  return fallback;
}

export async function renderPdfPages({
  baseUrl,
  basePdfUrl,
  scale = undefined,
  quality = undefined,
  fetchImpl = globalThis.fetch,
}) {
  const body = {
    basePdfUrl,
    ...(scale === undefined ? {} : { scale }),
    ...(quality === undefined ? {} : { quality }),
  };
  const response = await fetchImpl(endpoint(baseUrl, "/render-pages"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      await responseError(
        response,
        "שגיאה בהכנת תצוגה מקדימה",
      ),
    );
  }
  const result = await response.json();
  if (
    !Array.isArray(result?.pages) ||
    !result.pages.every((page) => typeof page === "string") ||
    !Number.isInteger(result?.pageCount) ||
    result.pageCount !== result.pages.length
  ) {
    throw new Error("Invalid PDF render response");
  }
  return result;
}

function base64FromResponseText(text) {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string") return parsed;
    if (parsed?.isBase64Encoded === true && typeof parsed.body === "string") {
      return parsed.body;
    }
  } catch {
    // Raw base64 is the inherited API Gateway fallback shape.
  }
  return trimmed;
}

async function assertPdfBlob(blob) {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error("Invalid PDF generation response");
  }
  const header = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...header) !== "%PDF-") {
    throw new Error("Invalid PDF generation response");
  }
  return blob;
}

export async function generatePdf({
  baseUrl,
  templateJson,
  basePdfUrl,
  inputs,
  fetchImpl = globalThis.fetch,
}) {
  const response = await fetchImpl(endpoint(baseUrl, "/generate-pdf"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ templateJson, basePdfUrl, inputs }),
  });
  if (!response.ok) {
    throw new Error(
      await responseError(response, `Server error: ${response.status}`),
    );
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/pdf")) {
    return assertPdfBlob(await response.blob());
  }

  try {
    const base64 = base64FromResponseText(await response.text());
    const bytes = Uint8Array.from(atob(base64), (character) =>
      character.charCodeAt(0),
    );
    return assertPdfBlob(new Blob([bytes], { type: "application/pdf" }));
  } catch (error) {
    if (error?.message === "Invalid PDF generation response") throw error;
    throw new Error("Invalid PDF generation response");
  }
}

export const legacyPdfApiUrls = {
  production: LEGACY_PDF_API_PROD,
  test: LEGACY_PDF_API_TEST,
};
