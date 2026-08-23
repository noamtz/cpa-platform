import type { APIGatewayProxyEventV2 } from "aws-lambda";

import type { CpaActor } from "../auth/cpa-context";
import {
  clientCreateSchema,
  clientQuerySchema,
  clientUpdateSchema,
  submissionQuerySchema,
  submissionUpdateSchema,
  tokenRotationSchema,
} from "../contracts/entities";
import { badRequest } from "../core/errors";
import { jsonResponse, parseJsonBody } from "../core/http";
import type { ApiRouter } from "../core/router";
import type { EntityService } from "../services/entities";

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

export function registerEntityRoutes(
  router: ApiRouter,
  service: EntityService,
  authenticated: AuthenticatedRoute,
) {
  router.register(
    "POST /cpa/clients/query",
    authenticated(async (event) => {
      const input = parseJsonBody(event, clientQuerySchema);
      return jsonResponse(
        200,
        await service.listClients(input.filter, input.sort, input.limit),
      );
    }),
  );
  router.register(
    "POST /cpa/clients",
    authenticated(async (event, actor) =>
      jsonResponse(
        201,
        await service.createClient(
          actor,
          event.requestContext.requestId,
          parseJsonBody(event, clientCreateSchema),
        ),
      ),
    ),
  );
  router.register(
    "PATCH /cpa/clients/{id}",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.updateClient(
          actor,
          event.requestContext.requestId,
          pathId(event),
          parseJsonBody(event, clientUpdateSchema),
        ),
      ),
    ),
  );
  router.register(
    "POST /cpa/clients/{id}/token-rotation",
    authenticated(async (event, actor) => {
      parseJsonBody(event, tokenRotationSchema);
      return jsonResponse(
        200,
        await service.rotateClientToken(
          actor,
          event.requestContext.requestId,
          pathId(event),
        ),
      );
    }),
  );
  router.register(
    "POST /cpa/submissions/query",
    authenticated(async (event) => {
      const input = parseJsonBody(event, submissionQuerySchema);
      return jsonResponse(
        200,
        await service.listSubmissions(input.filter, input.sort, input.limit),
      );
    }),
  );
  router.register(
    "PATCH /cpa/submissions/{id}",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.updateSubmission(
          actor,
          event.requestContext.requestId,
          pathId(event),
          parseJsonBody(event, submissionUpdateSchema),
        ),
      ),
    ),
  );
}
