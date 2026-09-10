import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  assertDeploymentIdentity,
  assertBrowserCorsAbsent,
  assertBrowserCorsExact,
  cloudFrontKeyValueStoreSimulationTargets,
  hasScopedCloudFrontKeyValueStorePermissions,
  hasApiGatewayCorsConfiguration,
  isRetryableAwsCliFailure,
  notificationFilterRulesByName,
  parseAwsCliErrorCode,
  pdfRoutesTargetSingleFunction,
  retryAwsCliCommand,
  requiredCloudFrontKeyValueStoreActions,
  scopedCpaRouteCount,
  validateDeploymentTargets,
  validateRouterOutputs,
  validateProductionBudgetReadback,
} from "../../../tooling/verify_sst_foundation.mjs";

const foundationContract = JSON.parse(
  readFileSync(new URL("../foundation-contract.json", import.meta.url), "utf8"),
);
const deploymentTargets = JSON.parse(
  readFileSync(new URL("../deployment-targets.json", import.meta.url), "utf8"),
);

const accountId = "123456789012";
const expectedStatement = {
  Sid: "ManageCloudFrontKeyValues",
  Effect: "Allow",
  Action: requiredCloudFrontKeyValueStoreActions,
  Resource: `arn:aws:cloudfront::${accountId}:key-value-store/*`,
};

describe("test deployer permission verification", () => {
  it("accepts only the canonical stage targets", () => {
    expect(validateDeploymentTargets(deploymentTargets, foundationContract)).toBe(
      deploymentTargets,
    );
    expect(
      assertDeploymentIdentity(
        deploymentTargets,
        foundationContract,
        "test",
        { Account: deploymentTargets.targets.test.accountId },
      ),
    ).toBe(deploymentTargets.targets.test);
  });

  it("rejects a different caller without disclosing either account", () => {
    const action = () =>
      assertDeploymentIdentity(
        deploymentTargets,
        foundationContract,
        "test",
        { Account: "123456789012" },
      );

    expect(action).toThrow(
      "AWS caller does not match the configured AuditFlow test account.",
    );
    try {
      action();
    } catch (error) {
      expect(error.message).not.toContain("123456789012");
      expect(error.message).not.toContain(
        deploymentTargets.targets.test.accountId,
      );
    }
  });

  it("accepts only the explicit account-scoped KeyValueStore grant", () => {
    expect(
      hasScopedCloudFrontKeyValueStorePermissions(
        { Statement: [expectedStatement] },
        accountId,
      ),
    ).toBe(true);
  });

  it("rejects the ineffective resource-tag condition and broad resources", () => {
    expect(
      hasScopedCloudFrontKeyValueStorePermissions(
        {
          Statement: [
            {
              ...expectedStatement,
              Condition: {
                StringEquals: {
                  "aws:ResourceTag/sst:app": "auditflow",
                },
              },
            },
          ],
        },
        accountId,
      ),
    ).toBe(false);
    expect(
      hasScopedCloudFrontKeyValueStorePermissions(
        {
          Statement: [{ ...expectedStatement, Resource: "*" }],
        },
        accountId,
      ),
    ).toBe(false);
  });

  it("runs the deployed-role preflight before every SST preview or deployment", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/deploy-sst-test.yml", import.meta.url),
      "utf8",
    );
    const preflight = workflow.indexOf("--mode deployer");
    const preview = workflow.indexOf("npx sst diff --stage test");
    const deployment = workflow.indexOf("npm run sst:deploy:test");

    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(preview);
    expect(preflight).toBeLessThan(deployment);
  });

  it.each(["test", "production"])(
    "pins the %s GitHub credential action to the repository target",
    (stage) => {
      const workflow = readFileSync(
        new URL(
          `../../../.github/workflows/deploy-sst-${stage}.yml`,
          import.meta.url,
        ),
        "utf8",
      );

      expect(workflow).toContain("infra/sst/deployment-targets.json");
      expect(workflow).toContain(
        "role-to-assume: ${{ steps.deployment-target.outputs.role-arn }}",
      );
      expect(workflow).toContain(
        "allowed-account-ids: ${{ steps.deployment-target.outputs.account-id }}",
      );
      expect(workflow).toContain("mask-aws-account-id: true");
    },
  );

  it("keeps ordinary deploys disabled and gates manual enablement before AWS access", () => {
    const workflow = readFileSync(
      new URL("../../../.github/workflows/deploy-sst-test.yml", import.meta.url),
      "utf8",
    );
    const modeValidation = workflow.indexOf(
      "Validate requested legacy-file mode before AWS access",
    );
    const credentials = workflow.indexOf("Configure AWS credentials");
    const environmentReadback = workflow.indexOf(
      "Verify protected enablement environment",
    );

    expect(workflow).toContain("enable_legacy_file_reads:");
    expect(workflow).toMatch(
      /enable_legacy_file_reads:[\s\S]*?type: boolean[\s\S]*?default: false/,
    );
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.enable_legacy_file_reads && 'test-legacy-read-enable' || 'test'",
    );
    expect(workflow).toContain(
      "github.event_name == 'workflow_dispatch' && inputs.enable_legacy_file_reads && 'true' || 'false'",
    );
    expect(workflow).toContain('[[ "${GITHUB_REF}" == "refs/heads/main" ]]');
    expect(workflow).toContain("npm run verify:file-cutover:test");
    expect(workflow).toContain(
      "environments/test-legacy-read-enable/deployment-branch-policies?per_page=100",
    );
    expect(workflow).toContain('entry.reviewer?.login === "noamtz"');
    expect(workflow).toContain('policies.branch_policies?.[0]?.name === "main"');
    expect(modeValidation).toBeGreaterThan(-1);
    expect(modeValidation).toBeLessThan(credentials);
    expect(environmentReadback).toBeGreaterThan(modeValidation);
    expect(environmentReadback).toBeLessThan(credentials);
  });

  it("resolves cutover evidence from the checkout instead of SST's bundled module path", () => {
    const config = readFileSync(
      new URL("../../../sst.config.ts", import.meta.url),
      "utf8",
    );

    expect(config).toContain("repositoryRoot: process.cwd()");
  });
});

