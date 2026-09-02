import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it, vi } from "vitest";

import type { UserRepository } from "../repositories/user";
import type { ChangeJournalService } from "../services/change-journal";
import { UserService } from "../services/users";

const actor = {
  userId: "user-1",
  email: "admin@example.test",
  fullName: "Invented Admin",
  cognitoSubject: "subject-1",
  role: "admin" as const,
};

function userRecord() {
  return {
    id: "user-1",
    full_name: "Invented Admin",
    email: "admin@example.test",
    role: "admin" as const,
    drive_base_path: "Root",
    cognito_sub: "subject-1",
    record_type: "User" as const,
    _version: 1,
    created_date: "2026-01-01T00:00:00.000Z",
    updated_date: "2026-01-01T00:00:00.000Z",
  };
}

function setup(commit = vi.fn().mockResolvedValue([])) {
  const users = {
    tableName: "UserTable.test",
    get: vi.fn().mockResolvedValue(userRecord()),
    list: vi.fn().mockResolvedValue([userRecord()]),
    findByEmail: vi.fn().mockResolvedValue(undefined),
  } as unknown as UserRepository;
  const send = vi.fn().mockResolvedValue({
    User: { Attributes: [{ Name: "sub", Value: "subject-invited" }] },
  });
  const logger = { error: vi.fn() };
  return {
    users,
    send,
    logger,
    value: new UserService({
      users,
      journal: { commit } as unknown as ChangeJournalService,
      cognito: { send },
      userPoolId: "pool.test",
      clock: () => new Date("2026-02-01T00:00:00.000Z"),
      idGenerator: () => "user-invited",
      operationIdGenerator: () => "operation-1",
      logger,
    }),
  };
}

describe("UserService", () => {
  it("updates only the linked current profile through the journal", async () => {
    const commit = vi.fn().mockResolvedValue([]);
    const { value } = setup(commit);
    const updated = await value.updateMe(actor, "request-1", {
      drive_base_path: "New Root",
    });
    expect(updated.drive_base_path).toBe("New Root");
    expect(updated).not.toHaveProperty("cognito_sub");
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0].actorId).toBe("user-1");
  });

  it("creates Cognito first, then atomically persists User plus journal", async () => {
    const commit = vi.fn().mockResolvedValue([]);
    const { value, send } = setup(commit);
    const invited = await value.invite(actor, "request-1", {
      email: "invitee@example.test",
      role: "admin",
    });
    expect(send.mock.calls[0][0]).toBeInstanceOf(AdminCreateUserCommand);
    expect(commit).toHaveBeenCalledOnce();
    expect(invited).toMatchObject({
      id: "user-invited",
      email: "invitee@example.test",
      role: "admin",
    });
    expect(invited).not.toHaveProperty("cognito_sub");
  });

  it("compensates Cognito when the Dynamo+journal transaction fails", async () => {
    const commit = vi.fn().mockRejectedValue(new Error("transaction failed"));
    const { value, send } = setup(commit);
    await expect(
      value.invite(actor, "request-1", {
        email: "invitee@example.test",
        role: "admin",
      }),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(send.mock.calls[1][0]).toBeInstanceOf(AdminDeleteUserCommand);
  });

  it("returns an already-linked matching invitation idempotently", async () => {
    const { value, users, send } = setup();
    vi.mocked(users.findByEmail).mockResolvedValue(userRecord());
    await expect(
      value.invite(actor, "request-1", {
        email: "admin@example.test",
        role: "admin",
      }),
    ).resolves.toMatchObject({ id: "user-1" });
    expect(send).not.toHaveBeenCalled();
  });
});
