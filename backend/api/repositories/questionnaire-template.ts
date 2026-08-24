import type { z } from "zod";

import {
  questionnaireTemplatePersistedSchema,
  type QuestionnaireTemplateRecord,
} from "../contracts/public-questionnaire";
import { getRecord, queryRecords, type DynamoDocumentClient } from "./dynamo";

export class QuestionnaireTemplateRepository {
  constructor(
    readonly client: DynamoDocumentClient,
    readonly tableName: string,
  ) {}

  get(id: string) {
    return getRecord(
      this.client,
      this.tableName,
      id,
      questionnaireTemplatePersistedSchema,
    );
  }

  async latestActive(): Promise<QuestionnaireTemplateRecord | undefined> {
    const records = await queryRecords<QuestionnaireTemplateRecord>({
      client: this.client,
      tableName: this.tableName,
      indexName: "byVersion",
      keyExpression: "#record_type = :record_type",
      expressionNames: { "#record_type": "record_type" },
      expressionValues: { ":record_type": "QuestionnaireTemplate" },
      schema: questionnaireTemplatePersistedSchema as z.ZodType<QuestionnaireTemplateRecord>,
      filter: { is_active: true },
      ascending: false,
      limit: 1,
    });
    return records[0];
  }
}