describe("live verifier evidence", () => {
  it("reports the CPA route count derived from the enforced contract", () => {
    const contract = JSON.parse(
      readFileSync(new URL("../foundation-contract.json", import.meta.url), "utf8"),
    );

    expect(scopedCpaRouteCount(contract)).toBe(36);
  });
});

describe("production budget read-back", () => {
  const contract = JSON.parse(
    readFileSync(new URL("../foundation-contract.json", import.meta.url), "utf8"),
  );
  const input = {
    contract,
    budget: {
      BudgetName: "auditflow-production-monthly-cost",
      BudgetLimit: { Amount: "10", Unit: "USD" },
      BudgetType: "COST",
      TimeUnit: "MONTHLY",
    },
    notifications: [{
      NotificationType: "ACTUAL",
      ComparisonOperator: "GREATER_THAN",
      Threshold: 80,
      ThresholdType: "PERCENTAGE",
    }],
    subscribers: [{ SubscriptionType: "EMAIL", Address: "not-returned" }],
    actions: [],
    rate: "3.5",
    rateDate: "2026-09-09",
    rateSource: "operator bank rate",
    now: new Date("2026-09-09T12:00:00Z"),
  };

  it("reports only aggregate subscriber and conversion evidence", () => {
    expect(validateProductionBudgetReadback(input)).toEqual({
      limitAmountUsd: 10,
      convertedLimitIls: 35,
      ceilingIls: 50,
      thresholdPercent: 80,
      recipientCount: 1,
      automatedActionCount: 0,
      rate: 3.5,
      rateDate: "2026-09-09",
      rateSource: "operator bank rate",
    });
  });

  it("requires one exact production KeyValueStore ARN", () => {
    const productionResource =
      `arn:aws:cloudfront::${accountId}:key-value-store/production-router`;
    const productionPolicy = {
      Statement: [{
        ...expectedStatement,
        Resource: productionResource,
      }],
    };

    expect(
      hasScopedCloudFrontKeyValueStorePermissions(
        productionPolicy,
        accountId,
        "production",
        productionResource,
      ),
    ).toBe(true);
    expect(
      hasScopedCloudFrontKeyValueStorePermissions(
        productionPolicy,
        accountId,
        "production",
        `arn:aws:cloudfront::${accountId}:key-value-store/different-router`,
      ),
    ).toBe(false);
    expect(
      hasScopedCloudFrontKeyValueStorePermissions(
        { Statement: [expectedStatement] },
        accountId,
        "production",
      ),
    ).toBe(false);
  });

  it("probes the exact production KeyValueStore and rejects a generic one", () => {
    const productionResource =
      `arn:aws:cloudfront::${accountId}:key-value-store/production-router`;
    const productionPolicy = {
      Statement: [{
        ...expectedStatement,
        Resource: productionResource,
      }],
    };

    expect(
      cloudFrontKeyValueStoreSimulationTargets(
        productionPolicy,
        accountId,
        "production",
      ),
    ).toEqual({
      allowedArn: productionResource,
      deniedAccountLocalArn:
        `arn:aws:cloudfront::${accountId}:key-value-store/auditflow-policy-probe`,
    });
  });

  it("fails above the ILS ceiling or when automatic actions exist", () => {
    expect(() =>
      validateProductionBudgetReadback({ ...input, rate: "5.1" }),
    ).toThrow("exceeds the ILS ceiling");
    expect(() =>
      validateProductionBudgetReadback({ ...input, actions: [{}] }),
    ).toThrow("must not have automatic actions");
  });
});

