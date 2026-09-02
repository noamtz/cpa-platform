import { z } from "zod";

import { questionnaireTemplatePersistedSchema } from "./public-questionnaire";

export const MAX_QUESTIONNAIRE_STEPS = 200;
export const MAX_TEMPLATE_JSON_BYTES = 2 * 1024 * 1024;

const idSchema = z.string().min(1).max(256);
const timestampSchema = z.string().min(1).max(64);

export const questionnaireStepSchema = z
  .object({
    id: z.string().min(1).max(256),
    title: z.string().min(1).max(2_048),
    question: z.string().min(1).max(8_192),
  })
  .passthrough();

export const saveQuestionnaireTemplateSchema = z
  .object({
    steps: z.array(questionnaireStepSchema).min(1).max(MAX_QUESTIONNAIRE_STEPS),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [index, step] of value.steps.entries()) {
      if (ids.has(step.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "id"],
          message: "Duplicate step ID",
        });
      }
      ids.add(step.id);
    }
  });

function jsonTemplateSchema(value: string, context: z.RefinementCtx) {
  if (Buffer.byteLength(value, "utf8") > MAX_TEMPLATE_JSON_BYTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Template is too large" });
    return;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    if (!("basePdf" in parsed) || !Array.isArray(parsed.schemas)) throw new Error();
    const supportedTypes = new Set([
      "text",
      "image",
      "signature",
      "checkbox",
      "Text",
      "Image",
      "Signature",
      "Checkbox",
    ]);
    if (
      !parsed.schemas.every(
        (page) =>
          Array.isArray(page) &&
          page.every(
            (field) =>
              field &&
              typeof field === "object" &&
              !Array.isArray(field) &&
              typeof (field as Record<string, unknown>).type === "string" &&
              supportedTypes.has((field as Record<string, unknown>).type as string),
          ),
      )
    ) {
      throw new Error();
    }
  } catch {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid PDF template" });
  }
}

const pdfTemplateFields = {
  name: z.string().trim().min(1).max(512),
  template_json: z.string().min(1).superRefine(jsonTemplateSchema),
  is_active: z.boolean().default(true),
};

export const createPdfTemplateSchema = z.object(pdfTemplateFields).strict();
export const updatePdfTemplateSchema = z
  .object(pdfTemplateFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const emptyBodySchema = z.object({}).strict();

export const questionnaireTemplateGuardSchema = z
  .object({
    id: z.literal("!ACTIVE"),
    record_type: z.literal("!ACTIVE_GUARD"),
    active_template_id: idSchema,
    active_version: z.number().int().positive(),
    _version: z.number().int().positive(),
  })
  .strict();

export const pdfTemplatePersistedSchema = z
  .object({
    id: idSchema,
    name: z.string().max(512).optional(),
    template_json: z.string().min(1).optional(),
    file_reference: z.string().min(1).max(4096).optional(),
    is_active: z.boolean().optional(),
    source_version: z.number().int().positive().optional(),
    record_type: z.literal("PdfTemplate"),
    _version: z.number().int().positive(),
    created_date: timestampSchema,
    updated_date: timestampSchema,
    created_by: z.string().max(512).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (!value.template_json && !value.file_reference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PdfTemplate requires template data or a file mirror",
      });
    }
  });

export type SaveQuestionnaireTemplateInput = z.infer<
  typeof saveQuestionnaireTemplateSchema
>;
export type QuestionnaireTemplateRecord = z.infer<
  typeof questionnaireTemplatePersistedSchema
>;
export type QuestionnaireTemplateGuard = z.infer<
  typeof questionnaireTemplateGuardSchema
>;
export type CreatePdfTemplateInput = z.infer<typeof createPdfTemplateSchema>;
export type UpdatePdfTemplateInput = z.infer<typeof updatePdfTemplateSchema>;
export type PdfTemplateRecord = z.infer<typeof pdfTemplatePersistedSchema>;

export function questionnaireTemplateHistory(record: QuestionnaireTemplateRecord) {
  let steps: unknown;
  try {
    steps = JSON.parse(record.steps);
  } catch {
    steps = undefined;
  }
  if (!Array.isArray(steps)) throw new Error("Invalid persisted questionnaire template");
  return {
    id: record.id,
    version: record.version,
    is_active: record.is_active,
    created_at:
      typeof record.created_at === "string" ? record.created_at : record.created_date,
    created_by_email:
      typeof record.created_by_email === "string"
        ? record.created_by_email
        : typeof record.created_by === "string"
          ? record.created_by
          : "system",
    steps_count: steps.length,
  };
}

export function cpaPdfTemplate(record: PdfTemplateRecord) {
  const visible: Record<string, unknown> = { ...record };
  delete visible.record_type;
  return visible;
}

export function pdfTemplateFileReference(templateJson: string) {
  const parsed = JSON.parse(templateJson) as Record<string, unknown>;
  const basePdf = parsed.basePdf;
  if (basePdf && typeof basePdf === "object" && !Array.isArray(basePdf)) {
    const pointer = basePdf as Record<string, unknown>;
    if (pointer.__type === "file_uri" && typeof pointer.value === "string") {
      return pointer.value;
    }
  }
  return undefined;
}
