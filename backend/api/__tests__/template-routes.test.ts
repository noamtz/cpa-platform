import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { createHandler, type ApiDependencies } from "../handler";
import type { TemplateService } from "../services/templates";

function event(routeKey: string, body: unknown = {}, authorized = true) {
  return {
    version: "2.0",
    routeKey,
    rawPath: routeKey.split(" ")[1]?.replace("{id}", "template-1"),
    rawQueryString: "",
    headers: authorized ? { authorization: "Bearer token" } : {},
    body: JSON.stringify(body),
    pathParameters: { id: "template-1" },
    requestContext: {
      requestId: "request-1",
      authorizer: authorized
        ? { jwt: { claims: { sub: "subject-1", token_use: "access", scope: "auditflow-api/cpa" } } }
        : undefined,
      http: { method: routeKey.split(" ")[0], path: "/" },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function setup() {
  const service = {
    getActiveQuestionnaire: vi.fn().mockResolvedValue({ template: { id: "active" } }),
    listQuestionnaireHistory: vi.fn().mockResolvedValue({ versions: [] }),
    getQuestionnaire: vi.fn().mockResolvedValue({ template: { id: "template-1" } }),
    saveQuestionnaire: vi.fn().mockResolvedValue({ template: { id: "created" } }),
    listPdfTemplates: vi.fn().mockResolvedValue([]),
    getPdfTemplate: vi.fn().mockResolvedValue({ id: "template-1" }),
    createPdfTemplate: vi.fn().mockResolvedValue({ id: "pdf-created" }),
    updatePdfTemplate: vi.fn().mockResolvedValue({ id: "template-1" }),
    archivePdfTemplate: vi.fn().mockResolvedValue({ id: "template-1", deleted: true }),
  } as unknown as TemplateService;
  const verifier = {
    verify: vi.fn().mockResolvedValue({
      sub: "subject-1",
      tokenUse: "access",
      scope: "auditflow-api/cpa",
    }),
  };
  const dependencies = {
    verifier,
    users: {
      findByCognitoSubject: vi.fn().mockResolvedValue([{ id: "user-1", email: "admin@example.test", role: "admin", cognito_sub: "subject-1" }]),
    },
    entities: {},
    publicQuestionnaire: {},
    files: {},
    userService: {},
    templates: service,
  } as unknown as ApiDependencies;
  return { service, verifier, handler: createHandler(() => "test", () => dependencies) };
}

describe("protected template routes", () => {
  it("dispatches questionnaire save after CPA authentication and strict parsing", async () => {
    const { handler, service } = setup();
    const response = await handler(
      event("POST /cpa/questionnaire-templates", {
        steps: [{ id: "step", title: "Title", question: "Question?" }],
      }),
      {} as Context,
      vi.fn(),
    );
    expect(response).toMatchObject({ statusCode: 201 });
    expect(service.saveQuestionnaire).toHaveBeenCalledWith(
      { steps: [{ id: "step", title: "Title", question: "Question?" }] },
      expect.objectContaining({ email: "admin@example.test" }),
      "request-1",
    );
  });

  it("dispatches exact PDF archive and questionnaire history routes", async () => {
    const { handler, service } = setup();
    await handler(event("GET /cpa/questionnaire-templates"), {} as Context, vi.fn());
    const archived = await handler(
      event("POST /cpa/pdf-templates/{id}/archive", { revision: 3 }),
      {} as Context,
      vi.fn(),
    );
    expect(service.listQuestionnaireHistory).toHaveBeenCalledOnce();
    expect(service.archivePdfTemplate).toHaveBeenCalledWith(
      "template-1",
      { revision: 3 },
      expect.any(Object),
      "request-1",
    );
    expect(archived).toMatchObject({ statusCode: 200 });
  });

  it("rejects anonymous and malformed writes before service dispatch", async () => {
    const { handler, service, verifier } = setup();
    const anonymous = await handler(
      event("POST /cpa/questionnaire-templates", {}, false),
      {} as Context,
      vi.fn(),
    );
    expect(anonymous).toMatchObject({ statusCode: 401 });
    expect(verifier.verify).not.toHaveBeenCalled();
    const malformed = await handler(
      event("POST /cpa/questionnaire-templates", { steps: [] }),
      {} as Context,
      vi.fn(),
    );
    expect(malformed).toMatchObject({ statusCode: 400 });
    expect(service.saveQuestionnaire).not.toHaveBeenCalled();
  });

  it("rejects malformed PDF file references before create or update dispatch", async () => {
    const { handler, service } = setup();
    const template_json = JSON.stringify({
      basePdf: { __type: "file_uri", value: "https://example.test/file.pdf" },
      schemas: [],
    });
    const created = await handler(
      event("POST /cpa/pdf-templates", {
        name: "Invalid template",
        template_json,
        is_active: true,
      }),
      {} as Context,
      vi.fn(),
    );
    const updated = await handler(
      event("PATCH /cpa/pdf-templates/{id}", {
        template_json,
        revision: 1,
      }),
      {} as Context,
      vi.fn(),
    );
    expect(created).toMatchObject({ statusCode: 400 });
    expect(updated).toMatchObject({ statusCode: 400 });
    expect(service.createPdfTemplate).not.toHaveBeenCalled();
    expect(service.updatePdfTemplate).not.toHaveBeenCalled();
  });
});
