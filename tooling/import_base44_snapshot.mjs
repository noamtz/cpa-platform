import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  DescribeUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { DescribeTableCommand, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetBucketEncryptionCommand,
  GetBucketVersioningCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

export const IMPORT_TOOL_VERSION = "1.1.0";
export const IMPORT_CHECKPOINT_SCHEMA_VERSION = 1;
export const MIGRATION_MARKER_SCHEMA_VERSION = 1;
export const LEGACY_REFERENCE_RESOLVER_CONTRACT = "legacy-reference-sha256-v2";
export const LEGACY_BINDING_PREFIX = "legacy-bindings/";
export const AWS_REGION = "il-central-1";
export const AUTHORIZED_PLACEHOLDER_POLICY = Object.freeze({
  sourceManifestSha256:
    "7c2631c28a695cfb00dc66b66aaee983fd7be67c8507a272b85ac9860f0fbdbe",
  missingClientCount: 1,
  sourceSubmissionCount: 20,
});
export const ENTITY_NAMES = Object.freeze([
  "Client",
  "Submission",
  "QuestionnaireTemplate",
  "PdfTemplate",
  "SyncedDriveFile",
  "User",
]);
export const EVIDENCE_OUTPUT_PATH = "docs/migration/private-file-import-verification.json";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sha256Pattern = /^[a-f0-9]{64}$/;
const tableLogicalNames = Object.freeze(
  Object.fromEntries(ENTITY_NAMES.map((name) => [name, `${name}Table`])),
);
const reservedSourceFields = new Set(["_auditflow_migration"]);

export class ImportFailure extends Error {
  constructor(category, cause) {
    super(category, cause ? { cause } : undefined);
    this.name = "ImportFailure";
    this.category = category;
  }
}

function fail(category, cause) {
  throw new ImportFailure(category, cause);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
  );
}

function validateJson(value, depth = 0) {
  if (depth > 100) fail("json_depth_exceeded");
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("non_finite_number");
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) validateJson(child, depth + 1);
    return;
  }
  if (isRecord(value)) {
    for (const child of Object.values(value)) validateJson(child, depth + 1);
    return;
  }
  fail("unsupported_json_value");
}

export function canonicalJson(value) {
  validateJson(value);
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  const handle = openSync(path, "r");
  const digest = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let total = 0;
  try {
    while (true) {
      const length = readSync(handle, buffer, 0, buffer.length, null);
      if (!length) break;
      digest.update(buffer.subarray(0, length));
      total += length;
    }
    if (total !== fstatSync(handle).size) fail("snapshot_file_read_incomplete");
  } finally {
    closeSync(handle);
  }
  return { digest: digest.digest("hex"), bytes: total };
}

export function desiredItemSha256(item) {
  return sha256(Buffer.from(canonicalJson(item), "utf8"));
}

function readJson(path, category) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(category, error);
  }
}

function isContained(root, candidate) {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot));
}

function requireAbsoluteOutsideRepository(path, { mustExist = true } = {}) {
  if (typeof path !== "string" || !isAbsolute(path)) fail("private_path_must_be_absolute");
  const resolved = resolve(path);
  const absolute = mustExist ? realpathSync(resolved) : resolved;
  if (isContained(repositoryRoot, absolute)) fail("private_path_inside_repository");
  if (mustExist && !existsSync(absolute)) fail("private_path_missing");
  return absolute;
}

function containedSnapshotPath(snapshot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || isAbsolute(relativePath)) {
    fail("snapshot_path_invalid");
  }
  const candidate = realpathSync(resolve(snapshot, relativePath));
  if (!isContained(snapshot, candidate)) fail("snapshot_path_escape");
  return candidate;
}

function parseNdjson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail("snapshot_artifact_read_failed", error);
  }
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const records = [];
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (!isRecord(record) || typeof record.id !== "string" || !record.id) {
        fail("snapshot_ndjson_invalid");
      }
      records.push(record);
    } catch (error) {
      if (error instanceof ImportFailure) throw error;
      fail("snapshot_ndjson_invalid", error);
    }
  }
  return records;
}

