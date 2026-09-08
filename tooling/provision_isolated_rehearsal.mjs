import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import {
  CreateTableCommand,
  DynamoDBClient,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import {
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketTaggingCommand,
  PutBucketVersioningCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { AWS_REGION, ENTITY_NAMES, hashProjection } from "./replay_base44_change_journal.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const defaultOutputsPath = join(repositoryRoot, ".sst", "rehearsal-outputs.json");

function arguments_() {
  const values = process.argv.slice(2);
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error("invalid_arguments");
    }
    const name = flag.slice(2);
    if (!["artifact-root", "outputs"].includes(name) || Object.hasOwn(parsed, name)) {
      throw new Error("invalid_arguments");
    }
    parsed[name] = value;
  }
  if (!parsed["artifact-root"]) throw new Error("invalid_arguments");
  const outputsPath = resolve(parsed.outputs ?? defaultOutputsPath);
  const outputsRelation = relative(join(repositoryRoot, ".sst"), outputsPath);
  if (
    outputsRelation.startsWith("..") ||
    isAbsolute(outputsRelation) ||
    !/^rehearsal(?:-[a-z0-9-]+)?-outputs\.json$/.test(outputsRelation)
  ) {
    throw new Error("outputs_path_invalid");
  }
  return { artifactRoot: resolve(parsed["artifact-root"]), outputsPath };
}

