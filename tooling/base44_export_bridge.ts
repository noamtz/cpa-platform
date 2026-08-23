/**
 * Fixed, read-only Base44 CLI bridge for the production snapshot exporter.
 * Python passes one canonical JSON request through the child-process environment
 * and pipes this static program to `base44 exec --privileged --data-env prod`.
 */

const REQUEST = JSON.parse(
  Deno.env.get("AUDITFLOW_REQUEST_JSON" /*__AUDITFLOW_REQUEST__*/) ?? "",
);
const ENTITIES = new Set([
  "Client",
  "Submission",
  "QuestionnaireTemplate",
  "PdfTemplate",
  "SyncedDriveFile",
  "User",
]);
const BEGIN = "__AUDITFLOW_EXPORT_JSON_BEGIN__";
const END = "__AUDITFLOW_EXPORT_JSON_END__";

function emit(value: unknown): void {
  console.log(`${BEGIN}${JSON.stringify(value)}${END}`);
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error("invalid_request");
  }
  return value as number;
}

function safeErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }
  const value = error as Record<string, unknown>;
  const response = value.response;
  const candidate =
    value.status ??
    (response && typeof response === "object" && !Array.isArray(response)
      ? (response as Record<string, unknown>).status
      : null);
  return Number.isInteger(candidate) && (candidate as number) >= 400 && (candidate as number) <= 599
    ? (candidate as number)
    : null;
}

async function dispatch(request: unknown): Promise<unknown> {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("invalid_request");
  }
  const value = request as Record<string, unknown>;
  if (value.operation === "list_page") {
    if (typeof value.entity !== "string" || !ENTITIES.has(value.entity)) {
      throw new Error("invalid_request");
    }
    const limit = integer(value.limit, 1, 5000);
    const skip = integer(value.skip, 0, Number.MAX_SAFE_INTEGER);
    if (value.exhaust !== undefined && typeof value.exhaust !== "boolean") {
      throw new Error("invalid_request");
    }
    if (value.exhaust === true) {
      if (limit !== 1 || skip !== 0) {
        throw new Error("invalid_request");
      }
      const allRecords: Record<string, unknown>[] = [];
      let offset = 0;
      let previousId: string | undefined;
      while (true) {
        const page = await base44.entities[value.entity].list("id", limit, offset);
        if (!Array.isArray(page) || page.length > limit) {
          throw new Error("invalid_response");
        }
        for (const record of page) {
          if (!record || typeof record !== "object" || Array.isArray(record)) {
            throw new Error("invalid_response");
          }
          const recordId = (record as Record<string, unknown>).id;
          if (typeof recordId !== "string" || recordId.length === 0) {
            throw new Error("invalid_response");
          }
          if (previousId !== undefined && recordId <= previousId) {
            throw new Error("invalid_response");
          }
          allRecords.push(record as Record<string, unknown>);
          previousId = recordId;
        }
        offset += page.length;
        if (page.length < limit) {
          break;
        }
      }
      return { records: allRecords };
    }
    const records = await base44.entities[value.entity].list("id", limit, skip);
    if (!Array.isArray(records)) {
      throw new Error("invalid_response");
    }
    return { records };
  }
  if (value.operation === "sign_file") {
    const signOne = async (sourceReference: string): Promise<string> => {
      const result = await base44.integrations.Core.CreateFileSignedUrl({
        file_uri: sourceReference,
        expires_in: 900,
      });
      if (!result || typeof result.signed_url !== "string" || result.signed_url.length === 0) {
        throw new Error("invalid_response");
      }
      return result.signed_url;
    };
    if (Array.isArray(value.sourceReferences)) {
      if (
        value.sourceReferences.length < 1 ||
        value.sourceReferences.length > 50 ||
        value.sourceReferences.some((item) => typeof item !== "string" || item.length === 0)
      ) {
        throw new Error("invalid_request");
      }
      const signatures: Record<string, unknown>[] = [];
      for (const sourceReference of value.sourceReferences as string[]) {
        try {
          signatures.push({ ok: true, signedUrl: await signOne(sourceReference) });
        } catch (error) {
          signatures.push({ ok: false, status: safeErrorStatus(error) });
        }
      }
      return { signatures };
    }
    if (typeof value.sourceReference !== "string" || value.sourceReference.length === 0) {
      throw new Error("invalid_request");
    }
    return { signedUrl: await signOne(value.sourceReference) };
  }
  throw new Error("invalid_request");
}

try {
  emit({ ok: true, result: await dispatch(REQUEST) });
} catch (error) {
  emit({ ok: false, error: "bridge_operation_failed", status: safeErrorStatus(error) });
}
