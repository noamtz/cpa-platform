import { describe, expect, it, vi } from "vitest";

vi.mock("@base44/sdk", () => ({
  createClient: vi.fn(() => ({
    entities: { PdfTemplate: {} },
    functions: {},
    integrations: { Core: {} },
    agents: {},
  })),
}));

vi.mock("@/lib/app-params", () => ({
  appParams: {
    appId: "test-app",
    token: null,
    functionsVersion: "test",
    appBaseUrl: "https://app.example.test",
  },
}));

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
    },
    auth: { me: vi.fn() },
    users: { inviteUser: vi.fn() },
    functions: { invoke: vi.fn() },
    connectors: { connectAppUser: vi.fn() },
  };
  const legacy = {
    entities: {
      PdfTemplate: {
        list: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
    functions: { invoke: vi.fn() },
    integrations: { Core: { CreateFileSignedUrl: vi.fn() } },
    agents: {
      subscribeToConversation: vi.fn(),
      getConversation: vi.fn(),
      addMessage: vi.fn(),
    },
  };
  return { aws, legacy, client: createCompatibilityClient({ aws, legacy }) };
}

describe("Base44 compatibility allowlist", () => {
  it("never falls back to Base44 when a migrated AWS operation fails", async () => {
    const { client, legacy } = setup();
    await expect(client.entities.Client.list()).rejects.toThrow("AWS failed");
    expect(legacy.functions.invoke).not.toHaveBeenCalled();
    expect(legacy.entities.PdfTemplate.list).not.toHaveBeenCalled();
  });

  it("delegates only the named legacy template surfaces", async () => {
    const { client, legacy } = setup();
    await client.entities.PdfTemplate.list("-created_date");
    await client.functions.invoke("getActiveTemplate", { year: 2026 });
    expect(legacy.entities.PdfTemplate.list).toHaveBeenCalledWith("-created_date");
    expect(legacy.functions.invoke).toHaveBeenCalledWith("getActiveTemplate", { year: 2026 });
    expect(client.integrations).toBeUndefined();
  });

  it("routes Drive and every other function name to AWS without catch fallback", async () => {
    const { client, aws, legacy } = setup();
    aws.functions.invoke.mockRejectedValue(new Error("not implemented"));
    await expect(
      client.functions.invoke("syncFilesToGoogleDrive", { check_connection: true }),
    ).rejects.toThrow("not implemented");
    expect(aws.functions.invoke).toHaveBeenCalledOnce();
    expect(legacy.functions.invoke).not.toHaveBeenCalled();
  });

  it("preserves the readiness conversation agent method names", async () => {
    const { client, legacy } = setup();
    const listener = vi.fn();
    const conversation = { id: "conversation-1" };
    legacy.agents.getConversation.mockResolvedValue(conversation);

    client.agents.subscribeToConversation("conversation-1", listener);
    await client.agents.getConversation("conversation-1");
    await client.agents.addMessage(conversation, {
      role: "user",
      content: "Is this submission ready?",
    });

    expect(legacy.agents.subscribeToConversation).toHaveBeenCalledWith(
      "conversation-1",
      listener,
    );
    expect(legacy.agents.getConversation).toHaveBeenCalledWith("conversation-1");
    expect(legacy.agents.addMessage).toHaveBeenCalledWith(conversation, {
      role: "user",
      content: "Is this submission ready?",
    });
  });
});
