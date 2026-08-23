import { describe, expect, it, vi } from "vitest";

import { ApiError, createHttpClient } from "../http-client";

describe("same-origin HTTP client", () => {
  it("attaches only the access token and returns parsed JSON", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ id: "client-1" }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const http = createHttpClient({
      auth: { getAccessToken: vi.fn().mockResolvedValue("access-token") },
      fetchImpl,
    });
    await expect(http.request("/cpa/clients/query", { method: "POST", body: {} })).resolves.toEqual([
      { id: "client-1" },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/cpa/clients/query",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer access-token" }),
      }),
    );
  });

  it("refreshes exactly once after a backend 401", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "user-1" }), { status: 200 }),
      );
    const getAccessToken = vi
      .fn()
      .mockResolvedValueOnce("old-token")
      .mockResolvedValueOnce("new-token");
    const http = createHttpClient({ auth: { getAccessToken }, fetchImpl });
    await expect(http.request("/cpa/me")).resolves.toEqual({ id: "user-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getAccessToken).toHaveBeenNthCalledWith(2, { refresh: true });
  });

  it("throws stable parsed errors and never retries a 403", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "Not implemented",
          code: "FEATURE_NOT_IMPLEMENTED",
          feature: "google-drive",
        }),
        { status: 501 },
      ),
    );
    const http = createHttpClient({
      auth: { getAccessToken: vi.fn().mockResolvedValue("access-token") },
      fetchImpl,
    });
    await expect(http.request("/deferred")).rejects.toMatchObject({
      name: "ApiError",
      message: "Not implemented",
      status: 501,
      code: "FEATURE_NOT_IMPLEMENTED",
      data: { feature: "google-drive" },
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(new ApiError("safe", { status: 400 })).toMatchObject({ status: 400 });
  });

  it("fails locally when there is no browser session", async () => {
    const fetchImpl = vi.fn();
    const http = createHttpClient({
      auth: { getAccessToken: vi.fn().mockResolvedValue(null) },
      fetchImpl,
    });
    await expect(http.request("/cpa/me")).rejects.toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
