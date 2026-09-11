// The verifier is intentionally dependency-free so the SST config and operator CLI share one evidence parser.
// @ts-expect-error The checked JavaScript module is outside the foundation TypeScript include set.
import { checkPrivateFileCutover } from "../../tooling/verify_private_file_cutover.mjs";

import type { StageName } from "./stage";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface PrivateFileCutoverInput {
  readonly stage: StageName;
  readonly requested?: string;
  readonly expectedManifestSha256?: string;
  readonly repositoryRoot?: string;
  readonly evidencePath?: string;
  readonly now?: number;
}

export interface PrivateFileCutoverSettings {
  readonly enabled: "true" | "false";
  readonly manifestSha256: string;
}

export function resolvePrivateFileCutover({
  stage,
  requested,
  expectedManifestSha256,
  repositoryRoot,
  evidencePath,
  now,
}: PrivateFileCutoverInput): PrivateFileCutoverSettings {
  if (requested === undefined || requested === "false") {
    if (expectedManifestSha256) {
      throw new Error("Disabled legacy file reads cannot carry a manifest hash.");
    }
    return Object.freeze({ enabled: "false", manifestSha256: "" });
  }
  if (requested !== "true") {
    throw new Error("AUDITFLOW_ENABLE_LEGACY_FILE_READS must be true or false.");
  }
  if (stage !== "test") {
    throw new Error("Legacy file reads may be enabled only in the test stage.");
  }
  if (!expectedManifestSha256 || !SHA256_PATTERN.test(expectedManifestSha256)) {
    throw new Error("Legacy file enablement requires an exact expected manifest SHA-256.");
  }

  const evidence = checkPrivateFileCutover({
    stage,
    requireFresh: false,
    ...(repositoryRoot ? { root: repositoryRoot } : {}),
    ...(evidencePath ? { evidencePath } : {}),
    ...(now === undefined ? {} : { now }),
  });
  if (!evidence.ready) {
    throw new Error(`Legacy file enablement is blocked (${evidence.reason}).`);
  }
  if (evidence.sourceManifestSha256 !== expectedManifestSha256) {
    throw new Error("Legacy file evidence does not match the expected manifest.");
  }
  return Object.freeze({
    enabled: "true",
    manifestSha256: expectedManifestSha256,
  });
}
