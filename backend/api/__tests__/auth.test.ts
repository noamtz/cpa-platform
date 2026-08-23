import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { resolveCpaActor } from "../auth/cpa-context";
import type { AccessTokenVerifier } from "../auth/jwt";

function event(
  claims: Record<string, string> = {
    sub: "subject-1",
    token_use: "access",
    scope: "openid auditflow-api/cpa",
  },
): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "GET /cpa/me",
    rawPath: "/cpa/me",
    rawQueryString: "",
    headers: { authorization: "Bearer opaque-test-token" },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "example.test",
      domainPrefix: "test",
      authorizer: { jwt: { claims, scopes: ["auditflow-api/cpa"] } },
      http: {
        method: "GET",
        path: "/cpa/me",
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey: "GET /cpa/me",
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

const verifier: AccessTokenVerifier = {
  async verify() {
    return {
      sub: "subject-1",
      clientId: "client-1",
      tokenUse: "access",
      scope: "openid auditflow-api/cpa",
    };
  },
};

describe("CPA actor resolution", () => {
  it("returns a frozen local admin actor after both token checks", async () => {
    const actor = await resolveCpaActor(event(), verifier, {
      async findByCognitoSubject() {
        return [{ id: "user-1", role: "admin", cognito_sub: "subject-1" }];
      },
    });

    expect(actor).toEqual({
      userId: "user-1",
      cognitoSubject: "subject-1",
      role: "admin",
    });
    expect(Object.isFrozen(actor)).toBe(true);
  });

  it.each([
    [{ sub: "subject-1", token_use: "id", scope: "auditflow-api/cpa" }],
    [{ sub: "subject-1", token_use: "access", scope: "openid" }],
  ])("rejects invalid gateway claims before business lookup", async (claims) => {
    const lookup = vi.fn();
    await expect(
      resolveCpaActor(event(claims), verifier, {
        findByCognitoSubject: lookup,
      }),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("rejects a raw token whose subject disagrees with Gateway", async () => {
    const lookup = vi.fn();
    await expect(
      resolveCpaActor(
        event(),
        {
          async verify() {
            return {
              sub: "another-subject",
              clientId: "client-1",
              tokenUse: "access",
              scope: "auditflow-api/cpa",
            };
          },
        },
        { findByCognitoSubject: lookup },
      ),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    { records: [] },
    {
      records: [
        { id: "user-1", role: "admin", cognito_sub: "subject-1" },
        { id: "user-2", role: "admin", cognito_sub: "subject-1" },
      ],
    },
    {
      records: [{ id: "user-1", role: "user", cognito_sub: "subject-1" }],
    },
  ])("rejects unlinked, duplicate, and non-admin profiles", async ({ records }) => {
    await expect(
      resolveCpaActor(event(), verifier, {
        async findByCognitoSubject() {
          return records;
        },
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("does not expose verifier failures", async () => {
    await expect(
      resolveCpaActor(
        event(),
        { async verify() { throw new Error("private token detail"); } },
        { async findByCognitoSubject() { return []; } },
      ),
    ).rejects.toMatchObject({ statusCode: 401, publicMessage: "Unauthorized" });
  });
});
