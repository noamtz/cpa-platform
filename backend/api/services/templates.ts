import { randomUUID } from "node:crypto";

import { PutCommand } from "@aws-sdk/lib-dynamodb";

import type { CpaActor } from "../auth/cpa-context";
import type { MutationChange } from "../contracts/change-journal";
import { publicTemplate } from "../contracts/public-questionnaire";
import {
  cpaPdfTemplate,
  pdfTemplateFileReference,
  questionnaireTemplateHistory,
  type ArchivePdfTemplateInput,
  type CreatePdfTemplateInput,
  type PdfTemplateRecord,
  type QuestionnaireTemplateGuard,
  type QuestionnaireTemplateRecord,
  type SaveQuestionnaireTemplateInput,
  type UpdatePdfTemplateInput,
} from "../contracts/templates";
import { ApiError, badRequest, internalError, notFound } from "../core/errors";
import type { PdfTemplateRepository } from "../repositories/pdf-template";
import type { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";
import type { ChangeJournalService, TransactionItem } from "./change-journal";

export interface TemplateFileValidator {
  validateCpaTemplateReference(input: {
    readonly templateId: string;
    readonly fileReference: string;
  }, actor: CpaActor): Promise<void>;
}

export interface TemplateServiceOptions {
  readonly questionnaireTemplates: QuestionnaireTemplateRepository;
  readonly pdfTemplates: PdfTemplateRepository;
  readonly journal: ChangeJournalService;
  readonly files: TemplateFileValidator;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
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

function guardCreate(tableName: string, guard: QuestionnaireTemplateGuard): TransactionItem {
  return conditionalCreate(tableName, guard);
}

function guardUpdate(
  tableName: string,
  guard: QuestionnaireTemplateGuard,
  expectedVersion: number,
): TransactionItem {
  return conditionalUpdate(tableName, guard, expectedVersion);
}

function reloadConflict(code: string) {
  return new ApiError(409, code, code, { reload: true });
}

function projectQuestionnaire(record: QuestionnaireTemplateRecord) {
  try {
    return publicTemplate(record);
  } catch {
    throw internalError();
  }
}

export class TemplateService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly operationIdGenerator: () => string;

  constructor(private readonly options: TemplateServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.operationIdGenerator = options.operationIdGenerator ?? randomUUID;
  }

  private async guardedActive() {
    const guard = await this.options.questionnaireTemplates.getActiveGuard();
    if (guard) {
      const record = await this.options.questionnaireTemplates.get(guard.active_template_id);
      if (
        !record ||
        !record.is_active ||
        record.version !== guard.active_version
      ) {
        throw internalError();
      }
      return { guard, record };
    }

    const history = await this.options.questionnaireTemplates.history(100);
    const active = history.filter((record) => record.is_active);
    if (active.length > 1) throw internalError();
    if (active.length === 0) return undefined;
    const record = active[0];
    const initialGuard: QuestionnaireTemplateGuard = {
      id: "!ACTIVE",
      record_type: "!ACTIVE_GUARD",
      active_template_id: record.id,
      active_version: record.version,
      _version: 1,
    };
    try {
      await this.options.questionnaireTemplates.client.send(
        new PutCommand({
          TableName: this.options.questionnaireTemplates.tableName,
          Item: initialGuard,
          ConditionExpression: "attribute_not_exists(#id)",
          ExpressionAttributeNames: { "#id": "id" },
        }),
      );
      return { guard: initialGuard, record };
    } catch {
      const winner = await this.options.questionnaireTemplates.getActiveGuard();
      if (!winner) throw internalError();
      const winnerRecord = await this.options.questionnaireTemplates.get(
        winner.active_template_id,
      );
      if (!winnerRecord || !winnerRecord.is_active) throw internalError();
      return { guard: winner, record: winnerRecord };
    }
  }

  async getActiveQuestionnaire() {
    const active = await this.guardedActive();
    if (!active) throw notFound("Template not found");
    return { template: projectQuestionnaire(active.record) };
  }

  async listQuestionnaireHistory() {
    const records = await this.options.questionnaireTemplates.history(100);
    try {
      return { versions: records.map(questionnaireTemplateHistory) };
    } catch {
      throw internalError();
    }
  }

  async getQuestionnaire(id: string) {
    const record = await this.options.questionnaireTemplates.get(id);
    if (!record) throw notFound("Template not found");
    return { template: projectQuestionnaire(record) };
  }

  async saveQuestionnaire(
    input: SaveQuestionnaireTemplateInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const active = await this.guardedActive();
    const now = this.clock().toISOString();
    const nextVersion = active ? active.record.version + 1 : 1;
    const created: QuestionnaireTemplateRecord = {
      id: this.idGenerator(),
      version: nextVersion,
      is_active: true,
      steps: JSON.stringify(input.steps),
      record_type: "QuestionnaireTemplate",
      _version: 1,
      created_date: now,
      updated_date: now,
      created_by: actor.userId,
      created_by_email: actor.email,
    };
    const nextGuard: QuestionnaireTemplateGuard = {
      id: "!ACTIVE",
      record_type: "!ACTIVE_GUARD",
      active_template_id: created.id,
      active_version: created.version,
      _version: (active?.guard._version ?? 0) + 1,
    };
    const actions: TransactionItem[] = [];
    const changes: MutationChange[] = [];
    if (active) {
      const deactivated: QuestionnaireTemplateRecord = {
        ...active.record,
        is_active: false,
        _version: active.record._version + 1,
        updated_date: now,
      };
      actions.push(
        conditionalUpdate(
          this.options.questionnaireTemplates.tableName,
          deactivated,
          active.record._version,
        ),
      );
      changes.push({
        entityType: "QuestionnaireTemplate",
        entityKey: deactivated.id,
        operationType: "update",
        before: active.record,
        after: deactivated,
      });
    }
    actions.push(
      conditionalCreate(this.options.questionnaireTemplates.tableName, created),
      active
        ? guardUpdate(
            this.options.questionnaireTemplates.tableName,
            nextGuard,
            active.guard._version,
          )
        : guardCreate(this.options.questionnaireTemplates.tableName, nextGuard),
    );
    changes.push({
      entityType: "QuestionnaireTemplate",
      entityKey: created.id,
      operationType: "create",
      before: null,
      after: created,
    });
    try {
      await this.options.journal.commit({
        actorId: actor.userId,
        requestId,
        operationId: this.operationIdGenerator(),
        businessActions: actions,
        changes,
      });
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 409) {
        throw reloadConflict("QUESTIONNAIRE_TEMPLATE_CONFLICT");
      }
      throw error;
    }
    return { template: projectQuestionnaire(created) };
  }

  async listPdfTemplates() {
    const records = await this.options.pdfTemplates.list(true, 200);
    return records.map(cpaPdfTemplate);
  }

  async getPdfTemplate(id: string) {
    const record = await this.options.pdfTemplates.get(id);
    if (!record || record.is_active === false) throw notFound("Template not found");
    return cpaPdfTemplate(record);
  }

  async createPdfTemplate(
    input: CreatePdfTemplateInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const id = this.idGenerator();
    const reference = pdfTemplateFileReference(input.template_json);
    if (!reference) throw badRequest("PDF template requires a private base PDF");
    await this.options.files.validateCpaTemplateReference(
      { templateId: id, fileReference: reference },
      actor,
    );
    const now = this.clock().toISOString();
    const record: PdfTemplateRecord = {
      id,
      name: input.name,
      template_json: input.template_json,
      file_reference: reference,
      is_active: input.is_active,
      record_type: "PdfTemplate",
      _version: 1,
      created_date: now,
      updated_date: now,
      created_by: actor.userId,
    };
    await this.commitPdfMutation(null, record, actor, requestId);
    return cpaPdfTemplate(record);
  }

  async updatePdfTemplate(
    id: string,
    input: UpdatePdfTemplateInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const before = await this.options.pdfTemplates.get(id);
    if (!before || before.is_active === false) throw notFound("Template not found");
    if (before._version !== input.revision) {
      throw reloadConflict("PDF_TEMPLATE_CONFLICT");
    }
    const changes = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.template_json === undefined
        ? {}
        : { template_json: input.template_json }),
      ...(input.is_active === undefined ? {} : { is_active: input.is_active }),
    };
    const templateJson = input.template_json ?? before.template_json;
    if (!templateJson) throw internalError();
    const reference = pdfTemplateFileReference(templateJson);
    if (!reference) throw badRequest("PDF template requires a private base PDF");
    await this.options.files.validateCpaTemplateReference(
      { templateId: id, fileReference: reference },
      actor,
    );
    const after: PdfTemplateRecord = {
      ...before,
      ...changes,
      template_json: templateJson,
      file_reference: reference,
      _version: before._version + 1,
      updated_date: this.clock().toISOString(),
    };
    await this.commitPdfMutation(before, after, actor, requestId);
    return cpaPdfTemplate(after);
  }

  async archivePdfTemplate(
    id: string,
    input: ArchivePdfTemplateInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const before = await this.options.pdfTemplates.get(id);
    if (!before || before.is_active === false) throw notFound("Template not found");
    if (before._version !== input.revision) {
      throw reloadConflict("PDF_TEMPLATE_CONFLICT");
    }
    const after: PdfTemplateRecord = {
      ...before,
      is_active: false,
      _version: before._version + 1,
      updated_date: this.clock().toISOString(),
    };
    await this.commitPdfMutation(before, after, actor, requestId);
    return { id, deleted: true };
  }

  private async commitPdfMutation(
    before: PdfTemplateRecord | null,
    after: PdfTemplateRecord,
    actor: CpaActor,
    requestId: string,
  ) {
    try {
      await this.options.journal.commit({
        actorId: actor.userId,
        requestId,
        operationId: this.operationIdGenerator(),
        businessActions: [
          before
            ? conditionalUpdate(
                this.options.pdfTemplates.tableName,
                after,
                before._version,
              )
            : conditionalCreate(this.options.pdfTemplates.tableName, after),
        ],
        changes: [
          {
            entityType: "PdfTemplate",
            entityKey: after.id,
            operationType: before ? "update" : "create",
            before,
            after,
          },
        ],
      });
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 409) {
        throw reloadConflict("PDF_TEMPLATE_CONFLICT");
      }
      throw error;
    }
  }
}
