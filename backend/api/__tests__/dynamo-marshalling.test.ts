import { marshall } from "@aws-sdk/util-dynamodb";
import { describe, expect, it } from "vitest";

import { submissionPersistedSchema } from "../contracts/entities";
import { DYNAMODB_DOCUMENT_CLIENT_OPTIONS } from "../handler";

describe("runtime DynamoDB marshalling", () => {
  it("removes normalized imported optionals from subsequent writes", () => {
    const imported = submissionPersistedSchema.parse({
      id: "submission-imported",
      client_id: "client-1",
      tax_year: 2025,
      cpa_status: null,
      responses: null,
      signed_pdfs: null,
      cpa_audit_log: null,
      record_type: "Submission",
      _version: 1,
      created_date: "2026-01-01T00:00:00.000Z",
      updated_date: "2026-01-01T00:00:00.000Z",
    });

    expect(Object.hasOwn(imported, "signed_pdfs")).toBe(true);
    const marshalled = marshall(
      { ...imported, _version: imported._version + 1 },
      DYNAMODB_DOCUMENT_CLIENT_OPTIONS.marshallOptions,
    );

    expect(marshalled).toHaveProperty("id.S", "submission-imported");
    expect(marshalled).not.toHaveProperty("cpa_status");
    expect(marshalled).not.toHaveProperty("responses");
    expect(marshalled).not.toHaveProperty("signed_pdfs");
    expect(marshalled).not.toHaveProperty("cpa_audit_log");
  });
});
