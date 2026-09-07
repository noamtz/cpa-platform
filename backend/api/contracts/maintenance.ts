import { z } from "zod";

export const MAINTENANCE_CONTROL_SCOPE = "MAINTENANCE_CONTROL";
export const MAINTENANCE_CONTROL_SEQUENCE = "!CONTROL";
export const MAINTENANCE_ACTIVITY_SCOPE = "MAINTENANCE_ACTIVITY";
export const MAINTENANCE_ACTIVITY_SEQUENCE = "!COUNTER";
export const EXTERNAL_ACTIVITY_SCOPE = "EXTERNAL_ACTIVITY";
export const REPLAY_LEDGER_SCOPE = "REVERSE_REPLAY";
export const RECONCILIATION_RESOLUTION_SCOPE = "RECONCILIATION_RESOLUTION";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const cursorSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const maintenanceControlSchema = z
  .object({
    scope: z.literal(MAINTENANCE_CONTROL_SCOPE),
    sequence: z.literal(MAINTENANCE_CONTROL_SEQUENCE),
    item_type: z.literal("MAINTENANCE_CONTROL"),
    mode: z.enum(["OPEN", "MAINTENANCE", "ROLLED_BACK"]),
    generation: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    updated_at: z.string().datetime({ offset: true }),
    cutover_start_cursor: cursorSchema.optional(),
    boundary_end_cursor: cursorSchema.optional(),
    run_id: z.string().min(1).max(128).optional(),
    manifest_sha256: sha256Schema.optional(),
    baseline_projection_sha256: sha256Schema.optional(),
    target_fingerprint_sha256: sha256Schema.optional(),
    replay_state: z
      .enum(["NOT_STARTED", "READY", "IN_PROGRESS", "ABORTED", "RECONCILED", "ROLLED_BACK"])
      .default("NOT_STARTED"),
    replay_started_at: z.string().datetime({ offset: true }).optional(),
    reconciled_at: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const binding = [
      value.cutover_start_cursor,
      value.run_id,
      value.manifest_sha256,
      value.baseline_projection_sha256,
      value.target_fingerprint_sha256,
    ];
    if (binding.some((entry) => entry !== undefined) && binding.some((entry) => entry === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Incomplete cutover binding",
      });
    }
    if (value.boundary_end_cursor !== undefined && value.cutover_start_cursor === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Boundary requires start cursor" });
    }
    if (
      value.boundary_end_cursor !== undefined &&
      value.cutover_start_cursor !== undefined &&
      value.boundary_end_cursor < value.cutover_start_cursor
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid replay range" });
    }
    if (value.mode === "ROLLED_BACK" && value.replay_state !== "ROLLED_BACK") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid terminal state" });
    }
  });

export const maintenanceActivityCounterSchema = z.object({
  scope: z.literal(MAINTENANCE_ACTIVITY_SCOPE),
  sequence: z.literal(MAINTENANCE_ACTIVITY_SEQUENCE),
  item_type: z.literal("MAINTENANCE_ACTIVITY_COUNTER"),
  active_count: z.number().int().nonnegative(),
  updated_at: z.string().datetime({ offset: true }),
});

export const externalActivityIntentSchema = z.object({
  scope: z.literal(EXTERNAL_ACTIVITY_SCOPE),
  sequence: sha256Schema,
  item_type: z.literal("EXTERNAL_ACTIVITY_INTENT"),
  activity_type: z.enum(["COGNITO_INVITATION", "FILE_DELETE", "UPLOAD_CAPABILITY", "ZIP_JOB"]),
  status: z.enum(["ACTIVE", "RESOLVED", "CANCELLED"]),
  generation: z.number().int().positive(),
  operation_id: z.string().min(1).max(128),
  resource_reference: z.string().min(1).max(2048).optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }).optional(),
});

export const reconciliationResolutionSchema = z.object({
  scope: z.literal(RECONCILIATION_RESOLUTION_SCOPE),
  sequence: sha256Schema,
  item_type: z.literal("RECONCILIATION_RESOLUTION"),
  source_scope: z.enum([EXTERNAL_ACTIVITY_SCOPE, "FILE_RECONCILIATION"]),
  source_sequence: sha256Schema,
  resolution_code: z.string().min(1).max(64),
  resolved_at: z.string().datetime({ offset: true }),
  resolved_by: z.string().min(1).max(256),
});

export const routeMaintenanceClassSchema = z.enum([
  "READ_ONLY",
  "BUSINESS_MUTATION",
  "EXTERNAL_SIDE_EFFECT",
]);

export type MaintenanceControl = z.infer<typeof maintenanceControlSchema>;
export type ExternalActivityIntent = z.infer<typeof externalActivityIntentSchema>;
export type RouteMaintenanceClass = z.infer<typeof routeMaintenanceClassSchema>;
