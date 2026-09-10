import {
  apiRoutes,
  authContract,
  deploymentGateContract,
  pdfContract,
  routerContract,
  zipWorkerContract,
} from "./contracts";
import type { FoundationAuthentication } from "./auth";
import type { StageSettings } from "./stage";
import type { FoundationStorage } from "./storage";
import type { FoundationPdf } from "./pdf";
import type { PrivateFileCutoverSettings } from "./private-file-cutover";

export function createApplicationRouter(stage: StageSettings) {
  return new sst.aws.Router(
    routerContract.logicalName,
    stage.customDomain
      ? {
          domain: {
            name: stage.customDomain.name,
            dns: false,
            cert: stage.customDomain.certificateArn,
          },
        }
      : undefined,
  );
}

export function resolveSitePdfApiUrl(
  stage: StageSettings,
  configured: string | undefined,
) {
  const candidate = configured?.trim();
  if (!candidate || candidate === pdfContract.routerPrefix) {
    return pdfContract.routerPrefix;
  }
  if (stage.isProduction) {
    throw new Error("VITE_PDF_API_URL overrides are restricted to the test stage.");
  }
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("VITE_PDF_API_URL must be an HTTPS API Gateway base URL.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    !/^[a-z0-9]+\.execute-api\.il-central-1\.amazonaws\.com$/.test(url.hostname)
  ) {
    throw new Error("VITE_PDF_API_URL must be an HTTPS API Gateway base URL.");
  }
  if (url.origin !== pdfContract.legacyTestBaseUrl) {
    throw new Error(
      "VITE_PDF_API_URL must match the retained legacy test PDF API.",
    );
  }
  return url.origin;
}

export function createApplication(
  stage: StageSettings,
  storage: FoundationStorage,
  authentication: FoundationAuthentication,
  workloadBoundaryArn: $util.Input<string>,
  router: ReturnType<typeof createApplicationRouter>,
  pdf: FoundationPdf,
  privateFileCutover: PrivateFileCutoverSettings,
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
      PDF_TEMPLATE_TABLE_NAME: storage.tables.PdfTemplateTable.name,
      USER_TABLE_NAME: storage.tables.UserTable.name,
      CHANGE_JOURNAL_TABLE_NAME: storage.tables.ChangeJournalTable.name,
      FILES_BUCKET_NAME: storage.buckets.FilesBucket.name,
      TEMPORARY_OUTPUTS_BUCKET_NAME:
        storage.buckets.TemporaryOutputsBucket.name,
      [deploymentGateContract.privateFilesImport.environmentVariable]:
        privateFileCutover.enabled,
      [deploymentGateContract.privateFilesImport.manifestEnvironmentVariable]:
        privateFileCutover.manifestSha256,
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

  const zipWorker = new sst.aws.Function(zipWorkerContract.logicalName, {
    handler: zipWorkerContract.handler,
    runtime: zipWorkerContract.runtime,
    architecture: zipWorkerContract.architecture,
    memory: `${zipWorkerContract.memoryMb} MB`,
    timeout: `${zipWorkerContract.timeoutSeconds / 60} minutes`,
    storage: `${zipWorkerContract.storageMb / 1024} GB`,
    logging: {
      format: "json",
      retention: stage.isProduction ? "1 month" : "2 weeks",
    },
    environment: {
      CHANGE_JOURNAL_TABLE_NAME: storage.tables.ChangeJournalTable.name,
      FILES_BUCKET_NAME: storage.buckets.FilesBucket.name,
      TEMPORARY_OUTPUTS_BUCKET_NAME:
        storage.buckets.TemporaryOutputsBucket.name,
      [deploymentGateContract.privateFilesImport.environmentVariable]:
        privateFileCutover.enabled,
      [deploymentGateContract.privateFilesImport.manifestEnvironmentVariable]:
        privateFileCutover.manifestSha256,
    },
    permissions: [
      {
        actions: [...zipWorkerContract.permissions.filesActions],
        resources: [$interpolate`${storage.buckets.FilesBucket.arn}/*`],
      },
      {
        actions: [...zipWorkerContract.permissions.temporaryActions],
        resources: [
          $interpolate`${storage.buckets.TemporaryOutputsBucket.arn}/${zipWorkerContract.permissions.temporaryPrefix}`,
        ],
      },
      {
        actions: [...zipWorkerContract.permissions.journalActions],
        resources: [storage.tables.ChangeJournalTable.arn],
      },
    ],
    transform: {
      role(args) {
        args.permissionsBoundary = workloadBoundaryArn;
      },
    },
  });

  storage.buckets.TemporaryOutputsBucket.notify({
    notifications: [
      {
        name: zipWorkerContract.notification.name,
        function: zipWorker.arn,
        events: [...zipWorkerContract.notification.events],
        filterPrefix: zipWorkerContract.notification.filterPrefix,
        filterSuffix: zipWorkerContract.notification.filterSuffix,
      },
    ],
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

  router.route(pdfContract.routerPattern, pdf.api.url, {
    rewrite: {
      regex: pdfContract.rewritePattern,
      to: pdfContract.rewriteReplacement,
    },
  });

  const sitePdfApiUrl = resolveSitePdfApiUrl(
    stage,
    process.env.VITE_PDF_API_URL,
  );
  const site = new sst.aws.StaticSite(routerContract.staticSiteLogicalName, {
    path: ".",
    build: {
      command: "npm run build",
      output: "dist",
    },
    errorPage: routerContract.spaFallback,
    environment: {
      VITE_API_BASE_URL: routerContract.apiPrefix,
      VITE_PDF_API_URL: sitePdfApiUrl,
      VITE_COGNITO_AUTHORITY: authentication.authority,
      VITE_COGNITO_CLIENT_ID: authentication.userPoolClient.id,
      VITE_COGNITO_CALLBACK_URL: authentication.callbackUrl,
      VITE_COGNITO_LOGOUT_URL: authentication.logoutUrl,
      VITE_COGNITO_SCOPE: authentication.scope,
      VITE_POSTHOG_KEY: process.env.VITE_POSTHOG_KEY ?? "",
    },
    router: {
      instance: router,
      path: "/",
    },
  });

  return { router, api, apiFunction, zipWorker, authorizer, site, pdf };
}
