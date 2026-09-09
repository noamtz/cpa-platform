import { describe, expect, it, vi } from "vitest";

import { createCognitoAuth, OIDC_SCOPE, sanitizeReturnPath } from "../cognito-auth";

function setup({ captureEvent = vi.fn() } = {}) {
  const location = {
    origin: "https://app.example.test",
    pathname: "/clients",
    search: "?year=2025",
    hash: "#active",
    replace: vi.fn(),
  };
  class StateStore {
    constructor(options) {
      this.options = options;
    }
  }
  class Manager {
    constructor(settings) {
      this.settings = settings;
      this.getUser = vi.fn().mockResolvedValue(null);
      this.signinSilent = vi.fn();
      this.removeUser = vi.fn();
      this.signinRedirect = vi.fn();
      this.signinRedirectCallback = vi.fn();
      this.signoutRedirect = vi.fn();
    }
  }
  const auth = createCognitoAuth({
    config: {
      authority: "https://cognito-idp.il-central-1.amazonaws.com/il-central-1_EXAMPLE",
      clientId: "client-id",
      callbackUrl: "https://app.example.test/auth/callback",
      logoutUrl: "https://app.example.test/",
    },
    storage: {},
    location,
    captureEvent,
    UserManagerClass: Manager,
    StateStoreClass: StateStore,
  });
  return { auth, manager: auth.manager, location, captureEvent };
}

describe("Cognito browser auth", () => {
  it("configures code/PKCE OIDC with exact scopes and session-scoped stores", () => {
    const { manager } = setup();
    expect(manager.settings).toMatchObject({
      authority: "https://cognito-idp.il-central-1.amazonaws.com/il-central-1_EXAMPLE",
      response_type: "code",
      scope: OIDC_SCOPE,
      loadUserInfo: false,
      automaticSilentRenew: false,
    });
    expect(manager.settings.scope).toBe("openid auditflow-api/cpa");
    expect(manager.settings.userStore.options.prefix).toBe("auditflow_oidc.");
    expect(manager.settings.userStore.options.prefix).not.toContain("base44");
  });

  it("stores only a same-origin return path", async () => {
    const { auth, manager } = setup();
    await auth.redirectToLogin("https://evil.example/steal");
    expect(manager.signinRedirect).toHaveBeenCalledWith({
      state: { returnPath: "/" },
    });
    expect(sanitizeReturnPath("/settings?tab=team", "https://app.example.test")).toBe(
      "/settings?tab=team",
    );
  });

  it("validates callback state through the library and restores the safe path", async () => {
    const { auth, manager, location, captureEvent } = setup();
    manager.signinRedirectCallback.mockResolvedValue({
      state: { returnPath: "/settings" },
    });
    await expect(auth.completeCallback()).resolves.toBe("/settings");
    expect(captureEvent).toHaveBeenCalledWith("cpa_sign_in", {
      outcome: "success",
    });
    expect(captureEvent.mock.invocationCallOrder[0]).toBeLessThan(
      location.replace.mock.invocationCallOrder[0],
    );
    expect(location.replace).toHaveBeenCalledWith("/settings");
  });

  it("reports a classified callback failure and rethrows the identical error", async () => {
    const { auth, manager, captureEvent, location } = setup();
    const failure = Object.assign(new Error("private callback detail"), {
      status: 401,
    });
    manager.signinRedirectCallback.mockRejectedValue(failure);

    await expect(auth.completeCallback()).rejects.toBe(failure);
    expect(captureEvent).toHaveBeenCalledWith("cpa_sign_in", {
      outcome: "failure",
      failure_category: "authentication",
    });
    expect(captureEvent.mock.calls.flat()).not.toContain(failure);
    expect(location.replace).not.toHaveBeenCalled();
  });

  it.each([
    vi.fn(() => { throw new Error("analytics unavailable"); }),
    vi.fn(() => Promise.reject(new Error("analytics unavailable"))),
  ])("keeps callback navigation when analytics fails", async (captureEvent) => {
    const { auth, manager, location } = setup({ captureEvent });
    manager.signinRedirectCallback.mockResolvedValue({ state: {} });

    await expect(auth.completeCallback()).resolves.toBe("/");
    expect(location.replace).toHaveBeenCalledWith("/");
  });

  it("refreshes an expired session once and clears an unusable session", async () => {
    const { auth, manager } = setup();
    manager.getUser.mockResolvedValue({ expired: true, access_token: "expired" });
    manager.signinSilent.mockResolvedValue({
      expired: false,
      access_token: "refreshed",
    });
    await expect(auth.getAccessToken()).resolves.toBe("refreshed");
    expect(manager.signinSilent).toHaveBeenCalledOnce();

    manager.signinSilent.mockRejectedValue(new Error("refresh failed"));
    await expect(auth.getAccessToken({ refresh: true })).resolves.toBeNull();
    expect(manager.removeUser).toHaveBeenCalledOnce();
  });

  it("uses managed sign-out so the Cognito cookie is cleared", async () => {
    const { auth, manager } = setup();
    await auth.logout();
    expect(manager.signoutRedirect).toHaveBeenCalledWith({
      post_logout_redirect_uri: "https://app.example.test/",
    });
  });
});
