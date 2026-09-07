import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";

export const REPLAY_TOOL_VERSION = "1.1.0";
export const REPLAY_CHECKPOINT_SCHEMA_VERSION = 2;
export const BASE44_REPLAY_BRIDGE_VERSION = "1.1.0";
export const BASE44_CLI_VERSION = "0.1.14";
export const DENO_VERSION = "2.9.5";
export const AWS_REGION = "il-central-1";
export const ENTITY_NAMES = Object.freeze([
  "Client",
  "Submission",
  "QuestionnaireTemplate",
  "PdfTemplate",
  "SyncedDriveFile",
  "User",
]);
export const REPLAYABLE_ENTITY_NAMES = Object.freeze(
  ENTITY_NAMES.filter((entity) => entity !== "SyncedDriveFile"),
);
const CAPABILITY_ENTITY_ORDER = Object.freeze([
  "Client",
  "PdfTemplate",
  "QuestionnaireTemplate",
  "Submission",
  "SyncedDriveFile",
]);
export const BRIDGE_BEGIN = "__AUDITFLOW_REPLAY_JSON_BEGIN__";
export const BRIDGE_END = "__AUDITFLOW_REPLAY_JSON_END__";
const OWNER_GMAIL_PLUS_ALIAS = "__OWNER_GMAIL_PLUS_ALIAS__";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const bridgePath = resolve(scriptDirectory, "base44_replay_bridge.ts");
const sha256Pattern = /^[a-f0-9]{64}$/;
const sequencePattern = /^\d{20}$/;
const missingSentinel = Object.freeze({ __auditflow_missing: true });
const BASE44_SOURCE_ID_FIELD = "auditflow_source_id";
const BASE44_SOURCE_CREATED_FIELD = "auditflow_source_created_date";
const BASE44_SOURCE_UPDATED_FIELD = "auditflow_source_updated_date";
const BASE44_DESTINATION_OWNED_FIELDS = new Set(["id", "created_date", "updated_date"]);
const REFERENCE_ENTITY_BY_FIELD = Object.freeze({
  client_id: "Client",
  submission_id: "Submission",
  template_id: "QuestionnaireTemplate",
  pdf_template_id: "PdfTemplate",
});

export class ReplayFailure extends Error {
  constructor(category, cause, details = {}) {
    super(category, cause ? { cause } : undefined);
    this.name = "ReplayFailure";
    this.category = category;
    if (Number.isInteger(details.status)) this.status = details.status;
    if (typeof details.operation === "string") this.operation = details.operation;
  }
}

function fail(category, cause) {
  throw new ReplayFailure(category, cause);
}

function npxInvocation(arguments_) {
  if (process.platform !== "win32") return { executable: "npx", arguments: arguments_ };
  const npmBinDirectory = process.env.npm_execpath
    ? dirname(process.env.npm_execpath)
    : join(dirname(process.execPath), "node_modules", "npm", "bin");
  const npxCli = join(npmBinDirectory, "npx-cli.js");
  if (!existsSync(npxCli)) fail("npx_runtime_unavailable");
  return { executable: process.execPath, arguments: [npxCli, ...arguments_] };
}

function denoInvocation(arguments_) {
  if (process.platform !== "win32") return { executable: "deno", arguments: arguments_ };
  const installedExecutable = join(
    process.env.ProgramFiles ?? "C:\\Program Files",
    "nodejs",
    "node_modules",
    "deno",
    "deno.exe",
  );
  if (existsSync(installedExecutable)) {
    return { executable: installedExecutable, arguments: arguments_ };
  }
  const denoCli = join(dirname(process.execPath), "node_modules", "deno", "bin.cjs");
  if (!existsSync(denoCli)) fail("deno_runtime_unavailable");
  return { executable: process.execPath, arguments: [denoCli, ...arguments_] };
}

function isObservedMissingFile(error) {
  return error instanceof ReplayFailure && (error.status === 404 || error.status === 410);
}

export async function assertBase44FileAbsent(bridge, fileUri) {
  try {
    await bridge.request({ operation: "sign_file", file_uri: fileUri, expires_in: 60 });
  } catch (error) {
    if (isObservedMissingFile(error)) return;
    fail("base44_file_delete_unobservable", error);
  }
  fail("base44_file_delete_unobservable");
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function capabilityInvitationEmail(candidateEmail, ownerEmail) {
  if (candidateEmail !== OWNER_GMAIL_PLUS_ALIAS) return candidateEmail;
  const match = /^([^@+]+)(?:\+[^@]*)?@(gmail\.com|googlemail\.com)$/i.exec(ownerEmail);
  if (!match) fail("capability_invitation_inbox_unavailable");
  return `${match[1]}+auditflow-rollback-rehearsal@${match[2].toLowerCase()}`;
}

function validateJson(value, depth = 0) {
  if (depth > 100) fail("json_depth_exceeded");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    value.forEach((child) => validateJson(child, depth + 1));
    return;
  }
  if (isRecord(value)) {
    Object.values(value).forEach((child) => validateJson(child, depth + 1));
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

export function hashRecord(record) {
  return record === null ? null : sha256(Buffer.from(canonicalJson(record), "utf8"));
}

function isContained(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

export function requirePrivatePath(path, { mustExist = true } = {}) {
  if (typeof path !== "string" || !isAbsolute(path)) fail("private_path_must_be_absolute");
  const absolute = mustExist ? realpathSync(path) : resolve(path);
  if (isContained(repositoryRoot, absolute)) fail("private_path_inside_repository");
  if (mustExist && !existsSync(absolute)) fail("private_path_missing");
  return absolute;
}

function readJson(path, category = "json_invalid") {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(category, error);
  }
}

function targetFingerprint(descriptor) {
  return sha256(
    Buffer.from(
      canonicalJson({
        appId: descriptor.base44.app_id,
        source: descriptor.expected_source_fingerprint,
        deployment: descriptor.deployment,
      }),
      "utf8",
    ),
  );
}

export function loadTargetDescriptor(path, { production = false } = {}) {
  const absolute = requirePrivatePath(path);
  const descriptor = readJson(absolute, "target_descriptor_invalid");
  if (
    !isRecord(descriptor) ||
    descriptor.production !== production ||
    descriptor.purpose !==
      (production ? "rollback-replay-actual" : "rollback-replay-rehearsal") ||
    !isRecord(descriptor.base44) ||
    descriptor.base44.visibility !== "private" ||
    descriptor.base44.credential_provider !== "base44-cli-authenticated-profile" ||
    typeof descriptor.base44.app_id !== "string" ||
    !descriptor.base44.app_id ||
    !isRecord(descriptor.local_paths) ||
    !isRecord(descriptor.expected_source_fingerprint) ||
    descriptor.expected_source_fingerprint.entity_schema_count !== 6 ||
    descriptor.expected_source_fingerprint.backend_function_count !== 17 ||
    !isRecord(descriptor.deployment) ||
    descriptor.deployment.base44_cli_version !== BASE44_CLI_VERSION ||
    descriptor.deployment.deno_version !== DENO_VERSION ||
    descriptor.deployment.deployed_entity_count !== 6 ||
    descriptor.deployment.deployed_function_count !== 16 ||
    descriptor.deployment.excluded_function !== "notifySubmissionCompleted" ||
    !isRecord(descriptor.readiness) ||
    descriptor.readiness.block_fixture_writes_until_empty_enumeration !== true ||
    descriptor.readiness.production_integrations_reconnected !== false ||
    !isRecord(descriptor.cleanup) ||
    (!production && descriptor.cleanup.mismatched_clone_remote_cleanup_required !== false)
  ) {
    fail("target_descriptor_not_ready");
  }
  for (const key of [
    "clone_root",
    "checkpoint_root",
    "dry_run_root",
    "fixture_root",
    "private_evidence_root",
  ]) {
    requirePrivatePath(descriptor.local_paths[key]);
  }
  return Object.freeze({
    value: descriptor,
    path: absolute,
    fingerprintSha256: targetFingerprint(descriptor),
  });
}

function cloneState(recordsByEntity) {
  return Object.fromEntries(
    ENTITY_NAMES.map((entity) => [
      entity,
      Object.fromEntries(
        (recordsByEntity[entity] ?? []).map((record) => [record.id, structuredClone(record)]),
      ),
    ]),
  );
}

function parseNdjson(path) {
  const text = readFileSync(path, "utf8");
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const value = JSON.parse(line);
      if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
        fail("snapshot_record_invalid");
      }
      return value;
    });
}

export function loadBaselineSnapshot(snapshotPath) {
  const root = requirePrivatePath(snapshotPath);
  const manifestPath = join(root, "manifest.json");
  const manifestRaw = readFileSync(manifestPath);
  const manifest = readJson(manifestPath, "snapshot_manifest_invalid");
  const rollback = manifest.rollbackBaseline ?? manifest.rollback_baseline ?? manifest;
  const lastAppliedGlobalCursor =
    rollback.lastAppliedGlobalCursor ?? rollback.last_applied_global_cursor;
  const declaredProjectionSha256 =
    rollback.awsProjectionSha256 ?? rollback.aws_projection_sha256;
  if (
    !Number.isSafeInteger(lastAppliedGlobalCursor) ||
    lastAppliedGlobalCursor < 0 ||
    !sha256Pattern.test(declaredProjectionSha256 ?? "") ||
    !isRecord(manifest.entities)
  ) {
    fail("rollback_baseline_binding_missing");
  }
  const recordsByEntity = {};
  for (const entity of ENTITY_NAMES) {
    const entry = manifest.entities[entity];
    if (!isRecord(entry) || typeof entry.ndjsonPath !== "string") {
      fail("snapshot_entity_invalid");
    }
    const path = realpathSync(join(root, entry.ndjsonPath));
    if (!isContained(root, path)) fail("snapshot_path_escape");
    recordsByEntity[entity] = parseNdjson(path);
    if (
      !Number.isSafeInteger(entry.count) ||
      entry.count !== recordsByEntity[entity].length
    ) {
      fail("snapshot_entity_count_mismatch");
    }
  }
  const state = cloneState(recordsByEntity);
  const calculatedProjectionSha256 = hashProjection(state);
  if (calculatedProjectionSha256 !== declaredProjectionSha256) {
    fail("baseline_projection_hash_mismatch");
  }
  return Object.freeze({
    root,
    manifest,
    manifestSha256: sha256(manifestRaw),
    lastAppliedGlobalCursor,
    projectionSha256: calculatedProjectionSha256,
    recordsByEntity,
    state,
  });
}

export function hashProjection(state) {
  const normalized = Object.fromEntries(
    ENTITY_NAMES.map((entity) => [
      entity,
      Object.values(state[entity] ?? {}).sort((left, right) =>
        String(left.id).localeCompare(String(right.id)),
      ),
    ]),
  );
  return sha256(Buffer.from(canonicalJson(normalized), "utf8"));
}

export async function readAwsProjection(client, outputs) {
  const state = {};
  for (const entity of ENTITY_NAMES) {
    const tableName = outputs.tableNames?.[`${entity}Table`];
    if (typeof tableName !== "string" || !tableName) fail("aws_projection_binding_missing");
    const records = {};
    let exclusiveStartKey;
    do {
      const result = await client.send(
        new ScanCommand({
          TableName: tableName,
          ConsistentRead: true,
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        }),
      );
      for (const record of result.Items ?? []) {
        if (
          !isRecord(record) ||
          typeof record.id !== "string" ||
          !record.id ||
          (typeof record.record_type === "string" && record.record_type.startsWith("!"))
        ) {
          if (isRecord(record) && typeof record.record_type === "string" && record.record_type.startsWith("!")) {
            continue;
          }
          fail("aws_projection_record_invalid");
        }
        if (records[record.id]) fail("aws_projection_duplicate_id");
        records[record.id] = record;
      }
      exclusiveStartKey = result.LastEvaluatedKey;
    } while (exclusiveStartKey);
    state[entity] = records;
  }
  return state;
}

