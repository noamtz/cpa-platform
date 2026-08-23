import type { z } from "zod";

import {
  clientPersistedSchema,
  type ClientFilter,
  type ClientRecord,
  type EntitySort,
} from "../contracts/entities";
import {
  getRecord,
  matchesFilter,
  queryRecords,
  type DynamoDocumentClient,
} from "./dynamo";

export class ClientRepository {
  constructor(
    readonly client: DynamoDocumentClient,
    readonly tableName: string,
  ) {}

  get(id: string) {
    return getRecord(this.client, this.tableName, id, clientPersistedSchema);
  }

  async query(filter: ClientFilter, sort: EntitySort, limit: number) {
    if (filter.id) {
      const record = await this.get(filter.id);
      return record && matchesFilter(record, filter) ? [record] : [];
    }
    return queryRecords<ClientRecord>({
      client: this.client,
      tableName: this.tableName,
      indexName: "byCreatedDate",
      keyExpression: "#record_type = :record_type",
      expressionNames: { "#record_type": "record_type" },
      expressionValues: { ":record_type": "Client" },
      schema: clientPersistedSchema as z.ZodType<ClientRecord>,
      filter,
      ascending: sort === "created_date",
      limit,
    });
  }
}
