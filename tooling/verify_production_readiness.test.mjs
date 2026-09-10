import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyContract, verifyEvidence } from "./verify_production_readiness.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const roots = [];

function contractFixture() {
  const root = mkdtempSync(join(tmpdir(), "auditflow-readiness-"));
  roots.push(root);
  for (const directory of ["tooling", "src", "infra/sst", "docs/migration", ".github/workflows", "e2e"]) mkdirSync(join(root, directory), { recursive: true });
  for (const path of [
    "tooling/production-readiness-contract.json",
    "src/App.jsx",
    "infra/sst/foundation-contract.json",
    "docs/migration/private-file-import-verification.json",
    "docs/migration/base44-reverse-replay-verification.json",
    "docs/migration/pdf-parity-evidence.json",
    "docs/migration/production-readiness-evidence.json",
    "docs/migration/production-readiness-runbook.md",
    "package.json",
    ".github/workflows/deploy-sst-production.yml",
    "e2e/public-questionnaire.spec.js",
    "e2e/cpa-workflows.spec.js",
    "e2e/pdf-signing.spec.js",
    "e2e/permissions-deferred-maintenance.spec.js",
  ]) cpSync(join(repositoryRoot, path), join(root, path));
  return root;
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe("production readiness verifier", () => {
  it("validates the current code-derived contract and migration evidence", () => {
    expect(verifyContract()).toMatchObject({ status: "passed", frontendRouteCount: 17, apiRouteCount: 47, journeyCount: 15 });
  });

  it("fails when a reachable frontend route drifts", () => {
    const root = contractFixture();
    writeFileSync(join(root, "src/App.jsx"), `${readFileSync(join(root, "src/App.jsx"), "utf8")}\n<Route path="/new" />`);
    expect(() => verifyContract({ root })).toThrow("Frontend route inventory drifted");
  });

  it("fails when reconciliation evidence contains an unresolved reference", () => {
    const root = contractFixture();
    const path = join(root, "docs/migration/private-file-import-verification.json");
    const evidence = JSON.parse(readFileSync(path, "utf8"));
    evidence.totals.unresolvedReferenceCount = 1;
    writeFileSync(path, JSON.stringify(evidence));
    expect(() => verifyContract({ root })).toThrow("reference reconciliation");
  });

  it("accepts only a signed, passing, privacy-safe evidence document", () => {
    const root = contractFixture();
    const path = join(root, "evidence.json");
    writeFileSync(path, JSON.stringify({
      schemaVersion: 1,
      artifactType: "PRODUCTION_READINESS_EVIDENCE",
      status: "passed",
      gates: [{ id: "automated", status: "passed" }],
      waivers: [],
      sourceDigests: {},
      ownerSignoff: { decision: "go", signedAt: "2026-09-09T12:00:00+03:00" },
    }));
    expect(verifyEvidence({ root, evidencePath: "evidence.json" }).status).toBe("passed");
  });

  it.each([
    [{ status: "pending", ownerSignoff: undefined }, "has not passed"],
    [{ token: "secret" }, "Sensitive readiness evidence"],
    [{ waivers: [{ gate: "SECURITY", scope: "x", owner: "x", date: "x", reason: "x", nextAction: "x" }] }, "not allowed"],
  ])("fails closed for incomplete or unsafe evidence", (override, message) => {
    const root = contractFixture();
    writeFileSync(join(root, "evidence.json"), JSON.stringify({
      schemaVersion: 1,
      artifactType: "PRODUCTION_READINESS_EVIDENCE",
      status: "passed",
      gates: [{ id: "automated", status: "passed" }],
      waivers: [],
      sourceDigests: {},
      ownerSignoff: { decision: "go", signedAt: "2026-09-09T12:00:00+03:00" },
      ...override,
    }));
    expect(() => verifyEvidence({ root, evidencePath: "evidence.json" })).toThrow(message);
  });
});
