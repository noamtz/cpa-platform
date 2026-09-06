import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ImportFailure,
  buildDerivedPlaceholderClients,
  canonicalJson,
  convergeDynamoItem,
  convergeS3Object,
  evidenceFor,
  legacyReferenceKey,
  loadImportPlan,
  openCheckpoint,
  parseArguments,
  reconcileTarget,
  runImport,
  sha256,
  validateRelationshipsAndBuildGuards,
} from "./import_base44_snapshot.mjs";
import { validatePrivateFileCutoverEvidence } from "./verify_private_file_cutover.mjs";

const roots = [];
const entityNames = [
  "Client",
  "Submission",
  "QuestionnaireTemplate",
  "PdfTemplate",
  "SyncedDriveFile",
  "User",
];

function timestamp() {
  return "2026-09-06T00:00:00.000Z";
}

function sourceRecords() {
  const dates = { created_date: timestamp(), updated_date: timestamp() };
  return {
    Client: [{ id: "client-1", full_name: "Invented Client", ...dates }],
    Submission: [
      {
        id: "submission-1",
        client_id: "client-1",
        tax_year: 2025,
        template_id: "questionnaire-1",
        template_version: 1,
        pdf_template_id: "pdf-1",
        responses: "{}",
        ...dates,
      },
    ],
    QuestionnaireTemplate: [
      {
        id: "questionnaire-1",
        version: 1,
        is_active: true,
        steps: "[]",
        ...dates,
      },
    ],
    PdfTemplate: [
      {
        id: "pdf-1",
        name: "Invented PDF",
        template_json: "{}",
        ...dates,
      },
    ],
    SyncedDriveFile: [
      { id: "sync-1", submission_id: "submission-1", created_date: timestamp() },
    ],
    User: [
      { id: "admin-1", email: "one@example.test", role: "admin", ...dates },
      { id: "admin-2", email: "two@example.test", role: "admin", ...dates },
      {
        id: "history-1",
        email: "history@example.test",
        role: "user",
        custom_legacy_field: "preserved",
        ...dates,
      },
    ],
  };
}

function outputs() {
  return {
    stage: "test",
    tableNames: {
      ClientTable: "invented-client-table",
      SubmissionTable: "invented-submission-table",
      QuestionnaireTemplateTable: "invented-questionnaire-table",
      PdfTemplateTable: "invented-pdf-table",
      SyncedDriveFileTable: "invented-synced-table",
      UserTable: "invented-user-table",
      ChangeJournalTable: "invented-journal-table",
    },
    bucketNames: {
      FilesBucket: "invented-files-bucket",
      TemporaryOutputsBucket: "invented-temporary-bucket",
    },
    userPoolId: "il-central-1_invented",
  };
}

function fixture(records = sourceRecords()) {
  const root = mkdtempSync(join(tmpdir(), "auditflow-import-test-"));
  roots.push(root);
  const snapshot = join(root, "snapshot");
  const checkpointRoot = join(root, "checkpoints");
  mkdirSync(join(snapshot, "entities"), { recursive: true });
  mkdirSync(join(snapshot, "files"), { recursive: true });
  mkdirSync(checkpointRoot, { recursive: true });
  const entities = {};
  for (const entity of entityNames) {
    const ordered = [...records[entity]].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const recordEntries = ordered.map((record) => ({
      id: record.id,
      sha256: sha256(Buffer.from(canonicalJson(record), "utf8")),
    }));
    const aggregateSha256 = sha256(
      Buffer.from(
        canonicalJson(
          recordEntries.map(({ id, sha256: digest }) => [id, digest]),
        ),
        "utf8",
      ),
    );
    const ndjsonPath = `entities/${entity}.ndjson`;
    writeFileSync(
      join(snapshot, ndjsonPath),
      `${ordered.map((record) => canonicalJson(record)).join("\n")}\n`,
      "utf8",
    );
    entities[entity] = {
      count: ordered.length,
      aggregateSha256,
      ndjsonPath,
      records: recordEntries,
    };
  }
  const bytes = Buffer.from("invented duplicate content", "utf8");
  const contentSha256 = sha256(bytes);
  const contentPath = `files/${contentSha256.slice(0, 2)}/${contentSha256}`;
  mkdirSync(join(snapshot, "files", contentSha256.slice(0, 2)), {
    recursive: true,
  });
  writeFileSync(join(snapshot, contentPath), bytes);
  const sources = [
    "private://legacy/invented.pdf",
    "https://example.test/invented.pdf?version=1",
  ];
  const references = sources
    .map((sourceReference) => ({
      referenceFingerprint: sha256(Buffer.from(sourceReference, "utf8")),
      sourceReference,
      classification: sourceReference.startsWith("https:") ? "public" : "private",
      occurrences: [],
      status: "downloaded",
      contentSha256,
      byteLength: bytes.length,
    }))
    .sort((left, right) =>
      left.referenceFingerprint.localeCompare(right.referenceFingerprint),
    );
  const manifest = {
    schemaVersion: 1,
    toolVersion: "1.1.0",
    base44CliVersion: "0.1.10",
    completedAt: timestamp(),
    entities,
    references,
    files: [
      {
        sha256: contentSha256,
        byteLength: bytes.length,
        path: contentPath,
        referenceFingerprints: references.map(
          ({ referenceFingerprint }) => referenceFingerprint,
        ),
      },
    ],
    findings: [],
    totals: {
      objects: Object.values(records).flat().length,
      uniqueReferences: references.length,
      downloadedReferences: references.length,
      uniqueFiles: 1,
      bytes: bytes.length,
      unresolved: 0,
    },
    gates: {
      stableInventories: true,
      sixEntities: true,
      twoAdminUsers: true,
      allReferencesClosed: true,
    },
  };
  writeFileSync(
    join(snapshot, "manifest.json"),
    `${canonicalJson(manifest)}\n`,
    "utf8",
  );
  const identityMapPath = join(root, "identity-map.json");
  writeFileSync(
    identityMapPath,
    canonicalJson({
      schemaVersion: 1,
      stage: "test",
      users: [
        { userId: "admin-1", cognitoSubject: "invented-subject-1" },
        { userId: "admin-2", cognitoSubject: "invented-subject-2" },
      ],
    }),
    "utf8",
  );
  return { root, snapshot, checkpointRoot, identityMapPath, records };
}

