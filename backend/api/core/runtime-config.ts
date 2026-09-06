const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface LegacyFileRuntimeEnvironment {
  readonly LEGACY_FILE_READS_ENABLED?: string;
  readonly LEGACY_FILE_IMPORT_MANIFEST_SHA256?: string;
}

export interface LegacyFileRuntimeConfig {
  readonly legacyFileReadsEnabled: boolean;
  readonly legacyFileImportManifestSha256?: string;
}

export function resolveLegacyFileRuntimeConfig(
  environment: LegacyFileRuntimeEnvironment =
    process.env as LegacyFileRuntimeEnvironment,
): LegacyFileRuntimeConfig {
  const requested = environment.LEGACY_FILE_READS_ENABLED;
  const manifestSha256 = environment.LEGACY_FILE_IMPORT_MANIFEST_SHA256;

  if (requested === undefined || requested === "false") {
    if (manifestSha256) {
      throw new Error("Legacy file runtime configuration is inconsistent");
    }
    return Object.freeze({ legacyFileReadsEnabled: false });
  }

  if (requested !== "true" || !manifestSha256 || !SHA256_PATTERN.test(manifestSha256)) {
    throw new Error("Legacy file runtime configuration is invalid");
  }

  return Object.freeze({
    legacyFileReadsEnabled: true,
    legacyFileImportManifestSha256: manifestSha256,
  });
}
