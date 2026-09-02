import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  apiRoutes,
  authContract,
  bucketContracts,
  costContract,
  deploymentContract,
  deploymentGateContract,
  expectedInventory,
  expectedOutputKeys,
  pdfContract,
  routerContract,
  tableContracts,
  zipWorkerContract,
} from "../contracts";

describe("foundation resource contract", () => {
  it("keeps the dependency-free verifier contract in sync", () => {
    const verifierContract = JSON.parse(
      readFileSync(
        new URL("../foundation-contract.json", import.meta.url),
        "utf8",
      ),
    );

    expect(verifierContract.tables).toEqual(
      tableContracts.map(({ logicalName, primaryIndex, globalIndexes }) => ({
        logicalName,
        primaryIndex,
        globalIndexes,
      })),
    );
    expect(verifierContract.buckets).toEqual(
      bucketContracts.map((bucket) => ({
        logicalName: bucket.logicalName,
        private: !bucket.publicAccess,
        cors: bucket.cors,
        versioning: bucket.versioning,
        ...(bucket.logicalName === "TemporaryOutputsBucket"
          ? { expirationDays: bucket.expirationDays }
          : {}),
      })),
    );
    expect(verifierContract.routes).toEqual(
      Object.values(apiRoutes).map(({ route, authorization, ...routeContract }) => ({
        route,
        authorization,
        ...("authorizationScopes" in routeContract
          ? { authorizationScopes: routeContract.authorizationScopes }
          : {}),
      })),
    );
    expect(verifierContract.auth).toEqual({
      domainLogicalName: authContract.userPoolDomainLogicalName,
      resourceServerLogicalName: authContract.resourceServerLogicalName,
      resourceServerIdentifier: authContract.resourceServerIdentifier,
      scopeName: authContract.scopeName,
      authorityType: authContract.authorityType,
      apiScope: authContract.apiScope,
      allowedOAuthFlows: authContract.allowedOAuthFlows,
      allowedOAuthScopes: authContract.allowedOAuthScopes,
      callbackPath: authContract.callbackPath,
      logoutPath: authContract.logoutPath,
      localOrigin: authContract.localOrigin,
      clientSecret: authContract.clientSecret,
      refreshTokenValidityDays: authContract.refreshTokenValidityDays,
      refreshTokenRotation: authContract.refreshTokenRotation,
    });
    expect(verifierContract.router).toMatchObject({
      apiPrefix: routerContract.apiPrefix,
      rewritePattern: routerContract.rewritePattern,
      rewriteReplacement: routerContract.rewriteReplacement,
      spaFallback: routerContract.spaFallback,
    });
    expect(verifierContract.pdf).toEqual(pdfContract);
    expect(verifierContract.zipWorker).toEqual(zipWorkerContract);
    expect(verifierContract.deploymentGates).toEqual(deploymentGateContract);
    expect(verifierContract.oidc).toEqual({
      providerUrl: deploymentContract.providerUrl,
      audience: deploymentContract.audience,
      subject: deploymentContract.subject,
    });
    expect(verifierContract.inventory).toEqual(expectedInventory);
    expect(verifierContract.outputKeys).toEqual(expectedOutputKeys);
  });

  it("defines the exact stable inventory", () => {
    expect(tableContracts).toHaveLength(7);
    expect(bucketContracts).toHaveLength(2);
    expect(expectedInventory).toEqual({
      tables: 7,
      buckets: 2,
      routers: 1,
      staticSites: 1,
      apis: 1,
      pdfApis: 1,
      apiFunctions: 1,
      pdfFunctions: 1,
      workerFunctions: 1,
      userPools: 1,
      userPoolClients: 1,
      userPoolDomains: 1,
      resourceServers: 1,
      jwtAuthorizers: 1,
    });
    expect(tableContracts.map(({ logicalName }) => logicalName)).toEqual([
      "ClientTable",
      "SubmissionTable",
      "QuestionnaireTemplateTable",
      "PdfTemplateTable",
      "SyncedDriveFileTable",
      "UserTable",
      "ChangeJournalTable",
    ]);
  });

  it("pins primary keys and access-pattern indexes", () => {
    const client = tableContracts.find((table) => table.entityName === "Client");
    const submission = tableContracts.find(
      (table) => table.entityName === "Submission",
    );
    const questionnaireTemplate = tableContracts.find(
      (table) => table.entityName === "QuestionnaireTemplate",
    );
    const user = tableContracts.find((table) => table.entityName === "User");
    const changeJournal = tableContracts.find(
      (table) => table.entityName === "ChangeJournal",
    );

    expect(client?.primaryIndex).toEqual({ hashKey: "id" });
    expect(submission?.globalIndexes).toEqual({
      byClientYear: { hashKey: "client_id", rangeKey: "tax_year" },
      byCreatedDate: { hashKey: "record_type", rangeKey: "created_date" },
    });
    expect(questionnaireTemplate?.globalIndexes.byVersion).toEqual({
      hashKey: "record_type",
      rangeKey: "version",
    });
    expect(user?.globalIndexes).toEqual({
      byCognitoSubject: { hashKey: "cognito_sub" },
      byCreatedDate: { hashKey: "record_type", rangeKey: "created_date" },
    });
    expect(changeJournal?.primaryIndex).toEqual({
      hashKey: "scope",
      rangeKey: "sequence",
    });
    expect(changeJournal?.globalIndexes.byEntity).toEqual({
      hashKey: "entity_key",
      rangeKey: "sequence",
    });

    for (const table of tableContracts) {
      expect(Object.values(table.fields)).not.toContain("boolean");
    }
  });

  it("keeps both storage buckets private and temporary output short-lived", () => {
    expect(bucketContracts).toEqual([
      expect.objectContaining({
        logicalName: "FilesBucket",
        publicAccess: false,
        enforceHttps: true,
        cors: expect.objectContaining({
          originPolicy: "router-plus-local-test",
          allowMethods: ["PUT", "HEAD"],
        }),
        versioning: true,
      }),
      expect.objectContaining({
        logicalName: "TemporaryOutputsBucket",
        publicAccess: false,
        enforceHttps: true,
        cors: false,
        versioning: false,
        expirationDays: 1,
      }),
    ]);
  });

  it("pins the same-origin and authorization boundary", () => {
    expect(apiRoutes.health).toEqual({
      route: "GET /health",
      path: "/health",
      authorization: "none",
    });
    expect(apiRoutes.protectedHealth.authorization).toBe("cognito-jwt");
    const publicQuestionnaireRoutes = Object.values(apiRoutes).filter(({ path }) =>
      path.startsWith("/apps/{appId}/functions/"),
    );
    expect(publicQuestionnaireRoutes).toEqual([
      expect.objectContaining({
        route: "POST /apps/{appId}/functions/getClientByToken",
        authorization: "none",
      }),
      expect.objectContaining({
        route: "POST /apps/{appId}/functions/getActiveTemplate",
        authorization: "none",
      }),
      expect.objectContaining({
        route: "POST /apps/{appId}/functions/getTemplateById",
        authorization: "none",
      }),
      expect.objectContaining({
        route: "POST /apps/{appId}/functions/updateClientSubmission",
        authorization: "none",
      }),
      expect.objectContaining({
        route: "POST /apps/{appId}/functions/uploadFile",
        authorization: "none",
      }),
      expect.objectContaining({
        route: "POST /apps/{appId}/functions/getSignedPdfUrl",
        authorization: "none",
      }),
      expect.objectContaining({
        route: "POST /apps/{appId}/functions/getTemplateFileUrl",
        authorization: "none",
      }),
      expect.objectContaining({
        route: "POST /apps/{appId}/functions/getPdfTemplateById",
        authorization: "none",
      }),
    ]);
    const cpaRoutes = Object.values(apiRoutes).filter(({ path }) =>
      path.startsWith("/cpa/"),
    );
    expect(cpaRoutes).toHaveLength(21);
    expect(
      cpaRoutes.every(
        (route) =>
          route.authorization === "cognito-jwt" &&
          "authorizationScopes" in route &&
          JSON.stringify(route.authorizationScopes) ===
            JSON.stringify([authContract.apiScope]),
      ),
    ).toBe(true);
    expect(cpaRoutes.map(({ route }) => route)).toEqual([
      "POST /cpa/clients/query",
      "POST /cpa/clients",
      "PATCH /cpa/clients/{id}",
      "POST /cpa/clients/{id}/token-rotation",
      "POST /cpa/submissions/query",
      "PATCH /cpa/submissions/{id}",
      "POST /cpa/files/uploads/initiate",
      "POST /cpa/files/uploads/complete",
      "POST /cpa/files/submission-url",
      "POST /cpa/files/template-url",
      "POST /cpa/files/template-mirror",
      "POST /cpa/submissions/{id}/zip-downloads",
      "GET /cpa/submissions/{id}/zip-downloads/{jobId}",
      "POST /cpa/users/query",
      "GET /cpa/me",
      "PATCH /cpa/me",
      "POST /cpa/users/invitations",
      "POST /cpa/integrations/google-drive/sync",
      "POST /cpa/integrations/google-drive/connect",
      "POST /cpa/integrations/google-drive/disconnect",
      "POST /cpa/integrations/telegram/notify",
    ]);
    expect(routerContract).toMatchObject({
      apiPrefix: "/api",
      apiPattern: "/api/*",
      rewritePattern: "^/api/(.*)$",
      rewriteReplacement: "/$1",
      spaFallback: "index.html",
    });
    expect(authContract.clientSecret).toBe(false);
    expect(authContract.authorityType).toBe("regional-user-pool-issuer");
    expect(authContract.allowedOAuthFlows).toEqual(["code"]);
    expect(authContract.allowedOAuthScopes).toEqual([
      "openid",
      "auditflow-api/cpa",
    ]);
    expect(authContract.refreshTokenRotation).toEqual({
      feature: "ENABLED",
      retryGracePeriodSeconds: 10,
      providerCompatibility: "post-deploy-sdk-update",
    });
  });

  it("defines a separate compute-only PDF API and exact package contract", () => {
    expect(pdfContract).toEqual({
      apiLogicalName: "PdfApi",
      functionLogicalName: "PdfRendererFunction",
      handler: "lambda/pdf-generator/index.handler",
      runtime: "nodejs20.x",
      architecture: "arm64",
      memoryMb: 1024,
      timeoutSeconds: 60,
      storageMb: 512,
      corsOriginPolicy: "router-origin-exact",
      apiCors: false,
      routerPrefix: "/pdf",
      routerPattern: "/pdf/*",
      rewritePattern: "^/pdf/(.*)$",
      rewriteReplacement: "/$1",
      routes: [
        { route: "GET /health" },
        { route: "POST /render-pages" },
        { route: "POST /generate-pdf" },
        { route: "OPTIONS /{proxy+}" },
      ],
      nodejsInstall: [
        "@napi-rs/canvas",
        "@napi-rs/canvas-linux-arm64-gnu",
        "pdfjs-dist",
      ],
      font: {
        source: "lambda/pdf-generator/fonts/Heebo-Regular.ttf",
        destination: "fonts/Heebo-Regular.ttf",
        bytes: 122012,
        sha256:
          "18F930B583FA8FE6B40B2F8263B7AC6AFBAC07ADC91A12467874E7467D3ACE30",
      },
      resourceLinks: [],
      permissions: [],
    });

    const pdfSource = readFileSync(new URL("../pdf.ts", import.meta.url), "utf8");
    const applicationSource = readFileSync(
      new URL("../application.ts", import.meta.url),
      "utf8",
    );
    expect(pdfSource).toContain("CORS_ORIGIN: routerOrigin");
    expect(pdfSource).toContain("install: [...pdfContract.nodejsInstall]");
    expect(pdfSource).toContain("copyFiles:");
    expect(pdfSource).toContain("link: [...pdfContract.resourceLinks]");
    expect(pdfSource).toContain("permissions: [...pdfContract.permissions]");
    expect(pdfSource).toContain("args.permissionsBoundary = workloadBoundaryArn");
    expect(applicationSource).toContain(
      "router.route(pdfContract.routerPattern, pdf.api.url",
    );
    expect(applicationSource).toContain(
      "VITE_PDF_API_URL: pdfContract.routerPrefix",
    );
  });

  it("uses an exact GitHub environment subject without legacy or wildcard trust", () => {
    expect(deploymentContract.providerUrl).toBe(
      "token.actions.githubusercontent.com",
    );
    expect(deploymentContract.audience).toBe("sts.amazonaws.com");
    expect(deploymentContract.subject).toBe(
      "repo:noamtz@2631641/cpa-platform@1332935468:environment:test",
    );
    expect(deploymentContract.subject).not.toContain("*");
    expect(deploymentContract.subject).not.toContain("noamtz/auditflow");
  });

  it("pins test deployments to synthetic-only file access", () => {
    expect(deploymentGateContract.privateFilesImport).toEqual({
      issue: 11,
      evidencePath: "docs/migration/private-file-import-verification.json",
      verifier: "tooling/verify_private_file_cutover.mjs",
      requiredBefore: "legacy-file-read-enablement",
      resolverContract: "legacy-sha256-v1",
      environmentVariable: "LEGACY_FILE_READS_ENABLED",
      syntheticOnlyValue: "false",
      enablementIssue: 11,
    });
    const applicationSource = readFileSync(
      new URL("../application.ts", import.meta.url),
      "utf8",
    );
    expect(applicationSource.match(/syntheticOnlyValue/g)).toHaveLength(2);
  });

  it("defines an alert-only production budget and safe outputs", () => {
    expect(costContract).toMatchObject({
      stage: "production",
      timeUnit: "MONTHLY",
      budgetType: "COST",
      automatedActions: false,
    });
    expect(expectedOutputKeys).not.toContain("budgetAlertEmail");
    expect(expectedOutputKeys).not.toContain("accountId");
  });
});
