interface ProviderErrorLike {
  readonly name?: unknown;
  readonly message?: unknown;
  readonly cause?: unknown;
  readonly code?: unknown;
  readonly Code?: unknown;
  readonly $metadata?: { readonly requestId?: unknown };
  readonly CancellationReasons?: readonly { readonly Code?: unknown }[];
}
const MAX_PROVIDER_MESSAGE_LENGTH = 1_024;

function asProviderError(value: unknown): ProviderErrorLike | undefined {
  return value && typeof value === "object"
    ? (value as ProviderErrorLike)
    : undefined;
}

function boundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, maximum)
    : undefined;
}

export function redactProviderMessage(message: string) {
  return message
    .replace(/\bBearer\s+[^\s,;]+/giu, "Bearer [REDACTED]")
    .replace(
      /([?&](?:access_token|id_token|refresh_token|token)=)[^&\s"']+/giu,
      "$1[REDACTED]",
    )
    .replace(
      /((?:authorization|password|secret|token)\s*[=:]\s*["']?)[^\s,"'}]+/giu,
      "$1[REDACTED]",
    )
    .replace(/\bAKIA[0-9A-Z]{16}\b/gu, "[REDACTED_AWS_KEY]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]{10,}){1,2}\b/gu, "[REDACTED_JWT]")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/gu, "[REDACTED_OPAQUE]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]")
    .replace(/\b\d{12}\b/gu, "[REDACTED_ACCOUNT]")
    .slice(0, MAX_PROVIDER_MESSAGE_LENGTH);
}

function deepestCause(error: unknown) {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const next = asProviderError(current)?.cause;
    if (!next) break;
    current = next;
  }
  return current;
}

export function providerErrorDiagnostics(error: unknown) {
  const source = asProviderError(deepestCause(error));
  const errorName = boundedString(source?.name, 128) ?? "UnknownError";
  const providerMessage = boundedString(source?.message, 4_096);
  const providerCode =
    boundedString(source?.Code, 128) ?? boundedString(source?.code, 128);
  const awsRequestId = boundedString(source?.$metadata?.requestId, 256);
  const cancellationCodes = source?.CancellationReasons?.slice(0, 100).map(
    (reason) => boundedString(reason.Code, 128) ?? "Unknown",
  );

  return {
    errorName,
    ...(providerMessage
      ? { providerMessage: redactProviderMessage(providerMessage) }
      : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(awsRequestId ? { awsRequestId } : {}),
    ...(cancellationCodes ? { cancellationCodes } : {}),
  };
}
