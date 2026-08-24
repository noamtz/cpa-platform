import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { QuestionnaireTemplateRepository } from "../repositories/questionnaire-template";

function storedTemplate(id: string, version: number, active = true) {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    version,
    is_active: active,
    steps: "[]",
    record_type: "QuestionnaireTemplate",
    _version: 1,
    created_date: now,
    updated_date: now,
  };
}

describe("QuestionnaireTemplateRepository", () => {
  it("uses a direct Get for an exact ID", async () => {
    const send = vi.fn().mockResolvedValue({ Item: storedTemplate("record-1", 1) });
    const repository = new QuestionnaireTemplateRepository({ send }, "Table.test");
    await repository.get("record-1");
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
  });

  it("returns an active record", async () => {
    const send = vi.fn().mockResolvedValue({
      Items: [storedTemplate("record-2", 2)],
    });
    const repository = new QuestionnaireTemplateRepository({ send }, "Table.test");
    await expect(repository.latestActive()).resolves.toMatchObject({ id: "record-2" });
    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[0][0].input).toMatchObject({
      IndexName: "byVersion",
      ScanIndexForward: false,
    });
  });

  it("skips inactive higher versions across query pages", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [storedTemplate("record-4", 4, false)],
        LastEvaluatedKey: { id: "record-4" },
      })
      .mockResolvedValueOnce({ Items: [storedTemplate("record-3", 3)] });
    const repository = new QuestionnaireTemplateRepository({ send }, "Table.test");
    await expect(repository.latestActive()).resolves.toMatchObject({ id: "record-3" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("maps malformed stored rows to a safe internal error", async () => {
    const send = vi.fn().mockResolvedValue({ Item: { id: "broken" } });
    const repository = new QuestionnaireTemplateRepository({ send }, "Table.test");
    await expect(repository.get("broken")).rejects.toMatchObject({ statusCode: 500 });
  });
});
