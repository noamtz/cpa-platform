/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  async app(input) {
    const { APP_NAME, AWS_REGION, SST_VERSION, getStageSettings } =
      await import("./infra/sst/stage");

    if (input.stage === "production") {
      const { existsSync } = await import("node:fs");
      if (existsSync(".env.production.local")) {
        process.loadEnvFile(".env.production.local");
      }
    }

    const stage = getStageSettings(input.stage);

    return {
      name: APP_NAME,
      home: "aws",
      version: SST_VERSION,
      protect: stage.protect,
      removal: stage.removal,
      providers: {
        aws: {
          region: AWS_REGION,
        },
      },
    };
  },
  async run() {
    const [
      { getStageSettings },
      { createStorage },
      { createAuthentication },
      { createCostControls },
      { createApplication, createApplicationRouter },
      { createDeploymentRole },
      { createPdfApi },
      { resolvePrivateFileCutover },
    ] = await Promise.all([
      import("./infra/sst/stage"),
      import("./infra/sst/storage"),
      import("./infra/sst/auth"),
      import("./infra/sst/cost"),
      import("./infra/sst/application"),
      import("./infra/sst/deployment-role"),
      import("./infra/sst/pdf"),
      import("./infra/sst/private-file-cutover"),
    ]);

    const stage = getStageSettings($app.stage);
    const privateFileCutover = resolvePrivateFileCutover({
      stage: stage.name,
      requested: process.env.AUDITFLOW_ENABLE_LEGACY_FILE_READS,
      expectedManifestSha256:
        process.env.AUDITFLOW_EXPECTED_LEGACY_IMPORT_MANIFEST_SHA256,
      repositoryRoot: process.cwd(),
    });
    const router = createApplicationRouter(stage);
    if (!router._kvStoreArn) {
      throw new Error("The application Router must expose its KeyValueStore ARN.");
    }
    const storage = createStorage(stage, router.url);
    const authentication = createAuthentication(stage, router.url);
    createCostControls(stage);
    const deploymentRole = await createDeploymentRole(
      stage,
      stage.isProduction ? router._kvStoreArn : undefined,
    );
    const pdf = createPdfApi(
      stage,
      deploymentRole.workloadBoundary.arn,
      router.url,
    );
    const application = createApplication(
      stage,
      storage,
      authentication,
      deploymentRole.workloadBoundary.arn,
      router,
      pdf,
      privateFileCutover,
    );

    return {
      stage: stage.name,
      routerUrl: application.router.url,
      siteUrl: application.site.url,
      apiUrl: application.api.url,
      apiId: application.api.nodes.api.id,
      apiFunctionName: application.apiFunction.name,
      pdfApiUrl: application.pdf.api.url,
      pdfApiId: application.pdf.api.nodes.api.id,
      pdfFunctionName: application.pdf.pdfFunction.name,
      pdfBaseUrl: $interpolate`${application.router.url}/pdf`,
      pdfHealthUrl: $interpolate`${application.router.url}/pdf/health`,
      zipWorkerFunctionName: application.zipWorker.name,
      routerDistributionId: application.router.distributionID,
      routerKeyValueStoreArn: router._kvStoreArn,
      healthUrl: $interpolate`${application.router.url}/api/health`,
      protectedHealthUrl: $interpolate`${application.router.url}/api/auth/health`,
      tableNames: Object.fromEntries(
        Object.entries(storage.tables).map(([logicalName, table]) => [
          logicalName,
          table.name,
        ]),
      ),
      bucketNames: Object.fromEntries(
        Object.entries(storage.buckets).map(([logicalName, bucket]) => [
          logicalName,
          bucket.name,
        ]),
      ),
      userPoolId: authentication.userPool.id,
      userPoolClientId: authentication.userPoolClient.id,
      authAuthority: authentication.authority,
      authCallbackUrl: authentication.callbackUrl,
      authLogoutUrl: authentication.logoutUrl,
      authScope: authentication.scope,
      deployRoleArn: deploymentRole.role.arn,
      customDomain: stage.customDomain?.name ?? "",
    };
  },
});
