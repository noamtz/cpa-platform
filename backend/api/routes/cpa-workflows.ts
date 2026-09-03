import type { APIGatewayProxyEventV2 } from "aws-lambda";

import type { CpaActor } from "../auth/cpa-context";
import {
  changeClientTaxYearSchema,
  cpaSaveSubmissionSchema,
  resetOrphanClientStatusSchema,
  restoreSubmissionSchema,
  transitionSubmissionStatusSchema,
  updateClientDetailsSchema,
} from "../contracts/cpa-workflows";
import { badRequest } from "../core/errors";
import { jsonResponse, parseJsonBody } from "../core/http";
import type { ApiRouter } from "../core/router";
import type { CpaWorkflowService } from "../services/cpa-workflows";

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

export function registerCpaWorkflowRoutes(
  router: ApiRouter,
  service: CpaWorkflowService,
  authenticated: AuthenticatedRoute,
) {
  router.register(
    "POST /apps/{appId}/functions/cpaSaveSubmission",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.saveSubmission(
          parseJsonBody(event, cpaSaveSubmissionSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/clients/{id}/tax-year",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.changeTaxYear(
          pathId(event),
          parseJsonBody(event, changeClientTaxYearSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/clients/{id}/orphan-status-reset",
    authenticated(async (event, actor) => {
      parseJsonBody(event, resetOrphanClientStatusSchema);
      return jsonResponse(
        200,
        await service.resetOrphanStatus(
          pathId(event),
          actor,
          event.requestContext.requestId,
        ),
      );
    }),
  );
  router.register(
    "PATCH /cpa/clients/{id}/details",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.updateClientDetails(
          pathId(event),
          parseJsonBody(event, updateClientDetailsSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/submissions/{id}/restore",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.restoreSubmission(
          pathId(event),
          parseJsonBody(event, restoreSubmissionSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/submissions/{id}/workflow-status",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.transitionStatus(
          pathId(event),
          parseJsonBody(event, transitionSubmissionStatusSchema),
          actor,
          event.requestContext.requestId,
        ),
      ),
    ),
  );
}
