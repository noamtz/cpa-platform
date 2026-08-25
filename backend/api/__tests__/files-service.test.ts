import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import type { PublicClientAuthorizer } from "../auth/public-client";
import { ownerKeyPart, privateFileReference } from "../contracts/files";
import type { ClientRepository } from "../repositories/client";
import type { PdfTemplateRepository } from "../repositories/pdf-template";
import type { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";
import type { SubmissionRepository } from "../repositories/submission";
import type { ChangeJournalService } from "../services/change-journal";
import { FileService } from "../services/files";

const client = {
  id: "client-test",
  full_name: "Synthetic Client",
  tax_year: 2026,
  record_type: "Client" as const,
  _version: 1,
  created_date: "2026-01-01T00:00:00.000Z",
  updated_date: "2026-01-01T00:00:00.000Z",
};
const submission = {
  id: "submission-test",
  client_id: client.id,
  tax_year: 2026,
  is_archived: false,
  record_type: "Submission" as const,
  _version: 1,
  created_date: "2026-01-01T00:00:00.000Z",
  updated_date: "2026-01-01T00:00:00.000Z",
};
const actor = {
  userId: "user-test",
  cognitoSubject: "subject-test",
  role: "admin" as const,
};
const generatedId = "123e4567-e89b-12d3-a456-426614174000";

function ownedReference(purpose = "questionnaire-document") {
  const objectKey = `firms/ddcpa/clients/${ownerKeyPart(client.id)}/submissions/${ownerKeyPart(submission.id)}/${purpose}/${generatedId}.pdf`;
  return privateFileReference(objectKey);
}

function templateReference(ownerId = "pending") {
  return privateFileReference(
    `firms/ddcpa/templates/${ownerKeyPart(ownerId)}/pdf-template/${generatedId}.pdf`,
  );
}

function setup(overrides: Record<string, unknown> = {}) {
  const send = vi.fn();
  const presign = vi.fn().mockResolvedValue("https://signed.example.test/object");
  const journal = {
    getFileOperationReceipt: vi.fn().mockResolvedValue(undefined),
    commitFileOperation: vi.fn().mockResolvedValue({
      fileUri: ownedReference(),
      replayed: false,
    }),
    commit: vi.fn().mockResolvedValue([]),
    recordFileReconciliation: vi.fn().mockResolvedValue({}),
  };
  const publicAuthorizer = {
    authorize: vi.fn().mockResolvedValue(client),
    activeSubmission: vi.fn().mockResolvedValue(submission),
    authorizeActiveSubmission: vi.fn().mockResolvedValue({ client, submission }),
  };
  const clients = { get: vi.fn().mockResolvedValue(client) };
  const submissions = { get: vi.fn().mockResolvedValue(submission) };
  const questionnaireTemplates = { get: vi.fn(), latestActive: vi.fn() };
  const pdfTemplates = { get: vi.fn(), mirrorFile: vi.fn() };
  const options = {
    s3: { send },
    presign,
    filesBucketName: "FilesBucket.test",
    temporaryOutputsBucketName: "TemporaryOutputsBucket.test",
    clients: clients as unknown as ClientRepository,
    submissions: submissions as unknown as SubmissionRepository,
    questionnaireTemplates:
      questionnaireTemplates as unknown as QuestionnaireTemplateRepository,
    pdfTemplates: pdfTemplates as unknown as PdfTemplateRepository,
    publicAuthorizer: publicAuthorizer as unknown as PublicClientAuthorizer,
    journal: journal as unknown as ChangeJournalService,
    clock: () => new Date("2026-01-01T00:00:00.000Z"),
    idGenerator: () => generatedId,
    ...overrides,
  };
  return {
    service: new FileService(options),
    send,
    presign,
    journal,
    publicAuthorizer,
    questionnaireTemplates,
    pdfTemplates,
  };
}

describe("FileService uploads", () => {
  it("authorizes before issuing a short-lived metadata-only PUT", async () => {
    const { service, presign, publicAuthorizer, send } = setup();
    const result = await service.initiatePublicUpload(
      {
        operation: "initiate",
        client_id: client.id,
        token: "synthetic-link-value",
        submission_id: submission.id,
        purpose: "questionnaire_document",
        step_id: "step-test",
        size: 12_000_000,
        content_type: "application/pdf",
      },
    );
    expect(publicAuthorizer.authorize).toHaveBeenCalledBefore(presign);
    const command = presign.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).not.toHaveProperty("Body");
    expect(command.input).toMatchObject({
      Bucket: "FilesBucket.test",
      ContentType: "application/pdf",
      IfNoneMatch: "*",
      Metadata: {
        "owner-hash": ownerKeyPart(submission.id),
        purpose: "questionnaire_document",
        "declared-size": "12000000",
      },
    });
    expect(presign.mock.calls[0][1]).toBe(900);
    expect(result.upload_id).toBe(ownedReference());
    expect(result.headers["if-none-match"]).toBe("*");
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a stale or foreign public submission before S3", async () => {
    const publicAuthorizer = {
      authorize: vi.fn().mockResolvedValue(client),
      activeSubmission: vi.fn().mockResolvedValue({ ...submission, id: "other" }),
    } as unknown as PublicClientAuthorizer;
    const { service, send, presign } = setup({ publicAuthorizer });
    await expect(
      service.initiatePublicUpload(
        {
          operation: "initiate",
          client_id: client.id,
          token: "synthetic-link-value",
          submission_id: submission.id,
          purpose: "questionnaire_document",
          step_id: "step-test",
          size: 1,
          content_type: "application/pdf",
        },
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(send).not.toHaveBeenCalled();
    expect(presign).not.toHaveBeenCalled();
  });

  it("verifies object metadata and journals the stable reference", async () => {
    const { service, send, journal } = setup();
    send.mockResolvedValue({
      ContentLength: 24,
      ContentType: "application/pdf",
      Metadata: {
        "owner-hash": ownerKeyPart(submission.id),
        purpose: "questionnaire_document",
        "declared-size": "24",
      },
      VersionId: "version-test",
    });
    const reference = ownedReference();
    journal.commitFileOperation.mockResolvedValue({ fileUri: reference, replayed: false });
    await expect(
      service.completePublicUpload(
        {
          operation: "complete",
          client_id: client.id,
          token: "synthetic-link-value",
          submission_id: submission.id,
          upload_id: reference,
        },
        "request-test",
      ),
    ).resolves.toEqual({ file_uri: reference });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
    expect(journal.commitFileOperation).toHaveBeenCalledOnce();
    expect(journal.commitFileOperation.mock.calls[0][0].change.after).toMatchObject({
      size: 24,
      version_id: "version-test",
    });
  });

  it("compensates the exact uploaded version when journaling fails", async () => {
    const { service, send, journal } = setup();
    send
      .mockResolvedValueOnce({
        ContentLength: 24,
        ContentType: "application/pdf",
        Metadata: {
          "owner-hash": ownerKeyPart(submission.id),
          purpose: "questionnaire_document",
          "declared-size": "24",
        },
        VersionId: "version-test",
      })
      .mockResolvedValueOnce({});
    journal.commitFileOperation.mockRejectedValue(new Error("synthetic journal failure"));
    await expect(
      service.completePublicUpload(
        {
          operation: "complete",
          client_id: client.id,
          token: "synthetic-link-value",
          submission_id: submission.id,
          upload_id: ownedReference(),
        },
        "request-test",
      ),
    ).rejects.toThrow("synthetic journal failure");
    const compensation = send.mock.calls[1][0];
    expect(compensation).toBeInstanceOf(DeleteObjectCommand);
    expect(compensation.input.VersionId).toBe("version-test");
  });

  it("removes the exact unjournaled version when signed metadata does not match", async () => {
    const { service, send, journal } = setup();
    send
      .mockResolvedValueOnce({
        ContentLength: 25,
        ContentType: "application/pdf",
        Metadata: {
          "owner-hash": ownerKeyPart(submission.id),
          purpose: "questionnaire_document",
          "declared-size": "24",
        },
        VersionId: "mismatch-version",
      })
      .mockResolvedValueOnce({});
    await expect(
      service.completePublicUpload(
        {
          operation: "complete",
          client_id: client.id,
          token: "synthetic-link-value",
          submission_id: submission.id,
          upload_id: ownedReference(),
        },
        "request-test",
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(journal.commitFileOperation).not.toHaveBeenCalled();
    const compensation = send.mock.calls[1][0];
    expect(compensation).toBeInstanceOf(DeleteObjectCommand);
    expect(compensation.input.VersionId).toBe("mismatch-version");
  });

  it("returns a prior receipt without a second object or journal operation", async () => {
    const { service, send, journal } = setup();
    journal.getFileOperationReceipt.mockResolvedValue({ file_uri: ownedReference() });
    await expect(
      service.completePublicUpload(
        {
          operation: "complete",
          client_id: client.id,
          token: "synthetic-link-value",
          submission_id: submission.id,
          upload_id: ownedReference(),
        },
        "request-test",
      ),
    ).resolves.toEqual({ file_uri: ownedReference() });
    expect(send).not.toHaveBeenCalled();
    expect(journal.commitFileOperation).not.toHaveBeenCalled();
  });
});

describe("FileService scoped reads and deletion", () => {
  it("derives a public signed PDF from the active Submission", async () => {
    const legacyReference = "private://synthetic/signed.pdf";
    const { service, send, presign, publicAuthorizer } = setup();
    publicAuthorizer.authorizeActiveSubmission.mockResolvedValue({
      client,
      submission: {
        ...submission,
        signed_pdfs: JSON.stringify([
          { step_id: "step-test", pdf_file_url: legacyReference },
        ]),
      },
    });
    send.mockResolvedValue({});
    await expect(
      service.getPublicSignedPdfUrl({
        client_id: client.id,
        token: "synthetic-link-value",
        step_id: "step-test",
      }),
    ).resolves.toEqual({ signed_url: "https://signed.example.test/object" });
    const getCommand = presign.mock.calls[0][0];
    expect(getCommand).toBeInstanceOf(GetObjectCommand);
    const { Key: objectKey } = getCommand.input;
    expect(objectKey).toMatch(/^legacy\/[a-f0-9]{64}$/);
    expect(objectKey).not.toContain("synthetic");
  });

  it("rejects a valid owned reference from another resource before S3", async () => {
    const foreignReference = privateFileReference(
      `firms/ddcpa/clients/${"c".repeat(32)}/submissions/${"d".repeat(32)}/signed-pdf/${generatedId}.pdf`,
    );
    const { service, send, presign, publicAuthorizer } = setup();
    publicAuthorizer.authorizeActiveSubmission.mockResolvedValue({
      client,
      submission: {
        ...submission,
        signed_pdfs: JSON.stringify([
          { step_id: "step-test", pdf_file_url: foreignReference },
        ]),
      },
    });
    await expect(
      service.getPublicSignedPdfUrl({
        client_id: client.id,
        token: "synthetic-link-value",
        step_id: "step-test",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(send).not.toHaveBeenCalled();
    expect(presign).not.toHaveBeenCalled();
  });

  it("requires the PDF template to be referenced by the pinned questionnaire", async () => {
    const {
      service,
      questionnaireTemplates,
      pdfTemplates,
      presign,
      publicAuthorizer,
    } = setup();
    questionnaireTemplates.get.mockResolvedValue({
      id: "questionnaire-test",
      steps: JSON.stringify([{ id: "step-test", config: {} }]),
    });
    publicAuthorizer.authorizeActiveSubmission.mockResolvedValue({
      client,
      submission: { ...submission, template_id: "questionnaire-test" },
    });
    await expect(
      service.getPublicTemplateFileUrl({
        client_id: client.id,
        token: "synthetic-link-value",
        template_id: "pdf-template-test",
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(pdfTemplates.get).not.toHaveBeenCalled();
    expect(presign).not.toHaveBeenCalled();
  });

  it("bridges a completed pending upload into scoped CPA and public template reads", async () => {
    const {
      service,
      send,
      presign,
      pdfTemplates,
      questionnaireTemplates,
      publicAuthorizer,
    } = setup();
    const fileReference = templateReference();
    let mirroredRecord: Record<string, unknown> | undefined;
    pdfTemplates.mirrorFile.mockImplementation(async (input) => {
      mirroredRecord = {
        id: input.id,
        name: input.name,
        file_reference: input.fileReference,
        is_active: input.isActive,
        record_type: "PdfTemplate",
        _version: 1,
        created_date: input.occurredAt,
        updated_date: input.occurredAt,
      };
      return mirroredRecord;
    });
    pdfTemplates.get.mockImplementation(async () => mirroredRecord);
    questionnaireTemplates.get.mockResolvedValue({
      id: "questionnaire-test",
      steps: JSON.stringify([
        { id: "step-test", type: "pdf", config: { pdf_template_id: "template-test" } },
      ]),
    });
    publicAuthorizer.authorizeActiveSubmission.mockResolvedValue({
      client,
      submission: { ...submission, template_id: "questionnaire-test" },
    });
    send.mockResolvedValue({
      ContentType: "application/pdf",
      Metadata: {
        purpose: "pdf_template",
        "owner-hash": ownerKeyPart("pending"),
      },
    });

    await expect(
      service.mirrorCpaTemplateFile(
        {
          template_id: "template-test",
          file_reference: fileReference,
          name: "Synthetic template",
          is_active: true,
        },
        actor,
      ),
    ).resolves.toEqual({ template_id: "template-test", mirrored: true });
    await expect(
      service.getCpaTemplateFileUrl("template-test", actor),
    ).resolves.toEqual({ signed_url: "https://signed.example.test/object" });
    await expect(
      service.getPublicTemplateFileUrl({
        client_id: client.id,
        token: "synthetic-link-value",
        template_id: "template-test",
      }),
    ).resolves.toEqual({ signed_url: "https://signed.example.test/object" });
    expect(pdfTemplates.mirrorFile).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "template-test",
        fileReference,
        actorId: actor.userId,
      }),
    );
    expect(presign).toHaveBeenCalledTimes(2);
  });

  it("removes the delete marker when journal evidence fails", async () => {
    const { service, send, journal } = setup();
    send
      .mockResolvedValueOnce({
        ContentLength: 4,
        ContentType: "application/pdf",
        VersionId: "old-version",
      })
      .mockResolvedValueOnce({ DeleteMarker: true, VersionId: "marker-version" })
      .mockResolvedValueOnce({});
    journal.commitFileOperation.mockRejectedValue(
      new Error("synthetic journal failure"),
    );
    await expect(
      service.deleteOwnedFile({
        reference: ownedReference(),
        ownerType: "submission",
        ownerId: submission.id,
        actor,
        requestId: "request-test",
      }),
    ).rejects.toThrow("synthetic journal failure");
    const restore = send.mock.calls[2][0];
    expect(restore).toBeInstanceOf(DeleteObjectCommand);
    expect(restore.input.VersionId).toBe("marker-version");
  });

  it("records bounded reconciliation evidence when delete-marker restoration also fails", async () => {
    const { service, send, journal } = setup();
    send
      .mockResolvedValueOnce({
        ContentLength: 4,
        ContentType: "application/pdf",
        VersionId: "old-version",
      })
      .mockResolvedValueOnce({ DeleteMarker: true, VersionId: "marker-version" })
      .mockRejectedValueOnce(Object.assign(new Error("synthetic restore failure"), {
        name: "ServiceUnavailable",
      }));
    journal.commitFileOperation.mockRejectedValue(
      Object.assign(new Error("synthetic journal failure"), { name: "InternalError" }),
    );

    await expect(
      service.deleteOwnedFile({
        reference: ownedReference(),
        ownerType: "submission",
        ownerId: submission.id,
        actor,
        requestId: "request-test",
      }),
    ).rejects.toThrow("synthetic journal failure");
    expect(journal.recordFileReconciliation).toHaveBeenCalledWith({
      actorId: actor.userId,
      requestId: "request-test",
      operationId: expect.stringMatching(/^file-delete-/),
      receiptKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      referenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      deleteMarkerVersionId: "marker-version",
      journalFailureName: "InternalError",
      restorationFailureName: "ServiceUnavailable",
    });
    expect(
      JSON.stringify(journal.recordFileReconciliation.mock.calls[0][0]),
    ).not.toContain("private://");
  });

  it("replays a journaled delete without touching S3", async () => {
    const { service, send, journal } = setup();
    journal.getFileOperationReceipt.mockResolvedValue({
      file_uri: ownedReference(),
    });
    await expect(
      service.deleteOwnedFile({
        reference: ownedReference(),
        ownerType: "submission",
        ownerId: submission.id,
        actor,
        requestId: "request-retry",
      }),
    ).resolves.toEqual({ deleted: true, replayed: true });
    expect(send).not.toHaveBeenCalled();
  });
});

describe("FileService ZIP jobs", () => {
  it("rejects an empty server-derived inventory before writing a job", async () => {
    const { service, send } = setup();
    await expect(service.requestZipDownload(submission.id, actor)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("writes only server-derived inventory and binds the job to the actor", async () => {
    const submissions = {
      get: vi.fn().mockResolvedValue({
        ...submission,
        responses: JSON.stringify({
          "step-test": {
            answer: true,
            files: ["private://synthetic/source.pdf"],
            file_names: ["source.pdf"],
          },
        }),
      }),
    } as unknown as SubmissionRepository;
    const { service, send, questionnaireTemplates } = setup({ submissions });
    questionnaireTemplates.latestActive.mockResolvedValue({
      id: "questionnaire-test",
      steps: JSON.stringify([{ id: "step-test", title: "Document" }]),
    });
    send.mockResolvedValue({});

    await expect(service.requestZipDownload(submission.id, actor)).resolves.toEqual({
      job_id: generatedId,
      status: "pending",
    });
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutObjectCommand);
    const written = JSON.parse(String(command.input.Body));
    expect(written).toMatchObject({
      actor_id: actor.userId,
      submission_id: submission.id,
      client_id: client.id,
    });
    expect(written.entries).toEqual([
      { key: expect.stringMatching(/^legacy\/[a-f0-9]{64}$/), name: "Document_1.pdf" },
    ]);
  });

  it("returns a short-lived result only for the requesting actor and submission", async () => {
    const { service, send, presign } = setup();
    const manifest = {
      version: 1,
      job_id: generatedId,
      actor_id: actor.userId,
      submission_id: submission.id,
      client_id: client.id,
      archive_name: "Synthetic Client.zip",
      created_at: "2026-01-01T00:00:00.000Z",
      expires_at: "2026-01-01T01:00:00.000Z",
      entries: [{ key: `legacy/${"a".repeat(64)}`, name: "Document_1.pdf" }],
    };
    const status = {
      version: 1,
      job_id: generatedId,
      state: "ready",
      result_key: `zip-jobs/results/${generatedId}.zip`,
      completed_at: "2026-01-01T00:01:00.000Z",
    };
    send
      .mockResolvedValueOnce({ Body: { transformToString: async () => JSON.stringify(manifest) } })
      .mockResolvedValueOnce({ Body: { transformToString: async () => JSON.stringify(status) } });

    await expect(
      service.getZipDownloadStatus(submission.id, generatedId, actor),
    ).resolves.toMatchObject({
      status: "ready",
      download_name: "Synthetic Client.zip",
      signed_url: "https://signed.example.test/object",
    });
    expect(presign.mock.calls[0][1]).toBe(3600);
  });
});