describe("Router output verification", () => {
  const contract = { production: { customDomain: "app.ddcpa.co.il" } };

  it("accepts generated CloudFront production bootstrap URLs", () => {
    expect(
      validateRouterOutputs(contract, "production", {
        routerUrl: "https://d123.cloudfront.net",
        customDomain: "",
      }).hostname,
    ).toBe("d123.cloudfront.net");
  });

  it("accepts the exact configured production domain", () => {
    expect(
      validateRouterOutputs(contract, "production", {
        routerUrl: "https://app.ddcpa.co.il",
        customDomain: "app.ddcpa.co.il",
      }).hostname,
    ).toBe("app.ddcpa.co.il");
  });

  it("rejects mismatched production domain outputs", () => {
    expect(() =>
      validateRouterOutputs(contract, "production", {
        routerUrl: "https://other.example.com",
        customDomain: "other.example.com",
      }),
    ).toThrow("custom-domain output is invalid");
  });
});

describe("live S3 notification verification", () => {
  it("normalizes AWS CLI filter-rule names without changing their values", () => {
    expect(
      notificationFilterRulesByName([
        { Name: "Prefix", Value: "zip-jobs/requests/" },
        { Name: "Suffix", Value: ".json" },
      ]),
    ).toEqual({
      prefix: "zip-jobs/requests/",
      suffix: ".json",
    });
  });
});

describe("live PDF API CORS verification", () => {
  it("accepts absent or empty API Gateway CORS and rejects configured values", () => {
    expect(hasApiGatewayCorsConfiguration(undefined)).toBe(false);
    expect(hasApiGatewayCorsConfiguration({})).toBe(false);
    expect(
      hasApiGatewayCorsConfiguration({ AllowOrigins: ["https://example.com"] }),
    ).toBe(true);
  });
});

describe("live PDF API route verification", () => {
  const routes = [
    {
      AuthorizationType: "NONE",
      RouteKey: "GET /health",
      Target: "integrations/health",
    },
    {
      AuthorizationType: "NONE",
      RouteKey: "POST /generate-pdf",
      Target: "integrations/generate",
    },
  ];
  const integration = (IntegrationId, functionName = "pdf-function") => ({
    IntegrationId,
    IntegrationMethod: "POST",
    IntegrationType: "AWS_PROXY",
    IntegrationUri: `arn:aws:lambda:region:account:function:${functionName}`,
    PayloadFormatVersion: "2.0",
  });

  it("accepts distinct integrations that resolve to the same public Lambda", () => {
    expect(
      pdfRoutesTargetSingleFunction(
        routes,
        [integration("health"), integration("generate")],
        "pdf-function",
      ),
    ).toBe(true);
  });

  it("rejects a route integration targeting another Lambda", () => {
    expect(
      pdfRoutesTargetSingleFunction(
        routes,
        [integration("health"), integration("generate", "other-function")],
        "pdf-function",
      ),
    ).toBe(false);
  });
});

