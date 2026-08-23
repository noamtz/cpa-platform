import { describe, expect, it } from "vitest";

import {
  clientCreateSchema,
  clientPersistedSchema,
  clientQuerySchema,
  publicRecord,
  submissionPersistedSchema,
  submissionUpdateSchema,
  updateMeSchema,
} from "../contracts/entities";

describe("entity compatibility contracts", () => {
  it("keeps approved unknown legacy fields on reads and strips only internals", () => {
    const record = clientPersistedSchema.parse({
      id: "client-1",
      full_name: "Invented Client",
      token: "0123456789abcdef",
      record_type: "Client",
      _version: 1,
      cognito_sub: "never-public",
      created_date: "2026-01-01T00:00:00.000Z",
      updated_date: "2026-01-01T00:00:00.000Z",
      legacy_flat_field: "preserved",
    });

    expect(publicRecord(record)).toMatchObject({
      id: "client-1",
      legacy_flat_field: "preserved",
    });
    expect(publicRecord(record)).not.toHaveProperty("record_type");
    expect(publicRecord(record)).not.toHaveProperty("_version");
    expect(publicRecord(record)).not.toHaveProperty("cognito_sub");
  });

  it("preserves Submission JSON strings byte-for-byte", () => {
    const encoded = '{"answer":"value with  spaces"}';
    const record = submissionPersistedSchema.parse({
      id: "submission-1",
      client_id: "client-1",
      responses: encoded,
      signed_pdfs: "[]",
      cpa_audit_log: "[]",
      record_type: "Submission",
      _version: 1,
      created_date: "2026-01-01T00:00:00.000Z",
      updated_date: "2026-01-01T00:00:00.000Z",
      old_boolean: true,
    });
    expect(record.responses).toBe(encoded);
    expect(record.old_boolean).toBe(true);
  });

  it("accepts the current weak browser token only at create and rejects unknown mutations", () => {
    expect(
      clientCreateSchema.parse({ full_name: "Invented", token: "weak" }),
    ).toMatchObject({ token: "weak" });
    expect(() => submissionUpdateSchema.parse({ alert_sent: true })).toThrow();
    expect(() => updateMeSchema.parse({ role: "admin" })).toThrow();
  });

  it("bounds list sorting and limits", () => {
    expect(clientQuerySchema.parse({ filter: {} })).toEqual({
      filter: {},
      sort: "-created_date",
      limit: 200,
    });
    expect(() => clientQuerySchema.parse({ filter: {}, limit: 201 })).toThrow();
    expect(() =>
      clientQuerySchema.parse({ filter: { unsupported: true } }),
    ).toThrow();
  });
});
