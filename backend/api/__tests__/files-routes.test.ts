import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import { createHandler, type ApiDependencies } from "../handler";
import type { UserRepository } from "../repositories/user";
import type { EntityService } from "../services/entities";
import type { FileService } from "../services/files";
import type { PublicQuestionnaireService } from "../services/public-questionnaire";
import type { UserService } from "../services/users";

const context = {} as Context;
const callback = vi.fn();

function event(routeKey: string, payload: unknown = {}, authorized = true) {
  const pathParameters: Record<string, string> = { appId: "auditflow" };
  let rawPath = routeKey.split(" ")[1] ?? "/";
  for (const [name, value] of Object.entries({
    appId: "auditflow",
    id: "submission-test",
    jobId: "123e4567-e89b-12d3-a456-426614174000",
  })) {
    rawPath = rawPath.replace(`{${name}}`, value);
    pathParameters[name] = value;
  }
  return {
    version: "2.0",
    routeKey,
    rawPath,
    rawQueryString: "",
    headers: authorized ? { authorization: "Bearer opaque-test-token" } : {},
    body: JSON.stringify(payload),
    pathParameters,
    requestContext: {
      authorizer: authorized
        ? {
            jwt: {
              claims: {
                sub: "subject-test",
                token_use: "access",
                scope: "auditflow-api/cpa",
              },
              scopes: ["auditflow-api/cpa"],
            },
          }
        : undefined,
      http: { method: routeKey.split(" ")[0], path: rawPath },
      requestId: "request-test",
      routeKey,
      stage: "$default",
    },
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

function setup() {
  const verifier = {
    verify: vi.fn().mockResolvedValue({
      sub: "subject-test",
      tokenUse: "access",
      scope: "auditflow-api/cpa",
    }),
  };
  const files = {
    initiatePublicUpload: vi.fn().mockResolvedValue({ upload_id: "private://files/test" }),
    completePublicUpload: vi.fn().mockResolvedValue({ file_uri: "private://files/test" }),
    getPublicSignedPdfUrl: vi.fn().mockResolvedValue({ signed_url: "https://signed.test/read" }),
    getPublicTemplateFileUrl: vi.fn().mockResolvedValue({ signed_url: "https://signed.test/template" }),
    initiateCpaUpload: vi.fn().mockResolvedValue({ upload_id: "private://files/test" }),
    completeCpaUpload: vi.fn().mockResolvedValue({ file_uri: "private://files/test" }),
    getCpaSubmissionFileUrl: vi.fn().mockResolvedValue({ signed_url: "https://signed.test/read" }),
    getCpaTemplateFileUrl: vi.fn().mockResolvedValue({ signed_url: "https://signed.test/template" }),
    requestZipDownload: vi.fn().mockResolvedValue({ job_id: "job-test", status: "pending" }),
    getZipDownloadStatus: vi.fn().mockResolvedValue({ job_id: "job-test", status: "pending" }),
  } as unknown as FileService;
  const dependencies: ApiDependencies = {
    verifier,
    users: {
      findByCognitoSubject: vi.fn().mockResolvedValue([
        { id: "user-test", role: "admin", cognito_sub: "subject-test" },
      ]),
    } as unknown as UserRepository,
    entities: {} as EntityService,
    publicQuestionnaire: {} as PublicQuestionnaireService,
    files,
    userService: {} as UserService,
  };
  return {
    files,
    verifier,
    handler: createHandler(() => "test", () => dependencies),
  };
}

describe("assembled file routes", () => {
  it("keeps the exact public locator and upload routes outside Cognito", async () => {
    const { handler, verifier } = setup();
    const credentials = { client_id: "client-test", token: "opaque-token" };
    const cases = [
      [
        "POST /apps/{appId}/functions/uploadFile",
        {
          operation: "initiate",
          ...credentials,
          submission_id: "submission-test",
          purpose: "questionnaire_document",
          step_id: "step-test",
          size: 3,
          content_type: "application/pdf",
        },
      ],
      [
        "POST /apps/{appId}/functions/getSignedPdfUrl",
        { ...credentials, step_id: "step-test" },
      ],
      [
        "POST /apps/{appId}/functions/getTemplateFileUrl",
        { ...credentials, template_id: "template-test" },
      ],
    ] as const;
    for (const [routeKey, payload] of cases) {
      const response = await handler(event(routeKey, payload, false), context, callback);
      expect(response).toMatchObject({ statusCode: 200 });
    }
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("requires the CPA scope for every CPA file and ZIP route", async () => {
    const { handler, files } = setup();
    const cases = [
      [
        "POST /cpa/files/uploads/initiate",
        {
          owner_type: "submission",
          owner_id: "submission-test",
          purpose: "questionnaire_document",
          step_id: "step-test",
          size: 3,
          content_type: "application/pdf",
        },
      ],
      [
        "POST /cpa/files/uploads/complete",
        { owner_type: "submission", owner_id: "submission-test", upload_id: "private://files/test" },
      ],
      [
        "POST /cpa/files/submission-url",
        { submission_id: "submission-test", source: "response", step_id: "step-test", file_index: 0 },
      ],
      ["POST /cpa/files/template-url", { template_id: "template-test" }],
      ["POST /cpa/submissions/{id}/zip-downloads", {}],
      ["GET /cpa/submissions/{id}/zip-downloads/{jobId}", {}],
    ] as const;
    for (const [routeKey, payload] of cases) {
      const rejected = await handler(event(routeKey, payload, false), context, callback);
      expect(rejected).toMatchObject({ statusCode: 401 });
      const accepted = await handler(event(routeKey, payload), context, callback);
      expect(accepted).toMatchObject({
        statusCode:
          routeKey === "POST /cpa/submissions/{id}/zip-downloads" ? 202 : 200,
      });
    }
    expect(files.requestZipDownload).toHaveBeenCalledWith(
      "submission-test",
      expect.objectContaining({ userId: "user-test" }),
    );
  });

  it("rejects unknown fields before reaching storage", async () => {
    const { handler, files } = setup();
    const response = await handler(
      event("POST /cpa/files/template-url", {
        template_id: "template-test",
        file_uri: "private://untrusted",
      }),
      context,
      callback,
    );
    expect(response).toMatchObject({ statusCode: 400 });
    expect(files.getCpaTemplateFileUrl).not.toHaveBeenCalled();
  });
});