export async function assertBaselineMatchesAws(client, outputs, baseline) {
  const state = await readAwsProjection(client, outputs);
  if (hashProjection(state) !== baseline.projectionSha256) {
    fail("baseline_aws_projection_mismatch");
  }
  return state;
}

function validateEntry(entry) {
  if (
    !isRecord(entry) ||
    entry.scope !== "GLOBAL" ||
    entry.item_type !== "ENTRY" ||
    !sequencePattern.test(entry.sequence ?? "") ||
    !REPLAYABLE_ENTITY_NAMES.concat(["File"]).includes(entry.entity_type) ||
    !["create", "update", "delete"].includes(entry.operation_type) ||
    typeof entry.entity_key !== "string" ||
    !entry.entity_key.startsWith(`${entry.entity_type}#`) ||
    entry.entity_key.length <= entry.entity_type.length + 1 ||
    typeof entry.operation_id !== "string" ||
    !entry.operation_id ||
    !Number.isSafeInteger(entry.operation_index) ||
    !Number.isSafeInteger(entry.operation_count) ||
    entry.operation_count < 1 ||
    entry.operation_count > 98 ||
    entry.operation_index < 0 ||
    entry.operation_index >= entry.operation_count ||
    (!sha256Pattern.test(entry.before_hash ?? "") && entry.before_hash !== null) ||
    (!sha256Pattern.test(entry.after_hash ?? "") && entry.after_hash !== null) ||
    (entry.before !== null && !isRecord(entry.before)) ||
    (entry.after !== null && !isRecord(entry.after))
  ) {
    fail("journal_entry_invalid");
  }
  if (entry.entity_type === "SyncedDriveFile") fail("unreachable_mutation_blocker");
  if (entry.entity_type !== "File" && entry.operation_type === "delete") {
    fail("unreachable_mutation_blocker");
  }
  validateJson(entry.before);
  validateJson(entry.after);
  return entry;
}

export function validateAndGroupJournal(entries, fromExclusive, toInclusive) {
  if (
    !Number.isSafeInteger(fromExclusive) ||
    !Number.isSafeInteger(toInclusive) ||
    fromExclusive < 0 ||
    toInclusive < fromExclusive
  ) {
    fail("journal_range_invalid");
  }
  const expectedCount = toInclusive - fromExclusive;
  if (entries.length !== expectedCount) fail("journal_range_gap");
  const groups = [];
  const completedOperationIds = new Set();
  let current;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = validateEntry(entries[index]);
    const expectedSequence = String(fromExclusive + index + 1).padStart(20, "0");
    if (entry.sequence !== expectedSequence) fail("journal_range_gap");
    if (!current || current.operationId !== entry.operation_id) {
      if (current && current.entries.length !== current.expectedCount) {
        fail("operation_group_incomplete");
      }
      if (current) completedOperationIds.add(current.operationId);
      if (completedOperationIds.has(entry.operation_id)) fail("operation_group_nonadjacent");
      current = {
        operationId: entry.operation_id,
        expectedCount: entry.operation_count,
        entries: [],
      };
      groups.push(current);
    }
    if (
      entry.operation_count !== current.expectedCount ||
      entry.operation_index !== current.entries.length ||
      current.entries.length >= current.expectedCount
    ) {
      fail("operation_group_invalid");
    }
    current.entries.push(entry);
  }
  if (current && current.entries.length !== current.expectedCount) {
    fail("operation_group_incomplete");
  }
  return groups;
}

function isMissing(value) {
  return isRecord(value) && value.__auditflow_missing === true && Object.keys(value).length === 1;
}

function applyDelta(record, delta) {
  if (!isRecord(delta)) fail("journal_delta_invalid");
  const result = { ...record };
  for (const [key, value] of Object.entries(delta)) {
    if (isMissing(value)) delete result[key];
    else result[key] = structuredClone(value);
  }
  return result;
}

function assertDeltaBefore(current, beforeDelta) {
  if (!isRecord(beforeDelta)) fail("journal_delta_invalid");
  for (const [key, expected] of Object.entries(beforeDelta)) {
    if (isMissing(expected)) {
      if (Object.hasOwn(current, key)) fail("journal_before_delta_mismatch");
    } else if (canonicalJson(current[key]) !== canonicalJson(expected)) {
      fail("journal_before_delta_mismatch");
    }
  }
}

export const MUTATION_COVERAGE = Object.freeze({
  Client: Object.freeze(["create", "update"]),
  Submission: Object.freeze(["create", "update"]),
  QuestionnaireTemplate: Object.freeze(["create", "update"]),
  PdfTemplate: Object.freeze(["create", "update"]),
  User: Object.freeze(["create", "update"]),
  File: Object.freeze(["create", "delete"]),
  SyncedDriveFile: Object.freeze([]),
});

export function assertCoveredMutation(entry) {
  if (!MUTATION_COVERAGE[entry.entity_type]?.includes(entry.operation_type)) {
    fail("unknown_mutation_blocker");
  }
}

export function projectJournal(baselineState, groups) {
  const state = structuredClone(baselineState);
  const actions = [];
  for (const group of groups) {
    for (const entry of group.entries) {
      assertCoveredMutation(entry);
      const entityState = state[entry.entity_type] ?? (state[entry.entity_type] = {});
      const id = String(entry.entity_key).replace(`${entry.entity_type}#`, "");
      const current = entityState[id];
      if (entry.operation_type === "create") {
        if (current || entry.before !== null || entry.before_hash !== null || !isRecord(entry.after)) {
          fail("journal_create_state_mismatch");
        }
        if (hashRecord(entry.after) !== entry.after_hash) fail("journal_after_hash_mismatch");
        entityState[id] = structuredClone(entry.after);
      } else if (entry.operation_type === "update") {
        if (!current || hashRecord(current) !== entry.before_hash) {
          fail("journal_before_hash_mismatch");
        }
        assertDeltaBefore(current, entry.before);
        const next = applyDelta(current, entry.after);
        if (hashRecord(next) !== entry.after_hash) fail("journal_after_hash_mismatch");
        entityState[id] = next;
      } else {
        if (!current || hashRecord(current) !== entry.before_hash) {
          fail("journal_before_hash_mismatch");
        }
        if (hashRecord(entry.after) !== entry.after_hash) fail("journal_after_hash_mismatch");
        entityState[id] = structuredClone(entry.after);
      }
      actions.push({
        groupId: group.operationId,
        sequence: entry.sequence,
        entity: entry.entity_type,
        operation: entry.operation_type,
        id,
        before: current ? structuredClone(current) : null,
        after: structuredClone(entityState[id]),
      });
    }
  }
  return Object.freeze({ state, actions, projectionSha256: hashProjection(state) });
}

function bridgeSource() {
  const source = readFileSync(bridgePath, "utf8");
  if ((source.match(/__AUDITFLOW_REPLAY_REQUEST__/g) ?? []).length !== 1) {
    fail("bridge_marker_invalid");
  }
  return source;
}

export class Base44ReplayBridge {
  constructor(
    target,
    { spawn = spawnSync, environment = process.env, dataEnvironment = "prod" } = {},
  ) {
    if (!["preview", "prod"].includes(dataEnvironment)) {
      fail("base44_data_environment_invalid");
    }
    this.target = target;
    this.spawn = spawn;
    this.environment = { ...environment };
    this.dataEnvironment = dataEnvironment;
    this.source = bridgeSource();
    this.sourceSha256 = sha256(Buffer.from(this.source, "utf8"));
  }

  assertRuntimeVersions() {
    const denoCommand = denoInvocation(["--version"]);
    const deno = this.spawn(denoCommand.executable, denoCommand.arguments, {
      cwd: this.target.value.local_paths.clone_root,
      encoding: "utf8",
      env: this.environment,
      timeout: 30_000,
    });
    if (
      deno.error ||
      deno.status !== 0 ||
      !String(deno.stdout ?? "").split(/\r?\n/)[0].includes(`deno ${DENO_VERSION}`)
    ) {
      fail("deno_version_mismatch", deno.error);
    }
    const invocation = npxInvocation([
      "--yes",
      `base44@${BASE44_CLI_VERSION}`,
      "--version",
    ]);
    const cli = this.spawn(invocation.executable, invocation.arguments, {
      cwd: this.target.value.local_paths.clone_root,
      encoding: "utf8",
      env: this.environment,
      timeout: 60_000,
    });
    if (
      cli.error ||
      cli.status !== 0 ||
      !String(cli.stdout ?? "").includes(BASE44_CLI_VERSION)
    ) {
      fail("base44_cli_version_mismatch", cli.error);
    }
  }

  request(request) {
    const denoCommand = denoInvocation([]);
    const executablePath = dirname(denoCommand.executable);
    const inheritedPath = Object.entries(this.environment).find(
      ([key]) => key.toLowerCase() === "path",
    )?.[1];
    const environment = {
      ...this.environment,
      AUDITFLOW_REPLAY_REQUEST_JSON: canonicalJson(request),
      DENO_NO_PACKAGE_JSON: "1",
      DENO_DIR: join(
        process.env.TEMP ?? process.env.TMP ?? this.target.value.local_paths.checkpoint_root,
        `auditflow-base44-replay-deno-${DENO_VERSION}`,
      ),
    };
    for (const key of Object.keys(environment)) {
      if (key.toLowerCase() === "path") delete environment[key];
    }
    environment.PATH = `${executablePath}${delimiter}${inheritedPath ?? ""}`;
    const invocation = npxInvocation([
      "--yes",
      `base44@${BASE44_CLI_VERSION}`,
      "--json",
      "exec",
      "--privileged",
      "--data-env",
      this.dataEnvironment,
    ]);
    const result = this.spawn(
      invocation.executable,
      invocation.arguments,
      {
        cwd: this.target.value.local_paths.clone_root,
        input: this.source,
        encoding: "utf8",
        env: environment,
        maxBuffer: 16 * 1024 * 1024,
        timeout: 180_000,
      },
    );
    if (result.error || result.status !== 0) fail("base44_cli_failed", result.error);
    const stdout = result.stdout ?? "";
    if (
      stdout.split(BRIDGE_BEGIN).length !== 2 ||
      stdout.split(BRIDGE_END).length !== 2
    ) {
      fail("bridge_protocol_failed");
    }
    const payload = stdout.slice(
      stdout.indexOf(BRIDGE_BEGIN) + BRIDGE_BEGIN.length,
      stdout.indexOf(BRIDGE_END),
    );
    let response;
    try {
      response = JSON.parse(payload);
    } catch (error) {
      fail("bridge_protocol_failed", error);
    }
    if (!isRecord(response) || response.ok !== true || !isRecord(response.result)) {
      throw new ReplayFailure("bridge_operation_failed", undefined, {
        status: isRecord(response) ? response.status : undefined,
        operation: request.operation,
      });
    }
    return response.result;
  }

  async listAll(entity, pageSize = 5000) {
    if (!ENTITY_NAMES.includes(entity)) fail("entity_not_allowlisted");
    const records = [];
    for (let skip = 0; ; skip += pageSize) {
      const result = await this.request({ operation: "list_page", entity, limit: pageSize, skip });
      if (!Array.isArray(result.records) || result.records.length > pageSize) {
        fail("bridge_protocol_failed");
      }
      records.push(...result.records);
      if (result.records.length < pageSize) break;
    }
    return records;
  }
}

