import { createHash } from "node:crypto";

import { z } from "zod";

export const UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const READ_URL_TTL_SECONDS = 60 * 60;
export const ZIP_RESULT_TTL_SECONDS = 60 * 60;
export const MAX_SINGLE_PUT_BYTES = 5 * 1024 * 1024 * 1024;
export const CURRENT_FIRM_KEY = "ddcpa";
export const ZIP_REQUEST_PREFIX = "zip-jobs/requests/";
export const ZIP_RESULT_PREFIX = "zip-jobs/results/";
export const ZIP_LOCK_PREFIX = "zip-jobs/locks/";
export const ZIP_LEASE_DURATION_MS = 60 * 1_000;
export const ZIP_LEASE_HEARTBEAT_MS = 20 * 1_000;

const idSchema = z.string().min(1).max(256);
const tokenSchema = z.string().min(1).max(512);
const stepIdSchema = z.string().min(1).max(256);
const uploadIdSchema = z.string().min(1).max(2048);
const objectSizeSchema = z.number().int().nonnegative().max(MAX_SINGLE_PUT_BYTES);

export const allowedContentTypeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
]);
export const uploadPurposeSchema = z.enum([
  "questionnaire_document",
  "signed_pdf",
  "pdf_template",
]);

const publicCredentials = { client_id: idSchema, token: tokenSchema };

export const publicUploadInitiateSchema = z
  .object({
    operation: z.literal("initiate"),
    ...publicCredentials,
    submission_id: idSchema,
    purpose: z.enum(["questionnaire_document", "signed_pdf"]),
    step_id: stepIdSchema,
    size: objectSizeSchema,
    content_type: allowedContentTypeSchema,
  })
  .strict();
export const publicUploadCompleteSchema = z
  .object({
    operation: z.literal("complete"),
    ...publicCredentials,
    submission_id: idSchema,
    upload_id: uploadIdSchema,
  })
  .strict();
export const publicUploadSchema = z.discriminatedUnion("operation", [
  publicUploadInitiateSchema,
  publicUploadCompleteSchema,
]);

export const cpaUploadInitiateSchema = z
  .object({
    owner_type: z.enum(["submission", "pdf_template"]),
    owner_id: idSchema,
    purpose: uploadPurposeSchema,
    step_id: stepIdSchema.optional(),
    size: objectSizeSchema,
    content_type: allowedContentTypeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const valid =
      (value.owner_type === "submission" && value.purpose !== "pdf_template" && value.step_id) ||
      (value.owner_type === "pdf_template" && value.purpose === "pdf_template");
    if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid upload owner" });
  });
export const cpaUploadCompleteSchema = z
  .object({
    upload_id: uploadIdSchema,
    owner_type: z.enum(["submission", "pdf_template"]),
    owner_id: idSchema,
  })
  .strict();

export const publicSignedPdfUrlSchema = z
  .object({ ...publicCredentials, step_id: stepIdSchema })
  .strict();
export const publicTemplateFileUrlSchema = z
  .object({ ...publicCredentials, template_id: idSchema })
  .strict();
export const publicPdfTemplateReadSchema = z
  .object({ ...publicCredentials, template_id: idSchema })
  .strict();
export const cpaSubmissionFileUrlSchema = z
  .object({
    submission_id: idSchema,
    source: z.enum(["response", "signed_pdf"]),
    step_id: stepIdSchema,
    file_index: z.number().int().nonnegative().max(1_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source === "response" && value.file_index === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["file_index"], message: "File index required" });
    }
    if (value.source === "signed_pdf" && value.file_index !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["file_index"], message: "File index not allowed" });
    }
  });
export const cpaTemplateFileUrlSchema = z.object({ template_id: idSchema }).strict();
export const zipDownloadRequestSchema = z.object({}).strict();
export const zipJobIdSchema = z.string().uuid();
const fileReferencePrefix = "private://files/";
const safeKeyPattern = /^(?:firms\/[a-z0-9-]+\/(?:clients\/[a-f0-9]{32}\/submissions\/[a-f0-9]{32}\/(?:questionnaire-document|signed-pdf)|templates\/[a-f0-9]{32}\/pdf-template)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|jpg|png|heic)|legacy\/[a-f0-9]{64})$/;
const encodedSeparatorPattern = /%(?:2f|5c)/i;
const safeZipEntryNameSchema = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) =>
      !/[\/\u0000-\u001f\u007f]/.test(value) &&
      value !== "." &&
      value !== ".." &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value),
    "Invalid ZIP entry name",
  );
export const privateFileKeySchema = z
  .string()
  .max(2048)
  .refine(
    (value) => safeKeyPattern.test(value) && !encodedSeparatorPattern.test(value),
    "Invalid private file key",
  );

export interface ResolvedFileReference {
  readonly key: string;
  readonly kind: "owned" | "legacy";
}

export function parsePrivateFileReference(value: string): ResolvedFileReference {
  if (typeof value !== "string" || !value.startsWith(fileReferencePrefix)) {
    throw new Error("Invalid private file reference");
  }
  const key = value.slice(fileReferencePrefix.length);
  if (!safeKeyPattern.test(key) || encodedSeparatorPattern.test(key)) {
    throw new Error("Invalid private file reference");
  }
  return { key, kind: key.startsWith("legacy/") ? "legacy" : "owned" };
}

export function privateFileReference(key: string) {
  if (!safeKeyPattern.test(key)) throw new Error("Invalid private file key");
  return `${fileReferencePrefix}${key}`;
}

