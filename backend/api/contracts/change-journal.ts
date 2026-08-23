import { z } from "zod";

export const JOURNAL_SCOPE = "GLOBAL";
export const JOURNAL_CURSOR_SEQUENCE = "!CURSOR";
export const JOURNAL_MAX_ACTIONS = 100;
export const JOURNAL_MAX_ITEM_BYTES = 350_000;

const recordSnapshotSchema = z.record(z.string(), z.unknown());

export const journalCursorSchema = z.object({
  scope: z.literal(JOURNAL_SCOPE),
  sequence: z.literal(JOURNAL_CURSOR_SEQUENCE),
  item_type: z.literal("CURSOR"),
  last_sequence: z.number().int().nonnegative(),
});

export const journalEntrySchema = z.object({
  scope: z.literal(JOURNAL_SCOPE),
  sequence: z.string().regex(/^\d{20}$/),
  item_type: z.literal("ENTRY"),
  entity_type: z.enum(["Client", "Submission", "User"]),
  entity_key: z.string().min(1).max(512),
  operation_type: z.enum(["create", "update", "delete"]),
  operation_id: z.string().min(1).max(128),
  operation_index: z.number().int().nonnegative(),
  operation_count: z.number().int().positive().max(98),
  actor_id: z.string().min(1).max(256),
  request_id: z.string().min(1).max(256),
  occurred_at: z.string().min(1).max(64),
  before: recordSnapshotSchema.nullable(),
  after: recordSnapshotSchema.nullable(),
  before_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  after_hash: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  file_references: z
    .array(
      z.object({
        path: z.string().min(1).max(1024),
        value: z.string().min(1).max(4096),
      }),
    )
    .max(500),
});

export interface MutationChange {
  readonly entityType: "Client" | "Submission" | "User";
  readonly entityKey: string;
  readonly operationType: "create" | "update" | "delete";
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
}

export function formatJournalSequence(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Invalid journal sequence");
  }
  return String(sequence).padStart(20, "0");
}
