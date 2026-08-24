import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import type { z } from "zod";

import { badRequest } from "./errors";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
} as const;

export function jsonResponse(
  statusCode: number,
  body: unknown,
): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

export function parseJsonBody<T extends z.ZodTypeAny>(
  event: APIGatewayProxyEventV2,
  schema: T,
): z.infer<T> {
  let value: unknown = {};
  if (event.body) {
    const text = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    try {
      value = JSON.parse(text);
    } catch {
      throw badRequest();
    }
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw badRequest();
  return parsed.data;
}

export function errorResponse(
  statusCode: number,
  error: string,
  code?: string,
  reload?: true,
) {
  return jsonResponse(statusCode, {
    error,
    ...(code ? { code } : {}),
    ...(reload ? { reload: true } : {}),
  });
}
