import { expect, test } from "@playwright/test";

import { forbidExternalRuntimeRequests, loadAcceptanceFixture } from "./support/acceptance-fixture";

const fixture = loadAcceptanceFixture();
const routes = ["/", "/clients", "/users", "/settings", "/questionnaire-settings", "/pdf-templates"];

test.describe("J4-J10 CPA routes @readonly", () => {
  test.skip(!fixture || !process.env.AUDITFLOW_E2E_STORAGE_STATE, "Authenticated owner storage state is required.");

  for (const route of routes) {
    test(`loads ${route} through the AWS application`, async ({ page }) => {
      const forbidden = forbidExternalRuntimeRequests(page);
      await page.goto(route);
      await expect(page.locator("body")).not.toBeEmpty();
      await expect(page).not.toHaveURL(/\/auth\/callback\?.*error/iu);
      expect(forbidden()).toEqual([]);
    });
  }
});

test.describe("J5-J10 CPA mutations @stateful", () => {
  test.skip(!fixture?.allowWrites || !process.env.AUDITFLOW_E2E_STORAGE_STATE, "Authenticated write/restore fixture is required.");

  test("opens the designated synthetic client workflow", async ({ page }) => {
    await page.goto(fixture.stateful.cpaRoute ?? "/clients");
    await expect(page.locator("body")).toContainText(fixture.expected.cpaClientText ?? /./u);
  });
});