describe("AWS CLI retry handling", () => {
  it.each([
    "aws: [ERROR]: Connect timeout on endpoint URL: https://cognito-idp.example.com/",
    "Could not connect to the endpoint URL: https://iam.example.com/",
    "An error occurred (ThrottlingException) when calling the DescribeUserPoolDomain operation: slow down",
  ])("recognizes a transient failure: %s", (stderr) => {
    expect(isRetryableAwsCliFailure({ status: 1, stderr })).toBe(true);
  });

  it("does not retry authorization failures", () => {
    const result = {
      status: 1,
      stderr:
        "An error occurred (AccessDeniedException) when calling the DescribeUserPoolDomain operation: denied",
    };

    expect(isRetryableAwsCliFailure(result)).toBe(false);
  });

  it("retries transient failures with bounded backoff", () => {
    const execute = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stderr: "Connect timeout" })
      .mockReturnValueOnce({ status: 1, stderr: "Read timeout" })
      .mockReturnValueOnce({ status: 0, stdout: "{}", stderr: "" });
    const wait = vi.fn();

    const result = retryAwsCliCommand(execute, {
      maxAttempts: 3,
      delayMilliseconds: 10,
      wait,
    });

    expect(result.status).toBe(0);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[10], [20]]);
  });
});

describe("live S3 CORS verification", () => {
  it("accepts only the exact missing-CORS AWS error", () => {
    const stderr =
      "An error occurred (NoSuchCORSConfiguration) when calling the GetBucketCors operation: The CORS configuration does not exist";

    expect(parseAwsCliErrorCode(stderr)).toBe("NoSuchCORSConfiguration");
    expect(() =>
      assertBrowserCorsAbsent({ ok: false, stderr }, "FilesBucket"),
    ).not.toThrow();
  });

  it.each(["AccessDenied", "ThrottlingException", "PermanentRedirect"])(
    "rejects %s instead of treating it as privacy evidence",
    (errorCode) => {
      const stderr = `An error occurred (${errorCode}) when calling the GetBucketCors operation: failure`;

      expect(() =>
        assertBrowserCorsAbsent({ ok: false, stderr }, "FilesBucket"),
      ).toThrow(`CORS verification failed with ${errorCode}`);
    },
  );

  it("rejects a successful response because CORS exists", () => {
    expect(() =>
      assertBrowserCorsAbsent({ ok: true, value: {} }, "FilesBucket"),
    ).toThrow("unexpectedly has browser CORS configured");
  });

  it("accepts only the exact FilesBucket direct-upload rule", () => {
    const contract = {
      allowHeaders: ["content-type", "x-amz-meta-purpose"],
      allowMethods: ["PUT", "HEAD"],
      exposeHeaders: ["etag"],
    };
    const result = {
      ok: true,
      value: {
        CORSRules: [
          {
            AllowedHeaders: ["x-amz-meta-purpose", "content-type"],
            AllowedMethods: ["HEAD", "PUT"],
            AllowedOrigins: ["http://localhost:5173", "https://example.cloudfront.net"],
            ExposeHeaders: ["etag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    };

    expect(() =>
      assertBrowserCorsExact(
        result,
        "FilesBucket",
        ["https://example.cloudfront.net", "http://localhost:5173"],
        contract,
      ),
    ).not.toThrow();
    expect(() =>
      assertBrowserCorsExact(
        result,
        "FilesBucket",
        ["*"],
        contract,
      ),
    ).toThrow("browser CORS configuration has drifted");
  });
});
