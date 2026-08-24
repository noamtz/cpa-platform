import { z } from "zod";

import {
  clientPersistedSchema,
  submissionPersistedSchema,
  type ClientRecord,
  type SubmissionRecord,
} from "./entities";

export const MAX_RESPONSES_BYTES = 100_000;
export const MAX_SIGNED_PDFS_BYTES = 50_000;

const idSchema = z.string().min(1).max(256);
const tokenSchema = z.string().min(1).max(512);
const timestampSchema = z.string().datetime({ offset: true }).max(64);

function jsonStringSchema(
  expected: "object" | "array",
  maxBytes: number,
) {
  return z.string().superRefine((value, context) => {
    if (Buffer.byteLength(value, "utf8") > maxBytes) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "JSON value is too large" });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(value);
      const matches =
        expected === "array"
          ? Array.isArray(parsed)
          : parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
      if (!matches) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `JSON value must contain an ${expected}`,
        });
      }
    } catch {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Malformed JSON value" });
    }
  });
}

const publicCredentialsFields = {
  client_id: idSchema,
  token: tokenSchema,
};

export const getClientByTokenSchema = z.object(publicCredentialsFields).strict();
export const getActiveTemplateSchema = z.object(publicCredentialsFields).strict();
export const getTemplateByIdSchema = z
  .object({ ...publicCredentialsFields, template_id: idSchema })
  .strict();

export const publicQuestionnaireDataSchema = z
  .object({
    responses: jsonStringSchema("object", MAX_RESPONSES_BYTES).optional(),
    signed_pdfs: jsonStringSchema("array", MAX_SIGNED_PDFS_BYTES).optional(),
    step_completed: z.number().int().min(0).max(10_000).optional(),
    completed_at: timestampSchema.optional(),
    template_version: z.number().int().positive().max(1_000_000).optional(),
    template_id: idSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Questionnaire data is empty");

export const updateClientSubmissionSchema = z
  .object({
    ...publicCredentialsFields,
    submission_id: idSchema.nullish(),
    _version: z.number().int().positive().optional(),
    data: publicQuestionnaireDataSchema,
    completed: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.submission_id && value._version === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["_version"],
        message: "Existing submissions require a revision",
      });
    }
    if (!value.submission_id && value._version !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["_version"],
        message: "New submissions cannot include a revision",
      });
    }
    if (
      value.completed &&
      (!value.data.completed_at ||
        !value.data.template_id ||
        value.data.template_version === undefined)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data"],
        message: "Completed submissions require timestamp and template metadata",
      });
    }
  });

export const questionnaireTemplatePersistedSchema = z
  .object({
    id: idSchema,
    version: z.number().int().positive(),
    is_active: z.boolean(),
    steps: z.string(),
    record_type: z.literal("QuestionnaireTemplate"),
    _version: z.number().int().positive(),
    created_date: z.string().min(1).max(64),
    updated_date: z.string().min(1).max(64),
    created_by: z.string().max(512).optional(),
  })
  .passthrough();

export const publicClientSchema = clientPersistedSchema.transform(publicClient);
export const publicSubmissionSchema = submissionPersistedSchema.transform(publicSubmission);

export type GetClientByTokenInput = z.infer<typeof getClientByTokenSchema>;
export type GetActiveTemplateInput = z.infer<typeof getActiveTemplateSchema>;
export type GetTemplateByIdInput = z.infer<typeof getTemplateByIdSchema>;
export type UpdateClientSubmissionInput = z.infer<typeof updateClientSubmissionSchema>;
export type PublicQuestionnaireData = z.infer<typeof publicQuestionnaireDataSchema>;
export type QuestionnaireTemplateRecord = z.infer<
  typeof questionnaireTemplatePersistedSchema
>;

const PUBLIC_CLIENT_FIELDS = [
  "id",
  "full_name",
  "email",
  "phone",
  "tax_year",
  "osek_type",
  "status",
  "last_activity",
  "id_number",
] as const;

const PUBLIC_SUBMISSION_FIELDS = [
  "id",
  "client_id",
  "tax_year",
  "cpa_status",
  "is_employee",
  "form_106_uploaded",
  "form_106_files",
  "multiple_employers",
  "has_pension_fund",
  "pension_files",
  "has_stock_market",
  "form_867_uploaded",
  "form_867_files",
  "has_life_insurance",
  "insurance_files",
  "has_donations",
  "donation_files",
  "has_additional_income",
  "additional_income_details",
  "step_completed",
  "completed_at",
  "template_version",
  "template_id",
  "responses",
  "pdf_inputs",
  "pdf_file_url",
  "pdf_template_id",
  "signed_pdfs",
  "created_date",
  "updated_date",
  "_version",
] as const;

function pickFields(
  record: Readonly<Record<string, unknown>>,
  fields: readonly string[],
) {
  return Object.fromEntries(
    fields.flatMap((field) =>
      record[field] === undefined ? [] : [[field, record[field]]],
    ),
  );
}

export function publicClient(record: ClientRecord) {
  return pickFields(record, PUBLIC_CLIENT_FIELDS);
}

export function publicSubmission(record: SubmissionRecord) {
  return pickFields(record, PUBLIC_SUBMISSION_FIELDS);
}

export function publicTemplate(record: QuestionnaireTemplateRecord) {
  let steps: unknown;
  try {
    steps = JSON.parse(record.steps);
  } catch {
    throw new Error("Invalid persisted questionnaire template");
  }
  if (!Array.isArray(steps)) {
    throw new Error("Invalid persisted questionnaire template");
  }
  return {
    id: record.id,
    version: record.version,
    steps,
    created_at:
      typeof record.created_at === "string"
        ? record.created_at
        : record.created_date,
  };
}

export const PUBLIC_QUESTIONNAIRE_ERROR_CODES = {
  submissionArchived: "submission_archived",
  submissionConflict: "submission_conflict",
} as const;
