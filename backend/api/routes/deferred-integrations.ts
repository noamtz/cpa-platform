import type { APIGatewayProxyEventV2 } from "aws-lambda";
import type { z } from "zod";

import type { CpaActor } from "../auth/cpa-context";
import {
  connectorSchema,
  googleDriveSyncSchema,
  telegramSchema,
} from "../contracts/entities";
import { jsonResponse, parseJsonBody } from "../core/http";
import type { ApiRouter } from "../core/router";

type AuthenticatedRoute = (
  handler: (
    event: APIGatewayProxyEventV2,
    actor: CpaActor,
  ) => Promise<ReturnType<typeof jsonResponse>>,
) => (event: APIGatewayProxyEventV2) => Promise<ReturnType<typeof jsonResponse>>;

function deferred(
  feature: "google-drive" | "telegram",
  schema: z.ZodTypeAny,
) {
  return async (event: APIGatewayProxyEventV2) => {
    parseJsonBody(event, schema);
    return jsonResponse(501, {
      error: "Not implemented",
      code: "FEATURE_NOT_IMPLEMENTED",
      feature,
    });
  };
}

export function registerDeferredIntegrationRoutes(
  router: ApiRouter,
  authenticated: AuthenticatedRoute,
) {
  router.register(
    "POST /cpa/integrations/google-drive/sync",
    authenticated(deferred("google-drive", googleDriveSyncSchema)),
  );
  router.register(
    "POST /cpa/integrations/google-drive/connect",
    authenticated(deferred("google-drive", connectorSchema)),
  );
  router.register(
    "POST /cpa/integrations/google-drive/disconnect",
    authenticated(deferred("google-drive", connectorSchema)),
  );
  router.register(
    "POST /cpa/integrations/telegram/notify",
    authenticated(deferred("telegram", telegramSchema)),
  );
}
