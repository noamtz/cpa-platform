import { randomUUID } from "node:crypto";

import type {
  ClientRecord,
  SubmissionRecord,
} from "../contracts/entities";
import type { MutationChange } from "../contracts/change-journal";
import {
  PUBLIC_QUESTIONNAIRE_ERROR_CODES,
  publicClient,
  publicSubmission,
  publicTemplate,
  type GetActiveTemplateInput,
  type GetClientByTokenInput,
  type GetTemplateByIdInput,
  type PublicQuestionnaireData,
  type QuestionnaireTemplateRecord,
  type UpdateClientSubmissionInput,
} from "../contracts/public-questionnaire";
import { PublicClientAuthorizer, taxYearFor } from "../auth/public-client";
import { ApiError, internalError, notFound } from "../core/errors";
import type { ClientRepository } from "../repositories/client";
import type { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";
import type { SubmissionRepository } from "../repositories/submission";
import type { ChangeJournalService, TransactionItem } from "./change-journal";

const DEFAULT_TEMPLATE_ID = "questionnaire-template-default-v1";

const DEFAULT_TEMPLATE_STEPS = [
  {
    id: "employee",
    title: "שכיר",
    emoji: "💼",
    question: "האם היית שכיר בשנת {TAX_YEAR}?",
    yes_label: "כן, הייתי שכיר",
    no_label: "לא, לא הייתי שכיר",
    response_type: "upload",
    is_active: true,
    order: 1,
    upload_config: {
      title: "העלאת טופס 106",
      description: "אנא העלה את טופס 106 שקיבלת מהמעסיק/ים שלך.\nניתן להעלות מספר קבצים.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "pension",
    title: "פנסיה עצמאית",
    emoji: "🏦",
    question: "האם הפקדת לפנסיה/קרן השתלמות כעצמאי בשנת {TAX_YEAR}?",
    yes_label: "כן, הפקדתי",
    no_label: "לא, לא הפקדתי",
    response_type: "upload",
    is_active: true,
    order: 2,
    upload_config: {
      title: "אישורי מס פנסיה",
      description: "אנא העלה את אישורי המס מקרן הפנסיה/קרן ההשתלמות.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "stock",
    title: "שוק ההון",
    emoji: "📈",
    question: "האם השקעת בשוק ההון בשנת {TAX_YEAR}?",
    yes_label: "כן, השקעתי",
    no_label: "לא, לא השקעתי",
    response_type: "upload",
    is_active: true,
    order: 3,
    upload_config: {
      title: "העלאת טופס 867",
      description: "אנא העלה את טופס 867 מהבנק/ברוקר שלך.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "insurance",
    title: "ביטוח חיים",
    emoji: "🛡️",
    question: "האם יש לך ביטוח חיים?",
    yes_label: "כן, יש לי ביטוח חיים",
    no_label: "לא, אין לי ביטוח חיים",
    response_type: "upload",
    is_active: true,
    order: 4,
    upload_config: {
      title: "אישורי ביטוח חיים",
      description: "אנא העלה את אישורי תשלום פרמיות ביטוח החיים.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "donations",
    title: "תרומות",
    emoji: "❤️",
    question: "האם תרמת לעמותות עם סעיף 46 בשנת {TAX_YEAR}?",
    yes_label: "כן, תרמתי",
    no_label: "לא, לא תרמתי",
    response_type: "upload",
    is_active: true,
    order: 5,
    upload_config: {
      title: "קבלות תרומה",
      description: "אנא העלה קבלות תרומה לעמותות מוכרות.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "additional_income",
    title: "הכנסות נוספות",
    emoji: "💰",
    question: "האם היו לך הכנסות נוספות בשנת {TAX_YEAR}?",
    yes_label: "כן, היו לי הכנסות נוספות",
    no_label: "לא, לא היו לי הכנסות נוספות",
    response_type: "text",
    is_active: true,
    order: 6,
    text_config: {
      title: "פרטי הכנסות נוספות",
      description: "אנא פרט את ההכנסות הנוספות שהיו לך (שכירות, פרילנס, ייעוץ וכו׳)",
      placeholder: "לדוגמה: הכנסות שכירות מדירה, עבודה כפרילנסר בתחום...",
      rows: 4,
    },
  },
] as const;

export interface PublicQuestionnaireServiceOptions {
  readonly clients: ClientRepository;
  readonly submissions: SubmissionRepository;
  readonly templates: QuestionnaireTemplateRepository;
  readonly journal: ChangeJournalService;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly operationIdGenerator?: () => string;
  readonly authorizer?: PublicClientAuthorizer;
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

function activeGuardCreate(
  tableName: string,
  submissionId: string,
  clientId: string,
  taxYear: number,
): TransactionItem {
  return {
    Put: {
      TableName: tableName,
      Item: {
        id: `!ACTIVE#${clientId}#${taxYear}`,
        record_type: "!ACTIVE_GUARD",
        submission_id: submissionId,
        client_id: clientId,
        tax_year: taxYear,
      },
      ConditionExpression: "attribute_not_exists(#id)",
      ExpressionAttributeNames: { "#id": "id" },
    },
  };
}

function reloadConflict(code: string) {
  return new ApiError(409, code, code, { reload: true });
}

function projectTemplate(record: QuestionnaireTemplateRecord) {
  try {
    return publicTemplate(record);
  } catch {
    throw internalError();
  }
}

export class PublicQuestionnaireService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly operationIdGenerator: () => string;
  private readonly authorizer: PublicClientAuthorizer;

  constructor(private readonly options: PublicQuestionnaireServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.operationIdGenerator = options.operationIdGenerator ?? randomUUID;
    this.authorizer = options.authorizer ?? new PublicClientAuthorizer(options);
  }

  async getClientByToken(input: GetClientByTokenInput) {
    const client = await this.authorizer.authorize(input);
    const submission = await this.authorizer.activeSubmission(client);
    return {
      client: publicClient(client),
      submission: submission ? publicSubmission(submission) : null,
    };
  }

  private async ensureActiveTemplate(
    client: ClientRecord,
    requestId: string,
  ): Promise<QuestionnaireTemplateRecord> {
    const existing = await this.options.templates.latestActive();
    if (existing) return existing;

    const now = this.clock().toISOString();
    const actorId = `public-client:${client.id}`;
    const seeded: QuestionnaireTemplateRecord = {
      id: DEFAULT_TEMPLATE_ID,
      version: 1,
      is_active: true,
      steps: JSON.stringify(DEFAULT_TEMPLATE_STEPS),
      record_type: "QuestionnaireTemplate",
      _version: 1,
      created_date: now,
      updated_date: now,
      created_by: actorId,
    };
    try {
      await this.options.journal.commit({
        actorId,
        requestId,
        operationId: this.operationIdGenerator(),
        businessActions: [
          conditionalCreate(this.options.templates.tableName, seeded),
        ],
        changes: [
          {
            entityType: "QuestionnaireTemplate",
            entityKey: seeded.id,
            operationType: "create",
            before: null,
            after: seeded,
          },
        ],
      });
      return seeded;
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 409) throw error;
      const winner = await this.options.templates.latestActive();
      if (!winner) throw internalError();
      return winner;
    }
  }

  async getActiveTemplate(input: GetActiveTemplateInput, requestId: string) {
    const client = await this.authorizer.authorize(input);
    const template = await this.ensureActiveTemplate(client, requestId);
    return { template: projectTemplate(template) };
  }

  async getTemplateById(input: GetTemplateByIdInput) {
    const client = await this.authorizer.authorize(input);
    const submission = await this.authorizer.activeSubmission(client);
    if (
      !submission?.completed_at ||
      submission.template_id !== input.template_id
    ) {
      throw notFound("Template not found");
    }
    const template = await this.options.templates.get(input.template_id);
    if (!template) throw notFound("Template not found");
    return { template: projectTemplate(template) };
  }

  private clientTransition(
    client: ClientRecord,
    completed: boolean,
    now: string,
  ) {
    const status = completed ? "completed" : "in_progress";
    if (client.status === status && !completed) return undefined;
    return {
      ...client,
      status,
      last_activity: now,
      updated_date: now,
      _version: client._version + 1,
    } satisfies ClientRecord;
  }

  private async commitMutation(
    client: ClientRecord,
    requestId: string,
    businessActions: TransactionItem[],
    changes: Parameters<ChangeJournalService["commit"]>[0]["changes"],
    conflictCode: string,
  ) {
    try {
      await this.options.journal.commit({
        actorId: `public-client:${client.id}`,
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

  private async createSubmission(
    client: ClientRecord,
    input: UpdateClientSubmissionInput,
    requestId: string,
  ) {
    const now = this.clock().toISOString();
    const taxYear = taxYearFor(client);
    const template = await this.ensureActiveTemplate(client, requestId);
    const actorId = `public-client:${client.id}`;
    const record: SubmissionRecord = {
      ...input.data,
      id: this.idGenerator(),
      client_id: client.id,
      tax_year: taxYear,
      template_id: template.id,
      template_version: template.version,
      is_archived: false,
      record_type: "Submission",
      _version: 1,
      created_date: now,
      updated_date: now,
      created_by: actorId,
    };
    const transitionedClient = this.clientTransition(client, input.completed, now);
    const businessActions = [
      conditionalCreate(this.options.submissions.tableName, record),
      activeGuardCreate(
        this.options.submissions.tableName,
        record.id,
        client.id,
        taxYear,
      ),
    ];
    const changes: MutationChange[] = [
      {
        entityType: "Submission",
        entityKey: record.id,
        operationType: "create",
        before: null,
        after: record,
      },
    ];
    if (transitionedClient) {
      businessActions.push(
        conditionalUpdate(
          this.options.clients.tableName,
          transitionedClient,
          client._version,
        ),
      );
      changes.push({
        entityType: "Client",
        entityKey: client.id,
        operationType: "update",
        before: client,
        after: transitionedClient,
      });
    }
    await this.commitMutation(
      client,
      requestId,
      businessActions,
      changes,
      PUBLIC_QUESTIONNAIRE_ERROR_CODES.submissionConflict,
    );
    return record;
  }

  private async updateExistingSubmission(
    client: ClientRecord,
    input: UpdateClientSubmissionInput & { submission_id: string; _version: number },
    requestId: string,
  ) {
    const before = await this.options.submissions.get(input.submission_id);
    const active = await this.authorizer.activeSubmission(client);
    if (
      !before ||
      !active ||
      active.id !== before.id ||
      before.is_archived ||
      before.client_id !== client.id ||
      before.tax_year !== taxYearFor(client)
    ) {
      throw reloadConflict(PUBLIC_QUESTIONNAIRE_ERROR_CODES.submissionArchived);
    }
    if (before._version !== input._version) {
      throw reloadConflict(PUBLIC_QUESTIONNAIRE_ERROR_CODES.submissionConflict);
    }

    const now = this.clock().toISOString();
    let acceptedData: PublicQuestionnaireData = input.data;
    if (
      input.data.template_id !== undefined ||
      input.data.template_version !== undefined
    ) {
      const storedTemplateId =
        typeof before.template_id === "string" ? before.template_id : undefined;
      const storedTemplateVersion =
        typeof before.template_version === "number"
          ? before.template_version
          : undefined;
      const authorizedTemplate = before.completed_at
        ? {
            id: storedTemplateId,
            version: storedTemplateVersion,
          }
        : await this.ensureActiveTemplate(client, requestId);
      if (!authorizedTemplate.id || authorizedTemplate.version === undefined) {
        throw internalError();
      }
      acceptedData = {
        ...input.data,
        template_id: authorizedTemplate.id,
        template_version: authorizedTemplate.version,
      };
    }
    const after: SubmissionRecord = {
      ...before,
      ...acceptedData,
      updated_date: now,
      _version: before._version + 1,
    };
    const transitionedClient = this.clientTransition(client, input.completed, now);
    const businessActions = [
      conditionalUpdate(this.options.submissions.tableName, after, before._version),
    ];
    const changes: MutationChange[] = [
      {
        entityType: "Submission",
        entityKey: before.id,
        operationType: "update",
        before,
        after,
      },
    ];
    if (transitionedClient) {
      businessActions.push(
        conditionalUpdate(
          this.options.clients.tableName,
          transitionedClient,
          client._version,
        ),
      );
      changes.push({
        entityType: "Client",
        entityKey: client.id,
        operationType: "update",
        before: client,
        after: transitionedClient,
      });
    }
    await this.commitMutation(
      client,
      requestId,
      businessActions,
      changes,
      PUBLIC_QUESTIONNAIRE_ERROR_CODES.submissionConflict,
    );
    return after;
  }

  async updateClientSubmission(
    input: UpdateClientSubmissionInput,
    requestId: string,
  ) {
    const client = await this.authorizer.authorize(input);
    const submission = input.submission_id
      ? await this.updateExistingSubmission(
          client,
          input as UpdateClientSubmissionInput & {
            submission_id: string;
            _version: number;
          },
          requestId,
        )
      : await this.createSubmission(client, input, requestId);
    return { submission: publicSubmission(submission) };
  }
}

export { tokenMatches } from "../auth/public-client";
