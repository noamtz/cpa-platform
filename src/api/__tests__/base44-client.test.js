import { describe, expect, it, vi } from "vitest";

vi.mock("../aws-client", () => ({
  awsClient: {
    entities: {},
    auth: {},
    users: {},
    functions: {},
    connectors: {},
  },
}));

import { createCompatibilityClient } from "../base44Client";

function setup() {
  const aws = {
    entities: {
      Client: { list: vi.fn().mockRejectedValue(new Error("AWS failed")) },
      Submission: { list: vi.fn() },
      User: { list: vi.fn() },
      PdfTemplate: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    },
    auth: { me: vi.fn() },
    users: { inviteUser: vi.fn() },
    functions: { invoke: vi.fn() },
    connectors: { connectAppUser: vi.fn() },
  };
  return { aws, client: createCompatibilityClient({ aws }) };
}

describe("AWS-only compatibility facade", () => {
  it("never falls back when a migrated AWS operation fails", async () => {
    const { client } = setup();
    await expect(client.entities.Client.list()).rejects.toThrow("AWS failed");
  });

  it("exposes every entity and function through AWS unchanged", async () => {
    const { client, aws } = setup();
    await client.entities.PdfTemplate.list();
    await client.functions.invoke("getActiveTemplate", {});
    expect(aws.entities.PdfTemplate.list).toHaveBeenCalledOnce();
    expect(aws.functions.invoke).toHaveBeenCalledWith("getActiveTemplate", {});
    expect(client.integrations).toBeUndefined();
  });

  it("fails locally for the removed readiness-agent runtime", () => {
    const { client } = setup();
    expect(() => client.agents.getConversation("conversation-1")).toThrow(
      "AWS agent is not migrated",
    );
  });
});
