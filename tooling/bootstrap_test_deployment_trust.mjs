import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GetRoleCommand,
  IAMClient,
  UpdateAssumeRolePolicyCommand,
} from "@aws-sdk/client-iam";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(
  readFileSync(resolve(repositoryRoot, "infra/sst/foundation-contract.json"), "utf8"),
);
const roleName = "auditflow-test-github-deploy";

function fail(message) {
  throw new Error(message);
}

function expectedTrust(accountId, subjects) {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: {
          Federated: `arn:aws:iam::${accountId}:oidc-provider/${contract.oidc.providerUrl}`,
        },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            [`${contract.oidc.providerUrl}:aud`]: contract.oidc.audience,
            [`${contract.oidc.providerUrl}:sub`]: subjects,
          },
        },
      },
    ],
  };
}

function normalized(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(normalized).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${normalized(value[key])}`)
    .join(",")}}`;
}

function exactKeys(value, expected) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    normalized(Object.keys(value).sort()) === normalized([...expected].sort())
  );
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function trustSubjects(policy, accountId) {
  if (typeof policy === "string") {
    try {
      policy = JSON.parse(decodeURIComponent(policy));
    } catch {
      fail("Existing role trust is not valid JSON");
    }
  }
  if (!exactKeys(policy, ["Version", "Statement"]) || policy.Version !== "2012-10-17") {
    fail("Existing role trust has unexpected document structure");
  }
  const statements = policy.Statement;
  if (!Array.isArray(statements) || statements.length !== 1) {
    fail("Existing role trust must contain exactly one statement");
  }
  const [statement] = statements;
  if (
    !exactKeys(statement, ["Effect", "Principal", "Action", "Condition"]) ||
    statement.Effect !== "Allow" ||
    normalized(asArray(statement.Action)) !==
      normalized(["sts:AssumeRoleWithWebIdentity"]) ||
    !exactKeys(statement.Principal, ["Federated"]) ||
    normalized(asArray(statement.Principal.Federated)) !==
      normalized([
        `arn:aws:iam::${accountId}:oidc-provider/${contract.oidc.providerUrl}`,
      ]) ||
    !exactKeys(statement.Condition, ["StringEquals"]) ||
    !exactKeys(statement.Condition.StringEquals, [
      `${contract.oidc.providerUrl}:aud`,
      `${contract.oidc.providerUrl}:sub`,
    ]) ||
    normalized(
      asArray(
        statement.Condition.StringEquals[`${contract.oidc.providerUrl}:aud`],
      ),
    ) !== normalized([contract.oidc.audience])
  ) {
    fail("Existing role trust has unexpected statement drift");
  }
  return asArray(
    statement.Condition.StringEquals[`${contract.oidc.providerUrl}:sub`],
  );
}

export function validateBootstrapState(identity, role) {
  if (!/^\d{12}$/.test(identity.Account ?? "")) fail("Unexpected AWS account identity");
  if (identity.Arn?.includes(`assumed-role/${roleName}/`)) {
    fail("The deploy role cannot bootstrap its own trust policy");
  }
  const tags = Object.fromEntries((role.Tags ?? []).map(({ Key, Value }) => [Key, Value]));
  if (
    role.RoleName !== roleName ||
    tags.ManagedBy !== "owner-bootstrap" ||
    tags["sst:app"] !== "auditflow" ||
    tags["sst:stage"] !== "test"
  ) {
    fail("The deployed role does not match the owner-bootstrap test contract");
  }
  const desired = expectedTrust(identity.Account, [
    contract.oidc.subject,
    contract.oidc.enablementSubject,
  ]);
  const subjects = trustSubjects(role.AssumeRolePolicyDocument, identity.Account);
  if (
    normalized(subjects) !== normalized([contract.oidc.subject]) &&
    normalized(subjects) !==
      normalized([contract.oidc.subject, contract.oidc.enablementSubject])
  ) {
    fail("Existing role trust has unexpected drift");
  }
  return desired;
}

export async function bootstrapTestDeploymentTrust({ sts, iam } = {}) {
  const credentials = fromIni({ profile: process.env.AWS_PROFILE ?? "default" });
  const stsClient = sts ?? new STSClient({ region: "il-central-1", credentials });
  const iamClient = iam ?? new IAMClient({ region: "il-central-1", credentials });
  const identity = await stsClient.send(new GetCallerIdentityCommand({}));
  const before = (await iamClient.send(new GetRoleCommand({ RoleName: roleName }))).Role;
  if (!before) fail("The test deploy role does not exist");
  const desired = validateBootstrapState(identity, before);
  if (
    normalized(trustSubjects(before.AssumeRolePolicyDocument, identity.Account)) !==
    normalized([contract.oidc.subject, contract.oidc.enablementSubject])
  ) {
    await iamClient.send(
      new UpdateAssumeRolePolicyCommand({
        RoleName: roleName,
        PolicyDocument: JSON.stringify(desired),
      }),
    );
  }
  const after = (await iamClient.send(new GetRoleCommand({ RoleName: roleName }))).Role;
  if (!after) fail("The test deploy role disappeared during bootstrap");
  if (
    normalized(trustSubjects(after.AssumeRolePolicyDocument, identity.Account)) !==
    normalized([contract.oidc.subject, contract.oidc.enablementSubject])
  ) {
    fail("Trust-policy readback did not match the exact two-subject contract");
  }
  return { status: "verified", stage: "test", subjects: 2 };
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    if (
      process.argv.length !== 3 ||
      process.argv[2] !== "--confirm-test-trust-bootstrap"
    ) {
      fail("Explicit --confirm-test-trust-bootstrap confirmation is required");
    }
    process.stdout.write(`${JSON.stringify(await bootstrapTestDeploymentTrust())}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Trust bootstrap failed"}\n`);
    process.exitCode = 1;
  }
}