export async function queryJournalRange(client, tableName, fromExclusive, toInclusive) {
  if (fromExclusive === toInclusive) return [];
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "#scope = :scope AND #sequence BETWEEN :from AND :to",
        ExpressionAttributeNames: { "#scope": "scope", "#sequence": "sequence" },
        ExpressionAttributeValues: {
          ":scope": "GLOBAL",
          ":from": String(fromExclusive + 1).padStart(20, "0"),
          ":to": String(toInclusive).padStart(20, "0"),
        },
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
    if (Array.isArray(result.Items)) items.push(...result.Items);
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

export async function queryScope(client, tableName, scope) {
  const items = [];
  let exclusiveStartKey;
  do {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "#scope = :scope",
        ExpressionAttributeNames: { "#scope": "scope" },
        ExpressionAttributeValues: { ":scope": scope },
        ConsistentRead: true,
        ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
      }),
    );
    if (Array.isArray(result.Items)) items.push(...result.Items);
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

export async function assertNoUnresolvedOperationalState(client, tableName) {
  const [intents, reconciliations, resolutions] = await Promise.all([
    queryScope(client, tableName, "EXTERNAL_ACTIVITY"),
    queryScope(client, tableName, "FILE_RECONCILIATION"),
    queryScope(client, tableName, "RECONCILIATION_RESOLUTION"),
  ]);
  const resolved = new Set(
    resolutions.map((item) => `${item.source_scope}\0${item.source_sequence}`),
  );
  if (
    intents.some((item) => item.status === "ACTIVE") ||
    reconciliations.some(
      (item) => !resolved.has(`FILE_RECONCILIATION\0${item.sequence}`),
    )
  ) {
    fail("unresolved_operational_state");
  }
}

function readOutputs(path, stage) {
  const absolute = resolve(repositoryRoot, path);
  if (!isContained(repositoryRoot, absolute) || !existsSync(absolute)) {
    fail("sst_outputs_path_invalid");
  }
  const outputs = readJson(absolute, "sst_outputs_invalid");
  const tableName = outputs.tableNames?.ChangeJournalTable;
  const filesBucketName = outputs.bucketNames?.FilesBucket;
  if (
    typeof tableName !== "string" ||
    !tableName ||
    typeof filesBucketName !== "string" ||
    !filesBucketName ||
    !["test", "production"].includes(stage)
  ) {
    fail("sst_outputs_invalid");
  }
  return { value: outputs, changeJournalTableName: tableName };
}

export function buildReplayPlan({ baseline, control, entries }) {
  if (
    !isRecord(control) ||
    control.mode !== "MAINTENANCE" ||
    !Number.isSafeInteger(control.cutover_start_cursor) ||
    !Number.isSafeInteger(control.boundary_end_cursor) ||
    control.cutover_start_cursor !== baseline.lastAppliedGlobalCursor ||
    control.manifest_sha256 !== baseline.manifestSha256 ||
    control.baseline_projection_sha256 !== baseline.projectionSha256
  ) {
    fail("range_binding_mismatch");
  }
  const groups = validateAndGroupJournal(
    entries,
    control.cutover_start_cursor,
    control.boundary_end_cursor,
  );
  const projection = projectJournal(baseline.state, groups);
  const counts = Object.fromEntries(
    REPLAYABLE_ENTITY_NAMES.concat(["File"]).map((entity) => [
      entity,
      projection.actions.filter((action) => action.entity === entity).length,
    ]),
  );
  return Object.freeze({
    groups,
    projection,
    counts,
    range: {
      fromExclusive: control.cutover_start_cursor,
      toInclusive: control.boundary_end_cursor,
    },
    rangeSha256: sha256(Buffer.from(canonicalJson(entries), "utf8")),
  });
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${canonicalJson(value)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows ACLs are controlled by the protected parent directory.
  }
}

export function checkpointBindings(context, plan, bridgeSha256) {
  return {
    schemaVersion: REPLAY_CHECKPOINT_SCHEMA_VERSION,
    toolVersion: REPLAY_TOOL_VERSION,
    bridgeVersion: BASE44_REPLAY_BRIDGE_VERSION,
    bridgeSha256,
    stage: context.stage,
    targetFingerprintSha256: context.target.fingerprintSha256,
    manifestSha256: context.baseline.manifestSha256,
    baselineProjectionSha256: context.baseline.projectionSha256,
    fromExclusive: plan.range.fromExclusive,
    toInclusive: plan.range.toInclusive,
    rangeSha256: plan.rangeSha256,
    projectedStateSha256: plan.projection.projectionSha256,
    resourceBindingSha256: sha256(
      Buffer.from(canonicalJson({ table: context.outputs.changeJournalTableName }), "utf8"),
    ),
  };
}

export function openReplayCheckpoint(context, plan, bridgeSha256, { resume = false } = {}) {
  const root = requirePrivatePath(context.target.value.local_paths.checkpoint_root);
  const directory = join(root, "auditflow-reverse-replay", context.control.run_id);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, "replay.lock");
  let lock;
  try {
    lock = openSync(lockPath, "wx", 0o600);
    writeFileSync(lock, String(process.pid), "utf8");
  } catch (error) {
    fail("checkpoint_locked", error);
  }
  const release = () => {
    if (lock === undefined) return;
    closeSync(lock);
    lock = undefined;
    rmSync(lockPath, { force: true });
  };
  try {
    const path = join(directory, "checkpoint.json");
    const bindings = checkpointBindings(context, plan, bridgeSha256);
    let state;
    if (existsSync(path)) {
      state = readJson(path, "checkpoint_invalid");
      for (const [key, expected] of Object.entries(bindings)) {
        if (canonicalJson(state[key]) !== canonicalJson(expected)) {
          fail("checkpoint_binding_mismatch");
        }
      }
      if (!resume && state.status !== "complete") fail("checkpoint_resume_required");
      if (resume) {
        state.resumed = true;
        atomicWriteJson(path, state);
      }
    } else {
      state = {
        ...bindings,
        status: "in_progress",
        completedOperations: {},
        idMappings: {},
        fileMappings: {},
        writes: 0,
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

export function writePrivateDryRun(context, plan) {
  const root = requirePrivatePath(context.target.value.local_paths.dry_run_root);
  const directory = join(root, context.control.run_id);
  const path = join(directory, "plan.json");
  const value = {
    schemaVersion: 2,
    runFingerprint: sha256(context.control.run_id),
    range: plan.range,
    affectedEntities: plan.projection.actions
      .filter((action) => action.entity !== "File")
      .map(({ entity, id, operation }) => ({ entity, id, operation })),
    affectedFiles: plan.projection.actions
      .filter((action) => action.entity === "File")
      .map(({ id, operation }) => ({ id, operation })),
  };
  atomicWriteJson(path, value);
  return { entityCount: value.affectedEntities.length, fileCount: value.affectedFiles.length };
}

const INTERNAL_RECORD_FIELDS = new Set([
  "_version",
  "record_type",
  "cognito_sub",
  "_auditflow_migration",
]);

function rewriteValue(value, fileMappings, idMappings = {}, fieldName) {
  if (typeof value === "string") {
    if (fileMappings[value]) return fileMappings[value].base44Uri;
    const referenceEntity = REFERENCE_ENTITY_BY_FIELD[fieldName];
    if (referenceEntity) {
      const mapped = idMappings[`${referenceEntity}:${value}`];
      if (mapped) return mapped;
    }
    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        const parsed = JSON.parse(value);
        const rewritten = rewriteValue(parsed, fileMappings, idMappings);
        return canonicalJson(rewritten);
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteValue(entry, fileMappings, idMappings, fieldName));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        rewriteValue(entry, fileMappings, idMappings, key),
      ]),
    );
  }
  return value;
}

export function projectBase44Record(record, fileMappings = {}, idMappings = {}) {
  if (!isRecord(record)) fail("entity_projection_invalid");
  return rewriteValue(
    Object.fromEntries(
      Object.entries(record).filter(([key]) => !INTERNAL_RECORD_FIELDS.has(key)),
    ),
    fileMappings,
    idMappings,
  );
}

export function projectMappedBase44Record(
  record,
  fileMappings = {},
  idMappings = {},
) {
  const projected = projectBase44Record(record, fileMappings, idMappings);
  if (typeof projected.id !== "string" || !projected.id) {
    fail("entity_source_id_missing");
  }
  const destination = Object.fromEntries(
    Object.entries(projected).filter(([key]) => !BASE44_DESTINATION_OWNED_FIELDS.has(key)),
  );
  destination[BASE44_SOURCE_ID_FIELD] = projected.id;
  if (typeof projected.created_date === "string" && projected.created_date) {
    destination[BASE44_SOURCE_CREATED_FIELD] = projected.created_date;
  }
  if (typeof projected.updated_date === "string" && projected.updated_date) {
    destination[BASE44_SOURCE_UPDATED_FIELD] = projected.updated_date;
  }
  return destination;
}

function desiredRecordObserved(actual, desired) {
  if (!isRecord(actual)) return false;
  return Object.entries(desired).every(
    ([key, value]) => Object.hasOwn(actual, key) && canonicalJson(actual[key]) === canonicalJson(value),
  );
}

function actionPriority(action) {
  if (action.entity === "File") return action.operation === "delete" ? 6 : 0;
  if (["User", "Client"].includes(action.entity)) return 1;
  if (action.entity === "PdfTemplate") return 2;
  if (action.entity === "QuestionnaireTemplate") return 3;
  if (action.entity === "Submission") return 4;
  return 5;
}

export function dependencyOrderActions(actions) {
  return actions
    .map((action, index) => ({ action, index }))
    .sort(
      (left, right) =>
        actionPriority(left.action) - actionPriority(right.action) || left.index - right.index,
    )
    .map(({ action }) => action);
}

