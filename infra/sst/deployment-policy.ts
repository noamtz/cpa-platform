import { APP_NAME, AWS_REGION, type StageName } from "./stage";

export interface IamPolicyStatement {
  readonly Sid: string;
  readonly Effect: "Allow" | "Deny";
  readonly Action: string | readonly string[];
  readonly Resource: string | readonly string[];
  readonly Condition?: Readonly<
    Record<string, Readonly<Record<string, string | readonly string[]>>>
  >;
}

export interface IamPolicyDocument {
  readonly Version: "2012-10-17";
  readonly Statement: readonly IamPolicyStatement[];
}

export interface DeploymentPolicyContext {
  readonly accountId: string;
  readonly region?: string;
  readonly appName?: string;
  readonly stage?: StageName;
  readonly workloadBoundaryArn: string;
}

const testTags = {
  "sst:app": APP_NAME,
  "sst:stage": "test",
} as const;

const resourceTagCondition = {
  StringEquals: {
    "aws:ResourceTag/sst:app": testTags["sst:app"],
    "aws:ResourceTag/sst:stage": testTags["sst:stage"],
  },
} as const;

const requestTagCondition = {
  StringEquals: {
    "aws:RequestTag/sst:app": testTags["sst:app"],
    "aws:RequestTag/sst:stage": testTags["sst:stage"],
  },
} as const;

const deployRoleSelfMutationActions = [
  "iam:AttachRolePolicy",
  "iam:DeleteRole",
  "iam:DeleteRolePermissionsBoundary",
  "iam:DeleteRolePolicy",
  "iam:DetachRolePolicy",
  "iam:PutRolePermissionsBoundary",
  "iam:PutRolePolicy",
  "iam:TagRole",
  "iam:UntagRole",
  "iam:UpdateAssumeRolePolicy",
  "iam:UpdateRole",
  "iam:UpdateRoleDescription",
] as const;

const workloadRoleMutationActions = [
  "iam:CreateRole",
  "iam:DeleteRole",
  "iam:DeleteRolePolicy",
  "iam:PutRolePolicy",
  "iam:TagRole",
  "iam:UntagRole",
  "iam:UpdateAssumeRolePolicy",
  "iam:UpdateRole",
  "iam:UpdateRoleDescription",
] as const;

const globalDiscoveryActions = [
  "access-analyzer:ValidatePolicy",
  "cloudfront:GetCachePolicy",
  "cloudfront:GetCachePolicyConfig",
  "cloudfront:GetOriginAccessControl",
  "cloudfront:GetOriginAccessControlConfig",
  "cloudfront:GetOriginRequestPolicy",
  "cloudfront:GetOriginRequestPolicyConfig",
  "cloudfront:GetResponseHeadersPolicy",
  "cloudfront:GetResponseHeadersPolicyConfig",
  "cloudfront:ListCachePolicies",
  "cloudfront:ListDistributions",
  "cloudfront:ListFunctions",
  "cloudfront:ListKeyValueStores",
  "cloudfront:ListOriginAccessControls",
  "cloudfront:ListOriginRequestPolicies",
  "cloudfront:ListResponseHeadersPolicies",
  "cognito-idp:ListUserPools",
  "dynamodb:ListTables",
  "ecr:GetAuthorizationToken",
  "lambda:GetAccountSettings",
  "logs:DescribeLogGroups",
  "s3:ListAllMyBuckets",
  "sts:GetCallerIdentity",
  "tag:GetResources",
  "tag:GetTagKeys",
  "tag:GetTagValues",
] as const;

