import { describe, expect, it } from "vitest";

import {
  formatJournalSequence,
  fileOperationReceiptSchema,
  fileReconciliationSchema,
  journalCursorSchema,
  journalEntrySchema,
} from "../contracts/change-journal";

describe("ChangeJournal contract", () => {
  it("uses a distinct operational cursor and sortable entry sequences", () => {
    expect(
      journalCursorSchema.parse({
        scope: "GLOBAL",
        sequence: "!CURSOR",
        item_type: "CURSOR",
        last_sequence: 0,
      }),
    ).toBeTruthy();
    expect(formatJournalSequence(42)).toBe("00000000000000000042");
  });

  it("requires replay metadata, hashes, and bounded file references", () => {
    expect(
      journalEntrySchema.parse({
        scope: "GLOBAL",
        sequence: formatJournalSequence(1),
        item_type: "ENTRY",
        entity_type: "Client",
        entity_key: "Client#client-1",
        operation_type: "create",
        operation_id: "operation-1",
        operation_index: 0,
        operation_count: 1,
        actor_id: "user-1",
        request_id: "request-1",
        occurred_at: "2026-01-01T00:00:00.000Z",
        before: null,
        after: { id: "client-1" },
        before_hash: null,
        after_hash: "a".repeat(64),
        file_references: [{ path: "files.0", value: "opaque://file-1" }],
      }),
    ).toBeTruthy();
    expect(() => formatJournalSequence(0)).toThrow();
  });

  it("accepts bounded File evidence and a distinct operation receipt", () => {
    const entry = journalEntrySchema.parse({
      scope: "GLOBAL",
      sequence: formatJournalSequence(2),
      item_type: "ENTRY",
      entity_type: "File",
      entity_key: `File#${"a".repeat(64)}`,
      operation_type: "create",
      operation_id: "operation-file",
      operation_index: 0,
      operation_count: 1,
      actor_id: "public-client:test",
      request_id: "request-test",
      occurred_at: "2026-01-01T00:00:00.000Z",
      before: null,
      after: { file_uri: "private://files/legacy/" + "b".repeat(64) },
      before_hash: null,
      after_hash: "c".repeat(64),
      file_references: [],
    });
    expect(entry.entity_type).toBe("File");
    expect(
      fileOperationReceiptSchema.parse({
        scope: "FILE_OPERATION",
        sequence: "d".repeat(64),
        item_type: "FILE_RECEIPT",
        file_uri: "private://files/legacy/" + "b".repeat(64),
        operation_id: "operation-file",
        occurred_at: "2026-01-01T00:00:00.000Z",
      }),
    ).toBeTruthy();
  });

  it("keeps delete-compensation reconciliation bounded and reference-free", () => {
    const record = fileReconciliationSchema.parse({
      scope: "FILE_RECONCILIATION",
      sequence: "a".repeat(64),
      item_type: "FILE_RECONCILIATION",
      operation_id: "file-delete-test",
      actor_id: "user-test",
      request_id: "request-test",
      reference_hash: "b".repeat(64),
      delete_marker_version_id: "marker-version",
      journal_failure_name: "InternalError",
      restoration_failure_name: "ServiceUnavailable",
      occurred_at: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(record)).not.toContain("private://");
  });
});
