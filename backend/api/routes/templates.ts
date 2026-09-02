import type { APIGatewayProxyEventV2 } from "aws-lambda";

import type { CpaActor } from "../auth/cpa-context";
import {
  archivePdfTemplateSchema,
  createPdfTemplateSchema,
  saveQuestionnaireTemplateSchema,
  updatePdfTemplateSchema,
} from "../contracts/templates";
import { badRequest } from "../core/errors";
import { jsonResponse, parseJsonBody } from "../core/http";
import type { ApiRouter } from "../core/router";
import type { TemplateService } from "../services/templates";

type AuthenticatedRoute = (
  handler: (
    event: APIGatewayProxyEventV2,
    actor: CpaActor,
  ) => Promise<ReturnType<typeof jsonResponse>>,
) => (event: APIGatewayProxyEventV2) => Promise<ReturnType<typeof jsonResponse>>;

function pathId(event: APIGatewayProxyEventV2) {
  const id = event.pathParameters?.id;
  if (!id) throw badRequest();
  return id;
}

export function registerTemplateRoutes(
  router: ApiRouter,
  service: TemplateService,
  authenticated: AuthenticatedRoute,
) {
  router.register(
    "GET /cpa/questionnaire-templates/active",
    authenticated(async () =>
      jsonResponse(200, await service.getActiveQuestionnaire()),
    ),
  );
  router.register(
    "GET /cpa/questionnaire-templates",
    authenticated(async () =>
      jsonResponse(200, await service.listQuestionnaireHistory()),
    ),
  );
  router.register(
    "GET /cpa/questionnaire-templates/{id}",
    authenticated(async (event) =>
      jsonResponse(200, await service.getQuestionnaire(pathId(event))),
    ),
  );
  router.register(
    "POST /cpa/questionnaire-templates",
    authenticated(async (event, actor) =>
      jsonResponse(
        201,
        await service.saveQuestionnaire(
          parseJsonBody(event, saveQuestionnaireTemplateSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "GET /cpa/pdf-templates",
    authenticated(async () => jsonResponse(200, await service.listPdfTemplates())),
  );
  router.register(
    "GET /cpa/pdf-templates/{id}",
    authenticated(async (event) =>
      jsonResponse(200, await service.getPdfTemplate(pathId(event))),
    ),
  );
  router.register(
    "POST /cpa/pdf-templates",
    authenticated(async (event, actor) =>
      jsonResponse(
        201,
        await service.createPdfTemplate(
          parseJsonBody(event, createPdfTemplateSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "PATCH /cpa/pdf-templates/{id}",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.updatePdfTemplate(
          pathId(event),
          parseJsonBody(event, updatePdfTemplateSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/pdf-templates/{id}/archive",
    authenticated(async (event, actor) => {
      return jsonResponse(
        200,
        await service.archivePdfTemplate(
          pathId(event),
          parseJsonBody(event, archivePdfTemplateSchema),
          actor,
          event.requestContext.requestId,
        ),
      );
    }),
  );
}
