import { describe, expect, it, vi } from "vitest";

import type { CpaActor } from "../auth/cpa-context";
import type { PdfTemplateRepository } from "../repositories/pdf-template";
import type { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";
import type { ChangeJournalService } from "../services/change-journal";
import { TemplateService } from "../services/templates";

const actor: CpaActor = {
  userId: "user-1",
  email: "admin@example.test",
  fullName: "Invented Admin",
  cognitoSubject: "subject-1",
  role: "admin",
};
const now = "2026-09-02T12:00:00.000Z";

function questionnaire() {
  return {
    id: "questionnaire-2",
    version: 2,
    is_active: true,
    steps: '[{"id":"step-1","title":"Step","question":"Question?"}]',
    record_type: "QuestionnaireTemplate" as const,
    _version: 4,
    created_date: now,
    updated_date: now,
  };
}

function pdfTemplate(overrides: Record<string, unknown> = {}) {
  const fileReference = "private://files/firms/ddcpa/templates/pending/pdf-template/file.pdf";
  return {
    id: "pdf-1",
    name: "Form",
    template_json: JSON.stringify({
      basePdf: { __type: "file_uri", value: fileReference },
      schemas: [[]],
      fieldMapping: { name: "full_name" },
    }),
    file_reference: fileReference,
    is_active: true,
    record_type: "PdfTemplate" as const,
    _version: 1,
    created_date: now,
    updated_date: now,
    ...overrides,
  };
}

function setup() {
  const active = questionnaire();
  const questionnaireTemplates = {
    tableName: "Questionnaire.test",
    client: { send: vi.fn() },
    getActiveGuard: vi.fn().mockResolvedValue({
      id: "!ACTIVE",
      record_type: "!ACTIVE_GUARD",
      active_template_id: active.id,
      active_version: active.version,
      _version: 3,
    }),
    get: vi.fn().mockResolvedValue(active),
    history: vi.fn().mockResolvedValue([active]),
  } as unknown as QuestionnaireTemplateRepository;
  const pdfTemplates = {
    tableName: "Pdf.test",
    list: vi.fn().mockResolvedValue([pdfTemplate()]),
    get: vi.fn().mockResolvedValue(pdfTemplate()),
  } as unknown as PdfTemplateRepository;
  const commit = vi.fn().mockResolvedValue([]);
  const validateCpaTemplateReference = vi.fn().mockResolvedValue(undefined);
  const service = new TemplateService({
    questionnaireTemplates,
    pdfTemplates,
    journal: { commit } as unknown as ChangeJournalService,
    files: { validateCpaTemplateReference },
    clock: () => new Date(now),
    idGenerator: () => "generated-id",
    operationIdGenerator: () => "operation-1",
  });
  return { service, commit, validateCpaTemplateReference, pdfTemplates };
}

describe("TemplateService", () => {
  it("atomically deactivates the guarded questionnaire and creates the next version", async () => {
    const { service, commit } = setup();
    const result = await service.saveQuestionnaire(
      { steps: [{ id: "step-2", title: "Next", question: "Continue?" }] },
      actor,
      "request-1",
    );
    expect(result.template).toMatchObject({ id: "generated-id", version: 3 });
    const request = commit.mock.calls[0][0];
    expect(request.businessActions).toHaveLength(3);
    expect(request.businessActions[0].Put.Item).toMatchObject({
      id: "questionnaire-2",
      is_active: false,
      _version: 5,
    });
    expect(request.businessActions[2].Put.Item).toMatchObject({
      id: "!ACTIVE",
      active_template_id: "generated-id",
      active_version: 3,
      _version: 4,
    });
    expect(request.changes[1].after).toMatchObject({
      created_by_email: actor.email,
      version: 3,
    });
  });

  it("round-trips PDF JSON, validates its private pointer once, and archives softly", async () => {
    const { service, commit, validateCpaTemplateReference } = setup();
    const templateJson = pdfTemplate().template_json;
    const created = await service.createPdfTemplate(
      { name: "Form", template_json: templateJson, is_active: true },
      actor,
      "request-2",
    );
    expect(created.template_json).toBe(templateJson);
    expect(validateCpaTemplateReference).toHaveBeenCalledWith(
      {
        templateId: "generated-id",
        fileReference: pdfTemplate().file_reference,
      },
      actor,
    );
    await expect(
      service.archivePdfTemplate("pdf-1", { revision: 1 }, actor, "request-3"),
    ).resolves.toEqual({ id: "pdf-1", deleted: true });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[1][0].businessActions[0].Put.Item).toMatchObject({
      id: "pdf-1",
      is_active: false,
      _version: 2,
    });
  });

  it("rejects a stale PDF template update without journaling", async () => {
    const { service, commit } = setup();
    await expect(
      service.updatePdfTemplate(
        "pdf-1",
        { name: "Stale edit", revision: 2 },
        actor,
        "request-stale-update",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { reload: true },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a stale PDF template archive without journaling", async () => {
    const { service, commit } = setup();
    await expect(
      service.archivePdfTemplate(
        "pdf-1",
        { revision: 2 },
        actor,
        "request-stale-archive",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { reload: true },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("hides archived PDF templates from detail reads", async () => {
    const { service, pdfTemplates } = setup();
    vi.mocked(pdfTemplates.get).mockResolvedValue(pdfTemplate({ is_active: false }));
    await expect(service.getPdfTemplate("pdf-1")).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
