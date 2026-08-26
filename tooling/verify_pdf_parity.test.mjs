import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHandler } from "../lambda/pdf-generator/index.mjs";
import {
  boundedFetch,
  buildProfilePayload,
  bytesPolicy,
  evaluateVisualMismatch,
  lambdaPdfProxyPayloadBytes,
  LAMBDA_SYNCHRONOUS_PAYLOAD_LIMIT_BYTES,
  parseArguments,
  redact,
  runParity,
  visualThreshold,
} from "./verify_pdf_parity.mjs";

const fixture = JSON.parse(
  readFileSync(
    resolve("lambda/pdf-generator/__fixtures__/rtl-multipage-case.json"),
    "utf8",
  ),
);
const servers = [];

async function listen(responder) {
  const server = createServer(responder);
  servers.push(server);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function handlerEndpoint() {
  const handler = createHandler({ log: () => {} });
  return listen(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const result = await handler({
      rawPath: new URL(request.url, "http://local").pathname,
      body: Buffer.concat(chunks).toString("utf8") || undefined,
      requestContext: { http: { method: request.method } },
    });
    response.writeHead(result.statusCode, result.headers);
    response.end(
      result.isBase64Encoded ? Buffer.from(result.body, "base64") : result.body,
    );
  });
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise((resolveClose) => server.close(resolveClose)),
    ),
  );
});

describe("PDF parity policy", () => {
  it("calibrates against legacy self-variance", () => {
    const policy = fixture.visual;
    expect(visualThreshold(0.006, policy)).toBeCloseTo(0.007);
    expect(evaluateVisualMismatch(0.006, 0.0065, policy).passed).toBe(true);
  });

  it("caps visual tolerance at one percent and rejects noisy calibration", () => {
    const policy = fixture.visual;
    expect(visualThreshold(0.0099, policy)).toBe(0.01);
    expect(evaluateVisualMismatch(0.011, 0, policy)).toMatchObject({
      threshold: 0.01,
      calibrationPassed: false,
      passed: false,
    });
  });

  it("falls back to structural and visual checks when legacy bytes vary", () => {
    expect(bytesPolicy(["legacy-a", "legacy-b"], "candidate")).toEqual({
      legacyStable: false,
      exactComparisonRequired: false,
      passed: true,
    });
    expect(bytesPolicy(["stable", "stable"], "different").passed).toBe(false);
  });

  it("builds deterministic bounded boundary payloads", async () => {
    const first = await buildProfilePayload(fixture, "boundary");
    const second = await buildProfilePayload(fixture, "boundary");
    expect(second.syntheticRequestSha256).toBe(first.syntheticRequestSha256);
    expect(first.requestBytes).toBeGreaterThanOrEqual(5_500_000);
    expect(first.requestBytes).toBeLessThanOrEqual(5_900_000);
    expect(first.profileContract.responseReadCeilingBytes).toBe(6_291_456);
    expect(first.generateBody.templateJson.schemas).toHaveLength(24);
  });

  it("puts the boundary PDF near the real Lambda proxy-response ceiling", async () => {
    const payload = await buildProfilePayload(fixture, "boundary");
    const handler = createHandler({ log: () => {} });
    const response = await handler({
      rawPath: "/generate-pdf",
      body: JSON.stringify(payload.generateBody),
      requestContext: { http: { method: "POST" } },
    });
    expect(response.statusCode).toBe(200);
    const pdfBytes = Buffer.byteLength(response.body, "base64");
    const proxyBytes = lambdaPdfProxyPayloadBytes(
      pdfBytes,
      response.headers["Access-Control-Allow-Origin"],
    );
    expect(proxyBytes).toBe(Buffer.byteLength(JSON.stringify(response)));
    expect(pdfBytes).toBeGreaterThanOrEqual(
      payload.profileContract.targetOutputBytes.minimum,
    );
    expect(pdfBytes).toBeLessThanOrEqual(
      payload.profileContract.targetOutputBytes.maximum,
    );
    expect(proxyBytes).toBeGreaterThanOrEqual(
      payload.profileContract.targetLambdaProxyPayloadBytes.minimum,
    );
    expect(proxyBytes).toBeLessThanOrEqual(
      payload.profileContract.targetLambdaProxyPayloadBytes.maximum,
    );
    expect(proxyBytes).toBeLessThan(LAMBDA_SYNCHRONOUS_PAYLOAD_LIMIT_BYTES);
    expect(
      lambdaPdfProxyPayloadBytes(4_800_000),
    ).toBeGreaterThan(LAMBDA_SYNCHRONOUS_PAYLOAD_LIMIT_BYTES);
  }, 30_000);

  it("parses bounded settings without exposing endpoint values", () => {
    const parsed = parseArguments([
      "--legacy-url", "https://legacy.invalid/path?token=secret",
      "--sst-url", "https://sst.invalid",
      "--iterations", "2",
      "--timeout-ms", "1000",
    ]);
    expect(parsed.iterations).toBe(2);
    expect(redact(parsed.legacyUrl)).not.toContain("secret");
    expect(redact(new Error(`failed ${parsed.legacyUrl}`).message)).toContain("[endpoint]");
  });
});

describe("bounded endpoint I/O", () => {
  it("rejects responses larger than the read ceiling", async () => {
    const endpoint = await listen((_request, response) => {
      response.writeHead(200, { "Content-Length": "100" });
      response.end("x".repeat(100));
    });
    await expect(
      boundedFetch(endpoint, {}, { timeoutMs: 1000, responseReadCeilingBytes: 10 }),
    ).rejects.toThrow("read ceiling");
  });

  it("aborts timed-out responses", async () => {
    const endpoint = await listen((_request, response) => {
      setTimeout(() => response.end("late"), 100);
    });
    await expect(
      boundedFetch(endpoint, {}, { timeoutMs: 10, responseReadCeilingBytes: 100 }),
    ).rejects.toThrow("timed out");
  });

  it("runs end-to-end against local handler endpoints", async () => {
    const endpoint = await handlerEndpoint();
    const result = await runParity({
      legacyUrl: endpoint,
      sstUrl: endpoint,
      fixture,
      profile: "compact",
      iterations: 1,
      timeoutMs: 30_000,
    });
    expect(result.passed, JSON.stringify(result.comparisons)).toBe(true);
    expect(result.runs).toHaveLength(3);
    expect(JSON.stringify(result)).not.toContain(endpoint);
    expect(result.comparisons[0].generate.visual.candidateMismatch).toBe(0);
  }, 60_000);
});
