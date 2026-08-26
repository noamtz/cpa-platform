import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { ApiError, createHandler, type ApiDependencies } from "../handler";
import type { UserRepository } from "../repositories/user";
import type { EntityService } from "../services/entities";
import type { FileService } from "../services/files";
import type { PublicQuestionnaireService } from "../services/public-questionnaire";
import type { UserService } from "../services/users";

const context = {} as Context;
const callback = vi.fn();

function event(routeKey: string, payload: unknown) {
  const path = routeKey.split(" ")[1]?.replace("{appId}", "opaque-app") ?? "/";
  return {
    version: "2.0",
    routeKey,
    rawPath: path,
    rawQueryString: "",
    headers: {},
    body: JSON.stringify(payload),
    pathParameters: { appId: "opaque-app" },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "example.test",
      domainPrefix: "test",
      http: {
        method: "POST",
        path,
        protocol: "HTTP/1.1",
        sourceIp: "127.0.0.1",
        userAgent: "vitest",
      },
      requestId: "request-public-1",
      routeKey,
      stage: "$default",
      time: "01/Jan/2026:00:00:00 +0000",
      timeEpoch: 0,
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function body(response: unknown) {
  return JSON.parse(String((response as { body: string }).body));
}

function setup() {
  const verifier = { verify: vi.fn() };
  const publicQuestionnaire = {
    getClientByToken: vi.fn().mockResolvedValue({ client: { id: "client-1" }, submission: null }),
    getActiveTemplate: vi.fn().mockResolvedValue({ template: { id: "template-1" } }),
    getTemplateById: vi.fn().mockResolvedValue({ template: { id: "template-1" } }),
    updateClientSubmission: vi.fn().mockResolvedValue({
      submission: { id: "submission-1", _version: 2 },
    }),
  } as unknown as PublicQuestionnaireService;
  const dependencies: ApiDependencies = {
    verifier,
    users: {} as UserRepository,
    entities: {} as EntityService,
    publicQuestionnaire,
    files: {} as FileService,
    userService: {} as UserService,
  };
  return {
    verifier,
    publicQuestionnaire,
    handler: createHandler(() => "test", () => dependencies),
  };
}

describe("assembled public questionnaire routes", () => {
  it("registers only the four exact compatibility function keys without Cognito", async () => {
    const { handler, publicQuestionnaire, verifier } = setup();
    const credentials = { client_id: "client-1", token: "public-link-value" };
    const cases = [
      [
        "POST /apps/{appId}/functions/getClientByToken",
        credentials,
        "getClientByToken",
      ],
      [
        "POST /apps/{appId}/functions/getActiveTemplate",
        credentials,
        "getActiveTemplate",
      ],
      [
        "POST /apps/{appId}/functions/getTemplateById",
        { ...credentials, template_id: "template-1" },
        "getTemplateById",
      ],
      [
        "POST /apps/{appId}/functions/updateClientSubmission",
        { ...credentials, data: { responses: "{}" } },
        "updateClientSubmission",
      ],
    ] as const;

    for (const [routeKey, payload, method] of cases) {
      const response = await handler(event(routeKey, payload), context, callback);
      expect(response).toMatchObject({ statusCode: 200 });
      expect(publicQuestionnaire[method]).toHaveBeenCalled();
    }
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("passes request identity only to mutating/default-seed capable methods", async () => {
    const { handler, publicQuestionnaire } = setup();
    const credentials = { client_id: "client-1", token: "public-link-value" };
    await handler(
      event("POST /apps/{appId}/functions/getActiveTemplate", credentials),
      context,
      callback,
    );
    await handler(
      event("POST /apps/{appId}/functions/updateClientSubmission", {
        ...credentials,
        data: { responses: "{}" },
      }),
      context,
      callback,
    );
    expect(publicQuestionnaire.getActiveTemplate).toHaveBeenCalledWith(
      credentials,
      "request-public-1",
    );
    expect(publicQuestionnaire.updateClientSubmission).toHaveBeenCalledWith(
      expect.objectContaining(credentials),
      "request-public-1",
    );
  });

  it("preserves the safe reload body for stale conflicts", async () => {
    const { handler, publicQuestionnaire } = setup();
    vi.mocked(publicQuestionnaire.updateClientSubmission).mockRejectedValue(
      new ApiError(
        409,
        "submission_conflict",
        "submission_conflict",
        { reload: true, unsafe: "not-returned" },
      ),
    );
    const response = await handler(
      event("POST /apps/{appId}/functions/updateClientSubmission", {
        client_id: "client-1",
        token: "public-link-value",
        submission_id: "submission-1",
        _version: 2,
        data: { responses: "{}" },
      }),
      context,
      callback,
    );
    expect(response).toMatchObject({ statusCode: 409 });
    expect(body(response)).toEqual({
      error: "submission_conflict",
      code: "submission_conflict",
      reload: true,
    });
  });

  it("rejects strict-body violations before service access", async () => {
    const { handler, publicQuestionnaire } = setup();
    const response = await handler(
      event("POST /apps/{appId}/functions/updateClientSubmission", {
        client_id: "client-1",
        token: "public-link-value",
        data: { responses: "{}", is_archived: true },
      }),
      context,
      callback,
    );
    expect(response).toMatchObject({ statusCode: 400 });
    expect(publicQuestionnaire.updateClientSubmission).not.toHaveBeenCalled();
  });

  it("fails closed for unknown function names without composing dependencies", async () => {
    const dependencies = vi.fn();
    const handler = createHandler(() => "test", dependencies);
    const response = await handler(
      event("POST /apps/{appId}/functions/unknownFunction", {}),
      context,
      callback,
    );
    expect(response).toMatchObject({ statusCode: 404 });
    expect(dependencies).not.toHaveBeenCalled();
  });
});
