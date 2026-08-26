import type { APIGatewayProxyEventV2 } from "aws-lambda";

import type { CpaActor } from "../auth/cpa-context";
import {
  cpaSubmissionFileUrlSchema,
  cpaTemplateFileMirrorSchema,
  cpaTemplateFileUrlSchema,
  cpaUploadCompleteSchema,
  cpaUploadInitiateSchema,
  publicSignedPdfUrlSchema,
  publicPdfTemplateReadSchema,
  publicTemplateFileUrlSchema,
  publicUploadSchema,
  zipDownloadRequestSchema,
  zipJobIdSchema,
} from "../contracts/files";
import { jsonResponse, parseJsonBody } from "../core/http";
import { badRequest } from "../core/errors";
import type { ApiRouter } from "../core/router";
import type { FileService } from "../services/files";

type AuthenticatedRoute = (
  handler: (
    event: APIGatewayProxyEventV2,
    actor: CpaActor,
  ) => Promise<ReturnType<typeof jsonResponse>>,
) => (event: APIGatewayProxyEventV2) => Promise<ReturnType<typeof jsonResponse>>;

export function registerFileRoutes(
  router: ApiRouter,
  service: FileService,
  authenticated: AuthenticatedRoute,
) {
  router.register("POST /apps/{appId}/functions/uploadFile", async (event) => {
    const input = parseJsonBody(event, publicUploadSchema);
    const result =
      input.operation === "initiate"
        ? await service.initiatePublicUpload(input)
        : await service.completePublicUpload(input, event.requestContext.requestId);
    return jsonResponse(200, result);
  });
  router.register("POST /apps/{appId}/functions/getSignedPdfUrl", async (event) =>
    jsonResponse(
      200,
      await service.getPublicSignedPdfUrl(parseJsonBody(event, publicSignedPdfUrlSchema)),
    ),
  );
  router.register("POST /apps/{appId}/functions/getTemplateFileUrl", async (event) =>
    jsonResponse(
      200,
      await service.getPublicTemplateFileUrl(
        parseJsonBody(event, publicTemplateFileUrlSchema),
      ),
    ),
  );
  router.register("POST /apps/{appId}/functions/getPdfTemplateById", async (event) =>
    jsonResponse(
      200,
      await service.getPublicPdfTemplate(
        parseJsonBody(event, publicPdfTemplateReadSchema),
      ),
    ),
  );
  router.register(
    "POST /cpa/files/uploads/initiate",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.initiateCpaUpload(
          parseJsonBody(event, cpaUploadInitiateSchema),
          actor,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/files/uploads/complete",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.completeCpaUpload(
          parseJsonBody(event, cpaUploadCompleteSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/files/submission-url",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.getCpaSubmissionFileUrl(
          parseJsonBody(event, cpaSubmissionFileUrlSchema),
          actor,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/files/template-url",
    authenticated(async (event, actor) => {
      const input = parseJsonBody(event, cpaTemplateFileUrlSchema);
      return jsonResponse(200, await service.getCpaTemplateFileUrl(input.template_id, actor));
    }),
  );
  router.register(
    "POST /cpa/files/template-mirror",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.mirrorCpaTemplateFile(
          parseJsonBody(event, cpaTemplateFileMirrorSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/submissions/{id}/zip-downloads",
    authenticated(async (event, actor) => {
      parseJsonBody(event, zipDownloadRequestSchema);
      const submissionId = event.pathParameters?.id;
      if (!submissionId) throw badRequest();
      return jsonResponse(202, await service.requestZipDownload(submissionId, actor));
    }),
  );
  router.register(
    "GET /cpa/submissions/{id}/zip-downloads/{jobId}",
    authenticated(async (event, actor) => {
      const submissionId = event.pathParameters?.id;
      const jobId = zipJobIdSchema.parse(event.pathParameters?.jobId);
      if (!submissionId) throw badRequest();
      return jsonResponse(
        200,
        await service.getZipDownloadStatus(submissionId, jobId, actor),
      );
    }),
  );
}
