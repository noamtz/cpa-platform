import { describe, expect, it } from "vitest";

import {
  MAX_RESPONSES_BYTES,
  MAX_SIGNED_PDFS_BYTES,
  getActiveTemplateSchema,
  getClientByTokenSchema,
  getTemplateByIdSchema,
  publicClient,
  publicQuestionnaireDataSchema,
  publicSubmission,
  publicTemplate,
  updateClientSubmissionSchema,
} from "../contracts/public-questionnaire";

const credentials = { client_id: "client-1", token: "opaque-public-token" };

describe("public questionnaire contracts", () => {
  it("requires strict credentials for all public reads", () => {
    expect(getClientByTokenSchema.parse(credentials)).toEqual(credentials);
    expect(getActiveTemplateSchema.parse(credentials)).toEqual(credentials);
    expect(
      getTemplateByIdSchema.parse({ ...credentials, template_id: "template-1" }),
    ).toEqual({ ...credentials, template_id: "template-1" });
    expect(
      getActiveTemplateSchema.safeParse({ ...credentials, unexpected: true }).success,
    ).toBe(false);
  });

  it("preserves valid legacy JSON strings byte-for-byte", () => {
    const responses = '{ "step": { "answer": true } }';
    const signedPdfs = '[ { "step_id": "pdf-1" } ]';
    const parsed = publicQuestionnaireDataSchema.parse({
      responses,
      signed_pdfs: signedPdfs,
    });
    expect(parsed.responses).toBe(responses);
    expect(parsed.signed_pdfs).toBe(signedPdfs);
  });

  it.each([
    [{ responses: "not-json" }],
    [{ responses: "[]" }],
    [{ signed_pdfs: "{}" }],
    [{ signed_pdfs: "[broken" }],
  ])("rejects malformed or wrong-top-level JSON before persistence", (data) => {
    expect(publicQuestionnaireDataSchema.safeParse(data).success).toBe(false);
  });

  it("enforces UTF-8 byte bounds", () => {
    const responses = JSON.stringify({ value: "א".repeat(MAX_RESPONSES_BYTES) });
    const signedPdfs = JSON.stringify(["א".repeat(MAX_SIGNED_PDFS_BYTES)]);
    expect(publicQuestionnaireDataSchema.safeParse({ responses }).success).toBe(false);
    expect(publicQuestionnaireDataSchema.safeParse({ signed_pdfs: signedPdfs }).success).toBe(false);
  });

  it("rejects server-owned and unknown fields inside data", () => {
    for (const field of [
      "client_id",
      "tax_year",
      "is_archived",
      "_version",
      "id",
      "record_type",
      "status",
      "created_by",
    ]) {
      expect(
        publicQuestionnaireDataSchema.safeParse({ responses: "{}", [field]: "x" })
          .success,
      ).toBe(false);
    }
  });

  it("requires revisions only for supplied existing submission IDs", () => {
    expect(
      updateClientSubmissionSchema.safeParse({
        ...credentials,
        submission_id: "submission-1",
        data: { responses: "{}" },
      }).success,
    ).toBe(false);
    expect(
      updateClientSubmissionSchema.safeParse({
        ...credentials,
        _version: 1,
        data: { responses: "{}" },
      }).success,
    ).toBe(false);
    expect(
      updateClientSubmissionSchema.parse({
        ...credentials,
        submission_id: "submission-1",
        _version: 3,
        data: { responses: "{}" },
      }),
    ).toMatchObject({ submission_id: "submission-1", _version: 3 });
  });

  it("requires completion timestamp and template metadata", () => {
    expect(
      updateClientSubmissionSchema.safeParse({
        ...credentials,
        data: { responses: "{}" },
        completed: true,
      }).success,
    ).toBe(false);
    expect(
      updateClientSubmissionSchema.safeParse({
        ...credentials,
        data: {
          responses: "{}",
          completed_at: "2026-08-24T00:00:00.000Z",
          template_id: "template-1",
          template_version: 4,
        },
        completed: true,
      }).success,
    ).toBe(true);
  });

  it("redacts Client tokens and internal metadata", () => {
    const projected = publicClient({
      id: "client-1",
      full_name: "Invented Client",
      token: "secret-token-value",
      tax_year: 2025,
      id_number: "fixture-id",
      record_type: "Client",
      _version: 2,
      created_date: "2026-01-01T00:00:00.000Z",
      updated_date: "2026-01-01T00:00:00.000Z",
      future_internal_field: "hidden",
    });
    expect(projected).toMatchObject({
      id: "client-1",
      full_name: "Invented Client",
      tax_year: 2025,
      id_number: "fixture-id",
    });
    expect(projected).not.toHaveProperty("token");
    expect(projected).not.toHaveProperty("_version");
    expect(projected).not.toHaveProperty("future_internal_field");
  });

  it("returns only browser submission fields plus the opaque revision", () => {
    const projected = publicSubmission({
      id: "submission-1",
      client_id: "client-1",
      tax_year: 2025,
      responses: '{ "spacing": true }',
      record_type: "Submission",
      _version: 7,
      created_date: "2026-01-01T00:00:00.000Z",
      updated_date: "2026-01-02T00:00:00.000Z",
      created_by: "hidden",
      future_internal_field: "hidden",
    });
    expect(projected).toMatchObject({
      id: "submission-1",
      responses: '{ "spacing": true }',
      _version: 7,
    });
    expect(projected).not.toHaveProperty("created_by");
    expect(projected).not.toHaveProperty("future_internal_field");
  });

  it("parses template steps while retaining only the public projection", () => {
    expect(
      publicTemplate({
        id: "template-1",
        version: 2,
        is_active: true,
        steps: '[{"id":"one"}]',
        record_type: "QuestionnaireTemplate",
        _version: 1,
        created_date: "2026-01-01T00:00:00.000Z",
        updated_date: "2026-01-01T00:00:00.000Z",
        internal: "hidden",
      }),
    ).toEqual({
      id: "template-1",
      version: 2,
      steps: [{ id: "one" }],
      created_at: "2026-01-01T00:00:00.000Z",
    });
  });
});
