import { describe, expect, it, vi } from "vitest";

import { conflict } from "../core/errors";
import type { ClientRepository } from "../repositories/client";
import type { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";
import type { SubmissionRepository } from "../repositories/submission";
import type { ChangeJournalService } from "../services/change-journal";
import {
  PublicQuestionnaireService,
  tokenMatches,
} from "../services/public-questionnaire";

const credentials = { client_id: "client-1", token: "public-link-value" };
const now = "2026-08-24T10:00:00.000Z";

function clientRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "client-1",
    full_name: "Invented Client",
    token: credentials.token,
    tax_year: 2025,
    status: "pending" as const,
    is_archived: false,
    record_type: "Client" as const,
    _version: 4,
    created_date: "2026-01-01T00:00:00.000Z",
    updated_date: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function submissionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "submission-1",
    client_id: "client-1",
    tax_year: 2025,
    responses: '{ "step": { "answer": true } }',
    signed_pdfs: "[]",
    step_completed: 1,
    template_id: "template-2",
    template_version: 2,
    is_archived: false,
    record_type: "Submission" as const,
    _version: 3,
    created_date: "2026-01-01T00:00:00.000Z",
    updated_date: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function templateRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "template-2",
    version: 2,
    is_active: true,
    steps: '[{"id":"step","enabled":true,"order":1}]',
    record_type: "QuestionnaireTemplate" as const,
    _version: 1,
    created_date: "2026-01-01T00:00:00.000Z",
    updated_date: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function setup(options: {
  client?: ReturnType<typeof clientRecord>;
  activeSubmissions?: ReturnType<typeof submissionRecord>[];
  submission?: ReturnType<typeof submissionRecord>;
  activeTemplate?: ReturnType<typeof templateRecord>;
  exactTemplate?: ReturnType<typeof templateRecord>;
  commit?: ReturnType<typeof vi.fn>;
} = {}) {
  const clients = {
    tableName: "ClientTable.test",
    get: vi.fn().mockResolvedValue(options.client),
  } as unknown as ClientRepository;
  const submissions = {
    tableName: "SubmissionTable.test",
    query: vi
      .fn()
      .mockResolvedValue(
        options.activeSubmissions ?? (options.submission ? [options.submission] : []),
      ),
    get: vi.fn().mockResolvedValue(options.submission),
  } as unknown as SubmissionRepository;
  const templates = {
    tableName: "QuestionnaireTemplateTable.test",
    client: { send: vi.fn() },
    getActiveGuard: vi.fn().mockResolvedValue(
      options.activeTemplate
        ? {
            id: "!ACTIVE",
            record_type: "!ACTIVE_GUARD",
            active_template_id: options.activeTemplate.id,
            active_version: options.activeTemplate.version,
            _version: 1,
          }
        : undefined,
    ),
    history: vi.fn().mockResolvedValue(
      options.activeTemplate ? [options.activeTemplate] : [],
    ),
    latestActive: vi.fn().mockResolvedValue(options.activeTemplate),
    get: vi.fn().mockImplementation(async (id: string) =>
      id === options.activeTemplate?.id
        ? options.activeTemplate
        : options.exactTemplate,
    ),
  } as unknown as QuestionnaireTemplateRepository;
  const commit = options.commit ?? vi.fn().mockResolvedValue([]);
  const service = new PublicQuestionnaireService({
    clients,
    submissions,
    templates,
    journal: { commit } as unknown as ChangeJournalService,
    clock: () => new Date(now),
    idGenerator: () => "submission-created",
    operationIdGenerator: () => "operation-1",
  });
  return { clients, submissions, templates, commit, service };
}

describe("PublicQuestionnaireService lookup and token boundary", () => {
  it("compares fixed-length token digests", () => {
    expect(tokenMatches("same", "same")).toBe(true);
    expect(tokenMatches("short", "different-length-value")).toBe(false);
  });

  it.each([
    [undefined, 404],
    [clientRecord({ is_archived: true }), 404],
    [clientRecord({ token: "" }), 403],
    [clientRecord({ token: undefined }), 403],
  ])("rejects missing, archived, or tokenless Clients", async (client, statusCode) => {
    const { service, commit } = setup({ client });
    await expect(service.getClientByToken(credentials)).rejects.toMatchObject({
      statusCode,
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a mismatched token without reading submissions", async () => {
    const { service, submissions, commit } = setup({ client: clientRecord() });
    await expect(
      service.getClientByToken({ ...credentials, token: "wrong" }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(submissions.query).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("returns only the current-year active Submission and redacts Client token", async () => {
    const current = submissionRecord();
    const { service, submissions } = setup({
      client: clientRecord(),
      activeSubmissions: [current],
    });
    const result = await service.getClientByToken(credentials);
    expect(result.client).toMatchObject({ id: "client-1", tax_year: 2025 });
    expect(result.client).not.toHaveProperty("token");
    expect(result.client).not.toHaveProperty("_version");
    expect(result.submission).toMatchObject({ id: "submission-1", _version: 3 });
    expect(submissions.query).toHaveBeenCalledWith(
      { client_id: "client-1", tax_year: 2025, is_archived: false },
      "-created_date",
      1,
    );
  });
});

describe("PublicQuestionnaireService templates", () => {
  it("returns the latest active template with parsed steps", async () => {
    const { service } = setup({
      client: clientRecord(),
      activeTemplate: templateRecord(),
    });
    await expect(
      service.getActiveTemplate(credentials, "request-1"),
    ).resolves.toEqual({
      template: {
        id: "template-2",
        version: 2,
        steps: [{ id: "step", enabled: true, order: 1 }],
        created_at: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("maps malformed stored template JSON to a safe error without mutation", async () => {
    const { service, commit } = setup({
      client: clientRecord(),
      activeTemplate: templateRecord({ steps: "not-json" }),
    });
    await expect(
      service.getActiveTemplate(credentials, "request-1"),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(commit).not.toHaveBeenCalled();
  });

  it("conditionally seeds and journals the source-compatible default", async () => {
    const { service, commit } = setup({ client: clientRecord() });
    const result = await service.getActiveTemplate(credentials, "request-1");
    expect(result.template).toMatchObject({ version: 1 });
    expect(result.template.steps).toHaveLength(6);
    expect(result.template.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ enabled: true }),
      ]),
    );
    expect(result.template.steps.every((step) => step.enabled === true)).toBe(true);
    expect(commit).toHaveBeenCalledOnce();
    const input = commit.mock.calls[0][0];
    expect(input.actorId).toBe("public-client:client-1");
    expect(input.businessActions[0].Put).toMatchObject({
      ConditionExpression: "attribute_not_exists(#id)",
    });
    expect(input.changes[0]).toMatchObject({
      entityType: "QuestionnaireTemplate",
      operationType: "create",
    });
  });

  it("rereads the default-template winner after a create race", async () => {
    const commit = vi.fn().mockRejectedValue(conflict());
    const { service, templates } = setup({
      client: clientRecord(),
      commit,
    });
    vi.mocked(templates.getActiveGuard)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => ({
        id: "!ACTIVE",
        record_type: "!ACTIVE_GUARD",
        active_template_id: "template-2",
        active_version: 2,
        _version: 1,
      }));
    vi.mocked(templates.get).mockResolvedValue(templateRecord());
    await expect(
      service.getActiveTemplate(credentials, "request-1"),
    ).resolves.toMatchObject({ template: { id: "template-2" } });
  });

  it("scopes historical template reads to the completed active Submission", async () => {
    const completed = submissionRecord({ completed_at: now });
    const { service, templates } = setup({
      client: clientRecord(),
      activeSubmissions: [completed],
      exactTemplate: templateRecord(),
    });
    await expect(
      service.getTemplateById({ ...credentials, template_id: "template-2" }),
    ).resolves.toMatchObject({ template: { id: "template-2" } });
    expect(templates.get).toHaveBeenCalledWith("template-2");
  });

  it("does not expose arbitrary or in-progress historical templates", async () => {
    const { service, templates, commit } = setup({
      client: clientRecord(),
      activeSubmissions: [submissionRecord()],
      exactTemplate: templateRecord(),
    });
    await expect(
      service.getTemplateById({ ...credentials, template_id: "template-2" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(templates.get).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe("PublicQuestionnaireService mutation and concurrency", () => {
  it("lazily creates Submission, active guard, Client transition, and journal atomically", async () => {
    const responses = '{ "spacing": { "answer": true } }';
    const { service, commit } = setup({
      client: clientRecord(),
      activeTemplate: templateRecord(),
    });
    const result = await service.updateClientSubmission(
      {
        ...credentials,
        data: {
          responses,
          step_completed: 1,
          template_id: "caller-template-is-overridden",
          template_version: 99,
        },
        completed: false,
      },
      "request-1",
    );
    expect(result.submission).toMatchObject({
      id: "submission-created",
      client_id: "client-1",
      tax_year: 2025,
      template_id: "template-2",
      template_version: 2,
      responses,
      _version: 1,
    });
    const input = commit.mock.calls[0][0];
    expect(input.businessActions).toHaveLength(3);
    expect(input.businessActions[1].Put.Item).toMatchObject({
      id: "!ACTIVE#client-1#2025",
      submission_id: "submission-created",
    });
    expect(input.businessActions[2].Put.Item).toMatchObject({
      status: "in_progress",
      last_activity: now,
      _version: 5,
    });
    expect(input.changes.map((change: { entityType: string }) => change.entityType)).toEqual([
      "Submission",
      "Client",
    ]);
  });

  it("maps a first-save guard race to reload-safe conflict without retry", async () => {
    const commit = vi.fn().mockRejectedValue(conflict());
    const { service } = setup({
      client: clientRecord(),
      activeTemplate: templateRecord(),
      commit,
    });
    await expect(
      service.updateClientSubmission(
        { ...credentials, data: { responses: "{}" }, completed: false },
        "request-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "submission_conflict",
      details: { reload: true },
    });
    expect(commit).toHaveBeenCalledOnce();
  });

  it.each([
    [undefined],
    [submissionRecord({ is_archived: true })],
    [submissionRecord({ client_id: "client-2" })],
    [submissionRecord({ tax_year: 2024 })],
  ])("rejects missing, archived, cross-client, and cross-year IDs before write", async (submission) => {
    const { service, commit } = setup({
      client: clientRecord(),
      submission,
    });
    await expect(
      service.updateClientSubmission(
        {
          ...credentials,
          submission_id: "submission-1",
          _version: 3,
          data: { responses: "{}" },
          completed: false,
        },
        "request-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "submission_archived",
      details: { reload: true },
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a stale browser revision before transaction", async () => {
    const { service, commit } = setup({
      client: clientRecord(),
      submission: submissionRecord({ _version: 4 }),
    });
    await expect(
      service.updateClientSubmission(
        {
          ...credentials,
          submission_id: "submission-1",
          _version: 3,
          data: { responses: "{}" },
          completed: false,
        },
        "request-1",
      ),
    ).rejects.toMatchObject({ code: "submission_conflict" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a replaced ID when another current-year Submission is active", async () => {
    const oldSubmission = submissionRecord();
    const replacement = submissionRecord({ id: "submission-2", _version: 1 });
    const { service, commit } = setup({
      client: clientRecord(),
      submission: oldSubmission,
      activeSubmissions: [replacement],
    });
    await expect(
      service.updateClientSubmission(
        {
          ...credentials,
          submission_id: "submission-1",
          _version: 3,
          data: { responses: "{}" },
          completed: false,
        },
        "request-1",
      ),
    ).rejects.toMatchObject({ code: "submission_archived" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("replaces caller template metadata with the authorized active template", async () => {
    const { service, commit } = setup({
      client: clientRecord({ status: "in_progress" }),
      submission: submissionRecord(),
      activeTemplate: templateRecord(),
    });
    const result = await service.updateClientSubmission(
      {
        ...credentials,
        submission_id: "submission-1",
        _version: 3,
        data: {
          responses: "{}",
          template_id: "arbitrary-template",
          template_version: 999,
        },
        completed: false,
      },
      "request-1",
    );
    expect(result.submission).toMatchObject({
      template_id: "template-2",
      template_version: 2,
    });
    expect(commit.mock.calls[0][0].businessActions[0].Put.Item).toMatchObject({
      template_id: "template-2",
      template_version: 2,
    });
  });

  it("increments sequential revisions and preserves signing JSON exactly", async () => {
    const signedPdfs = '[ { "step_id": "pdf-1", "incomplete": false } ]';
    const commit = vi.fn().mockResolvedValue([]);
    const { service, submissions } = setup({
      client: clientRecord({ status: "in_progress" }),
      submission: submissionRecord(),
      commit,
    });
    const first = await service.updateClientSubmission(
      {
        ...credentials,
        submission_id: "submission-1",
        _version: 3,
        data: { signed_pdfs: signedPdfs },
        completed: false,
      },
      "request-1",
    );
    vi.mocked(submissions.get).mockResolvedValue(
      submissionRecord({ _version: 4, signed_pdfs: signedPdfs }),
    );
    const second = await service.updateClientSubmission(
      {
        ...credentials,
        submission_id: "submission-1",
        _version: 4,
        data: { responses: '{"next":true}' },
        completed: false,
      },
      "request-2",
    );
    expect(first.submission).toMatchObject({ _version: 4, signed_pdfs: signedPdfs });
    expect(second.submission).toMatchObject({ _version: 5 });
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[0][0].businessActions).toHaveLength(1);
  });

  it("preserves completion timestamp and atomically transitions Client", async () => {
    const { service, commit } = setup({
      client: clientRecord({ status: "in_progress" }),
      submission: submissionRecord(),
      activeTemplate: templateRecord(),
    });
    const result = await service.updateClientSubmission(
      {
        ...credentials,
        submission_id: "submission-1",
        _version: 3,
        data: {
          responses: "{}",
          completed_at: "2026-08-24T09:59:00.000Z",
          step_completed: 7,
          template_id: "template-2",
          template_version: 2,
        },
        completed: true,
      },
      "request-1",
    );
    expect(result.submission).toMatchObject({
      completed_at: "2026-08-24T09:59:00.000Z",
      step_completed: 7,
      _version: 4,
    });
    const input = commit.mock.calls[0][0];
    expect(input.businessActions).toHaveLength(2);
    expect(input.businessActions[1].Put.Item).toMatchObject({
      status: "completed",
      last_activity: now,
    });
    expect(input.changes).toHaveLength(2);
  });

  it("does not rewrite Client activity for an ordinary in-progress save", async () => {
    const { service, commit } = setup({
      client: clientRecord({ status: "in_progress" }),
      submission: submissionRecord(),
    });
    await service.updateClientSubmission(
      {
        ...credentials,
        submission_id: "submission-1",
        _version: 3,
        data: { responses: "{}" },
        completed: false,
      },
      "request-1",
    );
    expect(commit.mock.calls[0][0].businessActions).toHaveLength(1);
    expect(commit.mock.calls[0][0].changes).toHaveLength(1);
  });

  it.each(["ready_for_ira", "reviewed", "completed"] as const)(
    "preserves source behavior by returning a %s Client to in_progress on an ordinary edit",
    async (status) => {
      const { service, commit } = setup({
        client: clientRecord({ status }),
        submission: submissionRecord(
          status === "completed" ? { completed_at: "2026-08-20T00:00:00.000Z" } : {},
        ),
      });
      await service.updateClientSubmission(
        {
          ...credentials,
          submission_id: "submission-1",
          _version: 3,
          data: { responses: "{}" },
          completed: false,
        },
        "request-1",
      );
      expect(commit.mock.calls[0][0].businessActions[1].Put.Item).toMatchObject({
        status: "in_progress",
        last_activity: now,
      });
    },
  );

  it("refreshes Client activity for a repeated completed transition", async () => {
    const { service, commit } = setup({
      client: clientRecord({ status: "completed" }),
      submission: submissionRecord({ completed_at: "2026-08-20T00:00:00.000Z" }),
    });
    await service.updateClientSubmission(
      {
        ...credentials,
        submission_id: "submission-1",
        _version: 3,
        data: {
          responses: "{}",
          completed_at: "2026-08-24T09:59:00.000Z",
          template_id: "template-2",
          template_version: 2,
        },
        completed: true,
      },
      "request-1",
    );
    expect(commit.mock.calls[0][0].businessActions[1].Put.Item).toMatchObject({
      status: "completed",
      last_activity: now,
      _version: 5,
    });
  });

  it("maps a transaction-time stale condition to reload without retry", async () => {
    const commit = vi.fn().mockRejectedValue(conflict());
    const { service } = setup({
      client: clientRecord({ status: "in_progress" }),
      submission: submissionRecord(),
      commit,
    });
    await expect(
      service.updateClientSubmission(
        {
          ...credentials,
          submission_id: "submission-1",
          _version: 3,
          data: { responses: "{}" },
          completed: false,
        },
        "request-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "submission_conflict",
      details: { reload: true },
    });
    expect(commit).toHaveBeenCalledOnce();
  });
});
