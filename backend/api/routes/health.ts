import type { APIGatewayProxyStructuredResultV2 } from "aws-lambda";

import { jsonResponse } from "../core/http";

export { jsonResponse } from "../core/http";

export function healthResponse(
  stage: string,
): APIGatewayProxyStructuredResultV2 {
  return jsonResponse(200, {
    ok: true,
    service: "auditflow-api",
    stage,
  });
}
