/**
 * Fixed, allowlisted Base44 bridge for rollback rehearsal and an explicitly
 * authorized rollback. A canonical request is passed through the environment;
 * this source never accepts executable code or arbitrary SDK paths.
 */

const REQUEST = JSON.parse(
  Deno.env.get("AUDITFLOW_REPLAY_REQUEST_JSON" /*__AUDITFLOW_REPLAY_REQUEST__*/) ?? "",
);
const ENTITIES = new Set([
  "Client",
  "Submission",
  "QuestionnaireTemplate",
  "PdfTemplate",
  "SyncedDriveFile",
  "User",
]);
const BEGIN = "__AUDITFLOW_REPLAY_JSON_BEGIN__";
const END = "__AUDITFLOW_REPLAY_JSON_END__";

function emit(value: unknown): void {
  console.log(`${BEGIN}${JSON.stringify(value)}${END}`);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_request");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 4096): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error("invalid_request");
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error("invalid_request");
  }
  return value as number;
}

function entity(value: unknown): string {
  const candidate = text(value, 64);
  if (!ENTITIES.has(candidate)) throw new Error("invalid_request");
  return candidate;
}

function safeErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
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

async function dispatch(requestValue: unknown): Promise<unknown> {
  const request = record(requestValue);
  const operation = text(request.operation, 64);
  if (operation === "list_page") {
    const name = entity(request.entity);
    const limit = integer(request.limit, 1, 5000);
    const skip = integer(request.skip, 0, Number.MAX_SAFE_INTEGER);
    const records = await base44.entities[name].list("id", limit, skip);
    if (!Array.isArray(records) || records.length > limit) throw new Error("invalid_response");
    return { records };
  }
  if (operation === "filter_id") {
    const name = entity(request.entity);
    const id = text(request.id, 512);
    const records = await base44.entities[name].filter({ id }, "id", 2, 0);
    if (!Array.isArray(records) || records.length > 1) throw new Error("invalid_response");
    return { records };
  }
  if (operation === "filter_user_email") {
    const email = text(request.email, 320);
    const records = await base44.entities.User.filter({ email }, "id", 2, 0);
    if (!Array.isArray(records) || records.length > 1) throw new Error("invalid_response");
    return { records };
  }
  if (operation === "create") {
    const name = entity(request.entity);
    return { record: await base44.entities[name].create(record(request.record)) };
  }
  if (operation === "update") {
    const name = entity(request.entity);
    return {
      record: await base44.entities[name].update(
        text(request.id, 512),
        record(request.record),
      ),
    };
  }
  if (operation === "delete") {
    const name = entity(request.entity);
    return { result: await base44.entities[name].delete(text(request.id, 512)) };
  }
  if (operation === "invite_user") {
    return {
      result: await base44.users.inviteUser(
        text(request.email, 320),
        text(request.role, 64),
      ),
    };
  }
  if (operation === "upload_private_file") {
    const path = text(request.path, 32768);
    const name = text(request.name, 255);
    const contentType = text(request.contentType, 255);
    const bytes = await Deno.readFile(path);
    const file = new File([bytes], name, { type: contentType });
    const result = await base44.integrations.Core.UploadPrivateFile({ file });
    if (!result || typeof result.file_uri !== "string" || !result.file_uri) {
      throw new Error("invalid_response");
    }
    return { file_uri: result.file_uri };
  }
  if (operation === "sign_file") {
    const result = await base44.integrations.Core.CreateFileSignedUrl({
      file_uri: text(request.file_uri),
      expires_in: integer(request.expires_in, 60, 3600),
    });
    if (!result || typeof result.signed_url !== "string" || !result.signed_url) {
      throw new Error("invalid_response");
    }
    return { signed_url: result.signed_url };
  }
  if (operation === "delete_file") {
    return {
      result: await base44.integrations.Core.DeleteFile({
        file_uri: text(request.file_uri),
      }),
    };
  }
  throw new Error("invalid_request");
}

try {
  emit({ ok: true, result: await dispatch(REQUEST) });
} catch (error) {
  emit({ ok: false, error: "bridge_operation_failed", status: safeErrorStatus(error) });
}
