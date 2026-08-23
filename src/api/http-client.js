export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, code?: string, data?: Record<string, unknown> | null }} [options]
   */
  constructor(message, { status, code, data } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

function safeJson(text) {
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function createHttpClient({ auth, fetchImpl = fetch, apiBase = "/api" }) {
  async function request(path, options = {}) {
    const execute = async (token) => {
      const response = await fetchImpl(`${apiBase}${path}`, {
        method: options.method || "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          ...(options.body === undefined
            ? {}
            : { "content-type": "application/json" }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return { response, data: safeJson(await response.text()) };
    };

    let token = await auth.getAccessToken();
    if (!token) {
      throw new ApiError("Unauthorized", { status: 401 });
    }
    let result = await execute(token);
    if (result.response.status === 401) {
      token = await auth.getAccessToken({ refresh: true });
      if (token) result = await execute(token);
    }
    if (!result.response.ok) {
      throw new ApiError(result.data?.error || "Request failed", {
        status: result.response.status,
        code: result.data?.code,
        data: result.data,
      });
    }
    return result.data;
  }
  return { request };
}
