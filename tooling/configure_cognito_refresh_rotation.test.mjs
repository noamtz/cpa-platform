import {
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it, vi } from "vitest";

import {
  buildUpdateInput,
  configureRefreshRotation,
  parseArguments,
} from "./configure_cognito_refresh_rotation.mjs";

const rotation = { feature: "ENABLED", retryGracePeriodSeconds: 10 };

describe("Cognito refresh-token rotation compatibility step", () => {
  it("is restricted to an explicit test-stage invocation", () => {
    expect(parseArguments(["--stage", "test", "--outputs", "outputs.json"])).toEqual({
      stage: "test",
      outputs: "outputs.json",
    });
    expect(() =>
      parseArguments(["--stage", "production", "--outputs", "outputs.json"]),
    ).toThrow("restricted to the test stage");
  });

  it("preserves the described app-client settings while adding rotation", () => {
    const before = {
      UserPoolId: "pool-test",
      ClientId: "client-test",
      CallbackURLs: ["http://localhost:5173/auth/callback"],
      LogoutURLs: ["http://localhost:5173/"],
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: ["openid", "auditflow-api/cpa"],
      ExplicitAuthFlows: ["ALLOW_USER_SRP_AUTH"],
      EnableTokenRevocation: true,
      PreventUserExistenceErrors: "ENABLED",
    };
    expect(buildUpdateInput(before, rotation)).toEqual({
      ...before,
      RefreshTokenRotation: {
        Feature: "ENABLED",
        RetryGracePeriodSeconds: 10,
      },
    });
  });

  it("describes, updates, and verifies convergence without exposing settings", async () => {
    const before = {
      UserPoolId: "pool-test",
      ClientId: "client-test",
      AllowedOAuthFlows: ["code"],
    };
    const after = { ...before, RefreshTokenRotation: {
      Feature: "ENABLED",
      RetryGracePeriodSeconds: 10,
    } };
    const send = vi
      .fn()
      .mockResolvedValueOnce({ UserPoolClient: before })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ UserPoolClient: after });
    await expect(configureRefreshRotation({
      client: { send },
      userPoolId: "pool-test",
      clientId: "client-test",
      rotation,
    })).resolves.toEqual({ updated: true, enabled: true });
    expect(send.mock.calls[0][0]).toBeInstanceOf(DescribeUserPoolClientCommand);
    expect(send.mock.calls[1][0]).toBeInstanceOf(UpdateUserPoolClientCommand);
    expect(send.mock.calls[2][0]).toBeInstanceOf(DescribeUserPoolClientCommand);
  });
});
