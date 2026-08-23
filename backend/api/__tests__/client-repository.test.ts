import { GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { ClientRepository } from "../repositories/client";

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
});