function containsReference(value, reference) {
  if (typeof value === "string") {
    if (value === reference) return true;
    try {
      return containsReference(JSON.parse(value), reference);
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some((entry) => containsReference(entry, reference));
  if (isRecord(value)) return Object.values(value).some((entry) => containsReference(entry, reference));
  return false;
}

async function observeRecord(bridge, entity, id) {
  const result = await bridge.request({ operation: "filter_id", entity, id });
  if (!Array.isArray(result.records) || result.records.length > 1) {
    fail("base44_observation_invalid");
  }
  return result.records[0];
}

async function observeRecordBySourceId(bridge, entity, sourceId) {
  const result = await bridge.request({
    operation: "filter_source_id",
    entity,
    source_id: sourceId,
  });
  if (!Array.isArray(result.records) || result.records.length > 1) {
    fail("base44_observation_invalid");
  }
  return result.records[0];
}

async function observeMappedRecord(bridge, entity, sourceId, mappedId) {
  if (mappedId) {
    const mapped = await observeRecord(bridge, entity, mappedId);
    if (mapped) return mapped;
  }
  const bySource = await observeRecordBySourceId(bridge, entity, sourceId);
  if (bySource) return bySource;
  return observeRecord(bridge, entity, sourceId);
}

async function observeUserByEmail(bridge, email) {
  if (typeof email !== "string" || !email) fail("user_email_missing");
  const result = await bridge.request({ operation: "filter_user_email", email });
  if (!Array.isArray(result.records) || result.records.length > 1) {
    fail("base44_observation_invalid");
  }
  return result.records[0];
}

async function assertReplayControl(context, { write = false } = {}) {
  if (!context.maintenance) return;
  const control = await context.maintenance.getControl();
  if (
    !control ||
    control.mode !== "MAINTENANCE" ||
    control.run_id !== context.control.run_id ||
    control.cutover_start_cursor !== context.control.cutover_start_cursor ||
    control.boundary_end_cursor !== context.control.boundary_end_cursor ||
    control.replay_state === "ABORTED" ||
    control.replay_state === "ROLLED_BACK" ||
    (write && control.replay_state !== "IN_PROGRESS")
  ) {
    fail("replay_no_longer_authorized");
  }
}

function projectedUser(record, fileMappings) {
  const projected = projectBase44Record(record, fileMappings);
  return Object.fromEntries(Object.entries(projected).filter(([key]) => key !== "id"));
}

async function convergeEntityAction(action, checkpoint, bridge) {
  const mappedId = checkpoint.state.idMappings[`${action.entity}:${action.id}`];
  if (action.entity === "User") {
    const desired = projectedUser(action.after, checkpoint.state.fileMappings);
    let observed = mappedId
      ? await observeRecord(bridge, "User", mappedId)
      : await observeUserByEmail(bridge, desired.email);
    let wrote = false;
    if (action.operation === "create" && !observed) {
      await assertReplayControl(checkpoint.context, { write: true });
      try {
        await bridge.request({
          operation: "invite_user",
          email: desired.email,
          role: desired.role,
        });
      } catch {
        // An invitation timeout is safe only when the destination user is observable.
      }
      observed = await observeUserByEmail(bridge, desired.email);
      if (!observed) fail("base44_ambiguous_result");
      wrote = true;
    }
    if (!observed) fail("base44_record_missing");
    if (typeof observed.id !== "string" || !observed.id) fail("base44_observation_invalid");
    if (!desiredRecordObserved(observed, desired)) {
      await assertReplayControl(checkpoint.context, { write: true });
      try {
        await bridge.request({
          operation: "update",
          entity: "User",
          id: observed.id,
          record: desired,
        });
      } catch {
        const afterAmbiguous = await observeUserByEmail(bridge, desired.email);
        if (!desiredRecordObserved(afterAmbiguous, desired)) {
          fail("base44_ambiguous_result");
        }
      }
      observed = await observeUserByEmail(bridge, desired.email);
      if (!desiredRecordObserved(observed, desired)) fail("base44_update_not_observed");
      wrote = true;
    }
    checkpoint.state.idMappings[`User:${action.id}`] = observed.id;
    return wrote;
  }

  const desired = projectMappedBase44Record(
    action.after,
    checkpoint.state.fileMappings,
    checkpoint.state.idMappings,
  );
  let observed = await observeMappedRecord(
    bridge,
    action.entity,
    action.id,
    mappedId,
  );
  if (action.operation === "create") {
    if (observed) {
      if (!desiredRecordObserved(observed, desired)) fail("base44_third_state");
      if (typeof observed.id !== "string" || !observed.id) fail("base44_observation_invalid");
      checkpoint.state.idMappings[`${action.entity}:${action.id}`] = observed.id;
      return false;
    }
    let createResult;
    try {
      await assertReplayControl(checkpoint.context, { write: true });
      createResult = await bridge.request({
        operation: "create",
        entity: action.entity,
        record: desired,
      });
    } catch {
      const afterAmbiguous = await observeRecordBySourceId(bridge, action.entity, action.id);
      if (!desiredRecordObserved(afterAmbiguous, desired)) fail("base44_ambiguous_result");
      if (typeof afterAmbiguous.id !== "string" || !afterAmbiguous.id) {
        fail("base44_observation_invalid");
      }
      checkpoint.state.idMappings[`${action.entity}:${action.id}`] = afterAmbiguous.id;
      return true;
    }
    const returnedId = createResult?.record?.id;
    const after =
      typeof returnedId === "string" && returnedId
        ? await observeRecord(bridge, action.entity, returnedId)
        : await observeRecordBySourceId(bridge, action.entity, action.id);
    if (!desiredRecordObserved(after, desired)) {
      fail("base44_create_not_observed");
    }
    if (typeof after.id !== "string" || !after.id) fail("base44_observation_invalid");
    checkpoint.state.idMappings[`${action.entity}:${action.id}`] = after.id;
    return true;
  }
  if (!observed) fail("base44_record_missing");
  if (typeof observed.id !== "string" || !observed.id) fail("base44_observation_invalid");
  checkpoint.state.idMappings[`${action.entity}:${action.id}`] = observed.id;
  if (desiredRecordObserved(observed, desired)) return false;
  try {
    await assertReplayControl(checkpoint.context, { write: true });
    await bridge.request({
      operation: "update",
      entity: action.entity,
      id: observed.id,
      record: desired,
    });
  } catch {
    const afterAmbiguous = await observeRecord(bridge, action.entity, observed.id);
    if (!desiredRecordObserved(afterAmbiguous, desired)) fail("base44_ambiguous_result");
    return true;
  }
  const after = await observeRecord(bridge, action.entity, observed.id);
  if (!desiredRecordObserved(after, desired)) fail("base44_update_not_observed");
  return true;
}

async function writeObjectToPrivateFile(result, path) {
  if (!result.Body?.transformToByteArray) fail("s3_body_unavailable");
  const bytes = Buffer.from(await result.Body.transformToByteArray());
  writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
  return bytes;
}

async function convergeFileAction(action, checkpoint, bridge, context) {
  const sourceReference = action.before?.file_uri ?? action.after?.file_uri;
  if (typeof sourceReference !== "string" || !sourceReference) {
    fail("file_reference_missing");
  }
  const mapping = checkpoint.state.fileMappings[sourceReference];
  if (action.operation === "delete") {
    if (
      ENTITY_NAMES.some((entity) =>
        Object.values(context.planProjectionState?.[entity] ?? {}).some((record) =>
          containsReference(record, sourceReference),
        ),
      )
    ) {
      fail("file_still_referenced");
    }
    if (!mapping || mapping.deleted === true) return false;
    await assertReplayControl(context, { write: true });
    try {
      await bridge.request({ operation: "delete_file", file_uri: mapping.base44Uri });
    } catch {
      // A delete timeout is safe only if the signed-read observation below proves absence.
    }
    await assertBase44FileAbsent(bridge, mapping.base44Uri);
    mapping.deleted = true;
    return true;
  }
  if (mapping?.base44Uri && mapping.deleted !== true) return false;
  const versionId = action.after?.version_id;
  const keyPrefix = "private://files/";
  if (
    !sourceReference.startsWith(keyPrefix) ||
    typeof versionId !== "string" ||
    !versionId
  ) {
    fail("file_version_missing");
  }
  const key = sourceReference.slice(keyPrefix.length);
  if (key.startsWith("zip-jobs/")) fail("zip_artifact_not_replayable");
  const result = await context.clients.s3.send(
    new GetObjectCommand({
      Bucket: context.outputs.value.bucketNames.FilesBucket,
      Key: key,
      VersionId: versionId,
    }),
  );
  const filePath = join(checkpoint.directory, `${sha256(sourceReference)}.bin`);
  if (existsSync(filePath)) rmSync(filePath, { force: true });
  const bytes = await writeObjectToPrivateFile(result, filePath);
  const digest = sha256(bytes);
  if (
    Number.isSafeInteger(action.after.size) &&
    action.after.size !== bytes.length
  ) {
    fail("file_size_mismatch");
  }
  let uploaded;
  try {
    await assertReplayControl(context, { write: true });
    uploaded = await bridge.request({
      operation: "upload_private_file",
      path: filePath,
      name: `rollback-${digest.slice(0, 16)}.bin`,
      contentType: action.after.content_type ?? "application/octet-stream",
    });
  } catch {
    // Base44 exposes no safe content-hash enumeration for an ambiguous upload.
    fail("unobservable_ambiguous_upload_blocker");
  } finally {
    rmSync(filePath, { force: true });
  }
  if (typeof uploaded.file_uri !== "string" || !uploaded.file_uri) {
    fail("base44_upload_invalid");
  }
  checkpoint.state.fileMappings[sourceReference] = {
    base44Uri: uploaded.file_uri,
    contentSha256: digest,
    byteLength: bytes.length,
    deleted: false,
  };
  return true;
}

async function writeOperationReceipt(context, plan, group, checkpoint) {
  const sequence = sha256(`${context.control.run_id}:${group.operationId}`);
  const item = {
    scope: "REVERSE_REPLAY",
    sequence,
    item_type: "REPLAY_OPERATION_RECEIPT",
    run_id: context.control.run_id,
    operation_sha256: sha256(Buffer.from(canonicalJson(group.entries), "utf8")),
    range_sha256: plan.rangeSha256,
    projected_state_sha256: plan.projection.projectionSha256,
    completed_at: new Date().toISOString(),
  };
  try {
    await context.clients.dynamo.send(
      new PutCommand({
        TableName: context.outputs.changeJournalTableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(#scope)",
        ExpressionAttributeNames: { "#scope": "scope" },
      }),
    );
  } catch (error) {
    const observed = await context.clients.dynamo.send(
      new GetCommand({
        TableName: context.outputs.changeJournalTableName,
        Key: { scope: item.scope, sequence: item.sequence },
        ConsistentRead: true,
      }),
    );
    if (!observed.Item || canonicalJson(observed.Item) !== canonicalJson(item)) {
      fail("replay_receipt_ambiguous", error);
    }
  }
  checkpoint.state.completedOperations[group.operationId] = item.operation_sha256;
  checkpoint.save();
}

export async function replayPlan(
  context,
  plan,
  { bridge = new Base44ReplayBridge(context.target), resume = false, pauseAfterOperations } = {},
) {
  await assertReplayControl(context);
  const checkpoint = openReplayCheckpoint(context, plan, bridge.sourceSha256 ?? "test", { resume });
  checkpoint.context = context;
  context.planProjectionState = plan.projection.state;
  let completedThisRun = 0;
  let writesThisRun = 0;
  try {
    for (const group of plan.groups) {
      await assertReplayControl(context);
      const groupHash = sha256(Buffer.from(canonicalJson(group.entries), "utf8"));
      const already = checkpoint.state.completedOperations[group.operationId];
      if (already) {
        if (already !== groupHash) fail("checkpoint_operation_mismatch");
        continue;
      }
      for (const action of dependencyOrderActions(
        plan.projection.actions.filter(
          (candidate) => candidate.groupId === group.operationId,
        ),
      )) {
        const wrote =
          action.entity === "File"
            ? await convergeFileAction(action, checkpoint, bridge, context)
            : await convergeEntityAction(action, checkpoint, bridge);
        if (wrote) {
          writesThisRun += 1;
          checkpoint.state.writes += 1;
          checkpoint.save();
        }
      }
      await assertReplayControl(context);
      await writeOperationReceipt(context, plan, group, checkpoint);
      completedThisRun += 1;
      if (pauseAfterOperations && completedThisRun >= pauseAfterOperations) {
        fail("operator_pause_after_checkpoint");
      }
    }
    checkpoint.state.status = "complete";
    checkpoint.state.lastRunWrites = writesThisRun;
    checkpoint.state.completedAt = new Date().toISOString();
    checkpoint.save();
    return {
      status: "complete",
      operations: plan.groups.length,
      writes: writesThisRun,
      totalWrites: checkpoint.state.writes,
    };
  } finally {
    checkpoint.close();
  }
}

async function readMappedFile(mapping, bridge, fetchImpl = fetch) {
  if (mapping.deleted) {
    await assertBase44FileAbsent(bridge, mapping.base44Uri);
    return { deleted: true };
  }
  const signed = await bridge.request({
    operation: "sign_file",
    file_uri: mapping.base44Uri,
    expires_in: 300,
  });
  const response = await fetchImpl(signed.signed_url, { redirect: "error" });
  if (!response.ok) fail("base44_file_read_failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  return { deleted: false, byteLength: bytes.length, contentSha256: sha256(bytes) };
}

export async function reconcilePlan(
  context,
  plan,
  { bridge = new Base44ReplayBridge(context.target), fetchImpl = fetch } = {},
) {
  const checkpoint = openReplayCheckpoint(context, plan, bridge.sourceSha256 ?? "test", {
    resume: true,
  });
  try {
    if (checkpoint.state.status !== "complete") fail("replay_incomplete");
    let missing = 0;
    let extra = 0;
    let drift = 0;
    const entityCounts = {};
    for (const entity of ENTITY_NAMES) {
      const actual = await bridge.listAll(entity);
      const expected = Object.values(plan.projection.state[entity] ?? {});
      const expectedById = new Map(
        expected.map((record) => [
          checkpoint.state.idMappings[`${entity}:${record.id}`] ?? record.id,
          record,
        ]),
      );
      const actualById = new Map(actual.map((record) => [record.id, record]));
      for (const [id, expectedRecord] of expectedById) {
        const observed = actualById.get(id);
        if (!observed) missing += 1;
        else if (
          !desiredRecordObserved(
            observed,
            entity === "User"
              ? projectedUser(expectedRecord, checkpoint.state.fileMappings)
              : checkpoint.state.idMappings[`${entity}:${expectedRecord.id}`]
                ? projectMappedBase44Record(
                    expectedRecord,
                    checkpoint.state.fileMappings,
                    checkpoint.state.idMappings,
                  )
                : projectBase44Record(
                    expectedRecord,
                    checkpoint.state.fileMappings,
                    checkpoint.state.idMappings,
                  ),
          )
        ) {
          drift += 1;
        }
      }
      const unmatched = [...actualById.entries()].filter(([id]) => !expectedById.has(id));
      if (
        entity === "User" &&
        unmatched.length === 1 &&
        unmatched[0][1]?.role === "admin"
      ) {
        // A private Base44 application always retains one platform owner. It is
        // operational target state, not an AWS business row.
      } else {
        extra += unmatched.length;
      }
      entityCounts[entity] = { expected: expected.length, actual: actual.length };
    }
    let fileDrift = 0;
    let activeFiles = 0;
    let deletedFiles = 0;
    let fileBytes = 0;
    for (const mapping of Object.values(checkpoint.state.fileMappings)) {
      if (mapping.deleted) {
        deletedFiles += 1;
        continue;
      }
      activeFiles += 1;
      const observed = await readMappedFile(mapping, bridge, fetchImpl);
      if (
        observed.deleted ||
        observed.byteLength !== mapping.byteLength ||
        observed.contentSha256 !== mapping.contentSha256
      ) {
        fileDrift += 1;
      }
      fileBytes += mapping.byteLength;
    }
    const result = {
      status: missing + extra + drift + fileDrift === 0 ? "passed" : "failed",
      entityCounts,
      missing,
      extra,
      drift,
      files: { active: activeFiles, deleted: deletedFiles, bytes: fileBytes, drift: fileDrift },
      checkedAt: new Date().toISOString(),
    };
    checkpoint.state.reconciliation = result;
    checkpoint.save();
    if (result.status !== "passed") fail("reconciliation_drift");
    return result;
  } finally {
    checkpoint.close();
  }
}

const EVIDENCE_FORBIDDEN_KEYS = /(?:path|url|uri|email|token|secret|password|snapshot|checkpoint|resource|id$)/i;

export function assertAggregateEvidencePrivacy(value, path = "evidence") {
  if (typeof value === "string") {
    if (value.includes("://") || value.includes("\\") || value.includes("@")) {
      fail("evidence_privacy_violation");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertAggregateEvidencePrivacy(entry, `${path}.${index}`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (EVIDENCE_FORBIDDEN_KEYS.test(key)) fail("evidence_privacy_violation");
    assertAggregateEvidencePrivacy(entry, `${path}.${key}`);
  }
}

export function buildAggregateEvidence(context, plan, checkpointState, now = new Date()) {
  const reconciliation = checkpointState.reconciliation;
  if (checkpointState.status !== "complete" || reconciliation?.status !== "passed") {
    fail("evidence_requires_zero_drift");
  }
  const evidence = {
    artifactType: "base44-reverse-replay-verification",
    schemaVersion: 1,
    toolVersion: REPLAY_TOOL_VERSION,
    bridgeVersion: BASE44_REPLAY_BRIDGE_VERSION,
    stage: context.stage,
    status: "passed",
    verifiedAt: now.toISOString(),
    range: {
      startCursor: plan.range.fromExclusive,
      endCursor: plan.range.toInclusive,
      entryCount: plan.range.toInclusive - plan.range.fromExclusive,
      operationCount: plan.groups.length,
    },
    mutations: plan.counts,
    files: reconciliation.files,
    totals: {
      entityMissing: reconciliation.missing,
      entityExtra: reconciliation.extra,
      entityDrift: reconciliation.drift,
      blockerCount: 0,
      totalWrites: checkpointState.writes,
      zeroWriteRerun: checkpointState.lastRunWrites === 0,
    },
    gates: {
      exactRangeBound: true,
      interruptionResumed: checkpointState.resumed === true,
      zeroDrift: true,
      productionUntouched: context.stage === "test",
    },
  };
  assertAggregateEvidencePrivacy(evidence);
  return evidence;
}

function createAwsClients() {
  const dynamoSdk = DynamoDBDocumentClient.from(new DynamoDBClient({ region: AWS_REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });
  const s3Sdk = new S3Client({ region: AWS_REGION });
  return {
    dynamo: { send: (command) => dynamoSdk.send(command) },
    s3: { send: (command) => s3Sdk.send(command) },
  };
}

export class OperatorMaintenanceControl {
  constructor(client, tableName, clock = () => new Date(), storage = undefined) {
    this.client = client;
    this.tableName = tableName;
    this.clock = clock;
    this.storage = storage;
  }

  async getControl() {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { scope: "MAINTENANCE_CONTROL", sequence: "!CONTROL" },
        ConsistentRead: true,
      }),
    );
    if (!result.Item) return undefined;
    const item = result.Item;
    if (
      !["OPEN", "MAINTENANCE", "ROLLED_BACK"].includes(item.mode) ||
      !Number.isSafeInteger(item.generation) ||
      item.generation < 1
    ) {
      fail("maintenance_control_invalid");
    }
    return item;
  }

  async cursor() {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { scope: "GLOBAL", sequence: "!CURSOR" },
        ConsistentRead: true,
      }),
    );
    const cursor = result.Item?.last_sequence ?? 0;
    if (!Number.isSafeInteger(cursor) || cursor < 0) fail("journal_cursor_invalid");
    return cursor;
  }

  async bootstrap() {
    if (await this.getControl()) fail("maintenance_already_bootstrapped");
    const now = this.clock().toISOString();
    const control = {
      scope: "MAINTENANCE_CONTROL",
      sequence: "!CONTROL",
      item_type: "MAINTENANCE_CONTROL",
      mode: "OPEN",
      generation: 1,
      replay_state: "NOT_STARTED",
      updated_at: now,
    };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: control,
              ConditionExpression: "attribute_not_exists(#scope)",
              ExpressionAttributeNames: { "#scope": "scope" },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: {
                scope: "MAINTENANCE_ACTIVITY",
                sequence: "!COUNTER",
                item_type: "MAINTENANCE_ACTIVITY_COUNTER",
                active_count: 0,
                updated_at: now,
              },
              ConditionExpression: "attribute_not_exists(#scope)",
              ExpressionAttributeNames: { "#scope": "scope" },
            },
          },
        ],
      }),
    );
    return control;
  }

  controlCondition(control, mode = control.mode) {
    return {
      TableName: this.tableName,
      Key: { scope: "MAINTENANCE_CONTROL", sequence: "!CONTROL" },
      ConditionExpression: "#mode = :mode AND #generation = :generation",
      ExpressionAttributeNames: { "#mode": "mode", "#generation": "generation" },
      ExpressionAttributeValues: { ":mode": mode, ":generation": control.generation },
    };
  }

  async resolveActiveIntent(control, intent, status) {
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { ConditionCheck: this.controlCondition(control, "OPEN") },
          {
            Update: {
              TableName: this.tableName,
              Key: { scope: "EXTERNAL_ACTIVITY", sequence: intent.sequence },
              UpdateExpression: "SET #status = :status, #updated_at = :now",
              ConditionExpression: "#status = :active AND #generation = :generation",
              ExpressionAttributeNames: {
                "#status": "status",
                "#updated_at": "updated_at",
                "#generation": "generation",
              },
              ExpressionAttributeValues: {
                ":status": status,
                ":active": "ACTIVE",
                ":generation": intent.generation,
                ":now": this.clock().toISOString(),
              },
            },
          },
          {
            Update: {
              TableName: this.tableName,
              Key: { scope: "MAINTENANCE_ACTIVITY", sequence: "!COUNTER" },
              UpdateExpression: "SET #updated_at = :now ADD #active_count :minus_one",
              ConditionExpression: "#active_count > :zero",
              ExpressionAttributeNames: {
                "#updated_at": "updated_at",
                "#active_count": "active_count",
              },
              ExpressionAttributeValues: {
                ":now": this.clock().toISOString(),
                ":minus_one": -1,
                ":zero": 0,
              },
            },
          },
        ],
      }),
    );
  }

  async fileCreateReceipt(reference) {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { scope: "FILE_OPERATION", sequence: sha256(`create:${reference}`) },
        ConsistentRead: true,
      }),
    );
    return result.Item;
  }

  async settleExpiredUploadIntents(control, intents) {
    for (const intent of intents) {
      if (intent.activity_type !== "UPLOAD_CAPABILITY" || intent.status !== "ACTIVE") continue;
      if (
        intent.generation > control.generation ||
        typeof intent.expires_at !== "string" ||
        Date.parse(intent.expires_at) > this.clock().getTime() ||
        typeof intent.resource_reference !== "string" ||
        !intent.resource_reference.startsWith("private://files/firms/ddcpa/")
      ) {
        fail("maintenance_not_quiescent");
      }
      if (!this.storage?.s3 || !this.storage.bucketName) fail("storage_binding_missing");
      const key = intent.resource_reference.slice("private://files/".length);
      let objectExists = true;
      try {
        await this.storage.s3.send(
          new HeadObjectCommand({ Bucket: this.storage.bucketName, Key: key }),
        );
      } catch (error) {
        const statusCode = error?.$metadata?.httpStatusCode;
        if (error?.name === "NoSuchKey" || error?.name === "NotFound" || statusCode === 404) {
          objectExists = false;
        } else {
          fail("s3_preflight_failed", error);
        }
      }
      const receipt = objectExists
        ? await this.fileCreateReceipt(intent.resource_reference)
        : undefined;
      if (objectExists && !receipt) fail("orphan_upload_blocker");
      await this.resolveActiveIntent(control, intent, objectExists ? "RESOLVED" : "CANCELLED");
    }
  }

  async assertNoUnjournaledOwnedObjects() {
    if (!this.storage?.s3 || !this.storage.bucketName) fail("storage_binding_missing");
    let continuationToken;
    do {
      const result = await this.storage.s3.send(
        new ListObjectsV2Command({
          Bucket: this.storage.bucketName,
          Prefix: "firms/ddcpa/",
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      );
      for (const object of result.Contents ?? []) {
        const key = object["Key"];
        if (typeof key !== "string" || !key) fail("s3_inventory_invalid");
        const reference = `private://files/${key}`;
        if (!(await this.fileCreateReceipt(reference))) fail("orphan_upload_blocker");
      }
      continuationToken = result.NextContinuationToken;
    } while (continuationToken);
  }

  async markStart(baseline, targetFingerprintSha256) {
    const control = await this.getControl();
    if (!control || control.mode !== "OPEN" || control.cutover_start_cursor !== undefined) {
      fail("maintenance_start_invalid");
    }
    const cursor = await this.cursor();
    if (cursor !== baseline.lastAppliedGlobalCursor) fail("snapshot_cursor_mismatch");
    const next = {
      ...control,
      generation: control.generation + 1,
      cutover_start_cursor: cursor,
      run_id: randomUUID(),
      manifest_sha256: baseline.manifestSha256,
      baseline_projection_sha256: baseline.projectionSha256,
      target_fingerprint_sha256: targetFingerprintSha256,
      replay_state: "READY",
      updated_at: this.clock().toISOString(),
    };
    const cursorCondition =
      cursor === 0
        ? {
            TableName: this.tableName,
            Key: { scope: "GLOBAL", sequence: "!CURSOR" },
            ConditionExpression: "attribute_not_exists(#scope)",
            ExpressionAttributeNames: { "#scope": "scope" },
          }
        : {
            TableName: this.tableName,
            Key: { scope: "GLOBAL", sequence: "!CURSOR" },
            ConditionExpression: "#last_sequence = :cursor",
            ExpressionAttributeNames: { "#last_sequence": "last_sequence" },
            ExpressionAttributeValues: { ":cursor": cursor },
          };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          { ConditionCheck: cursorCondition },
          {
            Put: {
              TableName: this.tableName,
              Item: next,
              ConditionExpression:
                "#mode = :open AND #generation = :generation AND attribute_not_exists(#cutover_start_cursor)",
              ExpressionAttributeNames: {
                "#mode": "mode",
                "#generation": "generation",
                "#cutover_start_cursor": "cutover_start_cursor",
              },
              ExpressionAttributeValues: {
                ":open": "OPEN",
                ":generation": control.generation,
              },
            },
          },
        ],
      }),
    );
    return next;
  }

  async close() {
    const control = await this.getControl();
    if (!control || control.mode !== "OPEN" || !Number.isSafeInteger(control.cutover_start_cursor)) {
      fail("maintenance_close_invalid");
    }
    const [cursor, initialIntents, reconciliations, resolutions] = await Promise.all([
      this.cursor(),
      queryScope(this.client, this.tableName, "EXTERNAL_ACTIVITY"),
      queryScope(this.client, this.tableName, "FILE_RECONCILIATION"),
      queryScope(this.client, this.tableName, "RECONCILIATION_RESOLUTION"),
    ]);
    const resolved = new Set(
      resolutions.map((item) => `${item.source_scope}\0${item.source_sequence}`),
    );
    if (
      reconciliations.some(
        (item) => !resolved.has(`FILE_RECONCILIATION\0${item.sequence}`),
      )
    ) {
      fail("maintenance_not_quiescent");
    }
    await this.settleExpiredUploadIntents(control, initialIntents);
    await this.assertNoUnjournaledOwnedObjects();
    const [counter, intents] = await Promise.all([
      this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { scope: "MAINTENANCE_ACTIVITY", sequence: "!COUNTER" },
          ConsistentRead: true,
        }),
      ),
      queryScope(this.client, this.tableName, "EXTERNAL_ACTIVITY"),
    ]);
    if (
      counter.Item?.active_count !== 0 ||
      intents.some((intent) => intent.status === "ACTIVE")
    ) {
      fail("maintenance_not_quiescent");
    }
    const next = {
      ...control,
      mode: "MAINTENANCE",
      generation: control.generation + 1,
      boundary_end_cursor: cursor,
      updated_at: this.clock().toISOString(),
    };
    const cursorCondition =
      cursor === 0
        ? {
            TableName: this.tableName,
            Key: { scope: "GLOBAL", sequence: "!CURSOR" },
            ConditionExpression: "attribute_not_exists(#scope)",
            ExpressionAttributeNames: { "#scope": "scope" },
          }
        : {
            TableName: this.tableName,
            Key: { scope: "GLOBAL", sequence: "!CURSOR" },
            ConditionExpression: "#last_sequence = :cursor",
            ExpressionAttributeNames: { "#last_sequence": "last_sequence" },
            ExpressionAttributeValues: { ":cursor": cursor },
          };
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            ConditionCheck: cursorCondition,
          },
          {
            ConditionCheck: {
              TableName: this.tableName,
              Key: { scope: "MAINTENANCE_ACTIVITY", sequence: "!COUNTER" },
              ConditionExpression: "#active_count = :zero",
              ExpressionAttributeNames: { "#active_count": "active_count" },
              ExpressionAttributeValues: { ":zero": 0 },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: next,
              ConditionExpression: "#mode = :open AND #generation = :generation",
              ExpressionAttributeNames: { "#mode": "mode", "#generation": "generation" },
              ExpressionAttributeValues: {
                ":open": "OPEN",
                ":generation": control.generation,
              },
            },
          },
        ],
      }),
    );
    return next;
  }

  async setReplayState(state, expectedStates) {
    const control = await this.getControl();
    if (
      !control ||
      control.mode !== "MAINTENANCE" ||
      !expectedStates.includes(control.replay_state)
    ) {
      fail("replay_transition_invalid");
    }
    const mode = state === "ROLLED_BACK" ? "ROLLED_BACK" : "MAINTENANCE";
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { scope: "MAINTENANCE_CONTROL", sequence: "!CONTROL" },
        UpdateExpression:
          "SET #mode = :next_mode, #replay_state = :state, #updated_at = :now ADD #generation :one",
        ConditionExpression:
          "#mode = :maintenance AND #generation = :generation AND #replay_state = :expected",
        ExpressionAttributeNames: {
          "#mode": "mode",
          "#replay_state": "replay_state",
          "#updated_at": "updated_at",
          "#generation": "generation",
        },
        ExpressionAttributeValues: {
          ":next_mode": mode,
          ":state": state,
          ":now": this.clock().toISOString(),
          ":one": 1,
          ":maintenance": "MAINTENANCE",
          ":generation": control.generation,
          ":expected": control.replay_state,
        },
      }),
    );
    return this.getControl();
  }

  abort() {
    return this.setReplayState("ABORTED", ["READY", "IN_PROGRESS"]);
  }

  rolledBack() {
    return this.setReplayState("ROLLED_BACK", ["RECONCILED"]);
  }

  async resumeAwsWrites(confirmNoReplayWrites) {
    const control = await this.getControl();
    if (
      !confirmNoReplayWrites ||
      !control ||
      control.mode !== "MAINTENANCE" ||
      !["READY", "ABORTED"].includes(control.replay_state)
    ) {
      fail("resume_aws_writes_forbidden");
    }
    const next = {
      scope: "MAINTENANCE_CONTROL",
      sequence: "!CONTROL",
      item_type: "MAINTENANCE_CONTROL",
      mode: "OPEN",
      generation: control.generation + 1,
      replay_state: "NOT_STARTED",
      updated_at: this.clock().toISOString(),
    };
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: next,
        ConditionExpression: "#mode = :maintenance AND #generation = :generation",
        ExpressionAttributeNames: { "#mode": "mode", "#generation": "generation" },
        ExpressionAttributeValues: {
          ":maintenance": "MAINTENANCE",
          ":generation": control.generation,
        },
      }),
    );
    return next;
  }
}

