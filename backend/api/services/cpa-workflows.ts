import { randomUUID } from "node:crypto";

import { PutCommand } from "@aws-sdk/lib-dynamodb";

import type { CpaActor } from "../auth/cpa-context";
import type { MutationChange } from "../contracts/change-journal";
import type {
  ChangeClientTaxYearInput,
  CpaSaveSubmissionInput,
  RestoreSubmissionInput,
  TransitionSubmissionStatusInput,
  UpdateClientDetailsInput,
} from "../contracts/cpa-workflows";
import { publicRecord, type ClientRecord, type SubmissionRecord } from "../contracts/entities";
import type { QuestionnaireTemplateGuard } from "../contracts/templates";
import { taxYearFor } from "../auth/public-client";
import { ApiError, internalError, notFound } from "../core/errors";
import type { ClientRepository } from "../repositories/client";
import type { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";
import type { SubmissionRepository } from "../repositories/submission";
import type { ChangeJournalService, TransactionItem } from "./change-journal";

export interface CpaWorkflowServiceOptions {
  readonly clients: ClientRepository;
  readonly submissions: SubmissionRepository;
  readonly templates: QuestionnaireTemplateRepository;
  readonly journal: ChangeJournalService;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly operationIdGenerator?: () => string;
}

interface AuditEntry {
  readonly cpa_email: string;
  readonly cpa_name: string;
  readonly step_id: string | null;
  readonly timestamp: string;
  readonly action: "fill" | "complete";
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

function activeGuardId(clientId: string, taxYear: number) {
  return `!ACTIVE#${clientId}#${taxYear}`;
}

function activeSubmissionGuard(
  clientId: string,
  taxYear: number,
  submissionId: string,
) {
  return {
    id: activeGuardId(clientId, taxYear),
    record_type: "!ACTIVE_GUARD",
    submission_id: submissionId,
    client_id: clientId,
    tax_year: taxYear,
  } as const;
}

function replaceSubmissionGuard(
  tableName: string,
  guard: ReturnType<typeof activeSubmissionGuard>,
  expectedSubmissionId: string,
): TransactionItem {
  return {
    Put: {
      TableName: tableName,
      Item: guard,
      ConditionExpression: "#submission_id = :expected_submission_id",
      ExpressionAttributeNames: { "#submission_id": "submission_id" },
      ExpressionAttributeValues: { ":expected_submission_id": expectedSubmissionId },
    },
  };
}

function requireSubmissionGuard(
  tableName: string,
  clientId: string,
  taxYear: number,
  submissionId: string,
): TransactionItem {
  return {
    ConditionCheck: {
      TableName: tableName,
      Key: { id: activeGuardId(clientId, taxYear) },
      ConditionExpression: "#submission_id = :submission_id",
      ExpressionAttributeNames: { "#submission_id": "submission_id" },
      ExpressionAttributeValues: { ":submission_id": submissionId },
    },
  };
}

function parseAuditLog(value: unknown): AuditEntry[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

function reloadConflict(code: string) {
  return new ApiError(409, code, code, { reload: true });
}

export class CpaWorkflowService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly operationIdGenerator: () => string;

  constructor(private readonly options: CpaWorkflowServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.operationIdGenerator = options.operationIdGenerator ?? randomUUID;
  }

  private async client(id: string) {
    const client = await this.options.clients.get(id);
    if (!client || client.is_archived) throw notFound("Client not found");
    return client;
  }

  private async activeTemplate() {
    let guard = await this.options.templates.getActiveGuard();
    if (!guard) {
      const records = await this.options.templates.history(100);
      const active = records.filter((record) => record.is_active);
      if (active.length !== 1) throw internalError();
      const record = active[0];
      const created: QuestionnaireTemplateGuard = {
        id: "!ACTIVE",
        record_type: "!ACTIVE_GUARD",
        active_template_id: record.id,
        active_version: record.version,
        _version: 1,
      };
      try {
        await this.options.templates.client.send(
          new PutCommand({
            TableName: this.options.templates.tableName,
            Item: created,
            ConditionExpression: "attribute_not_exists(#id)",
            ExpressionAttributeNames: { "#id": "id" },
          }),
        );
        guard = created;
      } catch {
        guard = await this.options.templates.getActiveGuard();
        if (!guard) throw internalError();
      }
    }
    const record = await this.options.templates.get(guard.active_template_id);
    if (!record || !record.is_active || record.version !== guard.active_version) {
      throw internalError();
    }
    return record;
  }

  private async activeSubmission(clientId: string, taxYear: number) {
    const result = await this.options.submissions.getActiveForClientYear(
      clientId,
      taxYear,
    );
    if (result.conflict) throw reloadConflict("SUBMISSION_ACTIVE_CONFLICT");
    return { record: result.record, guarded: Boolean(result.guard) };
  }

  private async commit(
    actor: CpaActor,
    requestId: string,
    businessActions: TransactionItem[],
    changes: MutationChange[],
    conflictCode: string,
  ) {
    try {
      await this.options.journal.commit({
        actorId: actor.userId,
        requestId,
        operationId: this.operationIdGenerator(),
        businessActions,
        changes,
      });
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 409) {
        throw reloadConflict(conflictCode);
      }
      throw error;
    }
  }

  async saveSubmission(
    input: CpaSaveSubmissionInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const client = await this.client(input.client_id);
    const taxYear = taxYearFor(client);
    const now = this.clock().toISOString();
    const currentActiveState = await this.activeSubmission(client.id, taxYear);
    const currentActive = currentActiveState.record;
    let before: SubmissionRecord | undefined;
    if (input.submission_id) {
      before = await this.options.submissions.get(input.submission_id);
      if (!before) throw notFound("Submission not found");
      if (before.client_id !== client.id || before.tax_year !== taxYear) {
        throw notFound("Submission not found");
      }
      if (before.is_archived || currentActive?.id !== before.id) {
        throw reloadConflict("SUBMISSION_ARCHIVED");
      }
      if (before._version !== input.revision) {
        throw reloadConflict("SUBMISSION_CONFLICT");
      }
    } else if (currentActive) {
      throw reloadConflict("SUBMISSION_CONFLICT");
    }

    const auditEntry: AuditEntry = {
      cpa_email: actor.email,
      cpa_name: actor.fullName,
      step_id: input.step_id ?? null,
      timestamp: now,
      action: input.completed ? "complete" : "fill",
    };
    const auditLog = [...parseAuditLog(before?.cpa_audit_log), auditEntry];
    const acceptedData = { ...input.data };
    delete acceptedData.template_id;
    delete acceptedData.template_version;
    const template = before?.completed_at
      ? {
          id: typeof before.template_id === "string" ? before.template_id : undefined,
          version:
            typeof before.template_version === "number"
              ? before.template_version
              : undefined,
        }
      : await this.activeTemplate();
    if (!template.id || template.version === undefined) throw internalError();
    const submission: SubmissionRecord = before
      ? {
          ...before,
          ...acceptedData,
          ...(input.completed && !acceptedData.completed_at ? { completed_at: now } : {}),
          template_id: template.id,
          template_version: template.version,
          cpa_audit_log: JSON.stringify(auditLog),
          updated_date: now,
          _version: before._version + 1,
        }
      : {
          ...acceptedData,
          ...(input.completed && !acceptedData.completed_at ? { completed_at: now } : {}),
          id: this.idGenerator(),
          client_id: client.id,
          tax_year: taxYear,
          template_id: template.id,
          template_version: template.version,
          cpa_audit_log: JSON.stringify(auditLog),
          is_archived: false,
          record_type: "Submission",
          _version: 1,
          created_date: now,
          updated_date: now,
          created_by: actor.userId,
        };
    const transitionedClient: ClientRecord = {
      ...client,
      status: input.completed ? "completed" : "in_progress",
      last_activity: now,
      updated_date: now,
      _version: client._version + 1,
    };
    const actions = [
      ...(before && currentActiveState.guarded
        ? [
            requireSubmissionGuard(
              this.options.submissions.tableName,
              client.id,
              taxYear,
              before.id,
            ),
          ]
        : before
          ? [
              conditionalCreate(
                this.options.submissions.tableName,
                activeSubmissionGuard(client.id, taxYear, before.id),
              ),
            ]
        : []),
      before
        ? conditionalUpdate(
            this.options.submissions.tableName,
            submission,
            before._version,
          )
        : conditionalCreate(this.options.submissions.tableName, submission),
      ...(!before
        ? [
            conditionalCreate(
              this.options.submissions.tableName,
              activeSubmissionGuard(client.id, taxYear, submission.id),
            ),
          ]
        : []),
      conditionalUpdate(
        this.options.clients.tableName,
        transitionedClient,
        client._version,
      ),
    ];
    const changes: MutationChange[] = [
      {
        entityType: "Submission",
        entityKey: submission.id,
        operationType: before ? "update" : "create",
        before: before ?? null,
        after: submission,
      },
      {
        entityType: "Client",
        entityKey: client.id,
        operationType: "update",
        before: client,
        after: transitionedClient,
      },
    ];
    await this.commit(actor, requestId, actions, changes, "SUBMISSION_CONFLICT");
    return { submission: publicRecord(submission), audit_entry: auditEntry };
  }

  async changeTaxYear(
    clientId: string,
    input: ChangeClientTaxYearInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const client = await this.client(clientId);
    const target = (await this.activeSubmission(client.id, input.tax_year)).record;
    const after: ClientRecord = {
      ...client,
      tax_year: input.tax_year,
      status: target?.cpa_status ?? "pending",
      updated_date: this.clock().toISOString(),
      _version: client._version + 1,
    };
    await this.commit(
      actor,
      requestId,
      [conditionalUpdate(this.options.clients.tableName, after, client._version)],
      [{
        entityType: "Client",
        entityKey: client.id,
        operationType: "update",
        before: client,
        after,
      }],
      "CLIENT_CONFLICT",
    );
    return publicRecord(after);
  }

  async restoreSubmission(
    submissionId: string,
    input: RestoreSubmissionInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const selected = await this.options.submissions.get(submissionId);
    if (!selected) throw notFound("Submission not found");
    if (!selected.is_archived || selected.tax_year === undefined) {
      throw reloadConflict("SUBMISSION_RESTORE_CONFLICT");
    }
    await this.client(selected.client_id);
    const currentState = await this.activeSubmission(
      selected.client_id,
      selected.tax_year,
    );
    const current = currentState.record;
    const now = this.clock().toISOString();
    const restored: SubmissionRecord = {
      ...selected,
      is_archived: false,
      updated_date: now,
      _version: selected._version + 1,
    };
    const actions: TransactionItem[] = [
      conditionalUpdate(
        this.options.submissions.tableName,
        restored,
        selected._version,
      ),
    ];
    const changes: MutationChange[] = [{
      entityType: "Submission",
      entityKey: selected.id,
      operationType: "update",
      before: selected,
      after: restored,
    }];
    const guard = activeSubmissionGuard(
      selected.client_id,
      selected.tax_year,
      selected.id,
    );
    if (!input.conflicting_submission_id) {
      if (current) throw reloadConflict("SUBMISSION_RESTORE_CONFLICT");
      actions.push(conditionalCreate(this.options.submissions.tableName, guard));
    } else {
      if (
        !current ||
        current.id !== input.conflicting_submission_id ||
        current.client_id !== selected.client_id ||
        current.tax_year !== selected.tax_year ||
        current.is_archived
      ) {
        throw reloadConflict("SUBMISSION_RESTORE_CONFLICT");
      }
      const archived: SubmissionRecord = {
        ...current,
        is_archived: true,
        updated_date: now,
        _version: current._version + 1,
      };
      actions.push(
        conditionalUpdate(
          this.options.submissions.tableName,
          archived,
          current._version,
        ),
        currentState.guarded
          ? replaceSubmissionGuard(
              this.options.submissions.tableName,
              guard,
              current.id,
            )
          : conditionalCreate(this.options.submissions.tableName, guard),
      );
      changes.push({
        entityType: "Submission",
        entityKey: current.id,
        operationType: "update",
        before: current,
        after: archived,
      });
    }
    await this.commit(
      actor,
      requestId,
      actions,
      changes,
      "SUBMISSION_RESTORE_CONFLICT",
    );
    return publicRecord(restored);
  }

  async updateClientDetails(
    clientId: string,
    input: UpdateClientDetailsInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const client = await this.client(clientId);
    if (client._version !== input.revision) {
      throw reloadConflict("CLIENT_CONFLICT");
    }
    let status = client.status;
    if (input.tax_year !== undefined && input.tax_year !== client.tax_year) {
      const target = (await this.activeSubmission(client.id, input.tax_year)).record;
      status = target?.cpa_status ?? "pending";
    }
    const after: ClientRecord = {
      ...client,
      ...input.profile,
      ...(input.tax_year === undefined ? {} : { tax_year: input.tax_year }),
      ...(status === undefined ? {} : { status }),
      updated_date: this.clock().toISOString(),
      _version: client._version + 1,
    };
    await this.commit(
      actor,
      requestId,
      [conditionalUpdate(this.options.clients.tableName, after, client._version)],
      [{
        entityType: "Client",
        entityKey: client.id,
        operationType: "update",
        before: client,
        after,
      }],
      "CLIENT_CONFLICT",
    );
    return publicRecord(after);
  }

  async resetOrphanStatus(
    clientId: string,
    actor: CpaActor,
    requestId: string,
  ) {
    const client = await this.client(clientId);
    const active = (await this.activeSubmission(client.id, taxYearFor(client))).record;
    if (active || client.status !== "completed") {
      throw reloadConflict("ORPHAN_STATUS_CONFLICT");
    }
    const after: ClientRecord = {
      ...client,
      status: "pending",
      updated_date: this.clock().toISOString(),
      _version: client._version + 1,
    };
    await this.commit(
      actor,
      requestId,
      [conditionalUpdate(this.options.clients.tableName, after, client._version)],
      [{
        entityType: "Client",
        entityKey: client.id,
        operationType: "update",
        before: client,
        after,
      }],
      "ORPHAN_STATUS_CONFLICT",
    );
    return publicRecord(after);
  }

  async transitionStatus(
    submissionId: string,
    input: TransitionSubmissionStatusInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const client = await this.client(input.client_id);
    const submission = await this.options.submissions.get(submissionId);
    if (
      !submission ||
      submission.is_archived ||
      submission.client_id !== client.id ||
      submission.tax_year !== taxYearFor(client)
    ) {
      throw notFound("Submission not found");
    }
    const currentState = await this.activeSubmission(client.id, taxYearFor(client));
    const current = currentState.record;
    if (current?.id !== submission.id) throw reloadConflict("SUBMISSION_CONFLICT");
    const now = this.clock().toISOString();
    const updatedClient: ClientRecord = {
      ...client,
      status: input.status,
      updated_date: now,
      _version: client._version + 1,
    };
    const updatedSubmission: SubmissionRecord = {
      ...submission,
      cpa_status: input.status,
      updated_date: now,
      _version: submission._version + 1,
    };
    await this.commit(
      actor,
      requestId,
      [
        currentState.guarded
          ? requireSubmissionGuard(
              this.options.submissions.tableName,
              client.id,
              taxYearFor(client),
              submission.id,
            )
          : conditionalCreate(
              this.options.submissions.tableName,
              activeSubmissionGuard(
                client.id,
                taxYearFor(client),
                submission.id,
              ),
            ),
        conditionalUpdate(
          this.options.clients.tableName,
          updatedClient,
          client._version,
        ),
        conditionalUpdate(
          this.options.submissions.tableName,
          updatedSubmission,
          submission._version,
        ),
      ],
      [
        {
          entityType: "Client",
          entityKey: client.id,
          operationType: "update",
          before: client,
          after: updatedClient,
        },
        {
          entityType: "Submission",
          entityKey: submission.id,
          operationType: "update",
          before: submission,
          after: updatedSubmission,
        },
      ],
      "WORKFLOW_STATUS_CONFLICT",
    );
    return {
      client: publicRecord(updatedClient),
      submission: publicRecord(updatedSubmission),
    };
  }
}
