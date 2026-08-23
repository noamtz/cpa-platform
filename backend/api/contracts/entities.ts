import { z } from "zod";

const id = z.string().min(1).max(256);
const timestamp = z.string().min(1).max(64);
const optionalText = z.string().max(4096).optional();
const sort = z.enum(["created_date", "-created_date"]).default("-created_date");
const limit = z.number().int().min(1).max(200).default(200);

export const clientStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "ready_for_ira",
  "reviewed",
]);
export const osekTypeSchema = z.enum(["עוסק פטור", "עוסק מורשה"]);

const clientFields = {
  full_name: z.string().trim().min(1).max(512),
  email: z.string().email().max(512).optional(),
  phone: z.string().max(128).optional(),
  tax_year: z.number().int().min(1900).max(2200).optional(),
  osek_type: osekTypeSchema.optional(),
  pricing: z.number().finite().nonnegative().optional(),
  status: clientStatusSchema.optional(),
  notes: optionalText,
  last_activity: timestamp.optional(),
  is_archived: z.boolean().optional(),
};

export const clientPersistedSchema = z
  .object({
    id,
    ...clientFields,
    token: z.string().min(16).max(256),
    record_type: z.literal("Client"),
    _version: z.number().int().positive(),
    created_date: timestamp,
    updated_date: timestamp,
    created_by: z.string().max(512).optional(),
  })
  .passthrough();

export const clientCreateSchema = z
  .object({
    ...clientFields,
    full_name: clientFields.full_name,
    token: z.string().optional(),
  })
  .strict();

export const clientUpdateSchema = z
  .object(clientFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const clientFilterSchema = z
  .object({
    id: id.optional(),
    full_name: z.string().max(512).optional(),
    email: z.string().max(512).optional(),
    tax_year: z.number().int().optional(),
    status: clientStatusSchema.optional(),
    is_archived: z.boolean().optional(),
  })
  .strict();

export const clientQuerySchema = z
  .object({ filter: clientFilterSchema.default({}), sort, limit })
  .strict();

const submissionKnownFields = {
  client_id: id,
  tax_year: z.number().int().min(1900).max(2200).optional(),
  cpa_status: z.enum(["ready_for_ira", "reviewed"]).optional(),
  is_archived: z.boolean().optional(),
  responses: z.string().optional(),
  signed_pdfs: z.string().optional(),
  cpa_audit_log: z.string().optional(),
};

export const submissionPersistedSchema = z
  .object({
    id,
    ...submissionKnownFields,
    record_type: z.literal("Submission"),
    _version: z.number().int().positive(),
    created_date: timestamp,
    updated_date: timestamp,
    created_by: z.string().max(512).optional(),
  })
  .passthrough();

export const submissionUpdateSchema = z
  .object({
    cpa_status: submissionKnownFields.cpa_status,
    is_archived: submissionKnownFields.is_archived,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const submissionFilterSchema = z
  .object({
    id: id.optional(),
    client_id: id.optional(),
    tax_year: z.number().int().optional(),
    is_archived: z.boolean().optional(),
    cpa_status: submissionKnownFields.cpa_status,
  })
  .strict();

export const submissionQuerySchema = z
  .object({ filter: submissionFilterSchema.default({}), sort, limit })
  .strict();

export const userPersistedSchema = z
  .object({
    id,
    full_name: z.string().max(512).optional(),
    email: z.string().email().max(512),
    role: z.enum(["admin", "user"]),
    drive_base_path: z.string().max(2048).optional(),
    cognito_sub: id,
    record_type: z.literal("User"),
    _version: z.number().int().positive(),
    created_date: timestamp,
    updated_date: timestamp,
    created_by: z.string().max(512).optional(),
  })
  .passthrough();

export const userQuerySchema = z
  .object({ filter: z.object({}).strict().default({}), sort, limit })
  .strict();

export const updateMeSchema = z
  .object({ drive_base_path: z.string().max(2048) })
  .strict();

export const inviteUserSchema = z
  .object({ email: z.string().trim().email().max(512), role: z.literal("admin") })
  .strict();

export const tokenRotationSchema = z.object({}).strict();

export const googleDriveSyncSchema = z.union([
  z.object({ check_connection: z.literal(true) }).strict(),
  z.object({ submission_id: id, client_id: id }).strict(),
  z
    .object({
      sync_all: z.literal(true),
      submission_ids: z.array(id).min(1).max(200),
    })
    .strict(),
]);
export const connectorSchema = z
  .object({ connector_id: z.string().min(1).max(256) })
  .strict();
export const telegramSchema = z
  .object({ event: z.string().min(1).max(128), record_id: id.optional() })
  .strict();

export type ClientRecord = z.infer<typeof clientPersistedSchema>;
export type SubmissionRecord = z.infer<typeof submissionPersistedSchema>;
export type UserRecord = z.infer<typeof userPersistedSchema>;
export type ClientFilter = z.infer<typeof clientFilterSchema>;
export type SubmissionFilter = z.infer<typeof submissionFilterSchema>;
export type EntitySort = z.infer<typeof sort>;

export function publicRecord<T extends Record<string, unknown>>(record: T) {
  const visible: Record<string, unknown> = { ...record };
  delete visible.record_type;
  delete visible.cognito_sub;
  delete visible._version;
  return visible;
}