export async function runCapabilityMatrix(
  target,
  {
    bridge = new Base44ReplayBridge(target),
    fixture,
    confirm = false,
    confirmInvitationLogin = false,
    fetchImpl = fetch,
  } = {},
) {
  bridge.assertRuntimeVersions?.();
  const candidate = fixture ?? target.value.capability_probe;
  if (confirm && !isRecord(candidate)) fail("capability_fixture_missing");
  const counts = {};
  const initialRecords = {};
  for (const entity of ENTITY_NAMES) {
    initialRecords[entity] = await bridge.listAll(entity, 1);
    counts[entity] = initialRecords[entity].length;
  }
  let ownerUser = initialRecords.User[0];
  let invitedUser = undefined;
  let invitationEmail = undefined;
  if (
    counts.User === 2 &&
    confirm &&
    isRecord(candidate) &&
    typeof candidate.invitation_email === "string"
  ) {
    for (const possibleOwner of initialRecords.User) {
      if (
        !isRecord(possibleOwner) ||
        typeof possibleOwner.email !== "string" ||
        !possibleOwner.email
      ) {
        continue;
      }
      let possibleInvitation;
      try {
        possibleInvitation = capabilityInvitationEmail(
          candidate.invitation_email,
          possibleOwner.email,
        );
      } catch {
        continue;
      }
      const possibleInvited = initialRecords.User.find(
        (record) =>
          record !== possibleOwner &&
          typeof record?.email === "string" &&
          record.email.trim().toLowerCase() === possibleInvitation.trim().toLowerCase(),
      );
      if (possibleInvited) {
        ownerUser = possibleOwner;
        invitedUser = possibleInvited;
        invitationEmail = possibleInvitation;
        break;
      }
    }
  }
  if (
    ENTITY_NAMES.filter((entity) => entity !== "User").some((entity) => counts[entity] !== 0) ||
    ![1, 2].includes(counts.User) ||
    (counts.User === 2 && (!invitedUser || !confirmInvitationLogin)) ||
    !isRecord(ownerUser) ||
    typeof ownerUser.id !== "string" ||
    !ownerUser.id ||
    typeof ownerUser.email !== "string" ||
    !ownerUser.email ||
    ownerUser.role !== "admin"
  ) {
    fail("target_not_empty");
  }
  if (!confirm) {
    return { status: "read_only", entityCounts: counts, platformOwnerBaselineUsers: 1 };
  }
  const crudEntities = CAPABILITY_ENTITY_ORDER;
  if (
    !isRecord(candidate) ||
    !isRecord(candidate.entity_records) ||
    !isRecord(candidate.updated_entity_records) ||
    !isRecord(candidate.pagination_client_record) ||
    !isRecord(candidate.user_update) ||
    typeof candidate.invitation_email !== "string" ||
    typeof candidate.private_file_path !== "string" ||
    candidate.invitation_email.trim().toLowerCase() === ownerUser.email.trim().toLowerCase()
  ) {
    fail("capability_fixture_missing");
  }
  for (const entity of crudEntities) {
    const createdRecord = candidate.entity_records[entity];
    const updatedRecord = candidate.updated_entity_records[entity];
    if (
      !isRecord(createdRecord) ||
      !isRecord(updatedRecord) ||
      typeof createdRecord.id !== "string" ||
      !createdRecord.id ||
      updatedRecord.id !== createdRecord.id ||
      typeof createdRecord.created_date !== "string" ||
      typeof createdRecord.updated_date !== "string"
    ) {
      fail("capability_fixture_missing");
    }
  }
  if (
    typeof candidate.pagination_client_record.id !== "string" ||
    !candidate.pagination_client_record.id ||
    candidate.pagination_client_record.id === candidate.entity_records.Client.id
  ) {
    fail("capability_fixture_missing");
  }
  invitationEmail ??= capabilityInvitationEmail(candidate.invitation_email, ownerUser.email);
  if (invitationEmail.trim().toLowerCase() === ownerUser.email.trim().toLowerCase()) {
    fail("capability_fixture_missing");
  }
  const filePath = requirePrivatePath(
    isAbsolute(candidate.private_file_path)
      ? candidate.private_file_path
      : join(target.value.local_paths.fixture_root, candidate.private_file_path),
  );
  const created = [];
  const idMappings = {};
  let uploaded;
  let fileDeletionObserved = false;
  let invitationPending = false;
  try {
    for (const entity of crudEntities) {
      const record = candidate.entity_records[entity];
      const cleanupRecord = { entity, id: record.id };
      created.push(cleanupRecord);
      const desired = projectMappedBase44Record(record, {}, idMappings);
      let result;
      try {
        result = await bridge.request({ operation: "create", entity, record: desired });
      } catch {
        // An ambiguous create is safe only when its source alias is observable below.
      }
      if (typeof result?.record?.id === "string" && result.record.id) {
        cleanupRecord.id = result.record.id;
      }
      const observed = await observeRecordBySourceId(bridge, entity, record.id);
      if (
        !desiredRecordObserved(observed, desired) ||
        typeof observed?.id !== "string" ||
        !observed.id
      ) {
        fail("base44_source_alias_blocker");
      }
      cleanupRecord.id = observed.id;
      idMappings[`${entity}:${record.id}`] = observed.id;
    }
    const paginationRecord = candidate.pagination_client_record;
    const paginationCleanup = { entity: "Client", id: paginationRecord.id };
    created.push(paginationCleanup);
    const paginationDesired = projectMappedBase44Record(paginationRecord, {}, idMappings);
    let paginationResult;
    try {
      paginationResult = await bridge.request({
        operation: "create",
        entity: "Client",
        record: paginationDesired,
      });
    } catch {
      // An ambiguous create is safe only when its source alias is observable below.
    }
    if (
      typeof paginationResult?.record?.id === "string" &&
      paginationResult.record.id
    ) {
      paginationCleanup.id = paginationResult.record.id;
    }
    const observedPagination = await observeRecordBySourceId(
      bridge,
      "Client",
      paginationRecord.id,
    );
    if (
      !desiredRecordObserved(observedPagination, paginationDesired) ||
      typeof observedPagination?.id !== "string" ||
      !observedPagination.id
    ) {
      fail("base44_source_alias_blocker");
    }
    paginationCleanup.id = observedPagination.id;
    idMappings[`Client:${paginationRecord.id}`] = observedPagination.id;
    const paginatedClients = await bridge.listAll("Client", 1);
    const paginatedIds = new Set(paginatedClients.map((record) => record.id));
    if (
      !paginatedIds.has(idMappings[`Client:${candidate.entity_records.Client.id}`]) ||
      !paginatedIds.has(idMappings[`Client:${paginationRecord.id}`])
    ) {
      fail("base44_pagination_blocker");
    }
    for (const entity of crudEntities) {
      const record = candidate.updated_entity_records[entity];
      const desired = projectMappedBase44Record(record, {}, idMappings);
      const assignedId = idMappings[`${entity}:${record.id}`];
      await bridge.request({ operation: "update", entity, id: assignedId, record: desired });
      if (!desiredRecordObserved(await observeRecord(bridge, entity, assignedId), desired)) {
        fail("base44_update_not_observed");
      }
    }

    if (!invitedUser) {
      try {
        await bridge.request({
          operation: "invite_user",
          email: invitationEmail,
          role: "admin",
        });
      } catch {
        // The invitation is accepted only after user activation is observed.
      }
      invitedUser = await observeUserByEmail(bridge, invitationEmail);
    }
    if (!invitedUser || !confirmInvitationLogin) {
      invitationPending = true;
    } else {
      if (typeof invitedUser.id !== "string" || !invitedUser.id) {
        fail("base44_invitation_unobservable");
      }
      try {
        await bridge.request({
          operation: "invite_user",
          email: invitationEmail,
          role: "admin",
        });
      } catch {
        // Retry equivalence is proved by destination observation, not response shape.
      }
      const retriedUser = await observeUserByEmail(bridge, invitationEmail);
      if (!retriedUser || retriedUser.id !== invitedUser.id) {
        fail("base44_invitation_retry_blocker");
      }
      await bridge.request({
        operation: "update",
        entity: "User",
        id: invitedUser.id,
        record: candidate.user_update,
      });
      if (
        !desiredRecordObserved(
          await observeUserByEmail(bridge, invitationEmail),
          candidate.user_update,
        )
      ) {
        fail("base44_update_not_observed");
      }
    }

    const originalBytes = readFileSync(filePath);
    uploaded = await bridge.request({
      operation: "upload_private_file",
      path: filePath,
      name: "capability.bin",
      contentType: "application/octet-stream",
    });
    const signed = await bridge.request({
      operation: "sign_file",
      file_uri: uploaded.file_uri,
      expires_in: 300,
    });
    const response = await fetchImpl(signed.signed_url, { redirect: "error" });
    const downloaded = Buffer.from(await response.arrayBuffer());
    if (!response.ok || sha256(downloaded) !== sha256(originalBytes)) {
      fail("base44_private_file_mismatch");
    }
    await bridge.request({ operation: "delete_file", file_uri: uploaded.file_uri });
    try {
      await assertBase44FileAbsent(bridge, uploaded.file_uri);
      fileDeletionObserved = true;
    } catch {
      fileDeletionObserved = false;
    }
    if (!fileDeletionObserved) fail("base44_file_delete_unobservable");

    for (const record of [...created].reverse()) {
      await bridge.request({ operation: "delete", entity: record.entity, id: record.id });
      if (await observeRecord(bridge, record.entity, record.id)) fail("base44_delete_not_observed");
    }
    created.length = 0;
    if (!invitationPending) {
      await bridge.request({ operation: "delete", entity: "User", id: invitedUser.id });
      if (await observeUserByEmail(bridge, invitationEmail)) {
        fail("base44_delete_not_observed");
      }
      invitedUser = undefined;
    }
  } finally {
    if (uploaded && !fileDeletionObserved) {
      try {
        await bridge.request({ operation: "delete_file", file_uri: uploaded.file_uri });
      } catch {
        // Leave the target blocked if cleanup cannot be observed.
      }
    }
    for (const record of [...created].reverse()) {
      try {
        await bridge.request({ operation: "delete", entity: record.entity, id: record.id });
      } catch {
        // The next empty-enumeration gate exposes incomplete cleanup.
      }
    }
    if (invitedUser?.id && !invitationPending) {
      try {
        await bridge.request({ operation: "delete", entity: "User", id: invitedUser.id });
      } catch {
        // The next owner-only enumeration gate exposes incomplete cleanup.
      }
    }
  }
  for (const entity of ENTITY_NAMES.filter((entity) => entity !== "User")) {
    if ((await bridge.listAll(entity, 1)).length !== 0) fail("capability_cleanup_incomplete");
  }
  const retainedUsers = await bridge.listAll("User", 1);
  if (invitationPending) {
    if (
      retainedUsers.length < 1 ||
      retainedUsers.length > 2 ||
      !retainedUsers.some((record) => record.id === ownerUser.id)
    ) {
      fail("capability_cleanup_incomplete");
    }
    return {
      status: "pending_invitation_acceptance",
      gates: {
        assignedIdsMapped: true,
        sourceAliasesObserved: true,
        sourceTimestampsPreserved: true,
        allEntityCrudObserved: true,
        privateUploadReadDeleteObserved: true,
        paginationObserved: true,
      },
    };
  }
  if (
    retainedUsers.length !== 1 ||
    retainedUsers[0].id !== ownerUser.id
  ) {
    fail("capability_cleanup_incomplete");
  }
  const result = {
    schemaVersion: 2,
    status: "passed",
    toolVersion: REPLAY_TOOL_VERSION,
    bridgeVersion: BASE44_REPLAY_BRIDGE_VERSION,
    targetFingerprintSha256: target.fingerprintSha256,
    entityCount: ENTITY_NAMES.length,
    gates: {
      emptyBusinessStart: true,
      platformOwnerBaselineObserved: true,
      assignedIdsMapped: true,
      sourceAliasesObserved: true,
      sourceTimestampsPreserved: true,
      allEntityCrudObserved: true,
      invitationObservedAndRetrySafe: true,
      privateUploadReadDeleteObserved: true,
      paginationObserved: true,
    },
    verifiedAt: new Date().toISOString(),
  };
  const root = requirePrivatePath(target.value.local_paths.private_evidence_root);
  const path = join(root, "capability-matrix.json");
  if (existsSync(path)) fail("capability_evidence_already_exists");
  atomicWriteJson(path, result);
  return { status: result.status, gates: result.gates };
}

