import { describe, expect, it, vi } from "vitest";

import { getMaintenanceStatus, MAINTENANCE_STATUS } from "../maintenance-status";

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  };
}

describe("maintenance status client", () => {
  it.each([
    ["open", MAINTENANCE_STATUS.OPEN],
    ["maintenance", MAINTENANCE_STATUS.MAINTENANCE],
  ])("parses the %s state", async (status, expected) => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { status }));
    await expect(getMaintenanceStatus({ fetchImpl })).resolves.toBe(expected);
    expect(fetchImpl).toHaveBeenCalledWith("/api/maintenance", {
      headers: { accept: "application/json" },
      signal: expect.any(AbortSignal),
    });
  });

  it("treats an API maintenance response as maintenance", async () => {
    await expect(getMaintenanceStatus({ fetchImpl: vi.fn().mockResolvedValue(response(503)) })).resolves.toBe(
      MAINTENANCE_STATUS.MAINTENANCE,
    );
  });

  it.each([
    [response(500), "HTTP error"],
    [response(200, { status: "ROLLED_BACK", generation: 7 }), "unknown body"],
  ])("does not invent a maintenance state for %s", async (result) => {
    await expect(getMaintenanceStatus({ fetchImpl: vi.fn().mockResolvedValue(result) })).resolves.toBe(
      MAINTENANCE_STATUS.UNKNOWN,
    );
  });

  it("keeps network failure non-authoritative", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    await expect(getMaintenanceStatus({ fetchImpl })).resolves.toBe(MAINTENANCE_STATUS.UNKNOWN);
  });

  it("bounds an unresponsive status request and aborts it", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise(() => {}));
    const result = getMaintenanceStatus({ fetchImpl, timeoutMs: 100 });
    const signal = fetchImpl.mock.calls[0][1].signal;

    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toBe(MAINTENANCE_STATUS.UNKNOWN);
    expect(signal.aborted).toBe(true);
    vi.useRealTimers();
  });
});
