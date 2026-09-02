import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { createHandler, type ApiDependencies } from "../handler";
import type { CpaWorkflowService } from "../services/cpa-workflows";

function event(routeKey: string, body: unknown, authorized = true) {
  return {
    version: "2.0",
    routeKey,
    rawPath: routeKey.split(" ")[1]?.replace("{appId}", "auditflow").replace("{id}", "submission-1"),
    rawQueryString: "",
    headers: authorized ? { authorization: "Bearer token" } : {},
    body: JSON.stringify(body),
    pathParameters: { appId: "auditflow", id: "submission-1" },
    requestContext: {
      requestId: "request-2",
      authorizer: authorized
        ? { jwt: { claims: { sub: "subject-1", token_use: "access", scope: "auditflow-api/cpa" } } }
        : undefined,
      http: { method: "POST", path: "/" },
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function setup() {
  const service = {
    saveSubmission: vi.fn().mockResolvedValue({ submission: { id: "submission-1" } }),
    changeTaxYear: vi.fn().mockResolvedValue({ id: "client-1" }),
    resetOrphanStatus: vi.fn().mockResolvedValue({ id: "client-1", status: "pending" }),
    restoreSubmission: vi.fn().mockResolvedValue({ id: "submission-1" }),
    transitionStatus: vi.fn().mockResolvedValue({ client: {}, submission: {} }),
  } as unknown as CpaWorkflowService;
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
      findByCognitoSubject: vi.fn().mockResolvedValue([{ id: "user-1", email: "admin@example.test", full_name: "Admin", role: "admin", cognito_sub: "subject-1" }]),
    },
    entities: {},
    publicQuestionnaire: {},
    files: {},
    userService: {},
    cpaWorkflows: service,
  } as unknown as ApiDependencies;
  return { service, verifier, handler: createHandler(() => "test", () => dependencies) };
}

describe("protected CPA workflow routes", () => {
  it("keeps the compatibility save path protected and forwards the request ID", async () => {
    const { handler, service } = setup();
    const body = {
      client_id: "client-1",
      submission_id: "submission-1",
      revision: 2,
      step_id: "step-1",
      data: { responses: "{}" },
      completed: false,
    };
    const response = await handler(
      event("POST /apps/{appId}/functions/cpaSaveSubmission", body),
      {} as Context,
      vi.fn(),
    );
    expect(response).toMatchObject({ statusCode: 200 });
    expect(service.saveSubmission).toHaveBeenCalledWith(
      body,
      expect.objectContaining({ fullName: "Admin" }),
      "request-2",
    );
  });

  it("dispatches tax-year, orphan-reset, restore, and paired-status operations", async () => {
    const { handler, service } = setup();
    await handler(event("POST /cpa/clients/{id}/tax-year", { tax_year: 2025 }), {} as Context, vi.fn());
    await handler(event("POST /cpa/clients/{id}/orphan-status-reset", {}), {} as Context, vi.fn());
    await handler(event("POST /cpa/submissions/{id}/restore", {}), {} as Context, vi.fn());
    await handler(
      event("POST /cpa/submissions/{id}/workflow-status", { client_id: "client-1", status: "reviewed" }),
      {} as Context,
      vi.fn(),
    );
    expect(service.changeTaxYear).toHaveBeenCalledWith("submission-1", { tax_year: 2025 }, expect.any(Object), "request-2");
    expect(service.resetOrphanStatus).toHaveBeenCalledWith("submission-1", expect.any(Object), "request-2");
    expect(service.restoreSubmission).toHaveBeenCalledOnce();
    expect(service.transitionStatus).toHaveBeenCalledOnce();
  });

  it("authenticates before rejecting malformed CPA save input", async () => {
    const { handler, service, verifier } = setup();
    const response = await handler(
      event("POST /apps/{appId}/functions/cpaSaveSubmission", { client_id: "client-1", data: {} }),
      {} as Context,
      vi.fn(),
    );
    expect(response).toMatchObject({ statusCode: 400 });
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(service.saveSubmission).not.toHaveBeenCalled();
  });
});