const COMMANDS = new Set([
  "doctor",
  "capabilities",
  "maintenance-bootstrap",
  "mark-cutover-start",
  "rehearsal-fixtures",
  "maintenance-close",
  "maintenance-status",
  "plan",
  "replay",
  "reconcile",
  "evidence",
  "abort-replay",
  "resume-aws-writes",
  "successful-rollback",
]);
const BOOLEAN_FLAGS = new Set([
  "dry-run",
  "resume",
  "confirm-controlled-rehearsal",
  "confirm-invitation-login",
  "confirm-actual-rollback",
  "confirm-no-replay-writes",
]);
const VALUE_FLAGS = new Set([
  "stage",
  "target-descriptor",
  "snapshot",
  "outputs",
  "output",
  "fixture",
  "from-exclusive",
  "to-inclusive",
]);

function rejectSensitiveArguments(argv) {
  if (
    argv.some((value) =>
      /(?:token|password|secret|credential|app-id|app-url|email|file-uri|signed-url)/i.test(value),
    )
  ) {
    fail("sensitive_argument_rejected");
  }
}

export function parseArguments(argv) {
  rejectSensitiveArguments(argv);
  const [command, ...values] = argv;
  if (!COMMANDS.has(command)) fail("invalid_arguments");
  const parsed = { command };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    if (!flag?.startsWith("--")) fail("invalid_arguments");
    const key = flag.slice(2);
    if (Object.hasOwn(parsed, key)) fail("invalid_arguments");
    if (BOOLEAN_FLAGS.has(key)) parsed[key] = true;
    else if (
      VALUE_FLAGS.has(key) &&
      typeof values[index + 1] === "string" &&
      !values[index + 1].startsWith("--")
    ) {
      parsed[key] = values[index + 1];
      index += 1;
    } else fail("invalid_arguments");
  }
  if (!parsed.stage || !parsed["target-descriptor"]) fail("invalid_arguments");
  if (!['test', 'production'].includes(parsed.stage)) fail("stage_invalid");
  if (parsed.stage === "production" && parsed["confirm-actual-rollback"] !== true) {
    fail("production_confirmation_required");
  }
  if (parsed.stage === "test" && parsed["confirm-actual-rollback"]) {
    fail("stage_confirmation_mismatch");
  }
  if (parsed.command === "plan" && parsed["dry-run"] !== true) fail("dry_run_required");
  if (parsed.command !== "plan" && parsed["dry-run"]) fail("invalid_arguments");
  if (parsed.command !== "replay" && parsed.resume) fail("invalid_arguments");
  if (parsed.command === "evidence" && !parsed.output) fail("invalid_arguments");
  if (parsed.command !== "evidence" && parsed.output) fail("invalid_arguments");
  return parsed;
}

