import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { ClientRepository } from "../repositories/client";
import { derivedPlaceholderClientDisplayName } from "../contracts/entities";

function client(id: string, archived = false) {
  return {
    id,
    full_name: `Invented ${id}`,
    token: "0123456789abcdef",
    is_archived: archived,
    record_type: "Client",
    _version: 1,
    created_date: `2026-01-0${id.endsWith("2") ? "2" : "1"}T00:00:00.000Z`,
    updated_date: "2026-01-01T00:00:00.000Z",
  };
}

describe("ClientRepository", () => {
  it("fills a post-filter limit across Query pages without Scan", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Items: [client("client-1", false)],
        LastEvaluatedKey: { id: "client-1" },
      })
      .mockResolvedValueOnce({ Items: [client("client-2", true)] });
    const repository = new ClientRepository({ send }, "ClientTable.test");

    await expect(
      repository.query({ is_archived: true }, "-created_date", 1),
    ).resolves.toMatchObject([{ id: "client-2" }]);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toBeInstanceOf(QueryCommand);
    expect(send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({
      id: "client-1",
    });
  });

  it("uses Get for an ID filter and rejects corrupt rows", async () => {
    const send = vi.fn().mockResolvedValue({ Item: { id: "broken" } });
    const repository = new ClientRepository({ send }, "ClientTable.test");
    await expect(
      repository.query({ id: "broken" }, "-created_date", 200),
    ).rejects.toMatchObject({ statusCode: 500 });
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetCommand);
  });

  it("reads a correctly marked derived placeholder without inventing identity data", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: {
        id: "missing-client",
        is_archived: true,
        record_type: "Client",
        _version: 1,
        created_date: "2026-01-01T00:00:00.000Z",
        updated_date: "2026-01-02T00:00:00.000Z",
        _auditflow_migration: {
          schema_version: 1,
          source: "base44",
          item_kind: "derived_placeholder_client",
          source_manifest_sha256: "a".repeat(64),
          source_submission_count: 2,
          source_submission_ids_sha256: "b".repeat(64),
        },
      },
    });
    const repository = new ClientRepository({ send }, "ClientTable.test");

    await expect(repository.get("missing-client")).resolves.toMatchObject({
      id: "missing-client",
      full_name: derivedPlaceholderClientDisplayName,
    });
  });

  it("normalizes nullable Base44 optional fields on persisted clients", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: {
        ...client("imported-client"),
        email: "",
        notes: null,
        last_activity: null,
        osek_type: null,
      },
    });
    const repository = new ClientRepository({ send }, "ClientTable.test");

    await expect(repository.get("imported-client")).resolves.toMatchObject({
      id: "imported-client",
      email: undefined,
      notes: undefined,
      last_activity: undefined,
      osek_type: undefined,
    });
  });

  it("still rejects an unmarked client without a name", async () => {
    const send = vi.fn().mockResolvedValue({
      Item: {
        id: "missing-client",
        record_type: "Client",
        _version: 1,
        created_date: "2026-01-01T00:00:00.000Z",
        updated_date: "2026-01-01T00:00:00.000Z",
      },
    });
    const repository = new ClientRepository({ send }, "ClientTable.test");

    await expect(repository.get("missing-client")).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});
