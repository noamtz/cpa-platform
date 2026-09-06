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
  const hash = "a".repeat(64);
  return {
    schemaVersion: 3,
    artifactType: "PRIVATE_FILE_IMPORT_VERIFICATION",
    stage: "test",
    status: "verified",
    resolverContract: "legacy-reference-sha256-v2",
    importToolVersion: "1.1.0",
    sourceSnapshotCompletedAt: "2026-08-25T00:00:00.000Z",
    verifiedAt: "2026-09-06T00:00:00.000Z",
    sourceManifestSha256: hash,
    entities: Object.fromEntries(
      ["Client", "Submission", "QuestionnaireTemplate", "PdfTemplate", "SyncedDriveFile", "User"].map(
        (name) => [name, { count: 1, aggregateSha256: hash }],
      ),
    ),
    totals: {
      sourceRecordCount: 6,
      importedRecordCount: 6,
      derivedPlaceholderClientCount: 0,
      resolvedDuplicateActiveSubmissionCount: 0,
      derivedGuardCount: 2,
      nonImportedTargetRecordCount: 0,
      referenceCount: 687,
      referenceObjectCount: 687,
      referenceBindingCount: 800,
      uniqueContentCount: 622,
      referenceObjectBytes: 172_000_000,
      uniqueContentBytes: 171_488_658,
      unresolvedReferenceCount: 0,
    },
    gates: {
      sourceVerified: true,
      recordsReconciled: true,
      relationshipsValid: true,
      guardsReconciled: true,
      filesReconciled: true,
      syntheticSeparated: true,
      privacySafe: true,
    },
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
    expect(validatePrivateFileCutoverEvidence(validEvidence(), "test", {
      now: Date.parse("2026-09-06T01:00:00.000Z"),
    })).toEqual(
      expect.objectContaining({
        ready: true,
        stage: "test",
        referenceCount: 687,
        referenceObjectCount: 687,
      }),
    );
    expect(
      validatePrivateFileCutoverEvidence(
        validEvidence({
          totals: {
            ...validEvidence().totals,
            unresolvedReferenceCount: 1,
          },
        }),
        "test",
        { now: Date.parse("2026-09-06T01:00:00.000Z") },
      ),
    ).toEqual({ ready: false, reason: "invalid_evidence" });
    expect(
      validatePrivateFileCutoverEvidence(validEvidence(), "production", {
        now: Date.parse("2026-09-06T01:00:00.000Z"),
      }),
    ).toEqual({ ready: false, reason: "invalid_evidence" });
    expect(
      validatePrivateFileCutoverEvidence(
        { ...validEvidence(), unexpected: true },
        "test",
        { now: Date.parse("2026-09-06T01:00:00.000Z") },
      ),
    ).toEqual({ ready: false, reason: "invalid_evidence" });
    expect(
      validatePrivateFileCutoverEvidence(validEvidence(), "test", {
        now: Date.parse("2026-09-10T01:00:00.000Z"),
      }),
    ).toEqual({ ready: false, reason: "stale_evidence" });
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

    expect(checkPrivateFileCutover({
      stage: "test",
      root,
      now: Date.parse("2026-09-06T01:00:00.000Z"),
    })).toMatchObject({
      ready: true,
      referenceCount: 687,
      referenceObjectCount: 687,
    });
  });
});
