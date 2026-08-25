import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";

import { internalError } from "../core/errors";
import { getRecord, type DynamoDocumentClient } from "./dynamo";

export const pdfTemplatePersistedSchema = z
  .object({
    id: z.string().min(1).max(256),
    name: z.string().max(512).optional(),
    template_json: z.string().min(1).optional(),
    file_reference: z.string().min(1).max(4096).optional(),
    is_active: z.boolean().optional(),
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

  async mirrorFile(input: {
    readonly id: string;
    readonly name: string;
    readonly fileReference: string;
    readonly isActive: boolean;
    readonly actorId: string;
    readonly occurredAt: string;
  }) {
    const result = (await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { id: input.id },
        UpdateExpression:
          "SET #record_type = if_not_exists(#record_type, :record_type), #file_reference = :file_reference, #name = :name, #is_active = :is_active, #created_date = if_not_exists(#created_date, :occurred_at), #updated_date = :occurred_at, #created_by = if_not_exists(#created_by, :actor_id), #version = if_not_exists(#version, :zero) + :one",
        ExpressionAttributeNames: {
          "#record_type": "record_type",
          "#file_reference": "file_reference",
          "#name": "name",
          "#is_active": "is_active",
          "#created_date": "created_date",
          "#updated_date": "updated_date",
          "#created_by": "created_by",
          "#version": "_version",
        },
        ExpressionAttributeValues: {
          ":record_type": "PdfTemplate",
          ":file_reference": input.fileReference,
          ":name": input.name,
          ":is_active": input.isActive,
          ":occurred_at": input.occurredAt,
          ":actor_id": input.actorId,
          ":zero": 0,
          ":one": 1,
        },
        ReturnValues: "ALL_NEW",
      }),
    )) as { Attributes?: Record<string, unknown> };
    const parsed = pdfTemplatePersistedSchema.safeParse(result.Attributes);
    if (!parsed.success) throw internalError();
    return parsed.data;
  }
}
