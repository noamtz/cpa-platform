import { expect, test } from "@playwright/test";

import { forbidExternalRuntimeRequests, loadAcceptanceFixture } from "./support/acceptance-fixture";

const fixture = loadAcceptanceFixture();

test.describe("J4/J11/J12 permission and deferred controls @readonly", () => {
  test.skip(!fixture, "Owner-supplied test-stage fixture is required.");

  test("anonymous CPA deep link does not expose the dashboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(new URL("/clients", fixture.baseUrl).href);
    await expect(page).not.toHaveURL(/\/clients$/u);
    await context.close();
  });

  test("all deferred endpoints return the controlled response without external traffic", async ({ page }) => {
    test.skip(!process.env.AUDITFLOW_E2E_STORAGE_STATE, "Authenticated owner storage state is required.");
    const forbidden = forbidExternalRuntimeRequests(page);
    await page.goto("/settings");
    const cases = [
      ["/api/cpa/integrations/google-drive/sync", { check_connection: true }, "google-drive"],
      ["/api/cpa/integrations/google-drive/connect", { connector_id: "drive" }, "google-drive"],
      ["/api/cpa/integrations/google-drive/disconnect", { connector_id: "drive" }, "google-drive"],
      ["/api/cpa/integrations/telegram/notify", { event: "acceptance" }, "telegram"],
    ];
    for (const [path, body, feature] of cases) {
      const result = await page.evaluate(async ({ path, body }) => {
        const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
      }, { path, body });
      expect(result).toEqual({ status: 501, body: { error: "Not implemented", code: "FEATURE_NOT_IMPLEMENTED", feature } });
    }
    expect(forbidden()).toEqual([]);
  });

  test("unknown route renders the application fallback", async ({ page }) => {
    await page.goto("/readiness-route-does-not-exist");
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
