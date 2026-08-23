import { describe, expect, it, vi } from "vitest";

import {
  assertBrowserCorsAbsent,
  isRetryableAwsCliFailure,
  parseAwsCliErrorCode,
  retryAwsCliCommand,
} from "../../../tooling/verify_sst_foundation.mjs";

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
});