function requireControlledConfirmation(arguments_) {
  if (
    arguments_.stage === "test" &&
    arguments_["confirm-controlled-rehearsal"] !== true
  ) {
    fail("controlled_rehearsal_confirmation_required");
  }
}

function requireExactRehearsalDescriptor(arguments_, dependencies) {
  if (dependencies.allowAnyDescriptorPath) return;
  const expected = resolve(
    "C:\\Users\\ntzur\\Documents\\Codex\\AuditFlow\\rollback-replay\\rehearsal-target.json",
  );
  if (arguments_.stage === "test" && resolve(arguments_["target-descriptor"]) !== expected) {
    fail("target_descriptor_path_invalid");
  }
}

async function loadCommandContext(arguments_, dependencies = {}, { baseline = true } = {}) {
  requireExactRehearsalDescriptor(arguments_, dependencies);
  const target =
    dependencies.target ??
    loadTargetDescriptor(arguments_["target-descriptor"], {
      production: arguments_.stage === "production",
    });
  const outputs = readOutputs(arguments_.outputs ?? ".sst/outputs.json", arguments_.stage);
  const clients = dependencies.clients ?? createAwsClients();
  const maintenance =
    dependencies.maintenance ??
    new OperatorMaintenanceControl(
      clients.dynamo,
      outputs.changeJournalTableName,
      dependencies.clock,
      {
        s3: clients.s3,
        bucketName: outputs.value.bucketNames?.FilesBucket,
      },
    );
  const context = {
    stage: arguments_.stage,
    target,
    outputs,
    clients,
    maintenance,
    control: await maintenance.getControl(),
  };
  if (baseline) {
    if (!arguments_.snapshot) fail("snapshot_required");
    context.baseline = dependencies.baseline ?? loadBaselineSnapshot(arguments_.snapshot);
  }
  return context;
}

