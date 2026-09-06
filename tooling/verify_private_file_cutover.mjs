import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

export const DEFAULT_PRIVATE_FILE_EVIDENCE_PATH =
  "docs/migration/private-file-import-verification.json";
export const PRIVATE_FILE_EVIDENCE_SCHEMA_VERSION = 2;
export const LEGACY_REFERENCE_RESOLVER_CONTRACT =
  "legacy-reference-sha256-v2";
export const MAX_EVIDENCE_AGE_MS = 72 * 60 * 60 * 1_000;
export const MAX_EVIDENCE_FUTURE_MS = 5 * 60 * 1_000;

const entityNames = [
  "Client",
  "Submission",
  "QuestionnaireTemplate",
  "PdfTemplate",
  "SyncedDriveFile",
  "User",
];
const totalNames = [
  "sourceRecordCount",
  "importedRecordCount",
  "derivedPlaceholderClientCount",
  "resolvedDuplicateActiveSubmissionCount",
  "derivedGuardCount",
  "nonImportedTargetRecordCount",
  "referenceCount",
  "referenceObjectCount",
  "uniqueContentCount",
  "referenceObjectBytes",
  "uniqueContentBytes",
  "unresolvedReferenceCount",
];
const gateNames = [
  "sourceVerified",
  "recordsReconciled",
  "relationshipsValid",
  "guardsReconciled",
  "filesReconciled",
  "syntheticSeparated",
  "privacySafe",
];
const topLevelNames = [
  "schemaVersion",
  "artifactType",
  "stage",
  "status",
  "resolverContract",
  "importToolVersion",
  "sourceSnapshotCompletedAt",
  "verifiedAt",
  "sourceManifestSha256",
  "entities",
  "totals",
  "gates",
];
const sha256Pattern = /^[a-f0-9]{64}$/;
const semverPattern = /^\d+\.\d+\.\d+$/;

function exactObject(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isSafeCount(value, { positive = false } = {}) {
  return Number.isSafeInteger(value) && (positive ? value > 0 : value >= 0);
}

export function validatePrivateFileCutoverEvidence(
  value,
  stage,
  { now = Date.now(), requireFresh = true } = {},
) {
  if (!exactObject(value, topLevelNames)) {
    return { ready: false, reason: "invalid_evidence" };
  }
  const evidence = value;
  if (
    evidence.schemaVersion !== PRIVATE_FILE_EVIDENCE_SCHEMA_VERSION ||
    evidence.artifactType !== "PRIVATE_FILE_IMPORT_VERIFICATION" ||
    evidence.stage !== stage ||
    evidence.status !== "verified" ||
    evidence.resolverContract !== LEGACY_REFERENCE_RESOLVER_CONTRACT ||
    !semverPattern.test(evidence.importToolVersion) ||
    !isIsoDate(evidence.sourceSnapshotCompletedAt) ||
    !isIsoDate(evidence.verifiedAt) ||
    !sha256Pattern.test(evidence.sourceManifestSha256) ||
    !exactObject(evidence.entities, entityNames) ||
    !exactObject(evidence.totals, totalNames) ||
    !exactObject(evidence.gates, gateNames)
  ) {
    return { ready: false, reason: "invalid_evidence" };
  }

  const entityCount = entityNames.reduce((count, entityName) => {
    const entity = evidence.entities[entityName];
    if (
      !exactObject(entity, ["count", "aggregateSha256"]) ||
      !isSafeCount(entity.count, { positive: true }) ||
      !sha256Pattern.test(entity.aggregateSha256)
    ) {
      return Number.NaN;
    }
    return count + entity.count;
  }, 0);
  if (!Number.isSafeInteger(entityCount)) {
    return { ready: false, reason: "invalid_evidence" };
  }
  if (!totalNames.every((name) => isSafeCount(evidence.totals[name]))) {
    return { ready: false, reason: "invalid_evidence" };
  }
  if (
    evidence.totals.sourceRecordCount !== entityCount ||
    evidence.totals.importedRecordCount !== entityCount ||
    evidence.totals.referenceCount <= 0 ||
    evidence.totals.referenceObjectCount !== evidence.totals.referenceCount ||
    evidence.totals.uniqueContentCount > evidence.totals.referenceCount ||
    evidence.totals.referenceObjectBytes < evidence.totals.uniqueContentBytes ||
    evidence.totals.unresolvedReferenceCount !== 0 ||
    Date.parse(evidence.sourceSnapshotCompletedAt) > Date.parse(evidence.verifiedAt) ||
    !gateNames.every((name) => evidence.gates[name] === true)
  ) {
    return { ready: false, reason: "invalid_evidence" };
  }

  const verifiedAt = Date.parse(evidence.verifiedAt);
  if (
    requireFresh &&
    (verifiedAt > now + MAX_EVIDENCE_FUTURE_MS ||
      verifiedAt < now - MAX_EVIDENCE_AGE_MS)
  ) {
    return { ready: false, reason: "stale_evidence" };
  }

  return {
    ready: true,
    stage,
    sourceManifestSha256: evidence.sourceManifestSha256,
    referenceCount: evidence.totals.referenceCount,
    referenceObjectCount: evidence.totals.referenceObjectCount,
    verifiedAt: evidence.verifiedAt,
  };
}

export function checkPrivateFileCutover({
  stage,
  evidencePath = DEFAULT_PRIVATE_FILE_EVIDENCE_PATH,
  root = repositoryRoot,
  now = Date.now(),
  requireFresh = true,
}) {
  const absolutePath = resolve(root, evidencePath);
  if (!existsSync(absolutePath)) {
    return { ready: false, reason: "missing_evidence" };
  }
  try {
    return validatePrivateFileCutoverEvidence(
      JSON.parse(readFileSync(absolutePath, "utf8")),
      stage,
      { now, requireFresh },
    );
  } catch {
    return { ready: false, reason: "invalid_evidence" };
  }
}

function parseArguments(argv) {
  const parsed = {
    mode: "require",
    stage: undefined,
    evidence: DEFAULT_PRIVATE_FILE_EVIDENCE_PATH,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error("Expected --mode, --stage, and optional --evidence pairs.");
    }
    const key = flag.slice(2);
    if (!(key in parsed)) throw new Error(`Unknown verifier option: ${flag}`);
    if (seen.has(key)) throw new Error(`Duplicate verifier option: ${flag}`);
    seen.add(key);
    parsed[key] = value;
  }
  if (!["require", "status"].includes(parsed.mode)) {
    throw new Error("Private-file verifier mode must be require or status.");
  }
  if (parsed.stage !== "test" && parsed.stage !== "production") {
    throw new Error("Private-file verifier stage must be test or production.");
  }
  return parsed;
}

function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const result = checkPrivateFileCutover({
    stage: arguments_.stage,
    evidencePath: arguments_.evidence,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (arguments_.mode === "require" && !result.ready) {
    throw new Error(
      `Legacy file-read enablement is blocked (${result.reason}); issue #11 must publish fresh verified import evidence.`,
    );
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Legacy file-read enablement is blocked."}\n`,
    );
    process.exitCode = 1;
  }
}
