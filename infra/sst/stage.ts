export const APP_NAME = "auditflow" as const;
export const AWS_REGION = "il-central-1" as const;
export const SST_VERSION = "3.19.3" as const;
export const MONTHLY_COST_CEILING_ILS = 50 as const;

export const allowedStages = ["test", "production"] as const;
export type StageName = (typeof allowedStages)[number];

export interface ProductionBudgetSettings {
  readonly alertEmail: string;
  readonly monthlyLimitUsd: number;
}

export interface StageSettings {
  readonly name: StageName;
  readonly isProduction: boolean;
  readonly protect: boolean;
  readonly removal: "remove" | "retain";
  readonly logRetentionDays: number;
  readonly budget?: ProductionBudgetSettings;
}

export interface StageEnvironment {
  readonly [key: string]: string | undefined;
  readonly AUDITFLOW_BUDGET_ALERT_EMAIL?: string;
  readonly AUDITFLOW_MONTHLY_BUDGET_USD?: string;
}

export function parseStage(value: string | undefined): StageName {
  if (value === "test" || value === "production") {
    return value;
  }

  throw new Error(
    `Invalid SST stage. Expected one of: ${allowedStages.join(", ")}.`,
  );
}

function parseProductionBudget(
  environment: StageEnvironment,
): ProductionBudgetSettings {
  const alertEmail = environment.AUDITFLOW_BUDGET_ALERT_EMAIL;
  const rawMonthlyLimit = environment.AUDITFLOW_MONTHLY_BUDGET_USD;
  const monthlyLimitUsd = Number(rawMonthlyLimit);

  if (!alertEmail || !/^\S+@\S+\.\S+$/.test(alertEmail)) {
    throw new Error(
      "Production requires AUDITFLOW_BUDGET_ALERT_EMAIL in an ignored operator configuration.",
    );
  }

  if (!rawMonthlyLimit || !Number.isFinite(monthlyLimitUsd) || monthlyLimitUsd <= 0) {
    throw new Error(
      "Production requires a positive AUDITFLOW_MONTHLY_BUDGET_USD value.",
    );
  }

  return { alertEmail, monthlyLimitUsd };
}

export function getStageSettings(
  value: string | undefined,
  environment: StageEnvironment = process.env,
): StageSettings {
  const name = parseStage(value);
  const isProduction = name === "production";

  return {
    name,
    isProduction,
    protect: isProduction,
    removal: isProduction ? "retain" : "remove",
    logRetentionDays: isProduction ? 30 : 14,
    budget: isProduction ? parseProductionBudget(environment) : undefined,
  };
}
