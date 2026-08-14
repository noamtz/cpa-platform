import {
  apiRoutes,
  authContract,
  routerContract,
} from "./contracts";
import type { FoundationAuthentication } from "./auth";
import type { StageSettings } from "./stage";
import type { FoundationStorage } from "./storage";

export function createApplication(
  stage: StageSettings,
  storage: FoundationStorage,
  authentication: FoundationAuthentication,
) {
  const router = new sst.aws.Router(routerContract.logicalName);
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
    },
    link: [
      ...storage.tableList,
      ...storage.bucketList,
      authentication.userPool,
    ],
  });

  const authorizer = api.addAuthorizer({
    name: authContract.authorizerName,
    jwt: {
      issuer: $interpolate`https://cognito-idp.${aws.getRegionOutput().name}.amazonaws.com/${authentication.userPool.id}`,
      audiences: [authentication.userPoolClient.id],
    },
  });

  api.route(apiRoutes.health.route, apiFunction.arn);
  api.route(apiRoutes.protectedHealth.route, apiFunction.arn, {
    auth: {
      jwt: { authorizer: authorizer.id },
    },
  });

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
    },
    router: {
      instance: router,
      path: "/",
    },
  });

  return { router, api, apiFunction, authorizer, site };
}
