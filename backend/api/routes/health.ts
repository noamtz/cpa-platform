import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

export function jsonResponse(
  statusCode: number,
  body: Readonly<Record<string, unknown>>,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

export function healthResponse(
  stage: string,
): APIGatewayProxyStructuredResultV2 {
  return jsonResponse(200, {
    ok: true,
    service: "auditflow-api",
    stage,
  });
}
