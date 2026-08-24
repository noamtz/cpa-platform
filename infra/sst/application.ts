import {
  apiRoutes,
  authContract,
  routerContract,
} from "./contracts";
import type { FoundationAuthentication } from "./auth";
import type { StageSettings } from "./stage";
import type { FoundationStorage } from "./storage";

export function createApplicationRouter() {
  return new sst.aws.Router(routerContract.logicalName);
}

export function createApplication(
  stage: StageSettings,
  storage: FoundationStorage,
  authentication: FoundationAuthentication,
  workloadBoundaryArn: $util.Input<string>,
  router: ReturnType<typeof createApplicationRouter>,
) {
  const api = new sst.aws.ApiGatewayV2("ApplicationApi", {
    cors: false,
    accessLog: {
      retention: stage.isProduction ? "1 month" : "2 weeks",
    },
  });

  const apiFunction = new sst.aws.Function("ApiFunction", {
    handler: "backend/api/handler.handler",
    runtime: "nodejs20.x",
    architecture: "arm64",
    memory: "512 MB",
    timeout: "10 seconds",
    logging: {
      format: "json",
      retention: stage.isProduction ? "1 month" : "2 weeks",
    },
    environment: {
      AUDITFLOW_STAGE: stage.name,
      USER_POOL_ID: authentication.userPool.id,
      USER_POOL_CLIENT_ID: authentication.userPoolClient.id,
      CLIENT_TABLE_NAME: storage.tables.ClientTable.name,
      SUBMISSION_TABLE_NAME: storage.tables.SubmissionTable.name,
      QUESTIONNAIRE_TEMPLATE_TABLE_NAME:
        storage.tables.QuestionnaireTemplateTable.name,
      USER_TABLE_NAME: storage.tables.UserTable.name,
      CHANGE_JOURNAL_TABLE_NAME: storage.tables.ChangeJournalTable.name,
    },
    link: [
      ...storage.tableList,
      ...storage.bucketList,
      authentication.userPool,
    ],
    transform: {
      role(args) {
        args.permissionsBoundary = workloadBoundaryArn;
      },
    },
  });

  const authorizer = api.addAuthorizer({
    name: authContract.authorizerName,
    jwt: {
      issuer: $interpolate`https://cognito-idp.${aws.getRegionOutput().name}.amazonaws.com/${authentication.userPool.id}`,
      audiences: [authentication.userPoolClient.id],
    },
  });

  for (const route of Object.values(apiRoutes)) {
    api.route(
      route.route,
      apiFunction.arn,
      route.authorization === "cognito-jwt"
        ? {
            auth: {
              jwt: {
                authorizer: authorizer.id,
                scopes:
                  "authorizationScopes" in route
                    ? [...route.authorizationScopes]
                    : undefined,
              },
            },
          }
        : {},
    );
  }

  router.route(routerContract.apiPrefix, api.url, {
    rewrite: {
      regex: routerContract.rewritePattern,
      to: routerContract.rewriteReplacement,
    },
  });

  const site = new sst.aws.StaticSite(routerContract.staticSiteLogicalName, {
    path: ".",
    build: {
      command: "npm run build",
      output: "dist",
    },
    errorPage: routerContract.spaFallback,
    environment: {
      VITE_API_BASE_URL: routerContract.apiPrefix,
      VITE_COGNITO_AUTHORITY: authentication.authority,
      VITE_COGNITO_CLIENT_ID: authentication.userPoolClient.id,
      VITE_COGNITO_CALLBACK_URL: authentication.callbackUrl,
      VITE_COGNITO_LOGOUT_URL: authentication.logoutUrl,
      VITE_COGNITO_SCOPE: authentication.scope,
    },
    router: {
      instance: router,
      path: "/",
    },
  });

  return { router, api, apiFunction, authorizer, site };
}
