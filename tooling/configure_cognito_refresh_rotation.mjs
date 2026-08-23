import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CognitoIdentityProviderClient,
  DescribeUserPoolClientCommand,
  UpdateUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function parseArguments(argv) {
  const parsed = { stage: undefined, outputs: undefined };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      fail("Expected --stage and --outputs value pairs.");
    }
    const key = flag.slice(2);
    if (!(key in parsed)) fail(`Unknown option: ${flag}`);
    parsed[key] = value;
  }
  if (parsed.stage !== "test") {
    fail("Refresh-rotation configuration is restricted to the test stage.");
  }
  if (!parsed.outputs) fail("Missing --outputs.");
  return parsed;
}

function definedEntries(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

export function buildUpdateInput(client, rotation) {
  return definedEntries({
    UserPoolId: client.UserPoolId,
    ClientId: client.ClientId,
    ClientName: client.ClientName,
    RefreshTokenValidity: client.RefreshTokenValidity,
    AccessTokenValidity: client.AccessTokenValidity,
    IdTokenValidity: client.IdTokenValidity,
    TokenValidityUnits: client.TokenValidityUnits,
    ReadAttributes: client.ReadAttributes,
    WriteAttributes: client.WriteAttributes,
    ExplicitAuthFlows: client.ExplicitAuthFlows,
    SupportedIdentityProviders: client.SupportedIdentityProviders,
    CallbackURLs: client.CallbackURLs,
    LogoutURLs: client.LogoutURLs,
    DefaultRedirectURI: client.DefaultRedirectURI,
    AllowedOAuthFlows: client.AllowedOAuthFlows,
    AllowedOAuthScopes: client.AllowedOAuthScopes,
    AllowedOAuthFlowsUserPoolClient:
      client.AllowedOAuthFlowsUserPoolClient,
    AnalyticsConfiguration: client.AnalyticsConfiguration,
    PreventUserExistenceErrors: client.PreventUserExistenceErrors,
    EnableTokenRevocation: client.EnableTokenRevocation,
    EnablePropagateAdditionalUserContextData:
      client.EnablePropagateAdditionalUserContextData,
    AuthSessionValidity: client.AuthSessionValidity,
    RefreshTokenRotation: {
      Feature: rotation.feature,
      RetryGracePeriodSeconds: rotation.retryGracePeriodSeconds,
    },
  });
}

export async function configureRefreshRotation({
  client,
  userPoolId,
  clientId,
  rotation,
}) {
  const describe = () =>
    client.send(
      new DescribeUserPoolClientCommand({
        UserPoolId: userPoolId,
        ClientId: clientId,
      }),
    );
  const before = (await describe()).UserPoolClient;
  if (!before) fail("Cognito app client was not found.");
  const alreadyConfigured =
    before.RefreshTokenRotation?.Feature === rotation.feature &&
    before.RefreshTokenRotation?.RetryGracePeriodSeconds ===
      rotation.retryGracePeriodSeconds;
  if (!alreadyConfigured) {
    await client.send(
      new UpdateUserPoolClientCommand(buildUpdateInput(before, rotation)),
    );
  }
  const after = (await describe()).UserPoolClient;
  if (
    after?.RefreshTokenRotation?.Feature !== rotation.feature ||
    after.RefreshTokenRotation?.RetryGracePeriodSeconds !==
      rotation.retryGracePeriodSeconds
  ) {
    fail("Cognito refresh-token rotation did not converge.");
  }
  return { updated: !alreadyConfigured, enabled: true };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const outputs = readJson(resolve(args.outputs));
  const contract = readJson(
    resolve("infra", "sst", "foundation-contract.json"),
  );
  if (outputs.stage !== args.stage) fail("SST outputs are for another stage.");
  const result = await configureRefreshRotation({
    client: new CognitoIdentityProviderClient({}),
    userPoolId: outputs.userPoolId,
    clientId: outputs.userPoolClientId,
    rotation: contract.auth.refreshTokenRotation,
  });
  process.stdout.write(
    `${JSON.stringify({ stage: args.stage, ...result })}\n`,
  );
}

if (process.argv[1]?.endsWith("configure_cognito_refresh_rotation.mjs")) {
  main().catch((error) => {
    process.stderr.write(`Cognito refresh configuration failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
