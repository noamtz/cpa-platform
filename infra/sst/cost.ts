import { costContract } from "./contracts";
import type { StageSettings } from "./stage";

export function createCostControls(stage: StageSettings) {
  if (!stage.isProduction || !stage.budget) {
    return undefined;
  }

  return new aws.budgets.Budget(
    costContract.logicalName,
    {
      name: `${$app.name}-${stage.name}-monthly-cost`,
      budgetType: costContract.budgetType,
      limitAmount: String(stage.budget.monthlyLimitUsd),
      limitUnit: "USD",
      timeUnit: costContract.timeUnit,
      notifications: [
        {
          comparisonOperator: "GREATER_THAN",
          notificationType: costContract.notificationType,
          threshold: costContract.thresholdPercent,
          thresholdType: "PERCENTAGE",
          subscriberEmailAddresses: [
            $util.secret(stage.budget.alertEmail),
          ],
        },
      ],
      tags: {
        Application: $app.name,
        Stage: stage.name,
      },
    },
    { retainOnDelete: true },
  );
}
