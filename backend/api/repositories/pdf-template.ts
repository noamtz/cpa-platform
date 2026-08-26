import { z } from "zod";

import { getRecord, type DynamoDocumentClient } from "./dynamo";

export const pdfTemplatePersistedSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().max(512).optional(),
    template_json: z.string().min(1).optional(),
    file_reference: z.string().min(1).max(4096).optional(),
    is_active: z.boolean().optional(),
    source_version: z.number().int().positive().optional(),
    record_type: z.literal("PdfTemplate"),
    _version: z.number().int().positive(),
    created_date: z.string().min(1).max(64),
    updated_date: z.string().min(1).max(64),
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

export type PdfTemplateRecord = z.infer<typeof pdfTemplatePersistedSchema>;

export class PdfTemplateRepository {
  constructor(
    readonly client: DynamoDocumentClient,
    readonly tableName: string,
  ) {}

  get(id: string) {
    return getRecord(this.client, this.tableName, id, pdfTemplatePersistedSchema);
  }
}
