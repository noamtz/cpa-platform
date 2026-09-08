import { PutCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { describe, expect, it, vi } from "vitest";

import {
  externalActivityIntentSchema,
  maintenanceControlSchema,
} from "../contracts/maintenance";
import { maintenanceInProgress } from "../core/errors";
import { createHandler, type ApiDependencies } from "../handler";
import { MaintenanceService } from "../services/maintenance";

const now = "2026-09-07T00:00:00.000Z";

function openControl(generation = 3) {
  return {
    scope: "MAINTENANCE_CONTROL",
    sequence: "!CONTROL",
    item_type: "MAINTENANCE_CONTROL",
    mode: "OPEN",
    generation,
    replay_state: "NOT_STARTED",
    updated_at: now,
  } as const;
}

describe("maintenance control", () => {
  it("accepts strict OPEN and terminal ROLLED_BACK states", () => {
    expect(maintenanceControlSchema.parse(openControl()).mode).toBe("OPEN");
    expect(
      maintenanceControlSchema.parse({
        ...openControl(),
        mode: "ROLLED_BACK",
        replay_state: "ROLLED_BACK",
      }).mode,
    ).toBe("ROLLED_BACK");
    expect(() =>
      maintenanceControlSchema.parse({
        ...openControl(),
        mode: "ROLLED_BACK",
      }),
    ).toThrow();
  });

  it("fails closed for a missing or malformed control", async () => {
    const missing = new MaintenanceService({
      client: { send: vi.fn().mockResolvedValue({}) },
      tableName: "ChangeJournalTable.test",
    });
    await expect(missing.requireOpen()).rejects.toMatchObject({ statusCode: 503 });

    const malformed = new MaintenanceService({
      client: { send: vi.fn().mockResolvedValue({ Item: { mode: "OPEN" } }) },
      tableName: "ChangeJournalTable.test",
    });
    await expect(malformed.requireOpen()).rejects.toMatchObject({ statusCode: 503 });
  });

  it("bootstraps control and the distinct activity counter atomically", async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = new MaintenanceService({
      client: { send },
      tableName: "ChangeJournalTable.test",
      clock: () => new Date(now),
    });
    await expect(service.bootstrapOpen()).resolves.toMatchObject({
      mode: "OPEN",
      generation: 1,
    });
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toHaveLength(2);
  });

  it("creates a fenced external intent and matching counter increment", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: openControl() })
      .mockResolvedValueOnce({ Item: openControl() })
      .mockResolvedValueOnce({});
    const service = new MaintenanceService({
      client: { send },
      tableName: "ChangeJournalTable.test",
      clock: () => new Date(now),
    });
    const intent = await service.beginExternalActivity({
      activityType: "FILE_DELETE",
      operationId: "operation-test",
      sequenceSeed: "private-seed",
    });
    expect(externalActivityIntentSchema.parse(intent).generation).toBe(3);
    const command = send.mock.calls[2][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toHaveLength(3);
    expect(JSON.stringify(command.input)).not.toContain("private-seed");
  });

  it("settles an observed compensation after the boundary has closed", async () => {
    const closed = {
      ...openControl(4),
      mode: "MAINTENANCE",
      replay_state: "READY",
      cutover_start_cursor: 2,
      boundary_end_cursor: 3,
      run_id: "run-test",
      manifest_sha256: "a".repeat(64),
      baseline_projection_sha256: "b".repeat(64),
      target_fingerprint_sha256: "c".repeat(64),
    } as const;
    const intent = externalActivityIntentSchema.parse({
      scope: "EXTERNAL_ACTIVITY",
      sequence: "d".repeat(64),
      item_type: "EXTERNAL_ACTIVITY_INTENT",
      activity_type: "COGNITO_INVITATION",
      status: "ACTIVE",
      generation: 3,
      operation_id: "operation-test",
      created_at: now,
      updated_at: now,
    });
    const send = vi.fn().mockResolvedValueOnce({ Item: closed }).mockResolvedValueOnce({});
    const service = new MaintenanceService({
      client: { send },
      tableName: "ChangeJournalTable.test",
      clock: () => new Date(now),
    });
    await expect(service.resolveExternalActivity(intent)).resolves.toBeUndefined();
    const command = send.mock.calls[1][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);
    expect(command.input.TransactItems).toHaveLength(3);
  });

  it("reopens only an abandoned run with explicit zero-write proof", async () => {
    const control = {
      ...openControl(),
      mode: "MAINTENANCE",
      replay_state: "ABORTED",
      cutover_start_cursor: 4,
      boundary_end_cursor: 5,
      run_id: "run-test",
      manifest_sha256: "a".repeat(64),
      baseline_projection_sha256: "b".repeat(64),
      target_fingerprint_sha256: "c".repeat(64),
    } as const;
    const send = vi.fn().mockResolvedValueOnce({ Item: control }).mockResolvedValueOnce({});
    const service = new MaintenanceService({
      client: { send },
      tableName: "ChangeJournalTable.test",
      clock: () => new Date(now),
    });
    await expect(
      service.resumeAwsWrites({ confirmNoReplayWrites: false }),
    ).rejects.toMatchObject({ statusCode: 503 });

    const acceptedSend = vi
      .fn()
      .mockResolvedValueOnce({ Item: control })
      .mockResolvedValueOnce({});
    const accepted = new MaintenanceService({
      client: { send: acceptedSend },
      tableName: "ChangeJournalTable.test",
      clock: () => new Date(now),
    });
    await expect(
      accepted.resumeAwsWrites({ confirmNoReplayWrites: true }),
    ).resolves.toMatchObject({ mode: "OPEN", generation: 4 });
    expect(acceptedSend.mock.calls[1][0]).toBeInstanceOf(PutCommand);
  });
});

describe("route maintenance gate", () => {
  const event = (routeKey: string) =>
    ({
      routeKey,
      rawPath: routeKey.split(" ")[1],
      requestContext: { requestId: "request-test", http: { method: "POST", path: "/" } },
    }) as unknown as APIGatewayProxyEventV2;

  it("returns the stable 503 for classified writes while reads and health remain available", async () => {
    const dependencies = {
      verifier: {},
      users: {},
      entities: {},
      publicQuestionnaire: {},
      files: {},
      userService: {},
      maintenance: { requireOpen: vi.fn().mockRejectedValue(maintenanceInProgress()) },
    } as unknown as ApiDependencies;
    const handler = createHandler(() => "test", () => dependencies);
    const response = await handler(
      event("POST /apps/{appId}/functions/updateClientSubmission"),
      {} as never,
      vi.fn(),
    );
    expect(response).toMatchObject({
      statusCode: 503,
      body: JSON.stringify({ error: "Maintenance in progress" }),
    });
    const health = await handler(event("GET /health"), {} as never, vi.fn());
    expect(health).toMatchObject({ statusCode: 200 });
  });

  it("authenticates protected mutations before disclosing maintenance", async () => {
    const requireOpen = vi.fn().mockRejectedValue(maintenanceInProgress());
    const dependencies = {
      verifier: {},
      users: {},
      entities: {},
      publicQuestionnaire: {},
      files: {},
      userService: {},
      maintenance: { requireOpen },
    } as unknown as ApiDependencies;
    const handler = createHandler(() => "test", () => dependencies);
    const response = await handler(event("POST /cpa/clients"), {} as never, vi.fn());
    expect(response).toMatchObject({ statusCode: 401 });
    expect(requireOpen).not.toHaveBeenCalled();
  });
});