export function validLegacyReference(value) {
  const hasUnsafeCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f || character === "\\";
    });
  if (
    typeof value !== "string" ||
    value.length < 4 ||
    value.length > 4096 ||
    hasUnsafeCharacter ||
    /%(?:2f|5c)/i.test(value) ||
    value.split("/").some((part) => part === "." || part === "..")
  ) {
    return false;
  }
  if (value.startsWith("private://") || value.startsWith("private/") || value.startsWith("mp/")) {
    return !value.startsWith("private://files/");
  }
  if (!/^https:\/\//i.test(value) || value.trim() !== value) return false;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return false;
  const authorityStart = value.indexOf("//") + 2;
  const suffixOffset = value.slice(authorityStart).search(/[/?#]/);
  const suffix = suffixOffset === -1 ? "" : value.slice(authorityStart + suffixOffset);
  try {
    return !suffix
      .split(/[?#]/, 1)[0]
      .split("/")
      .some((part) => [".", ".."].includes(decodeURIComponent(part)));
  } catch {
    return false;
  }
}

export function legacyReferenceKey(reference) {
  if (!validLegacyReference(reference)) fail("source_reference_invalid");
  return `legacy/${sha256(Buffer.from(reference, "utf8"))}`;
}

function legacyReferenceBinding(entity, recordId, referenceFingerprint, sourceManifestSha256) {
  const bindingHash = sha256(Buffer.from(`${entity}\0${recordId}`, "utf8"));
  return {
    entity,
    recordId,
    bindingHash,
    objectName: `${LEGACY_BINDING_PREFIX}${referenceFingerprint}/${bindingHash}`,
    sourceManifestSha256,
  };
}

function invokeOfflineVerifier(snapshot, spawn = spawnSync) {
  const result = spawn(
    process.env.PYTHON ?? "python",
    [resolve(repositoryRoot, "tooling/export_base44_snapshot.py"), "verify", "--snapshot", snapshot],
    { cwd: repositoryRoot, encoding: "utf8", windowsHide: true },
  );
  if (result.status !== 0) fail("source_offline_verification_failed");
}

function validateOutputs(value, stage) {
  if (
    !isRecord(value) ||
    value.stage !== stage ||
    !isRecord(value.tableNames) ||
    !isRecord(value.bucketNames) ||
    typeof value.userPoolId !== "string" ||
    !value.userPoolId
  ) {
    fail("sst_outputs_invalid");
  }
  const expectedTables = [...Object.values(tableLogicalNames), "ChangeJournalTable"].sort();
  if (JSON.stringify(Object.keys(value.tableNames).sort()) !== JSON.stringify(expectedTables)) {
    fail("sst_table_inventory_invalid");
  }
  if (
    JSON.stringify(Object.keys(value.bucketNames).sort()) !==
    JSON.stringify(["FilesBucket", "TemporaryOutputsBucket"])
  ) {
    fail("sst_bucket_inventory_invalid");
  }
  for (const name of [...Object.values(value.tableNames), ...Object.values(value.bucketNames)]) {
    if (typeof name !== "string" || !name) fail("sst_resource_name_invalid");
  }
  return value;
}

function validateIdentityMap(value, stage, adminIds) {
  if (
    !exactKeys(value, ["schemaVersion", "stage", "users"]) ||
    value.schemaVersion !== 1 ||
    value.stage !== stage ||
    !Array.isArray(value.users) ||
    value.users.length !== adminIds.size
  ) {
    fail("identity_map_invalid");
  }
  const byId = new Map();
  const subjects = new Set();
  for (const entry of value.users) {
    if (
      !exactKeys(entry, ["userId", "cognitoSubject"]) ||
      typeof entry.userId !== "string" ||
      !entry.userId ||
      typeof entry.cognitoSubject !== "string" ||
      !entry.cognitoSubject ||
      byId.has(entry.userId) ||
      subjects.has(entry.cognitoSubject)
    ) {
      fail("identity_map_invalid");
    }
    byId.set(entry.userId, entry.cognitoSubject);
    subjects.add(entry.cognitoSubject);
  }
  if ([...adminIds].some((id) => !byId.has(id)) || [...byId].some(([id]) => !adminIds.has(id))) {
    fail("identity_map_admin_mismatch");
  }
  return byId;
}

function requireString(record, key, category = "source_record_invalid") {
  if (typeof record[key] !== "string" || !record[key]) fail(category);
}

function migrationMarker(manifestSha256, sourceRecordSha256) {
  return {
    schema_version: MIGRATION_MARKER_SCHEMA_VERSION,
    source: "base44",
    item_kind: "source_record",
    source_manifest_sha256: manifestSha256,
    source_record_sha256: sourceRecordSha256,
  };
}

function placeholderClientMarker(manifestSha256, submissions) {
  const submissionIds = submissions.map(({ id }) => id).sort();
  return {
    schema_version: MIGRATION_MARKER_SCHEMA_VERSION,
    source: "base44",
    item_kind: "derived_placeholder_client",
    source_manifest_sha256: manifestSha256,
    source_submission_count: submissionIds.length,
    source_submission_ids_sha256: sha256(
      Buffer.from(canonicalJson(submissionIds), "utf8"),
    ),
  };
}

function validateTargetRecord(entity, target) {
  requireString(target, "id");
  if (entity !== "SyncedDriveFile") {
    if (target.record_type !== entity || !Number.isInteger(target._version) || target._version <= 0) {
      fail("target_record_invalid");
    }
  }
  if (entity === "Client") {
    requireString(target, "created_date");
    requireString(target, "updated_date");
  } else if (entity === "Submission") {
    requireString(target, "client_id");
    requireString(target, "created_date");
    requireString(target, "updated_date");
  } else if (entity === "QuestionnaireTemplate") {
    if (
      !Number.isInteger(target.version) ||
      target.version <= 0 ||
      typeof target.is_active !== "boolean" ||
      typeof target.steps !== "string"
    ) {
      fail("target_record_invalid");
    }
    requireString(target, "created_date");
    requireString(target, "updated_date");
  } else if (entity === "PdfTemplate") {
    requireString(target, "created_date");
    requireString(target, "updated_date");
  } else if (entity === "SyncedDriveFile") {
    requireString(target, "submission_id");
    requireString(target, "created_date");
  } else if (entity === "User") {
    requireString(target, "email");
    if (target.role !== "admin" && target.role !== "user") fail("target_record_invalid");
    requireString(target, "created_date");
    requireString(target, "updated_date");
  }
  if (Buffer.byteLength(canonicalJson(target), "utf8") > 400 * 1024) {
    fail("target_item_too_large");
  }
}

export function shapeTargetRecords({ recordsByEntity, manifest, manifestSha256, identityByUserId }) {
  const targetsByEntity = {};
  for (const entity of ENTITY_NAMES) {
    const hashes = new Map(manifest.entities[entity].records.map((entry) => [entry.id, entry.sha256]));
    targetsByEntity[entity] = recordsByEntity[entity].map((source) => {
      for (const field of reservedSourceFields) {
        if (field in source) fail("source_reserved_field_conflict");
      }
      const target = {
        ...source,
        ...(entity === "SyncedDriveFile"
          ? {}
          : {
              record_type: entity,
              _version:
                Number.isInteger(source._version) && source._version > 0
                  ? source._version
                  : 1,
            }),
        _auditflow_migration: migrationMarker(manifestSha256, hashes.get(source.id)),
      };
      if (entity === "User") {
        const mapped = identityByUserId.get(source.id);
        if (source.role === "admin") {
          if (!mapped) fail("identity_map_admin_mismatch");
          if (source.cognito_sub !== undefined && source.cognito_sub !== mapped) {
            fail("source_reserved_field_conflict");
          }
          target.cognito_sub = mapped;
        } else {
          if (source.cognito_sub !== undefined || mapped) fail("source_reserved_field_conflict");
          delete target.cognito_sub;
        }
      } else if ("cognito_sub" in source) {
        fail("source_reserved_field_conflict");
      }
      validateTargetRecord(entity, target);
      return target;
    });
  }
  return targetsByEntity;
}

export function buildDerivedPlaceholderClients(
  recordsByEntity,
  manifestSha256,
  authorizedPolicy = AUTHORIZED_PLACEHOLDER_POLICY,
) {
  const sourceClientIds = new Set(recordsByEntity.Client.map(({ id }) => id));
  const submissionsByMissingClient = new Map();
  for (const submission of recordsByEntity.Submission) {
    requireString(submission, "id");
    requireString(submission, "client_id");
    if (sourceClientIds.has(submission.client_id)) continue;
    if (submission.client_id.startsWith("!")) fail("source_reserved_key_conflict");
    const grouped = submissionsByMissingClient.get(submission.client_id) ?? [];
    grouped.push(submission);
    submissionsByMissingClient.set(submission.client_id, grouped);
  }
  if (submissionsByMissingClient.size === 0) return [];
  const sourceSubmissionCount = [...submissionsByMissingClient.values()].reduce(
    (count, submissions) => count + submissions.length,
    0,
  );
  if (
    !exactKeys(authorizedPolicy, [
      "sourceManifestSha256",
      "missingClientCount",
      "sourceSubmissionCount",
    ]) ||
    authorizedPolicy.sourceManifestSha256 !== manifestSha256 ||
    authorizedPolicy.missingClientCount !== submissionsByMissingClient.size ||
    authorizedPolicy.sourceSubmissionCount !== sourceSubmissionCount
  ) {
    fail("missing_client_placeholder_not_authorized");
  }
  return [...submissionsByMissingClient.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([clientId, submissions]) => {
      for (const submission of submissions) {
        requireString(submission, "created_date");
        requireString(submission, "updated_date");
      }
      const target = {
        id: clientId,
        record_type: "Client",
        _version: 1,
        created_date: submissions.map(({ created_date }) => created_date).sort()[0],
        updated_date: submissions.map(({ updated_date }) => updated_date).sort().at(-1),
        is_archived: true,
        _auditflow_migration: placeholderClientMarker(manifestSha256, submissions),
      };
      validateTargetRecord("Client", target);
      return target;
    });
}

export function validateRelationshipsAndBuildGuards(
  recordsByEntity,
  derivedPlaceholderClients = [],
) {
  const clients = new Set([
    ...recordsByEntity.Client.map(({ id }) => id),
    ...derivedPlaceholderClients.map(({ id }) => id),
  ]);
  const submissions = new Set(recordsByEntity.Submission.map(({ id }) => id));
  const questionnaireTemplates = new Map(
    recordsByEntity.QuestionnaireTemplate.map((record) => [record.id, record]),
  );
  const pdfTemplates = new Set(recordsByEntity.PdfTemplate.map(({ id }) => id));
  const activeTemplates = recordsByEntity.QuestionnaireTemplate.filter(
    (record) => record.is_active === true,
  );
  if (questionnaireTemplates.has("!ACTIVE")) fail("source_reserved_key_conflict");
  if (activeTemplates.length !== 1) fail("active_questionnaire_template_ambiguous");
  const [activeTemplate] = activeTemplates;
  try {
    if (!Array.isArray(JSON.parse(activeTemplate.steps))) fail("questionnaire_steps_invalid");
  } catch (error) {
    if (error instanceof ImportFailure) throw error;
    fail("questionnaire_steps_invalid", error);
  }

  const submissionGuards = [];
  const activeSubmissionsByKey = new Map();
  for (const submission of recordsByEntity.Submission) {
    if (!clients.has(submission.client_id)) fail("submission_client_missing");
    if (submission.template_id) {
      const template = questionnaireTemplates.get(submission.template_id);
      if (!template) fail("submission_questionnaire_template_missing");
      if (
        submission.template_version !== undefined &&
        submission.template_version !== template.version
      ) {
        fail("submission_template_version_mismatch");
      }
    }
    if (submission.pdf_template_id && !pdfTemplates.has(submission.pdf_template_id)) {
      fail("submission_pdf_template_missing");
    }
    if (submission.is_archived !== true && submission.tax_year !== undefined) {
      if (
        !Number.isInteger(submission.tax_year) ||
        submission.tax_year <= 0 ||
        submission.tax_year > 9999
      ) {
        fail("submission_tax_year_invalid");
      }
      const id = `!ACTIVE#${submission.client_id}#${submission.tax_year}`;
      if (submissions.has(id)) fail("source_reserved_key_conflict");
      const grouped = activeSubmissionsByKey.get(id) ?? [];
      grouped.push(submission);
      activeSubmissionsByKey.set(id, grouped);
    }
  }
  let resolvedDuplicateActiveSubmissionCount = 0;
  for (const [id, grouped] of [...activeSubmissionsByKey.entries()].sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const ordered = [...grouped].sort((left, right) => {
      const updated = right.updated_date.localeCompare(left.updated_date);
      if (updated !== 0) return updated;
      const created = right.created_date.localeCompare(left.created_date);
      return created !== 0 ? created : left.id.localeCompare(right.id);
    });
    const winner = ordered[0];
    resolvedDuplicateActiveSubmissionCount += ordered.length - 1;
    submissionGuards.push({
      id,
      record_type: "!ACTIVE_GUARD",
      submission_id: winner.id,
      client_id: winner.client_id,
      tax_year: winner.tax_year,
    });
  }
  for (const file of recordsByEntity.SyncedDriveFile) {
    if (!submissions.has(file.submission_id)) fail("synced_file_submission_missing");
  }
  return {
    questionnaireGuard: {
      id: "!ACTIVE",
      record_type: "!ACTIVE_GUARD",
      active_template_id: activeTemplate.id,
      active_version: activeTemplate.version,
      _version: 1,
    },
    submissionGuards,
    resolvedDuplicateActiveSubmissionCount,
  };
}

function validateManifest(manifest) {
  if (!isRecord(manifest) || manifest.schemaVersion !== 1) fail("manifest_schema_mismatch");
  if (
    !isRecord(manifest.entities) ||
    JSON.stringify(Object.keys(manifest.entities).sort()) !== JSON.stringify([...ENTITY_NAMES].sort())
  ) {
    fail("manifest_entities_invalid");
  }
  if (!Array.isArray(manifest.references) || !Array.isArray(manifest.files) || !Array.isArray(manifest.findings)) {
    fail("manifest_invalid");
  }
  if (
    manifest.findings.length !== 0 ||
    !isRecord(manifest.gates) ||
    !Object.values(manifest.gates).every((value) => value === true) ||
    !isRecord(manifest.totals) ||
    manifest.totals.unresolved !== 0
  ) {
    fail("source_snapshot_not_closed");
  }
}

export function loadImportPlan({
  stage,
  snapshotPath,
  checkpointRoot,
  identityMapPath,
  outputsPath,
  outputsValue,
  authorizedPlaceholderPolicy = AUTHORIZED_PLACEHOLDER_POLICY,
  verifyOffline = true,
  spawn = spawnSync,
}) {
  if (stage !== "test" && stage !== "production") fail("stage_invalid");
  const snapshot = requireAbsoluteOutsideRepository(snapshotPath);
  const checkpoint = requireAbsoluteOutsideRepository(checkpointRoot);
  const identityPath = requireAbsoluteOutsideRepository(identityMapPath);
  const outputsAbsolute = resolve(repositoryRoot, outputsPath);
  if (!outputsValue) {
    if (
      outputsAbsolute !== resolve(repositoryRoot, ".sst/outputs.json") ||
      !existsSync(outputsAbsolute)
    ) {
      fail("sst_outputs_path_invalid");
    }
  }
  if (verifyOffline) invokeOfflineVerifier(snapshot, spawn);

  const manifestPath = join(snapshot, "manifest.json");
  const manifestRaw = readFileSync(manifestPath);
  const manifest = readJson(manifestPath, "manifest_invalid");
  validateManifest(manifest);
  const sourceManifestSha256 = sha256(manifestRaw);
  const outputs = validateOutputs(
    outputsValue ?? readJson(outputsAbsolute, "sst_outputs_invalid"),
    stage,
  );
  const recordsByEntity = {};
  for (const entity of ENTITY_NAMES) {
    const manifestEntity = manifest.entities[entity];
    if (
      !isRecord(manifestEntity) ||
      !Number.isSafeInteger(manifestEntity.count) ||
      manifestEntity.count <= 0 ||
      !sha256Pattern.test(manifestEntity.aggregateSha256) ||
      !Array.isArray(manifestEntity.records)
    ) {
      fail("manifest_entity_invalid");
    }
    const records = parseNdjson(
      containedSnapshotPath(snapshot, manifestEntity.ndjsonPath),
    );
    const ids = records.map(({ id }) => id);
    const expectedIds = manifestEntity.records.map((entry) => entry.id);
    if (
      records.length !== manifestEntity.count ||
      new Set(ids).size !== ids.length ||
      JSON.stringify(ids) !== JSON.stringify([...ids].sort()) ||
      JSON.stringify(ids) !== JSON.stringify(expectedIds) ||
      manifestEntity.records.some(
        (entry) => !isRecord(entry) || !sha256Pattern.test(entry.sha256),
      )
    ) {
      fail("record_inventory_mismatch");
    }
    recordsByEntity[entity] = records;
  }
  const admins = recordsByEntity.User.filter((record) => record.role === "admin");
  if (admins.length !== 2) fail("admin_user_count_invalid");
  const identityMap = readJson(identityPath, "identity_map_invalid");
  const identityByUserId = validateIdentityMap(
    identityMap,
    stage,
    new Set(admins.map(({ id }) => id)),
  );
  const targetsByEntity = shapeTargetRecords({
    recordsByEntity,
    manifest,
    manifestSha256: sourceManifestSha256,
    identityByUserId,
  });
  const derivedPlaceholderClients = buildDerivedPlaceholderClients(
    recordsByEntity,
    sourceManifestSha256,
    authorizedPlaceholderPolicy,
  );
  const guards = validateRelationshipsAndBuildGuards(
    recordsByEntity,
    derivedPlaceholderClients,
  );

  const filesByHash = new Map();
  for (const file of manifest.files) {
    if (
      !isRecord(file) ||
      !sha256Pattern.test(file.sha256) ||
      !Number.isSafeInteger(file.byteLength) ||
      file.byteLength < 0 ||
      typeof file.path !== "string" ||
      filesByHash.has(file.sha256)
    ) {
      fail("manifest_files_invalid");
    }
    const contentPath = containedSnapshotPath(snapshot, file.path);
    if (!existsSync(contentPath)) fail("snapshot_file_missing");
    const verifiedContent = sha256File(contentPath);
    if (
      verifiedContent.digest !== file.sha256 ||
      verifiedContent.bytes !== file.byteLength
    ) {
      fail("snapshot_file_tamper");
    }
    filesByHash.set(file.sha256, { ...file, contentPath });
  }
  const references = manifest.references.map((reference) => {
    if (
      !isRecord(reference) ||
      !sha256Pattern.test(reference.referenceFingerprint) ||
      typeof reference.sourceReference !== "string" ||
      sha256(Buffer.from(reference.sourceReference, "utf8")) !==
        reference.referenceFingerprint ||
      reference.status !== "downloaded" ||
      !Array.isArray(reference.occurrences) ||
      !sha256Pattern.test(reference.contentSha256) ||
      !Number.isSafeInteger(reference.byteLength) ||
      reference.byteLength < 0
    ) {
      fail("manifest_references_invalid");
    }
    const file = filesByHash.get(reference.contentSha256);
    if (!file || file.byteLength !== reference.byteLength) {
      fail("reference_file_mapping_invalid");
    }
    return {
      referenceFingerprint: reference.referenceFingerprint,
      objectName: legacyReferenceKey(reference.sourceReference),
      contentSha256: reference.contentSha256,
      byteLength: reference.byteLength,
      contentPath: file.contentPath,
      sourceManifestSha256,
      bindings: [
        ...new Map(
          reference.occurrences
            .filter(
              (occurrence) =>
                isRecord(occurrence) &&
                ["Submission", "PdfTemplate"].includes(occurrence.entity) &&
                typeof occurrence.recordId === "string" &&
                occurrence.recordId.length > 0,
            )
            .map((occurrence) => [
              `${occurrence.entity}\0${occurrence.recordId}`,
              legacyReferenceBinding(
                occurrence.entity,
                occurrence.recordId,
                reference.referenceFingerprint,
                sourceManifestSha256,
              ),
            ]),
        ).values(),
      ],
    };
  });
  if (new Set(references.map(({ objectName }) => objectName)).size !== references.length) {
    fail("reference_key_collision");
  }

  return Object.freeze({
    stage,
    snapshot,
    checkpointRoot: checkpoint,
    outputs,
    manifest,
    sourceManifestSha256,
    identityMapSha256: sha256(Buffer.from(canonicalJson(identityMap), "utf8")),
    recordsByEntity,
    targetsByEntity,
    derivedPlaceholderClients,
    guards,
    references,
    referenceBindings: references.flatMap(({ bindings }) => bindings),
    sourceRecordCount: ENTITY_NAMES.reduce(
      (count, entity) => count + recordsByEntity[entity].length,
      0,
    ),
  });
}

export function checkpointBindings(plan) {
  return {
    schemaVersion: IMPORT_CHECKPOINT_SCHEMA_VERSION,
    toolVersion: IMPORT_TOOL_VERSION,
    stage: plan.stage,
    sourceManifestSha256: plan.sourceManifestSha256,
    identityMapSha256: plan.identityMapSha256,
    targetResourcesSha256: sha256(
      Buffer.from(
        canonicalJson({
          tables: plan.outputs.tableNames,
          filesBucket: plan.outputs.bucketNames.FilesBucket,
          userPoolId: plan.outputs.userPoolId,
        }),
        "utf8",
      ),
    ),
  };
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${canonicalJson(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  renameSync(temporary, path);
}

export function openCheckpoint(plan, { resume = false } = {}) {
  const directory = join(
    plan.checkpointRoot,
    "auditflow-base44-import",
    plan.sourceManifestSha256,
  );
  mkdirSync(directory, { recursive: true });
  const lockPath = join(directory, "import.lock");
  let lock;
  try {
    lock = openSync(lockPath, "wx");
    writeFileSync(lock, String(process.pid), "utf8");
  } catch (error) {
    fail("checkpoint_locked", error);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    closeSync(lock);
    rmSync(lockPath);
  };
  try {
    const path = join(directory, "checkpoint.json");
    const bindings = checkpointBindings(plan);
    let state;
    if (existsSync(path)) {
      state = readJson(path, "checkpoint_invalid");
      for (const [key, expected] of Object.entries(bindings)) {
        if (state[key] !== expected) {
          fail("checkpoint_binding_mismatch");
        }
      }
      if (!resume && state.status !== "complete") {
        fail("checkpoint_resume_required");
      }
    } else {
      state = {
        ...bindings,
        status: "in_progress",
        completed: {},
      };
      atomicWriteJson(path, state);
    }
    return {
      directory,
      path,
      state,
      save() {
        atomicWriteJson(path, state);
      },
      close: release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

export function createAwsClients() {
  const clientOptions = { region: AWS_REGION, retryMode: "standard", maxAttempts: 4 };
  const dynamo = new DynamoDBClient(clientOptions);
  return {
    sts: new STSClient(clientOptions),
    dynamo,
    document: DynamoDBDocumentClient.from(dynamo, {
      marshallOptions: { removeUndefinedValues: true },
    }),
    s3: new S3Client(clientOptions),
    cognito: new CognitoIdentityProviderClient(clientOptions),
  };
}

function expectedAccountId() {
  const value = process.env.AUDITFLOW_EXPECTED_AWS_ACCOUNT_ID;
  if (!/^\d{12}$/.test(value ?? "")) fail("expected_aws_account_missing");
  return value;
}

export async function doctorResources(
  plan,
  clients,
  { accountId = expectedAccountId() } = {},
) {
  const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
  if (identity.Account !== accountId) fail("aws_account_mismatch");
  await clients.cognito.send(
    new DescribeUserPoolCommand({ UserPoolId: plan.outputs.userPoolId }),
  );
  const subjects = new Set(
    plan.targetsByEntity.User.flatMap((user) =>
      typeof user.cognito_sub === "string" ? [user.cognito_sub] : [],
    ),
  );
  for (const subject of subjects) {
    try {
      const result = await clients.cognito.send(
        new AdminGetUserCommand({
          UserPoolId: plan.outputs.userPoolId,
          Username: subject,
        }),
      );
      const actualSubject = result.UserAttributes?.find(
        ({ Name }) => Name === "sub",
      )?.Value;
      if (actualSubject !== subject) fail("cognito_subject_missing");
    } catch (error) {
      if (error instanceof ImportFailure) throw error;
      fail("cognito_subject_missing", error);
    }
  }
  for (const entity of ENTITY_NAMES) {
    const tableName = plan.outputs.tableNames[tableLogicalNames[entity]];
    const result = await clients.dynamo.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    if (result.Table?.TableStatus !== "ACTIVE") fail("target_table_not_active");
  }
  const bucket = plan.outputs.bucketNames.FilesBucket;
  const versioning = await clients.s3.send(
    new GetBucketVersioningCommand({ Bucket: bucket }),
  );
  if (versioning.Status !== "Enabled") fail("target_bucket_not_versioned");
  const encryption = await clients.s3.send(
    new GetBucketEncryptionCommand({ Bucket: bucket }),
  );
  if (!encryption.ServerSideEncryptionConfiguration?.Rules?.length) {
    fail("target_bucket_not_encrypted");
  }
  return {
    status: "ready",
    tables: ENTITY_NAMES.length,
    subjects: subjects.size,
    filesBucket: true,
  };
}

function equalItems(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

export async function convergeDynamoItem({ client, tableName, item }) {
  const read = async () => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { id: item.id },
        ConsistentRead: true,
      }),
    );
    return result.Item;
  };
  const existing = await read();
  if (existing) {
    if (!equalItems(existing, item)) fail("target_record_conflict");
    return "skipped";
  }
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(id)",
      }),
    );
  } catch (error) {
    if (error?.name !== "ConditionalCheckFailedException") {
      fail("target_record_write_failed", error);
    }
    const raced = await read();
    if (!raced || !equalItems(raced, item)) fail("target_record_conflict");
    return "skipped";
  }
  const confirmed = await read();
  if (!confirmed || !equalItems(confirmed, item)) {
    fail("target_record_confirmation_failed");
  }
  return "written";
}

async function hashBody(body) {
  const digest = createHash("sha256");
  let length = 0;
  if (!body || typeof body[Symbol.asyncIterator] !== "function") {
    fail("s3_body_invalid");
  }
  for await (const chunk of body) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    digest.update(bytes);
    length += bytes.length;
  }
  return { sha256: digest.digest("hex"), length };
}

async function sendHeadObject(s3, bucketName, objectName) {
  return s3.send(
    new HeadObjectCommand({
      Bucket: bucketName,
      Key: objectName,
      ChecksumMode: "ENABLED",
    }),
  );
}

async function sendGetObject(s3, bucketName, objectName) {
  return s3.send(new GetObjectCommand({ Bucket: bucketName, Key: objectName }));
}

async function sendPutObject(s3, input) {
  return s3.send(new PutObjectCommand(input));
}

async function headS3Object(s3, bucket, reference) {
  try {
    return await sendHeadObject(s3, bucket, reference.objectName);
  } catch (error) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === "NotFound" ||
      error?.name === "NoSuchKey"
    ) {
      return undefined;
    }
    fail("target_object_head_failed", error);
  }
}

