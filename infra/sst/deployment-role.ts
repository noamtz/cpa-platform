import { deploymentContract } from "./contracts";
import {
  buildTestDeploymentPolicy,
  buildWorkloadBoundaryPolicy,
} from "./deployment-policy";
import type { StageSettings } from "./stage";

export async function createTestDeploymentRole(stage: StageSettings) {
  const caller = await aws.getCallerIdentity({});
  const boundaryName = `${$app.name}-${stage.name}-workload-boundary`;
  const workloadBoundary = new aws.iam.Policy(
    deploymentContract.workloadBoundaryLogicalName,
    {
      name: boundaryName,
      description: `Maximum runtime permissions for ${$app.name} ${stage.name} workloads`,
      policy: JSON.stringify(
        buildWorkloadBoundaryPolicy(caller.accountId, stage.name),
      ),
      tags: {
        "sst:app": $app.name,
        "sst:stage": stage.name,
        ManagedBy: "owner-bootstrap",
      },
    },
  );

  if (stage.name !== "test") {
    return { role: undefined, workloadBoundary };
  }

  const providerArn = `arn:aws:iam::${caller.accountId}:oidc-provider/${deploymentContract.providerUrl}`;

  const role = new aws.iam.Role(deploymentContract.roleLogicalName, {
    name: `${$app.name}-test-github-deploy`,
    description: "Owner-bootstrapped least-privilege SST test deployment role",
    maxSessionDuration: 3600,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Federated: providerArn },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: {
              [`${deploymentContract.providerUrl}:aud`]:
                deploymentContract.audience,
              [`${deploymentContract.providerUrl}:sub`]:
                deploymentContract.subject,
            },
          },
        },
      ],
    }),
    inlinePolicies: [
      {
        name: "auditflow-test-foundation-deploy",
        policy: workloadBoundary.arn.apply((workloadBoundaryArn) =>
          JSON.stringify(
            buildTestDeploymentPolicy({
              accountId: caller.accountId,
              workloadBoundaryArn,
            }),
          ),
        ),
      },
    ],
    tags: {
      "sst:app": $app.name,
      "sst:stage": stage.name,
      ManagedBy: "owner-bootstrap",
    },
  });

  return { role, workloadBoundary };
}
