import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  checkPrivateFileCutover,
  validatePrivateFileCutoverEvidence,
} from "../../../tooling/verify_private_file_cutover.mjs";

const temporaryRoots = [];

function validEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    artifactType: "PRIVATE_FILE_IMPORT_VERIFICATION",
    stage: "test",
    status: "verified",
    resolverContract: "legacy-sha256-v1",
    verifiedAt: "2026-08-25T00:00:00.000Z",
    referenceCount: 687,
    copiedObjectCount: 622,
    unresolvedReferenceCount: 0,
    manifestSha256: "a".repeat(64),
    ...overrides,
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("private-file legacy-read enablement gate", () => {
  it("blocks legacy reads when issue #11 evidence is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "auditflow-cutover-"));
    temporaryRoots.push(root);

    expect(checkPrivateFileCutover({ stage: "test", root })).toEqual({
      ready: false,
      reason: "missing_evidence",
    });
  });

  it("accepts only complete stage-matched import evidence", () => {
    expect(validatePrivateFileCutoverEvidence(validEvidence(), "test")).toEqual(
      expect.objectContaining({
        ready: true,
        stage: "test",
        referenceCount: 687,
        copiedObjectCount: 622,
      }),
    );
    expect(
      validatePrivateFileCutoverEvidence(
        validEvidence({ unresolvedReferenceCount: 1 }),
        "test",
      ),
    ).toEqual({ ready: false, reason: "invalid_evidence" });
    expect(
      validatePrivateFileCutoverEvidence(validEvidence(), "production"),
    ).toEqual({ ready: false, reason: "invalid_evidence" });
  });

  it("reads the bounded aggregate artifact without requiring private references", () => {
    const root = mkdtempSync(join(tmpdir(), "auditflow-cutover-"));
    temporaryRoots.push(root);
    const evidenceDirectory = join(root, "docs", "migration");
    mkdirSync(evidenceDirectory, { recursive: true });
    writeFileSync(
      join(evidenceDirectory, "private-file-import-verification.json"),
      JSON.stringify(validEvidence()),
      "utf8",
    );

    expect(checkPrivateFileCutover({ stage: "test", root })).toMatchObject({
      ready: true,
      referenceCount: 687,
      copiedObjectCount: 622,
    });
  });
});
