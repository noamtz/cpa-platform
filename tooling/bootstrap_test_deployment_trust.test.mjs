import { describe, expect, it } from "vitest";

import { validateBootstrapState } from "./bootstrap_test_deployment_trust.mjs";

const account = "123456789012";
const roleName = "auditflow-test-github-deploy";
const provider = `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`;
const subject = "repo:noamtz@2631641/cpa-platform@1332935468:environment:test";

function role(policy = {}) {
  return {
    RoleName: roleName,
    Tags: [
      { Key: "ManagedBy", Value: "owner-bootstrap" },
      { Key: "sst:app", Value: "auditflow" },
      { Key: "sst:stage", Value: "test" },
    ],
    AssumeRolePolicyDocument: {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Federated: provider },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub": subject,
            },
          },
          ...policy,
        },
      ],
    },
  };
}

describe("test deployment trust bootstrap", () => {
  it("upgrades only the exact owner-tagged prior policy", () => {
    const desired = validateBootstrapState(
      { Account: account, Arn: `arn:aws:iam::${account}:user/owner` },
      role(),
    );
    expect(
      desired.Statement[0].Condition.StringEquals[
        "token.actions.githubusercontent.com:sub"
      ],
    ).toEqual([
      subject,
      "repo:noamtz@2631641/cpa-platform@1332935468:environment:test-legacy-read-enable",
    ]);
  });

  it("rejects self-bootstrap and unexpected trust drift", () => {
    expect(() =>
      validateBootstrapState(
        {
          Account: account,
          Arn: `arn:aws:sts::${account}:assumed-role/${roleName}/run`,
        },
        role(),
      ),
    ).toThrow("cannot bootstrap");
    expect(() =>
      validateBootstrapState(
        { Account: account, Arn: `arn:aws:iam::${account}:user/owner` },
        role({ Action: "sts:*" }),
      ),
    ).toThrow("unexpected statement drift");
  });
});
