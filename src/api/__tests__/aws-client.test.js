import { describe, expect, it, vi } from "vitest";

import { createAwsClient } from "../aws-client";

function setup(authenticated = true) {
  const request = vi.fn().mockResolvedValue([]);
  const auth = {
    isAuthenticated: vi.fn().mockResolvedValue(authenticated),
    redirectToLogin: vi.fn(),
    logout: vi.fn(),
  };
  return {
    request,
    client: createAwsClient({ auth, http: { request } }),
  };
}

describe("AWS compatibility client", () => {
  it("preserves list/filter arguments and bare arrays", async () => {
    const { client, request } = setup();
    request.mockResolvedValue([{ id: "client-1" }]);
    await expect(client.entities.Client.list("-created_date", 200)).resolves.toEqual([
      { id: "client-1" },
    ]);
    expect(request).toHaveBeenCalledWith("/cpa/clients/query", {
      method: "POST",
      body: { filter: {}, sort: "-created_date", limit: 200 },
    });
  });

  it("maps a token-only patch to server rotation and ignores its value", async () => {
    const { client, request } = setup();
    await client.entities.Client.update("client/1", { token: "weak-browser-token" });
    expect(request).toHaveBeenCalledWith(
      "/cpa/clients/client%2F1/token-rotation",
      { method: "POST", body: {} },
    );
    expect(JSON.stringify(request.mock.calls)).not.toContain("weak-browser-token");
  });

  it("returns null from me only when the browser session is absent", async () => {
    const { client, request } = setup(false);
    await expect(client.auth.me()).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("maps Drive controls only to the authenticated deferred API", async () => {
    const { client, request } = setup();
    await client.functions.invoke("syncFilesToGoogleDrive", { check_connection: true });
    await client.connectors.connectAppUser("connector-1");
    expect(request.mock.calls).toEqual([
      ["/cpa/integrations/google-drive/sync", { method: "POST", body: { check_connection: true } }],
      ["/cpa/integrations/google-drive/connect", { method: "POST", body: { connector_id: "connector-1" } }],
    ]);
  });

  it("does not invent an AWS fallback for unmigrated functions", () => {
    const { client, request } = setup();
    expect(() => client.functions.invoke("getActiveTemplate", {})).toThrow(
      "not migrated",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
