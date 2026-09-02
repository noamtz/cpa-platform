import { describe, expect, it, vi } from "vitest";

import type { CpaActor } from "../auth/cpa-context";
import type { ClientRepository } from "../repositories/client";
import type { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";
import type { SubmissionRepository } from "../repositories/submission";
import type { ChangeJournalService } from "../services/change-journal";
import { CpaWorkflowService } from "../services/cpa-workflows";

const actor: CpaActor = {
  userId: "user-1",
  email: "admin@example.test",
  fullName: "Invented Admin",
  cognitoSubject: "subject-1",
  role: "admin",
};
const now = "2026-09-02T12:00:00.000Z";

function client(overrides: Record<string, unknown> = {}) {
  return {
    id: "client-1",
    full_name: "Invented Client",
    tax_year: 2026,
    status: "in_progress" as const,
    record_type: "Client" as const,
    _version: 3,
    created_date: now,
    updated_date: now,
    ...overrides,
  };
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    id: "submission-1",
    client_id: "client-1",
    tax_year: 2026,
    is_archived: false,
    responses: "{}",
    cpa_audit_log: "not-json",
    template_id: "questionnaire-1",
    template_version: 1,
    record_type: "Submission" as const,
    _version: 5,
    created_date: now,
    updated_date: now,
    ...overrides,
  };
}

function setup(active = submission(), guarded = true) {
  const clients = {
    tableName: "Client.test",
    get: vi.fn().mockResolvedValue(client()),
  } as unknown as ClientRepository;
  const submissions = {
    tableName: "Submission.test",
    get: vi.fn().mockResolvedValue(active),
    getActiveForClientYear: vi.fn().mockResolvedValue({
      conflict: false,
      record: active,
      guard: guarded ? { submission_id: active?.id } : undefined,
    }),
  } as unknown as SubmissionRepository;
  const template = {
    id: "questionnaire-2",
    version: 2,
    is_active: true,
    steps: "[]",
    record_type: "QuestionnaireTemplate" as const,
    _version: 1,
    created_date: now,
    updated_date: now,
  };
  const templates = {
    tableName: "Questionnaire.test",
    client: { send: vi.fn() },
    getActiveGuard: vi.fn().mockResolvedValue({
      id: "!ACTIVE",
      record_type: "!ACTIVE_GUARD",
      active_template_id: template.id,
      active_version: template.version,
      _version: 1,
    }),
    get: vi.fn().mockResolvedValue(template),
    history: vi.fn().mockResolvedValue([template]),
  } as unknown as QuestionnaireTemplateRepository;
  const commit = vi.fn().mockResolvedValue([]);
  const service = new CpaWorkflowService({
    clients,
    submissions,
    templates,
    journal: { commit } as unknown as ChangeJournalService,
    clock: () => new Date(now),
    idGenerator: () => "submission-created",
    operationIdGenerator: () => "operation-1",
  });
  return { service, clients, submissions, commit };
}

describe("CpaWorkflowService", () => {
  it("saves with revision control, fail-soft audit history, and server template pinning", async () => {
    const { service, commit } = setup();
    const result = await service.saveSubmission(
      {
        client_id: "client-1",
        submission_id: "submission-1",
        revision: 5,
        step_id: "step-1",
        data: {
          responses: '{"step-1":{"answer":true}}',
          template_id: "browser-template",
          template_version: 999,
        },
        completed: false,
      },
      actor,
      "request-1",
    );
    expect(result.submission).toMatchObject({
      id: "submission-1",
      revision: 6,
      template_id: "questionnaire-2",
      template_version: 2,
    });
    expect(result.audit_entry).toEqual({
      cpa_email: actor.email,
      cpa_name: actor.fullName,
      step_id: "step-1",
      timestamp: now,
      action: "fill",
    });
    expect(commit.mock.calls[0][0].businessActions).toHaveLength(3);
    expect(commit.mock.calls[0][0].businessActions[0].ConditionCheck).toMatchObject({
      Key: { id: "!ACTIVE#client-1#2026" },
    });
    expect(JSON.parse(commit.mock.calls[0][0].changes[0].after.cpa_audit_log)).toEqual([
      result.audit_entry,
    ]);
  });

  it("rejects stale revisions without journaling", async () => {
    const { service, commit } = setup();
    await expect(
      service.saveSubmission(
        {
          client_id: "client-1",
          submission_id: "submission-1",
          revision: 4,
          data: { responses: "{}" },
          completed: false,
        },
        actor,
        "request-1",
      ),
    ).rejects.toMatchObject({ statusCode: 409, details: { reload: true } });
    expect(commit).not.toHaveBeenCalled();
  });

  it("initializes a missing active guard inside an existing-save transaction", async () => {
    const { service, commit } = setup(submission(), false);
    await service.saveSubmission(
      {
        client_id: "client-1",
        submission_id: "submission-1",
        revision: 5,
        data: { responses: "{}" },
        completed: false,
      },
      actor,
      "request-guard",
    );
    expect(commit.mock.calls[0][0].businessActions[0].Put).toMatchObject({
      ConditionExpression: "attribute_not_exists(#id)",
      Item: {
        id: "!ACTIVE#client-1#2026",
        submission_id: "submission-1",
      },
    });
  });

  it("swaps an archived and active submission plus its guard atomically", async () => {
    const archived = submission({ id: "submission-old", is_archived: true, _version: 2 });
    const current = submission();
    const { service, submissions, commit } = setup(current);
    vi.mocked(submissions.get).mockImplementation(async (id: string) =>
      id === archived.id ? archived : current,
    );
    await service.restoreSubmission(
      archived.id,
      { conflicting_submission_id: current.id },
      actor,
      "request-2",
    );
    const request = commit.mock.calls[0][0];
    expect(request.businessActions).toHaveLength(3);
    expect(request.businessActions[2].Put).toMatchObject({
      ConditionExpression: "#submission_id = :expected_submission_id",
      Item: { submission_id: archived.id },
    });
    expect(request.changes).toHaveLength(2);
  });

  it("changes tax year and paired workflow status with server-derived records", async () => {
    const { service, clients, commit } = setup();
    await service.changeTaxYear(
      "client-1",
      { tax_year: 2025 },
      actor,
      "request-3",
    );
    expect(commit.mock.calls[0][0].changes[0].after).toMatchObject({
      tax_year: 2025,
      status: "pending",
    });

    vi.mocked(clients.get).mockResolvedValue(client());
    await service.transitionStatus(
      "submission-1",
      { client_id: "client-1", status: "reviewed" },
      actor,
      "request-4",
    );
    expect(commit.mock.calls[1][0].changes.map((change: { entityType: string }) => change.entityType)).toEqual([
      "Client",
      "Submission",
    ]);
  });
});
