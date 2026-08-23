import { describe, expect, it } from "vitest";

import {
  buildTestDeploymentPolicy,
  buildWorkloadBoundaryPolicy,
  deploymentPolicyContracts,
  type IamPolicyStatement,
} from "../deployment-policy";

const accountId = "123456789012";
const boundaryArn =
  "arn:aws:iam::123456789012:policy/auditflow-test-workload-boundary";

function actions(statement: IamPolicyStatement): readonly string[] {
  return Array.isArray(statement.Action)
    ? statement.Action
    : [statement.Action as string];
}

describe("test deployment IAM policy", () => {
  const policy = buildTestDeploymentPolicy({
    accountId,
    workloadBoundaryArn: boundaryArn,
  });

  it("explicitly denies every supported mutation of the deploy role itself", () => {
    const deny = policy.Statement.find(
      ({ Sid }) => Sid === "DenyDeployRoleSelfMutation",
    );

    expect(deny).toEqual({
      Sid: "DenyDeployRoleSelfMutation",
      Effect: "Deny",
      Action: deploymentPolicyContracts.deployRoleSelfMutationActions,
      Resource:
        "arn:aws:iam::123456789012:role/auditflow-test-github-deploy",
    });
    expect(actions(deny!)).toContain("iam:PutRolePolicy");
    expect(actions(deny!)).toContain("iam:UpdateAssumeRolePolicy");
  });

  it("requires the owner-managed boundary when CI creates a workload role", () => {
    const create = policy.Statement.find(
      ({ Sid }) => Sid === "CreateBoundedWorkloadRoles",
    );

    expect(create).toMatchObject({
      Effect: "Allow",
      Action: "iam:CreateRole",
      Resource: "arn:aws:iam::123456789012:role/auditflow-test-*",
      Condition: {
        StringEquals: {
          "iam:PermissionsBoundary": boundaryArn,
          "aws:RequestTag/sst:app": "auditflow",
          "aws:RequestTag/sst:stage": "test",
        },
      },
    });
  });

  it("allows bounded workload roles to be passed only to Lambda", () => {
    const passRole = policy.Statement.find(
      ({ Sid }) => Sid === "PassBoundedRolesOnlyToLambda",
    );

    expect(passRole).toMatchObject({
      Effect: "Allow",
      Action: "iam:PassRole",
      Condition: {
        StringEquals: {
          "iam:PassedToService": "lambda.amazonaws.com",
        },
      },
    });
  });

  it("never grants an administrator action or an unconditioned global mutation", () => {
    for (const statement of policy.Statement) {
      if (statement.Effect !== "Allow") continue;
      expect(actions(statement)).not.toContain("*");
      expect(actions(statement)).not.toContain("iam:*");

      if (statement.Resource !== "*") continue;
      const isDiscoveryOnly = statement.Sid === "GlobalDiscoveryOnly";
      expect(isDiscoveryOnly || statement.Condition).toBeTruthy();
    }
  });

  it("manages only the existing tagged pool and its required OAuth children", () => {
    const discovery = policy.Statement.find(
      ({ Sid }) => Sid === "GlobalDiscoveryOnly",
    );
    const cognito = policy.Statement.find(
      ({ Sid }) => Sid === "ManageTaggedStageUserPool",
    );

    expect(actions(discovery!)).toContain(
      "cognito-idp:DescribeUserPoolDomain",
    );
    expect(discovery?.Resource).toBe("*");
    expect(actions(cognito!)).toEqual(
      expect.arrayContaining([
        "cognito-idp:CreateResourceServer",
        "cognito-idp:CreateUserPoolDomain",
        "cognito-idp:DescribeResourceServer",
        "cognito-idp:UpdateResourceServer",
        "cognito-idp:UpdateUserPoolClient",
      ]),
    );
    expect(actions(cognito!)).not.toContain(
      "cognito-idp:DescribeUserPoolDomain",
    );
    expect(cognito).toMatchObject({
      Resource: "arn:aws:cognito-idp:il-central-1:123456789012:userpool/*",
      Condition: {
        StringEquals: {
          "aws:ResourceTag/sst:app": "auditflow",
          "aws:ResourceTag/sst:stage": "test",
        },
      },
    });
  });

  it("restricts mutable SST state to the AuditFlow test stage", () => {
    const state = policy.Statement.find(
      ({ Sid }) => Sid === "UseSstStageState",
    );
    const assets = policy.Statement.find(
      ({ Sid }) => Sid === "UseSstAssetStorage",
    );
    const assetCleanup = policy.Statement.find(
      ({ Sid }) => Sid === "DeleteSupersededSstAssets",
    );

    expect(state?.Resource).toEqual([
      "arn:aws:s3:::sst-state-kkkvushrzufd/*/auditflow/test.json",
      "arn:aws:s3:::sst-state-kkkvushrzufd/*/auditflow/test/*",
    ]);
    expect(
      policy.Statement.find(({ Sid }) => Sid === "ReadSstFallbackSecret"),
    ).toMatchObject({
      Action: ["s3:GetObject", "s3:GetObjectVersion"],
      Resource:
        "arn:aws:s3:::sst-state-kkkvushrzufd/secret/auditflow/_fallback.json",
    });
    expect(actions(assets!)).not.toContain("s3:DeleteObject");
    expect(actions(assets!)).toContain("s3:PutObjectTagging");
    expect(assetCleanup).toEqual({
      Sid: "DeleteSupersededSstAssets",
      Effect: "Allow",
      Action: "s3:DeleteObject",
      Resource: "arn:aws:s3:::sst-asset-kkkvushrzufd/assets/*",
    });
    expect(JSON.stringify(policy)).not.toContain("sst-state-kkkvushrzufd/*\"");
  });

  it("rejects non-test deployment policies", () => {
    expect(() =>
      buildTestDeploymentPolicy({
        accountId,
        stage: "production",
        workloadBoundaryArn: boundaryArn,
      }),
    ).toThrow("restricted to the test stage");
  });
});

describe("workload permissions boundary", () => {
  it("caps workloads at stage data-plane resources without IAM access", () => {
    const boundary = buildWorkloadBoundaryPolicy(accountId, "test");
    const serialized = JSON.stringify(boundary);

    expect(serialized).toContain("auditflow-test-");
    expect(serialized).not.toContain('"iam:');
    expect(serialized).not.toContain('"sts:');
    expect(
      boundary.Statement.every(({ Resource }) => Resource !== "*"),
    ).toBe(true);
  });
});
