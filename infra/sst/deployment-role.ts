import { deploymentContract } from "./contracts";
import type { StageSettings } from "./stage";

const foundationDeploymentActions = [
  "apigateway:*",
  "cloudfront:*",
  "cloudfront-keyvaluestore:*",
  "cognito-idp:*",
  "dynamodb:*",
  "ecr:BatchCheckLayerAvailability",
  "ecr:BatchGetImage",
  "ecr:CompleteLayerUpload",
  "ecr:DescribeImages",
  "ecr:DescribeRepositories",
  "ecr:GetAuthorizationToken",
  "ecr:GetDownloadUrlForLayer",
  "ecr:InitiateLayerUpload",
  "ecr:ListImages",
  "ecr:PutImage",
  "ecr:UploadLayerPart",
  "lambda:*",
  "logs:*",
  "s3:*",
  "ssm:*",
  "sts:GetCallerIdentity",
  "tag:GetResources",
  "tag:GetTagKeys",
  "tag:GetTagValues",
] as const;

const roleManagementActions = [
  "iam:CreateRole",
  "iam:DeleteRole",
  "iam:GetRole",
  "iam:GetRolePolicy",
  "iam:ListAttachedRolePolicies",
  "iam:ListRolePolicies",
  "iam:PutRolePolicy",
  "iam:DeleteRolePolicy",
  "iam:TagRole",
  "iam:UntagRole",
  "iam:UpdateAssumeRolePolicy",
  "iam:UpdateRole",
  "iam:UpdateRoleDescription",
  "iam:PassRole",
] as const;

export async function createTestDeploymentRole(stage: StageSettings) {
  if (stage.name !== "test") {
    return undefined;
  }

  const caller = await aws.getCallerIdentity({});
  const providerArn = `arn:aws:iam::${caller.accountId}:oidc-provider/${deploymentContract.providerUrl}`;
  const managedRoleArn = `arn:aws:iam::${caller.accountId}:role/${$app.name}-test-*`;

  return new aws.iam.Role(deploymentContract.roleLogicalName, {
    name: `${$app.name}-test-github-deploy`,
    description: "Issue #4 least-privilege SST test-stage deployment role",
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
        policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "FoundationServices",
              Effect: "Allow",
              Action: foundationDeploymentActions,
              Resource: "*",
            },
            {
              Sid: "FoundationRoleManagement",
              Effect: "Allow",
              Action: roleManagementActions,
              Resource: managedRoleArn,
            },
          ],
        }),
      },
    ],
    tags: {
      Application: $app.name,
      Stage: stage.name,
      ManagedBy: "sst",
    },
  });
}
