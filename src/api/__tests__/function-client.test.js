import { describe, expect, it, vi } from "vitest";

import {
  FunctionCallError,
  invokePublicFunction,
  postPublicFunction,
} from "../function-client";

describe("public function client", () => {
  it("posts JSON to the exact legacy compatibility path without Authorization", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ client: { id: "client-1" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await postPublicFunction(
      "getClientByToken",
      { client_id: "client-1", token: "opaque-link-value" },
      { appId: "app-fixture", fetchImpl },
    );

    expect(result).toEqual({
      ok: true,
      status: 200,
      body: { client: { id: "client-1" } },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/apps/app-fixture/functions/getClientByToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "client-1",
          token: "opaque-link-value",
        }),
      },
    );
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it("preserves the complete reload body on a 409", async () => {
    const payload = {
      error: "submission_conflict",
      code: "submission_conflict",
      reload: true,
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), { status: 409 }),
    );
    await expect(
      postPublicFunction(
        "updateClientSubmission",
        { client_id: "client-1" },
        { appId: "app-fixture", fetchImpl },
      ),
    ).resolves.toEqual({ ok: false, status: 409, body: payload });
  });

  it("throws a structured error for callers that require persistence", async () => {
    const body = { error: "submission_archived", reload: true };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 409 }),
    );
    const promise = invokePublicFunction(
      "updateClientSubmission",
      { client_id: "client-1" },
      { appId: "app-fixture", fetchImpl },
    );
    await expect(promise).rejects.toBeInstanceOf(FunctionCallError);
    await expect(promise).rejects.toMatchObject({ status: 409, body });
  });

  it("uses a safe fallback for malformed non-JSON errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("gateway failure", { status: 502 }),
    );
    await expect(
      postPublicFunction(
        "getActiveTemplate",
        { client_id: "client-1" },
        { appId: "app-fixture", fetchImpl },
      ),
    ).resolves.toEqual({
      ok: false,
      status: 502,
      body: { error: "getActiveTemplate failed with 502" },
    });
  });

  it("rejects unnamed functions before transport", async () => {
    const fetchImpl = vi.fn();
    await expect(
      postPublicFunction("unknown", {}, { appId: "app-fixture", fetchImpl }),
    ).rejects.toThrow("Unsupported public function");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
