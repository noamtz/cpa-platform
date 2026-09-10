import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { inspectPdfBundle } from "./verify_pdf_bundle.mjs";
import { checkPrivateFileCutover } from "./verify_private_file_cutover.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const contractPath = resolve(
  repositoryRoot,
  "infra/sst/foundation-contract.json",
);
const deploymentTargetsPath = resolve(
  repositoryRoot,
  "infra/sst/deployment-targets.json",
);
const pdfFixturePath = resolve(
  repositoryRoot,
  "lambda/pdf-generator/__fixtures__/rtl-multipage-case.json",
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

export function scopedCpaRouteCount(contract) {
  return contract.routes.filter(
    ({ route, authorization }) =>
      authorization === "cognito-jwt" && route !== "GET /auth/health",
  ).length;
}

export const requiredCloudFrontKeyValueStoreActions = readJson(
  contractPath,
).deployerPolicy.cloudFrontKeyValueStoreActions;

export function hasScopedCloudFrontKeyValueStorePermissions(
  policy,
  accountId,
  stage = "test",
  expectedRouterKeyValueStoreArn,
) {
  const statement = policy?.Statement?.find(
    ({ Sid }) => Sid === "ManageCloudFrontKeyValues",
  );
  return (
    statement?.Effect === "Allow" &&
    JSON.stringify(asArray(statement.Action)) ===
      JSON.stringify(requiredCloudFrontKeyValueStoreActions) &&
    (stage === "production"
      ? new RegExp(
          `^arn:aws:cloudfront::${accountId}:key-value-store/[A-Za-z0-9_-]+$`,
          "u",
        ).test(statement.Resource)
        && (expectedRouterKeyValueStoreArn === undefined ||
          statement.Resource === expectedRouterKeyValueStoreArn)
      : statement.Resource ===
        `arn:aws:cloudfront::${accountId}:key-value-store/*`) &&
    statement.Condition === undefined
  );
}

export function cloudFrontKeyValueStoreSimulationTargets(
  policy,
  accountId,
  stage = "test",
) {
  const accountLocalProbeArn =
    `arn:aws:cloudfront::${accountId}:key-value-store/auditflow-policy-probe`;
  if (stage !== "production") {
    return {
      allowedArn: accountLocalProbeArn,
      deniedAccountLocalArn: undefined,
    };
  }

  const statement = policy?.Statement?.find(
    ({ Sid }) => Sid === "ManageCloudFrontKeyValues",
  );
  return {
    allowedArn: statement?.Resource,
    deniedAccountLocalArn:
      statement?.Resource === accountLocalProbeArn
        ? `arn:aws:cloudfront::${accountId}:key-value-store/unrelated-policy-probe`
        : accountLocalProbeArn,
  };
}

export function validateRouterOutputs(contract, stage, outputs) {
  const customDomain = outputs.customDomain;
  if (stage === "test") {
    assert(customDomain === "", "Test custom-domain output must be empty.");
  } else {
    assert(
      customDomain === "" || customDomain === contract.production.customDomain,
      "Production custom-domain output is invalid.",
    );
  }

  const expectedRouterHost = customDomain || ".cloudfront.net";
  const routerUrl = assertHttpsUrl(
    outputs.routerUrl,
    "Router URL",
    expectedRouterHost,
  );
  if (customDomain) {
    assert(routerUrl.hostname === customDomain, "Production Router hostname is not exact.");
  }
  return routerUrl;
}

function parseArguments(argv) {
  const parsed = {
    mode: undefined,
    stage: undefined,
    outputs: undefined,
    "legacy-file-reads": "disabled",
    evidence: undefined,
    "budget-rate": undefined,
    "budget-rate-date": undefined,
    "budget-rate-source": undefined,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      fail("Expected --mode, --stage, and optional --outputs value pairs.");
    }
    const key = flag.slice(2);
    if (!(key in parsed)) fail(`Unknown verifier option: ${flag}`);
    if (seen.has(key)) fail(`Duplicate verifier option: ${flag}`);
    seen.add(key);
    parsed[key] = value;
  }
  return parsed;
}

export function validateDeploymentTargets(deploymentTargets, contract) {
  assert(
    deploymentTargets?.schemaVersion === 1 &&
      deploymentTargets.app === contract.app,
    "Unsupported AuditFlow deployment-target contract.",
  );
  assert(
    JSON.stringify(Object.keys(deploymentTargets.targets ?? {}).sort()) ===
      JSON.stringify([...contract.stages].sort()),
    "Deployment targets must match the permitted SST stages.",
  );
  for (const stage of contract.stages) {
    const target = deploymentTargets.targets[stage];
    assert(
      /^\d{12}$/u.test(target?.accountId ?? "") &&
        target.region === contract.region &&
        target.deployRoleName === `${contract.app}-${stage}-github-deploy`,
      `The ${stage} deployment target is invalid.`,
    );
  }
  return deploymentTargets;
}

export function assertDeploymentIdentity(
  deploymentTargets,
  contract,
  stage,
  identity,
) {
  validateDeploymentTargets(deploymentTargets, contract);
  const target = deploymentTargets.targets[stage];
  assert(target, `No deployment target is configured for ${stage}.`);
  assert(
    identity?.Account === target.accountId,
    `AWS caller does not match the configured AuditFlow ${stage} account.`,
  );
  return target;
}

