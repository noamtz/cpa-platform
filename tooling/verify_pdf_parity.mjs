import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { PDFDocument } from "@pdfme/pdf-lib";
import { createCanvas, DOMMatrix, loadImage, Path2D } from "@napi-rs/canvas";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
if (!globalThis.Path2D) globalThis.Path2D = Path2D;

const { default: pdfjs } = await import("pdfjs-dist/legacy/build/pdf.js");

const DEFAULT_FIXTURE =
  "lambda/pdf-generator/__fixtures__/rtl-multipage-case.json";
const DEFAULT_CEILING = 6 * 1024 * 1024;
export const LAMBDA_SYNCHRONOUS_PAYLOAD_LIMIT_BYTES = 6 * 1024 * 1024;

export function redact(value) {
  return String(value)
    .replace(/https?:\/\/[^\s"']+/gi, "[endpoint]")
    .replace(/([?&](?:token|signature|sig|key|credential)\s*=)[^&\s]+/gi, "$1[redacted]")
    .slice(0, 500);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function visualThreshold(selfVariance, policy) {
  return Math.min(
    policy.maximumMismatchRatio,
    Math.max(
      policy.minimumMismatchRatio,
      selfVariance + policy.selfVarianceMargin,
    ),
  );
}

export function evaluateVisualMismatch(selfVariance, candidate, policy) {
  const threshold = visualThreshold(selfVariance, policy);
  return {
    selfVariance,
    candidateMismatch: candidate,
    threshold,
    calibrationPassed: selfVariance <= policy.maximumMismatchRatio,
    passed:
      selfVariance <= policy.maximumMismatchRatio && candidate <= threshold,
  };
}

export function bytesPolicy(legacyHashes, candidateHash) {
  const stable = legacyHashes.length > 1 && new Set(legacyHashes).size === 1;
  return {
    legacyStable: stable,
    exactComparisonRequired: stable,
    passed: !stable || legacyHashes[0] === candidateHash,
  };
}

export function lambdaPdfProxyPayloadBytes(pdfBytes, corsOrigin = "*") {
  const emptyProxyResponse = {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, sentry-trace, baggage, x-api-key",
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="signed-document.pdf"',
    },
    isBase64Encoded: true,
    body: "",
  };
  return (
    Buffer.byteLength(JSON.stringify(emptyProxyResponse)) +
    4 * Math.ceil(pdfBytes / 3)
  );
}

function canvasFactory() {
  return {
    create(width, height) {
      const canvas = createCanvas(width, height);
      return { canvas, context: canvas.getContext("2d") };
    },
    reset(target, width, height) {
      target.canvas.width = width;
      target.canvas.height = height;
    },
    destroy(target) {
      target.canvas.width = 0;
      target.canvas.height = 0;
    },
  };
}

export async function renderPdfRgba(pdfBytes, scale) {
  const factory = canvasFactory();
  const document = await pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    useSystemFonts: true,
    isEvalSupported: false,
    canvasFactory: factory,
  }).promise;
  const pages = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const viewport = page.getViewport({ scale });
    const width = Math.floor(viewport.width);
    const height = Math.floor(viewport.height);
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    const task = page.render({ canvasContext: context, viewport, canvasFactory: factory });
    await (task.promise || task);
    pages.push({
      width,
      height,
      rgba: Buffer.from(context.getImageData(0, 0, width, height).data),
      points: {
        width: Math.round(page.view[2] * 100) / 100,
        height: Math.round(page.view[3] * 100) / 100,
      },
    });
  }
  return pages;
}

async function renderImagesRgba(encodedPages) {
  const pages = [];
  for (const encoded of encodedPages) {
    const image = await loadImage(Buffer.from(encoded, "base64"));
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, image.width, image.height);
    context.drawImage(image, 0, 0);
    pages.push({
      width: image.width,
      height: image.height,
      rgba: Buffer.from(context.getImageData(0, 0, image.width, image.height).data),
    });
  }
  return pages;
}

