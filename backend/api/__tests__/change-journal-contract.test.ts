import { describe, expect, it } from "vitest";

import {
  formatJournalSequence,
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
});