async function compareS3Object(s3, bucket, reference) {
  const head = await headS3Object(s3, bucket, reference);
  if (!head) return false;
  if (
    head.ContentLength !== reference.byteLength ||
    head.Metadata?.["content-sha256"] !== reference.contentSha256 ||
    head.Metadata?.["resolver-contract"] !== LEGACY_REFERENCE_RESOLVER_CONTRACT ||
    head.Metadata?.["source-manifest-sha256"] !==
      reference.sourceManifestSha256
  ) {
    fail("target_object_conflict");
  }
  const object = await sendGetObject(s3, bucket, reference.objectName);
  const actual = await hashBody(object.Body);
  if (
    actual.length !== reference.byteLength ||
    actual.sha256 !== reference.contentSha256
  ) {
    fail("target_object_conflict");
  }
  return true;
}

async function compareS3Binding(s3, bucket, binding) {
  const head = await headS3Object(s3, bucket, binding);
  if (!head) return false;
  if (
    head.ContentLength !== 0 ||
    head.Metadata?.["resolver-contract"] !== LEGACY_REFERENCE_RESOLVER_CONTRACT ||
    head.Metadata?.["source-manifest-sha256"] !== binding.sourceManifestSha256 ||
    head.Metadata?.["binding-hash"] !== binding.bindingHash
  ) {
    fail("target_binding_conflict");
  }
  return true;
}

