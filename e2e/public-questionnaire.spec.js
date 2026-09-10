import { expect, test } from "@playwright/test";

import { forbidExternalRuntimeRequests, loadAcceptanceFixture, questionnaireUrl } from "./support/acceptance-fixture";

const fixture = loadAcceptanceFixture();

test.describe("J1/J2 public questionnaire @readonly", () => {
  test.skip(!fixture, "Owner-supplied disposable test-stage fixture is required.");

  test("loads a reconciled questionnaire and emits no forbidden runtime request", async ({ page }) => {
    const forbidden = forbidExternalRuntimeRequests(page);
    await page.goto(questionnaireUrl(fixture));
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText(fixture.expected.questionnaireText ?? "ברוכים הבאים", { exact: false }).first()).toBeVisible();
    expect(forbidden()).toEqual([]);
  });

  test("rejects an invalid token without exposing questionnaire content", async ({ page }) => {
    await page.goto(questionnaireUrl(fixture, fixture.publicClient.invalidToken));
    await expect(page.locator("body")).toContainText(/שגיאה|לא נמצא|גישה|error/iu);
  });
});

test.describe("J1/J2 public questionnaire @stateful", () => {
  test.skip(!fixture?.allowWrites, "Explicit test-stage write and restore confirmation is required.");

  test("resumes the designated disposable questionnaire after refresh", async ({ page }) => {
    await page.goto(questionnaireUrl(fixture));
    await page.reload();
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
