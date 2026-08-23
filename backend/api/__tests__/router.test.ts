import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it } from "vitest";

import { jsonResponse } from "../core/http";
import { ApiRouter } from "../core/router";

const event = {} as APIGatewayProxyEventV2;

describe("API router", () => {
  it("dispatches only explicitly registered method/path pairs", async () => {
    const router = new ApiRouter().register("GET /health", async () =>
      jsonResponse(200, { ok: true }),
    );

    await expect(router.dispatch("GET /health", event)).resolves.toMatchObject({
      statusCode: 200,
    });
    await expect(router.dispatch("POST /health", event)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("rejects duplicate route registration", () => {
    const router = new ApiRouter().register("GET /health", async () =>
      jsonResponse(200, {}),
    );
    expect(() =>
      router.register("GET /health", async () => jsonResponse(200, {})),
    ).toThrow("Duplicate API route");
  });
});
