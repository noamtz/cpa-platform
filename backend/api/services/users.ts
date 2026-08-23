import { randomUUID } from "node:crypto";

import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import type { z } from "zod";

import type { CpaActor } from "../auth/cpa-context";
import {
  inviteUserSchema,
  publicRecord,
  updateMeSchema,
  type EntitySort,
} from "../contracts/entities";
import { conflict, internalError, notFound } from "../core/errors";
import type { UserRepository } from "../repositories/user";
import type { ChangeJournalService, TransactionItem } from "./change-journal";

type UpdateMe = z.infer<typeof updateMeSchema>;
type InviteUser = z.infer<typeof inviteUserSchema>;

export interface CognitoAdminClient {
  send(command: unknown): Promise<unknown>;
}

interface CognitoUserResult {
  readonly User?: {
    readonly Attributes?: readonly { readonly Name?: string; readonly Value?: string }[];
  };
  readonly UserAttributes?: readonly { readonly Name?: string; readonly Value?: string }[];
}

export interface UserServiceOptions {
  readonly users: UserRepository;
  readonly journal: ChangeJournalService;
  readonly cognito: CognitoAdminClient;
  readonly userPoolId: string;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly operationIdGenerator?: () => string;
  readonly logger?: { error(message: string, metadata: Record<string, unknown>): void };
}

function subjectFrom(result: CognitoUserResult) {
  const attributes = result.User?.Attributes ?? result.UserAttributes ?? [];
  return attributes.find(({ Name }) => Name === "sub")?.Value;
}

function userPut(tableName: string, item: Record<string, unknown>): TransactionItem {
  return {
    Put: {
      TableName: tableName,
      Item: item,
      ConditionExpression: "attribute_not_exists(#id)",
      ExpressionAttributeNames: { "#id": "id" },
    },
  };
}

export class UserService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly operationIdGenerator: () => string;
  private readonly logger: UserServiceOptions["logger"];

  constructor(private readonly options: UserServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.operationIdGenerator = options.operationIdGenerator ?? randomUUID;
    this.logger = options.logger ?? console;
  }

  async me(actor: CpaActor) {
    const user = await this.options.users.get(actor.userId);
    if (!user || user.cognito_sub !== actor.cognitoSubject) throw notFound();
    return publicRecord(user);
  }

  async list(sort: EntitySort, limit: number) {
    return (await this.options.users.list(sort, limit)).map(publicRecord);
  }

  async updateMe(
    actor: CpaActor,
    requestId: string,
    patch: UpdateMe,
  ) {
    const before = await this.options.users.get(actor.userId);
    if (!before || before.cognito_sub !== actor.cognitoSubject) throw notFound();
    const after = {
      ...before,
      ...patch,
      updated_date: this.clock().toISOString(),
      _version: before._version + 1,
    };
    await this.options.journal.commit({
      actor,
      requestId,
      operationId: this.operationIdGenerator(),
      businessActions: [
        {
          Put: {
            TableName: this.options.users.tableName,
            Item: after,
            ConditionExpression: "#version = :expected_version",
            ExpressionAttributeNames: { "#version": "_version" },
            ExpressionAttributeValues: { ":expected_version": before._version },
          },
        },
      ],
      changes: [
        {
          entityType: "User",
          entityKey: before.id,
          operationType: "update",
          before,
          after,
        },
      ],
    });
    return publicRecord(after);
  }

  async invite(actor: CpaActor, requestId: string, input: InviteUser) {
    const existing = await this.options.users.findByEmail(input.email);
    if (existing) {
      if (existing.role === input.role) return publicRecord(existing);
      throw conflict();
    }

    let subject: string | undefined;
    let cognitoCreated = false;
    try {
      const result = (await this.options.cognito.send(
        new AdminCreateUserCommand({
          UserPoolId: this.options.userPoolId,
          Username: input.email,
          DesiredDeliveryMediums: ["EMAIL"],
          UserAttributes: [{ Name: "email", Value: input.email }],
        }),
      )) as CognitoUserResult;
      subject = subjectFrom(result);
      cognitoCreated = true;
    } catch (caught) {
      const error = caught as Error;
      if (error.name !== "UsernameExistsException") throw internalError();
      const result = (await this.options.cognito.send(
        new AdminGetUserCommand({
          UserPoolId: this.options.userPoolId,
          Username: input.email,
        }),
      )) as CognitoUserResult;
      subject = subjectFrom(result);
      const retryExisting = await this.options.users.findByEmail(input.email);
      if (
        retryExisting &&
        subject &&
        retryExisting.cognito_sub === subject &&
        retryExisting.role === input.role
      ) {
        return publicRecord(retryExisting);
      }
      throw conflict();
    }
    if (!subject) throw internalError();

    const now = this.clock().toISOString();
    const record = {
      id: this.idGenerator(),
      full_name: input.email,
      email: input.email,
      role: input.role,
      cognito_sub: subject,
      record_type: "User" as const,
      _version: 1,
      created_date: now,
      updated_date: now,
      created_by: actor.userId,
    };
    try {
      await this.options.journal.commit({
        actor,
        requestId,
        operationId: this.operationIdGenerator(),
        businessActions: [userPut(this.options.users.tableName, record)],
        changes: [
          {
            entityType: "User",
            entityKey: record.id,
            operationType: "create",
            before: null,
            after: record,
          },
        ],
      });
      return publicRecord(record);
    } catch {
      if (cognitoCreated) {
        try {
          await this.options.cognito.send(
            new AdminDeleteUserCommand({
              UserPoolId: this.options.userPoolId,
              Username: input.email,
            }),
          );
        } catch {
          this.logger?.error("Cognito invitation compensation failed", {
            operation: "invite-user-compensation",
            requestId,
          });
        }
      }
      throw internalError();
    }
  }
}
