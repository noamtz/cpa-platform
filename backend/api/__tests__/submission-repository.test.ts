import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { SubmissionRepository } from "../repositories/submission";

function submission(id: string, createdDate: string, taxYear = 2025) {
  return {
    id,
    client_id: "client-1",
    tax_year: taxYear,
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
        {
          id: "!ACTIVE#client-1#2025",
          client_id: "client-1",
          tax_year: 2025,
          record_type: "!ACTIVE_GUARD",
        },
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
    expect(command.input.FilterExpression).toBe(
      "#query_record_type = :query_record_type",
    );
    expect(command.input.ExpressionAttributeValues).toMatchObject({
      ":query_record_type": "Submission",
    });
    expect(records[0].responses).toBe('{"preserved":true}');
  });

  it("reports duplicate active records instead of choosing one", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        submission("submission-1", "2026-01-01T00:00:00.000Z"),
        submission("submission-2", "2026-02-01T00:00:00.000Z"),
      ],
    });
    const repository = new SubmissionRepository({ send }, "SubmissionTable.test");
    await expect(
      repository.getActiveForClientYear("client-1", 2025),
    ).resolves.toEqual({ conflict: true, record: undefined });
  });

  it("reads an imported future-year submission through the repository schema", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [submission("submission-2350", "2026-01-01T00:00:00.000Z", 2350)],
    });
    const repository = new SubmissionRepository({ send }, "SubmissionTable.test");

    await expect(
      repository.query(
        { client_id: "client-1", tax_year: 2350 },
        "-created_date",
        200,
      ),
    ).resolves.toMatchObject([{ id: "submission-2350", tax_year: 2350 }]);
  });

  it("normalizes imported null optional fields at the persistence boundary", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [
        {
          ...submission("submission-imported", "2026-01-01T00:00:00.000Z"),
          cpa_status: null,
          responses: null,
          signed_pdfs: null,
          cpa_audit_log: null,
        },
      ],
    });
    const repository = new SubmissionRepository({ send }, "SubmissionTable.test");

    const [record] = await repository.query(
      { client_id: "client-1", tax_year: 2025 },
      "-created_date",
      200,
    );

    expect(record).toMatchObject({ id: "submission-imported" });
    expect(record.cpa_status).toBeUndefined();
    expect(record.responses).toBeUndefined();
    expect(record.signed_pdfs).toBeUndefined();
    expect(record.cpa_audit_log).toBeUndefined();
  });
});
