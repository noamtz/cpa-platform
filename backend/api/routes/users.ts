import type { APIGatewayProxyEventV2 } from "aws-lambda";

import type { CpaActor } from "../auth/cpa-context";
import { inviteUserSchema, userQuerySchema } from "../contracts/entities";
import { jsonResponse, parseJsonBody } from "../core/http";
import type { ApiRouter } from "../core/router";
import type { UserService } from "../services/users";

type AuthenticatedRoute = (
  handler: (
    event: APIGatewayProxyEventV2,
    actor: CpaActor,
  ) => Promise<ReturnType<typeof jsonResponse>>,
) => (event: APIGatewayProxyEventV2) => Promise<ReturnType<typeof jsonResponse>>;

export function registerUserRoutes(
  router: ApiRouter,
  service: UserService,
  authenticated: AuthenticatedRoute,
) {
  router.register(
    "POST /cpa/users/query",
    authenticated(async (event) => {
      const input = parseJsonBody(event, userQuerySchema);
      return jsonResponse(200, await service.list(input.sort, input.limit));
    }),
  );
  router.register(
    "POST /cpa/users/invitations",
    authenticated(async (event, actor) =>
      jsonResponse(
        201,
        await service.invite(
          actor,
          event.requestContext.requestId,
          parseJsonBody(event, inviteUserSchema),
        ),
      ),
    ),
  );
}
