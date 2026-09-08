import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

import {
  ENTITY_NAMES,
  OperatorMaintenanceControl,
  ReplayFailure,
  assertBaselineMatchesAws,
  assertAggregateEvidencePrivacy,
  assertBase44FileAbsent,
  attemptDisposableFileCleanup,
  assertNoReplayWritesForAbandonment,
  buildAggregateEvidence,
  buildReplayPlan,
  canonicalJson,
  hashProjection,
  hashRecord,
  loadTargetDescriptor,
  openReplayCheckpoint,
  parseArguments,
  projectBase44Record,
  projectMappedBase44Record,
  projectJournal,
  queryJournalRange,
  reconcilePlan,
  replayPlan,
  runCapabilityMatrix,
  validateAndGroupJournal,
  writePrivateDryRun,
} from "./replay_base44_change_journal.mjs";

function emptyState() {
  return Object.fromEntries(ENTITY_NAMES.map((entity) => [entity, {}]));
}

function updateFixture() {
  const state = emptyState();
  const before = { id: "client-1", status: "before", optional: "remove" };
  const after = { id: "client-1", status: "after" };
  state.Client[before.id] = before;
  const entry = {
    scope: "GLOBAL",
    sequence: "00000000000000000001",
    item_type: "ENTRY",
    entity_type: "Client",
    entity_key: "Client#client-1",
    operation_type: "update",
    operation_id: "operation-1",
    operation_index: 0,
    operation_count: 1,
    before: { status: "before", optional: "remove" },
    after: { status: "after", optional: { __auditflow_missing: true } },
    before_hash: hashRecord(before),
    after_hash: hashRecord(after),
  };
  return { state, before, after, entry };
}

describe("reverse replay validation and projection", () => {
  it("canonicalizes hashes and applies update deltas", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    const fixture = updateFixture();
    const groups = validateAndGroupJournal([fixture.entry], 0, 1);
    expect(projectJournal(fixture.state, groups).state.Client[fixture.before.id]).toEqual(
      fixture.after,
    );
  });

  it.each([
    [[], "journal_range_gap"],
    [[{ ...updateFixture().entry, sequence: "00000000000000000002" }], "journal_range_gap"],
    [[{ ...updateFixture().entry, operation_count: 2 }], "operation_group_incomplete"],
    [[{ ...updateFixture().entry, entity_type: "SyncedDriveFile" }], "journal_entry_invalid"],
  ])("fails closed for invalid journal input", (entries, category) => {
    expect(() => validateAndGroupJournal(entries, 0, 1)).toThrowError(
      expect.objectContaining({ category }),
    );
  });

  it("rejects unreachable record deletion", () => {
    const fixture = updateFixture();
    expect(() =>
      validateAndGroupJournal([{ ...fixture.entry, operation_type: "delete" }], 0, 1),
    ).toThrowError(expect.objectContaining({ category: "unreachable_mutation_blocker" }));
  });

  it("rewrites flat and JSON-string file references", () => {
    const source = "private://files/firms/test/file.pdf";
    const result = projectBase44Record(
      {
        id: "submission-1",
        _version: 3,
        record_type: "Submission",
        file_reference: source,
        responses: JSON.stringify([{ file_url: source }]),
      },
      { [source]: { base44Uri: "private/base44/file.pdf" } },
    );
    expect(result._version).toBeUndefined();
    expect(result.file_reference).toBe("private/base44/file.pdf");
    expect(result.responses).toBe('[{"file_url":"private/base44/file.pdf"}]');
  });

  it("projects destination-owned IDs and timestamps into durable source aliases", () => {
    const result = projectMappedBase44Record(
      {
        id: "submission-source",
        client_id: "client-source",
        template_id: "questionnaire-source",
        responses: JSON.stringify({ pdf_template_id: "pdf-source" }),
        created_date: "2026-09-07T00:00:00.000Z",
        updated_date: "2026-09-07T00:01:00.000Z",
      },
      {},
      {
        "Client:client-source": "client-destination",
        "QuestionnaireTemplate:questionnaire-source": "questionnaire-destination",
        "PdfTemplate:pdf-source": "pdf-destination",
      },
    );
    expect(result).toMatchObject({
      auditflow_source_id: "submission-source",
      auditflow_source_created_date: "2026-09-07T00:00:00.000Z",
      auditflow_source_updated_date: "2026-09-07T00:01:00.000Z",
      client_id: "client-destination",
      template_id: "questionnaire-destination",
      responses: '{"pdf_template_id":"pdf-destination"}',
    });
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("created_date");
    expect(result).not.toHaveProperty("updated_date");
  });

  it("paginates GLOBAL query results", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Items: [{ sequence: "1" }], LastEvaluatedKey: { k: 1 } })
      .mockResolvedValueOnce({ Items: [{ sequence: "2" }] });
    await expect(queryJournalRange({ send }, "table", 0, 2)).resolves.toHaveLength(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ k: 1 });
  });

  it("independently binds the baseline hash to all six live AWS tables", async () => {
    const send = vi.fn(async (command) => {
      expect(command).toBeInstanceOf(ScanCommand);
      return { Items: [] };
    });
    const tableNames = Object.fromEntries(
      ENTITY_NAMES.map((entity) => [`${entity}Table`, `${entity}-test`]),
    );
    await expect(
      assertBaselineMatchesAws(
        { send },
        { tableNames },
        { projectionSha256: hashProjection(emptyState()) },
      ),
    ).resolves.toEqual(emptyState());
    expect(send).toHaveBeenCalledTimes(ENTITY_NAMES.length);
  });
});

