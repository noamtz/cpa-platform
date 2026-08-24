/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  async app(input) {
    const { APP_NAME, AWS_REGION, SST_VERSION, getStageSettings } =
      await import("./infra/sst/stage");

    if (input.stage === "production") {
      process.loadEnvFile(".env.production.local");
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
      { createTestDeploymentRole },
    ] = await Promise.all([
      import("./infra/sst/stage"),
      import("./infra/sst/storage"),
      import("./infra/sst/auth"),
      import("./infra/sst/cost"),
      import("./infra/sst/application"),
      import("./infra/sst/deployment-role"),
    ]);

    const stage = getStageSettings($app.stage);
    const router = createApplicationRouter();
    const storage = createStorage(stage, router.url);
    const authentication = createAuthentication(stage, router.url);
    createCostControls(stage);
    const testDeployRole = await createTestDeploymentRole(stage);
    const application = createApplication(
      stage,
      storage,
      authentication,
      testDeployRole.workloadBoundary.arn,
      router,
    );

    return {
      stage: stage.name,
      routerUrl: application.router.url,
      siteUrl: application.site.url,
      apiUrl: application.api.url,
      apiId: application.api.nodes.api.id,
      apiFunctionName: application.apiFunction.name,
      zipWorkerFunctionName: application.zipWorker.name,
      routerDistributionId: application.router.distributionID,
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
      testDeployRoleArn: testDeployRole.role?.arn ?? "",
    };
  },
});
