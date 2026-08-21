import { describe, expect, it } from "vitest";

import {
  assertBrowserCorsAbsent,
  parseAwsCliErrorCode,
} from "../../../tooling/verify_sst_foundation.mjs";

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