function replayScenario() {
  const fixture = updateFixture();
  const baseline = {
    manifestSha256: "a".repeat(64),
    projectionSha256: hashProjection(fixture.state),
    lastAppliedGlobalCursor: 0,
    state: fixture.state,
  };
  const control = {
    mode: "MAINTENANCE",
    cutover_start_cursor: 0,
    boundary_end_cursor: 1,
    manifest_sha256: baseline.manifestSha256,
    baseline_projection_sha256: baseline.projectionSha256,
    target_fingerprint_sha256: "f".repeat(64),
    run_id: "run-test",
    replay_state: "IN_PROGRESS",
  };
  const plan = buildReplayPlan({ baseline, control, entries: [fixture.entry] });
  const root = mkdtempSync(join(tmpdir(), "auditflow-replay-test-"));
  const localPaths = {};
  for (const key of [
    "checkpoint_root",
    "dry_run_root",
    "fixture_root",
    "clone_root",
    "private_evidence_root",
  ]) {
    localPaths[key] = join(root, key);
    mkdirSync(localPaths[key]);
  }
  const receipts = new Map();
  const clients = {
    dynamo: {
      send: vi.fn(async (command) => {
        if (command.input?.Item) {
          receipts.set(command.input.Item.sequence, command.input.Item);
          return {};
        }
        return { Item: receipts.get(command.input?.["Key"]?.sequence) };
      }),
    },
    s3: { send: vi.fn() },
  };
  const context = {
    stage: "test",
    target: { fingerprintSha256: "f".repeat(64), value: { local_paths: localPaths } },
    outputs: { changeJournalTableName: "journal-test", value: { bucketNames: {} } },
    clients,
    baseline,
    control,
  };
  const records = Object.fromEntries(
    ENTITY_NAMES.map((entity) => [entity, new Map(Object.entries(fixture.state[entity]))]),
  );
  const bridge = {
    sourceSha256: "b".repeat(64),
    request: vi.fn(async (request) => {
      if (request.operation === "filter_id") {
        const record = records[request.entity].get(request.id);
        return { records: record ? [record] : [] };
      }
      if (request.operation === "filter_source_id") {
        return {
          records: [...records[request.entity].values()].filter(
            (record) => record.auditflow_source_id === request.source_id,
          ),
        };
      }
      if (request.operation === "update") {
        const record = {
          ...(records[request.entity].get(request.id) ?? {}),
          ...request.record,
          id: request.id,
        };
        records[request.entity].set(request.id, record);
        return { record };
      }
      throw new Error("unexpected bridge request");
    }),
    listAll: vi.fn(async (entity) => [...records[entity].values()]),
  };
  return { context, plan, bridge };
}

