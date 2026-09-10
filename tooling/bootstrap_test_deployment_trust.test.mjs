import { describe, expect, it, vi } from "vitest";

import {
  bootstrapTestDeploymentTrust,
  validateBootstrapIdentity,
  validateBootstrapState,
} from "./bootstrap_test_deployment_trust.mjs";

const account = "006296770641";
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
  it("rejects the wrong account before role inspection without disclosure", () => {
    const action = () =>
      validateBootstrapIdentity({
        Account: "123456789012",
        Arn: "arn:aws:iam::123456789012:root",
      });

    expect(action).toThrow(
      "AWS caller does not match the configured AuditFlow test account",
    );
    try {
      action();
    } catch (error) {
      expect(error.message).not.toContain("123456789012");
      expect(error.message).not.toContain(account);
    }
  });

  it("does not inspect IAM when STS returns the wrong account", async () => {
    const iamSend = vi.fn();
    await expect(
      bootstrapTestDeploymentTrust({
        sts: {
          send: vi.fn().mockResolvedValue({
            Account: "123456789012",
            Arn: "arn:aws:iam::123456789012:root",
          }),
        },
        iam: { send: iamSend },
      }),
    ).rejects.toThrow(
      "AWS caller does not match the configured AuditFlow test account",
    );
    expect(iamSend).not.toHaveBeenCalled();
  });

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
