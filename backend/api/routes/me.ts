import type { APIGatewayProxyEventV2 } from "aws-lambda";

import type { CpaActor } from "../auth/cpa-context";
import { updateMeSchema } from "../contracts/entities";
import { jsonResponse, parseJsonBody } from "../core/http";
import type { ApiRouter } from "../core/router";
import type { UserService } from "../services/users";

type AuthenticatedRoute = (
  handler: (
    event: APIGatewayProxyEventV2,
    actor: CpaActor,
  ) => Promise<ReturnType<typeof jsonResponse>>,
) => (event: APIGatewayProxyEventV2) => Promise<ReturnType<typeof jsonResponse>>;

export function registerMeRoutes(
  router: ApiRouter,
  service: UserService,
  authenticated: AuthenticatedRoute,
) {
  router.register(
    "GET /cpa/me",
    authenticated(async (_event, actor) =>
      jsonResponse(200, await service.me(actor)),
    ),
  );
  router.register(
    "PATCH /cpa/me",
    authenticated(async (event, actor) =>
      jsonResponse(
        200,
        await service.updateMe(
          actor,
          event.requestContext.requestId,
          parseJsonBody(event, updateMeSchema),
        ),
      ),
    ),
  );
}
