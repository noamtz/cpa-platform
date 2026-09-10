import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { verifyContract, verifyEvidence } from "./verify_production_readiness.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const roots = [];
const candidateCommit = "a".repeat(40);

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

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

function passingEvidence(root) {
  const contract = JSON.parse(readFileSync(join(root, "tooling/production-readiness-contract.json"), "utf8"));
  const artifactDirectory = join(root, "artifacts");
  mkdirSync(artifactDirectory, { recursive: true });
  const artifactDigests = {};
  for (const group of contract.requiredArtifactDigestGroups) {
    const relativePath = `artifacts/${group}.txt`;
    writeFileSync(join(root, relativePath), `${group} candidate artifact`);
    artifactDigests[group] = [{ path: relativePath, sha256: sha256(join(root, relativePath)) }];
  }
  return {
    schemaVersion: 1,
    artifactType: "PRODUCTION_READINESS_EVIDENCE",
    status: "passed",
    candidate: {
      commit: candidateCommit,
      builtAt: "2026-09-09T11:30:00+03:00",
      nodeVersion: "20.17.0",
    },
    gates: contract.requiredGateIds.map((id) => ({ id, status: "passed" })),
    waivers: [],
    sourceDigests: Object.fromEntries(
      contract.requiredEvidence.map((path) => [path, sha256(join(root, path))]),
    ),
    artifactDigests,
    ownerSignoff: { decision: "go", signedAt: "2026-09-09T12:00:00+03:00" },
  };
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

  it("fails when the production workflow cannot inspect Environment protection", () => {
    const root = contractFixture();
    const path = join(root, ".github/workflows/deploy-sst-production.yml");
    const workflow = readFileSync(path, "utf8");
    const workflowWithoutActionsRead = workflow.replace(/ {2}actions: read\r?\n/u, "");
    expect(workflowWithoutActionsRead).not.toBe(workflow);
    writeFileSync(path, workflowWithoutActionsRead);
    expect(() => verifyContract({ root })).toThrow("Production workflow is not manual, protected, or fail-closed");
  });

  it("accepts only a signed, passing, privacy-safe evidence document", () => {
    const root = contractFixture();
    const path = join(root, "evidence.json");
    writeFileSync(path, JSON.stringify(passingEvidence(root)));
    expect(verifyEvidence({ root, evidencePath: "evidence.json", candidateCommit }).status).toBe("passed");
  });

  it.each([
    [{ status: "pending", ownerSignoff: undefined }, "has not passed"],
    [{ token: "secret" }, "Sensitive readiness evidence"],
    [{ waivers: [{ gate: "SECURITY" }] }, "not allowed"],
  ])("fails closed for incomplete or unsafe evidence", (override, message) => {
    const root = contractFixture();
    const evidence = { ...passingEvidence(root), ...override };
    writeFileSync(join(root, "evidence.json"), JSON.stringify({
      ...evidence,
    }));
    expect(() => verifyEvidence({ root, evidencePath: "evidence.json", candidateCommit })).toThrow(message);
  });

  it("requires the exact gate set and candidate commit", () => {
    const root = contractFixture();
    const evidence = passingEvidence(root);
    evidence.gates.pop();
    writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence));
    expect(() => verifyEvidence({ root, evidencePath: "evidence.json", candidateCommit })).toThrow(
      "required gate set",
    );

    evidence.gates = passingEvidence(root).gates;
    evidence.candidate.commit = "b".repeat(40);
    writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence));
    expect(() => verifyEvidence({ root, evidencePath: "evidence.json", candidateCommit })).toThrow(
      "candidate is missing, stale, or invalid",
    );
  });

  it("requires every source and runtime artifact digest and reads each file back", () => {
    const root = contractFixture();
    const evidence = passingEvidence(root);
    delete evidence.sourceDigests["docs/migration/pdf-parity-evidence.json"];
    writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence));
    expect(() => verifyEvidence({ root, evidencePath: "evidence.json", candidateCommit })).toThrow(
      "required evidence set",
    );

    const complete = passingEvidence(root);
    complete.artifactDigests.pdfRenderer[0].sha256 = "0".repeat(64);
    writeFileSync(join(root, "evidence.json"), JSON.stringify(complete));
    expect(() => verifyEvidence({ root, evidencePath: "evidence.json", candidateCommit })).toThrow(
      "artifact pdfRenderer digest drifted",
    );
  });

  it("requires each waived aggregate gate to have a complete allowed waiver", () => {
    const root = contractFixture();
    const evidence = passingEvidence(root);
    evidence.gates.find(({ id }) => id === "OBSERVABILITY").status = "waived";
    writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence));
    expect(() => verifyEvidence({ root, evidencePath: "evidence.json", candidateCommit })).toThrow(
      "lacks an approved waiver",
    );

    evidence.waivers = [{
      gate: "OWNER_SENTRY_OBSERVATION",
      appliesTo: "OBSERVABILITY",
      scope: "Sentry console observation only",
      owner: "owner",
      date: "2026-09-09",
      reason: "console unavailable",
      expiresAt: "2026-09-16",
      nextAction: "repeat observation",
    }];
    writeFileSync(join(root, "evidence.json"), JSON.stringify(evidence));
    expect(verifyEvidence({ root, evidencePath: "evidence.json", candidateCommit }).waiverCount).toBe(1);
  });
});