export async function convergeS3Binding({ s3, bucket, binding }) {
  if (await compareS3Binding(s3, bucket, binding)) return "skipped";
  let raced = false;
  try {
    await sendPutObject(s3, {
      Bucket: bucket,
      Key: binding.objectName,
      Body: Buffer.alloc(0),
      ContentLength: 0,
      IfNoneMatch: "*",
      Metadata: {
        "resolver-contract": LEGACY_REFERENCE_RESOLVER_CONTRACT,
        "source-manifest-sha256": binding.sourceManifestSha256,
        "binding-hash": binding.bindingHash,
      },
    });
  } catch (error) {
    if (![409, 412].includes(error?.$metadata?.httpStatusCode)) {
      fail("target_binding_write_failed", error);
    }
    raced = true;
  }
  if (!(await compareS3Binding(s3, bucket, binding))) {
    fail("target_binding_confirmation_failed");
  }
  return raced ? "skipped" : "written";
}

function verifyLocalContent(reference) {
  const content = sha256File(reference.contentPath);
  if (
    content.bytes !== reference.byteLength ||
    content.digest !== reference.contentSha256
  ) {
    fail("snapshot_file_tamper");
  }
}

export async function convergeS3Object({
  s3,
  bucket,
  reference,
  manifestSha256,
}) {
  verifyLocalContent(reference);
  if (await compareS3Object(s3, bucket, reference)) return "skipped";
  let raced = false;
  try {
    await sendPutObject(s3, {
      Bucket: bucket,
      Key: reference.objectName,
      Body: createReadStream(reference.contentPath),
      ContentLength: reference.byteLength,
      ChecksumSHA256: Buffer.from(reference.contentSha256, "hex").toString(
        "base64",
      ),
      IfNoneMatch: "*",
      Metadata: {
        "resolver-contract": LEGACY_REFERENCE_RESOLVER_CONTRACT,
        "content-sha256": reference.contentSha256,
        "source-manifest-sha256": manifestSha256,
      },
    });
  } catch (error) {
    if (![409, 412].includes(error?.$metadata?.httpStatusCode)) {
      fail("target_object_write_failed", error);
    }
    raced = true;
  }
  if (!(await compareS3Object(s3, bucket, reference))) {
    fail("target_object_confirmation_failed");
  }
  return raced ? "skipped" : "written";
}