export function pixelMismatch(leftPages, rightPages, perChannelDelta) {
  assert(leftPages.length === rightPages.length, "Rendered page count differs.");
  let mismatchedPixels = 0;
  let pixels = 0;
  for (let pageIndex = 0; pageIndex < leftPages.length; pageIndex += 1) {
    const left = leftPages[pageIndex];
    const right = rightPages[pageIndex];
    assert(
      left.width === right.width && left.height === right.height,
      `Rendered page ${pageIndex + 1} dimensions differ.`,
    );
    pixels += left.width * left.height;
    for (let offset = 0; offset < left.rgba.length; offset += 4) {
      if (
        Math.abs(left.rgba[offset] - right.rgba[offset]) > perChannelDelta ||
        Math.abs(left.rgba[offset + 1] - right.rgba[offset + 1]) > perChannelDelta ||
        Math.abs(left.rgba[offset + 2] - right.rgba[offset + 2]) > perChannelDelta
      ) {
        mismatchedPixels += 1;
      }
    }
  }
  return { mismatchedPixels, pixels, ratio: pixels ? mismatchedPixels / pixels : 0 };
}

function deterministicBoundaryJpeg(pixels) {
  const canvas = createCanvas(pixels, pixels);
  const context = canvas.getContext("2d");
  const image = context.createImageData(pixels, pixels);
  let state = 0x12345678;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    image.data[offset] = state & 0xff;
    image.data[offset + 1] = (state >>> 8) & 0xff;
    image.data[offset + 2] = (state >>> 16) & 0xff;
    image.data[offset + 3] = 0xff;
  }
  context.putImageData(image, 0, 0);
  return canvas.toBuffer("image/jpeg", 100);
}

async function repeatBasePdf(dataUrl, pageCount, hiddenJpegPixels) {
  const sourceBytes = Buffer.from(dataUrl.split(",", 2)[1], "base64");
  const source = await PDFDocument.load(sourceBytes);
  if (hiddenJpegPixels) {
    const boundaryImage = await source.embedJpg(
      deterministicBoundaryJpeg(hiddenJpegPixels),
    );
    for (const page of source.getPages()) {
      page.drawImage(boundaryImage, { x: -10, y: -10, width: 1, height: 1 });
    }
  }
  const output = await PDFDocument.create();
  output.setCreationDate(new Date("2025-01-01T00:00:00.000Z"));
  output.setModificationDate(new Date("2025-01-01T00:00:00.000Z"));
  output.setCreator("AuditFlow synthetic parity verifier");
  output.setProducer("AuditFlow synthetic parity verifier");
  for (let index = 0; index < pageCount; index += 1) {
    const [page] = await output.copyPages(source, [index % source.getPageCount()]);
    output.addPage(page);
  }
  return Buffer.from(await output.save({ useObjectStreams: false }));
}

function copyPageFields(sourceFields, sourceInput, pageIndex, fieldCopies) {
  const fields = [];
  const input = {};
  for (const field of sourceFields) {
    const name = `${field.name}_p${pageIndex}`;
    fields.push({ ...structuredClone(field), name });
    if (sourceInput[field.name] !== undefined) input[name] = sourceInput[field.name];
  }
  const seed = sourceFields.find((field) => field.type === "text");
  if (seed) {
    for (let copy = 1; copy < fieldCopies; copy += 1) {
      const name = `${seed.name}_p${pageIndex}_copy${copy}`;
      fields.push({
        ...structuredClone(seed),
        name,
        position: { x: 15 + ((copy * 31) % 130), y: 125 + ((copy * 9) % 130) },
        width: Math.min(seed.width, 55),
        height: Math.min(seed.height, 9),
        fontSize: Math.min(seed.fontSize || 10, 8),
      });
      input[name] = sourceInput[seed.name] || "בדיקת גבול סינתטית";
    }
  }
  return { fields, input };
}

