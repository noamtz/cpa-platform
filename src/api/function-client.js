const MIGRATED_PUBLIC_FUNCTIONS = new Set([
  "getClientByToken",
  "getActiveTemplate",
  "getTemplateById",
  "updateClientSubmission",
  "uploadFile",
  "getSignedPdfUrl",
  "getTemplateFileUrl",
]);

const AWS_COMPATIBILITY_APP_ID = "auditflow";

function fallbackError(name, status) {
  return { error: `${name} failed with ${status}` };
}

export class FunctionCallError extends Error {
  constructor(name, status, body) {
    super(body?.error || `${name} failed with ${status}`);
    this.name = "FunctionCallError";
    this.status = status;
    this.body = body;
  }
}

export async function postPublicFunction(
  name,
  payload,
  {
    appId = AWS_COMPATIBILITY_APP_ID,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (!MIGRATED_PUBLIC_FUNCTIONS.has(name)) {
    throw new Error(`Unsupported public function: ${name}`);
  }
  if (!appId) throw new Error("Missing public function app ID");

  const response = await fetchImpl(`/api/apps/${appId}/functions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = fallbackError(name, response.status);
  }
  return { ok: response.ok, status: response.status, body };
}

export async function invokePublicFunction(name, payload, options) {
  const result = await postPublicFunction(name, payload, options);
  if (!result.ok) {
    throw new FunctionCallError(name, result.status, result.body);
  }
  return result.body;
}
