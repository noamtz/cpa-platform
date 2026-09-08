import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  installCompatibility,
  loadInstallerTarget,
} from "./install_base44_rollback_compat.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const entities = [
  "Client",
  "Submission",
  "QuestionnaireTemplate",
  "PdfTemplate",
  "SyncedDriveFile",
];
const functions = [
  "getClientByToken",
  "updateClientSubmission",
  "uploadFile",
  "getSignedPdfUrl",
  "getTemplateFileUrl",
];

function cloneFixture() {
  const root = mkdtempSync(join(tmpdir(), "auditflow-rollback-compat-test-"));
  mkdirSync(join(root, "base44"), { recursive: true });
  writeFileSync(
    join(root, "base44", "config.jsonc"),
    JSON.stringify({ name: "AuditFlow Rollback Rehearsal" }),
  );
  writeFileSync(
    join(root, "base44", ".app.jsonc"),
    '// protected local binding\n{ "id": "synthetic-app" }\n',
  );
  for (const name of entities) {
    const target = join(root, "base44", "entities", `${name}.jsonc`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      readFileSync(join(repositoryRoot, "base44", "entities", `${name}.jsonc`), "utf8"),
    );
  }
  for (const name of functions) {
    const target = join(root, "base44", "functions", name, "entry.ts");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
      target,
      readFileSync(
        join(repositoryRoot, "base44", "functions", name, "entry.ts"),
        "utf8",
      ),
    );
  }
  return root;
}

describe("Base44 rollback compatibility installer", () => {
  it("adds source aliases and idempotent public-link resolution", () => {
    const root = cloneFixture();
    expect(installCompatibility(root)).toMatchObject({
      status: "checked",
      changedEntities: 5,
      changedFunctions: 5,
      compatible: false,
    });
    expect(installCompatibility(root, { apply: true })).toMatchObject({
      status: "applied",
      changedEntities: 5,
      changedFunctions: 5,
    });
    expect(installCompatibility(root)).toMatchObject({
      status: "checked",
      changedEntities: 0,
      changedFunctions: 0,
      compatible: true,
    });

    for (const name of entities) {
      const schema = JSON.parse(
        readFileSync(join(root, "base44", "entities", `${name}.jsonc`), "utf8"),
      );
      expect(schema.properties).toHaveProperty("auditflow_source_id");
      expect(schema.properties).toHaveProperty("auditflow_source_created_date");
      expect(schema.properties).toHaveProperty("auditflow_source_updated_date");
    }
    for (const name of functions) {
      const functionRoot = join(root, "base44", "functions", name);
      const source = readFileSync(join(functionRoot, "entry.ts"), "utf8");
      expect(source).toContain("resolveClientByLink");
      expect(source).not.toContain("entities.Client.filter({ id:");
      expect(readFileSync(join(functionRoot, "resolveClientByLink.ts"), "utf8")).toContain(
        "auditflow_source_id",
      );
    }
  });

  it("rejects a clone inside the repository", () => {
    expect(() => installCompatibility(repositoryRoot)).toThrowError(
      expect.objectContaining({ category: "rollback_compat_clone_invalid" }),
    );
  });

  it("binds the protected descriptor to the exact private clone app", () => {
    const root = cloneFixture();
    const descriptorPath = join(root, "target.json");
    const descriptor = {
      production: false,
      purpose: "rollback-replay-rehearsal",
      base44: {
        visibility: "private",
        credential_provider: "base44-cli-authenticated-profile",
        app_id: "synthetic-app",
      },
      local_paths: { clone_root: root },
    };
    writeFileSync(descriptorPath, JSON.stringify(descriptor));
    expect(loadInstallerTarget(descriptorPath)).toMatchObject({ cloneRoot: root });

    writeFileSync(
      descriptorPath,
      JSON.stringify({
        ...descriptor,
        base44: { ...descriptor.base44, app_id: "different-app" },
      }),
    );
    expect(() => loadInstallerTarget(descriptorPath)).toThrowError(
      expect.objectContaining({ category: "rollback_compat_target_forbidden" }),
    );
  });
});
