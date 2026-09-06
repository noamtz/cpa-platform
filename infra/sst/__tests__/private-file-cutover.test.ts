import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolvePrivateFileCutover } from "../private-file-cutover";

const roots: string[] = [];
const now = Date.parse("2026-09-06T01:00:00.000Z");
const manifestSha256 = "a".repeat(64);

function evidence() {
  return {
    schemaVersion: 3,
    artifactType: "PRIVATE_FILE_IMPORT_VERIFICATION",
    stage: "test",
    status: "verified",
    resolverContract: "legacy-reference-sha256-v2",
    importToolVersion: "1.1.0",
    sourceSnapshotCompletedAt: "2026-09-06T00:00:00.000Z",
    verifiedAt: "2026-09-06T00:30:00.000Z",
    sourceManifestSha256: manifestSha256,
    entities: Object.fromEntries(
      ["Client", "Submission", "QuestionnaireTemplate", "PdfTemplate", "SyncedDriveFile", "User"].map(
        (name) => [name, { count: 1, aggregateSha256: "b".repeat(64) }],
      ),
    ),
    totals: {
      sourceRecordCount: 6,
      importedRecordCount: 6,
      derivedPlaceholderClientCount: 0,
      resolvedDuplicateActiveSubmissionCount: 0,
      derivedGuardCount: 2,
      nonImportedTargetRecordCount: 0,
      referenceCount: 1,
      referenceObjectCount: 1,
      referenceBindingCount: 1,
      uniqueContentCount: 1,
      referenceObjectBytes: 1,
      uniqueContentBytes: 1,
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
  };
}

function evidenceRoot() {
  const root = mkdtempSync(join(tmpdir(), "auditflow-private-cutover-"));
  roots.push(root);
  const directory = join(root, "docs", "migration");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "private-file-import-verification.json"),
    `${JSON.stringify(evidence())}\n`,
    "utf8",
  );
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("private file cutover resolver", () => {
  it("stays disabled unless exact enablement is requested", () => {
    expect(resolvePrivateFileCutover({ stage: "test" })).toEqual({
      enabled: "false",
      manifestSha256: "",
    });
    expect(
      resolvePrivateFileCutover({ stage: "test", requested: "false" }),
    ).toEqual({ enabled: "false", manifestSha256: "" });
  });

  it("binds a test enablement to fresh stage-matched evidence", () => {
    expect(
      resolvePrivateFileCutover({
        stage: "test",
        requested: "true",
        expectedManifestSha256: manifestSha256,
        repositoryRoot: evidenceRoot(),
        now,
      }),
    ).toEqual({ enabled: "true", manifestSha256 });
  });

  it.each([
    { stage: "production" as const, requested: "true", expectedManifestSha256: manifestSha256 },
    { stage: "test" as const, requested: "TRUE", expectedManifestSha256: manifestSha256 },
    { stage: "test" as const, requested: "true" },
    { stage: "test" as const, requested: "false", expectedManifestSha256: manifestSha256 },
  ])("rejects malformed or unsafe requests", (input) => {
    expect(() => resolvePrivateFileCutover(input)).toThrow();
  });

  it("rejects missing or mismatched evidence", () => {
    const missingRoot = mkdtempSync(join(tmpdir(), "auditflow-private-cutover-"));
    roots.push(missingRoot);
    expect(() =>
      resolvePrivateFileCutover({
        stage: "test",
        requested: "true",
        expectedManifestSha256: manifestSha256,
        repositoryRoot: missingRoot,
        now,
      }),
    ).toThrow("missing_evidence");
    expect(() =>
      resolvePrivateFileCutover({
        stage: "test",
        requested: "true",
        expectedManifestSha256: "c".repeat(64),
        repositoryRoot: evidenceRoot(),
        now,
      }),
    ).toThrow("does not match");
  });
});
