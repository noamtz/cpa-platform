import type { z } from "zod";

import {
  pdfTemplatePersistedSchema,
  type PdfTemplateRecord,
} from "../contracts/templates";
import { getRecord, queryRecords, type DynamoDocumentClient } from "./dynamo";

export { pdfTemplatePersistedSchema, type PdfTemplateRecord } from "../contracts/templates";

export class PdfTemplateRepository {
  constructor(
    readonly client: DynamoDocumentClient,
    readonly tableName: string,
  ) {}

  get(id: string) {
    return getRecord(this.client, this.tableName, id, pdfTemplatePersistedSchema);
  }

  list(activeOnly = true, limit = 200) {
    return queryRecords<PdfTemplateRecord>({
      client: this.client,
      tableName: this.tableName,
      indexName: "byCreatedDate",
      keyExpression: "#record_type = :record_type",
      expressionNames: { "#record_type": "record_type" },
      expressionValues: { ":record_type": "PdfTemplate" },
      schema: pdfTemplatePersistedSchema as z.ZodType<PdfTemplateRecord>,
      filter: activeOnly ? { is_active: true } : {},
      ascending: false,
      limit,
    });
  }
}
