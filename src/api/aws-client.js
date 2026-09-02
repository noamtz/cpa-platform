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
      PdfTemplate: {
        list: () => http.request("/cpa/pdf-templates"),
        get: (id) =>
          http.request(`/cpa/pdf-templates/${encodeURIComponent(id)}`),
        create: (data) =>
          http.request("/cpa/pdf-templates", { method: "POST", body: data }),
        update: (id, patch) =>
          http.request(`/cpa/pdf-templates/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: patch,
          }),
        delete: (id) =>
          http.request(`/cpa/pdf-templates/${encodeURIComponent(id)}/archive`, {
            method: "POST",
            body: {},
          }),
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
      async invoke(name, payload = {}) {
        const routes = {
          syncFilesToGoogleDrive: ["/cpa/integrations/google-drive/sync", "POST", payload],
          getActiveTemplate: ["/cpa/questionnaire-templates/active", "GET"],
          getAllTemplateVersions: ["/cpa/questionnaire-templates", "GET"],
          getTemplateById: [
            `/cpa/questionnaire-templates/${encodeURIComponent(payload.template_id)}`,
            "GET",
          ],
          saveQuestionnaireTemplate: ["/cpa/questionnaire-templates", "POST", payload],
          cpaSaveSubmission: [
            "/apps/auditflow/functions/cpaSaveSubmission",
            "POST",
            payload,
          ],
          changeClientTaxYear: [
            `/cpa/clients/${encodeURIComponent(payload.client_id)}/tax-year`,
            "POST",
            { tax_year: payload.tax_year },
          ],
          restoreSubmission: [
            `/cpa/submissions/${encodeURIComponent(payload.submission_id)}/restore`,
            "POST",
            payload.conflicting_submission_id
              ? { conflicting_submission_id: payload.conflicting_submission_id }
              : {},
          ],
          transitionSubmissionStatus: [
            `/cpa/submissions/${encodeURIComponent(payload.submission_id)}/workflow-status`,
            "POST",
            { client_id: payload.client_id, status: payload.status },
          ],
        };
        const route = routes[name];
        if (!route) throw new Error(`AWS function is not migrated: ${name}`);
        const [path, method, body] = route;
        const result = await http.request(path, {
          method,
          ...(body === undefined ? {} : { body }),
        });
        return { data: result };
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
