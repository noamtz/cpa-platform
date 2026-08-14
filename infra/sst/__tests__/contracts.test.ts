import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  apiRoutes,
  authContract,
  bucketContracts,
  costContract,
  deploymentContract,
  expectedInventory,
  expectedOutputKeys,
  routerContract,
  tableContracts,
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
      Object.values(apiRoutes).map(({ route, authorization }) => ({
        route,
        authorization,
      })),
    );
    expect(verifierContract.router).toMatchObject({
      apiPrefix: routerContract.apiPrefix,
      rewritePattern: routerContract.rewritePattern,
      rewriteReplacement: routerContract.rewriteReplacement,
      spaFallback: routerContract.spaFallback,
    });
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
      apiFunctions: 1,
      userPools: 1,
      userPoolClients: 1,
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
    expect(user?.globalIndexes.byCognitoSubject).toEqual({
      hashKey: "cognito_sub",
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
        cors: false,
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
    expect(routerContract).toMatchObject({
      apiPrefix: "/api",
      apiPattern: "/api/*",
      rewritePattern: "^/api/(.*)$",
      rewriteReplacement: "/$1",
      spaFallback: "index.html",
    });
    expect(authContract.clientSecret).toBe(false);
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
