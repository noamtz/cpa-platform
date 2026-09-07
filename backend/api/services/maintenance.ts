import { createHash, randomUUID } from "node:crypto";

import {
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

import {
  EXTERNAL_ACTIVITY_SCOPE,
  MAINTENANCE_ACTIVITY_SCOPE,
  MAINTENANCE_ACTIVITY_SEQUENCE,
  MAINTENANCE_CONTROL_SCOPE,
  MAINTENANCE_CONTROL_SEQUENCE,
  externalActivityIntentSchema,
  maintenanceActivityCounterSchema,
  maintenanceControlSchema,
  type ExternalActivityIntent,
  type MaintenanceControl,
} from "../contracts/maintenance";
import { JOURNAL_CURSOR_SEQUENCE, JOURNAL_SCOPE } from "../contracts/change-journal";
import { internalError, maintenanceInProgress } from "../core/errors";
import type { DynamoDocumentClient } from "../repositories/dynamo";

export type MaintenanceTransactionItem = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

export interface MaintenanceServiceOptions {
  readonly client: DynamoDocumentClient;
  readonly tableName: string;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
}

export interface CutoverStartBinding {
  readonly runId: string;
  readonly expectedCursor: number;
  readonly manifestSha256: string;
  readonly baselineProjectionSha256: string;
  readonly targetFingerprintSha256: string;
}

export interface BeginExternalActivityInput {
  readonly activityType: ExternalActivityIntent["activity_type"];
  readonly operationId: string;
  readonly expiresAt?: string;
  readonly sequenceSeed?: string;
  readonly resourceReference?: string;
}

function isConditionalFailure(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    ["ConditionalCheckFailedException", "TransactionCanceledException"].includes(
      String((error as { name?: string }).name),
    )
  );
}

export function externalActivitySequence(seed: string) {
  return createHash("sha256").update(seed).digest("hex");
}