export async function buildProfilePayload(fixture, profileName) {
  const profile = fixture.profiles[profileName];
  assert(profile, `Unknown fixture profile: ${profileName}`);
  const basePdf = await repeatBasePdf(
    fixture.basePdfUrl,
    profile.repeatedPages,
    profile.hiddenJpegPixels,
  );
  const basePdfUrl = `data:application/pdf;base64,${basePdf.toString("base64")}`;
  const schemas = [];
  const inputs = [];
  for (let index = 0; index < profile.repeatedPages; index += 1) {
    const sourceIndex = index % fixture.templateJson.schemas.length;
    const copied = copyPageFields(
      fixture.templateJson.schemas[sourceIndex],
      fixture.inputs[sourceIndex],
      index,
      profile.fieldCopies,
    );
    schemas.push(copied.fields);
    inputs.push(copied.input);
  }
  const templateJson = { basePdf: null, schemas };
  const body = { templateJson, basePdfUrl, inputs };
  let encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) < profile.targetRequestBytes.minimum) {
    templateJson.parityPadding = "x".repeat(
      profile.targetRequestBytes.minimum - Buffer.byteLength(encoded) + 64,
    );
    encoded = JSON.stringify(body);
  }
  const requestBytes = Buffer.byteLength(encoded);
  assert(requestBytes >= profile.targetRequestBytes.minimum, "Profile request is below its minimum size.");
  assert(requestBytes <= profile.targetRequestBytes.maximum, "Profile request exceeds its maximum size.");
  return {
    profile: profileName,
    profileContract: structuredClone(profile),
    basePdfUrl,
    renderBody: { basePdfUrl, scale: fixture.visual.scale, quality: 0.8 },
    generateBody: body,
    requestBytes,
    syntheticRequestSha256: sha256(Buffer.from(encoded)),
  };
}

function endpointUrl(base, route) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/${route.replace(/^\//, "")}`;
  return url;
}

export async function boundedFetch(url, options, limits) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > limits.responseReadCeilingBytes) {
      throw new Error("Response exceeds the configured read ceiling.");
    }
    const chunks = [];
    let bytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limits.responseReadCeilingBytes) {
          await reader.cancel();
          throw new Error("Response exceeds the configured read ceiling.");
        }
        chunks.push(Buffer.from(value));
      }
    }
    return {
      status: response.status,
      headers: response.headers,
      body: Buffer.concat(chunks),
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    };
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Endpoint request timed out.");
    throw new Error(redact(error.message));
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(response, label) {
  try {
    return JSON.parse(response.body.toString("utf8"));
  } catch {
    throw new Error(`${label} returned malformed JSON.`);
  }
}

async function probeEndpoint(base, limits) {
  const health = await boundedFetch(endpointUrl(base, "health"), { method: "GET" }, limits);
  const preflight = await boundedFetch(
    endpointUrl(base, "generate-pdf"),
    { method: "OPTIONS", headers: { Origin: "https://synthetic.invalid" } },
    limits,
  );
  const invalid = await boundedFetch(
    endpointUrl(base, "generate-pdf"),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" },
    limits,
  );
  const healthBody = parseJson(health, "Health probe");
  const invalidBody = parseJson(invalid, "Invalid JSON probe");
  const passed =
    health.status === 200 && healthBody.ok === true && healthBody.heeboLoaded === true &&
    preflight.status === 200 && Boolean(preflight.headers.get("access-control-allow-origin")) &&
    invalid.status === 400 && typeof invalidBody.error === "string";
  return {
    passed,
    healthStatus: health.status,
    preflightStatus: preflight.status,
    invalidJsonStatus: invalid.status,
    durationsMs: [health.durationMs, preflight.durationMs, invalid.durationMs],
  };
}

