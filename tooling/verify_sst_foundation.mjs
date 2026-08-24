import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const contractPath = resolve(
  repositoryRoot,
  "infra/sst/foundation-contract.json",
);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArguments(argv) {
  const parsed = { mode: undefined, stage: undefined, outputs: undefined };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      fail("Expected --mode, --stage, and optional --outputs value pairs.");
    }
    const key = flag.slice(2);
    if (!(key in parsed)) fail(`Unknown verifier option: ${flag}`);
    parsed[key] = value;
  }
  return parsed;
}

function verifyContract(contract, stage) {
  assert(contract.schemaVersion === 2, "Unsupported contract schema version.");
  assert(contract.app === "auditflow", "Unexpected SST application name.");
  assert(contract.sstVersion === "3.19.3", "SST version must be 3.19.3.");
  assert(contract.region === "il-central-1", "Unexpected AWS region.");
  assert(
    JSON.stringify(contract.stages) === JSON.stringify(["test", "production"]),
    "Only test and production stages are permitted.",
  );
  assert(contract.stages.includes(stage), `Invalid contract stage: ${stage}`);
  assert(contract.tables.length === 7, "Expected exactly seven tables.");
  assert(contract.buckets.length === 2, "Expected exactly two buckets.");
  assert(
    new Set(contract.tables.map(({ logicalName }) => logicalName)).size === 7,
    "Table logical names must be unique.",
  );
  assert(
    contract.tables.every(({ primaryIndex }) => primaryIndex?.hashKey),
    "Every table requires a primary hash key.",
  );
  assert(
    contract.buckets.every((bucket) => bucket.private && bucket.cors === false),
    "Every foundation bucket must be private with browser CORS disabled.",
  );
  const filesBucket = contract.buckets.find(
    ({ logicalName }) => logicalName === "FilesBucket",
  );
  const temporaryBucket = contract.buckets.find(
    ({ logicalName }) => logicalName === "TemporaryOutputsBucket",
  );
  assert(filesBucket?.versioning === true, "FilesBucket must be versioned.");
  assert(
    temporaryBucket?.expirationDays === 1,
    "Temporary outputs must expire after one day.",
  );
  assert(
    contract.routes.some(
      ({ route, authorization }) =>
        route === "GET /health" && authorization === "none",
    ),
    "Public health route contract is missing.",
  );
  assert(
    contract.routes.some(
      ({ route, authorization }) =>
        route === "GET /auth/health" && authorization === "cognito-jwt",
    ),
    "Protected health route contract is missing.",
  );
  const publicQuestionnaireRoutes = contract.routes.filter(({ route }) =>
    route.includes(" /apps/{appId}/functions/"),
  );
  assert(
    JSON.stringify(publicQuestionnaireRoutes) ===
      JSON.stringify([
        {
          route: "POST /apps/{appId}/functions/getClientByToken",
          authorization: "none",
        },
        {
          route: "POST /apps/{appId}/functions/getActiveTemplate",
          authorization: "none",
        },
        {
          route: "POST /apps/{appId}/functions/getTemplateById",
          authorization: "none",
        },
        {
          route: "POST /apps/{appId}/functions/updateClientSubmission",
          authorization: "none",
        },
      ]),
    "The exact public questionnaire route inventory is incomplete.",
  );
  const cpaRoutes = contract.routes.filter(({ route }) =>
    route.includes(" /cpa/"),
  );
  assert(cpaRoutes.length === 14, "The exact CPA route inventory is incomplete.");
  assert(
    cpaRoutes.every(
      ({ authorization, authorizationScopes }) =>
        authorization === "cognito-jwt" &&
        JSON.stringify(authorizationScopes) ===
          JSON.stringify(["auditflow-api/cpa"]),
    ),
    "Every CPA route must require the exact custom access-token scope.",
  );
  assert(
    new Set(contract.routes.map(({ route }) => route)).size ===
      contract.routes.length,
    "API routes must be unique.",
  );
  assert(
    contract.auth.resourceServerIdentifier === "auditflow-api" &&
      contract.auth.scopeName === "cpa" &&
      contract.auth.authorityType === "regional-user-pool-issuer" &&
      contract.auth.apiScope === "auditflow-api/cpa" &&
      JSON.stringify(contract.auth.allowedOAuthFlows) ===
        JSON.stringify(["code"]) &&
      JSON.stringify(contract.auth.allowedOAuthScopes) ===
        JSON.stringify(["openid", "auditflow-api/cpa"]) &&
      contract.auth.clientSecret === false &&
      contract.auth.refreshTokenRotation.feature === "ENABLED",
    "Managed-login and CPA scope contracts have drifted.",
  );
  assert(
    contract.router.apiPrefix === "/api" &&
      contract.router.rewritePattern === "^/api/(.*)$" &&
      contract.router.rewriteReplacement === "/$1",
    "Same-origin Router rewrite contract has drifted.",
  );
  assert(
    contract.oidc.audience === "sts.amazonaws.com" &&
      contract.oidc.subject ===
        "repo:noamtz@2631641/cpa-platform@1332935468:environment:test" &&
      !contract.oidc.subject.includes("*") &&
      !contract.oidc.subject.includes("noamtz/auditflow"),
    "OIDC trust must use the exact immutable test Environment subject.",
  );
  assert(
    Object.values(contract.inventory).every((count) => Number.isInteger(count)),
    "Inventory counts must be integers.",
  );

  return {
    mode: "contract",
    stage,
    sstVersion: contract.sstVersion,
    region: contract.region,
    inventory: contract.inventory,
    oidc: { exactAudience: true, exactSubject: true },
  };
}

