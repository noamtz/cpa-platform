import { expect, test } from "@playwright/test";

import {
  forbidExternalRuntimeRequests,
  loadAcceptanceFixture,
  questionnaireUrl,
  runStatefulScenario,
} from "./support/acceptance-fixture";

const fixture = loadAcceptanceFixture();

test.describe("J3 public PDF signing @readonly", () => {
  test.skip(!fixture?.expected?.pdfSignRoute, "Owner-supplied PDF signing fixture is required.");

  test("renders the designated multipage RTL signing surface", async ({ page }) => {
    const forbidden = forbidExternalRuntimeRequests(page);
    await page.goto(fixture.expected.pdfSignRoute || questionnaireUrl(fixture));
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.locator("canvas, img").first()).toBeVisible();
    expect(forbidden()).toEqual([]);
  });
});

test.describe("J3 public PDF signing @stateful", () => {
  test.skip(!fixture?.allowWrites, "Explicit PDF write/restore fixture is required.");

  test("persists and restores the designated PDF signing transition", async ({ page }) => {
    const forbidden = forbidExternalRuntimeRequests(page);
    await runStatefulScenario(page, fixture.stateful.pdfSigning);
    expect(forbidden()).toEqual([]);
  });
});
