import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";

import { healthResponse, jsonResponse } from "./routes/health";

type StageProvider = () => string;

function resolveRouteKey(event: APIGatewayProxyEventV2): string | undefined {
  if (event.routeKey) {
    return event.routeKey;
  }

  const method = event.requestContext?.http?.method;
  const path = event.rawPath || event.requestContext?.http?.path;
  return method && path ? `${method.toUpperCase()} ${path}` : undefined;
}

export function createHandler(
  getStage: StageProvider = () => process.env.AUDITFLOW_STAGE ?? "unknown",
): APIGatewayProxyHandlerV2<APIGatewayProxyStructuredResultV2> {
  return async (event) => {
    try {
      const stage = getStage();
      const routeKey = resolveRouteKey(event);

      if (!routeKey) {
        return jsonResponse(400, { error: "Invalid request" });
      }

      if (routeKey === "GET /health" || routeKey === "GET /auth/health") {
        return healthResponse(stage);
      }

      return jsonResponse(404, { error: "Not found" });
    } catch (error) {
      const requestId = event.requestContext?.requestId ?? "unavailable";
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error("AuditFlow API request failed", {
        requestId,
        errorName,
        message: "Unhandled API error",
      });
      return jsonResponse(500, { error: "Internal server error" });
    }
  };
}

export const handler = createHandler();