const retryableAwsErrorCodes = new Set([
  "InternalError",
  "InternalFailure",
  "RequestLimitExceeded",
  "ServiceUnavailableException",
  "Throttling",
  "ThrottlingException",
  "TooManyRequestsException",
]);

export function parseAwsCliErrorCode(stderr) {
  return /\(([^()]+)\)\s+when calling/.exec(stderr)?.[1];
}

export function isRetryableAwsCliFailure(result) {
  if (result.error?.code && ["ECONNRESET", "ETIMEDOUT"].includes(result.error.code)) {
    return true;
  }

  const stderr = result.stderr ?? "";
  const errorCode = parseAwsCliErrorCode(stderr);
  return (
    retryableAwsErrorCodes.has(errorCode) ||
    /connect timeout|read timeout|could not connect to the endpoint|connection (?:was )?(?:closed|reset)|temporarily unavailable|tls handshake timeout/i.test(
      stderr,
    )
  );
}

function waitSynchronously(delayMilliseconds) {
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    delayMilliseconds,
  );
}

export function retryAwsCliCommand(
  execute,
  { maxAttempts = 3, delayMilliseconds = 2_000, wait = waitSynchronously } = {},
) {
  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = execute();
    if (
      result.status === 0 ||
      attempt === maxAttempts ||
      !isRetryableAwsCliFailure(result)
    ) {
      return result;
    }
    wait(delayMilliseconds * attempt);
  }
  return result;
}

function runAws(arguments_, { allowFailure = false } = {}) {
  const result = retryAwsCliCommand(() =>
    spawnSync("aws", [...arguments_, "--output", "json"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      windowsHide: true,
      env: process.env,
    }),
  );
  if (result.error) {
    fail(`AWS CLI could not run ${arguments_[0]} ${arguments_[1] ?? ""}.`);
  }
  if (result.status !== 0) {
    if (allowFailure) return { ok: false, stderr: result.stderr };
    fail(`AWS verification failed for ${arguments_[0]} ${arguments_[1] ?? ""}.`);
  }
  return {
    ok: true,
    value: result.stdout.trim() ? JSON.parse(result.stdout) : {},
  };
}

