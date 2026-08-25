import { createHash } from "node:crypto";

import {
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  type TransactWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

import {
  formatJournalSequence,
  FILE_RECEIPT_SCOPE,
  FILE_RECONCILIATION_SCOPE,
  JOURNAL_CURSOR_SEQUENCE,
  JOURNAL_MAX_ACTIONS,
  JOURNAL_MAX_ITEM_BYTES,
  JOURNAL_SCOPE,
  journalEntrySchema,
  fileOperationReceiptSchema,
  fileReconciliationSchema,
  type FileOperationReceipt,
  type MutationChange,
} from "../contracts/change-journal";
import { ApiError, conflict, internalError } from "../core/errors";
import type { DynamoDocumentClient } from "../repositories/dynamo";

type TransactionItem = NonNullable<
  TransactWriteCommandInput["TransactItems"]
>[number];

interface CursorResult {
  readonly Item?: { readonly last_sequence?: number };
}

interface TransactionFailure extends Error {
  readonly CancellationReasons?: readonly { readonly Code?: string }[];
  readonly $retryable?: unknown;
}

export interface JournalCommitInput {
  readonly actorId: string;
  readonly requestId: string;
  readonly operationId: string;
  readonly businessActions: readonly TransactionItem[];
  readonly changes: readonly MutationChange[];
}

export interface ChangeJournalOptions {
  readonly client: DynamoDocumentClient;
  readonly tableName: string;
  readonly clock?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly maxCursorAttempts?: number;
}

export interface FileOperationCommitInput {
  readonly actorId: string;
  readonly requestId: string;
  readonly operationId: string;
  readonly receiptKey: string;
  readonly fileUri: string;
  readonly change: MutationChange;
}

export interface FileReconciliationInput {
  readonly actorId: string;
  readonly requestId: string;
  readonly operationId: string;
  readonly receiptKey: string;
  readonly referenceHash: string;
  readonly deleteMarkerVersionId: string;
  readonly journalFailureName: string;
  readonly restorationFailureName: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function hashRecord(record: Readonly<Record<string, unknown>> | null) {
  if (record === null) return null;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(record)))
    .digest("hex");
}

function changedSnapshots(change: MutationChange) {
  if (change.operationType !== "update") {
    return { before: change.before, after: change.after };
  }
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const keys = new Set([
    ...Object.keys(change.before ?? {}),
    ...Object.keys(change.after ?? {}),
  ]);
  for (const key of keys) {
    const oldValue = change.before?.[key];
    const newValue = change.after?.[key];
    if (JSON.stringify(canonicalize(oldValue)) === JSON.stringify(canonicalize(newValue))) {
      continue;
    }
    before[key] = oldValue === undefined ? { __auditflow_missing: true } : oldValue;
    after[key] = newValue === undefined ? { __auditflow_missing: true } : newValue;
  }
  return { before, after };
}

