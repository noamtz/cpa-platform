import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.AUDITFLOW_E2E_BASE_URL;
const storageState = process.env.AUDITFLOW_E2E_STORAGE_STATE;
const projects = [
  { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
];

if (process.env.AUDITFLOW_E2E_EDGE === "true") {
  projects.push({ name: "desktop-edge", use: { ...devices["Desktop Edge"], channel: "msedge" } });
}

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    ...(storageState && existsSync(storageState) ? { storageState } : {}),
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects,
  outputDir: "test-results/playwright",
});