async function loadBoundPlan(arguments_, dependencies = {}) {
  const context = await loadCommandContext(arguments_, dependencies);
  if (!context.control) fail("maintenance_control_missing");
  if (context.control.target_fingerprint_sha256 !== context.target.fingerprintSha256) {
    fail("target_binding_mismatch");
  }
  if (
    arguments_["from-exclusive"] !== undefined &&
    Number(arguments_["from-exclusive"]) !== context.control.cutover_start_cursor
  ) {
    fail("range_flag_conflict");
  }
  if (
    arguments_["to-inclusive"] !== undefined &&
    Number(arguments_["to-inclusive"]) !== context.control.boundary_end_cursor
  ) {
    fail("range_flag_conflict");
  }
  await assertNoUnresolvedOperationalState(
    context.clients.dynamo,
    context.outputs.changeJournalTableName,
  );
  const entries = await queryJournalRange(
    context.clients.dynamo,
    context.outputs.changeJournalTableName,
    context.control.cutover_start_cursor,
    context.control.boundary_end_cursor,
  );
  const plan = buildReplayPlan({ baseline: context.baseline, control: context.control, entries });
  return { context, plan };
}

function checkpointForRead(context, plan, bridge) {
  const checkpoint = openReplayCheckpoint(
    context,
    plan,
    bridge.sourceSha256 ?? "test",
    { resume: true },
  );
  return checkpoint;
}

export async function assertNoReplayWritesForAbandonment(context, bridge) {
  if (typeof context.control?.run_id !== "string" || !context.control.run_id) {
    fail("resume_aws_writes_forbidden");
  }
  const receipts = await queryScope(
    context.clients.dynamo,
    context.outputs.changeJournalTableName,
    "REVERSE_REPLAY",
  );
  if (receipts.some((item) => item.run_id === context.control?.run_id)) {
    fail("resume_aws_writes_forbidden");
  }
  const checkpointPath = join(
    requirePrivatePath(context.target.value.local_paths.checkpoint_root),
    "auditflow-reverse-replay",
    context.control.run_id,
    "checkpoint.json",
  );
  if (existsSync(checkpointPath)) {
    const checkpoint = readJson(checkpointPath, "checkpoint_invalid");
    if (
      checkpoint.writes !== 0 ||
      !isRecord(checkpoint.completedOperations) ||
      Object.keys(checkpoint.completedOperations).length !== 0
    ) {
      fail("resume_aws_writes_forbidden");
    }
  }
  for (const entity of ENTITY_NAMES.filter((entity) => entity !== "User")) {
    if ((await bridge.listAll(entity, 5000)).length !== 0) {
      fail("resume_aws_writes_forbidden");
    }
  }
  const retainedUsers = await bridge.listAll("User", 5000);
  if (retainedUsers.length !== 1 || retainedUsers[0]?.role !== "admin") {
    fail("resume_aws_writes_forbidden");
  }
}

export async function runCommand(arguments_, dependencies = {}) {
  const bridgeFactory =
    dependencies.bridgeFactory ?? ((target) => new Base44ReplayBridge(target));
  if (arguments_.command === "capabilities") {
    if (arguments_.stage !== "test") fail("production_capability_probe_forbidden");
    requireExactRehearsalDescriptor(arguments_, dependencies);
    const target = dependencies.target ?? loadTargetDescriptor(arguments_["target-descriptor"]);
    const fixture = arguments_.fixture
      ? readJson(requirePrivatePath(arguments_.fixture), "fixture_invalid")
      : dependencies.capabilityFixture;
    return runCapabilityMatrix(target, {
      bridge: dependencies.bridge ?? bridgeFactory(target),
      fixture,
      confirm: arguments_["confirm-controlled-rehearsal"] === true,
      confirmInvitationLogin: arguments_["confirm-invitation-login"] === true,
      fetchImpl: dependencies.fetchImpl,
    });
  }
  if (arguments_.command === "maintenance-bootstrap") {
    requireControlledConfirmation(arguments_);
    const context = await loadCommandContext(arguments_, dependencies, { baseline: false });
    const control = await context.maintenance.bootstrap();
    return { status: "open", generation: control.generation };
  }
  if (arguments_.command === "maintenance-status") {
    const context = await loadCommandContext(arguments_, dependencies, { baseline: false });
    const control = await context.maintenance.getControl();
    if (!control) return { status: "not_bootstrapped" };
    return {
      status: control.mode.toLowerCase(),
      generation: control.generation,
      startBound: Number.isSafeInteger(control.cutover_start_cursor),
      boundaryBound: Number.isSafeInteger(control.boundary_end_cursor),
      replayState: control.replay_state,
    };
  }
  if (arguments_.command === "mark-cutover-start") {
    requireControlledConfirmation(arguments_);
    const context = await loadCommandContext(arguments_, dependencies);
    await assertBaselineMatchesAws(
      context.clients.dynamo,
      context.outputs.value,
      context.baseline,
    );
    const control = await context.maintenance.markStart(
      context.baseline,
      context.target.fingerprintSha256,
    );
    return { status: "start_bound", generation: control.generation };
  }
  if (arguments_.command === "rehearsal-fixtures") {
    requireControlledConfirmation(arguments_);
    const context = await loadCommandContext(arguments_, dependencies, { baseline: false });
    if (!arguments_.fixture) fail("fixture_required");
    const fixturePath = requirePrivatePath(arguments_.fixture);
    const rehearsalFixtures =
      dependencies.rehearsalFixtures ??
      (await import("./rehearsal_fixture_harness.ts")).runRehearsalFixtures;
    return rehearsalFixtures(context, readJson(fixturePath, "fixture_invalid"));
  }
  if (arguments_.command === "maintenance-close") {
    requireControlledConfirmation(arguments_);
    const context = await loadCommandContext(arguments_, dependencies, { baseline: false });
    const control = await context.maintenance.close();
    return { status: "maintenance", generation: control.generation };
  }
  if (arguments_.command === "doctor") {
    const context = await loadCommandContext(arguments_, dependencies);
    await assertBaselineMatchesAws(
      context.clients.dynamo,
      context.outputs.value,
      context.baseline,
    );
    const bridge = dependencies.bridge ?? bridgeFactory(context.target);
    bridge.assertRuntimeVersions?.();
    const entityCounts = {};
    for (const entity of ENTITY_NAMES) entityCounts[entity] = (await bridge.listAll(entity, 5000)).length;
    return {
      status: "ready",
      control: context.control ? context.control.mode.toLowerCase() : "not_bootstrapped",
      entities: Object.values(entityCounts).reduce((sum, count) => sum + count, 0),
      baselineRecords: ENTITY_NAMES.reduce(
        (sum, entity) => sum + context.baseline.recordsByEntity[entity].length,
        0,
      ),
    };
  }
  if (arguments_.command === "plan") {
    const { context, plan } = await loadBoundPlan(arguments_, dependencies);
    const privateSummary = writePrivateDryRun(context, plan);
    return {
      status: "planned",
      operations: plan.groups.length,
      mutations: plan.projection.actions.length,
      entities: privateSummary.entityCount,
      files: privateSummary.fileCount,
    };
  }
  if (arguments_.command === "replay") {
    requireControlledConfirmation(arguments_);
    const { context, plan } = await loadBoundPlan(arguments_, dependencies);
    const bridge = dependencies.bridge ?? bridgeFactory(context.target);
    if (context.control.replay_state === "READY") {
      context.control = await context.maintenance.setReplayState("IN_PROGRESS", ["READY"]);
    } else if (!['IN_PROGRESS', 'RECONCILED'].includes(context.control.replay_state)) {
      fail("replay_transition_invalid");
    }
    return replayPlan(context, plan, {
      bridge,
      resume: arguments_.resume === true,
      pauseAfterOperations: dependencies.pauseAfterOperations,
    });
  }
  if (arguments_.command === "reconcile") {
    requireControlledConfirmation(arguments_);
    const { context, plan } = await loadBoundPlan(arguments_, dependencies);
    const bridge = dependencies.bridge ?? bridgeFactory(context.target);
    const result = await reconcilePlan(context, plan, {
      bridge,
      fetchImpl: dependencies.fetchImpl,
    });
    if (context.control.replay_state === "IN_PROGRESS") {
      await context.maintenance.setReplayState("RECONCILED", ["IN_PROGRESS"]);
    }
    return {
      status: result.status,
      missing: result.missing,
      extra: result.extra,
      drift: result.drift + result.files.drift,
    };
  }
  if (arguments_.command === "evidence") {
    const { context, plan } = await loadBoundPlan(arguments_, dependencies);
    const bridge = dependencies.bridge ?? bridgeFactory(context.target);
    const checkpoint = checkpointForRead(context, plan, bridge);
    try {
      const evidence = buildAggregateEvidence(context, plan, checkpoint.state, dependencies.now?.() ?? new Date());
      const output = resolve(repositoryRoot, arguments_.output);
      if (!isContained(repositoryRoot, output)) fail("evidence_output_invalid");
      atomicWriteJson(output, evidence);
      return {
        status: evidence.status,
        operations: evidence.range.operationCount,
        entries: evidence.range.entryCount,
        blockers: evidence.totals.blockerCount,
      };
    } finally {
      checkpoint.close();
    }
  }
  if (arguments_.command === "abort-replay") {
    requireControlledConfirmation(arguments_);
    const context = await loadCommandContext(arguments_, dependencies, { baseline: false });
    const control = await context.maintenance.abort();
    return { status: "aborted", mode: control.mode.toLowerCase() };
  }
  if (arguments_.command === "resume-aws-writes") {
    requireControlledConfirmation(arguments_);
    if (arguments_.stage !== "test") fail("resume_aws_writes_forbidden");
    const context = await loadCommandContext(arguments_, dependencies, { baseline: false });
    const bridge = dependencies.bridge ?? bridgeFactory(context.target);
    await assertNoReplayWritesForAbandonment(context, bridge);
    const control = await context.maintenance.resumeAwsWrites(
      arguments_["confirm-no-replay-writes"] === true,
    );
    return { status: "open", generation: control.generation };
  }
  if (arguments_.command === "successful-rollback") {
    requireControlledConfirmation(arguments_);
    const context = await loadCommandContext(arguments_, dependencies, { baseline: false });
    const control = await context.maintenance.rolledBack();
    return { status: "rolled_back", mode: control.mode.toLowerCase() };
  }
  fail("invalid_arguments");
}

async function main() {
  try {
    const result = await runCommand(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${canonicalJson(result)}\n`);
  } catch (error) {
    const category = error instanceof ReplayFailure ? error.category : "unexpected_safe_failure";
    const operation =
      error instanceof ReplayFailure && typeof error.operation === "string"
        ? ` (${error.operation})`
        : "";
    process.stderr.write(`Reverse replay failed: ${category}${operation}\n`);
    process.exitCode = category === "operator_pause_after_checkpoint" ? 2 : 1;
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
