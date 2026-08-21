import { describe, expect, it } from "vitest";

import {
  AWS_REGION,
  MONTHLY_COST_CEILING_ILS,
  getStageSettings,
  parseStage,
} from "../stage";

describe("stage settings", () => {
  it.each(["test", "production"] as const)("accepts the %s stage", (stage) => {
    expect(parseStage(stage)).toBe(stage);
  });

  it.each([undefined, "", "prod", "Test", " test", "test ", "personal"])(
    "rejects an invalid or unnamed stage: %s",
    (stage) => {
      expect(() => parseStage(stage)).toThrow("Invalid SST stage");
    },
  );

  it("keeps test removable and independent of production configuration", () => {
    expect(getStageSettings("test", {})).toEqual({
      name: "test",
      isProduction: false,
      protect: false,
      removal: "remove",
      logRetentionDays: 14,
      budget: undefined,
    });
  });

  it("protects production and parses its external budget configuration", () => {
    const settings = getStageSettings("production", {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid",
      AUDITFLOW_MONTHLY_BUDGET_USD: "10",
      AUDITFLOW_ILS_PER_USD: "3.073",
    });

    expect(settings).toEqual({
      name: "production",
      isProduction: true,
      protect: true,
      removal: "retain",
      logRetentionDays: 30,
      budget: {
        alertEmail: "owner@example.invalid",
        monthlyLimitUsd: 10,
        ilsPerUsd: 3.073,
        convertedMonthlyLimitIls: 30.73,
      },
    });
    expect(AWS_REGION).toBe("il-central-1");
    expect(MONTHLY_COST_CEILING_ILS).toBe(50);
  });

  it.each([
    {},
    { AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid" },
    {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid",
      AUDITFLOW_MONTHLY_BUDGET_USD: "10",
    },
    {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "not-an-email",
      AUDITFLOW_MONTHLY_BUDGET_USD: "10",
      AUDITFLOW_ILS_PER_USD: "3.073",
    },
    {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid",
      AUDITFLOW_MONTHLY_BUDGET_USD: "0",
      AUDITFLOW_ILS_PER_USD: "3.073",
    },
    {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid",
      AUDITFLOW_MONTHLY_BUDGET_USD: "not-a-number",
      AUDITFLOW_ILS_PER_USD: "3.073",
    },
    {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid",
      AUDITFLOW_MONTHLY_BUDGET_USD: "10",
      AUDITFLOW_ILS_PER_USD: "0",
    },
    {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid",
      AUDITFLOW_MONTHLY_BUDGET_USD: "10",
      AUDITFLOW_ILS_PER_USD: "not-a-number",
    },
    {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid",
      AUDITFLOW_MONTHLY_BUDGET_USD: "100000",
      AUDITFLOW_ILS_PER_USD: "3.073",
    },
    {
      AUDITFLOW_BUDGET_ALERT_EMAIL: "owner@example.invalid",
      AUDITFLOW_MONTHLY_BUDGET_USD: "10",
      AUDITFLOW_ILS_PER_USD: "5.01",
    },
  ])("fails closed on invalid production budget settings", (environment) => {
    expect(() => getStageSettings("production", environment)).toThrow();
  });
});
