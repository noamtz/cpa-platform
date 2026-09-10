import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

import { scanRuntimeIndependence } from "./verify_runtime_independence.mjs";

const roots = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "auditflow-runtime-audit-"));
  roots.push(root);
  writeFileSync(join(root, "package.json"), '{"name":"base44-app","dependencies":{}}');
  writeFileSync(join(root, "package-lock.json"), '{"name":"base44-app","packages":{}}');
  mkdirSync(join(root, "dist"));
  mkdirSync(join(root, "artifacts"));
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("runtime independence audit", () => {
  it("accepts local compatibility names without an external Base44 destination", async () => {
    const root = fixture();
    writeFileSync(join(root, "dist", "app.js"), "const base44 = createCompatibilityClient({ aws }); fetch('/api/health');");
    writeFileSync(join(root, "artifacts", "api.mjs"), "export const endpoint = '/api/apps/auditflow/functions/test';");

    const result = await scanRuntimeIndependence({ root, frontend: "dist", artifacts: "artifacts" });
    expect(result.status).toBe("passed");
    expect(result.scannedFileCount).toBe(4);
  });

  it.each([
    "import { createClient } from '@base44/sdk'",
    "fetch('https://api.base44.com/apps/example')",
    "const file = 'base44-storage://private/object'",
  ])("rejects forbidden runtime content: %s", async (content) => {
    const root = fixture();
    writeFileSync(join(root, "dist", "app.js"), content);
    writeFileSync(join(root, "artifacts", "api.mjs"), "export {};");
    const result = await scanRuntimeIndependence({ root, frontend: "dist", artifacts: "artifacts" });
    expect(result.status).toBe("failed");
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
  });

  it("inspects JavaScript inside Lambda zip artifacts", async () => {
    const root = fixture();
    writeFileSync(join(root, "dist", "app.js"), "export {};");
    const archive = new JSZip();
    archive.file("index.mjs", "import '@base44/sdk';");
    writeFileSync(join(root, "artifacts", "api.zip"), await archive.generateAsync({ type: "nodebuffer" }));

    const result = await scanRuntimeIndependence({ root, frontend: "dist", artifacts: "artifacts" });
    expect(result.status).toBe("failed");
    expect(result.findings[0].artifact).toContain("api.zip:index.mjs");
  });

  it("follows package shims whose symlink target stays inside the artifact root", async () => {
    const root = fixture();
    writeFileSync(join(root, "dist", "app.js"), "export {};");
    const packageDirectory = join(root, "artifacts", "node_modules", "color-support");
    const binDirectory = join(root, "artifacts", "node_modules", ".bin");
    mkdirSync(packageDirectory, { recursive: true });
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(join(packageDirectory, "bin.js"), "export {};");
    symlinkSync(join(packageDirectory, "bin.js"), join(binDirectory, "color-support"), "file");

    const result = await scanRuntimeIndependence({ root, frontend: "dist", artifacts: "artifacts" });
    expect(result.status).toBe("passed");
    expect(result.scanned.some(({ path }) => path.endsWith("node_modules/.bin/color-support"))).toBe(true);
  });

  it("rejects a package symlink whose target escapes the artifact root", async () => {
    const root = fixture();
    writeFileSync(join(root, "dist", "app.js"), "export {};");
    const external = join(root, "outside.js");
    const binDirectory = join(root, "artifacts", "node_modules", ".bin");
    mkdirSync(binDirectory, { recursive: true });
    writeFileSync(external, "export {};");
    symlinkSync(external, join(binDirectory, "outside"), "file");

    await expect(scanRuntimeIndependence({ root, frontend: "dist", artifacts: "artifacts" })).rejects.toThrow(
      "Unsafe or empty artifact path",
    );
  });

  it("fails when a requested runtime root is absent or empty", async () => {
    const root = fixture();
    await expect(scanRuntimeIndependence({ root, frontend: "missing" })).rejects.toThrow();
    await expect(scanRuntimeIndependence({ root, frontend: "dist" })).rejects.toThrow("empty");
  });
});