export function buildWorkloadBoundaryPolicy(
  accountId: string,
  stage: StageName,
  region = AWS_REGION,
  appName = APP_NAME,
): IamPolicyDocument {
  const resourcePrefix = `${appName}-${stage}-`;

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "WorkloadLogs",
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: [
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/${resourcePrefix}*:*`,
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/vendedlogs/apis/${resourcePrefix}*:*`,
        ],
      },
      {
        Sid: "WorkloadDynamoData",
        Effect: "Allow",
        Action: [
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:PartiQLDelete",
          "dynamodb:PartiQLInsert",
          "dynamodb:PartiQLSelect",
          "dynamodb:PartiQLUpdate",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:TransactGetItems",
          "dynamodb:TransactWriteItems",
          "dynamodb:UpdateItem",
        ],
        Resource: [
          `arn:aws:dynamodb:${region}:${accountId}:table/${resourcePrefix}*`,
          `arn:aws:dynamodb:${region}:${accountId}:table/${resourcePrefix}*/index/*`,
        ],
      },
      {
        Sid: "WorkloadFileData",
        Effect: "Allow",
        Action: [
          "s3:AbortMultipartUpload",
          "s3:DeleteObject",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:GetObjectVersion",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:ListMultipartUploadParts",
          "s3:PutObject",
        ],
        Resource: [
          `arn:aws:s3:::${resourcePrefix}*`,
          `arn:aws:s3:::${resourcePrefix}*/*`,
        ],
      },
      {
        Sid: "WorkloadCognitoData",
        Effect: "Allow",
        Action: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminDeleteUser",
          "cognito-idp:AdminDisableUser",
          "cognito-idp:AdminEnableUser",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminRemoveUserFromGroup",
          "cognito-idp:AdminResetUserPassword",
          "cognito-idp:AdminSetUserPassword",
          "cognito-idp:AdminUpdateUserAttributes",
          "cognito-idp:ListGroups",
          "cognito-idp:ListUsers",
          "cognito-idp:ListUsersInGroup",
        ],
        Resource: `arn:aws:cognito-idp:${region}:${accountId}:userpool/*`,
        Condition: {
          StringEquals: {
            "aws:ResourceTag/sst:app": appName,
            "aws:ResourceTag/sst:stage": stage,
          },
        },
      },
    ],
  };
}

