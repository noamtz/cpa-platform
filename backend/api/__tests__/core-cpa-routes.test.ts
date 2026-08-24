import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { createHandler, type ApiDependencies } from "../handler";
import type { UserRepository } from "../repositories/user";
import type { EntityService } from "../services/entities";
import type { FileService } from "../services/files";
import type { PublicQuestionnaireService } from "../services/public-questionnaire";
import type { UserService } from "../services/users";

function event(
  routeKey: string,
  body?: unknown,
  options: { id?: string; authorized?: boolean } = {},
) {
  const rawPath = routeKey.split(" ")[1]?.replace("{id}", options.id ?? "") ?? "/";
  return {
    version: "2.0",
    routeKey,
    rawPath,
    rawQueryString: "",
    headers:
      options.authorized === false
        ? {}
        : { authorization: "Bearer opaque-test-token" },
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: options.id ? { id: options.id } : undefined,
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "example.test",
      domainPrefix: "test",
      authorizer:
        options.authorized === false
          ? undefined
          : {
              jwt: {
                claims: {
                  sub: "subject-1",
                  token_use: "access",
                  scope: "openid auditflow-api/cpa",
                },
                scopes: ["auditflow-api/cpa"],
              },
            },
      http: {
        method: routeKey.split(" ")[0],
        path: rawPath,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-1",
      routeKey,
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function setup() {
  const entities = {
    listClients: vi.fn().mockResolvedValue([{ id: "client-1" }]),
    createClient: vi.fn().mockResolvedValue({ id: "client-created" }),
    updateClient: vi.fn().mockResolvedValue({ id: "client-1" }),
    rotateClientToken: vi.fn().mockResolvedValue({ id: "client-1", token: "server" }),
    listSubmissions: vi.fn().mockResolvedValue([{ id: "submission-1" }]),
    updateSubmission: vi.fn().mockResolvedValue({ id: "submission-1" }),
  } as unknown as EntityService;
  const userService = {
    me: vi.fn().mockResolvedValue({ id: "user-1" }),
    updateMe: vi.fn().mockResolvedValue({ id: "user-1", drive_base_path: "Root" }),
    list: vi.fn().mockResolvedValue([{ id: "user-1" }]),
    invite: vi.fn().mockResolvedValue({ id: "user-2" }),
  } as unknown as UserService;
  const dependencies: ApiDependencies = {
    verifier: {
      async verify() {
        return {
          sub: "subject-1",
          clientId: "client-id",
          tokenUse: "access",
          scope: "openid auditflow-api/cpa",
        };
      },
    },
    users: {
      async findByCognitoSubject() {
        return [
          {
            id: "user-1",
            email: "admin@example.test",
            role: "admin",
            cognito_sub: "subject-1",
            record_type: "User",
            _version: 1,
            created_date: "2026-01-01T00:00:00.000Z",
            updated_date: "2026-01-01T00:00:00.000Z",
          },
        ];
      },
    } as unknown as UserRepository,
    entities,
    publicQuestionnaire: {} as PublicQuestionnaireService,
    files: {} as FileService,
    userService,
  };
  return {
    entities,
    userService,
    handler: createHandler(() => "test", () => dependencies),
  };
}

const context = {} as Context;
const callback = vi.fn();

function body(response: unknown) {
  return JSON.parse(String((response as { body: string }).body));
}

describe("assembled CPA routes", () => {
  it("preserves bare list results and Base44 query arguments", async () => {
    const { handler, entities } = setup();
    const response = await handler(
      event("POST /cpa/clients/query", {
        filter: { is_archived: false },
        sort: "-created_date",
        limit: 200,
      }),
      context,
      callback,
    );
    expect(response).toMatchObject({ statusCode: 200 });
    expect(body(response)).toEqual([{ id: "client-1" }]);
    expect(entities.listClients).toHaveBeenCalledWith(
      { is_archived: false },
      "-created_date",
      200,
    );
  });

  it("returns 201 for Client create and invitation", async () => {
    const { handler } = setup();
    const client = await handler(
      event("POST /cpa/clients", { full_name: "Invented", token: "weak" }),
      context,
      callback,
    );
    const invitation = await handler(
      event("POST /cpa/users/invitations", {
        email: "invitee@example.test",
        role: "admin",
      }),
      context,
      callback,
    );
    expect(client).toMatchObject({ statusCode: 201 });
    expect(invitation).toMatchObject({ statusCode: 201 });
  });

  it("maps path parameters for updates and token rotation", async () => {
    const { handler, entities } = setup();
    await handler(
      event("PATCH /cpa/clients/{id}", { status: "reviewed" }, { id: "client-1" }),
      context,
      callback,
    );
    await handler(
      event("POST /cpa/clients/{id}/token-rotation", {}, { id: "client-1" }),
      context,
      callback,
    );
    expect(entities.updateClient).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "request-1",
      "client-1",
      { status: "reviewed" },
    );
    expect(entities.rotateClientToken).toHaveBeenCalled();
  });

  it("authenticates before validation and never calls a service on failure", async () => {
    const { handler, entities } = setup();
    const unauthorized = await handler(
      event("POST /cpa/clients", { unexpected: true }, { authorized: false }),
      context,
      callback,
    );
    expect(unauthorized).toMatchObject({ statusCode: 401 });
    expect(body(unauthorized)).toEqual({ error: "Unauthorized" });
    expect(entities.createClient).not.toHaveBeenCalled();
  });

  it("returns safe validation errors without mutation", async () => {
    const { handler, entities } = setup();
    const response = await handler(
      event("PATCH /cpa/submissions/{id}", { alert_sent: true }, { id: "submission-1" }),
      context,
      callback,
    );
    expect(response).toMatchObject({ statusCode: 400 });
    expect(body(response)).toEqual({ error: "Invalid request" });
    expect(entities.updateSubmission).not.toHaveBeenCalled();
  });
});
