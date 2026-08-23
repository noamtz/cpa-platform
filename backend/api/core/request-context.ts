import type { APIGatewayProxyEventV2 } from "aws-lambda";

import { unauthorized } from "./errors";

export function getRequestId(event: APIGatewayProxyEventV2) {
  return event.requestContext?.requestId || "unavailable";
}

export function getBearerToken(event: APIGatewayProxyEventV2) {
  const authorization = event.headers.authorization ?? event.headers.Authorization;
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization ?? "");
  if (!match) throw unauthorized();
  return match[1];
}

export function getGatewayClaims(event: APIGatewayProxyEventV2) {
  const requestContext = event.requestContext as typeof event.requestContext & {
    authorizer?: { jwt?: { claims?: Record<string, unknown> } };
  };
  const claims = requestContext.authorizer?.jwt?.claims;
  if (!claims || typeof claims.sub !== "string") throw unauthorized();
  return claims;
}

export function hasScope(value: unknown, requiredScope: string) {
  const scopes = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/)
      : [];
  return scopes.includes(requiredScope);
}