function validLegacyReference(value: string) {
  if (value.length < 4 || value.length > 4096 || /[\u0000-\u001f\\]/.test(value)) return false;
  if (encodedSeparatorPattern.test(value) || value.split("/").some((part) => part === "." || part === "..")) return false;
  return (
    (value.startsWith("private://") && !value.startsWith(fileReferencePrefix)) ||
    value.startsWith("private/") ||
    value.startsWith("mp/")
  );
}

export function legacyReferenceKey(value: string) {
  const canonical = value.trim();
  if (!validLegacyReference(canonical)) throw new Error("Invalid private file reference");
  return `legacy/${createHash("sha256").update(canonical).digest("hex")}`;
}

export function resolveStoredFileReference(value: unknown): ResolvedFileReference {
  if (typeof value !== "string") throw new Error("Invalid private file reference");
  if (value.startsWith(fileReferencePrefix)) return parsePrivateFileReference(value);
  return { key: legacyReferenceKey(value), kind: "legacy" };
}

export function stableReferenceHash(reference: string) {
  return createHash("sha256").update(reference).digest("hex");
}

export const cpaTemplateFileMirrorSchema = z
  .object({
    template_id: idSchema,
    file_reference: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => {
        try {
          resolveStoredFileReference(value);
          return true;
        } catch {
          return false;
        }
      }, "Invalid private file reference"),
    name: z.string().min(1).max(512),
    is_active: z.boolean(),
    source_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export function ownerKeyPart(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}
export function extensionForContentType(contentType: z.infer<typeof allowedContentTypeSchema>) {
  return {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heic",
  }[contentType];
}

export function sanitizeZipName(value: string, fallback = "file") {
  const cleaned = value
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, " ")
    .replace(/[^\p{L}\p{N} ._-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+/g, "")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  const candidate = cleaned || fallback;
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(candidate)
    ? `_${candidate}`
    : candidate;
}

export function safeStoredExtension(value: unknown, contentType?: string) {
  const fromName = typeof value === "string" ? /\.([a-zA-Z0-9]{1,5})$/.exec(value)?.[1]?.toLowerCase() : undefined;
  if (fromName && ["pdf", "jpg", "jpeg", "png", "heic"].includes(fromName)) {
    return fromName === "jpeg" ? "jpg" : fromName;
  }
  const mapped: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/heic": "heic",
    "image/heif": "heic",
  };
  return mapped[contentType ?? ""] ?? "file";
}

export type PublicUploadInput = z.infer<typeof publicUploadSchema>;
export type PublicUploadInitiateInput = z.infer<typeof publicUploadInitiateSchema>;
export type PublicUploadCompleteInput = z.infer<typeof publicUploadCompleteSchema>;
export type CpaUploadInitiateInput = z.infer<typeof cpaUploadInitiateSchema>;
export type CpaUploadCompleteInput = z.infer<typeof cpaUploadCompleteSchema>;
export type CpaTemplateFileMirrorInput = z.infer<
  typeof cpaTemplateFileMirrorSchema
>;
export type PublicSignedPdfUrlInput = z.infer<typeof publicSignedPdfUrlSchema>;
export type PublicTemplateFileUrlInput = z.infer<typeof publicTemplateFileUrlSchema>;
export type PublicPdfTemplateReadInput = z.infer<typeof publicPdfTemplateReadSchema>;
export type CpaSubmissionFileUrlInput = z.infer<typeof cpaSubmissionFileUrlSchema>;

export const zipManifestSchema = z
  .object({
    version: z.literal(1),
    job_id: zipJobIdSchema,
    actor_id: idSchema,
    submission_id: idSchema,
    client_id: idSchema,
    archive_name: z.string().min(1).max(160),
    created_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
    entries: z
      .array(
        z
          .object({
            key: privateFileKeySchema,
            name: safeZipEntryNameSchema,
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const zipStatusSchema = z.discriminatedUnion("state", [
  z
    .object({
      version: z.literal(1),
      job_id: zipJobIdSchema,
      state: z.literal("ready"),
      result_key: z.string().min(1).max(2048),
      completed_at: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      job_id: zipJobIdSchema,
      state: z.literal("failed"),
      failure_code: z.enum([
        "source_unavailable",
        "archive_failed",
        "invalid_job",
      ]),
      completed_at: z.string().datetime({ offset: true }),
    })
    .strict(),
]);
export const zipProcessingLeaseSchema = z
  .object({
    version: z.literal(1),
    job_id: zipJobIdSchema,
    owner_id: z.string().uuid(),
    expires_at: z.string().datetime({ offset: true }),
    terminal_status: zipStatusSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.terminal_status &&
      value.terminal_status.job_id !== value.job_id
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["terminal_status", "job_id"],
        message: "Terminal status must belong to the lease job",
      });
    }
  });
export type ZipManifest = z.infer<typeof zipManifestSchema>;
export type ZipStatus = z.infer<typeof zipStatusSchema>;
export type ZipProcessingLease = z.infer<typeof zipProcessingLeaseSchema>;

export function zipResultKey(jobId: string, ownerId: string) {
  return `${ZIP_RESULT_PREFIX}${zipJobIdSchema.parse(jobId)}/${zipJobIdSchema.parse(ownerId)}.zip`;
}

export function isZipResultKeyForJob(value: string, jobId: string) {
  const escapedJobId = jobId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${ZIP_RESULT_PREFIX}${escapedJobId}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.zip$`,
    "i",
  ).test(value);
}