function loadFixture(testFixture = fixture(), options = {}) {
  return loadImportPlan({
    stage: "test",
    snapshotPath: testFixture.snapshot,
    checkpointRoot: testFixture.checkpointRoot,
    identityMapPath: testFixture.identityMapPath,
    outputsPath: ".sst/outputs.json",
    outputsValue: outputs(),
    verifyOffline: false,
    ...options,
  });
}

async function streamBytes(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function fakeClients({ pageSize = 1 } = {}) {
  const tables = new Map();
  const objects = new Map();
  const document = {
    send: vi.fn(async (command) => {
      const input = command.input;
      const table = tables.get(input.TableName) ?? new Map();
      tables.set(input.TableName, table);
      if (command.constructor.name === "GetCommand") {
        return { Item: table.get(input.Key.id) };
      }
      if (command.constructor.name === "PutCommand") {
        if (table.has(input.Item.id)) {
          const error = new Error("conditional");
          error.name = "ConditionalCheckFailedException";
          throw error;
        }
        table.set(input.Item.id, structuredClone(input.Item));
        return {};
      }
      if (command.constructor.name === "ScanCommand") {
        const values = [...table.values()];
        const offset = input.ExclusiveStartKey?.offset ?? 0;
        const Items = values.slice(offset, offset + pageSize);
        const next = offset + Items.length;
        return {
          Items,
          ...(next < values.length
            ? { LastEvaluatedKey: { offset: next } }
            : {}),
        };
      }
      throw new Error(`Unexpected document command ${command.constructor.name}`);
    }),
  };
  const s3 = {
    send: vi.fn(async (command) => {
      const input = command.input;
      const objectName = Reflect.get(input, "Key");
      if (command.constructor.name === "HeadObjectCommand") {
        const object = objects.get(objectName);
        if (!object) {
          const error = new Error("missing");
          error.name = "NotFound";
          error.$metadata = { httpStatusCode: 404 };
          throw error;
        }
        return { ContentLength: object.bytes.length, Metadata: object.metadata };
      }
      if (command.constructor.name === "GetObjectCommand") {
        const object = objects.get(objectName);
        if (!object) throw new Error("missing object");
        return { Body: (async function* () { yield object.bytes; })() };
      }
      if (command.constructor.name === "PutObjectCommand") {
        if (objects.has(objectName)) {
          const error = new Error("precondition");
          error.$metadata = { httpStatusCode: 412 };
          throw error;
        }
        objects.set(objectName, {
          bytes: await streamBytes(input.Body),
          metadata: input.Metadata,
        });
        return { VersionId: "invented-version" };
      }
      if (command.constructor.name === "ListObjectsV2Command") {
        const names = [...objects.keys()].sort();
        const offset = Number(input.ContinuationToken ?? 0);
        const page = names.slice(offset, offset + pageSize);
        const next = offset + page.length;
        return {
          Contents: page.map((Key) => ({ Key })),
          IsTruncated: next < names.length,
          ...(next < names.length
            ? { NextContinuationToken: String(next) }
            : {}),
        };
      }
      throw new Error(`Unexpected S3 command ${command.constructor.name}`);
    }),
  };
  return { document, s3, tables, objects };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Base44 snapshot importer", () => {
  it("parses strict subcommands and rejects malformed arguments", () => {
    const base = [
      "doctor",
      "--stage",
      "test",
      "--snapshot",
      "C:\\private\\snapshot",
      "--checkpoint-root",
      "C:\\private\\checkpoint",
      "--identity-map",
      "C:\\private\\identity.json",
      "--outputs",
      ".sst/outputs.json",
    ];
    expect(parseArguments(base)).toMatchObject({ command: "doctor", stage: "test" });
    expect(() => parseArguments([...base, "--unknown", "value"])).toThrow(
      ImportFailure,
    );
    expect(() =>
      parseArguments([
        "import",
        ...base.slice(1),
        "--confirm-production-import",
      ]),
    ).toThrow("stage_confirmation_mismatch");
  });

  it("preflights all entities, preserves opaque fields, and derives exact guards", () => {
    const plan = loadFixture();
    expect(plan.sourceRecordCount).toBe(8);
    expect(plan.references).toHaveLength(2);
    expect(plan.references.map(({ objectName }) => objectName)).toEqual(
      expect.arrayContaining([
        legacyReferenceKey("private://legacy/invented.pdf"),
        legacyReferenceKey("https://example.test/invented.pdf?version=1"),
      ]),
    );
    const historical = plan.targetsByEntity.User.find(
      ({ id }) => id === "history-1",
    );
    expect(historical).toMatchObject({
      custom_legacy_field: "preserved",
      record_type: "User",
      _version: 1,
    });
    expect(historical).not.toHaveProperty("cognito_sub");
    expect(plan.guards.questionnaireGuard).toEqual({
      id: "!ACTIVE",
      record_type: "!ACTIVE_GUARD",
      active_template_id: "questionnaire-1",
      active_version: 1,
      _version: 1,
    });
    expect(plan.guards.submissionGuards).toEqual([
      {
        id: "!ACTIVE#client-1#2025",
        record_type: "!ACTIVE_GUARD",
        submission_id: "submission-1",
        client_id: "client-1",
        tax_year: 2025,
      },
    ]);
  });

  it("blocks dangling relationships and resolves duplicate active guards deterministically", () => {
    const records = sourceRecords();
    records.Submission.push({ ...records.Submission[0], id: "submission-2" });
    expect(validateRelationshipsAndBuildGuards(records)).toMatchObject({
      resolvedDuplicateActiveSubmissionCount: 1,
      submissionGuards: [
        expect.objectContaining({ submission_id: "submission-1" }),
      ],
    });
    records.Submission = [{ ...records.Submission[0], client_id: "missing" }];
    expect(() => validateRelationshipsAndBuildGuards(records)).toThrow(
      "submission_client_missing",
    );
    const reserved = sourceRecords();
    reserved.QuestionnaireTemplate[0].id = "!ACTIVE";
    expect(() => validateRelationshipsAndBuildGuards(reserved)).toThrow(
      "source_reserved_key_conflict",
    );
  });

  it("treats empty optional template relationships as absent", () => {
    const records = sourceRecords();
    records.Submission[0].template_id = "";
    records.Submission[0].pdf_template_id = "";
    expect(validateRelationshipsAndBuildGuards(records)).toMatchObject({
      resolvedDuplicateActiveSubmissionCount: 0,
    });
  });

  it("preserves positive legacy tax years beyond the former UI horizon", () => {
    const records = sourceRecords();
    records.Submission[0].tax_year = 2350;
    expect(validateRelationshipsAndBuildGuards(records).submissionGuards).toEqual([
      expect.objectContaining({ tax_year: 2350 }),
    ]);
  });

  it("derives an archived, manifest-bound placeholder for an orphan client", () => {
    const records = sourceRecords();
    records.Submission[0].client_id = "missing-client";
    const testFixture = fixture(records);
    const sourceManifestSha256 = sha256(
      readFileSync(join(testFixture.snapshot, "manifest.json")),
    );
    const authorizedPlaceholderPolicy = {
      sourceManifestSha256,
      missingClientCount: 1,
      sourceSubmissionCount: 1,
    };
    expect(() => loadFixture(testFixture)).toThrow(
      "missing_client_placeholder_not_authorized",
    );
    const plan = loadFixture(testFixture, { authorizedPlaceholderPolicy });
    expect(
      buildDerivedPlaceholderClients(
        records,
        plan.sourceManifestSha256,
        authorizedPlaceholderPolicy,
      ),
    ).toEqual(plan.derivedPlaceholderClients);
    expect(plan.derivedPlaceholderClients).toHaveLength(1);
    expect(plan.derivedPlaceholderClients[0]).toMatchObject({
      id: "missing-client",
      record_type: "Client",
      is_archived: true,
      _auditflow_migration: {
        item_kind: "derived_placeholder_client",
        source_submission_count: 1,
        source_manifest_sha256: plan.sourceManifestSha256,
      },
    });
    expect(plan.guards.submissionGuards[0].client_id).toBe("missing-client");
  });

  it("conditionally creates Dynamo items and rejects collisions", async () => {
    const stored = new Map();
    const client = {
      async send(command) {
        if (command.constructor.name === "GetCommand") {
          return { Item: stored.get(command.input.Key.id) };
        }
        stored.set(command.input.Item.id, structuredClone(command.input.Item));
        return {};
      },
    };
    const item = { id: "item-1", value: "same" };
    await expect(
      convergeDynamoItem({ client, tableName: "invented", item }),
    ).resolves.toBe("written");
    await expect(
      convergeDynamoItem({ client, tableName: "invented", item }),
    ).resolves.toBe("skipped");
    await expect(
      convergeDynamoItem({
        client,
        tableName: "invented",
        item: { id: "item-1", value: "different" },
      }),
    ).rejects.toThrow("target_record_conflict");
  });

  it("rechecks conditional S3 races and rejects local content tampering", async () => {
    const plan = loadFixture();
    const reference = plan.references[0];
    let stored;
    let headCount = 0;
    const s3 = {
      async send(command) {
        if (command.constructor.name === "HeadObjectCommand") {
          headCount += 1;
          if (headCount === 1) {
            const error = new Error("missing");
            error.name = "NotFound";
            error.$metadata = { httpStatusCode: 404 };
            throw error;
          }
          return { ContentLength: stored.bytes.length, Metadata: stored.metadata };
        }
        if (command.constructor.name === "PutObjectCommand") {
          stored = {
            bytes: await streamBytes(command.input.Body),
            metadata: command.input.Metadata,
          };
          const error = new Error("precondition");
          error.$metadata = { httpStatusCode: 412 };
          throw error;
        }
        if (command.constructor.name === "GetObjectCommand") {
          return { Body: (async function* () { yield stored.bytes; })() };
        }
        throw new Error("unexpected command");
      },
    };
    await expect(
      convergeS3Object({
        s3,
        bucket: "invented",
        reference,
        manifestSha256: plan.sourceManifestSha256,
      }),
    ).resolves.toBe("skipped");

    writeFileSync(reference.contentPath, "tampered", "utf8");
    await expect(
      convergeS3Object({
        s3,
        bucket: "invented",
        reference,
        manifestSha256: plan.sourceManifestSha256,
      }),
    ).rejects.toThrow("snapshot_file_tamper");
  });

  it("resumes, reconciles paginated targets, and validates evidence", async () => {
    const plan = loadFixture();
    const clients = fakeClients({ pageSize: 1 });
    await expect(
      runImport(plan, clients, { pauseAfterUnits: 3 }),
    ).rejects.toThrow("operator_pause_after_checkpoint");
    await expect(runImport(plan, clients, { resume: true })).resolves.toMatchObject({
      status: "complete",
    });
    await expect(runImport(plan, clients)).resolves.toMatchObject({
      status: "complete",
      written: 0,
    });
    const reconciliation = await reconcileTarget(plan, clients);
    expect(reconciliation).toMatchObject({
      status: "verified",
      importedRecordCount: 8,
      derivedPlaceholderClientCount: 0,
      resolvedDuplicateActiveSubmissionCount: 0,
      derivedGuardCount: 2,
      referenceObjectCount: 2,
    });
    const evidence = evidenceFor(
      plan,
      reconciliation,
      new Date("2026-09-06T01:00:00.000Z"),
    );
    expect(
      validatePrivateFileCutoverEvidence(evidence, "test", {
        now: Date.parse("2026-09-06T01:01:00.000Z"),
      }),
    ).toMatchObject({
      ready: true,
      sourceManifestSha256: plan.sourceManifestSha256,
    });
  });

  it("binds checkpoints to one manifest and rejects concurrent use", () => {
    const plan = loadFixture();
    const first = openCheckpoint(plan);
    expect(() => openCheckpoint(plan, { resume: true })).toThrow(
      "checkpoint_locked",
    );
    first.close();
    const checkpoint = JSON.parse(readFileSync(first.path, "utf8"));
    expect(checkpoint.sourceManifestSha256).toBe(plan.sourceManifestSha256);

    writeFileSync(first.path, "not-json", "utf8");
    expect(() => openCheckpoint(plan, { resume: true })).toThrow(
      "checkpoint_invalid",
    );
    expect(existsSync(join(first.directory, "import.lock"))).toBe(false);
  });
});
