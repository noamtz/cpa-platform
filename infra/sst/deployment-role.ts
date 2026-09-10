import { deploymentContract } from "./contracts";
import {
  buildDeploymentPolicy,
  buildWorkloadBoundaryPolicy,
} from "./deployment-policy";
import type { StageSettings } from "./stage";

export async function createDeploymentRole(
  stage: StageSettings,
  routerKeyValueStoreArn?: $util.Input<string>,
) {
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

  const providerArn = `arn:aws:iam::${caller.accountId}:oidc-provider/${deploymentContract.providerUrl}`;
  const roleContract = deploymentContract.roles[stage.name];
  if (stage.isProduction && !routerKeyValueStoreArn) {
    throw new Error("Production requires the Router KeyValueStore ARN.");
  }
  const inlinePolicy = stage.isProduction
    ? $resolve([workloadBoundary.arn, routerKeyValueStoreArn!]).apply(
        ([workloadBoundaryArn, resolvedRouterKeyValueStoreArn]) =>
          JSON.stringify(
            buildDeploymentPolicy({
              accountId: caller.accountId,
              stage: stage.name,
              workloadBoundaryArn,
              routerKeyValueStoreArn: resolvedRouterKeyValueStoreArn,
            }),
          ),
      )
    : workloadBoundary.arn.apply((workloadBoundaryArn) =>
        JSON.stringify(
          buildDeploymentPolicy({
            accountId: caller.accountId,
            stage: stage.name,
            workloadBoundaryArn,
          }),
        ),
      );

  const role = new aws.iam.Role(roleContract.logicalName, {
    name: `${$app.name}-${stage.name}-github-deploy`,
    description: `Owner-bootstrapped least-privilege SST ${stage.name} deployment role`,
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
                roleContract.subjects,
            },
          },
        },
      ],
    }),
    inlinePolicies: [
      {
        name: `auditflow-${stage.name}-foundation-deploy`,
        policy: inlinePolicy,
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
