import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { SubmissionRepository } from "../repositories/submission";

function submission(id: string, createdDate: string) {
  return {
    id,
    client_id: "client-1",
    tax_year: 2025,
    is_archived: false,
    responses: '{"preserved":true}',
    record_type: "Submission",
    _version: 1,
    created_date: createdDate,
    updated_date: createdDate,
  };
}

describe("SubmissionRepository", () => {
  it("uses byClientYear and restores requested creation order", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        submission("submission-old", "2026-01-01T00:00:00.000Z"),
        submission("submission-new", "2026-02-01T00:00:00.000Z"),
      ],
    });
    const repository = new SubmissionRepository(
      { send },
      "SubmissionTable.test",
    );
    const records = await repository.query(
      { client_id: "client-1", tax_year: 2025 },
      "-created_date",
      200,
    );
    expect(records.map(({ id }) => id)).toEqual([
      "submission-new",
      "submission-old",
    ]);
    const command = send.mock.calls[0][0];
    expect(command).toBeInstanceOf(QueryCommand);
    expect(command.input.IndexName).toBe("byClientYear");
    expect(records[0].responses).toBe('{"preserved":true}');
  });
});