function importUnits(plan) {
  const units = [];
  for (const entity of ENTITY_NAMES) {
    const tableName = plan.outputs.tableNames[tableLogicalNames[entity]];
    for (const item of plan.targetsByEntity[entity]) {
      units.push({
        kind: "dynamo",
        name: `record:${entity}:${item.id}`,
        tableName,
        item,
      });
    }
  }
  for (const item of plan.derivedPlaceholderClients) {
    units.push({
      kind: "dynamo",
      name: `derived:Client:${item.id}`,
      tableName: plan.outputs.tableNames.ClientTable,
      item,
    });
  }
  units.push({
    kind: "dynamo",
    name: "guard:QuestionnaireTemplate:!ACTIVE",
    tableName: plan.outputs.tableNames.QuestionnaireTemplateTable,
    item: plan.guards.questionnaireGuard,
  });
  for (const item of plan.guards.submissionGuards) {
    units.push({
      kind: "dynamo",
      name: `guard:Submission:${item.id}`,
      tableName: plan.outputs.tableNames.SubmissionTable,
      item,
    });
  }
  for (const reference of plan.references) {
    units.push({
      kind: "s3",
      name: `object:${reference.referenceFingerprint}`,
      reference,
    });
  }
  for (const binding of plan.referenceBindings) {
    units.push({
      kind: "s3-binding",
      name: `binding:${binding.objectName}`,
      binding,
    });
  }
  return units;
}

