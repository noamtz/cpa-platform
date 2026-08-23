import { UserManager, WebStorageStateStore } from "oidc-client-ts";

export const OIDC_SCOPE = "openid auditflow-api/cpa";
const STORAGE_PREFIX = "auditflow_oidc.";

export function sanitizeReturnPath(value, origin) {
  if (!value) return "/";
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

export function createCognitoAuth({
  config,
  storage,
  location,
  UserManagerClass = UserManager,
  StateStoreClass = WebStorageStateStore,
}) {
  if (
    !config?.authority ||
    !config.clientId ||
    !config.callbackUrl ||
    !config.logoutUrl
  ) {
    throw new Error("Cognito browser configuration is incomplete");
  }
  const stateStore = new StateStoreClass({
    store: storage,
    prefix: STORAGE_PREFIX,
  });
  const manager = new UserManagerClass({
    authority: config.authority,
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    post_logout_redirect_uri: config.logoutUrl,
    response_type: "code",
    scope: OIDC_SCOPE,
    stateStore,
    userStore: stateStore,
    loadUserInfo: false,
    monitorSession: false,
    automaticSilentRenew: false,
  });

  const currentReturnPath = () =>
    sanitizeReturnPath(
      `${location.pathname || "/"}${location.search || ""}${location.hash || ""}`,
      location.origin,
    );

  async function getSession({ refresh = false } = {}) {
    let user = await manager.getUser();
    if (refresh || user?.expired) {
      if (!user) return null;
      try {
        user = await manager.signinSilent();
      } catch {
        await manager.removeUser();
        return null;
      }
    }
    return user && !user.expired ? user : null;
  }

  return {
    manager,
    async isAuthenticated() {
      return Boolean(await getSession());
    },
    async getAccessToken(options) {
      return (await getSession(options))?.access_token ?? null;
    },
    async redirectToLogin(returnUrl) {
      const returnPath = sanitizeReturnPath(
        returnUrl || currentReturnPath(),
        location.origin,
      );
      await manager.signinRedirect({ state: { returnPath } });
    },
    async completeCallback() {
      const user = await manager.signinRedirectCallback();
      const callbackState =
        user?.state && typeof user.state === "object"
          ? user.state
          : undefined;
      const returnPath = sanitizeReturnPath(
        callbackState && "returnPath" in callbackState
          ? callbackState.returnPath
          : undefined,
        location.origin,
      );
      location.replace(returnPath);
      return returnPath;
    },
    async logout() {
      await manager.signoutRedirect({
        post_logout_redirect_uri: config.logoutUrl,
      });
    },
  };
}

function runtimeConfig() {
  return {
    authority: import.meta.env.VITE_COGNITO_AUTHORITY,
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
    callbackUrl: import.meta.env.VITE_COGNITO_CALLBACK_URL,
    logoutUrl: import.meta.env.VITE_COGNITO_LOGOUT_URL,
  };
}

let runtimeAuth;

export function getRuntimeCognitoAuth() {
  if (!runtimeAuth) {
    runtimeAuth = createCognitoAuth({
      config: runtimeConfig(),
      storage: window.sessionStorage,
      location: window.location,
    });
  }
  return runtimeAuth;
}

export const cognitoAuth = {
  isAuthenticated: (...args) => getRuntimeCognitoAuth().isAuthenticated(...args),
  getAccessToken: (...args) => getRuntimeCognitoAuth().getAccessToken(...args),
  redirectToLogin: (...args) => getRuntimeCognitoAuth().redirectToLogin(...args),
  completeCallback: (...args) => getRuntimeCognitoAuth().completeCallback(...args),
  logout: (...args) => getRuntimeCognitoAuth().logout(...args),
};
