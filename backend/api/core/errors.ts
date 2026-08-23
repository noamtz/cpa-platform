import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    readonly statusCode: 400 | 401 | 403 | 404 | 409 | 500 | 501,
    readonly publicMessage: string,
    readonly code?: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(publicMessage);
    this.name = "ApiError";
  }
}

export function badRequest(message = "Invalid request") {
  return new ApiError(400, message);
}

export function unauthorized(message = "Unauthorized") {
  return new ApiError(401, message);
}

export function forbidden(message = "Forbidden") {
  return new ApiError(403, message);
}

export function notFound(message = "Not found") {
  return new ApiError(404, message);
}

export function conflict(message = "Conflict") {
  return new ApiError(409, message);
}

export function internalError() {
  return new ApiError(500, "Internal server error");
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof ZodError) return badRequest();
  return internalError();
}
