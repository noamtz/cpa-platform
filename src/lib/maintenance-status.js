export const MAINTENANCE_STATUS = Object.freeze({
  OPEN: "open",
  MAINTENANCE: "maintenance",
  UNKNOWN: "unknown",
});

/**
 * The API remains the write authority. An unavailable status request does not
 * pretend maintenance is active; protected writes still fail closed server-side.
 */
export async function getMaintenanceStatus({ fetchImpl = fetch, apiBase = "/api" } = {}) {
  try {
    const response = await fetchImpl(`${apiBase}/maintenance`, {
      headers: { accept: "application/json" },
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
}
