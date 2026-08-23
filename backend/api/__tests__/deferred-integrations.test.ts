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
      return [{ id: "user-1", role: "admin", cognito_sub: "subject-1" }];
    },
  },
  entities: {},
  userService: {},
} as unknown as ApiDependencies;

afterEach(() => vi.restoreAllMocks());

describe("deferred integration routes", () => {
  it("returns the controlled Google Drive 501 without outbound requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await createHandler(() => "test", () => dependencies)(
      event as never,
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
});
