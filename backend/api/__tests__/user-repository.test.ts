import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { UserRepository } from "../repositories/user";

function user(id: string) {
  return {
    id,
    email: `${id}@example.test`,
    full_name: `Invented ${id}`,
    role: "admin",
    cognito_sub: "subject-1",
    record_type: "User",
    _version: 1,
    created_date: "2026-01-01T00:00:00.000Z",
    updated_date: "2026-01-01T00:00:00.000Z",
  };
}

describe("UserRepository", () => {
  it("returns every duplicate subject link so authorization can fail closed", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [user("user-1"), user("user-2")],
    });
    const repository = new UserRepository({ send }, "UserTable.test");
    await expect(repository.findByCognitoSubject("subject-1")).resolves.toHaveLength(2);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input.IndexName).toBe("byCognitoSubject");
    expect(command.input.Limit).toBeLessThanOrEqual(200);
  });

  it("uses the listing index for bounded team reads", async () => {
    const send = vi.fn().mockResolvedValue({ Items: [user("user-1")] });
    const repository = new UserRepository({ send }, "UserTable.test");
    await repository.list("-created_date", 200);
    expect(send.mock.calls[0][0].input.IndexName).toBe("byCreatedDate");
  });
});