export function collectFileReferences(
  ...records: readonly (Readonly<Record<string, unknown>> | null)[]
) {
  const references = new Map<string, { path: string; value: string }>();
  const visit = (value: unknown, path: string, fileContext: boolean) => {
    if (typeof value === "string" && fileContext && value.length > 0) {
      references.set(`${path}\u0000${value}`, { path, value });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}.${index}`, fileContext));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        visit(entry, path ? `${path}.${key}` : key, fileContext || /(file|uri|url)/i.test(key));
      }
    }
  };
  records.forEach((record) => visit(record, "", false));
  return [...references.values()];
}

function transactionToken(operationId: string, cursor: number) {
  return createHash("sha256")
    .update(`${operationId}:${cursor}`)
    .digest("base64url")
    .slice(0, 36);
}

function isCursorConflict(error: TransactionFailure) {
  return (
    error.name === "TransactionCanceledException" &&
    error.CancellationReasons?.[0]?.Code === "ConditionalCheckFailed"
  );
}

function isConditionalConflict(error: TransactionFailure) {
  return (
    error.name === "ConditionalCheckFailedException" ||
    (error.name === "TransactionCanceledException" &&
      error.CancellationReasons?.some(
        (reason, index) => index > 0 && reason.Code === "ConditionalCheckFailed",
      ))
  );
}

export class ChangeJournalService {
  private readonly clock: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxCursorAttempts: number;

  constructor(private readonly options: ChangeJournalOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.maxCursorAttempts = options.maxCursorAttempts ?? 4;
  }

  async getFileOperationReceipt(receiptKey: string): Promise<FileOperationReceipt | undefined> {
    const result = (await this.options.client.send(
      new GetCommand({
        TableName: this.options.tableName,
        Key: { scope: FILE_RECEIPT_SCOPE, sequence: receiptKey },
        ConsistentRead: true,
      }),
    )) as { readonly Item?: Record<string, unknown> };
    if (!result.Item) return undefined;
    const parsed = fileOperationReceiptSchema.safeParse(result.Item);
    if (!parsed.success) throw internalError();
    return parsed.data;
  }

  async commitFileOperation(input: FileOperationCommitInput) {
    const existing = await this.getFileOperationReceipt(input.receiptKey);
    if (existing) return { fileUri: existing.file_uri, replayed: true } as const;

    const receipt = fileOperationReceiptSchema.parse({
      scope: FILE_RECEIPT_SCOPE,
      sequence: input.receiptKey,
      item_type: "FILE_RECEIPT",
      file_uri: input.fileUri,
      operation_id: input.operationId,
      occurred_at: this.clock().toISOString(),
    });
    try {
      await this.commit({
        actorId: input.actorId,
        requestId: input.requestId,
        operationId: input.operationId,
        businessActions: [
          {
            Put: {
              TableName: this.options.tableName,
              Item: receipt,
              ConditionExpression:
                "attribute_not_exists(#scope) AND attribute_not_exists(#sequence)",
              ExpressionAttributeNames: { "#scope": "scope", "#sequence": "sequence" },
            },
          },
        ],
        changes: [input.change],
      });
      return { fileUri: input.fileUri, replayed: false } as const;
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 409) {
        throw error;
      }
      const winner = await this.getFileOperationReceipt(input.receiptKey);
      if (!winner) throw error;
      return { fileUri: winner.file_uri, replayed: true } as const;
    }
  }

  async recordFileReconciliation(input: FileReconciliationInput) {
    const record = fileReconciliationSchema.parse({
      scope: FILE_RECONCILIATION_SCOPE,
      sequence: input.receiptKey,
      item_type: "FILE_RECONCILIATION",
      operation_id: input.operationId,
      actor_id: input.actorId,
      request_id: input.requestId,
      reference_hash: input.referenceHash,
      delete_marker_version_id: input.deleteMarkerVersionId,
      journal_failure_name: input.journalFailureName,
      restoration_failure_name: input.restorationFailureName,
      occurred_at: this.clock().toISOString(),
    });
    await this.options.client.send(
      new PutCommand({
        TableName: this.options.tableName,
        Item: record,
      }),
    );
    return record;
  }

  async commit(input: JournalCommitInput) {
    if (input.changes.length === 0) throw internalError();
    if (
      1 + input.businessActions.length + input.changes.length >
      JOURNAL_MAX_ACTIONS
    ) {
      throw internalError();
    }

    for (let attempt = 0; attempt < this.maxCursorAttempts; attempt += 1) {
      const cursorResult = (await this.options.client.send(
        new GetCommand({
          TableName: this.options.tableName,
          Key: { scope: JOURNAL_SCOPE, sequence: JOURNAL_CURSOR_SEQUENCE },
          ConsistentRead: true,
        }),
      )) as CursorResult;
      const current = cursorResult.Item?.last_sequence ?? 0;
      const occurredAt = this.clock().toISOString();
      const entries = input.changes.map((change, index) => {
        const snapshots = changedSnapshots(change);
        const candidate = {
          scope: JOURNAL_SCOPE,
          sequence: formatJournalSequence(current + index + 1),
          item_type: "ENTRY",
          entity_type: change.entityType,
          entity_key: `${change.entityType}#${change.entityKey}`,
          operation_type: change.operationType,
          operation_id: input.operationId,
          operation_index: index,
          operation_count: input.changes.length,
          actor_id: input.actorId,
          request_id: input.requestId,
          occurred_at: occurredAt,
          before: snapshots.before,
          after: snapshots.after,
          before_hash: hashRecord(change.before),
          after_hash: hashRecord(change.after),
          file_references: collectFileReferences(change.before, change.after),
        };
        if (
          Buffer.byteLength(JSON.stringify(candidate), "utf8") >
          JOURNAL_MAX_ITEM_BYTES
        ) {
          throw internalError();
        }
        const parsed = journalEntrySchema.safeParse(candidate);
        if (!parsed.success) throw internalError();
        return parsed.data;
      });
      const cursorAction: TransactionItem = {
        Put: {
          TableName: this.options.tableName,
          Item: {
            scope: JOURNAL_SCOPE,
            sequence: JOURNAL_CURSOR_SEQUENCE,
            item_type: "CURSOR",
            last_sequence: current + entries.length,
          },
          ConditionExpression:
            current === 0
              ? "attribute_not_exists(#scope)"
              : "#last_sequence = :expected",
          ExpressionAttributeNames:
            current === 0
              ? { "#scope": "scope" }
              : { "#last_sequence": "last_sequence" },
          ExpressionAttributeValues:
            current === 0 ? undefined : { ":expected": current },
        },
      };
      const transactItems: TransactionItem[] = [
        cursorAction,
        ...input.businessActions,
        ...entries.map((entry) => ({
          Put: {
            TableName: this.options.tableName,
            Item: entry,
            ConditionExpression:
              "attribute_not_exists(#scope) AND attribute_not_exists(#sequence)",
            ExpressionAttributeNames: {
              "#scope": "scope",
              "#sequence": "sequence",
            },
          },
        })),
      ];
      const command = new TransactWriteCommand({
        TransactItems: transactItems,
        ClientRequestToken: transactionToken(input.operationId, current),
      });
      try {
        await this.options.client.send(command);
        return entries;
      } catch (caught) {
        const error = caught as TransactionFailure;
        if (isCursorConflict(error) && attempt + 1 < this.maxCursorAttempts) {
          await this.sleep((attempt + 1) * 5);
          continue;
        }
        if (error.$retryable) {
          try {
            await this.options.client.send(command);
            return entries;
          } catch (retryCaught) {
            const retryError = retryCaught as TransactionFailure;
            if (isConditionalConflict(retryError)) throw conflict();
            throw internalError();
          }
        }
        if (isConditionalConflict(error)) throw conflict();
        throw internalError();
      }
    }
    throw conflict();
  }
}

export type { TransactionItem };