async function invokeEndpoint(base, payload, limits, fixture) {
  const render = await boundedFetch(
    endpointUrl(base, "render-pages"),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.renderBody) },
    limits,
  );
  assert(render.status === 200, `Render request returned status ${render.status}.`);
  assert(
    render.headers.get("content-type")?.includes("application/json") &&
      Boolean(render.headers.get("access-control-allow-origin")),
    "Render response headers have drifted.",
  );
  const renderJson = parseJson(render, "Render request");
  assert(Array.isArray(renderJson.pages), "Render response is missing pages.");
  assert(renderJson.pageCount === payload.profileContract.repeatedPages, "Render page count differs.");

  const generated = await boundedFetch(
    endpointUrl(base, "generate-pdf"),
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.generateBody) },
    limits,
  );
  assert(generated.status === 200, `Generate request returned status ${generated.status}.`);
  assert(
    generated.headers.get("content-type")?.includes("application/pdf") &&
      generated.headers.get("content-disposition") ===
        'attachment; filename="signed-document.pdf"' &&
      Boolean(generated.headers.get("access-control-allow-origin")),
    "Generate response headers have drifted.",
  );
  assert(generated.body.subarray(0, 5).toString() === "%PDF-", "Generate response is not a PDF.");
  assert(generated.body.length <= payload.profileContract.targetOutputBytes.maximum, "Generated PDF exceeds profile maximum.");
  assert(generated.body.length >= payload.profileContract.targetOutputBytes.minimum, "Generated PDF is below profile minimum.");
  const lambdaProxyPayloadBytes = lambdaPdfProxyPayloadBytes(
    generated.body.length,
    generated.headers.get("access-control-allow-origin") || "*",
  );
  assert(
    lambdaProxyPayloadBytes <= LAMBDA_SYNCHRONOUS_PAYLOAD_LIMIT_BYTES,
    "Generated PDF exceeds the Lambda synchronous proxy-response limit after base64 expansion.",
  );
  if (payload.profileContract.targetLambdaProxyPayloadBytes) {
    assert(
      lambdaProxyPayloadBytes >=
        payload.profileContract.targetLambdaProxyPayloadBytes.minimum &&
        lambdaProxyPayloadBytes <=
          payload.profileContract.targetLambdaProxyPayloadBytes.maximum,
      "Generated Lambda proxy response is outside the profile target band.",
    );
  }
  const generatedPages = await renderPdfRgba(generated.body, fixture.visual.scale);
  assert(generatedPages.length === payload.profileContract.repeatedPages, "Generated PDF page count differs.");
  for (let index = 0; index < generatedPages.length; index += 1) {
    const expected =
      fixture.expected.pageDimensionsPoints[
        index % fixture.expected.pageDimensionsPoints.length
      ];
    const actual = generatedPages[index].points;
    assert(
      Math.abs(actual.width - expected.width) <= 0.02 &&
        Math.abs(actual.height - expected.height) <= 0.02,
      `Generated PDF page ${index + 1} dimensions differ.`,
    );
  }
  return {
    render: {
      bytes: render.body.length,
      durationMs: render.durationMs,
      hash: sha256(render.body),
      pages: await renderImagesRgba(renderJson.pages),
    },
    generated: {
      bytes: generated.body.length,
      durationMs: generated.durationMs,
      hash: sha256(generated.body),
      pages: generatedPages,
      lambdaProxyPayloadBytes,
    },
  };
}

function compareArtifact(legacy, candidate, fixture) {
  const self = pixelMismatch(legacy[0].pages, legacy[1].pages, fixture.visual.perChannelDelta);
  const cross = pixelMismatch(legacy[0].pages, candidate.pages, fixture.visual.perChannelDelta);
  return {
    bytes: bytesPolicy(legacy.map((entry) => entry.hash), candidate.hash),
    visual: evaluateVisualMismatch(self.ratio, cross.ratio, fixture.visual),
    selfMismatchedPixels: self.mismatchedPixels,
    candidateMismatchedPixels: cross.mismatchedPixels,
    comparedPixels: cross.pixels,
  };
}

function summarizeRun(label, invocation) {
  return {
    endpoint: label,
    render: { status: 200, durationMs: invocation.render.durationMs, bytes: invocation.render.bytes, syntheticSha256: invocation.render.hash },
    generate: {
      status: 200,
      durationMs: invocation.generated.durationMs,
      bytes: invocation.generated.bytes,
      lambdaProxyPayloadBytes: invocation.generated.lambdaProxyPayloadBytes,
      syntheticSha256: invocation.generated.hash,
      pageCount: invocation.generated.pages.length,
      pageDimensionsPoints: invocation.generated.pages.map((page) => page.points),
    },
  };
}