export class MaintenanceService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;

  constructor(private readonly options: MaintenanceServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  async getControl(): Promise<MaintenanceControl | undefined> {
    const result = (await this.options.client.send(
      new GetCommand({
        TableName: this.options.tableName,
        Key: { scope: MAINTENANCE_CONTROL_SCOPE, sequence: MAINTENANCE_CONTROL_SEQUENCE },
        ConsistentRead: true,
      }),
    )) as { readonly Item?: Record<string, unknown> };
    if (!result.Item) return undefined;
    const parsed = maintenanceControlSchema.safeParse(result.Item);
    if (!parsed.success) throw maintenanceInProgress();
    return parsed.data;
  }

  async requireOpen() {
    const control = await this.getControl();
    if (!control || control.mode !== "OPEN") throw maintenanceInProgress();
    return control;
  }

  fence(generation: number): MaintenanceTransactionItem {
    return {
      ConditionCheck: {
        TableName: this.options.tableName,
        Key: { scope: MAINTENANCE_CONTROL_SCOPE, sequence: MAINTENANCE_CONTROL_SEQUENCE },
        ConditionExpression: "#mode = :open AND #generation = :generation",
        ExpressionAttributeNames: { "#mode": "mode", "#generation": "generation" },
        ExpressionAttributeValues: { ":open": "OPEN", ":generation": generation },
      },
    };
  }

  private settlementFence(control: MaintenanceControl): MaintenanceTransactionItem {
    return {
      ConditionCheck: {
        TableName: this.options.tableName,
        Key: { scope: MAINTENANCE_CONTROL_SCOPE, sequence: MAINTENANCE_CONTROL_SEQUENCE },
        ConditionExpression: "#mode = :mode AND #generation = :generation",
        ExpressionAttributeNames: { "#mode": "mode", "#generation": "generation" },
        ExpressionAttributeValues: {
          ":mode": control.mode,
          ":generation": control.generation,
        },
      },
    };
  }

  async transactOpen(
    actions: readonly MaintenanceTransactionItem[],
    expectedGeneration?: number,
  ) {
    const control = await this.requireOpen();
    const generation = expectedGeneration ?? control.generation;
    if (control.generation !== generation) throw maintenanceInProgress();
    try {
      await this.options.client.send(
        new TransactWriteCommand({ TransactItems: [this.fence(generation), ...actions] }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) throw maintenanceInProgress();
      throw internalError();
    }
    return generation;
  }

  async bootstrapOpen() {
    const now = this.clock().toISOString();
    const control = maintenanceControlSchema.parse({
      scope: MAINTENANCE_CONTROL_SCOPE,
      sequence: MAINTENANCE_CONTROL_SEQUENCE,
      item_type: "MAINTENANCE_CONTROL",
      mode: "OPEN",
      generation: 1,
      replay_state: "NOT_STARTED",
      updated_at: now,
    });
    const counter = maintenanceActivityCounterSchema.parse({
      scope: MAINTENANCE_ACTIVITY_SCOPE,
      sequence: MAINTENANCE_ACTIVITY_SEQUENCE,
      item_type: "MAINTENANCE_ACTIVITY_COUNTER",
      active_count: 0,
      updated_at: now,
    });
    try {
      await this.options.client.send(
        new TransactWriteCommand({
          TransactItems: [control, counter].map((Item) => ({
            Put: {
              TableName: this.options.tableName,
              Item,
              ConditionExpression: "attribute_not_exists(#scope)",
              ExpressionAttributeNames: { "#scope": "scope" },
            },
          })),
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) throw maintenanceInProgress();
      throw internalError();
    }
    return control;
  }

  async beginExternalActivity(input: BeginExternalActivityInput) {
    const control = await this.requireOpen();
    const now = this.clock().toISOString();
    const sequence = externalActivitySequence(
      input.sequenceSeed ?? `${input.activityType}:${input.operationId}:${this.idGenerator()}`,
    );
    const intent = externalActivityIntentSchema.parse({
      scope: EXTERNAL_ACTIVITY_SCOPE,
      sequence,
      item_type: "EXTERNAL_ACTIVITY_INTENT",
      activity_type: input.activityType,
      status: "ACTIVE",
      generation: control.generation,
      operation_id: input.operationId,
      ...(input.resourceReference
        ? { resource_reference: input.resourceReference }
        : {}),
      created_at: now,
      updated_at: now,
      ...(input.expiresAt ? { expires_at: input.expiresAt } : {}),
    });
    const actions: MaintenanceTransactionItem[] = [
      {
        Put: {
          TableName: this.options.tableName,
          Item: intent,
          ConditionExpression: "attribute_not_exists(#scope)",
          ExpressionAttributeNames: { "#scope": "scope" },
        },
      },
      {
        Update: {
          TableName: this.options.tableName,
          Key: { scope: MAINTENANCE_ACTIVITY_SCOPE, sequence: MAINTENANCE_ACTIVITY_SEQUENCE },
          UpdateExpression: "SET #updated_at = :now ADD #active_count :one",
          ConditionExpression: "attribute_exists(#scope)",
          ExpressionAttributeNames: {
            "#scope": "scope",
            "#updated_at": "updated_at",
            "#active_count": "active_count",
          },
          ExpressionAttributeValues: { ":now": now, ":one": 1 },
        },
      },
    ];
    await this.transactOpen(actions, control.generation);
    return intent;
  }

  async getExternalActivity(sequenceSeed: string) {
    const result = (await this.options.client.send(
      new GetCommand({
        TableName: this.options.tableName,
        Key: {
          scope: EXTERNAL_ACTIVITY_SCOPE,
          sequence: externalActivitySequence(sequenceSeed),
        },
        ConsistentRead: true,
      }),
    )) as { readonly Item?: Record<string, unknown> };
    if (!result.Item) return undefined;
    const parsed = externalActivityIntentSchema.safeParse(result.Item);
    if (!parsed.success) throw internalError();
    return parsed.data;
  }

  resolutionActions(
    intent: ExternalActivityIntent,
    status: "RESOLVED" | "CANCELLED" = "RESOLVED",
  ): readonly MaintenanceTransactionItem[] {
    const now = this.clock().toISOString();
    return [
      {
        Update: {
          TableName: this.options.tableName,
          Key: { scope: intent.scope, sequence: intent.sequence },
          UpdateExpression: "SET #status = :resolved, #updated_at = :now",
          ConditionExpression: "#status = :active AND #generation = :generation",
          ExpressionAttributeNames: {
            "#status": "status",
            "#updated_at": "updated_at",
            "#generation": "generation",
          },
          ExpressionAttributeValues: {
            ":resolved": status,
            ":active": "ACTIVE",
            ":generation": intent.generation,
            ":now": now,
          },
        },
      },
      {
        Update: {
          TableName: this.options.tableName,
          Key: { scope: MAINTENANCE_ACTIVITY_SCOPE, sequence: MAINTENANCE_ACTIVITY_SEQUENCE },
          UpdateExpression: "SET #updated_at = :now ADD #active_count :minus_one",
          ConditionExpression: "#active_count > :zero",
          ExpressionAttributeNames: {
            "#updated_at": "updated_at",
            "#active_count": "active_count",
          },
          ExpressionAttributeValues: { ":now": now, ":minus_one": -1, ":zero": 0 },
        },
      },
    ];
  }

  private async settleExternalActivity(
    intent: ExternalActivityIntent,
    status: "RESOLVED" | "CANCELLED",
  ) {
    if (intent.status !== "ACTIVE") return;
    const control = await this.getControl();
    if (
      !control ||
      control.mode === "ROLLED_BACK" ||
      control.generation < intent.generation
    ) {
      throw maintenanceInProgress();
    }
    try {
      await this.options.client.send(
        new TransactWriteCommand({
          TransactItems: [
            this.settlementFence(control),
            ...this.resolutionActions(intent, status),
          ],
        }),
      );
    } catch (error) {
      if (isConditionalFailure(error)) throw maintenanceInProgress();
      throw internalError();
    }
  }

  async resolveExternalActivity(intent: ExternalActivityIntent) {
    await this.settleExternalActivity(intent, "RESOLVED");
  }

  async cancelExternalActivity(intent: ExternalActivityIntent) {
    await this.settleExternalActivity(intent, "CANCELLED");
  }

  async listActiveIntents() {
    const result = (await this.options.client.send(
      new QueryCommand({
        TableName: this.options.tableName,
        KeyConditionExpression: "#scope = :scope",
        ExpressionAttributeNames: { "#scope": "scope" },
        ExpressionAttributeValues: { ":scope": EXTERNAL_ACTIVITY_SCOPE },
        ConsistentRead: true,
      }),
    )) as { readonly Items?: readonly Record<string, unknown>[] };
    return (result.Items ?? [])
      .map((item) => externalActivityIntentSchema.safeParse(item))
      .filter((result) => result.success)
      .map((result) => result.data)
      .filter((intent) => intent.status === "ACTIVE");
  }

  async markCutoverStart(binding: CutoverStartBinding) {
    const control = await this.requireOpen();
    if (control.cutover_start_cursor !== undefined) throw internalError();
    const now = this.clock().toISOString();
    const next = maintenanceControlSchema.parse({
      ...control,
      generation: control.generation + 1,
      updated_at: now,
      cutover_start_cursor: binding.expectedCursor,
      run_id: binding.runId,
      manifest_sha256: binding.manifestSha256,
      baseline_projection_sha256: binding.baselineProjectionSha256,
      target_fingerprint_sha256: binding.targetFingerprintSha256,
      replay_state: "READY",
    });
    const cursorCondition: MaintenanceTransactionItem = {
      ConditionCheck:
        binding.expectedCursor === 0
          ? {
              TableName: this.options.tableName,
              Key: { scope: JOURNAL_SCOPE, sequence: JOURNAL_CURSOR_SEQUENCE },
              ConditionExpression: "attribute_not_exists(#scope)",
              ExpressionAttributeNames: { "#scope": "scope" },
            }
          : {
              TableName: this.options.tableName,
              Key: { scope: JOURNAL_SCOPE, sequence: JOURNAL_CURSOR_SEQUENCE },
              ConditionExpression: "#last_sequence = :cursor",
              ExpressionAttributeNames: { "#last_sequence": "last_sequence" },
              ExpressionAttributeValues: { ":cursor": binding.expectedCursor },
            },
    };
    await this.options.client.send(
      new TransactWriteCommand({
        TransactItems: [
          cursorCondition,
          {
            Put: {
              TableName: this.options.tableName,
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

  async closeMaintenance() {
    const control = await this.requireOpen();
    if (control.cutover_start_cursor === undefined) throw internalError();
    const [cursorResult, counterResult, activeIntents] = await Promise.all([
      this.options.client.send(
        new GetCommand({
          TableName: this.options.tableName,
          Key: { scope: JOURNAL_SCOPE, sequence: JOURNAL_CURSOR_SEQUENCE },
          ConsistentRead: true,
        }),
      ) as Promise<{ readonly Item?: { readonly last_sequence?: number } }>,
      this.options.client.send(
        new GetCommand({
          TableName: this.options.tableName,
          Key: { scope: MAINTENANCE_ACTIVITY_SCOPE, sequence: MAINTENANCE_ACTIVITY_SEQUENCE },
          ConsistentRead: true,
        }),
      ) as Promise<{ readonly Item?: Record<string, unknown> }>,
      this.listActiveIntents(),
    ]);
    const counter = maintenanceActivityCounterSchema.safeParse(counterResult.Item);
    const end = cursorResult.Item?.last_sequence ?? 0;
    if (!counter.success || counter.data.active_count !== 0 || activeIntents.length > 0) {
      throw maintenanceInProgress();
    }
    if (!Number.isSafeInteger(end) || Number(end) < control.cutover_start_cursor) {
      throw internalError();
    }
    const next = maintenanceControlSchema.parse({
      ...control,
      mode: "MAINTENANCE",
      generation: control.generation + 1,
      boundary_end_cursor: end,
      updated_at: this.clock().toISOString(),
    });
    try {
      await this.options.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck:
                end === 0
                  ? {
                      TableName: this.options.tableName,
                      Key: { scope: JOURNAL_SCOPE, sequence: JOURNAL_CURSOR_SEQUENCE },
                      ConditionExpression: "attribute_not_exists(#scope)",
                      ExpressionAttributeNames: { "#scope": "scope" },
                    }
                  : {
                      TableName: this.options.tableName,
                      Key: { scope: JOURNAL_SCOPE, sequence: JOURNAL_CURSOR_SEQUENCE },
                      ConditionExpression: "#last_sequence = :end",
                      ExpressionAttributeNames: { "#last_sequence": "last_sequence" },
                      ExpressionAttributeValues: { ":end": end },
                    },
            },
            {
              ConditionCheck: {
                TableName: this.options.tableName,
                Key: { scope: MAINTENANCE_ACTIVITY_SCOPE, sequence: MAINTENANCE_ACTIVITY_SEQUENCE },
                ConditionExpression: "#active_count = :zero",
                ExpressionAttributeNames: { "#active_count": "active_count" },
                ExpressionAttributeValues: { ":zero": 0 },
              },
            },
            {
              Put: {
                TableName: this.options.tableName,
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
    } catch (error) {
      if (isConditionalFailure(error)) throw maintenanceInProgress();
      throw internalError();
    }
    return next;
  }

  async updateReplayState(
    state: MaintenanceControl["replay_state"],
    expected: readonly MaintenanceControl["replay_state"][],
  ) {
    const control = await this.getControl();
    if (!control || control.mode !== "MAINTENANCE" || !expected.includes(control.replay_state)) {
      throw maintenanceInProgress();
    }
    const nextMode = state === "ROLLED_BACK" ? "ROLLED_BACK" : control.mode;
    const next = maintenanceControlSchema.parse({
      ...control,
      mode: nextMode,
      generation: control.generation + 1,
      replay_state: state,
      updated_at: this.clock().toISOString(),
      ...(state === "IN_PROGRESS" ? { replay_started_at: this.clock().toISOString() } : {}),
      ...(state === "RECONCILED" ? { reconciled_at: this.clock().toISOString() } : {}),
    });
    await this.options.client.send(
      new PutCommand({
        TableName: this.options.tableName,
        Item: next,
        ConditionExpression: "#generation = :generation AND #mode = :maintenance",
        ExpressionAttributeNames: { "#generation": "generation", "#mode": "mode" },
        ExpressionAttributeValues: { ":generation": control.generation, ":maintenance": "MAINTENANCE" },
      }),
    );
    return next;
  }

  abortReplay() {
    return this.updateReplayState("ABORTED", ["READY", "IN_PROGRESS"]);
  }

  markReconciled() {
    return this.updateReplayState("RECONCILED", ["IN_PROGRESS"]);
  }

  markRolledBack() {
    return this.updateReplayState("ROLLED_BACK", ["RECONCILED"]);
  }

  async resumeAwsWrites(input: { readonly confirmNoReplayWrites: boolean }) {
    const control = await this.getControl();
    if (
      !control ||
      control.mode !== "MAINTENANCE" ||
      !input.confirmNoReplayWrites ||
      !["READY", "ABORTED"].includes(control.replay_state)
    ) {
      throw maintenanceInProgress();
    }
    const next = maintenanceControlSchema.parse({
      scope: control.scope,
      sequence: control.sequence,
      item_type: control.item_type,
      mode: "OPEN",
      generation: control.generation + 1,
      replay_state: "NOT_STARTED",
      updated_at: this.clock().toISOString(),
    });
    await this.options.client.send(
      new PutCommand({
        TableName: this.options.tableName,
        Item: next,
        ConditionExpression: "#generation = :generation AND #mode = :maintenance",
        ExpressionAttributeNames: { "#generation": "generation", "#mode": "mode" },
        ExpressionAttributeValues: { ":generation": control.generation, ":maintenance": "MAINTENANCE" },
      }),
    );
    return next;
  }
}
