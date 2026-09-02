import { describe, expect, it, vi } from "vitest";

import {
  assertBrowserCorsAbsent,
  assertBrowserCorsExact,
  hasApiGatewayCorsConfiguration,
  isRetryableAwsCliFailure,
  notificationFilterRulesByName,
  parseAwsCliErrorCode,
  pdfRoutesTargetSingleFunction,
  retryAwsCliCommand,
} from "../../../tooling/verify_sst_foundation.mjs";

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