function verifyContract(contract, deploymentTargets, stage) {
  assert(contract.schemaVersion === 4, "Unsupported contract schema version.");
  assert(contract.app === "auditflow", "Unexpected SST application name.");
  assert(contract.sstVersion === "3.19.3", "SST version must be 3.19.3.");
  assert(contract.region === "il-central-1", "Unexpected AWS region.");
  assert(
    JSON.stringify(contract.stages) === JSON.stringify(["test", "production"]),
    "Only test and production stages are permitted.",
  );
  assert(contract.stages.includes(stage), `Invalid contract stage: ${stage}`);
  validateDeploymentTargets(deploymentTargets, contract);
  assert(
    contract.production?.protect === true &&
      contract.production.removal === "retain" &&
      contract.production.logRetentionDays === 30 &&
      contract.production.customDomain === "app.ddcpa.co.il" &&
      contract.production.budget?.name === "auditflow-production-monthly-cost" &&
      contract.production.budget.limitAmountUsd === 10 &&
      contract.production.budget.ceilingIls === 50 &&
      contract.production.budget.thresholdPercent === 80 &&
      contract.production.budget.automatedActions === false,
    "Production retention, domain, or budget contract has drifted.",
  );
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
    contract.buckets.every((bucket) => bucket.private),
    "Every foundation bucket must be private.",
  );
  const filesBucket = contract.buckets.find(
    ({ logicalName }) => logicalName === "FilesBucket",
  );
  const temporaryBucket = contract.buckets.find(
    ({ logicalName }) => logicalName === "TemporaryOutputsBucket",
  );
  assert(filesBucket?.versioning === true, "FilesBucket must be versioned.");
  assert(
    filesBucket?.cors?.originPolicy === "router-plus-local-test" &&
      JSON.stringify(filesBucket.cors.allowMethods) ===
        JSON.stringify(["PUT", "HEAD"]) &&
      !filesBucket.cors.allowOrigins,
    "FilesBucket must use the exact stage-aware direct-upload CORS policy.",
  );
  assert(
    temporaryBucket?.cors === false,
    "TemporaryOutputsBucket must not expose browser CORS.",
  );
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
  const publicQuestionnaireRoutes = contract.routes.filter(
    ({ route, authorization }) =>
      route.includes(" /apps/{appId}/functions/") && authorization === "none",
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
        {
          route: "POST /apps/{appId}/functions/uploadFile",
          authorization: "none",
        },
        {
          route: "POST /apps/{appId}/functions/getSignedPdfUrl",
          authorization: "none",
        },
        {
          route: "POST /apps/{appId}/functions/getTemplateFileUrl",
          authorization: "none",
        },
        {
          route: "POST /apps/{appId}/functions/getPdfTemplateById",
          authorization: "none",
        },
      ]),
    "The exact public questionnaire route inventory is incomplete.",
  );
  const cpaRoutes = contract.routes.filter(
    ({ route, authorization }) =>
      authorization === "cognito-jwt" && route !== "GET /auth/health",
  );
  assert(
    cpaRoutes.length === 36 && scopedCpaRouteCount(contract) === cpaRoutes.length,
    "The exact CPA route inventory is incomplete.",
  );
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
    contract.pdf.apiLogicalName === "PdfApi" &&
      contract.pdf.functionLogicalName === "PdfRendererFunction" &&
      contract.pdf.handler === "lambda/pdf-generator/index.handler" &&
      contract.pdf.runtime === "nodejs20.x" &&
      contract.pdf.architecture === "arm64" &&
      contract.pdf.memoryMb === 1024 &&
      contract.pdf.timeoutSeconds === 60 &&
      contract.pdf.storageMb === 512 &&
      contract.pdf.corsOriginPolicy === "router-origin-exact" &&
      contract.pdf.apiCors === false &&
      contract.pdf.routerPrefix === "/pdf" &&
      contract.pdf.routerPattern === "/pdf" &&
      contract.pdf.rewritePattern === "^/pdf/(.*)$" &&
      contract.pdf.rewriteReplacement === "/$1" &&
      contract.pdf.legacyTestBaseUrl ===
        "https://mr8yrlc9ic.execute-api.il-central-1.amazonaws.com" &&
      JSON.stringify(contract.pdf.routes) ===
        JSON.stringify([
          { route: "GET /health" },
          { route: "POST /render-pages" },
          { route: "POST /generate-pdf" },
          { route: "OPTIONS /{proxy+}" },
        ]) &&
      JSON.stringify(contract.pdf.nodejsInstall) ===
        JSON.stringify([
          "@napi-rs/canvas",
          "pdfjs-dist",
        ]) &&
      contract.pdf.font.destination === "fonts/Heebo-Regular.ttf" &&
      contract.pdf.font.bytes === 122012 &&
      contract.pdf.font.sha256 ===
        "18F930B583FA8FE6B40B2F8263B7AC6AFBAC07ADC91A12467874E7467D3ACE30" &&
      contract.pdf.resourceLinks.length === 0 &&
      contract.pdf.permissions.length === 0,
    "Dedicated PDF API/function contract has drifted.",
  );
  const { notification: zipNotificationContract } = contract.zipWorker;
  assert(
    contract.zipWorker.logicalName === "ZipDownloadWorker" &&
      contract.zipWorker.runtime === "nodejs20.x" &&
      contract.zipWorker.architecture === "arm64" &&
      contract.zipWorker.memoryMb === 1024 &&
      contract.zipWorker.timeoutSeconds === 900 &&
      contract.zipWorker.storageMb === 2048 &&
      contract.zipWorker.processingLease?.prefix === "zip-jobs/locks/" &&
      contract.zipWorker.processingLease.durationSeconds === 60 &&
      contract.zipWorker.processingLease.heartbeatSeconds === 20 &&
      contract.zipWorker.processingLease.conditionalWrite === true &&
      contract.zipWorker.processingLease.recoverableTakeover === true &&
      contract.zipWorker.processingLease.resultOwnership === "job-and-owner" &&
      contract.zipWorker.processingLease.terminalStatusStorage ===
        "lease-record" &&
      contract.zipWorker.processingLease.terminalStatusFenced === true &&
      JSON.stringify(contract.zipWorker.permissions.filesActions) ===
        JSON.stringify(["s3:GetObject"]) &&
      JSON.stringify(contract.zipWorker.permissions.journalActions) ===
        JSON.stringify([
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:TransactWriteItems",
        ]) &&
      JSON.stringify(contract.zipWorker.permissions.temporaryActions) ===
        JSON.stringify([
          "s3:AbortMultipartUpload",
          "s3:DeleteObject",
          "s3:GetObject",
          "s3:ListMultipartUploadParts",
          "s3:PutObject",
        ]) &&
      contract.zipWorker.permissions.temporaryPrefix === "zip-jobs/*" &&
      zipNotificationContract.bucketLogicalName === "TemporaryOutputsBucket" &&
      JSON.stringify(zipNotificationContract.events) ===
        JSON.stringify(["s3:ObjectCreated:*"]) &&
      zipNotificationContract.filterPrefix === "zip-jobs/requests/" &&
      zipNotificationContract.filterSuffix === ".json",
    "ZIP worker and notification contracts have drifted.",
  );
  assert(
    contract.deploymentGates?.privateFilesImport?.issue === 11 &&
      contract.deploymentGates.privateFilesImport.evidencePath ===
        "docs/migration/private-file-import-verification.json" &&
      contract.deploymentGates.privateFilesImport.verifier ===
        "tooling/verify_private_file_cutover.mjs" &&
      contract.deploymentGates.privateFilesImport.requiredBefore ===
        "legacy-file-read-enablement" &&
      contract.deploymentGates.privateFilesImport.resolverContract ===
        "legacy-reference-sha256-v2" &&
      contract.deploymentGates.privateFilesImport.evidenceSchemaVersion === 3 &&
      contract.deploymentGates.privateFilesImport.environmentVariable ===
        "LEGACY_FILE_READS_ENABLED" &&
      contract.deploymentGates.privateFilesImport.manifestEnvironmentVariable ===
        "LEGACY_FILE_IMPORT_MANIFEST_SHA256" &&
      contract.deploymentGates.privateFilesImport.requestEnvironmentVariable ===
        "AUDITFLOW_ENABLE_LEGACY_FILE_READS" &&
      contract.deploymentGates.privateFilesImport.expectedManifestEnvironmentVariable ===
        "AUDITFLOW_EXPECTED_LEGACY_IMPORT_MANIFEST_SHA256" &&
      contract.deploymentGates.privateFilesImport.syntheticOnlyValue === "false" &&
      contract.deploymentGates.privateFilesImport.enabledStage === "test" &&
      contract.deploymentGates.privateFilesImport.maximumEvidenceAgeHours === 72 &&
      contract.deploymentGates.privateFilesImport.enablementIssue === 11,
    "Legacy file reads must remain gated on issue #11 import evidence.",
  );
  assert(
    contract.oidc.audience === "sts.amazonaws.com" &&
      contract.oidc.subject ===
        "repo:noamtz@2631641/cpa-platform@1332935468:environment:test" &&
      contract.oidc.enablementSubject ===
        "repo:noamtz@2631641/cpa-platform@1332935468:environment:test-legacy-read-enable" &&
      contract.oidc.productionSubject ===
        "repo:noamtz@2631641/cpa-platform@1332935468:environment:production" &&
      !contract.oidc.subject.includes("*") &&
      !contract.oidc.enablementSubject.includes("*") &&
      !contract.oidc.productionSubject.includes("*") &&
      !contract.oidc.subject.includes("noamtz/auditflow"),
    "OIDC trust must use the exact immutable Environment subjects.",
  );
  assert(
    JSON.stringify(contract.deployerPolicy.cloudFrontKeyValueStoreActions) ===
      JSON.stringify([
        "cloudfront-keyvaluestore:DeleteKey",
        "cloudfront-keyvaluestore:DescribeKeyValueStore",
        "cloudfront-keyvaluestore:GetKey",
        "cloudfront-keyvaluestore:ListKeys",
        "cloudfront-keyvaluestore:PutKey",
        "cloudfront-keyvaluestore:UpdateKeys",
      ]),
    "CloudFront KeyValueStore deployer actions must remain explicit and complete.",
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
    deploymentTargetPinned: true,
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

export function assertBrowserCorsExact(
  result,
  logicalName,
  expectedOrigins,
  corsContract,
) {
  assert(result.ok, `${logicalName} browser CORS configuration is missing.`);
  const [rule] = result.value.CORSRules ?? [];
  assert(
    result.value.CORSRules?.length === 1,
    `${logicalName} must have exactly one browser CORS rule.`,
  );
  const sorted = (values = []) => [...values].sort();
  assert(
    JSON.stringify(sorted(rule.AllowedOrigins)) ===
      JSON.stringify(sorted(expectedOrigins)) &&
      JSON.stringify(sorted(rule.AllowedHeaders)) ===
        JSON.stringify(sorted(corsContract.allowHeaders)) &&
      JSON.stringify(sorted(rule.AllowedMethods)) ===
        JSON.stringify(sorted(corsContract.allowMethods)) &&
      JSON.stringify(sorted(rule.ExposeHeaders)) ===
        JSON.stringify(sorted(corsContract.exposeHeaders)) &&
      rule.MaxAgeSeconds === 3600,
    `${logicalName} browser CORS configuration has drifted.`,
  );
}

export function notificationFilterRulesByName(rules) {
  return Object.fromEntries(
    rules.map(({ Name, Value }) => [Name.toLowerCase(), Value]),
  );
}

export function hasApiGatewayCorsConfiguration(configuration) {
  return Boolean(configuration && Object.keys(configuration).length > 0);
}

export function pdfRoutesTargetSingleFunction(
  routes,
  integrations,
  functionName,
) {
  const integrationById = new Map(
    integrations.map((integration) => [integration.IntegrationId, integration]),
  );
  const integrationUris = new Set();

  for (const route of routes) {
    const integrationId = route.Target?.replace(/^integrations\//, "");
    const integration = integrationById.get(integrationId);
    if (
      route.AuthorizationType !== "NONE" ||
      !integration ||
      integration.IntegrationType !== "AWS_PROXY" ||
      integration.IntegrationMethod !== "POST" ||
      integration.PayloadFormatVersion !== "2.0" ||
      !integration.IntegrationUri?.endsWith(`:function:${functionName}`)
    ) {
      return false;
    }
    integrationUris.add(integration.IntegrationUri);
  }

  return integrationUris.size === 1;
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

function verifyDeployer(contract, deploymentTargets, stage) {
  const identity = runAws(["sts", "get-caller-identity"]).value;
  const target = assertDeploymentIdentity(
    deploymentTargets,
    contract,
    stage,
    identity,
  );
  const accountId = target.accountId;

  const roleArn = `arn:aws:iam::${accountId}:role/${target.deployRoleName}`;
  if (process.env.AWS_DEPLOY_ROLE_ARN) {
    assert(
      process.env.AWS_DEPLOY_ROLE_ARN === roleArn,
      `AWS_DEPLOY_ROLE_ARN does not identify the AuditFlow ${stage} deployer.`,
    );
  }

  const roleName = target.deployRoleName;
  const inlinePolicyNames = runAws([
    "iam",
    "list-role-policies",
    "--role-name",
    roleName,
  ]).value.PolicyNames;
  assert(
    JSON.stringify(inlinePolicyNames) ===
      JSON.stringify([`auditflow-${stage}-foundation-deploy`]),
    `${stage} deploy role must have exactly one scoped inline policy.`,
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
    hasScopedCloudFrontKeyValueStorePermissions(inlinePolicy, accountId, stage),
    `${stage} deploy role CloudFront KeyValueStore permissions are missing, broad, or conditioned on unsupported tags.`,
  );

  const { allowedArn: keyValueStoreProbeArn } =
    cloudFrontKeyValueStoreSimulationTargets(inlinePolicy, accountId, stage);
  for (const action of requiredCloudFrontKeyValueStoreActions) {
    assert(
      simulatePrincipalAction(roleArn, action, keyValueStoreProbeArn) ===
        "allowed",
      `${stage} deploy role does not effectively allow ${action}.`,
    );
  }
  assert(
    simulatePrincipalAction(
      roleArn,
      "cloudfront-keyvaluestore:DescribeKeyValueStore",
      "arn:aws:cloudfront::000000000000:key-value-store/unrelated-policy-probe",
    ) !== "allowed",
    `${stage} deploy role can inspect a CloudFront KeyValueStore in another account.`,
  );

  return {
    mode: "deployer",
    stage,
    region: contract.region,
    statuses: {
      exactInlinePolicy: true,
      cloudFrontKeyValueStoreActions:
        requiredCloudFrontKeyValueStoreActions.length,
      cloudFrontKeyValueStoreResourceScoped: true,
      cloudFrontKeyValueStoreCrossAccountDenied: true,
      deploymentTargetPinned: true,
    },
  };
}

async function fetchText(url, expectedStatus) {
  const response = await fetch(url, { redirect: "manual" });
  assert(
    response.status === expectedStatus,
    `Unexpected HTTP status for ${new URL(url).pathname}.`,
  );
  return { response, text: await response.text() };
}

export function validateProductionBudgetReadback({
  contract,
  budget,
  notifications,
  subscribers,
  actions,
  rate,
  rateDate,
  rateSource,
  now = new Date(),
}) {
  const budgetContract = contract.production.budget;
  const parsedRate = Number(rate);
  assert(Number.isFinite(parsedRate) && parsedRate > 0, "A positive ILS/USD rate is required.");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(rateDate ?? ""), "Budget rate date must be YYYY-MM-DD.");
  const observedAt = new Date(`${rateDate}T00:00:00Z`);
  const ageDays = Math.floor((now.getTime() - observedAt.getTime()) / 86_400_000);
  assert(Number.isFinite(observedAt.getTime()) && ageDays >= 0 && ageDays <= 7, "Budget rate must be current within seven days.");
  assert(typeof rateSource === "string" && /^.{2,120}$/.test(rateSource), "Budget rate source is required.");
  assert(
    budget?.BudgetName === budgetContract.name &&
      Number(budget.BudgetLimit?.Amount) === budgetContract.limitAmountUsd &&
      budget.BudgetLimit?.Unit === "USD" &&
      budget.BudgetType === budgetContract.budgetType &&
      budget.TimeUnit === budgetContract.timeUnit,
    "Production AWS Budget amount or period has drifted.",
  );
  assert(
    notifications?.length === 1 &&
      notifications[0].NotificationType === budgetContract.notificationType &&
      notifications[0].ComparisonOperator === budgetContract.comparisonOperator &&
      Number(notifications[0].Threshold) === budgetContract.thresholdPercent &&
      notifications[0].ThresholdType === budgetContract.thresholdType,
    "Production AWS Budget notification has drifted.",
  );
  assert(subscribers?.length > 0, "Production AWS Budget requires at least one subscriber.");
  assert(actions?.length === 0, "Production AWS Budget must not have automatic actions.");
  const convertedLimitIls = budgetContract.limitAmountUsd * parsedRate;
  assert(convertedLimitIls <= budgetContract.ceilingIls, "Production AWS Budget exceeds the ILS ceiling.");

  return {
    limitAmountUsd: budgetContract.limitAmountUsd,
    convertedLimitIls,
    ceilingIls: budgetContract.ceilingIls,
    thresholdPercent: budgetContract.thresholdPercent,
    recipientCount: subscribers.length,
    automatedActionCount: actions.length,
    rate: parsedRate,
    rateDate,
    rateSource,
  };
}

function verifyProductionBudget(contract, accountId, rate, rateDate, rateSource) {
  const budgetName = contract.production.budget.name;
  const budget = runAws([
    "budgets", "describe-budget", "--account-id", accountId, "--budget-name", budgetName,
  ]).value.Budget;
  const notifications = runAws([
    "budgets", "describe-notifications-for-budget", "--account-id", accountId,
    "--budget-name", budgetName,
  ]).value.Notifications ?? [];
  const subscribers = notifications.length === 1
    ? runAws([
        "budgets", "describe-subscribers-for-notification", "--account-id", accountId,
        "--budget-name", budgetName, "--notification", JSON.stringify(notifications[0]),
      ]).value.Subscribers ?? []
    : [];
  const actions = runAws([
    "budgets", "describe-budget-actions-for-budget", "--account-id", accountId,
    "--budget-name", budgetName,
  ]).value.Actions ?? [];
  return validateProductionBudgetReadback({
    contract, budget, notifications, subscribers, actions, rate, rateDate, rateSource,
  });
}

async function verifyLive(
  contract,
  deploymentTargets,
  stage,
  outputsPath,
  legacyFileReads = "disabled",
  evidencePath,
  budgetRate,
  budgetRateDate,
  budgetRateSource,
) {
  assert(
    legacyFileReads === "disabled" || legacyFileReads === "enabled",
    "Legacy file-read expectation must be enabled or disabled.",
  );
  assert(
    legacyFileReads === "enabled" ? Boolean(evidencePath) : !evidencePath,
    "Enabled live verification requires evidence; disabled verification forbids it.",
  );
  assert(
    stage === "test" || legacyFileReads === "disabled",
    "Production legacy file reads must remain disabled.",
  );
  let expectedLegacyManifestSha256 = "";
  if (legacyFileReads === "enabled") {
    const evidence = checkPrivateFileCutover({
      stage,
      evidencePath,
      root: repositoryRoot,
    });
    assert(evidence.ready, `Legacy file evidence is not ready (${evidence.reason}).`);
    expectedLegacyManifestSha256 = evidence.sourceManifestSha256;
  }
  const outputs = readJson(resolve(repositoryRoot, outputsPath));
  assert(outputs.stage === stage, `Deployment outputs are not for the ${stage} stage.`);
  for (const key of contract.outputKeys) {
    assert(key in outputs, `Missing required SST output: ${key}`);
  }
  const identity = runAws(["sts", "get-caller-identity"]).value;
  const deploymentTarget = assertDeploymentIdentity(
    deploymentTargets,
    contract,
    stage,
    identity,
  );
  const accountId = deploymentTarget.accountId;

  const routerUrl = validateRouterOutputs(contract, stage, outputs);
  assertHttpsUrl(
    outputs.apiUrl,
    "API URL",
    ".execute-api.il-central-1.amazonaws.com",
  );
  const pdfApiUrl = assertHttpsUrl(
    outputs.pdfApiUrl,
    "PDF API URL",
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
  assert(
    outputs.pdfBaseUrl === `${outputs.routerUrl}${contract.pdf.routerPrefix}`,
    "PDF base URL does not use the same-origin Router path.",
  );
  assertHttpsUrl(
    outputs.pdfHealthUrl,
    "PDF health URL",
    routerUrl.hostname,
    "/pdf/health",
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
    if (stage === "production") {
      assert(
        description.DeletionProtectionEnabled === true,
        `${logicalName} production deletion protection is not enabled.`,
      );
    }
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
    if (logicalName === "FilesBucket") {
      const corsContract = contract.buckets.find(
        (bucket) => bucket.logicalName === logicalName,
      ).cors;
      assertBrowserCorsExact(
        cors,
        logicalName,
        stage === "production"
          ? [outputs.routerUrl]
          : [outputs.routerUrl, contract.auth.localOrigin],
        corsContract,
      );
    } else {
      assertBrowserCorsAbsent(cors, logicalName);
    }
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

  const zipWorker = runAws([
    "lambda",
    "get-function-configuration",
    "--function-name",
    outputs.zipWorkerFunctionName,
  ]).value;
  assert(
    zipWorker.Runtime === contract.zipWorker.runtime &&
      zipWorker.MemorySize === contract.zipWorker.memoryMb &&
      zipWorker.Timeout === contract.zipWorker.timeoutSeconds &&
      zipWorker.EphemeralStorage?.Size === contract.zipWorker.storageMb &&
      JSON.stringify(zipWorker.Architectures) === JSON.stringify(["arm64"]),
    "ZIP worker runtime limits have drifted.",
  );
  const zipEnvironment = zipWorker.Environment?.Variables ?? {};
  assert(
    zipEnvironment.CHANGE_JOURNAL_TABLE_NAME ===
      outputs.tableNames.ChangeJournalTable &&
      zipEnvironment[
      contract.deploymentGates.privateFilesImport.environmentVariable
    ] === (legacyFileReads === "enabled" ? "true" : "false") &&
      (zipEnvironment[
        contract.deploymentGates.privateFilesImport.manifestEnvironmentVariable
      ] ?? "") === expectedLegacyManifestSha256,
    "ZIP worker maintenance or legacy file-read binding has drifted.",
  );
  const notification = runAws([
    "s3api",
    "get-bucket-notification-configuration",
    "--bucket",
    outputs.bucketNames.TemporaryOutputsBucket,
  ]).value;
  const lambdaNotifications = notification.LambdaFunctionConfigurations ?? [];
  const [zipNotification] = lambdaNotifications;
  const { Key: notificationFilterKey } = zipNotification?.Filter ?? {};
  const { FilterRules: notificationFilterRules = [] } =
    notificationFilterKey ?? {};
  const filterRules = notificationFilterRulesByName(notificationFilterRules);
  const { notification: zipNotificationContract } = contract.zipWorker;
  assert(
    lambdaNotifications.length === 1 &&
      zipNotification.Id?.includes(zipNotificationContract.name) &&
      zipNotification.LambdaFunctionArn?.endsWith(
        `:function:${outputs.zipWorkerFunctionName}`,
      ) &&
      JSON.stringify(zipNotification.Events) ===
        JSON.stringify(zipNotificationContract.events) &&
      filterRules.prefix === zipNotificationContract.filterPrefix &&
      filterRules.suffix === zipNotificationContract.filterSuffix,
    "TemporaryOutputsBucket ZIP notification has drifted.",
  );

  const userPool = runAws([
    "cognito-idp",
    "describe-user-pool",
    "--user-pool-id",
    outputs.userPoolId,
  ]).value.UserPool;
  assert(userPool.Status === undefined || userPool.Status === "Enabled", "User pool is unavailable.");
  if (stage === "production") {
    assert(
      userPool.DeletionProtection === "ACTIVE",
      "Production user-pool deletion protection is not active.",
    );
  }
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
  const expectedCallbackUrls = stage === "production"
    ? [outputs.authCallbackUrl]
    : [
        outputs.authCallbackUrl,
        `${contract.auth.localOrigin}${contract.auth.callbackPath}`,
      ];
  const expectedLogoutUrls = stage === "production"
    ? [outputs.authLogoutUrl]
    : [
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
  for (const routeContract of contract.routes.filter(
    ({ route, authorization }) =>
      authorization === "cognito-jwt" && route !== "GET /auth/health",
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
  for (const routeContract of contract.routes.filter(
    ({ route, authorization }) =>
      route.includes(" /apps/{appId}/functions/") && authorization === "none",
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
  const apiEnvironment = lambda.Environment?.Variables ?? {};
  assert(
    apiEnvironment[
      contract.deploymentGates.privateFilesImport.environmentVariable
    ] === (legacyFileReads === "enabled" ? "true" : "false") &&
      (apiEnvironment[
        contract.deploymentGates.privateFilesImport.manifestEnvironmentVariable
      ] ?? "") === expectedLegacyManifestSha256,
    "API Lambda legacy file-read mode or manifest binding has drifted.",
  );

  const pdfApi = runAws([
    "apigatewayv2",
    "get-api",
    "--api-id",
    outputs.pdfApiId,
  ]).value;
  assert(
    pdfApi.ProtocolType === "HTTP" &&
      !hasApiGatewayCorsConfiguration(pdfApi.CorsConfiguration),
    "PDF API must be an HTTP API with handler-owned CORS.",
  );
  if (stage === "production") {
    assert(
      outputs.pdfApiUrl !== contract.pdf.legacyTestBaseUrl,
      "Production must not use the retained test PDF override.",
    );
  }
  const pdfRoutes = runAws([
    "apigatewayv2",
    "get-routes",
    "--api-id",
    outputs.pdfApiId,
  ]).value.Items;
  const pdfIntegrations = runAws([
    "apigatewayv2",
    "get-integrations",
    "--api-id",
    outputs.pdfApiId,
  ]).value.Items;
  assert(
    JSON.stringify(pdfRoutes.map(({ RouteKey }) => RouteKey).sort()) ===
      JSON.stringify(contract.pdf.routes.map(({ route }) => route).sort()),
    "PDF API route inventory has drifted.",
  );
  assert(
    pdfRoutesTargetSingleFunction(
      pdfRoutes,
      pdfIntegrations,
      outputs.pdfFunctionName,
    ),
    "PDF API routes must be public and target one dedicated function.",
  );

  const pdfDeployment = runAws([
    "lambda",
    "get-function",
    "--function-name",
    outputs.pdfFunctionName,
  ]).value;
  const pdfFunction = pdfDeployment.Configuration;
  assert(
    pdfFunction.Runtime === contract.pdf.runtime &&
      pdfFunction.MemorySize === contract.pdf.memoryMb &&
      pdfFunction.Timeout === contract.pdf.timeoutSeconds &&
      pdfFunction.EphemeralStorage?.Size === contract.pdf.storageMb &&
      JSON.stringify(pdfFunction.Architectures) ===
        JSON.stringify([contract.pdf.architecture]),
    "PDF function runtime limits have drifted.",
  );
  assert(
    pdfFunction.Environment?.Variables?.CORS_ORIGIN === outputs.routerUrl,
    "PDF function CORS origin is not the exact Router origin.",
  );
  const pdfCodeLocation = pdfDeployment.Code?.Location;
  assert(pdfCodeLocation, "PDF function deployment archive URL is missing.");
  const pdfCodeUrl = new URL(pdfCodeLocation);
  assert(
    pdfCodeUrl.protocol === "https:" &&
      pdfCodeUrl.hostname.endsWith(".amazonaws.com"),
    "PDF function deployment archive URL has an unexpected origin.",
  );
  const pdfCodeResponse = await fetch(pdfCodeUrl);
  assert(pdfCodeResponse.ok, "PDF function deployment archive could not be read.");
  const pdfBundle = await inspectPdfBundle(
    Buffer.from(await pdfCodeResponse.arrayBuffer()),
  );
  assert(
    pdfBundle.fontBytes === contract.pdf.font.bytes &&
      pdfBundle.fontSha256 === contract.pdf.font.sha256 &&
      pdfBundle.nativeArm64BinaryCount > 0,
    "PDF deployment archive runtime assets have drifted.",
  );
  const pdfRoleArn = pdfFunction.Role;
  const pdfRoleName = pdfRoleArn?.slice(pdfRoleArn.lastIndexOf("/") + 1);
  assert(pdfRoleName, "PDF function execution role is missing.");
  const pdfRole = runAws(["iam", "get-role", "--role-name", pdfRoleName]).value
    .Role;
  assert(
    pdfRole.PermissionsBoundary?.PermissionsBoundaryArn?.endsWith(
      `:policy/auditflow-${stage}-workload-boundary`,
    ),
    `PDF function does not use the ${stage} workload permissions boundary.`,
  );
  const pdfAttachedPolicies = runAws([
    "iam",
    "list-attached-role-policies",
    "--role-name",
    pdfRoleName,
  ]).value.AttachedPolicies;
  const pdfInlinePolicies = runAws([
    "iam",
    "list-role-policies",
    "--role-name",
    pdfRoleName,
  ]).value.PolicyNames;
  assert(
    !pdfAttachedPolicies.some(({ PolicyName, PolicyArn }) =>
      /administrator|poweruser/i.test(`${PolicyName} ${PolicyArn}`),
    ) &&
      !pdfInlinePolicies.some((name) => /administrator|poweruser/i.test(name)),
    "PDF function execution role has an elevated attached policy.",
  );
  const pdfRoleAccountId = /^arn:aws:iam::(\d{12}):role\//.exec(pdfRoleArn)?.[1];
  assert(
    pdfRoleAccountId === accountId,
    "PDF function role is not in the configured deployment account.",
  );
  const forbiddenPdfActions = [
    ["s3:GetObject", "arn:aws:s3:::auditflow-policy-probe/object"],
    [
      "dynamodb:GetItem",
      `arn:aws:dynamodb:il-central-1:${accountId}:table/auditflow-policy-probe`,
    ],
    [
      "cognito-idp:AdminGetUser",
      `arn:aws:cognito-idp:il-central-1:${accountId}:userpool/il-central-1_policyprobe`,
    ],
  ];
  for (const [action, resourceArn] of forbiddenPdfActions) {
    assert(
      simulatePrincipalAction(pdfRoleArn, action, resourceArn) !== "allowed",
      `PDF function execution role unexpectedly allows ${action}.`,
    );
  }
  const distribution = runAws([
    "cloudfront",
    "get-distribution",
    "--id",
    outputs.routerDistributionId,
  ]).value.Distribution;
  assert(distribution.Status === "Deployed", "Router distribution is not deployed.");
  if (stage === "production") {
    const origins = distribution.DistributionConfig?.Origins?.Items ?? [];
    const s3Origins = origins.filter(({ DomainName }) =>
      /\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(DomainName ?? ""),
    );
    assert(
      s3Origins.length > 0 &&
        s3Origins.every(
          ({ DomainName, OriginAccessControlId }) =>
            !DomainName.includes("s3-website") && Boolean(OriginAccessControlId),
        ),
      "Production CloudFront storage origins are not private OAC origins.",
    );
  }

  const roleArn = outputs.deployRoleArn;
  assert(
    roleArn ===
      `arn:aws:iam::${accountId}:role/${deploymentTarget.deployRoleName}`,
    `Unexpected ${stage} deploy-role ARN.`,
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
      JSON.stringify(trustConditions?.["token.actions.githubusercontent.com:sub"]) ===
        JSON.stringify(
          stage === "test"
            ? [contract.oidc.subject, contract.oidc.enablementSubject]
            : [contract.oidc.productionSubject],
        ),
    `${stage} deploy role does not have the exact GitHub OIDC trust contract.`,
  );
  const attachedPolicies = runAws([
    "iam",
    "list-attached-role-policies",
    "--role-name",
    roleName,
  ]).value.AttachedPolicies;
  assert(
    attachedPolicies.length === 0,
    `${stage} deploy role must not have managed policies attached.`,
  );
  const inlinePolicyNames = runAws([
    "iam",
    "list-role-policies",
    "--role-name",
    roleName,
  ]).value.PolicyNames;
  assert(
    JSON.stringify(inlinePolicyNames) ===
      JSON.stringify([`auditflow-${stage}-foundation-deploy`]),
    `${stage} deploy role must have exactly one scoped inline policy.`,
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
    hasScopedCloudFrontKeyValueStorePermissions(
      inlinePolicy,
      accountId,
      stage,
      outputs.routerKeyValueStoreArn,
    ),
    `${stage} deploy role CloudFront KeyValueStore permissions are missing, broad, or conditioned on unsupported tags.`,
  );
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
      workloadBoundaryArn.endsWith(`/auditflow-${stage}-workload-boundary`),
    `Workload-role creation does not require the ${stage} permissions boundary.`,
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
  const stageLogTags = findPolicyStatement(
    inlinePolicy,
    "InspectStageLogTags",
  );
  assert(
    stageLogTags?.Action === "logs:ListTagsForResource" &&
      asArray(stageLogTags.Resource).length === 2 &&
      asArray(stageLogTags.Resource).every(
        (resource) =>
          resource.startsWith(
            `arn:aws:logs:il-central-1:${accountId}:log-group:/aws/`,
          ) && resource.includes(`auditflow-${stage}-`),
      ),
    `${stage} deploy role cannot inspect only AuditFlow ${stage} log-group tags.`,
  );
  const apiTags = findPolicyStatement(inlinePolicy, "TagStageApis");
  assert(
    apiTags?.Action === "apigateway:POST" &&
      apiTags.Resource ===
        "arn:aws:apigateway:il-central-1::/tags/arn%3Aaws%3Aapigateway%3Ail-central-1%3A%3A%2Fv2%2Fapis%2F*" &&
      apiTags.Condition?.StringEquals?.["aws:RequestTag/sst:app"] ===
        "auditflow" &&
      apiTags.Condition?.StringEquals?.["aws:RequestTag/sst:stage"] ===
        stage &&
      apiTags.Condition?.StringEquals?.["aws:ResourceTag/sst:app"] ===
        "auditflow" &&
      apiTags.Condition?.StringEquals?.["aws:ResourceTag/sst:stage"] ===
        stage,
    `${stage} deploy role cannot update tags only on existing tagged AuditFlow ${stage} APIs.`,
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
    `auditflow-${stage}-github-deploy`,
    `auditflow-${stage}-policy-probe`,
  );
  const tagContext = [
    "ContextKeyName=iam:ResourceTag/sst:app,ContextKeyValues=auditflow,ContextKeyType=string",
    `ContextKeyName=iam:ResourceTag/sst:stage,ContextKeyValues=${stage},ContextKeyType=string`,
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
  const {
    allowedArn: keyValueStoreProbeArn,
    deniedAccountLocalArn: deniedAccountLocalKeyValueStoreArn,
  } = cloudFrontKeyValueStoreSimulationTargets(inlinePolicy, accountId, stage);
  for (const action of requiredCloudFrontKeyValueStoreActions) {
    assert(
      simulatePrincipalAction(roleArn, action, keyValueStoreProbeArn) ===
        "allowed",
      `Policy simulation did not allow ${action} on the ${stage} KeyValueStore resource.`,
    );
    if (deniedAccountLocalKeyValueStoreArn) {
      assert(
        simulatePrincipalAction(
          roleArn,
          action,
          deniedAccountLocalKeyValueStoreArn,
        ) !== "allowed",
        `Policy simulation allowed ${action} on an unrelated production KeyValueStore.`,
      );
    }
  }
  assert(
    simulatePrincipalAction(
      roleArn,
      "cloudfront-keyvaluestore:DescribeKeyValueStore",
      "arn:aws:cloudfront::000000000000:key-value-store/unrelated-policy-probe",
    ) !== "allowed",
    "Policy simulation allowed cross-account CloudFront KeyValueStore access.",
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
  assert(
    simulatePrincipalAction(
      roleArn,
      "apigateway:POST",
      "arn:aws:apigateway:il-central-1::/tags/arn%3Aaws%3Aapigateway%3Ail-central-1%3A%3A%2Fv2%2Fapis%2Funrelated-policy-probe",
      [
        "ContextKeyName=aws:RequestTag/sst:app,ContextKeyValues=auditflow,ContextKeyType=string",
        `ContextKeyName=aws:RequestTag/sst:stage,ContextKeyValues=${stage},ContextKeyType=string`,
      ],
    ) !== "allowed",
    "Policy simulation allowed an unrelated API to adopt AuditFlow stage tags.",
  );

  let productionBudget;
  if (stage === "production") {
    const logGroupPrefixes = [
      `/aws/lambda/${outputs.apiFunctionName}`,
      `/aws/lambda/${outputs.zipWorkerFunctionName}`,
      `/aws/lambda/${outputs.pdfFunctionName}`,
      "/aws/vendedlogs/apis/auditflow-production-",
    ];
    for (const prefix of logGroupPrefixes) {
      const logGroups = runAws([
        "logs", "describe-log-groups", "--log-group-name-prefix", prefix,
      ]).value.logGroups ?? [];
      assert(
        logGroups.length > 0 &&
          logGroups.every(({ retentionInDays }) =>
            retentionInDays === contract.production.logRetentionDays),
        `Production log retention has drifted for ${prefix}.`,
      );
    }
    productionBudget = verifyProductionBudget(
      contract,
      accountId,
      budgetRate,
      budgetRateDate,
      budgetRateSource,
    );
  }

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
      JSON.stringify({ ok: true, service: "auditflow-api", stage }),
    "Health response body has drifted.",
  );
  const protectedHealth = await fetch(outputs.protectedHealthUrl, {
    redirect: "manual",
  });
  assert(
    [401, 403].includes(protectedHealth.status),
    "Protected health route accepted an unauthenticated request.",
  );

  const rawPdfHealth = await fetchText(
    `${pdfApiUrl.href.replace(/\/$/, "")}/health`,
    200,
  );
  const routerPdfHealth = await fetchText(outputs.pdfHealthUrl, 200);
  for (const healthResult of [rawPdfHealth, routerPdfHealth]) {
    assert(
      healthResult.response.headers
        .get("content-type")
        ?.includes("application/json") &&
        healthResult.response.headers.get("access-control-allow-origin") ===
          outputs.routerUrl,
      "PDF health response headers have drifted.",
    );
    assert(
      JSON.stringify(JSON.parse(healthResult.text)) ===
        JSON.stringify({ ok: true, heeboLoaded: true }),
      "PDF health response did not prove the Heebo asset loaded.",
    );
  }
  const preflight = await fetch(
    `${pdfApiUrl.href.replace(/\/$/, "")}/render-pages`,
    {
      method: "OPTIONS",
      headers: {
        Origin: outputs.routerUrl,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    },
  );
  assert(
    preflight.status === 200 &&
      preflight.headers.get("access-control-allow-origin") === outputs.routerUrl &&
      preflight.headers.get("access-control-allow-methods") === "POST, OPTIONS",
    "PDF API preflight contract has drifted.",
  );

  const pdfFixture = readJson(pdfFixturePath);
  const renderResponse = await fetch(`${outputs.pdfBaseUrl}/render-pages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ basePdfUrl: pdfFixture.basePdfUrl }),
  });
  assert(renderResponse.status === 200, "PDF native render smoke request failed.");
  const renderBody = await renderResponse.json();
  assert(
    renderBody.pageCount === pdfFixture.expected.pageCount &&
      renderBody.pages?.length === pdfFixture.expected.pageCount &&
      renderBody.pages.every(
        (page) => typeof page === "string" && page.length > 100,
      ),
    "PDF native render smoke response has drifted.",
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
      pdfLambdaNode20Arm64: true,
      pdfRuntimeLimitsExact: true,
      pdfCorsExact: true,
      pdfHeeboLoaded: true,
      pdfNativeRenderPassed: true,
      pdfBundleFontExact:
        pdfBundle.fontBytes === contract.pdf.font.bytes &&
        pdfBundle.fontSha256 === contract.pdf.font.sha256,
      pdfBundleAarch64Exact: pdfBundle.nativeArm64BinaryCount > 0,
      pdfWorkloadBoundaryAttached: true,
      pdfDataActionsDenied: forbiddenPdfActions.length,
      routerDeployed: true,
      productionPrivateOrigins: stage === "production" ? true : undefined,
      productionRetention: stage === "production" ? true : undefined,
      productionBudget: stage === "production" ? productionBudget : undefined,
      managedLoginConfigured: true,
      refreshRotationEnabled: true,
      cpaRoutesScoped: scopedCpaRouteCount(contract),
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
      legacyFileReads,
      legacyManifestBound:
        legacyFileReads === "enabled"
          ? /^[a-f0-9]{64}$/.test(expectedLegacyManifestSha256)
          : true,
    },
    ...(stage === "test"
      ? {
          urls: {
            routerUrl: outputs.routerUrl,
            healthUrl: outputs.healthUrl,
            protectedHealthUrl: outputs.protectedHealthUrl,
          },
        }
      : {}),
  };
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  assert(
    ["contract", "deployer", "live"].includes(arguments_.mode),
    "Invalid mode.",
  );
  assert(arguments_.stage, "Missing --stage.");
  assert(
    arguments_.mode === "live" ||
      (arguments_["legacy-file-reads"] === "disabled" && !arguments_.evidence),
    "Legacy file-read expectations are valid only for live verification.",
  );
  const budgetOptions = [
    arguments_["budget-rate"],
    arguments_["budget-rate-date"],
    arguments_["budget-rate-source"],
  ];
  assert(
    arguments_.mode === "live" && arguments_.stage === "production"
      ? budgetOptions.every(Boolean)
      : budgetOptions.every((value) => value === undefined),
    "Budget rate, date, and source are required together only for production live verification.",
  );
  const contract = readJson(contractPath);
  const deploymentTargets = readJson(deploymentTargetsPath);
  const contractResult = verifyContract(
    contract,
    deploymentTargets,
    arguments_.stage,
  );
  let result = contractResult;
  if (arguments_.mode === "deployer") {
    result = verifyDeployer(contract, deploymentTargets, arguments_.stage);
  } else if (arguments_.mode === "live") {
    result = await verifyLive(
      contract,
      deploymentTargets,
      arguments_.stage,
      arguments_.outputs ?? ".sst/outputs.json",
      arguments_["legacy-file-reads"],
      arguments_.evidence,
      arguments_["budget-rate"],
      arguments_["budget-rate-date"],
      arguments_["budget-rate-source"],
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`SST foundation verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
