import { describe, expect, it } from "vitest";

import {
  MAX_SINGLE_PUT_BYTES,
  cpaSubmissionFileUrlSchema,
  cpaTemplateFileMirrorSchema,
  isZipResultKeyForJob,
  legacyReferenceKey,
  parsePrivateFileReference,
  privateFileReference,
  publicPdfTemplateReadSchema,
  publicUploadSchema,
  resolveStoredFileReference,
  sanitizeZipName,
  zipManifestSchema,
  zipProcessingLeaseSchema,
  zipResultKey,
} from "../contracts/files";

const initiate = {
  operation: "initiate",
  client_id: "client-test",
  token: "synthetic-token",
  submission_id: "submission-test",
  purpose: "questionnaire_document",
  step_id: "step-test",
  size: 12,
  content_type: "application/pdf",
};

describe("file contracts", () => {
  it("accepts metadata-only initiation and rejects bytes, unknown fields, and unsafe sizes", () => {
    expect(publicUploadSchema.parse(initiate)).toEqual(initiate);
    for (const patch of [
      { file: "bytes" },
      { body: "bytes" },
      { base64: "bytes" },
      { size: -1 },
      { size: Number.POSITIVE_INFINITY },
      { size: MAX_SINGLE_PUT_BYTES + 1 },
      { content_type: "text/html" },
    ]) {
      expect(publicUploadSchema.safeParse({ ...initiate, ...patch }).success).toBe(false);
    }
  });

  it("round-trips exact owned references and rejects traversal and arbitrary URI schemes", () => {
    const key = `firms/ddcpa/clients/${"a".repeat(32)}/submissions/${"b".repeat(32)}/questionnaire-document/123e4567-e89b-12d3-a456-426614174000.pdf`;
    const reference = privateFileReference(key);
    expect(parsePrivateFileReference(reference)).toEqual({ key, kind: "owned" });
    for (const value of [
      "https://example.test/file.pdf",
      "s3://bucket/key",
      "arn:aws:s3:::bucket/key",
      "private://files/firms/ddcpa/../foreign.pdf",
      "private://files/firms/ddcpa/%2f/foreign.pdf",
      `private://files/firms/ddcpa/clients/${"a".repeat(32)}/submissions/${"b".repeat(32)}/questionnaire-document/123e4567e89b12d3a456426614174000.pdf`,
      `private://files/firms/ddcpa/clients/${"a".repeat(32)}/submissions/${"b".repeat(32)}/questionnaire-document/------------------------------------.pdf`,
    ]) {
      expect(() => resolveStoredFileReference(value)).toThrow("Invalid private file reference");
    }
  });

  it("maps supported imported references deterministically without embedding the source", () => {
    const reference = "private://synthetic/imported.pdf";
    const first = legacyReferenceKey(reference);
    expect(first).toBe(legacyReferenceKey(reference));
    expect(first).toMatch(/^legacy\/[a-f0-9]{64}$/);
    expect(first).not.toContain("synthetic");
    expect(resolveStoredFileReference("private/synthetic/imported.pdf").kind).toBe("legacy");
    expect(resolveStoredFileReference("mp/synthetic/imported.pdf").kind).toBe("legacy");
  });

  it("requires resource locators instead of a raw file reference", () => {
    expect(
      cpaSubmissionFileUrlSchema.safeParse({
        submission_id: "submission-test",
        source: "response",
        step_id: "step-test",
        file_index: 0,
      }).success,
    ).toBe(true);
    expect(
      cpaSubmissionFileUrlSchema.safeParse({
        submission_id: "submission-test",
        source: "response",
        step_id: "step-test",
        file_uri: "private://synthetic/imported.pdf",
      }).success,
    ).toBe(false);
  });

  it("requires public credentials for PDF template metadata reads", () => {
    const input = {
      client_id: "client-test",
      token: "synthetic-token",
      template_id: "template-test",
    };
    expect(publicPdfTemplateReadSchema.parse(input)).toEqual(input);
    expect(
      publicPdfTemplateReadSchema.safeParse({ template_id: "template-test" }).success,
    ).toBe(false);
    expect(
      publicPdfTemplateReadSchema.safeParse({ ...input, file_uri: "private://untrusted" })
        .success,
    ).toBe(false);
  });

  it("accepts only private references in the authenticated template mirror", () => {
    const input = {
      template_id: "template-test",
      file_reference: "private://synthetic/imported.pdf",
      name: "Synthetic template",
      is_active: true,
      source_version: 1,
    };
    expect(cpaTemplateFileMirrorSchema.parse(input)).toEqual(input);
    expect(
      cpaTemplateFileMirrorSchema.safeParse({
        ...input,
        file_reference: "https://example.test/template.pdf",
      }).success,
    ).toBe(false);
    expect(
      cpaTemplateFileMirrorSchema.safeParse({ ...input, object_key: "foreign" })
        .success,
    ).toBe(false);
  });

  it("binds processing leases and result keys to UUID job owners", () => {
    const jobId = "123e4567-e89b-12d3-a456-426614174000";
    const ownerId = "223e4567-e89b-12d3-a456-426614174000";
    expect(
      zipProcessingLeaseSchema.parse({
        version: 1,
        job_id: jobId,
        owner_id: ownerId,
        expires_at: "2026-01-01T00:01:00.000Z",
      }),
    ).toMatchObject({ job_id: jobId, owner_id: ownerId });
    expect(
      zipProcessingLeaseSchema.parse({
        version: 1,
        job_id: jobId,
        owner_id: ownerId,
        expires_at: "2026-01-01T00:01:00.000Z",
        terminal_status: {
          version: 1,
          job_id: jobId,
          state: "ready",
          result_key: zipResultKey(jobId, ownerId),
          completed_at: "2026-01-01T00:00:30.000Z",
        },
      }),
    ).toMatchObject({ terminal_status: { state: "ready" } });
    const key = zipResultKey(jobId, ownerId);
    expect(isZipResultKeyForJob(key, jobId)).toBe(true);
    expect(isZipResultKeyForJob(key, ownerId)).toBe(false);
  });

  it("sanitizes ZIP path characters while preserving Unicode labels", () => {
    expect(sanitizeZipName("מסמך/בדיקה\u0000.pdf")).toBe("מסמך בדיקה.pdf");
    expect(sanitizeZipName("../CON")).toBe("_CON");
    expect(sanitizeZipName("CON")).toBe("_CON");
  });

  it("rejects arbitrary ZIP source keys and entry paths", () => {
    const base = {
      version: 1,
      job_id: "123e4567-e89b-12d3-a456-426614174000",
      actor_id: "actor-test",
      submission_id: "submission-test",
      client_id: "client-test",
      archive_name: "documents.zip",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T01:00:00.000Z",
    };
    expect(
      zipManifestSchema.safeParse({
        ...base,
        entries: [{ key: "foreign/object", name: "safe.pdf" }],
      }).success,
    ).toBe(false);
    expect(
      zipManifestSchema.safeParse({
        ...base,
        entries: [{ key: `legacy/${"a".repeat(64)}`, name: "../escape.pdf" }],
      }).success,
    ).toBe(false);
  });
});
