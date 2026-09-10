import deploymentTargetsJson from "./deployment-targets.json";

import { APP_NAME, AWS_REGION, allowedStages, type StageName } from "./stage";

export interface DeploymentTarget {
  readonly accountId: string;
  readonly region: typeof AWS_REGION;
  readonly deployRoleName: string;
}

interface DeploymentTargetsManifest {
  readonly schemaVersion: number;
  readonly app: string;
  readonly targets: Record<string, DeploymentTarget>;
}

function validateDeploymentTargets(
  value: DeploymentTargetsManifest,
): asserts value is DeploymentTargetsManifest & {
  readonly targets: Record<StageName, DeploymentTarget>;
} {
  if (value.schemaVersion !== 1 || value.app !== APP_NAME) {
    throw new Error("Unsupported AuditFlow deployment-target contract.");
  }

  const stageNames = Object.keys(value.targets).sort();
  if (JSON.stringify(stageNames) !== JSON.stringify([...allowedStages].sort())) {
    throw new Error("Deployment targets must define only test and production.");
  }

  for (const stage of allowedStages) {
    const target = value.targets[stage];
    if (
      !/^\d{12}$/u.test(target?.accountId ?? "") ||
      target.region !== AWS_REGION ||
      target.deployRoleName !== `${APP_NAME}-${stage}-github-deploy`
    ) {
      throw new Error(`The ${stage} deployment target is invalid.`);
    }
  }
}

const deploymentTargets = deploymentTargetsJson as DeploymentTargetsManifest;
validateDeploymentTargets(deploymentTargets);

export function getDeploymentTarget(stage: StageName): DeploymentTarget {
  return deploymentTargets.targets[stage];
}
