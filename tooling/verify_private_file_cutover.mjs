import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");

export const DEFAULT_PRIVATE_FILE_EVIDENCE_PATH =
  "docs/migration/private-file-import-verification.json";

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function validatePrivateFileCutoverEvidence(value, stage) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ready: false, reason: "invalid_evidence" };
  }
  const evidence = value;
  const valid =
    evidence.schemaVersion === 1 &&
    evidence.artifactType === "PRIVATE_FILE_IMPORT_VERIFICATION" &&
    evidence.stage === stage &&
    evidence.status === "verified" &&
    evidence.resolverContract === "legacy-sha256-v1" &&
    isIsoDate(evidence.verifiedAt) &&
    Number.isInteger(evidence.referenceCount) &&
    evidence.referenceCount > 0 &&
    Number.isInteger(evidence.copiedObjectCount) &&
    evidence.copiedObjectCount > 0 &&
    evidence.unresolvedReferenceCount === 0 &&
    typeof evidence.manifestSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(evidence.manifestSha256);
  if (!valid) return { ready: false, reason: "invalid_evidence" };
  return {
    ready: true,
    stage,
    referenceCount: evidence.referenceCount,
    copiedObjectCount: evidence.copiedObjectCount,
    verifiedAt: evidence.verifiedAt,
  };
}

export function checkPrivateFileCutover({
  stage,
  evidencePath = DEFAULT_PRIVATE_FILE_EVIDENCE_PATH,
  root = repositoryRoot,
}) {
  const absolutePath = resolve(root, evidencePath);
  if (!existsSync(absolutePath)) {
    return { ready: false, reason: "missing_evidence" };
  }
  try {
    return validatePrivateFileCutoverEvidence(
      JSON.parse(readFileSync(absolutePath, "utf8")),
      stage,
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
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new Error("Expected --mode, --stage, and optional --evidence pairs.");
    }
    const key = flag.slice(2);
    if (!(key in parsed)) throw new Error(`Unknown verifier option: ${flag}`);
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
      `Private-file deployment is blocked (${result.reason}); issue #11 must publish verified import evidence.`,
    );
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Private-file deployment is blocked."}\n`,
    );
    process.exitCode = 1;
  }
}
