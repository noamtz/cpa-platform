import { describe, expect, it, vi } from "vitest";

import { loadActiveCpaSubmission } from "../cpa-fill";

describe("CPA fill submission loading", () => {
  it("requests active records and skips an archived record returned defensively", async () => {
    const active = { id: "active", is_archived: false, revision: 4 };
    const filter = vi.fn().mockResolvedValue([
      { id: "archived", is_archived: true, revision: 2 },
      active,
    ]);
    const client = { entities: { Submission: { filter } } };

    await expect(
      loadActiveCpaSubmission(client, "client-1", 2025),
    ).resolves.toBe(active);
    expect(filter).toHaveBeenCalledWith({
      client_id: "client-1",
      tax_year: 2025,
      is_archived: false,
    });
  });

  it("returns null when no active record is available", async () => {
    const filter = vi.fn().mockResolvedValue([
      { id: "archived", is_archived: true },
    ]);
    const client = { entities: { Submission: { filter } } };

    await expect(
      loadActiveCpaSubmission(client, "client-1", 2025),
    ).resolves.toBeNull();
  });
});
