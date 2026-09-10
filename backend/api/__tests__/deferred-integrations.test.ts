import type { Context } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHandler } from "../handler";
import type { ApiDependencies } from "../handler";

const event = {
  version: "2.0",
  routeKey: "POST /cpa/integrations/google-drive/sync",
  rawPath: "/cpa/integrations/google-drive/sync",
  rawQueryString: "",
  headers: { authorization: "Bearer opaque-test-token" },
  body: JSON.stringify({ check_connection: true }),
  requestContext: {
    requestId: "request-1",
    authorizer: {
      jwt: {
        claims: {
          sub: "subject-1",
          token_use: "access",
          scope: "openid auditflow-api/cpa",
        },
      },
    },
    http: { method: "POST", path: "/cpa/integrations/google-drive/sync" },
  },
  isBase64Encoded: false,
};

const dependencies = {
  verifier: {
    async verify() {
      return {
        sub: "subject-1",
        clientId: "client-1",
        tokenUse: "access" as const,
        scope: "auditflow-api/cpa",
      };
    },
  },
  users: {
    async findByCognitoSubject() {
      return [{ id: "user-1", email: "admin@example.test", role: "admin", cognito_sub: "subject-1" }];
    },
  },
  entities: {},
  userService: {},
} as unknown as ApiDependencies;

afterEach(() => vi.restoreAllMocks());

describe("deferred integration routes", () => {
  it.each([
    ["POST /cpa/integrations/google-drive/sync", "/cpa/integrations/google-drive/sync", { check_connection: true }, "google-drive"],
    ["POST /cpa/integrations/google-drive/connect", "/cpa/integrations/google-drive/connect", { connector_id: "drive" }, "google-drive"],
    ["POST /cpa/integrations/google-drive/disconnect", "/cpa/integrations/google-drive/disconnect", { connector_id: "drive" }, "google-drive"],
    ["POST /cpa/integrations/telegram/notify", "/cpa/integrations/telegram/notify", { event: "submission.completed", record_id: "submission-1" }, "telegram"],
  ])("returns the controlled 501 without outbound requests for %s", async (routeKey, rawPath, body, feature) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await createHandler(() => "test", () => dependencies)(
      {
        ...event,
        routeKey,
        rawPath,
        body: JSON.stringify(body),
        requestContext: { ...event.requestContext, http: { method: "POST", path: rawPath } },
      } as never,
      {} as Context,
      vi.fn(),
    );
    expect(response).toMatchObject({ statusCode: 501 });
    expect(JSON.parse(String((response as { body: string }).body))).toEqual({
      error: "Not implemented",
      code: "FEATURE_NOT_IMPLEMENTED",
      feature,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("accepts the existing batch payload before returning the controlled 501", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await createHandler(() => "test", () => dependencies)(
      {
        ...event,
        body: JSON.stringify({
          sync_all: true,
          submission_ids: [
            { submission_id: "submission-1", client_id: "client-1" },
            { submission_id: "submission-2", client_id: "client-2" },
          ],
        }),
      } as never,
      {} as Context,
      vi.fn(),
    );

    expect(response).toMatchObject({ statusCode: 501 });
    expect(JSON.parse(String((response as { body: string }).body))).toEqual({
      error: "Not implemented",
      code: "FEATURE_NOT_IMPLEMENTED",
      feature: "google-drive",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects malformed input before returning the controlled response", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await createHandler(() => "test", () => dependencies)(
      { ...event, body: JSON.stringify({ check_connection: false }) } as never,
      {} as Context,
      vi.fn(),
    );
    expect(response).toMatchObject({ statusCode: 400 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("authenticates before disclosing that the integration is deferred", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await createHandler(() => "test", () => dependencies)(
      {
        ...event,
        headers: {},
        requestContext: { ...event.requestContext, authorizer: undefined },
      } as never,
      {} as Context,
      vi.fn(),
    );
    expect(response).toMatchObject({ statusCode: 401 });
    expect(String((response as { body: string }).body)).not.toContain("FEATURE_NOT_IMPLEMENTED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