export async function runParity({ legacyUrl, sstUrl, fixture, profile, iterations = 1, timeoutMs, responseReadCeilingBytes }) {
  assert(iterations >= 1 && iterations <= 5, "Iterations must be between 1 and 5.");
  const payload = await buildProfilePayload(fixture, profile);
  const limits = {
    timeoutMs: timeoutMs || payload.profileContract.timeoutMs,
    responseReadCeilingBytes: responseReadCeilingBytes || payload.profileContract.responseReadCeilingBytes || DEFAULT_CEILING,
    lambdaSynchronousPayloadBytes: LAMBDA_SYNCHRONOUS_PAYLOAD_LIMIT_BYTES,
  };
  assert(limits.timeoutMs > 0 && limits.timeoutMs <= 30_000, "Timeout must be between 1 and 30000 milliseconds.");
  assert(limits.responseReadCeilingBytes > 0 && limits.responseReadCeilingBytes <= DEFAULT_CEILING, "Response read ceiling cannot exceed 6 MB.");

  const probes = { legacy: await probeEndpoint(legacyUrl, limits), sst: await probeEndpoint(sstUrl, limits) };
  const legacy = [];
  const sst = [];
  for (let index = 0; index < iterations + 1; index += 1) {
    // Cross a PDF metadata clock tick so two coincidentally equal responses do
    // not misclassify a timestamp-bearing generator as byte-stable.
    if (index === 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_100));
    legacy.push(await invokeEndpoint(legacyUrl, payload, limits, fixture));
  }
  for (let index = 0; index < iterations; index += 1) sst.push(await invokeEndpoint(sstUrl, payload, limits, fixture));
  const comparisons = sst.map((candidate, index) => ({
    iteration: index + 1,
    render: compareArtifact(legacy.slice(0, 2).map((run) => run.render), candidate.render, fixture),
    generate: compareArtifact(legacy.slice(0, 2).map((run) => run.generated), candidate.generated, fixture),
  }));
  const passed = probes.legacy.passed && probes.sst.passed && comparisons.every((item) =>
    item.render.bytes.passed && item.render.visual.passed && item.generate.bytes.passed && item.generate.visual.passed,
  );
  return {
    schemaVersion: 1,
    fixture: fixture.name,
    profile,
    syntheticRequestBytes: payload.requestBytes,
    syntheticRequestSha256: payload.syntheticRequestSha256,
    limits,
    probes,
    runs: [
      ...legacy.map((run, index) => summarizeRun(`legacy-${index + 1}`, run)),
      ...sst.map((run, index) => summarizeRun(`sst-${index + 1}`, run)),
    ],
    comparisons,
    passed,
  };
}

export function parseArguments(argv) {
  if (argv.includes("--help")) return { help: true };
  const parsed = { fixture: DEFAULT_FIXTURE, profile: "compact", iterations: 1 };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    assert(flag?.startsWith("--") && value !== undefined, "Expected --option value pairs.");
    const key = flag.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    assert(["legacyUrl", "sstUrl", "fixture", "profile", "output", "iterations", "timeoutMs", "responseReadCeilingBytes"].includes(key), `Unknown option: ${flag}`);
    parsed[key] = ["iterations", "timeoutMs", "responseReadCeilingBytes"].includes(key) ? Number(value) : value;
  }
  assert(parsed.legacyUrl && parsed.sstUrl, "Both --legacy-url and --sst-url are required.");
  return parsed;
}

function help() {
  return `Usage: npm run verify:pdf-parity -- --legacy-url <url> --sst-url <url> [options]\n\nOptions:\n  --fixture <path>                    Synthetic fixture JSON\n  --profile <compact|representative|boundary>\n  --output <path>                     Write aggregate evidence JSON\n  --iterations <1-5>\n  --timeout-ms <1-30000>\n  --response-read-ceiling-bytes <max 6291456>\n`;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    process.stdout.write(help());
    return;
  }
  const fixture = JSON.parse(readFileSync(resolve(arguments_.fixture), "utf8"));
  const result = await runParity({ ...arguments_, fixture });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (arguments_.output) writeFileSync(resolve(arguments_.output), output);
  process.stdout.write(output);
  if (!result.passed) process.exitCode = 1;
}

if (resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`PDF parity verification failed: ${redact(error.message)}\n`);
    process.exitCode = 1;
  });
}