function assignedCreateScenario({ ambiguousCreate = false } = {}) {
  const scenario = replayScenario();
  const state = emptyState();
  const after = {
    id: "client-source",
    full_name: "Invented client",
    token: "invented-token",
    created_date: "2026-09-07T00:00:00.000Z",
    updated_date: "2026-09-07T00:00:00.000Z",
  };
  const entry = {
    scope: "GLOBAL",
    sequence: "00000000000000000001",
    item_type: "ENTRY",
    entity_type: "Client",
    entity_key: `Client#${after.id}`,
    operation_type: "create",
    operation_id: "operation-create",
    operation_index: 0,
    operation_count: 1,
    before: null,
    after,
    before_hash: null,
    after_hash: hashRecord(after),
  };
  const baseline = {
    manifestSha256: "a".repeat(64),
    projectionSha256: hashProjection(state),
    lastAppliedGlobalCursor: 0,
    state,
  };
  scenario.context.baseline = baseline;
  scenario.context.control = {
    ...scenario.context.control,
    baseline_projection_sha256: baseline.projectionSha256,
  };
  scenario.plan = buildReplayPlan({
    baseline,
    control: scenario.context.control,
    entries: [entry],
  });
  const records = Object.fromEntries(ENTITY_NAMES.map((entity) => [entity, new Map()]));
  records.User.set("owner-user", {
    id: "owner-user",
    email: "owner@example.invalid",
    role: "admin",
  });
  let createAttempted = false;
  scenario.bridge = {
    sourceSha256: "b".repeat(64),
    request: vi.fn(async (request) => {
      if (request.operation === "filter_id") {
        const record = records[request.entity].get(request.id);
        return { records: record ? [record] : [] };
      }
      if (request.operation === "filter_source_id") {
        return {
          records: [...records[request.entity].values()].filter(
            (record) => record.auditflow_source_id === request.source_id,
          ),
        };
      }
      if (request.operation === "create") {
        createAttempted = true;
        const record = { ...request.record, id: "client-assigned" };
        records.Client.set(record.id, record);
        if (ambiguousCreate) throw new Error("simulated timeout after acceptance");
        return { record };
      }
      throw new Error("unexpected bridge request");
    }),
    listAll: vi.fn(async (entity) => [...records[entity].values()]),
  };
  return { ...scenario, createAttempted: () => createAttempted };
}

describe("durable replay and reconciliation", () => {
  it("writes an ID-only dry-run without adapter mutations", () => {
    const { context, plan, bridge } = replayScenario();
    expect(writePrivateDryRun(context, plan)).toEqual({ entityCount: 1, fileCount: 0 });
    expect(context.clients.dynamo.send).not.toHaveBeenCalled();
    expect(bridge.request).not.toHaveBeenCalled();
    const contents = readFileSync(
      join(context.target.value.local_paths.dry_run_root, "run-test", "plan.json"),
      "utf8",
    );
    expect(contents).toContain("client-1");
    expect(contents).not.toContain("before");
  });

  it("resumes on an operation boundary and reruns with zero writes", async () => {
    const { context, plan, bridge } = replayScenario();
    await expect(
      replayPlan(context, plan, { bridge, pauseAfterOperations: 1 }),
    ).rejects.toMatchObject({ category: "operator_pause_after_checkpoint" });
    await expect(replayPlan(context, plan, { bridge, resume: true })).resolves.toMatchObject({
      writes: 0,
    });
    await expect(replayPlan(context, plan, { bridge, resume: true })).resolves.toMatchObject({
      writes: 0,
    });
    expect(
      bridge.request.mock.calls.filter(([request]) => request.operation === "update"),
    ).toHaveLength(1);
  });

  it("recovers an assigned-ID create after an ambiguous response", async () => {
    const { context, plan, bridge, createAttempted } = assignedCreateScenario({
      ambiguousCreate: true,
    });
    await expect(replayPlan(context, plan, { bridge })).resolves.toMatchObject({ writes: 1 });
    expect(createAttempted()).toBe(true);
    await expect(replayPlan(context, plan, { bridge, resume: true })).resolves.toMatchObject({
      writes: 0,
    });
    await expect(reconcilePlan(context, plan, { bridge })).resolves.toMatchObject({
      status: "passed",
      missing: 0,
      extra: 0,
      drift: 0,
    });
  });

  it("reconciles all entities and permits only aggregate evidence", async () => {
    const { context, plan, bridge } = replayScenario();
    await replayPlan(context, plan, { bridge });
    await expect(reconcilePlan(context, plan, { bridge })).resolves.toMatchObject({
      status: "passed",
      missing: 0,
      extra: 0,
      drift: 0,
    });
    const checkpoint = openReplayCheckpoint(context, plan, bridge.sourceSha256, { resume: true });
    try {
      checkpoint.state.lastRunWrites = 0;
      checkpoint.state.resumed = true;
      checkpoint.save();
      const evidence = buildAggregateEvidence(
        context,
        plan,
        checkpoint.state,
        new Date("2026-09-07T00:00:00.000Z"),
      );
      expect(evidence.gates.zeroDrift).toBe(true);
      expect(() => assertAggregateEvidencePrivacy(evidence)).not.toThrow();
    } finally {
      checkpoint.close();
    }
  });

  it("rejects raw identifiers and network locations in committed evidence", () => {
    expect(() => assertAggregateEvidencePrivacy({ clientId: "client-1" })).toThrowError(
      expect.objectContaining({ category: "evidence_privacy_violation" }),
    );
    expect(() => assertAggregateEvidencePrivacy({ value: "https://example.invalid" })).toThrowError(
      expect.objectContaining({ category: "evidence_privacy_violation" }),
    );
  });

  it("refuses abandonment reopen when a durable replay receipt exists", async () => {
    const { context, bridge } = replayScenario();
    context.clients.dynamo.send = vi.fn().mockResolvedValue({
      Items: [{ run_id: context.control.run_id }],
    });
    await expect(assertNoReplayWritesForAbandonment(context, bridge)).rejects.toMatchObject({
      category: "resume_aws_writes_forbidden",
    });
  });

  it("stops before another destination write after abort-replay", async () => {
    const { context, plan, bridge } = replayScenario();
    context.maintenance = {
      getControl: vi.fn().mockResolvedValue({
        ...context.control,
        replay_state: "ABORTED",
      }),
    };
    await expect(replayPlan(context, plan, { bridge })).rejects.toMatchObject({
      category: "replay_no_longer_authorized",
    });
    expect(bridge.request).not.toHaveBeenCalled();
  });
});