export function buildTestDeploymentPolicy({
  accountId,
  region = AWS_REGION,
  appName = APP_NAME,
  stage = "test",
  workloadBoundaryArn,
}: DeploymentPolicyContext): IamPolicyDocument {
  if (stage !== "test") {
    throw new Error("The GitHub deployment policy is restricted to the test stage.");
  }

  const resourcePrefix = `${appName}-${stage}-`;
  const deployRoleArn = `arn:aws:iam::${accountId}:role/${resourcePrefix}github-deploy`;
  const workloadRoleArn = `arn:aws:iam::${accountId}:role/${resourcePrefix}*`;
  const apiArn = `arn:aws:apigateway:${region}::/apis/*`;
  const cognitoArn = `arn:aws:cognito-idp:${region}:${accountId}:userpool/*`;
  const cloudFrontResources = [
    `arn:aws:cloudfront::${accountId}:distribution/*`,
    `arn:aws:cloudfront::${accountId}:function/${resourcePrefix}*`,
    `arn:aws:cloudfront::${accountId}:key-value-store/*`,
  ];
  const stageBuckets = [
    `arn:aws:s3:::${resourcePrefix}*`,
    `arn:aws:s3:::${resourcePrefix}*/*`,
  ];
  const sstAssetBucketArn = "arn:aws:s3:::sst-asset-kkkvushrzufd";
  const sstStateBucketArn = "arn:aws:s3:::sst-state-kkkvushrzufd";
  const sstStageStatePrefixes = [
    `*/${appName}/${stage}.json`,
    `*/${appName}/${stage}/*`,
  ];
  const sstStageStateObjects = sstStageStatePrefixes.map(
    (prefix) => `${sstStateBucketArn}/${prefix}`,
  );
  const sstFallbackSecretPrefix = `secret/${appName}/_fallback.json`;

  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "GlobalDiscoveryOnly",
        Effect: "Allow",
        Action: globalDiscoveryActions,
        Resource: "*",
      },
      {
        Sid: "ReadSstBootstrapConfiguration",
        Effect: "Allow",
        Action: "ssm:GetParameter",
        Resource: [
          `arn:aws:ssm:${region}:${accountId}:parameter/sst/bootstrap`,
          `arn:aws:ssm:${region}:${accountId}:parameter/sst/passphrase/${appName}/${stage}`,
        ],
      },
      {
        Sid: "InspectSstStageState",
        Effect: "Allow",
        Action: ["s3:GetBucketLocation", "s3:ListBucket", "s3:ListBucketVersions"],
        Resource: sstStateBucketArn,
        Condition: {
          StringLike: {
            "s3:prefix": [...sstStageStatePrefixes, sstFallbackSecretPrefix],
          },
        },
      },
      {
        Sid: "UseSstStageState",
        Effect: "Allow",
        Action: ["s3:DeleteObject", "s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"],
        Resource: sstStageStateObjects,
      },
      {
        Sid: "ReadSstFallbackSecret",
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:GetObjectVersion"],
        Resource: `${sstStateBucketArn}/${sstFallbackSecretPrefix}`,
      },
      {
        Sid: "UseSstAssetStorage",
        Effect: "Allow",
        Action: [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:GetObjectTagging",
          "s3:GetObjectVersion",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
          "s3:ListBucketVersions",
          "s3:ListMultipartUploadParts",
          "s3:PutObject",
          "s3:PutObjectTagging",
        ],
        Resource: [sstAssetBucketArn, `${sstAssetBucketArn}/*`],
      },
      {
        Sid: "DeleteSupersededSstAssets",
        Effect: "Allow",
        Action: "s3:DeleteObject",
        Resource: `${sstAssetBucketArn}/assets/*`,
      },
      {
        Sid: "UseSstAssetRepository",
        Effect: "Allow",
        Action: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:BatchGetImage",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeImages",
          "ecr:DescribeRepositories",
          "ecr:GetDownloadUrlForLayer",
          "ecr:InitiateLayerUpload",
          "ecr:ListImages",
          "ecr:PutImage",
          "ecr:UploadLayerPart",
        ],
        Resource: `arn:aws:ecr:${region}:${accountId}:repository/sst-asset`,
      },
      {
        Sid: "ManageStageBuckets",
        Effect: "Allow",
        Action: "s3:*",
        Resource: stageBuckets,
      },
      {
        Sid: "ManageStageTables",
        Effect: "Allow",
        Action: "dynamodb:*",
        Resource: [
          `arn:aws:dynamodb:${region}:${accountId}:table/${resourcePrefix}*`,
          `arn:aws:dynamodb:${region}:${accountId}:table/${resourcePrefix}*/index/*`,
        ],
      },
      {
        Sid: "ManageStageFunctions",
        Effect: "Allow",
        Action: "lambda:*",
        Resource: `arn:aws:lambda:${region}:${accountId}:function:${resourcePrefix}*`,
      },
      {
        Sid: "ManageStageLogs",
        Effect: "Allow",
        Action: "logs:*",
        Resource: [
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/lambda/${resourcePrefix}*:*`,
          `arn:aws:logs:${region}:${accountId}:log-group:/aws/vendedlogs/apis/${resourcePrefix}*:*`,
        ],
      },
      {
        Sid: "CreateTaggedStageApi",
        Effect: "Allow",
        Action: "apigateway:POST",
        Resource: `arn:aws:apigateway:${region}::/apis`,
        Condition: {
          StringLike: {
            "apigateway:Request/ApiName": `${resourcePrefix}*`,
          },
          ...requestTagCondition,
        },
      },
      {
        Sid: "ManageTaggedStageApi",
        Effect: "Allow",
        Action: [
          "apigateway:DELETE",
          "apigateway:GET",
          "apigateway:PATCH",
          "apigateway:POST",
          "apigateway:PUT",
        ],
        Resource: apiArn,
        Condition: resourceTagCondition,
      },
      {
        Sid: "CreateTaggedStageUserPool",
        Effect: "Allow",
        Action: "cognito-idp:CreateUserPool",
        Resource: "*",
        Condition: requestTagCondition,
      },
      {
        Sid: "ManageTaggedStageUserPool",
        Effect: "Allow",
        Action: [
          "cognito-idp:CreateResourceServer",
          "cognito-idp:CreateUserPoolDomain",
          "cognito-idp:CreateUserPoolClient",
          "cognito-idp:DeleteResourceServer",
          "cognito-idp:DeleteUserPool",
          "cognito-idp:DeleteUserPoolClient",
          "cognito-idp:DeleteUserPoolDomain",
          "cognito-idp:DescribeResourceServer",
          "cognito-idp:DescribeUserPool",
          "cognito-idp:DescribeUserPoolClient",
          "cognito-idp:DescribeUserPoolDomain",
          "cognito-idp:ListResourceServers",
          "cognito-idp:ListTagsForResource",
          "cognito-idp:ListUserPoolClients",
          "cognito-idp:TagResource",
          "cognito-idp:UntagResource",
          "cognito-idp:UpdateResourceServer",
          "cognito-idp:UpdateUserPool",
          "cognito-idp:UpdateUserPoolClient",
          "cognito-idp:UpdateUserPoolDomain",
        ],
        Resource: cognitoArn,
        Condition: resourceTagCondition,
      },
      {
        Sid: "CreateTaggedCloudFrontResources",
        Effect: "Allow",
        Action: [
          "cloudfront:CreateDistribution",
          "cloudfront:CreateFunction",
          "cloudfront:CreateKeyValueStore",
        ],
        Resource: "*",
        Condition: requestTagCondition,
      },
      {
        Sid: "ManageTaggedCloudFrontResources",
        Effect: "Allow",
        Action: [
          "cloudfront:CreateInvalidation",
          "cloudfront:DeleteDistribution",
          "cloudfront:DeleteFunction",
          "cloudfront:DeleteKeyValueStore",
          "cloudfront:GetDistribution",
          "cloudfront:GetDistributionConfig",
          "cloudfront:GetFunction",
          "cloudfront:GetInvalidation",
          "cloudfront:DescribeKeyValueStore",
          "cloudfront:ListTagsForResource",
          "cloudfront:PublishFunction",
          "cloudfront:TagResource",
          "cloudfront:UntagResource",
          "cloudfront:UpdateDistribution",
          "cloudfront:UpdateFunction",
          "cloudfront:UpdateKeyValueStore",
        ],
        Resource: cloudFrontResources,
        Condition: resourceTagCondition,
      },
      {
        Sid: "ManageTaggedCloudFrontKeyValues",
        Effect: "Allow",
        Action: "cloudfront-keyvaluestore:*",
        Resource: `arn:aws:cloudfront::${accountId}:key-value-store/*`,
        Condition: resourceTagCondition,
      },
      {
        Sid: "InspectDeploymentAndWorkloadRoles",
        Effect: "Allow",
        Action: [
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListRolePolicies",
          "iam:SimulatePrincipalPolicy",
        ],
        Resource: workloadRoleArn,
      },
      {
        Sid: "InspectWorkloadBoundary",
        Effect: "Allow",
        Action: ["iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListPolicyVersions"],
        Resource: workloadBoundaryArn,
      },
      {
        Sid: "CreateBoundedWorkloadRoles",
        Effect: "Allow",
        Action: "iam:CreateRole",
        Resource: workloadRoleArn,
        Condition: {
          StringEquals: {
            "iam:PermissionsBoundary": workloadBoundaryArn,
            "aws:RequestTag/sst:app": appName,
            "aws:RequestTag/sst:stage": stage,
          },
        },
      },
      {
        Sid: "ManageBoundedWorkloadRoles",
        Effect: "Allow",
        Action: workloadRoleMutationActions.filter(
          (action) => action !== "iam:CreateRole",
        ),
        Resource: workloadRoleArn,
        Condition: {
          StringEquals: {
            "iam:ResourceTag/sst:app": appName,
            "iam:ResourceTag/sst:stage": stage,
          },
        },
      },
      {
        Sid: "PassBoundedRolesOnlyToLambda",
        Effect: "Allow",
        Action: "iam:PassRole",
        Resource: workloadRoleArn,
        Condition: {
          StringEquals: {
            "iam:PassedToService": "lambda.amazonaws.com",
            "iam:ResourceTag/sst:app": appName,
            "iam:ResourceTag/sst:stage": stage,
          },
        },
      },
      {
        Sid: "DenyDeployRoleSelfMutation",
        Effect: "Deny",
        Action: deployRoleSelfMutationActions,
        Resource: deployRoleArn,
      },
    ],
  };
}

export const deploymentPolicyContracts = {
  deployRoleSelfMutationActions,
  globalDiscoveryActions,
  requestTagCondition,
  resourceTagCondition,
} as const;