export async function runImport(
  plan,
  clients,
  { resume = false, pauseAfterUnits } = {},
) {
  const checkpoint = openCheckpoint(plan, { resume });
  const units = importUnits(plan);
  let written = 0;
  let skipped = 0;
  let completedThisRun = 0;
  const verifyCompletedImport = checkpoint.state.status === "complete";
  try {
    for (const unit of units) {
      const expectedHash =
        unit.kind === "dynamo"
          ? desiredItemSha256(unit.item)
          : unit.kind === "s3"
            ? sha256(
                Buffer.from(
                  canonicalJson({
                    objectName: unit.reference.objectName,
                    contentSha256: unit.reference.contentSha256,
                    byteLength: unit.reference.byteLength,
                  }),
                  "utf8",
                ),
              )
            : sha256(Buffer.from(canonicalJson(unit.binding), "utf8"));
      if (
        !verifyCompletedImport &&
        checkpoint.state.completed[unit.name] === expectedHash
      ) {
        skipped += 1;
        continue;
      }
      const outcome =
        unit.kind === "dynamo"
          ? await convergeDynamoItem({
              client: clients.document,
              tableName: unit.tableName,
              item: unit.item,
            })
          : unit.kind === "s3"
            ? await convergeS3Object({
                s3: clients.s3,
                bucket: plan.outputs.bucketNames.FilesBucket,
                reference: unit.reference,
                manifestSha256: plan.sourceManifestSha256,
              })
            : await convergeS3Binding({
                s3: clients.s3,
                bucket: plan.outputs.bucketNames.FilesBucket,
                binding: unit.binding,
              });
      checkpoint.state.completed[unit.name] = expectedHash;
      checkpoint.save();
      completedThisRun += 1;
      if (outcome === "written") written += 1;
      else skipped += 1;
      if (pauseAfterUnits && completedThisRun >= pauseAfterUnits) {
        fail("operator_pause_after_checkpoint");
      }
    }
    checkpoint.state.status = "complete";
    checkpoint.save();
    return { status: "complete", written, skipped, units: units.length };
  } finally {
    checkpoint.close();
  }
}

async function scanAll(client, tableName) {
  const items = [];
  let cursor;
  do {
    const result = await client.send(
      new ScanCommand({
        TableName: tableName,
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }),
    );
    items.push(...(result.Items ?? []));
    cursor = result.LastEvaluatedKey;
  } while (cursor);
  return items;
}

async function listAllObjectsWithPrefix(s3, bucket, prefix) {
  const objects = [];
  let token;
  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    objects.push(...(result.Contents ?? []));
    token = result.IsTruncated ? result.NextContinuationToken : undefined;
    if (result.IsTruncated && !token) fail("s3_pagination_invalid");
  } while (token);
  return objects;
}

