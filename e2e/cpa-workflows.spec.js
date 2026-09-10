import { expect, test } from "@playwright/test";

import {
  forbidExternalRuntimeRequests,
  loadAcceptanceFixture,
  runDeniedRequestCases,
  runStatefulScenario,
} from "./support/acceptance-fixture";

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

  test("persists and restores the designated synthetic CPA workflow", async ({ page }) => {
    const forbidden = forbidExternalRuntimeRequests(page);
    await runStatefulScenario(page, fixture.stateful.cpaWorkflow);
    expect(forbidden()).toEqual([]);
  });

  test("denies designated cross-resource access", async ({ page }) => {
    const forbidden = forbidExternalRuntimeRequests(page);
    await page.goto("/clients");
    await runDeniedRequestCases(page, fixture.stateful.deniedRequests);
    expect(forbidden()).toEqual([]);
  });
});