function atomicWriteJson(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

function outsideRepository(path) {
  const absolute = resolve(path);
  const relation = relative(repositoryRoot, absolute);
  if (!isAbsolute(absolute) || relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) {
    throw new Error("external_artifact_root_required");
  }
  return absolute;
}

const tableDefinitions = {
  ClientTable: {
    attributes: { id: "S", record_type: "S", created_date: "S" },
    primary: ["id"],
    indexes: { byCreatedDate: ["record_type", "created_date"] },
  },
  SubmissionTable: {
    attributes: {
      id: "S",
      client_id: "S",
      tax_year: "N",
      record_type: "S",
      created_date: "S",
    },
    primary: ["id"],
    indexes: {
      byClientYear: ["client_id", "tax_year"],
      byCreatedDate: ["record_type", "created_date"],
    },
  },
  QuestionnaireTemplateTable: {
    attributes: { id: "S", record_type: "S", version: "N" },
    primary: ["id"],
    indexes: { byVersion: ["record_type", "version"] },
  },
  PdfTemplateTable: {
    attributes: { id: "S", record_type: "S", created_date: "S" },
    primary: ["id"],
    indexes: { byCreatedDate: ["record_type", "created_date"] },
  },
  SyncedDriveFileTable: {
    attributes: { id: "S", submission_id: "S", created_date: "S" },
    primary: ["id"],
    indexes: { bySubmission: ["submission_id", "created_date"] },
  },
  UserTable: {
    attributes: { id: "S", cognito_sub: "S", record_type: "S", created_date: "S" },
    primary: ["id"],
    indexes: {
      byCognitoSubject: ["cognito_sub"],
      byCreatedDate: ["record_type", "created_date"],
    },
  },
  ChangeJournalTable: {
    attributes: { scope: "S", sequence: "S", entity_key: "S" },
    primary: ["scope", "sequence"],
    indexes: { byEntity: ["entity_key", "sequence"] },
  },
};

function buildKeySchema(fields) {
  return fields.map((AttributeName, index) => ({
    AttributeName,
    KeyType: index === 0 ? "HASH" : "RANGE",
  }));
}

async function createTable(client, logicalName, definition, suffix) {
  const TableName = `auditflow-test-rr-${suffix}-${logicalName.toLowerCase()}`;
  const requiredAttributes = new Set([
    ...definition.primary,
    ...Object.values(definition.indexes).flat(),
  ]);
  await client.send(
    new CreateTableCommand({
      TableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [...requiredAttributes].map((AttributeName) => ({
        AttributeName,
        AttributeType: definition.attributes[AttributeName],
      })),
      KeySchema: buildKeySchema(definition.primary),
      GlobalSecondaryIndexes: Object.entries(definition.indexes).map(([IndexName, fields]) => ({
        IndexName,
        KeySchema: buildKeySchema(fields),
        Projection: { ProjectionType: "ALL" },
      })),
      Tags: [
        { Key: "auditflow:stage", Value: "test" },
        { Key: "auditflow:purpose", Value: "rollback-replay-rehearsal" },
        { Key: "auditflow:managed-by", Value: "operator-tool" },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 180 }, { TableName });
  return TableName;
}

function emptyState() {
  return Object.fromEntries(ENTITY_NAMES.map((entity) => [entity, {}]));
}

async function createFilesBucket(bucketName) {
  const s3 = new S3Client({ region: AWS_REGION });
  for (let attempt = 0; attempt < 15; attempt += 1) {
    try {
      await s3.send(
        new CreateBucketCommand({
          Bucket: bucketName,
          CreateBucketConfiguration: { LocationConstraint: AWS_REGION },
        }),
      );
      break;
    } catch (error) {
      if (error?.name === "BucketAlreadyOwnedByYou") break;
      if (error?.name !== "OperationAborted" || attempt === 14) throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
    }
  }
  await s3.send(
    new PutPublicAccessBlockCommand({
      Bucket: bucketName,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  await s3.send(
    new PutBucketVersioningCommand({
      Bucket: bucketName,
      VersioningConfiguration: { Status: "Enabled" },
    }),
  );
  await s3.send(
    new PutBucketTaggingCommand({
      Bucket: bucketName,
      Tagging: {
        TagSet: [
          { Key: "auditflow:stage", Value: "test" },
          { Key: "auditflow:purpose", Value: "rollback-replay-rehearsal" },
          { Key: "auditflow:managed-by", Value: "operator-tool" },
        ],
      },
    }),
  );
}

async function provisionAws(stateRoot, suffix) {
  const statePath = join(stateRoot, "provisioning.json");
  const state = {
    schemaVersion: 1,
    status: "provisioning",
    region: AWS_REGION,
    suffix,
    tableNames: {},
    bucketNames: {},
  };
  atomicWriteJson(statePath, state);
  const dynamo = new DynamoDBClient({ region: AWS_REGION });
  for (const [logicalName, definition] of Object.entries(tableDefinitions)) {
    state.tableNames[logicalName] = await createTable(dynamo, logicalName, definition, suffix);
    atomicWriteJson(statePath, state);
  }

  const bucketName = `auditflow-test-rr-${suffix}`;
  await createFilesBucket(bucketName);
  state.bucketNames = { FilesBucket: bucketName, TemporaryOutputsBucket: bucketName };
  atomicWriteJson(statePath, state);
  return state;
}

function writeBaseline(stateRoot) {
  const baselineRoot = join(stateRoot, "baseline");
  mkdirSync(baselineRoot, { mode: 0o700 });
  const entities = {};
  for (const entity of ENTITY_NAMES) {
    const filename = `${entity}.ndjson`;
    writeFileSync(join(baselineRoot, filename), "", { encoding: "utf8", mode: 0o600 });
    entities[entity] = { ndjsonPath: filename, count: 0 };
  }
  atomicWriteJson(join(baselineRoot, "manifest.json"), {
    schemaVersion: 1,
    purpose: "rollback-replay-controlled-rehearsal",
    entities,
    rollbackBaseline: {
      lastAppliedGlobalCursor: 0,
      awsProjectionSha256: hashProjection(emptyState()),
    },
  });
  return baselineRoot;
}

function writeFixture(stateRoot) {
  const originalPath = join(stateRoot, "original.pdf");
  const replacementPath = join(stateRoot, "replacement.pdf");
  writeFileSync(originalPath, Buffer.from("%PDF-1.4\n% invented rehearsal original\n"), {
    mode: 0o600,
  });
  writeFileSync(replacementPath, Buffer.from("%PDF-1.4\n% invented rehearsal replacement\n"), {
    mode: 0o600,
  });
  const fixturePath = join(stateRoot, "rehearsal-fixture.json");
  atomicWriteJson(fixturePath, {
    actor: {
      user_id: "rollback-rehearsal-operator",
      email: "operator@rollback-rehearsal.invalid",
      full_name: "Invented Rollback Operator",
      cognito_subject: "rollback-rehearsal-subject",
    },
    client: {
      full_name: "Invented Rollback Client",
      email: "client@rollback-rehearsal.invalid",
      tax_year: 2026,
    },
    client_update: { notes: "Invented rollback replay update" },
    questionnaire_steps: [
      {
        id: "rollback-rehearsal-proof",
        title: "Invented proof",
        question: "Attach the invented rehearsal document",
      },
    ],
    delete_original_file: false,
    original_file: { path: originalPath, content_type: "application/pdf" },
    replacement_file: { path: replacementPath, content_type: "application/pdf" },
  });
  return fixturePath;
}

async function main() {
  const { artifactRoot, outputsPath } = arguments_();
  const stateRoot = outsideRepository(artifactRoot);
  const statePath = join(stateRoot, "provisioning.json");
  if (existsSync(outputsPath)) {
    throw new Error("rehearsal_already_provisioned");
  }
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  let state;
  if (existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, "utf8"));
    const tableNames = Object.entries(state.tableNames ?? {});
    const derivedSuffix = /^auditflow-test-rr-([a-f0-9]{12})-/.exec(tableNames[0]?.[1])?.[1];
    const suffix = state.suffix ?? derivedSuffix;
    if (
      state.status !== "provisioning" ||
      typeof suffix !== "string" ||
      !/^[a-f0-9]{12}$/.test(suffix) ||
      tableNames.some(
        ([logicalName, tableName]) =>
          !Object.hasOwn(tableDefinitions, logicalName) ||
          tableName !== `auditflow-test-rr-${suffix}-${logicalName.toLowerCase()}`,
      )
    ) {
      throw new Error("rehearsal_partial_state_invalid");
    }
    if (Object.keys(state.bucketNames ?? {}).length !== 0) {
      throw new Error("rehearsal_partial_state_invalid");
    }
    state.suffix = suffix;
    const dynamo = new DynamoDBClient({ region: AWS_REGION });
    for (const [logicalName, definition] of Object.entries(tableDefinitions)) {
      if (state.tableNames[logicalName]) continue;
      state.tableNames[logicalName] = await createTable(
        dynamo,
        logicalName,
        definition,
        suffix,
      );
      atomicWriteJson(statePath, state);
    }
    const bucketName = `auditflow-test-rr-${suffix}`;
    await createFilesBucket(bucketName);
    state.bucketNames = { FilesBucket: bucketName, TemporaryOutputsBucket: bucketName };
    atomicWriteJson(statePath, state);
  } else {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    state = await provisionAws(stateRoot, suffix);
  }
  const baselineRoot = writeBaseline(stateRoot);
  const fixturePath = writeFixture(stateRoot);
  const currentOutputs = JSON.parse(
    readFileSync(join(repositoryRoot, ".sst", "outputs.json"), "utf8"),
  );
  atomicWriteJson(outputsPath, {
    stage: "test",
    tableNames: state.tableNames,
    bucketNames: state.bucketNames,
    userPoolId: currentOutputs.userPoolId,
    userPoolClientId: currentOutputs.userPoolClientId,
  });
  Object.assign(state, {
    status: "ready",
    baselineRoot,
    fixturePath,
    outputsPath,
  });
  atomicWriteJson(statePath, state);
  process.stdout.write(
    `${JSON.stringify({
      status: "ready",
      tables: Object.keys(state.tableNames).length,
      buckets: 1,
      baselineRecords: 0,
      invitationIncluded: false,
      fileDeletionIncluded: false,
    })}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `Isolated rehearsal provisioning failed: ${
      error instanceof Error ? error.message : "unexpected_safe_failure"
    }\n`,
  );
  process.exitCode = 1;
}
