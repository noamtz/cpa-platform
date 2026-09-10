import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function collectSensitiveKeys(value, forbidden, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...collectSensitiveKeys(entry, forbidden, `${path}[${index}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (forbidden.has(key.toLowerCase())) findings.push(`${path}.${key}`);
      findings.push(...collectSensitiveKeys(entry, forbidden, `${path}.${key}`));
    }
  }
  return findings;
}

export function verifyContract({ root = repositoryRoot } = {}) {
  const contractPath = resolve(root, "tooling/production-readiness-contract.json");
  const appPath = resolve(root, "src/App.jsx");
  const foundationPath = resolve(root, "infra/sst/foundation-contract.json");
  const importEvidencePath = resolve(root, "docs/migration/private-file-import-verification.json");
  const replayEvidencePath = resolve(root, "docs/migration/base44-reverse-replay-verification.json");
  const pdfEvidencePath = resolve(root, "docs/migration/pdf-parity-evidence.json");
  const readinessEvidencePath = resolve(root, "docs/migration/production-readiness-evidence.json");
  const runbookPath = resolve(root, "docs/migration/production-readiness-runbook.md");
  const packagePath = resolve(root, "package.json");
  const productionWorkflowPath = resolve(root, ".github/workflows/deploy-sst-production.yml");
  const e2ePaths = [
    "e2e/public-questionnaire.spec.js",
    "e2e/cpa-workflows.spec.js",
    "e2e/pdf-signing.spec.js",
    "e2e/permissions-deferred-maintenance.spec.js",
  ].map((path) => resolve(root, path));
  for (const path of [
    contractPath,
    appPath,
    foundationPath,
    importEvidencePath,
    replayEvidencePath,
    pdfEvidencePath,
    readinessEvidencePath,
    runbookPath,
    packagePath,
    productionWorkflowPath,
    ...e2ePaths,
  ]) {
    assert(existsSync(path), `Required readiness input is missing: ${path}`);
  }

  const contract = readJson(contractPath);
  assert(contract.schemaVersion === 1 && contract.issue === 14, "Unsupported readiness contract.");
  const routeMatches = [...readFileSync(appPath, "utf8").matchAll(/<Route\s+path=["']([^"']+)["']/gu)];
  const actualFrontendRoutes = sorted(routeMatches.map((match) => match[1]));
  const expectedFrontendRoutes = sorted(contract.frontendRoutes.map(({ path }) => path));
  assert(JSON.stringify(actualFrontendRoutes) === JSON.stringify(expectedFrontendRoutes), "Frontend route inventory drifted.");

  const foundation = readJson(foundationPath);
  assert(Array.isArray(foundation.routes) && foundation.routes.length > 0, "Foundation API route inventory is empty.");
  assert(new Set(foundation.routes.map(({ route }) => route)).size === foundation.routes.length, "Duplicate API route contract.");

  const journeyIds = contract.journeys.map(({ id }) => id);
  assert(journeyIds.length >= 15 && new Set(journeyIds).size === journeyIds.length, "Readiness journeys are missing or duplicated.");
  for (const journey of contract.journeys) {
    assert(journey.source && journey.reachability, `Journey ${journey.id} lacks source or reachability.`);
    assert(journey.positiveCases.length > 0, `Journey ${journey.id} lacks a positive case.`);
    assert(journey.negativeCases.length > 0, `Journey ${journey.id} lacks a negative case.`);
    assert(journey.automatedEvidence.length > 0, `Journey ${journey.id} lacks automated evidence.`);
  }

  const importEvidence = readJson(importEvidencePath);
  assert(importEvidence.schemaVersion === 3 && importEvidence.stage === "test" && importEvidence.status === "verified", "Import evidence is not verified test evidence.");
  assert(importEvidence.totals.sourceRecordCount === 366 && importEvidence.totals.importedRecordCount === 366, "Import record totals drifted.");
  assert(importEvidence.totals.referenceCount === 687 && importEvidence.totals.unresolvedReferenceCount === 0, "Import reference reconciliation failed.");
  assert(Object.values(importEvidence.gates).every(Boolean), "An import reconciliation gate is false.");

  const replayEvidence = readJson(replayEvidencePath);
  assert(replayEvidence.schemaVersion === 1 && replayEvidence.stage === "test" && replayEvidence.status === "passed", "Reverse replay evidence is not passing test evidence.");
  assert(replayEvidence.gates.exactRangeBound && replayEvidence.gates.interruptionResumed && replayEvidence.gates.productionUntouched && replayEvidence.gates.zeroDrift, "Reverse replay gates failed.");
  assert(replayEvidence.totals.blockerCount === 0 && replayEvidence.totals.zeroWriteRerun, "Reverse replay totals failed.");

  const pdfEvidence = readJson(pdfEvidencePath);
  assert(
    pdfEvidence.schemaVersion === 1 &&
      pdfEvidence.fixture === "synthetic-rtl-multipage" &&
      pdfEvidence.passed === true &&
      Object.values(pdfEvidence.probes ?? {}).every(({ passed }) => passed) &&
      (pdfEvidence.comparisons ?? []).every(
        ({ render, generate }) => render?.bytes?.passed && render?.visual?.passed && generate?.bytes?.passed && generate?.visual?.passed,
      ),
    "PDF parity evidence is not passing.",
  );

  const readinessEvidence = readJson(readinessEvidencePath);
  assert(
    readinessEvidence.schemaVersion === 1 &&
      readinessEvidence.artifactType === "PRODUCTION_READINESS_EVIDENCE" &&
      ["pending", "passed", "failed"].includes(readinessEvidence.status) &&
      Array.isArray(readinessEvidence.gates),
    "Readiness evidence schema has drifted.",
  );
  const forbidden = new Set(contract.forbiddenEvidenceKeys.map((key) => key.toLowerCase()));
  assert(
    collectSensitiveKeys(readinessEvidence, forbidden).length === 0,
    "Readiness evidence contains a forbidden key.",
  );

  const packageJson = readJson(packagePath);
  for (const script of ["verify:runtime-independence", "verify:readiness", "test:e2e:read-only", "test:e2e"]) {
    assert(packageJson.scripts?.[script], `Missing package script: ${script}`);
  }

  const workflow = readFileSync(productionWorkflowPath, "utf8");
  assert(
    workflow.includes("workflow_dispatch:") &&
      !/^\s*push:/mu.test(workflow) &&
      !/^\s*pull_request:/mu.test(workflow) &&
      workflow.includes("environment: production") &&
      workflow.includes("id-token: write") &&
      workflow.includes("node-version: 20.17.0") &&
      workflow.includes("PREPARE EMPTY PRODUCTION") &&
      workflow.includes("AUDITFLOW_ENABLE_LEGACY_FILE_READS: \"false\"") &&
      workflow.includes("--mode deployer --stage production") &&
      workflow.includes("--mode live") &&
      workflow.includes("--stage production"),
    "Production workflow is not manual, protected, or fail-closed.",
  );

  const runbook = readFileSync(runbookPath, "utf8");
  for (const marker of ["0h", "1h", "6h", "12h", "24h", "48h", "72h", "issue #15", "ILS 50", "legacy reads disabled"]) {
    assert(runbook.includes(marker), `Production runbook is missing: ${marker}`);
  }

  return {
    schemaVersion: 1,
    mode: "contract",
    status: "passed",
    frontendRouteCount: actualFrontendRoutes.length,
    apiRouteCount: foundation.routes.length,
    journeyCount: contract.journeys.length,
    evidence: {
      importSha256: sha256(importEvidencePath),
      replaySha256: sha256(replayEvidencePath),
      pdfSha256: sha256(pdfEvidencePath),
    },
  };
}

export function verifyEvidence({ evidencePath, root = repositoryRoot }) {
  const contract = readJson(resolve(root, "tooling/production-readiness-contract.json"));
  const evidence = readJson(resolve(root, evidencePath));
  assert(evidence.schemaVersion === 1 && evidence.artifactType === "PRODUCTION_READINESS_EVIDENCE", "Unsupported readiness evidence.");
  const forbidden = new Set(contract.forbiddenEvidenceKeys.map((key) => key.toLowerCase()));
  const sensitiveKeys = collectSensitiveKeys(evidence, forbidden);
  assert(sensitiveKeys.length === 0, `Sensitive readiness evidence keys: ${sensitiveKeys.join(", ")}`);
  assert(evidence.status === "passed", "Readiness evidence has not passed.");
  assert(evidence.ownerSignoff?.decision === "go" && evidence.ownerSignoff?.signedAt, "Explicit owner go sign-off is missing.");
  assert(Array.isArray(evidence.gates) && evidence.gates.length > 0 && evidence.gates.every(({ status }) => status === "passed" || status === "waived"), "Readiness gates are incomplete.");
  for (const waiver of evidence.waivers ?? []) {
    assert(contract.allowedWaiverGates.includes(waiver.gate), `Waiver is not allowed: ${waiver.gate}`);
    for (const field of ["scope", "owner", "date", "reason", "nextAction"]) assert(waiver[field], `Waiver ${waiver.gate} is incomplete.`);
  }
  for (const [path, expected] of Object.entries(evidence.sourceDigests ?? {})) {
    const absolute = resolve(root, path);
    assert(existsSync(absolute) && sha256(absolute) === expected, `Readiness source digest drifted: ${path}`);
  }
  return { schemaVersion: 1, mode: "evidence", status: "passed", gateCount: evidence.gates.length, waiverCount: (evidence.waivers ?? []).length };
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || !["--mode", "--evidence"].includes(key)) fail(`Expected --mode/--evidence value pairs.`);
    result[key.slice(2)] = value;
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    assert(["contract", "evidence"].includes(arguments_.mode), "Invalid readiness mode.");
    const result = arguments_.mode === "contract"
      ? verifyContract()
      : verifyEvidence({ evidencePath: arguments_.evidence ?? "docs/migration/production-readiness-evidence.json" });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