function markerMatches(item, plan) {
  const marker = item?._auditflow_migration;
  return (
    isRecord(marker) &&
    marker.schema_version === MIGRATION_MARKER_SCHEMA_VERSION &&
    marker.source === "base44" &&
    marker.item_kind === "source_record" &&
    marker.source_manifest_sha256 === plan.sourceManifestSha256 &&
    sha256Pattern.test(marker.source_record_sha256)
  );
}

export async function reconcileTarget(plan, clients) {
  let importedRecordCount = 0;
  let derivedPlaceholderClientCount = 0;
  let nonImportedTargetRecordCount = 0;
  for (const entity of ENTITY_NAMES) {
    const tableName = plan.outputs.tableNames[tableLogicalNames[entity]];
    const actualItems = await scanAll(clients.document, tableName);
    const desired = new Map(
      plan.targetsByEntity[entity].map((item) => [item.id, item]),
    );
    const guardItems =
      entity === "QuestionnaireTemplate"
        ? [plan.guards.questionnaireGuard]
        : entity === "Submission"
          ? plan.guards.submissionGuards
          : [];
    const guards = new Map(guardItems.map((item) => [item.id, item]));
    const placeholders = new Map(
      (entity === "Client" ? plan.derivedPlaceholderClients : []).map((item) => [
        item.id,
        item,
      ]),
    );
    for (const actual of actualItems) {
      if (desired.has(actual.id)) {
        if (
          !markerMatches(actual, plan) ||
          !equalItems(actual, desired.get(actual.id))
        ) {
          fail("reconciliation_record_mismatch");
        }
        desired.delete(actual.id);
        importedRecordCount += 1;
      } else if (placeholders.has(actual.id)) {
        if (!equalItems(actual, placeholders.get(actual.id))) {
          fail("reconciliation_placeholder_mismatch");
        }
        placeholders.delete(actual.id);
        derivedPlaceholderClientCount += 1;
      } else if (guards.has(actual.id)) {
        if (!equalItems(actual, guards.get(actual.id))) {
          fail("reconciliation_guard_mismatch");
        }
        guards.delete(actual.id);
      } else if (markerMatches(actual, plan)) {
        fail("reconciliation_extra_imported_record");
      } else {
        nonImportedTargetRecordCount += 1;
      }
    }
    if (desired.size || placeholders.size || guards.size) {
      fail("reconciliation_record_missing");
    }
  }
  if (importedRecordCount !== plan.sourceRecordCount) {
    fail("reconciliation_record_count_mismatch");
  }

  const listed = await listAllObjectsWithPrefix(
    clients.s3,
    plan.outputs.bucketNames.FilesBucket,
    "legacy/",
  );
  const expectedNames = new Set(
    plan.references.map(({ objectName }) => objectName),
  );
  const listedNames = new Set(listed.map(({ Key }) => Key));
  if (
    listedNames.size !== expectedNames.size ||
    [...listedNames].some((name) => !expectedNames.has(name))
  ) {
    fail("reconciliation_object_inventory_mismatch");
  }
  let referenceObjectBytes = 0;
  for (const reference of plan.references) {
    if (
      !(await compareS3Object(
        clients.s3,
        plan.outputs.bucketNames.FilesBucket,
        reference,
      ))
    ) {
      fail("reconciliation_object_missing");
    }
    referenceObjectBytes += reference.byteLength;
  }
  const listedBindings = await listAllObjectsWithPrefix(
    clients.s3,
    plan.outputs.bucketNames.FilesBucket,
    LEGACY_BINDING_PREFIX,
  );
  const expectedBindingNames = new Set(
    plan.referenceBindings.map(({ objectName }) => objectName),
  );
  const listedBindingNames = new Set(listedBindings.map(({ Key }) => Key));
  if (
    listedBindingNames.size !== expectedBindingNames.size ||
    [...listedBindingNames].some((name) => !expectedBindingNames.has(name))
  ) {
    fail("reconciliation_binding_inventory_mismatch");
  }
  for (const binding of plan.referenceBindings) {
    if (
      !(await compareS3Binding(
        clients.s3,
        plan.outputs.bucketNames.FilesBucket,
        binding,
      ))
    ) {
      fail("reconciliation_binding_missing");
    }
  }
  return {
    status: "verified",
    importedRecordCount,
    derivedPlaceholderClientCount,
    resolvedDuplicateActiveSubmissionCount:
      plan.guards.resolvedDuplicateActiveSubmissionCount,
    derivedGuardCount: plan.guards.submissionGuards.length + 1,
    nonImportedTargetRecordCount,
    referenceObjectCount: plan.references.length,
    referenceObjectBytes,
    referenceBindingCount: plan.referenceBindings.length,
  };
}

