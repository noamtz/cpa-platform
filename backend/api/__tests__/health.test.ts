import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHandler } from "../handler";

function event(
  routeKey: string,
  rawPath = routeKey.split(" ")[1] ?? "/",
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey,
    rawPath,
    rawQueryString: "",
    headers: {},
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "example.invalid",
      domainPrefix: "test",
      http: {
        method: routeKey.split(" ")[0] ?? "GET",
        path: rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-123",
      routeKey,
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  };
}

function parseBody(response: unknown) {
  if (!response || typeof response !== "object" || !("body" in response)) {
    throw new Error("Expected a structured API Gateway response");
  }
  return JSON.parse(String(response.body));
}

const context = {} as Context;
const callback = vi.fn();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("health API handler", () => {
  it.each(["GET /health", "GET /auth/health"])(
    "returns the safe health body for %s after gateway authorization",
    async (routeKey) => {
      const response = await createHandler(() => "test")(
        event(routeKey),
        context,
        callback,
      );

      expect(response).toMatchObject({
        statusCode: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
      expect(parseBody(response)).toEqual({
        ok: true,
        service: "auditflow-api",
        stage: "test",
      });
      expect(JSON.stringify(response)).not.toContain("token");
      expect(JSON.stringify(response)).not.toContain("accountId");
    },
  );

  it("returns the observable JSON 404 contract", async () => {
    const response = await createHandler(() => "test")(
      event("GET /missing", "/missing"),
      context,
      callback,
    );

    expect(response).toMatchObject({ statusCode: 404 });
    expect(parseBody(response)).toEqual({ error: "Not found" });
  });

  it("rejects a malformed event without leaking it", async () => {
    const malformed = {
      version: "2.0",
      headers: { authorization: "Bearer should-not-leak" },
      requestContext: { requestId: "request-123" },
    } as unknown as APIGatewayProxyEventV2;
    const response = await createHandler(() => "test")(
      malformed,
      context,
      callback,
    );

    expect(response).toMatchObject({ statusCode: 400 });
    expect(parseBody(response)).toEqual({ error: "Invalid request" });
    expect(JSON.stringify(response)).not.toContain("should-not-leak");
  });

  it("returns a safe 500 and logs only bounded metadata", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await createHandler(() => {
      throw new Error("Bearer should-not-leak");
    })(event("GET /health"), context, callback);

    expect(response).toMatchObject({ statusCode: 500 });
    expect(parseBody(response)).toEqual({ error: "Internal server error" });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "should-not-leak",
    );
    expect(consoleError).toHaveBeenCalledWith(
      "AuditFlow API request failed",
      expect.objectContaining({
        requestId: "request-123",
        errorName: "Error",
        message: "Unhandled API error",
      }),
    );
  });
});
