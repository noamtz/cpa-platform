import type { z } from "zod";

import {
  userPersistedSchema,
  type EntitySort,
  type UserRecord,
} from "../contracts/entities";
import {
  getRecord,
  queryRecords,
  type DynamoDocumentClient,
} from "./dynamo";

export class UserRepository {
  constructor(
    readonly client: DynamoDocumentClient,
    readonly tableName: string,
  ) {}

  get(id: string) {
    return getRecord(this.client, this.tableName, id, userPersistedSchema);
  }

  list(sort: EntitySort, limit: number) {
    return queryRecords<UserRecord>({
      client: this.client,
      tableName: this.tableName,
      indexName: "byCreatedDate",
      keyExpression: "#record_type = :record_type",
      expressionNames: { "#record_type": "record_type" },
      expressionValues: { ":record_type": "User" },
      schema: userPersistedSchema as z.ZodType<UserRecord>,
      filter: {},
      ascending: sort === "created_date",
      limit,
    });
  }

  findByCognitoSubject(subject: string) {
    return queryRecords<UserRecord>({
      client: this.client,
      tableName: this.tableName,
      indexName: "byCognitoSubject",
      keyExpression: "#cognito_sub = :cognito_sub",
      expressionNames: { "#cognito_sub": "cognito_sub" },
      expressionValues: { ":cognito_sub": subject },
      schema: userPersistedSchema as z.ZodType<UserRecord>,
      filter: {},
      ascending: true,
      limit: 3,
    });
  }

  async findByEmail(email: string) {
    const users = await this.list("-created_date", 200);
    return users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  }
}
