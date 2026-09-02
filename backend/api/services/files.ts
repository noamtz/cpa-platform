import { createHash, randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";

import type { CpaActor } from "../auth/cpa-context";
import type {
  PublicClientAuthorizer,
  PublicClientCredentials,
} from "../auth/public-client";
import type { SubmissionRecord } from "../contracts/entities";
import {
  CURRENT_FIRM_KEY,
  READ_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
  ZIP_REQUEST_PREFIX,
  ZIP_RESULT_TTL_SECONDS,
  ZIP_LOCK_PREFIX,
  allowedContentTypeSchema,
  extensionForContentType,
  ownerKeyPart,
  parsePrivateFileReference,
  privateFileReference,
  resolveStoredFileReference,
  safeStoredExtension,
  sanitizeZipName,
  stableReferenceHash,
  zipManifestSchema,
  isZipResultKeyForJob,
  zipProcessingLeaseSchema,
  type CpaSubmissionFileUrlInput,
  type CpaTemplateFileMirrorInput,
  type CpaUploadCompleteInput,
  type CpaUploadInitiateInput,
  type PublicSignedPdfUrlInput,
  type PublicPdfTemplateReadInput,
  type PublicTemplateFileUrlInput,
  type PublicUploadCompleteInput,
  type PublicUploadInitiateInput,
} from "../contracts/files";
import { ApiError, badRequest, internalError, notFound } from "../core/errors";
import type { ClientRepository } from "../repositories/client";
import type { PdfTemplateRecord, PdfTemplateRepository } from "../repositories/pdf-template";
import type { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";
import type { SubmissionRepository } from "../repositories/submission";
import type { ChangeJournalService, TransactionItem } from "./change-journal";

export interface S3CommandClient {
  send(command: unknown): Promise<unknown>;
}

export interface FileServiceOptions {
  readonly s3: S3CommandClient;
  readonly presign: (
    command: PutObjectCommand | GetObjectCommand,
    expiresIn: number,
    unhoistableHeaders?: Set<string>,
  ) => Promise<string>;
  readonly filesBucketName: string;
  readonly temporaryOutputsBucketName: string;
  readonly legacyFileReadsEnabled: boolean;
  readonly clients: ClientRepository;
  readonly submissions: SubmissionRepository;
  readonly questionnaireTemplates: QuestionnaireTemplateRepository;
  readonly pdfTemplates: PdfTemplateRepository;
  readonly publicAuthorizer: PublicClientAuthorizer;
  readonly journal: ChangeJournalService;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
}

type UploadOwner = {
  readonly type: "Submission" | "PdfTemplate";
  readonly id: string;
  readonly prefix: string;
  readonly actorId: string;
};

type HeadResult = {
  readonly ContentLength?: number;
  readonly ContentType?: string;
  readonly Metadata?: Record<string, string>;
  readonly VersionId?: string;
};

type DeleteResult = { readonly VersionId?: string; readonly DeleteMarker?: boolean };
type GetResult = {
  readonly Body?: {
    transformToString?(): Promise<string>;
  };
};

function purposeSlug(purpose: string) {
  return purpose.replaceAll("_", "-");
}

function failureName(error: unknown) {
  return error instanceof Error && error.name ? error.name.slice(0, 128) : "UnknownError";
}

function submissionPrefix(clientId: string, submissionId: string, purpose: string) {
  const base = `firms/${CURRENT_FIRM_KEY}/clients/${ownerKeyPart(clientId)}/submissions/${ownerKeyPart(submissionId)}/`;
  return purpose ? `${base}${purposeSlug(purpose)}/` : base;
}

function templatePrefix(templateId: string) {
  return `firms/${CURRENT_FIRM_KEY}/templates/${ownerKeyPart(templateId)}/pdf-template/`;
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: unknown): Record<string, unknown>[] {
  const parsed = (() => {
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
      const candidate: unknown = JSON.parse(value);
      return Array.isArray(candidate) ? candidate : [];
    } catch {
      return [];
    }
  })();
  return parsed.filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
  );
}

const legacyStepFiles: Record<string, string> = {
  employee: "form_106_files",
  pension: "pension_files",
  stock: "form_867_files",
  stocks: "form_867_files",
  insurance: "insurance_files",
  donations: "donation_files",
};

