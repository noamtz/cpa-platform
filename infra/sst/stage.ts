export const APP_NAME = "auditflow" as const;
export const AWS_REGION = "il-central-1" as const;
export const SST_VERSION = "3.19.3" as const;
export const MONTHLY_COST_CEILING_ILS = 50 as const;

export const allowedStages = ["test", "production"] as const;
export type StageName = (typeof allowedStages)[number];

export function stageAssetLogicalName(
  logicalName: string,
  stage: StageName,
) {
  return stage === "production"
    ? `${logicalName}AuditflowProduction`
    : logicalName;
}

export interface ProductionBudgetSettings {
  readonly alertEmail: string;
  readonly monthlyLimitUsd: number;
  readonly ilsPerUsd: number;
  readonly convertedMonthlyLimitIls: number;
}

export interface ProductionCustomDomainSettings {
  readonly name: "app.ddcpa.co.il";
  readonly certificateArn: string;
}

export interface StageSettings {
  readonly name: StageName;
  readonly isProduction: boolean;
  readonly protect: boolean;
  readonly removal: "remove" | "retain";
  readonly logRetentionDays: number;
  readonly budget?: ProductionBudgetSettings;
  readonly customDomain?: ProductionCustomDomainSettings;
}

export interface StageEnvironment {
  readonly [key: string]: string | undefined;
  readonly AUDITFLOW_BUDGET_ALERT_EMAIL?: string;
  readonly AUDITFLOW_MONTHLY_BUDGET_USD?: string;
  readonly AUDITFLOW_ILS_PER_USD?: string;
  readonly AUDITFLOW_PRODUCTION_DOMAIN?: string;
  readonly AUDITFLOW_PRODUCTION_CERTIFICATE_ARN?: string;
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
  const rawIlsPerUsd = environment.AUDITFLOW_ILS_PER_USD;
  const ilsPerUsd = Number(rawIlsPerUsd);

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

  if (!rawIlsPerUsd || !Number.isFinite(ilsPerUsd) || ilsPerUsd <= 0) {
    throw new Error(
      "Production requires a positive AUDITFLOW_ILS_PER_USD operator rate.",
    );
  }

  const convertedMonthlyLimitIls = monthlyLimitUsd * ilsPerUsd;
  if (convertedMonthlyLimitIls > MONTHLY_COST_CEILING_ILS) {
    throw new Error(
      `Production monthly budget exceeds the ILS ${MONTHLY_COST_CEILING_ILS} ceiling.`,
    );
  }

  return {
    alertEmail,
    monthlyLimitUsd,
    ilsPerUsd,
    convertedMonthlyLimitIls,
  };
}

function parseProductionCustomDomain(
  environment: StageEnvironment,
): ProductionCustomDomainSettings | undefined {
  const name = environment.AUDITFLOW_PRODUCTION_DOMAIN?.trim();
  const certificateArn = environment.AUDITFLOW_PRODUCTION_CERTIFICATE_ARN?.trim();
  if (!name && !certificateArn) return undefined;
  if (!name || !certificateArn) {
    throw new Error("Production domain and ACM certificate must be configured together.");
  }
  if (name !== "app.ddcpa.co.il") {
    throw new Error("Production domain must be app.ddcpa.co.il.");
  }
  if (!/^arn:aws:acm:us-east-1:\d{12}:certificate\/[0-9a-f-]{36}$/u.test(certificateArn)) {
    throw new Error("Production CloudFront certificate must be a us-east-1 ACM certificate ARN.");
  }
  return { name, certificateArn };
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
    customDomain: isProduction ? parseProductionCustomDomain(environment) : undefined,
  };
}
