import { describe, expect, it, vi } from "vitest";

import type { ClientRepository } from "../repositories/client";
import type { SubmissionRepository } from "../repositories/submission";
import type { ChangeJournalService } from "../services/change-journal";
import { EntityService } from "../services/entities";

const actor = {
  userId: "user-1",
  email: "admin@example.test",
  fullName: "Invented Admin",
  cognitoSubject: "subject-1",
  role: "admin" as const,
};

function clientRecord() {
  return {
    id: "client-1",
    full_name: "Invented Client",
    token: "old-server-token-1234",
    status: "pending" as const,
    record_type: "Client" as const,
    _version: 3,
    created_date: "2026-01-01T00:00:00.000Z",
    updated_date: "2026-01-01T00:00:00.000Z",
  };
}

function submissionRecord() {
  return {
    id: "submission-1",
    client_id: "client-1",
    tax_year: 2025,
    is_archived: true,
    responses: '{"spacing":"preserved"}',
    record_type: "Submission" as const,
    _version: 2,
    created_date: "2026-01-01T00:00:00.000Z",
    updated_date: "2026-01-01T00:00:00.000Z",
  };
}

function service(options: {
  client?: ReturnType<typeof clientRecord>;
  submission?: ReturnType<typeof submissionRecord>;
}) {
  const commit = vi.fn().mockResolvedValue([]);
  const clients = {
    tableName: "ClientTable.test",
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(options.client),
  } as unknown as ClientRepository;
  const submissions = {
    tableName: "SubmissionTable.test",
    query: vi.fn().mockResolvedValue([]),
    get: vi.fn().mockResolvedValue(options.submission),
  } as unknown as SubmissionRepository;
  return {
    commit,
    value: new EntityService({
      clients,
      submissions,
      journal: { commit } as unknown as ChangeJournalService,
      clock: () => new Date("2026-02-01T00:00:00.000Z"),
      idGenerator: () => "client-created",
      tokenGenerator: () => "server-generated-token-0123456789",
      operationIdGenerator: () => "operation-1",
    }),
  };
}

describe("EntityService", () => {
  it("ignores the browser token and creates Client plus journal atomically", async () => {
    const { value, commit } = service({});
    const created = await value.createClient(actor, "request-1", {
      full_name: "Invented Client",
      token: "weak-browser-token",
    });
    expect(created).toMatchObject({
      id: "client-created",
      token: "server-generated-token-0123456789",
      status: "pending",
      pricing: 1500,
    });
    expect(created).not.toHaveProperty("_version");
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].actorId).toBe("user-1");
    expect(commit.mock.calls[0][0].businessActions).toHaveLength(1);
    expect(commit.mock.calls[0][0].changes[0]).toMatchObject({
      operationType: "create",
      before: null,
    });
  });

  it("rotates a token server-side under the existing version condition", async () => {
    const { value, commit } = service({ client: clientRecord() });
    const updated = await value.rotateClientToken(actor, "request-1", "client-1");
    expect(updated.token).toBe("server-generated-token-0123456789");
    expect(commit.mock.calls[0][0].businessActions[0].Put).toMatchObject({
      ConditionExpression: "#version = :expected_version",
      ExpressionAttributeValues: { ":expected_version": 3 },
    });
  });

  it("returns 404 without journal activity for a missing record", async () => {
    const { value, commit } = service({});
    await expect(
      value.updateClient(actor, "request-1", "missing", { notes: "Updated" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(commit).not.toHaveBeenCalled();
  });

  it("maintains the active client/year guard in the journal transaction", async () => {
    const { value, commit } = service({ submission: submissionRecord() });
    const updated = await value.updateSubmission(
      actor,
      "request-1",
      "submission-1",
      { is_archived: false },
    );
    expect(updated.responses).toBe('{"spacing":"preserved"}');
    const actions = commit.mock.calls[0][0].businessActions;
    expect(actions).toHaveLength(2);
    expect(actions[1].Put.Item).toMatchObject({
      id: "!ACTIVE#client-1#2025",
      submission_id: "submission-1",
    });
  });
});
