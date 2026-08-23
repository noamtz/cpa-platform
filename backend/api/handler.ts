import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { resolveCpaActor } from "./auth/cpa-context";
import {
  getRuntimeAccessTokenVerifier,
  type AccessTokenVerifier,
} from "./auth/jwt";
import { ApiError, normalizeApiError } from "./core/errors";
import { errorResponse } from "./core/http";
import { getRequestId } from "./core/request-context";
import { ApiRouter } from "./core/router";
import { ClientRepository } from "./repositories/client";
import type { DynamoDocumentClient } from "./repositories/dynamo";
import { SubmissionRepository } from "./repositories/submission";
import { UserRepository } from "./repositories/user";
import { registerDeferredIntegrationRoutes } from "./routes/deferred-integrations";
import { registerEntityRoutes } from "./routes/entities";
import { healthResponse } from "./routes/health";
import { registerMeRoutes } from "./routes/me";
import { registerUserRoutes } from "./routes/users";
import { ChangeJournalService } from "./services/change-journal";
import { EntityService } from "./services/entities";
import { UserService, type CognitoAdminClient } from "./services/users";

type StageProvider = () => string;

export interface ApiDependencies {
  readonly verifier: AccessTokenVerifier;
  readonly users: UserRepository;
  readonly entities: EntityService;
  readonly userService: UserService;
}

type DependencyProvider = () => ApiDependencies;

const CPA_ROUTE_KEYS = new Set([
  "POST /cpa/clients/query",
  "POST /cpa/clients",
  "PATCH /cpa/clients/{id}",
  "POST /cpa/clients/{id}/token-rotation",
  "POST /cpa/submissions/query",
  "PATCH /cpa/submissions/{id}",
  "POST /cpa/users/query",
  "GET /cpa/me",
  "PATCH /cpa/me",
  "POST /cpa/users/invitations",
  "POST /cpa/integrations/google-drive/sync",
  "POST /cpa/integrations/google-drive/connect",
  "POST /cpa/integrations/google-drive/disconnect",
  "POST /cpa/integrations/telegram/notify",
]);

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing runtime configuration: ${name}`);
  return value;
}

let runtimeDependencies: ApiDependencies | undefined;

export function createRuntimeDependencies(): ApiDependencies {
  if (runtimeDependencies) return runtimeDependencies;
  const sdkDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const documentClient: DynamoDocumentClient = {
    send(command) {
      return sdkDocumentClient.send(command as never);
    },
  };
  const sdkCognitoClient = new CognitoIdentityProviderClient({});
  const cognitoClient: CognitoAdminClient = {
    send(command) {
      return sdkCognitoClient.send(command as never);
    },
  };
  const clients = new ClientRepository(
    documentClient,
    requiredEnvironment("CLIENT_TABLE_NAME"),
  );
  const submissions = new SubmissionRepository(
    documentClient,
    requiredEnvironment("SUBMISSION_TABLE_NAME"),
  );
  const users = new UserRepository(
    documentClient,
    requiredEnvironment("USER_TABLE_NAME"),
  );
  const journal = new ChangeJournalService({
    client: documentClient,
    tableName: requiredEnvironment("CHANGE_JOURNAL_TABLE_NAME"),
  });
  runtimeDependencies = {
    verifier: getRuntimeAccessTokenVerifier(),
    users,
    entities: new EntityService({ clients, submissions, journal }),
    userService: new UserService({
      users,
      journal,
      cognito: cognitoClient,
      userPoolId: requiredEnvironment("USER_POOL_ID"),
    }),
  };
  return runtimeDependencies;
}

function resolveRouteKey(event: APIGatewayProxyEventV2): string | undefined {
  if (event.routeKey) return event.routeKey;
  const method = event.requestContext?.http?.method;
  const path = event.rawPath || event.requestContext?.http?.path;
  return method && path ? `${method.toUpperCase()} ${path}` : undefined;
}

function createApiRouter(dependencies: ApiDependencies) {
  const router = new ApiRouter();
  const authenticated = (
    route: (
      event: APIGatewayProxyEventV2,
      actor: Awaited<ReturnType<typeof resolveCpaActor>>,
    ) => Promise<APIGatewayProxyStructuredResultV2>,
  ) =>
    async (event: APIGatewayProxyEventV2) => {
      const actor = await resolveCpaActor(
        event,
        dependencies.verifier,
        dependencies.users,
      );
      return route(event, actor);
    };

  registerEntityRoutes(router, dependencies.entities, authenticated);
  registerMeRoutes(router, dependencies.userService, authenticated);
  registerUserRoutes(router, dependencies.userService, authenticated);
  registerDeferredIntegrationRoutes(router, authenticated);
  return router;
}

export function createHandler(
  getStage: StageProvider = () => process.env.AUDITFLOW_STAGE ?? "unknown",
  getDependencies: DependencyProvider = createRuntimeDependencies,
): APIGatewayProxyHandlerV2<APIGatewayProxyStructuredResultV2> {
  let router: ApiRouter | undefined;
  return async (event) => {
    try {
      const routeKey = resolveRouteKey(event);
      if (!routeKey) return errorResponse(400, "Invalid request");
      if (routeKey === "GET /health" || routeKey === "GET /auth/health") {
        return healthResponse(getStage());
      }
      if (!CPA_ROUTE_KEYS.has(routeKey)) return errorResponse(404, "Not found");
      if (!router) router = createApiRouter(getDependencies());
      if (!router.has(routeKey)) return errorResponse(404, "Not found");
      return await router.dispatch(routeKey, event);
    } catch (error) {
      const normalized = normalizeApiError(error);
      if (normalized.statusCode === 500) {
        console.error("AuditFlow API request failed", {
          requestId: getRequestId(event),
          errorName: error instanceof Error ? error.name : "UnknownError",
          message: "Unhandled API error",
        });
      }
      return errorResponse(
        normalized.statusCode,
        normalized.publicMessage,
        normalized.code,
      );
    }
  };
}

export const handler = createHandler();

export { ApiError };
