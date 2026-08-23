import type { z } from "zod";

import {
  submissionPersistedSchema,
  type EntitySort,
  type SubmissionFilter,
  type SubmissionRecord,
} from "../contracts/entities";
import {
  getRecord,
  matchesFilter,
  queryRecords,
  type DynamoDocumentClient,
} from "./dynamo";

export class SubmissionRepository {
  constructor(
    readonly client: DynamoDocumentClient,
    readonly tableName: string,
  ) {}

  get(id: string) {
    return getRecord(this.client, this.tableName, id, submissionPersistedSchema);
  }

  async query(filter: SubmissionFilter, sort: EntitySort, limit: number) {
    if (filter.id) {
      const record = await this.get(filter.id);
      return record && matchesFilter(record, filter) ? [record] : [];
    }
    if (filter.client_id) {
      return queryRecords<SubmissionRecord>({
        client: this.client,
        tableName: this.tableName,
        indexName: "byClientYear",
        keyExpression:
          filter.tax_year === undefined
            ? "#client_id = :client_id"
            : "#client_id = :client_id AND #tax_year = :tax_year",
        expressionNames: {
          "#client_id": "client_id",
          ...(filter.tax_year === undefined ? {} : { "#tax_year": "tax_year" }),
        },
        expressionValues: {
          ":client_id": filter.client_id,
          ...(filter.tax_year === undefined ? {} : { ":tax_year": filter.tax_year }),
        },
        schema: submissionPersistedSchema as z.ZodType<SubmissionRecord>,
        filter,
        ascending: sort === "created_date",
        limit,
        exhaustBeforeSort: true,
      });
    }
    return queryRecords<SubmissionRecord>({
      client: this.client,
      tableName: this.tableName,
      indexName: "byCreatedDate",
      keyExpression: "#record_type = :record_type",
      expressionNames: { "#record_type": "record_type" },
      expressionValues: { ":record_type": "Submission" },
      schema: submissionPersistedSchema as z.ZodType<SubmissionRecord>,
      filter,
      ascending: sort === "created_date",
      limit,
    });
  }
}
