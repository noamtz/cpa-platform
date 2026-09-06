import { describe, expect, it } from "vitest";

import { resolveLegacyFileRuntimeConfig } from "../core/runtime-config";

describe("legacy file runtime configuration", () => {
  it.each([undefined, "false"])("defaults %s to disabled without an attestation", (flag) => {
    expect(
      resolveLegacyFileRuntimeConfig({ LEGACY_FILE_READS_ENABLED: flag }),
    ).toEqual({ legacyFileReadsEnabled: false });
  });

  it("enables reads only with an exact manifest attestation", () => {
    const hash = "a".repeat(64);
    expect(
      resolveLegacyFileRuntimeConfig({
        LEGACY_FILE_READS_ENABLED: "true",
        LEGACY_FILE_IMPORT_MANIFEST_SHA256: hash,
      }),
    ).toEqual({
      legacyFileReadsEnabled: true,
      legacyFileImportManifestSha256: hash,
    });
  });

  it.each([
    { LEGACY_FILE_READS_ENABLED: "true" },
    { LEGACY_FILE_READS_ENABLED: "TRUE" },
    { LEGACY_FILE_READS_ENABLED: "1" },
    {
      LEGACY_FILE_READS_ENABLED: "true",
      LEGACY_FILE_IMPORT_MANIFEST_SHA256: "A".repeat(64),
    },
    {
      LEGACY_FILE_READS_ENABLED: "false",
      LEGACY_FILE_IMPORT_MANIFEST_SHA256: "a".repeat(64),
    },
  ])("fails closed for malformed or partially bound state", (environment) => {
    expect(() => resolveLegacyFileRuntimeConfig(environment)).toThrow(
      /Legacy file runtime configuration/,
    );
  });
});
