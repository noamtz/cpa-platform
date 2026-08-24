import type { APIGatewayProxyEventV2 } from "aws-lambda";

import {
  getActiveTemplateSchema,
  getClientByTokenSchema,
  getTemplateByIdSchema,
  updateClientSubmissionSchema,
} from "../contracts/public-questionnaire";
import { jsonResponse, parseJsonBody } from "../core/http";
import type { ApiRouter } from "../core/router";
import type { PublicQuestionnaireService } from "../services/public-questionnaire";

const requestId = (event: APIGatewayProxyEventV2) =>
  event.requestContext.requestId;

export function registerPublicQuestionnaireRoutes(
  router: ApiRouter,
  service: PublicQuestionnaireService,
) {
  router.register(
    "POST /apps/{appId}/functions/getClientByToken",
    async (event) =>
      jsonResponse(
        200,
        await service.getClientByToken(
          parseJsonBody(event, getClientByTokenSchema),
        ),
      ),
  );
  router.register(
    "POST /apps/{appId}/functions/getActiveTemplate",
    async (event) =>
      jsonResponse(
        200,
        await service.getActiveTemplate(
          parseJsonBody(event, getActiveTemplateSchema),
          requestId(event),
        ),
      ),
  );
  router.register(
    "POST /apps/{appId}/functions/getTemplateById",
    async (event) =>
      jsonResponse(
        200,
        await service.getTemplateById(
          parseJsonBody(event, getTemplateByIdSchema),
        ),
      ),
  );
  router.register(
    "POST /apps/{appId}/functions/updateClientSubmission",
    async (event) =>
      jsonResponse(
        200,
        await service.updateClientSubmission(
          parseJsonBody(event, updateClientSubmissionSchema),
          requestId(event),
        ),
      ),
  );
}