export function assertBrowserCorsAbsent(result, logicalName) {
  if (result.ok) {
    fail(`${logicalName} unexpectedly has browser CORS configured.`);
  }

  const errorCode = parseAwsCliErrorCode(result.stderr ?? "");
  assert(
    errorCode === "NoSuchCORSConfiguration",
    `${logicalName} CORS verification failed with ${errorCode ?? "an unknown AWS error"}.`,
  );
}

function assertHttpsUrl(value, label, hostSuffix, expectedPath) {
  const url = new URL(value);
  assert(url.protocol === "https:", `${label} must use HTTPS.`);
  assert(url.hostname.endsWith(hostSuffix), `${label} has an unexpected host.`);
  if (expectedPath) {
    assert(url.pathname === expectedPath, `${label} has an unexpected path.`);
  }
  assert(!url.username && !url.password, `${label} must not contain credentials.`);
  return url;
}

function asArray(value) {
  return Array.isArray(value) ? value : [value];
}

function findPolicyStatement(policy, sid) {
  return policy.Statement.find((statement) => statement.Sid === sid);
}

function simulatePrincipalAction(roleArn, action, resourceArn, context = []) {
  const arguments_ = [
    "iam",
    "simulate-principal-policy",
    "--policy-source-arn",
    roleArn,
    "--action-names",
    action,
    "--resource-arns",
    resourceArn,
  ];
  if (context.length > 0) {
    arguments_.push("--context-entries", ...context);
  }
  const result = runAws(arguments_).value.EvaluationResults?.[0];
  assert(result?.EvalActionName === action, `IAM simulation omitted ${action}.`);
  return result.EvalDecision;
}

async function fetchText(url, expectedStatus) {
  const response = await fetch(url, { redirect: "manual" });
  assert(
    response.status === expectedStatus,
    `Unexpected HTTP status for ${new URL(url).pathname}.`,
  );
  return { response, text: await response.text() };
}