function responseFiles(submission: SubmissionRecord, stepId: string): unknown[] {
  const response = parseJsonRecord(submission.responses)[stepId];
  if (
    response &&
    typeof response === "object" &&
    Array.isArray((response as Record<string, unknown>).files)
  ) {
    return (response as Record<string, unknown>).files as unknown[];
  }
  const legacyField = legacyStepFiles[stepId];
  return legacyField && Array.isArray(submission[legacyField])
    ? (submission[legacyField] as unknown[])
    : [];
}

function signedPdfReference(submission: SubmissionRecord, stepId: string) {
  return parseJsonArray(submission.signed_pdfs).find(
    (record) => record.step_id === stepId,
  )?.pdf_file_url;
}

function templateBaseReference(template: PdfTemplateRecord) {
  if (template.file_reference) return template.file_reference;
  const basePdf = parseJsonRecord(template.template_json).basePdf;
  if (typeof basePdf === "string") return basePdf;
  if (basePdf && typeof basePdf === "object") {
    const pointer = basePdf as Record<string, unknown>;
    if (pointer.__type === "file_uri" && typeof pointer.value === "string") {
      return pointer.value;
    }
  }
  return undefined;
}

function publicPdfTemplate(template: PdfTemplateRecord) {
  if (!template.template_json) throw notFound("Template not found");
  return {
    id: template.id,
    ...(template.name ? { name: template.name } : {}),
    template_json: template.template_json,
  };
}

function questionnaireAllowsPdfTemplate(stepsJson: string, templateId: string) {
  let root: unknown;
  try {
    root = JSON.parse(stepsJson);
  } catch {
    throw internalError();
  }
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return record.pdf_template_id === templateId || Object.values(record).some(visit);
  };
  return visit(root);
}

function templateMirrorConflict() {
  return new ApiError(
    409,
    "PDF_TEMPLATE_CONFLICT",
    "PDF_TEMPLATE_CONFLICT",
    { reload: true },
  );
}

function matchesTemplateMirror(
  record: PdfTemplateRecord,
  input: CpaTemplateFileMirrorInput,
) {
  return (
    record.file_reference === input.file_reference &&
    record.name === input.name &&
    record.is_active === input.is_active
  );
}

