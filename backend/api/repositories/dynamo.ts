import {
  GetCommand,
  QueryCommand,
  type QueryCommandInput,
} from "@aws-sdk/lib-dynamodb";
import type { z } from "zod";

import { internalError } from "../core/errors";

export interface DynamoDocumentClient {
  send(command: unknown): Promise<unknown>;
}

interface GetResult {
  readonly Item?: Record<string, unknown>;
}

interface QueryResult {
  readonly Items?: Record<string, unknown>[];
  readonly LastEvaluatedKey?: Record<string, unknown>;
}

export function matchesFilter(
  item: Readonly<Record<string, unknown>>,
  filter: Readonly<Record<string, unknown>>,
) {
  return Object.entries(filter).every(([key, value]) => item[key] === value);
}

function parseRecord<T>(schema: z.ZodType<T>, item: unknown): T {
  const parsed = schema.safeParse(item);
  if (!parsed.success) throw internalError();
  return parsed.data;
}

export async function getRecord<T>(
  client: DynamoDocumentClient,
  tableName: string,
  recordId: string,
  schema: z.ZodType<T>,
) {
  const result = (await client.send(
    new GetCommand({ TableName: tableName, Key: { id: recordId } }),
  )) as GetResult;
  return result.Item ? parseRecord(schema, result.Item) : undefined;
}

export interface QueryRecordsInput<T> {
  readonly client: DynamoDocumentClient;
  readonly tableName: string;
  readonly indexName: string;
  readonly keyExpression: string;
  readonly expressionNames: Readonly<Record<string, string>>;
  readonly expressionValues: Readonly<Record<string, unknown>>;
  readonly schema: z.ZodType<T>;
  readonly filter: Readonly<Record<string, unknown>>;
  readonly ascending: boolean;
  readonly limit: number;
  readonly exhaustBeforeSort?: boolean;
  readonly recordType?: string;
}

export async function queryRecords<T extends Record<string, unknown>>({
  client,
  tableName,
  indexName,
  keyExpression,
  expressionNames,
  expressionValues,
  schema,
  filter,
  ascending,
  limit,
  exhaustBeforeSort = false,
  recordType,
}: QueryRecordsInput<T>): Promise<T[]> {
  const records: T[] = [];
  let cursor: Record<string, unknown> | undefined;
  let evaluated = 0;
  do {
    const input: QueryCommandInput = {
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: keyExpression,
      ExpressionAttributeNames: { ...expressionNames },
      ExpressionAttributeValues: { ...expressionValues },
      ...(recordType
        ? {
            FilterExpression: "#query_record_type = :query_record_type",
            ExpressionAttributeNames: {
              ...expressionNames,
              "#query_record_type": "record_type",
            },
            ExpressionAttributeValues: {
              ...expressionValues,
              ":query_record_type": recordType,
            },
          }
        : {}),
      ScanIndexForward: ascending,
      Limit: Math.min(200, Math.max(limit, 25)),
      ExclusiveStartKey: cursor,
    };
    const result = (await client.send(new QueryCommand(input))) as QueryResult;
    const page = result.Items ?? [];
    evaluated += page.length;
    for (const item of page) {
      if (recordType && item.record_type !== recordType) continue;
      const parsed = parseRecord(schema, item);
      if (matchesFilter(parsed, filter)) records.push(parsed);
      if (!exhaustBeforeSort && records.length >= limit) break;
    }
    cursor = result.LastEvaluatedKey;
    if (evaluated > 2_000) throw internalError();
  } while (cursor && (exhaustBeforeSort || records.length < limit));

  if (exhaustBeforeSort) {
    records.sort((left, right) => {
      const leftDate = String(left.created_date ?? "");
      const rightDate = String(right.created_date ?? "");
      return (leftDate.localeCompare(rightDate) ||
        String(left.id ?? "").localeCompare(String(right.id ?? ""))) *
        (ascending ? 1 : -1);
    });
  }
  return records.slice(0, limit);
}
