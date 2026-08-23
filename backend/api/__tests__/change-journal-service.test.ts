import { GetCommand, TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { ChangeJournalService, hashRecord } from "../services/change-journal";

const actor = {
  userId: "user-1",
  cognitoSubject: "subject-1",
  role: "admin" as const,
};

function input(largeValue?: string) {
  return {
    actor,
    requestId: "request-1",
    operationId: "operation-1",
    businessActions: [
      {
        Put: {
          TableName: "ClientTable.test",
          Item: { id: "client-1" },
          ConditionExpression: "attribute_not_exists(id)",
        },
      },
    ],
    changes: [
      {
        entityType: "Client" as const,
        entityKey: "client-1",
        operationType: "create" as const,
        before: null,
        after: { id: "client-1", file_url: largeValue ?? "opaque://file-1" },
      },
    ],
  };
}

describe("ChangeJournalService", () => {
  it("writes cursor, business state, and immutable evidence in one transaction", async () => {
    const send = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const service = new ChangeJournalService({
      client: { send },
      tableName: "ChangeJournalTable.test",
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const entries = await service.commit(input());

    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    const transaction = send.mock.calls[1][0];
    expect(transaction).toBeInstanceOf(TransactWriteCommand);
    expect(transaction.input.TransactItems).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      sequence: "00000000000000000001",
      operation_count: 1,
      before: null,
      after: { id: "client-1" },
      file_references: [{ path: "file_url", value: "opaque://file-1" }],
    });
  });

  it("reallocates only after a cursor conflict", async () => {
    const cursorConflict = Object.assign(new Error("not exposed"), {
      name: "TransactionCanceledException",
      CancellationReasons: [{ Code: "ConditionalCheckFailed" }],
    });
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Item: { last_sequence: 1 } })
      .mockRejectedValueOnce(cursorConflict)
      .mockResolvedValueOnce({ Item: { last_sequence: 2 } })
      .mockResolvedValueOnce({});
    const service = new ChangeJournalService({
      client: { send },
      tableName: "ChangeJournalTable.test",
      sleep: async () => undefined,
    });

    const entries = await service.commit(input());
    expect(entries[0].sequence).toBe("00000000000000000003");
  });

  it("uses the same idempotency token for a same-payload transport retry", async () => {
    const retryable = Object.assign(new Error("timeout"), { $retryable: {} });
    const send = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(retryable)
      .mockResolvedValueOnce({});
    const service = new ChangeJournalService({
      client: { send },
      tableName: "ChangeJournalTable.test",
    });
    await service.commit(input());
    expect(send.mock.calls[1][0]).toBe(send.mock.calls[2][0]);
    expect(send.mock.calls[1][0].input.ClientRequestToken).toHaveLength(36);
  });

  it("maps business conditional failure to conflict without a second write", async () => {
    const businessConflict = Object.assign(new Error("not exposed"), {
      name: "TransactionCanceledException",
      CancellationReasons: [
        { Code: "None" },
        { Code: "ConditionalCheckFailed" },
      ],
    });
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(businessConflict);
    const service = new ChangeJournalService({
      client: { send },
      tableName: "ChangeJournalTable.test",
    });
    await expect(service.commit(input())).rejects.toMatchObject({ statusCode: 409 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized evidence before TransactWriteItems", async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = new ChangeJournalService({
      client: { send },
      tableName: "ChangeJournalTable.test",
    });
    await expect(service.commit(input("x".repeat(351_000)))).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("rejects excess file evidence instead of silently truncating it", async () => {
    const send = vi.fn().mockResolvedValue({});
    const service = new ChangeJournalService({
      client: { send },
      tableName: "ChangeJournalTable.test",
    });
    const excessive = input();
    (excessive.changes[0] as { after: Record<string, unknown> }).after = {
      id: "client-1",
      files: Array.from({ length: 501 }, (_, index) => `opaque://file-${index}`),
    };
    await expect(service.commit(excessive)).rejects.toMatchObject({
      statusCode: 500,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("hashes equivalent records deterministically", () => {
    expect(hashRecord({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashRecord({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});