async function objectBodyText(result: GetResult) {
  if (!result.Body?.transformToString) throw internalError();
  return result.Body.transformToString();
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function stepIdentity(step: Record<string, unknown>) {
  const config =
    step.config && typeof step.config === "object"
      ? (step.config as Record<string, unknown>)
      : step;
  return {
    id: typeof step.id === "string" ? step.id : "",
    title:
      typeof config.title === "string"
        ? config.title
        : typeof step.title === "string"
          ? step.title
          : "file",
    uploadTitle:
      config.upload_config && typeof config.upload_config === "object"
        ? (config.upload_config as Record<string, unknown>).title
        : undefined,
  };
}

export function deriveSubmissionFileEntries(
  submission: SubmissionRecord,
  questionnaireSteps: readonly Record<string, unknown>[],
) {
  const responses = parseJsonRecord(submission.responses);
  const groups: Array<{
    stepId: string;
    label: string;
    files: unknown[];
    names: unknown[];
  }> = [];
  const includedSteps = new Set<string>();

  for (const step of questionnaireSteps) {
    const identity = stepIdentity(step);
    if (!identity.id) continue;
    const response = responses[identity.id];
    if (!response || typeof response !== "object") continue;
    const record = response as Record<string, unknown>;
    if (record.answer && Array.isArray(record.files) && record.files.length > 0) {
      groups.push({
        stepId: identity.id,
        label:
          typeof identity.uploadTitle === "string"
            ? identity.uploadTitle
            : identity.title,
        files: record.files,
        names: Array.isArray(record.file_names) ? record.file_names : [],
      });
      includedSteps.add(identity.id);
    }
  }
  for (const [stepId, value] of Object.entries(responses)) {
    if (includedSteps.has(stepId) || !value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    if (record.answer && Array.isArray(record.files) && record.files.length > 0) {
      groups.push({
        stepId,
        label: typeof record.title === "string" ? record.title : stepId,
        files: record.files,
        names: Array.isArray(record.file_names) ? record.file_names : [],
      });
      includedSteps.add(stepId);
    }
  }
  for (const [stepId, field] of Object.entries(legacyStepFiles)) {
    if (includedSteps.has(stepId) || !Array.isArray(submission[field])) continue;
    const files = submission[field] as unknown[];
    if (files.length > 0) {
      groups.push({ stepId, label: stepId, files, names: [] });
      includedSteps.add(stepId);
    }
  }

  const usedReferences = new Set<string>();
  const usedNames = new Map<string, number>();
  const entries: Array<{ key: string; name: string }> = [];
  const add = (reference: unknown, label: string, index: number, storedName?: unknown) => {
    if (typeof reference !== "string" || usedReferences.has(reference)) return;
    const { key } = resolveStoredFileReference(reference);
    const extension = safeStoredExtension(storedName ?? reference);
    const stem = sanitizeZipName(`${label}_${index + 1}`, "file");
    const baseName = `${stem}.${extension}`;
    const collision = (usedNames.get(baseName) ?? 0) + 1;
    usedNames.set(baseName, collision);
    const name =
      collision === 1
        ? baseName
        : `${stem}_${collision}.${extension}`;
    entries.push({ key, name });
    usedReferences.add(reference);
  };
  for (const group of groups) {
    group.files.forEach((reference, index) =>
      add(reference, group.label, index, group.names[index]),
    );
  }
  for (const record of parseJsonArray(submission.signed_pdfs)) {
    const label =
      typeof record.step_title === "string"
        ? record.step_title
        : typeof record.template_name === "string"
          ? record.template_name
          : "signed-form";
    add(record.pdf_file_url, label, 0, `${label}.pdf`);
  }
  return entries;
}

export class FileService {
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;

  constructor(private readonly options: FileServiceOptions) {
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
  }

  private assertReadableReferenceKind(kind: "owned" | "legacy") {
    if (kind === "legacy" && !this.options.legacyFileReadsEnabled) {
      throw notFound("File not found");
    }
  }

  private async publicSubmissionOwner(
    input: PublicClientCredentials & { readonly submission_id: string },
    purpose?: "questionnaire_document" | "signed_pdf",
  ): Promise<UploadOwner> {
    const client = await this.options.publicAuthorizer.authorize(input);
    const submission = await this.options.publicAuthorizer.activeSubmission(client);
    if (!submission || submission.id !== input.submission_id) {
      throw notFound("Submission not found");
    }
    return {
      type: "Submission",
      id: submission.id,
      prefix: submissionPrefix(client.id, submission.id, purpose ?? ""),
      actorId: `public-client:${client.id}`,
    };
  }

  private async cpaOwner(
    ownerType: "submission" | "pdf_template",
    ownerId: string,
    actor: CpaActor,
    purpose?: string,
  ): Promise<UploadOwner> {
    if (ownerType === "submission") {
      const submission = await this.options.submissions.get(ownerId);
      if (!submission || submission.is_archived) throw notFound("Submission not found");
      const client = await this.options.clients.get(submission.client_id);
      if (!client || client.is_archived) throw notFound("Submission not found");
      return {
        type: "Submission",
        id: submission.id,
        prefix: submissionPrefix(client.id, submission.id, purpose ?? ""),
        actorId: actor.userId,
      };
    }
    if (ownerId !== "pending" && !(await this.options.pdfTemplates.get(ownerId))) {
      throw notFound("Template not found");
    }
    return {
      type: "PdfTemplate",
      id: ownerId,
      prefix: templatePrefix(ownerId),
      actorId: actor.userId,
    };
  }

  private async initiate(
    owner: UploadOwner,
    purpose: "questionnaire_document" | "signed_pdf" | "pdf_template",
    size: number,
    contentType: "application/pdf" | "image/jpeg" | "image/png" | "image/heic" | "image/heif",
  ) {
    const key = `${owner.prefix}${this.idGenerator()}.${extensionForContentType(contentType)}`;
    const fileUri = privateFileReference(key);
    const metadata = {
      "owner-hash": ownerKeyPart(owner.id),
      purpose,
      "declared-size": String(size),
    };
    const metadataHeaders = new Set(
      Object.keys(metadata).map((name) => `x-amz-meta-${name}`),
    );
    const command = new PutObjectCommand({
      Bucket: this.options.filesBucketName,
      Key: key,
      ContentType: contentType,
      IfNoneMatch: "*",
      Metadata: metadata,
    });
    const uploadUrl = await this.options.presign(
      command,
      UPLOAD_URL_TTL_SECONDS,
      metadataHeaders,
    );
    return {
      upload_id: fileUri,
      upload_url: uploadUrl,
      headers: {
        "content-type": contentType,
        "if-none-match": "*",
        "x-amz-meta-owner-hash": metadata["owner-hash"],
        "x-amz-meta-purpose": purpose,
        "x-amz-meta-declared-size": String(size),
      },
      expires_at: new Date(
        this.clock().getTime() + UPLOAD_URL_TTL_SECONDS * 1_000,
      ).toISOString(),
    };
  }

  async initiatePublicUpload(input: PublicUploadInitiateInput) {
    const owner = await this.publicSubmissionOwner(input, input.purpose);
    return this.initiate(owner, input.purpose, input.size, input.content_type);
  }

  async initiateCpaUpload(
    input: CpaUploadInitiateInput,
    actor: CpaActor,
  ) {
    const owner = await this.cpaOwner(
      input.owner_type,
      input.owner_id,
      actor,
      input.purpose,
    );
    return this.initiate(owner, input.purpose, input.size, input.content_type);
  }

  private async complete(owner: UploadOwner, uploadId: string, requestId: string) {
    const { key, kind } = parsePrivateFileReference(uploadId);
    if (kind !== "owned" || !key.startsWith(owner.prefix)) {
      throw notFound("File not found");
    }
    const receiptKey = createHash("sha256").update(`create:${uploadId}`).digest("hex");
    const existing = await this.options.journal.getFileOperationReceipt(receiptKey);
    if (existing) return { file_uri: existing.file_uri };

    let head: HeadResult;
    try {
      head = (await this.options.s3.send(
        new HeadObjectCommand({ Bucket: this.options.filesBucketName, Key: key }),
      )) as HeadResult;
    } catch (error) {
      if (isMissingObject(error)) throw notFound("File not found");
      throw internalError();
    }
    const contentType = allowedContentTypeSchema.safeParse(head.ContentType);
    const purpose = head.Metadata?.purpose;
    if (
      !contentType.success ||
      !Number.isSafeInteger(head.ContentLength) ||
      head.Metadata?.["owner-hash"] !== ownerKeyPart(owner.id) ||
      head.Metadata?.["declared-size"] !== String(head.ContentLength) ||
      !["questionnaire_document", "signed_pdf", "pdf_template"].includes(purpose ?? "") ||
      !key.includes(`/${purposeSlug(purpose ?? "")}/`)
    ) {
      await this.compensateUpload(key, head.VersionId, requestId);
      throw notFound("File not found");
    }
    const snapshot = {
      file_uri: uploadId,
      owner_type: owner.type,
      owner_id: owner.id,
      purpose,
      size: head.ContentLength,
      content_type: contentType.data,
      version_id: head.VersionId ?? null,
    };
    try {
      const result = await this.options.journal.commitFileOperation({
        actorId: owner.actorId,
        requestId,
        operationId: `file-create-${receiptKey.slice(0, 32)}`,
        receiptKey,
        fileUri: uploadId,
        change: {
          entityType: "File",
          entityKey: stableReferenceHash(uploadId),
          operationType: "create",
          before: null,
          after: snapshot,
        },
      });
      return { file_uri: result.fileUri };
    } catch (error) {
      await this.compensateUpload(key, head.VersionId, requestId);
      throw error;
    }
  }

  private async compensateUpload(key: string, versionId: string | undefined, requestId: string) {
    try {
      await this.options.s3.send(
        new DeleteObjectCommand({
          Bucket: this.options.filesBucketName,
          Key: key,
          ...(versionId ? { VersionId: versionId } : {}),
        }),
      );
    } catch (error) {
      console.error("AuditFlow file compensation failed", {
        requestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }

  async completePublicUpload(input: PublicUploadCompleteInput, requestId: string) {
    const owner = await this.publicSubmissionOwner(input);
    return this.complete(owner, input.upload_id, requestId);
  }

  async completeCpaUpload(
    input: CpaUploadCompleteInput,
    actor: CpaActor,
    requestId: string,
  ) {
    const owner = await this.cpaOwner(input.owner_type, input.owner_id, actor);
    return this.complete(owner, input.upload_id, requestId);
  }

  private async signedUrlFor(reference: unknown, ownedPrefixes: readonly string[]) {
    let key: string;
    let kind: "owned" | "legacy";
    try {
      ({ key, kind } = resolveStoredFileReference(reference));
    } catch {
      throw notFound("File not found");
    }
    this.assertReadableReferenceKind(kind);
    if (
      kind === "owned" &&
      !ownedPrefixes.some((prefix) => key.startsWith(prefix))
    ) {
      throw notFound("File not found");
    }
    try {
      await this.options.s3.send(
        new HeadObjectCommand({ Bucket: this.options.filesBucketName, Key: key }),
      );
    } catch (error) {
      if (isMissingObject(error)) throw notFound("File not found");
      throw internalError();
    }
    const signedUrl = await this.options.presign(
      new GetObjectCommand({ Bucket: this.options.filesBucketName, Key: key }),
      READ_URL_TTL_SECONDS,
    );
    return { signed_url: signedUrl };
  }

  async getPublicSignedPdfUrl(input: PublicSignedPdfUrlInput) {
    const { client, submission } =
      await this.options.publicAuthorizer.authorizeActiveSubmission(input);
    if (!submission) throw notFound("No signed PDFs found");
    const reference = signedPdfReference(submission, input.step_id);
    if (!reference) throw notFound("PDF file not found for this step");
    return this.signedUrlFor(reference, [
      submissionPrefix(client.id, submission.id, ""),
    ]);
  }

  async getPublicTemplateFileUrl(input: PublicTemplateFileUrlInput) {
    const template = await this.authorizedPublicPdfTemplate(input);
    const reference = templateBaseReference(template);
    if (!reference) throw notFound("Template has no base PDF file");
    return this.signedUrlFor(reference, [
      templatePrefix(input.template_id),
      templatePrefix("pending"),
    ]);
  }

  async getPublicPdfTemplate(input: PublicPdfTemplateReadInput) {
    const template = await this.authorizedPublicPdfTemplate(input);
    return { template: publicPdfTemplate(template) };
  }

  private async authorizedPublicPdfTemplate(input: PublicTemplateFileUrlInput) {
    const { submission } =
      await this.options.publicAuthorizer.authorizeActiveSubmission(input);
    if (!submission) throw notFound("Template not found");
    const questionnaire = submission.template_id
      ? await this.options.questionnaireTemplates.get(String(submission.template_id))
      : await this.options.questionnaireTemplates.latestActive();
    if (
      !questionnaire ||
      !questionnaireAllowsPdfTemplate(questionnaire.steps, input.template_id)
    ) {
      throw notFound("Template not found");
    }
    const template = await this.options.pdfTemplates.get(input.template_id);
    if (!template || template.is_active === false) throw notFound("Template not found");
    return template;
  }

  async getCpaSubmissionFileUrl(input: CpaSubmissionFileUrlInput, actor: CpaActor) {
    void actor;
    const submission = await this.options.submissions.get(input.submission_id);
    if (!submission || submission.is_archived) throw notFound("Submission not found");
    const client = await this.options.clients.get(submission.client_id);
    if (!client || client.is_archived) throw notFound("Submission not found");
    const reference =
      input.source === "signed_pdf"
        ? signedPdfReference(submission, input.step_id)
        : responseFiles(submission, input.step_id)[input.file_index ?? 0];
    if (!reference) throw notFound("File not found");
    return this.signedUrlFor(reference, [
      submissionPrefix(client.id, submission.id, ""),
    ]);
  }

  async getCpaTemplateFileUrl(templateId: string, actor: CpaActor) {
    void actor;
    const template = await this.options.pdfTemplates.get(templateId);
    if (!template || template.is_active === false) throw notFound("Template not found");
    const reference = templateBaseReference(template);
    if (!reference) throw notFound("Template has no base PDF file");
    return this.signedUrlFor(reference, [
      templatePrefix(templateId),
      templatePrefix("pending"),
    ]);
  }

  async validateCpaTemplateReference(
    input: { readonly templateId: string; readonly fileReference: string },
    actor: CpaActor,
  ) {
    void actor;
    const { key, kind } = resolveStoredFileReference(input.fileReference);
    this.assertReadableReferenceKind(kind);
    if (kind !== "owned") return;

    const receiptKey = createHash("sha256")
      .update(`create:${input.fileReference}`)
      .digest("hex");
    const receipt = await this.options.journal.getFileOperationReceipt(receiptKey);
    if (!receipt || receipt.file_uri !== input.fileReference) {
      throw notFound("File not found");
    }
    const templateOwned = key.startsWith(templatePrefix(input.templateId));
    const pendingOwned = key.startsWith(templatePrefix("pending"));
    if (!templateOwned && !pendingOwned) throw notFound("File not found");
    let head: HeadResult;
    try {
      head = (await this.options.s3.send(
        new HeadObjectCommand({
          Bucket: this.options.filesBucketName,
          Key: key,
        }),
      )) as HeadResult;
    } catch (error) {
      if (isMissingObject(error)) throw notFound("File not found");
      throw internalError();
    }
    const expectedOwner = templateOwned ? input.templateId : "pending";
    if (
      head.ContentType !== "application/pdf" ||
      head.Metadata?.purpose !== "pdf_template" ||
      head.Metadata?.["owner-hash"] !== ownerKeyPart(expectedOwner)
    ) {
      throw notFound("File not found");
    }
  }

  async mirrorCpaTemplateFile(
    input: CpaTemplateFileMirrorInput,
    actor: CpaActor,
    requestId: string,
  ) {
    await this.validateCpaTemplateReference(
      { templateId: input.template_id, fileReference: input.file_reference },
      actor,
    );
    const before = await this.options.pdfTemplates.get(input.template_id);
    const existingSourceVersion = before?.source_version ?? 0;
    if (
      before &&
      (existingSourceVersion > input.source_version ||
        (existingSourceVersion === input.source_version &&
          !matchesTemplateMirror(before, input)))
    ) {
      throw templateMirrorConflict();
    }
    if (
      before &&
      existingSourceVersion === input.source_version &&
      matchesTemplateMirror(before, input)
    ) {
      return {
        template_id: input.template_id,
        mirrored: true,
        version: before._version,
      } as const;
    }

    const occurredAt = this.clock().toISOString();
    const after: PdfTemplateRecord = before
      ? {
          ...before,
          name: input.name,
          file_reference: input.file_reference,
          is_active: input.is_active,
          source_version: input.source_version,
          _version: before._version + 1,
          updated_date: occurredAt,
        }
      : {
          id: input.template_id,
          name: input.name,
          file_reference: input.file_reference,
          is_active: input.is_active,
          source_version: input.source_version,
          record_type: "PdfTemplate",
          _version: 1,
          created_date: occurredAt,
          updated_date: occurredAt,
          created_by: actor.userId,
        };
    const businessAction: TransactionItem = {
      Put: {
        TableName: this.options.pdfTemplates.tableName,
        Item: after,
        ConditionExpression: before
          ? "#version = :expected_version"
          : "attribute_not_exists(#id)",
        ExpressionAttributeNames: before
          ? { "#version": "_version" }
          : { "#id": "id" },
        ...(before
          ? {
              ExpressionAttributeValues: {
                ":expected_version": before._version,
              },
            }
          : {}),
      },
    };
    try {
      await this.options.journal.commit({
        actorId: actor.userId,
        requestId,
        operationId: `pdf-template-mirror-${createHash("sha256")
          .update(requestId)
          .digest("hex")
          .slice(0, 32)}`,
        businessActions: [businessAction],
        changes: [
          {
            entityType: "PdfTemplate",
            entityKey: input.template_id,
            operationType: before ? "update" : "create",
            before: before ?? null,
            after,
          },
        ],
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.statusCode !== 409) throw error;
      const winner = await this.options.pdfTemplates.get(input.template_id);
      if (
        winner?.source_version === input.source_version &&
        matchesTemplateMirror(winner, input)
      ) {
        return {
          template_id: input.template_id,
          mirrored: true,
          version: winner._version,
        } as const;
      }
      throw templateMirrorConflict();
    }
    return {
      template_id: input.template_id,
      mirrored: true,
      version: after._version,
    } as const;
  }

  async requestZipDownload(submissionId: string, actor: CpaActor) {
    const submission = await this.options.submissions.get(submissionId);
    if (!submission || submission.is_archived) throw notFound("Submission not found");
    const client = await this.options.clients.get(submission.client_id);
    if (!client || client.is_archived) throw notFound("Submission not found");
    const questionnaire = submission.template_id
      ? await this.options.questionnaireTemplates.get(String(submission.template_id))
      : await this.options.questionnaireTemplates.latestActive();
    let steps: Record<string, unknown>[] = [];
    if (questionnaire) {
      try {
        const parsed: unknown = JSON.parse(questionnaire.steps);
        if (!Array.isArray(parsed)) throw new Error("invalid");
        steps = parsed.filter(
          (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object",
        );
      } catch {
        throw internalError();
      }
    }
    let entries;
    try {
      entries = deriveSubmissionFileEntries(submission, steps);
    } catch {
      throw notFound("File not found");
    }
    if (entries.length === 0) throw badRequest("No files available");
    const allowedOwnedPrefix = submissionPrefix(client.id, submission.id, "");
    for (const { key: sourceKey } of entries) {
      this.assertReadableReferenceKind(
        sourceKey.startsWith("legacy/") ? "legacy" : "owned",
      );
      if (
        !sourceKey.startsWith("legacy/") &&
        !sourceKey.startsWith(allowedOwnedPrefix)
      ) {
        throw notFound("File not found");
      }
    }

    const now = this.clock();
    const jobId = this.idGenerator();
    const archiveName = `${sanitizeZipName(client.full_name, "documents")}.zip`;
    const manifest = zipManifestSchema.parse({
      version: 1,
      job_id: jobId,
      actor_id: actor.userId,
      submission_id: submission.id,
      client_id: client.id,
      archive_name: archiveName,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ZIP_RESULT_TTL_SECONDS * 1_000).toISOString(),
      entries,
    });
    await this.options.s3.send(
      new PutObjectCommand({
        Bucket: this.options.temporaryOutputsBucketName,
        Key: `${ZIP_REQUEST_PREFIX}${jobId}.json`,
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
      }),
    );
    return { job_id: jobId, status: "pending" as const };
  }

  async getZipDownloadStatus(submissionId: string, jobId: string, actor: CpaActor) {
    const submission = await this.options.submissions.get(submissionId);
    if (!submission || submission.is_archived) throw notFound("Submission not found");
    const client = await this.options.clients.get(submission.client_id);
    if (!client || client.is_archived) throw notFound("Submission not found");
    let manifest;
    try {
      const result = (await this.options.s3.send(
        new GetObjectCommand({
          Bucket: this.options.temporaryOutputsBucketName,
          Key: `${ZIP_REQUEST_PREFIX}${jobId}.json`,
        }),
      )) as GetResult;
      manifest = zipManifestSchema.parse(JSON.parse(await objectBodyText(result)));
    } catch (error) {
      if (isMissingObject(error)) throw notFound("ZIP download not found");
      throw internalError();
    }
    if (
      manifest.submission_id !== submission.id ||
      manifest.client_id !== client.id ||
      manifest.actor_id !== actor.userId
    ) {
      throw notFound("ZIP download not found");
    }
    const remainingMilliseconds =
      new Date(manifest.expires_at).getTime() - this.clock().getTime();
    if (remainingMilliseconds < 1_000) {
      throw notFound("ZIP download expired");
    }
    let status;
    try {
      const result = (await this.options.s3.send(
        new GetObjectCommand({
          Bucket: this.options.temporaryOutputsBucketName,
          Key: `${ZIP_LOCK_PREFIX}${jobId}.json`,
        }),
      )) as GetResult;
      status = zipProcessingLeaseSchema.parse(
        JSON.parse(await objectBodyText(result)),
      ).terminal_status;
    } catch (error) {
      if (isMissingObject(error)) return { job_id: jobId, status: "pending" as const };
      throw internalError();
    }
    if (!status) return { job_id: jobId, status: "pending" as const };
    if (status.state === "failed") {
      return { job_id: jobId, status: "failed" as const, error: "ZIP download failed" };
    }
    if (!isZipResultKeyForJob(status.result_key, jobId)) throw internalError();
    const signedUrl = await this.options.presign(
      new GetObjectCommand({
        Bucket: this.options.temporaryOutputsBucketName,
        Key: status.result_key,
      }),
      Math.min(
        ZIP_RESULT_TTL_SECONDS,
        Math.floor(remainingMilliseconds / 1_000),
      ),
    );
    return {
      job_id: jobId,
      status: "ready" as const,
      signed_url: signedUrl,
      download_name: manifest.archive_name,
    };
  }

  async deleteOwnedFile(input: {
    reference: string;
    ownerType: "submission" | "pdf_template";
    ownerId: string;
    actor: CpaActor;
    requestId: string;
  }) {
    const owner = await this.cpaOwner(input.ownerType, input.ownerId, input.actor);
    const { key, kind } = parsePrivateFileReference(input.reference);
    if (kind !== "owned" || !key.startsWith(owner.prefix)) {
      throw notFound("File not found");
    }
    const receiptKey = createHash("sha256")
      .update(`delete:${input.reference}`)
      .digest("hex");
    const existing = await this.options.journal.getFileOperationReceipt(receiptKey);
    if (existing) return { deleted: true, replayed: true } as const;
    const head = (await this.options.s3.send(
      new HeadObjectCommand({ Bucket: this.options.filesBucketName, Key: key }),
    )) as HeadResult;
    const deleted = (await this.options.s3.send(
      new DeleteObjectCommand({ Bucket: this.options.filesBucketName, Key: key }),
    )) as DeleteResult;
    if (!deleted.DeleteMarker || !deleted.VersionId) throw internalError();
    try {
      const result = await this.options.journal.commitFileOperation({
        actorId: input.actor.userId,
        requestId: input.requestId,
        operationId: `file-delete-${receiptKey.slice(0, 32)}`,
        receiptKey,
        fileUri: input.reference,
        change: {
          entityType: "File",
          entityKey: stableReferenceHash(input.reference),
          operationType: "delete",
          before: {
            file_uri: input.reference,
            owner_type: owner.type,
            owner_id: owner.id,
            version_id: head.VersionId ?? null,
            size: head.ContentLength ?? null,
            content_type: head.ContentType ?? null,
          },
          after: { deleted: true, delete_marker_version_id: deleted.VersionId },
        },
      });
      if (result.replayed) {
        await this.options.s3.send(
          new DeleteObjectCommand({
            Bucket: this.options.filesBucketName,
            Key: key,
            VersionId: deleted.VersionId,
          }),
        );
      }
      return { deleted: true, replayed: result.replayed } as const;
    } catch (journalError) {
      try {
        await this.options.s3.send(
          new DeleteObjectCommand({
            Bucket: this.options.filesBucketName,
            Key: key,
            VersionId: deleted.VersionId,
          }),
        );
      } catch (restorationError) {
        try {
          await this.options.journal.recordFileReconciliation({
            actorId: input.actor.userId,
            requestId: input.requestId,
            operationId: `file-delete-${receiptKey.slice(0, 32)}`,
            receiptKey,
            referenceHash: stableReferenceHash(input.reference),
            deleteMarkerVersionId: deleted.VersionId,
            journalFailureName: failureName(journalError),
            restorationFailureName: failureName(restorationError),
          });
        } catch (reconciliationError) {
          throw new AggregateError(
            [journalError, restorationError, reconciliationError],
            "File delete reconciliation recording failed",
          );
        }
      }
      throw journalError;
    }
  }
}

export {
  parseJsonArray,
  parseJsonRecord,
  questionnaireAllowsPdfTemplate,
  responseFiles,
  signedPdfReference,
  submissionPrefix,
  templateBaseReference,
  templatePrefix,
};
