import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { PdfTemplateRepository } from "../repositories/pdf-template";

const record = {
  id: "template-test",
  name: "Synthetic template",
  template_json: '{"basePdf":{"__type":"file_uri","value":"private://synthetic/file.pdf"}}',
  record_type: "PdfTemplate",
  _version: 1,
  created_date: "2026-01-01T00:00:00.000Z",
  updated_date: "2026-01-01T00:00:00.000Z",
  future_field: true,
};

describe("PdfTemplateRepository", () => {
  it("uses a direct Get and preserves compatible unknown fields", async () => {
    const send = vi.fn().mockResolvedValue({ Item: record });
    const repository = new PdfTemplateRepository({ send }, "PdfTemplateTable.test");
    await expect(repository.get("template-test")).resolves.toEqual(record);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
    expect(send.mock.calls[0][0].input).toEqual({
      TableName: "PdfTemplateTable.test",
      Key: { id: "template-test" },
    });
  });

  it("returns undefined for a missing record and safely rejects invalid persisted data", async () => {
    const missing = new PdfTemplateRepository(
      { send: vi.fn().mockResolvedValue({}) },
      "PdfTemplateTable.test",
    );
    await expect(missing.get("missing")).resolves.toBeUndefined();

    const invalid = new PdfTemplateRepository(
      { send: vi.fn().mockResolvedValue({ Item: { ...record, template_json: 3 } }) },
      "PdfTemplateTable.test",
    );
    await expect(invalid.get("template-test")).rejects.toMatchObject({ statusCode: 500 });
  });
});
