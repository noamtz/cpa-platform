import { cognitoAuth } from "./cognito-auth";
import { createHttpClient } from "./http-client";

function queryEntity(http, path, filter, sort, limit) {
  return http.request(path, {
    method: "POST",
    body: {
      filter,
      ...(sort === undefined ? {} : { sort }),
      ...(limit === undefined ? {} : { limit }),
    },
  });
}

export function createAwsClient({ auth, http }) {
  return {
    entities: {
      Client: {
        list: (sort, limit) =>
          queryEntity(http, "/cpa/clients/query", {}, sort, limit),
        filter: (filter, sort, limit) =>
          queryEntity(http, "/cpa/clients/query", filter, sort, limit),
        create: (data) =>
          http.request("/cpa/clients", { method: "POST", body: data }),
        update: (id, patch) => {
          const keys = Object.keys(patch);
          if (keys.length === 1 && keys[0] === "token") {
            return http.request(`/cpa/clients/${encodeURIComponent(id)}/token-rotation`, {
              method: "POST",
              body: {},
            });
          }
          return http.request(`/cpa/clients/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: patch,
          });
        },
      },
      Submission: {
        list: (sort, limit) =>
          queryEntity(http, "/cpa/submissions/query", {}, sort, limit),
        filter: (filter, sort, limit) =>
          queryEntity(http, "/cpa/submissions/query", filter, sort, limit),
        update: (id, patch) =>
          http.request(`/cpa/submissions/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: patch,
          }),
      },
      User: {
        list: (sort, limit) =>
          queryEntity(http, "/cpa/users/query", {}, sort, limit),
      },
    },
    auth: {
      isAuthenticated: () => auth.isAuthenticated(),
      redirectToLogin: (returnUrl) => auth.redirectToLogin(returnUrl),
      logout: () => auth.logout(),
      async me() {
        if (!(await auth.isAuthenticated())) return null;
        return http.request("/cpa/me");
      },
      updateMe: (patch) =>
        http.request("/cpa/me", { method: "PATCH", body: patch }),
    },
    users: {
      inviteUser: (email, role) =>
        http.request("/cpa/users/invitations", {
          method: "POST",
          body: { email, role },
        }),
    },
    functions: {
      invoke(name, payload) {
        if (name !== "syncFilesToGoogleDrive") {
          throw new Error(`AWS function is not migrated: ${name}`);
        }
        return http.request("/cpa/integrations/google-drive/sync", {
          method: "POST",
          body: payload,
        });
      },
    },
    connectors: {
      connectAppUser: (connectorId) =>
        http.request("/cpa/integrations/google-drive/connect", {
          method: "POST",
          body: { connector_id: connectorId },
        }),
      disconnectAppUser: (connectorId) =>
        http.request("/cpa/integrations/google-drive/disconnect", {
          method: "POST",
          body: { connector_id: connectorId },
        }),
    },
  };
}

const runtimeHttp = createHttpClient({ auth: cognitoAuth });
export const awsClient = createAwsClient({ auth: cognitoAuth, http: runtimeHttp });