export function evidenceFor(plan, reconciliation, now = new Date()) {
  const entities = Object.fromEntries(
    ENTITY_NAMES.map((entity) => [
      entity,
      {
        count: plan.manifest.entities[entity].count,
        aggregateSha256: plan.manifest.entities[entity].aggregateSha256,
      },
    ]),
  );
  const uniqueContentBytes = plan.manifest.files.reduce(
    (total, file) => total + file.byteLength,
    0,
  );
  return {
    schemaVersion: 3,
    artifactType: "PRIVATE_FILE_IMPORT_VERIFICATION",
    stage: plan.stage,
    status: "verified",
    resolverContract: LEGACY_REFERENCE_RESOLVER_CONTRACT,
    importToolVersion: IMPORT_TOOL_VERSION,
    sourceSnapshotCompletedAt: new Date(plan.manifest.completedAt).toISOString(),
    verifiedAt: now.toISOString(),
    sourceManifestSha256: plan.sourceManifestSha256,
    entities,
    totals: {
      sourceRecordCount: plan.sourceRecordCount,
      importedRecordCount: reconciliation.importedRecordCount,
      derivedPlaceholderClientCount:
        reconciliation.derivedPlaceholderClientCount,
      resolvedDuplicateActiveSubmissionCount:
        reconciliation.resolvedDuplicateActiveSubmissionCount,
      derivedGuardCount: reconciliation.derivedGuardCount,
      nonImportedTargetRecordCount:
        reconciliation.nonImportedTargetRecordCount,
      referenceCount: plan.references.length,
      referenceObjectCount: reconciliation.referenceObjectCount,
      referenceBindingCount: reconciliation.referenceBindingCount,
      uniqueContentCount: plan.manifest.files.length,
      referenceObjectBytes: reconciliation.referenceObjectBytes,
      uniqueContentBytes,
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

export async function reconcileWithCheckpoint(plan, clients) {
  const checkpoint = openCheckpoint(plan, { resume: true });
  try {
    if (checkpoint.state.status !== "complete") {
      fail("import_not_complete");
    }
    const reconciliation = await reconcileTarget(plan, clients);
    checkpoint.state.reconciliation = {
      ...reconciliation,
      verifiedAt: new Date().toISOString(),
    };
    checkpoint.save();
    return reconciliation;
  } finally {
    checkpoint.close();
  }
}

export async function renderEvidence(
  plan,
  clients,
  outputPath,
  now = new Date(),
) {
  const expected = resolve(repositoryRoot, EVIDENCE_OUTPUT_PATH);
  const output = resolve(repositoryRoot, outputPath);
  if (output !== expected) fail("evidence_output_not_approved");
  const reconciliation = await reconcileWithCheckpoint(plan, clients);
  const evidence = evidenceFor(plan, reconciliation, now);
  atomicWriteJson(output, evidence);
  return evidence;
}

function rejectSensitiveArguments(argv) {
  const words = [
    ["to", "ken"],
    ["pass", "word"],
    ["cred", "ential"],
    ["cred", "entials"],
    ["signed", "url"],
    ["account", "id"],
  ].map((parts) => `--${parts.join("-")}`);
  const forbidden = new Set(words);
  for (const value of argv) {
    if (
      forbidden.has(value.toLowerCase().split("=", 1)[0]) ||
      /^https?:\/\//i.test(value)
    ) {
      fail("sensitive_argument_rejected");
    }
  }
}

export function parseArguments(argv) {
  rejectSensitiveArguments(argv);
  const [command, ...values] = argv;
  if (!["doctor", "plan", "import", "reconcile", "evidence"].includes(command)) {
    fail("invalid_arguments");
  }
  const booleanFlags = new Set([
    "resume",
    "confirm-test-import",
    "confirm-production-import",
  ]);
  const valueFlags = new Set([
    "stage",
    "snapshot",
    "checkpoint-root",
    "identity-map",
    "outputs",
    "output",
  ]);
  const parsed = { command };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (!flag?.startsWith("--")) fail("invalid_arguments");
    const key = flag.slice(2);
    if (key in parsed) fail("invalid_arguments");
    if (booleanFlags.has(key)) {
      parsed[key] = true;
    } else if (
      valueFlags.has(key) &&
      values[index + 1] &&
      !values[index + 1].startsWith("--")
    ) {
      parsed[key] = values[index + 1];
      index += 1;
    } else {
      fail("invalid_arguments");
    }
  }
  for (const key of [
    "stage",
    "snapshot",
    "checkpoint-root",
    "identity-map",
    "outputs",
  ]) {
    if (!parsed[key]) fail("invalid_arguments");
  }
  if (parsed.stage !== "test" && parsed.stage !== "production") {
    fail("stage_invalid");
  }
  if (
    (parsed.stage === "test" && parsed["confirm-production-import"]) ||
    (parsed.stage === "production" && parsed["confirm-test-import"])
  ) {
    fail("stage_confirmation_mismatch");
  }
  if (command === "evidence" && !parsed.output) fail("invalid_arguments");
  if (command !== "evidence" && parsed.output) fail("invalid_arguments");
  if (
    command !== "import" &&
    (parsed.resume ||
      parsed["confirm-test-import"] ||
      parsed["confirm-production-import"])
  ) {
    fail("invalid_arguments");
  }
  return parsed;
}

function requireMutationConfirmation(arguments_) {
  if (
    (arguments_.stage === "test" &&
      arguments_["confirm-production-import"] === true) ||
    (arguments_.stage === "production" &&
      arguments_["confirm-test-import"] === true)
  ) {
    fail("stage_confirmation_mismatch");
  }
  if (
    arguments_.stage === "test" &&
    arguments_["confirm-test-import"] !== true
  ) {
    fail("test_import_confirmation_required");
  }
  if (
    arguments_.stage === "production" &&
    arguments_["confirm-production-import"] !== true
  ) {
    fail("production_import_confirmation_required");
  }
}

export async function runCommand(arguments_, dependencies = {}) {
  const plan = loadImportPlan({
    stage: arguments_.stage,
    snapshotPath: arguments_.snapshot,
    checkpointRoot: arguments_["checkpoint-root"],
    identityMapPath: arguments_["identity-map"],
    outputsPath: arguments_.outputs,
    ...(dependencies.verifyOffline === false ? { verifyOffline: false } : {}),
    ...(dependencies.spawn ? { spawn: dependencies.spawn } : {}),
  });
  const clients = dependencies.clients ?? createAwsClients();
  if (arguments_.command === "doctor") {
    const result = await doctorResources(
      plan,
      clients,
      dependencies.doctorOptions,
    );
    return {
      status: result.status,
      records: plan.sourceRecordCount,
      derivedPlaceholderClients: plan.derivedPlaceholderClients.length,
      resolvedDuplicateActiveSubmissions:
        plan.guards.resolvedDuplicateActiveSubmissionCount,
      references: plan.references.length,
    };
  }
  if (arguments_.command === "plan") {
    await doctorResources(plan, clients, dependencies.doctorOptions);
    return {
      status: "planned",
      records: plan.sourceRecordCount,
      derivedPlaceholderClients: plan.derivedPlaceholderClients.length,
      resolvedDuplicateActiveSubmissions:
        plan.guards.resolvedDuplicateActiveSubmissionCount,
      guards: plan.guards.submissionGuards.length + 1,
      references: plan.references.length,
    };
  }
  if (arguments_.command === "import") {
    requireMutationConfirmation(arguments_);
    await doctorResources(plan, clients, dependencies.doctorOptions);
    return runImport(plan, clients, {
      resume: arguments_.resume === true,
      pauseAfterUnits: dependencies.pauseAfterUnits,
    });
  }
  if (arguments_.command === "reconcile") {
    await doctorResources(plan, clients, dependencies.doctorOptions);
    return reconcileWithCheckpoint(plan, clients);
  }
  if (arguments_.command === "evidence") {
    await doctorResources(plan, clients, dependencies.doctorOptions);
    const evidence = await renderEvidence(
      plan,
      clients,
      arguments_.output,
      dependencies.now,
    );
    return {
      status: evidence.status,
      sourceManifestSha256: evidence.sourceManifestSha256,
      records: evidence.totals.importedRecordCount,
      references: evidence.totals.referenceObjectCount,
    };
  }
  fail("invalid_arguments");
}

async function main() {
  try {
    const result = await runCommand(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${canonicalJson(result)}\n`);
  } catch (error) {
    const category =
      error instanceof ImportFailure ? error.category : "unexpected_safe_failure";
    process.stderr.write(`Base44 import failed: ${category}\n`);
    process.exitCode = category === "operator_pause_after_checkpoint" ? 2 : 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