async function verifyLive(contract, stage, outputsPath) {
  assert(stage === "test", "Live verification is restricted to the test stage.");
  const outputs = readJson(resolve(repositoryRoot, outputsPath));
  assert(outputs.stage === "test", "Deployment outputs are not for the test stage.");
  for (const key of contract.outputKeys) {
    assert(key in outputs, `Missing required SST output: ${key}`);
  }

  const routerUrl = assertHttpsUrl(
    outputs.routerUrl,
    "Router URL",
    ".cloudfront.net",
  );
  assertHttpsUrl(
    outputs.apiUrl,
    "API URL",
    ".execute-api.il-central-1.amazonaws.com",
  );
  const authAuthority = assertHttpsUrl(
    outputs.authAuthority,
    "Cognito authority",
    "cognito-idp.il-central-1.amazonaws.com",
    `/${outputs.userPoolId}`,
  );
  assert(
    outputs.authCallbackUrl ===
      `${outputs.routerUrl}${contract.auth.callbackPath}`,
    "Primary callback URL does not use the Router origin.",
  );
  assert(
    outputs.authLogoutUrl === `${outputs.routerUrl}${contract.auth.logoutPath}`,
    "Primary logout URL does not use the Router origin.",
  );
  assert(
    outputs.authScope === contract.auth.allowedOAuthScopes.join(" "),
    "Browser scopes have drifted.",
  );
  assertHttpsUrl(outputs.healthUrl, "Health URL", routerUrl.hostname, "/api/health");
  assertHttpsUrl(
    outputs.protectedHealthUrl,
    "Protected health URL",
    routerUrl.hostname,
    "/api/auth/health",
  );

  const expectedTableNames = contract.tables.map(({ logicalName }) => logicalName);
  const expectedBucketNames = contract.buckets.map(({ logicalName }) => logicalName);
  assert(
    JSON.stringify(Object.keys(outputs.tableNames).sort()) ===
      JSON.stringify([...expectedTableNames].sort()),
    "Deployed table output inventory differs from the contract.",
  );
  assert(
    JSON.stringify(Object.keys(outputs.bucketNames).sort()) ===
      JSON.stringify([...expectedBucketNames].sort()),
    "Deployed bucket output inventory differs from the contract.",
  );

  for (const logicalName of expectedTableNames) {
    const tableName = outputs.tableNames[logicalName];
    const description = runAws([
      "dynamodb",
      "describe-table",
      "--table-name",
      tableName,
    ]).value.Table;
    assert(description.TableStatus === "ACTIVE", `${logicalName} is not ACTIVE.`);
    assert(
      description.BillingModeSummary?.BillingMode === "PAY_PER_REQUEST",
      `${logicalName} is not on-demand.`,
    );
    const backups = runAws([
      "dynamodb",
      "describe-continuous-backups",
      "--table-name",
      tableName,
    ]).value.ContinuousBackupsDescription;
    assert(
      backups.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus ===
        "ENABLED",
      `${logicalName} does not have PITR enabled.`,
    );
    if (logicalName === "UserTable") {
      const createdDateIndex = description.GlobalSecondaryIndexes?.find(
        ({ IndexName }) => IndexName === "byCreatedDate",
      );
      assert(
        createdDateIndex?.IndexStatus === "ACTIVE" &&
          JSON.stringify(createdDateIndex.KeySchema) ===
            JSON.stringify([
              { AttributeName: "record_type", KeyType: "HASH" },
              { AttributeName: "created_date", KeyType: "RANGE" },
            ]),
        "UserTable byCreatedDate index is missing or invalid.",
      );
    }
  }

  for (const logicalName of expectedBucketNames) {
    const bucketName = outputs.bucketNames[logicalName];
    const publicAccess = runAws([
      "s3api",
      "get-public-access-block",
      "--bucket",
      bucketName,
    ]).value.PublicAccessBlockConfiguration;
    assert(
      [
        "BlockPublicAcls",
        "IgnorePublicAcls",
        "BlockPublicPolicy",
        "RestrictPublicBuckets",
      ].every((key) => publicAccess[key] === true),
      `${logicalName} does not block all public access.`,
    );
    const cors = runAws(
      ["s3api", "get-bucket-cors", "--bucket", bucketName],
      { allowFailure: true },
    );
    assertBrowserCorsAbsent(cors, logicalName);
  }

  const fileVersioning = runAws([
    "s3api",
    "get-bucket-versioning",
    "--bucket",
    outputs.bucketNames.FilesBucket,
  ]).value;
  assert(fileVersioning.Status === "Enabled", "FilesBucket versioning is not enabled.");
  const lifecycle = runAws([
    "s3api",
    "get-bucket-lifecycle-configuration",
    "--bucket",
    outputs.bucketNames.TemporaryOutputsBucket,
  ]).value;
  assert(
    lifecycle.Rules?.some(
      (rule) => rule.Status === "Enabled" && rule.Expiration?.Days === 1,
    ),
    "Temporary output one-day expiration is missing.",
  );

  const userPool = runAws([
    "cognito-idp",
    "describe-user-pool",
    "--user-pool-id",
    outputs.userPoolId,
  ]).value.UserPool;
  assert(userPool.Status === undefined || userPool.Status === "Enabled", "User pool is unavailable.");
  const userPoolClient = runAws([
    "cognito-idp",
    "describe-user-pool-client",
    "--user-pool-id",
    outputs.userPoolId,
    "--client-id",
    outputs.userPoolClientId,
  ]).value.UserPoolClient;
  assert(!userPoolClient.ClientSecret, "Browser client must not have a secret.");
  assert(
    JSON.stringify(userPoolClient.AllowedOAuthFlows) ===
      JSON.stringify(contract.auth.allowedOAuthFlows),
    "Browser client must allow authorization code only.",
  );
  assert(
    JSON.stringify([...(userPoolClient.AllowedOAuthScopes ?? [])].sort()) ===
      JSON.stringify([...contract.auth.allowedOAuthScopes].sort()),
    "Browser client OAuth scopes have drifted.",
  );
  const expectedCallbackUrls = [
    outputs.authCallbackUrl,
    `${contract.auth.localOrigin}${contract.auth.callbackPath}`,
  ];
  const expectedLogoutUrls = [
    outputs.authLogoutUrl,
    `${contract.auth.localOrigin}${contract.auth.logoutPath}`,
  ];
  assert(
    JSON.stringify([...(userPoolClient.CallbackURLs ?? [])].sort()) ===
      JSON.stringify(expectedCallbackUrls.sort()),
    "Browser client callback URLs have drifted.",
  );
  assert(
    JSON.stringify([...(userPoolClient.LogoutURLs ?? [])].sort()) ===
      JSON.stringify(expectedLogoutUrls.sort()),
    "Browser client logout URLs have drifted.",
  );
  assert(
    userPoolClient.RefreshTokenValidity ===
      contract.auth.refreshTokenValidityDays &&
      userPoolClient.RefreshTokenRotation?.Feature === "ENABLED" &&
      userPoolClient.RefreshTokenRotation?.RetryGracePeriodSeconds ===
        contract.auth.refreshTokenRotation.retryGracePeriodSeconds,
    "Refresh-token rotation is not configured exactly.",
  );
  const discovery = await fetchText(
    `${authAuthority.href.replace(/\/$/, "")}/.well-known/openid-configuration`,
    200,
  );
  let discoveryMetadata;
  try {
    discoveryMetadata = JSON.parse(discovery.text);
  } catch {
    fail("Cognito OIDC discovery did not return JSON.");
  }
  assert(
    discoveryMetadata.issuer === outputs.authAuthority,
    "Cognito discovery issuer differs from the browser authority.",
  );
  const authorizationEndpoint = assertHttpsUrl(
    discoveryMetadata.authorization_endpoint,
    "Cognito authorization endpoint",
    ".amazoncognito.com",
    "/oauth2/authorize",
  );
  const domainMarker = authorizationEndpoint.hostname.indexOf(".auth.");
  assert(domainMarker > 0, "Cognito authorization endpoint is not on the managed-login domain.");
  const domainPrefix = authorizationEndpoint.hostname.slice(0, domainMarker);
  const domain = runAws([
    "cognito-idp",
    "describe-user-pool-domain",
    "--domain",
    domainPrefix,
  ]).value.DomainDescription;
  assert(
    domain.UserPoolId === outputs.userPoolId && domain.Status === "ACTIVE",
    "Managed-login domain is unavailable or linked to another pool.",
  );
  const resourceServers = runAws([
    "cognito-idp",
    "list-resource-servers",
    "--user-pool-id",
    outputs.userPoolId,
    "--max-results",
    "50",
  ]).value.ResourceServers;
  const resourceServer = resourceServers?.find(
    ({ Identifier }) => Identifier === contract.auth.resourceServerIdentifier,
  );
  assert(
    resourceServer?.Scopes?.some(
      ({ ScopeName }) => ScopeName === contract.auth.scopeName,
    ),
    "CPA Cognito resource-server scope is missing.",
  );

  const api = runAws(["apigatewayv2", "get-api", "--api-id", outputs.apiId]).value;
  assert(api.ProtocolType === "HTTP", "Expected an API Gateway HTTP API.");
  const deployedRoutes = runAws([
    "apigatewayv2",
    "get-routes",
    "--api-id",
    outputs.apiId,
  ]).value.Items;
  for (const routeContract of contract.routes.filter(({ route }) =>
    route.includes(" /cpa/"),
  )) {
    const deployedRoute = deployedRoutes?.find(
      ({ RouteKey }) => RouteKey === routeContract.route,
    );
    assert(
      deployedRoute?.AuthorizationType === "JWT" &&
        JSON.stringify(deployedRoute.AuthorizationScopes) ===
          JSON.stringify(routeContract.authorizationScopes),
      `CPA route ${routeContract.route} is missing JWT scope authorization.`,
    );
  }
  for (const routeContract of contract.routes.filter(({ route }) =>
    route.includes(" /apps/{appId}/functions/"),
  )) {
    const deployedRoute = deployedRoutes?.find(
      ({ RouteKey }) => RouteKey === routeContract.route,
    );
    assert(
      deployedRoute?.AuthorizationType === "NONE",
      `Public questionnaire route ${routeContract.route} must not use the Cognito authorizer.`,
    );
  }
  const lambda = runAws([
    "lambda",
    "get-function-configuration",
    "--function-name",
    outputs.apiFunctionName,
  ]).value;
  assert(lambda.Runtime === "nodejs20.x", "API Lambda runtime has drifted.");
  assert(lambda.Architectures?.includes("arm64"), "API Lambda is not arm64.");
  const distribution = runAws([
    "cloudfront",
    "get-distribution",
    "--id",
    outputs.routerDistributionId,
  ]).value.Distribution;
  assert(distribution.Status === "Deployed", "Router distribution is not deployed.");

  const roleArn = outputs.testDeployRoleArn;
  assert(
    /^arn:aws:iam::\d{12}:role\/auditflow-test-github-deploy$/.test(roleArn),
    "Unexpected test deploy-role ARN.",
  );
  const roleName = roleArn.slice(roleArn.lastIndexOf("/") + 1);
  const role = runAws(["iam", "get-role", "--role-name", roleName]).value.Role;
  const trustStatement = role.AssumeRolePolicyDocument?.Statement?.find(
    (statement) => statement.Action === "sts:AssumeRoleWithWebIdentity",
  );
  const trustConditions = trustStatement?.Condition?.StringEquals;
  assert(
    trustStatement?.Principal?.Federated?.endsWith(
      ":oidc-provider/token.actions.githubusercontent.com",
    ) &&
      trustConditions?.["token.actions.githubusercontent.com:aud"] ===
        contract.oidc.audience &&
      trustConditions?.["token.actions.githubusercontent.com:sub"] ===
        contract.oidc.subject,
    "Test deploy role does not have the exact GitHub OIDC trust contract.",
  );
  const attachedPolicies = runAws([
    "iam",
    "list-attached-role-policies",
    "--role-name",
    roleName,
  ]).value.AttachedPolicies;
  assert(
    attachedPolicies.length === 0,
    "Test deploy role must not have managed policies attached.",
  );
  const inlinePolicyNames = runAws([
    "iam",
    "list-role-policies",
    "--role-name",
    roleName,
  ]).value.PolicyNames;
  assert(
    JSON.stringify(inlinePolicyNames) ===
      JSON.stringify(["auditflow-test-foundation-deploy"]),
    "Test deploy role must have exactly one scoped inline policy.",
  );
  const inlinePolicy = runAws([
    "iam",
    "get-role-policy",
    "--role-name",
    roleName,
    "--policy-name",
    inlinePolicyNames[0],
  ]).value.PolicyDocument;
  assert(
    inlinePolicy.Statement.every(
      (statement) =>
        !asArray(statement.Action).includes("*") &&
        !asArray(statement.Action).includes("iam:*"),
    ),
    "Test deploy role contains an administrator-style action.",
  );
  const selfDeny = findPolicyStatement(
    inlinePolicy,
    "DenyDeployRoleSelfMutation",
  );
  assert(
    selfDeny?.Effect === "Deny" &&
      asArray(selfDeny.Resource).includes(roleArn) &&
      asArray(selfDeny.Action).includes("iam:PutRolePolicy") &&
      asArray(selfDeny.Action).includes("iam:UpdateAssumeRolePolicy"),
    "Test deploy role is not explicitly protected from self-mutation.",
  );
  const boundedCreate = findPolicyStatement(
    inlinePolicy,
    "CreateBoundedWorkloadRoles",
  );
  const workloadBoundaryArn =
    boundedCreate?.Condition?.StringEquals?.["iam:PermissionsBoundary"];
  assert(
    typeof workloadBoundaryArn === "string" &&
      workloadBoundaryArn.endsWith("/auditflow-test-workload-boundary"),
    "Workload-role creation does not require the test permissions boundary.",
  );
  const passRole = findPolicyStatement(
    inlinePolicy,
    "PassBoundedRolesOnlyToLambda",
  );
  assert(
    passRole?.Condition?.StringEquals?.["iam:PassedToService"] ===
      "lambda.amazonaws.com",
    "iam:PassRole is not restricted to Lambda.",
  );
  assert(
    inlinePolicy.Statement.every((statement) => {
      if (statement.Effect !== "Allow" || statement.Resource !== "*") {
        return true;
      }
      return statement.Sid === "GlobalDiscoveryOnly" || statement.Condition;
    }),
    "A service mutation retains unconditioned global resource scope.",
  );

  const policyFindings = runAws([
    "accessanalyzer",
    "validate-policy",
    "--policy-type",
    "IDENTITY_POLICY",
    "--policy-document",
    JSON.stringify(inlinePolicy),
  ]).value.findings;
  const blockingPolicyFindings = policyFindings.filter(({ findingType }) =>
    ["ERROR", "SECURITY_WARNING"].includes(findingType),
  );
  assert(
    blockingPolicyFindings.length === 0,
    `Access Analyzer reported blocking policy findings: ${blockingPolicyFindings
      .map(
        ({ findingType, issueCode, findingDetails }) =>
          `${findingType}:${issueCode}:${findingDetails}`,
      )
      .join(", ")}.`,
  );

  const workloadRoleArn = lambda.Role;
  const workloadRoleName = workloadRoleArn.slice(
    workloadRoleArn.lastIndexOf("/") + 1,
  );
  const workloadRole = runAws([
    "iam",
    "get-role",
    "--role-name",
    workloadRoleName,
  ]).value.Role;
  assert(
    workloadRole.PermissionsBoundary?.PermissionsBoundaryArn ===
      workloadBoundaryArn,
    "API Lambda role is missing the workload permissions boundary.",
  );
  const workloadBoundary = runAws([
    "iam",
    "get-policy",
    "--policy-arn",
    workloadBoundaryArn,
  ]).value.Policy;
  const workloadBoundaryDocument = runAws([
    "iam",
    "get-policy-version",
    "--policy-arn",
    workloadBoundaryArn,
    "--version-id",
    workloadBoundary.DefaultVersionId,
  ]).value.PolicyVersion.Document;
  assert(
    workloadBoundaryDocument.Statement.every(
      (statement) =>
        asArray(statement.Resource).every((resource) => resource !== "*") &&
        asArray(statement.Action).every(
          (action) => !action.startsWith("iam:") && !action.startsWith("sts:"),
        ),
    ),
    "Workload permissions boundary permits global, IAM, or STS access.",
  );

  const workloadProbeArn = roleArn.replace(
    "auditflow-test-github-deploy",
    "auditflow-test-policy-probe",
  );
  const tagContext = [
    "ContextKeyName=iam:ResourceTag/sst:app,ContextKeyValues=auditflow,ContextKeyType=string",
    "ContextKeyName=iam:ResourceTag/sst:stage,ContextKeyValues=test,ContextKeyType=string",
  ];
  assert(
    simulatePrincipalAction(
      roleArn,
      "iam:PutRolePolicy",
      roleArn,
    ) === "explicitDeny",
    "Policy simulation did not deny deploy-role self-mutation.",
  );
  assert(
    simulatePrincipalAction(
      roleArn,
      "iam:CreateRole",
      workloadProbeArn,
    ) !== "allowed",
    "Policy simulation allowed a workload role without the boundary.",
  );
  assert(
    simulatePrincipalAction(
      roleArn,
      "iam:PassRole",
      workloadProbeArn,
      [
        ...tagContext,
        "ContextKeyName=iam:PassedToService,ContextKeyValues=ec2.amazonaws.com,ContextKeyType=string",
      ],
    ) !== "allowed",
    "Policy simulation allowed a workload role to be passed outside Lambda.",
  );
  assert(
    simulatePrincipalAction(
      roleArn,
      "s3:DeleteBucket",
      "arn:aws:s3:::unrelated-policy-probe",
    ) !== "allowed",
    "Policy simulation allowed mutation of an unrelated S3 bucket.",
  );
  assert(
    simulatePrincipalAction(
      roleArn,
      "s3:PutObject",
      "arn:aws:s3:::sst-state-kkkvushrzufd/app/unrelated/production",
    ) !== "allowed",
    "Policy simulation allowed mutation of unrelated SST state.",
  );
  assert(
    simulatePrincipalAction(
      roleArn,
      "lambda:DeleteFunction",
      roleArn.replace(
        /arn:aws:iam::(\d+):role\/.+/,
        "arn:aws:lambda:il-central-1:$1:function:unrelated-policy-probe",
      ),
    ) !== "allowed",
    "Policy simulation allowed mutation of an unrelated Lambda function.",
  );

  const root = await fetchText(outputs.routerUrl, 200);
  const deepLink = await fetchText(`${outputs.routerUrl}/clients`, 200);
  assert(root.text.includes("id=\"root\""), "Router root did not return the Vite shell.");
  assert(
    deepLink.text.includes("id=\"root\""),
    "SPA deep link did not return the Vite shell.",
  );
  const health = await fetchText(outputs.healthUrl, 200);
  assert(
    health.response.headers.get("content-type")?.includes("application/json"),
    "Health response is not JSON.",
  );
  assert(
    JSON.stringify(JSON.parse(health.text)) ===
      JSON.stringify({ ok: true, service: "auditflow-api", stage: "test" }),
    "Health response body has drifted.",
  );
  const protectedHealth = await fetch(outputs.protectedHealthUrl, {
    redirect: "manual",
  });
  assert(
    [401, 403].includes(protectedHealth.status),
    "Protected health route accepted an unauthenticated request.",
  );

  return {
    mode: "live",
    stage,
    inventory: contract.inventory,
    statuses: {
      tablesActive: contract.inventory.tables,
      tablesOnDemand: contract.inventory.tables,
      tablesPitrEnabled: contract.inventory.tables,
      bucketsPrivate: contract.inventory.buckets,
      filesVersioned: true,
      temporaryExpirationDays: 1,
      apiHttp: true,
      lambdaNode20Arm64: true,
      routerDeployed: true,
      managedLoginConfigured: true,
      refreshRotationEnabled: true,
      cpaRoutesScoped: 14,
      exactOidcTrust: true,
      noAdministratorPolicy: true,
      noDeployRoleSelfMutation: true,
      workloadBoundaryAttached: true,
      passRoleLambdaOnly: true,
      serviceMutationsScoped: true,
      accessAnalyzerClean: true,
      iamSimulationPassed: true,
      healthOk: true,
      protectedHealthRejected: true,
    },
    urls: {
      routerUrl: outputs.routerUrl,
      healthUrl: outputs.healthUrl,
      protectedHealthUrl: outputs.protectedHealthUrl,
    },
  };
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  assert(arguments_.mode === "contract" || arguments_.mode === "live", "Invalid mode.");
  assert(arguments_.stage, "Missing --stage.");
  const contract = readJson(contractPath);
  const contractResult = verifyContract(contract, arguments_.stage);
  const result =
    arguments_.mode === "contract"
      ? contractResult
      : await verifyLive(
          contract,
          arguments_.stage,
          arguments_.outputs ?? ".sst/outputs.json",
        );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`SST foundation verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