describe("controlled target capabilities", () => {
  it("cleans up an observed assigned ID when a later alias gate fails", async () => {
    const { context } = replayScenario();
    const filePath = join(context.target.value.local_paths.fixture_root, "assigned-id.bin");
    writeFileSync(filePath, "invented fixture");
    const crudEntities = ENTITY_NAMES.filter((entity) => entity !== "User");
    const fixture = {
      entity_records: Object.fromEntries(
        crudEntities.map((entity) => [
          entity,
          {
            id: `requested-${entity}`,
            created_date: "2026-09-07T00:00:00.000Z",
            updated_date: "2026-09-07T00:00:00.000Z",
          },
        ]),
      ),
      updated_entity_records: Object.fromEntries(
        crudEntities.map((entity) => [entity, { id: `requested-${entity}` }]),
      ),
      pagination_client_record: { id: "requested-pagination" },
      user_update: { drive_base_path: "capability" },
      invitation_email: "invite@example.invalid",
      private_file_path: filePath,
    };
    const clients = new Map();
    const bridge = {
      assertRuntimeVersions: vi.fn(),
      listAll: vi.fn(async (entity) =>
        entity === "User"
          ? [{ id: "owner", email: "owner@example.invalid", role: "admin" }]
          : entity === "Client"
            ? [...clients.values()]
            : [],
      ),
      request: vi.fn(async (request) => {
        if (request.operation === "create") {
          if (request.entity !== "Client") throw new Error("simulated ambiguous failure");
          const record = { ...request.record, id: "assigned-client-id" };
          clients.set(record.id, record);
          return { record };
        }
        if (request.operation === "filter_source_id") {
          return {
            records: [...clients.values()].filter(
              (record) => record.auditflow_source_id === request.source_id,
            ),
          };
        }
        if (request.operation === "filter_id") {
          return { records: clients.has(request.id) ? [clients.get(request.id)] : [] };
        }
        if (request.operation === "delete" && request.entity === "Client") {
          clients.delete(request.id);
          return { result: { success: true } };
        }
        throw new Error("unexpected bridge request");
      }),
    };

    await expect(
      runCapabilityMatrix(context.target, { bridge, fixture, confirm: true }),
    ).rejects.toMatchObject({ category: "base44_source_alias_blocker" });
    expect(clients.size).toBe(0);
  });

  it("accepts only explicit not-found status as file-deletion proof", async () => {
    await expect(
      assertBase44FileAbsent(
        {
          request: vi
            .fn()
            .mockRejectedValue(
              new ReplayFailure("bridge_operation_failed", undefined, { status: 404 }),
            ),
        },
        "private/test",
      ),
    ).resolves.toBeUndefined();

    await expect(
      assertBase44FileAbsent(
        {
          request: vi
            .fn()
            .mockRejectedValue(
              new ReplayFailure("bridge_operation_failed", undefined, { status: 500 }),
            ),
        },
        "private/test",
      ),
    ).rejects.toMatchObject({ category: "base44_file_delete_unobservable" });
  });

  it("treats disposable capability-file cleanup as best effort", async () => {
    const bridge = {
      request: vi.fn(async (request) => {
        if (request.operation === "delete_file") throw new Error("unsupported");
        throw new Error("unexpected bridge request");
      }),
    };

    await expect(
      attemptDisposableFileCleanup(bridge, "private/disposable-capability-file"),
    ).resolves.toBe(false);
  });

  it("proves required capabilities when disposable file cleanup is unsupported", async () => {
    const { context } = replayScenario();
    const filePath = join(context.target.value.local_paths.fixture_root, "capability.bin");
    writeFileSync(filePath, "invented fixture");
    const records = Object.fromEntries(ENTITY_NAMES.map((entity) => [entity, new Map()]));
    records.User.set("owner-user", {
      id: "owner-user",
      email: "owner@example.invalid",
      role: "admin",
    });
    let storedFile = false;
    let assignedId = 0;
    const bridge = {
      listAll: vi.fn(async (entity) => [...records[entity].values()]),
      request: vi.fn(async (request) => {
        if (request.operation === "create" || request.operation === "update") {
          const id = request.id ?? `assigned-${request.entity}-${++assignedId}`;
          const record = { ...(records[request.entity].get(id) ?? {}), ...request.record, id };
          records[request.entity].set(id, record);
          return { record };
        }
        if (request.operation === "filter_id") {
          return {
            records: records[request.entity].has(request.id)
              ? [records[request.entity].get(request.id)]
              : [],
          };
        }
        if (request.operation === "filter_source_id") {
          return {
            records: [...records[request.entity].values()].filter(
              (record) => record.auditflow_source_id === request.source_id,
            ),
          };
        }
        if (request.operation === "filter_user_email") {
          return {
            records: [...records.User.values()].filter(
              (record) => record.email === request.email,
            ),
          };
        }
        if (request.operation === "delete") {
          records[request.entity].delete(request.id);
          return { result: { success: true } };
        }
        if (request.operation === "invite_user") {
          const existing = [...records.User.values()].find(
            (record) => record.email === request.email,
          );
          if (!existing) {
            records.User.set("capability-user", {
              id: "capability-user",
              email: request.email,
              role: request.role,
            });
          }
          return { result: { accepted: true } };
        }
        if (request.operation === "upload_private_file") {
          storedFile = true;
          return { file_uri: "private/test" };
        }
        if (request.operation === "sign_file") {
          if (!storedFile) {
            throw new ReplayFailure("bridge_operation_failed", undefined, { status: 404 });
          }
          return { signed_url: "https://fixture.invalid" };
        }
        if (request.operation === "delete_file") {
          throw new Error("unsupported disposable cleanup");
        }
        throw new Error("unexpected bridge request");
      }),
    };
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => new Response(readFileSync(filePath), { status: 200 }));
    const fixture = {
      entity_records: Object.fromEntries(
        ENTITY_NAMES.filter((entity) => entity !== "User").map((entity) => [
          entity,
          {
            id: `capability-${entity.toLowerCase()}`,
            marker: "created",
            created_date: "2026-09-07T00:00:00.000Z",
            updated_date: "2026-09-07T00:00:00.000Z",
          },
        ]),
      ),
      updated_entity_records: Object.fromEntries(
        ENTITY_NAMES.filter((entity) => entity !== "User").map((entity) => [
          entity,
          {
            id: `capability-${entity.toLowerCase()}`,
            marker: "updated",
            created_date: "2026-09-07T00:00:00.000Z",
            updated_date: "2026-09-07T00:01:00.000Z",
          },
        ]),
      ),
      pagination_client_record: {
        id: "capability-client-second",
        marker: "pagination",
      },
      user_update: { drive_base_path: "capability-only" },
      invitation_email: "disposable@example.invalid",
      private_file_path: filePath,
    };
    await expect(
      runCapabilityMatrix(context.target, {
        bridge,
        fixture,
        confirm: true,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      status: "pending_invitation_acceptance",
      gates: {
        privateUploadReadObserved: true,
        disposableFileDeletionObserved: false,
        disposableFileDeletionRequired: false,
      },
    });
    expect(records.User.size).toBe(2);

    await expect(
      runCapabilityMatrix(context.target, {
        bridge,
        fixture,
        confirm: true,
        confirmInvitationLogin: true,
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      status: "passed",
      gates: {
        assignedIdsMapped: true,
        sourceAliasesObserved: true,
        sourceTimestampsPreserved: true,
        privateUploadReadObserved: true,
        disposableFileDeletionObserved: false,
        disposableFileDeletionRequired: false,
      },
    });
  });

  it("binds a target fingerprint and rejects production without explicit confirmation", () => {
    const root = mkdtempSync(join(tmpdir(), "auditflow-target-test-"));
    const localPaths = {};
    for (const key of [
      "checkpoint_root",
      "dry_run_root",
      "fixture_root",
      "clone_root",
      "private_evidence_root",
    ]) {
      localPaths[key] = join(root, key);
      mkdirSync(localPaths[key]);
    }
    const descriptorPath = join(root, "target.json");
    writeFileSync(
      descriptorPath,
      JSON.stringify({
        production: false,
        purpose: "rollback-replay-rehearsal",
        base44: {
          visibility: "private",
          credential_provider: "base44-cli-authenticated-profile",
          app_id: "synthetic-target",
        },
        local_paths: localPaths,
        expected_source_fingerprint: {
          entity_schema_count: 6,
          backend_function_count: 17,
        },
        deployment: {
          base44_cli_version: "0.1.14",
          deno_version: "2.9.5",
          deployed_entity_count: 6,
          deployed_function_count: 16,
          excluded_function: "notifySubmissionCompleted",
        },
        readiness: {
          block_fixture_writes_until_empty_enumeration: true,
          production_integrations_reconnected: false,
        },
        cleanup: { mismatched_clone_remote_cleanup_required: false },
      }),
    );
    const first = loadTargetDescriptor(descriptorPath);
    const second = loadTargetDescriptor(descriptorPath);
    expect(first.fingerprintSha256).toBe(second.fingerprintSha256);
    expect(() =>
      parseArguments([
        "doctor",
        "--stage",
        "production",
        "--target-descriptor",
        descriptorPath,
      ]),
    ).toThrowError(expect.objectContaining({ category: "production_confirmation_required" }));
  });

  it("keeps the bridge fixed and allowlisted", () => {
    const source = readFileSync(new URL("./base44_replay_bridge.ts", import.meta.url), "utf8");
    expect(source).toContain('throw new Error("invalid_request")');
    expect(source).toContain('operation === "filter_source_id"');
    expect(source).toContain('operation === "filter_user_email"');
    expect(source).not.toMatch(/\beval\s*\(|new\s+Function\s*\(/);
    expect(source).not.toContain("request.code");
  });
});

describe("upload drain and orphan inventory", () => {
  it("cancels an expired presign only after observing no object", async () => {
    const dynamo = { send: vi.fn().mockResolvedValue({}) };
    const s3 = {
      send: vi.fn(async (command) => {
        expect(command).toBeInstanceOf(HeadObjectCommand);
        throw Object.assign(new Error("missing"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        });
      }),
    };
    const operator = new OperatorMaintenanceControl(
      dynamo,
      "journal-test",
      () => new Date("2026-09-07T00:01:00.000Z"),
      { s3, bucketName: "files-test" },
    );
    await operator.settleExpiredUploadIntents(
      { mode: "OPEN", generation: 3 },
      [
        {
          sequence: "a".repeat(64),
          activity_type: "UPLOAD_CAPABILITY",
          status: "ACTIVE",
          generation: 3,
          expires_at: "2026-09-07T00:00:00.000Z",
          resource_reference: "private://files/firms/ddcpa/templates/fixture/pdf-template/file.pdf",
        },
      ],
    );
    expect(dynamo.send).toHaveBeenCalledTimes(1);
  });

  it("blocks any owned S3 object without its create receipt", async () => {
    const dynamo = { send: vi.fn().mockResolvedValue({}) };
    const s3 = {
      send: vi.fn(async (command) => {
        expect(command).toBeInstanceOf(ListObjectsV2Command);
        return { Contents: [{ Key: "firms/ddcpa/templates/fixture/pdf-template/file.pdf" }] };
      }),
    };
    const operator = new OperatorMaintenanceControl(
      dynamo,
      "journal-test",
      () => new Date("2026-09-07T00:01:00.000Z"),
      { s3, bucketName: "files-test" },
    );
    await expect(operator.assertNoUnjournaledOwnedObjects()).rejects.toMatchObject({
      category: "orphan_upload_blocker",
    });
  });
});
