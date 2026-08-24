import { randomBytes, randomUUID } from "node:crypto";

import type { z } from "zod";

import type { CpaActor } from "../auth/cpa-context";
import {
  clientCreateSchema,
  clientUpdateSchema,
  publicRecord,
  submissionUpdateSchema,
  type ClientFilter,
  type EntitySort,
  type SubmissionFilter,
} from "../contracts/entities";
import { notFound } from "../core/errors";
import type { ClientRepository } from "../repositories/client";
import type { SubmissionRepository } from "../repositories/submission";
import type { ChangeJournalService, TransactionItem } from "./change-journal";

type ClientCreate = z.infer<typeof clientCreateSchema>;
type ClientUpdate = z.infer<typeof clientUpdateSchema>;
type SubmissionUpdate = z.infer<typeof submissionUpdateSchema>;

export interface EntityServiceOptions {
  readonly clients: ClientRepository;
  readonly submissions: SubmissionRepository;
  readonly journal: ChangeJournalService;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly tokenGenerator?: () => string;
  readonly operationIdGenerator?: () => string;
}

function conditionalCreate(tableName: string, item: Record<string, unknown>): TransactionItem {
  return {
    Put: {
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(#id)",
      ExpressionAttributeNames: { "#id": "id" },
    },
  };
}

function conditionalUpdate(
  tableName: string,
  item: Record<string, unknown>,
  expectedVersion: number,
): TransactionItem {
  return {
    Put: {
      TableName: tableName,
      Item: item,
      ConditionExpression: "#version = :expected_version",
      ExpressionAttributeNames: { "#version": "_version" },
      ExpressionAttributeValues: { ":expected_version": expectedVersion },
    },
  };
}

export class EntityService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly tokenGenerator: () => string;
  private readonly operationIdGenerator: () => string;

  constructor(private readonly options: EntityServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.tokenGenerator =
      options.tokenGenerator ?? (() => randomBytes(32).toString("base64url"));
    this.operationIdGenerator = options.operationIdGenerator ?? randomUUID;
  }

  async listClients(filter: ClientFilter, sort: EntitySort, limit: number) {
    return (await this.options.clients.query(filter, sort, limit)).map(publicRecord);
  }

  async createClient(
    actor: CpaActor,
    requestId: string,
    data: ClientCreate,
  ) {
    const now = this.clock().toISOString();
    const accepted: Omit<ClientCreate, "token"> = { ...data };
    delete (accepted as { token?: string }).token;
    const record = {
      pricing: 1500,
      status: "pending" as const,
      is_archived: false,
      tax_year: 2024,
      ...accepted,
      id: this.idGenerator(),
      token: this.tokenGenerator(),
      record_type: "Client" as const,
      _version: 1,
      created_date: now,
      updated_date: now,
      created_by: actor.userId,
    };
    await this.options.journal.commit({
      actorId: actor.userId,
      requestId,
      operationId: this.operationIdGenerator(),
      businessActions: [
        conditionalCreate(this.options.clients.tableName, record),
      ],
      changes: [
        {
          entityType: "Client",
          entityKey: record.id,
          operationType: "create",
          before: null,
          after: record,
        },
      ],
    });
    return publicRecord(record);
  }

  async updateClient(
    actor: CpaActor,
    requestId: string,
    id: string,
    patch: ClientUpdate | { readonly token: string },
  ) {
    const before = await this.options.clients.get(id);
    if (!before) throw notFound();
    const after = {
      ...before,
      ...patch,
      updated_date: this.clock().toISOString(),
      _version: before._version + 1,
    };
    await this.options.journal.commit({
      actorId: actor.userId,
      requestId,
      operationId: this.operationIdGenerator(),
      businessActions: [
        conditionalUpdate(this.options.clients.tableName, after, before._version),
      ],
      changes: [
        {
          entityType: "Client",
          entityKey: id,
          operationType: "update",
          before,
          after,
        },
      ],
    });
    return publicRecord(after);
  }

  rotateClientToken(actor: CpaActor, requestId: string, id: string) {
    return this.updateClient(actor, requestId, id, {
      token: this.tokenGenerator(),
    });
  }

  async listSubmissions(
    filter: SubmissionFilter,
    sort: EntitySort,
    limit: number,
  ) {
    return (await this.options.submissions.query(filter, sort, limit)).map(
      publicRecord,
    );
  }

  async updateSubmission(
    actor: CpaActor,
    requestId: string,
    id: string,
    patch: SubmissionUpdate,
  ) {
    const before = await this.options.submissions.get(id);
    if (!before) throw notFound();
    const after = {
      ...before,
      ...patch,
      updated_date: this.clock().toISOString(),
      _version: before._version + 1,
    };
    const guardId = `!ACTIVE#${before.client_id}#${before.tax_year ?? "unknown"}`;
    const guardAction: TransactionItem = after.is_archived
      ? {
          Delete: {
            TableName: this.options.submissions.tableName,
            Key: { id: guardId },
            ConditionExpression:
              "attribute_not_exists(#id) OR #submission_id = :submission_id",
            ExpressionAttributeNames: {
              "#id": "id",
              "#submission_id": "submission_id",
            },
            ExpressionAttributeValues: { ":submission_id": id },
          },
        }
      : {
          Put: {
            TableName: this.options.submissions.tableName,
            Item: {
              id: guardId,
              record_type: "!ACTIVE_GUARD",
              submission_id: id,
              client_id: before.client_id,
              tax_year: before.tax_year,
            },
            ConditionExpression:
              "attribute_not_exists(#id) OR #submission_id = :submission_id",
            ExpressionAttributeNames: {
              "#id": "id",
              "#submission_id": "submission_id",
            },
            ExpressionAttributeValues: { ":submission_id": id },
          },
        };
    await this.options.journal.commit({
      actorId: actor.userId,
      requestId,
      operationId: this.operationIdGenerator(),
      businessActions: [
        conditionalUpdate(
          this.options.submissions.tableName,
          after,
          before._version,
        ),
        guardAction,
      ],
      changes: [
        {
          entityType: "Submission",
          entityKey: id,
          operationType: "update",
          before,
          after,
        },
      ],
    });
    return publicRecord(after);
  }
}
