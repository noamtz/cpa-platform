export const MAINTENANCE_STATUS = Object.freeze({
  OPEN: "open",
  MAINTENANCE: "maintenance",
  UNKNOWN: "unknown",
});

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * The API remains the write authority. An unavailable status request does not
 * pretend maintenance is active; protected writes still fail closed server-side.
 */
export async function getMaintenanceStatus({
  fetchImpl = fetch,
  apiBase = "/api",
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  let timeout;
  const request = (async () => {
    try {
      const response = await fetchImpl(`${apiBase}/maintenance`, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (response.status === 503) return MAINTENANCE_STATUS.MAINTENANCE;
      if (!response.ok) return MAINTENANCE_STATUS.UNKNOWN;
      const body = await response.json();
      return body?.status === MAINTENANCE_STATUS.OPEN
        ? MAINTENANCE_STATUS.OPEN
        : body?.status === MAINTENANCE_STATUS.MAINTENANCE
          ? MAINTENANCE_STATUS.MAINTENANCE
          : MAINTENANCE_STATUS.UNKNOWN;
    } catch {
      return MAINTENANCE_STATUS.UNKNOWN;
    }
  })();
  const timedOut = new Promise((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve(MAINTENANCE_STATUS.UNKNOWN);
    }, deadline);
  });
  const status = await Promise.race([request, timedOut]);
  clearTimeout(timeout);
  return status;
}
