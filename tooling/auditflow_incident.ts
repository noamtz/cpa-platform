import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  CreatePolicyVersionCommand,
  DeletePolicyVersionCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  IAMClient,
  ListPolicyVersionsCommand,
  SetDefaultPolicyVersionCommand,
  type PolicyVersion,
} from "@aws-sdk/client-iam";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { fromIni } from "@aws-sdk/credential-provider-ini";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";

import { redactProviderMessage } from "../backend/api/core/provider-diagnostics";
import {
  buildWorkloadBoundaryPolicy,
  type IamPolicyDocument,
  type IamPolicyStatement,
} from "../infra/sst/deployment-policy";
import deploymentTargetsJson from "../infra/sst/deployment-targets.json";
import type { StageName } from "../infra/sst/stage";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const allowedCommands = new Set([
  "boundary-diff",
  "boundary-rollback",
  "boundary-sync",
  "logs",
  "preflight",
  "probe-health",
  "probe-public-first-save",
]);
const confirmationFlags = new Set([
  "confirm-test-boundary-rollback",
  "confirm-test-boundary-sync",
  "confirm-test-first-save",
]);

type IncidentCommand =
  | "boundary-diff"
  | "boundary-rollback"
  | "boundary-sync"
  | "logs"
  | "preflight"
  | "probe-health"
  | "probe-public-first-save";

interface IncidentArguments {
  readonly command: IncidentCommand;
  readonly stage: StageName;
  readonly profile: string;
  readonly requestId?: string;
  readonly minutes: number;
  readonly versionId?: string;
  readonly confirmations: ReadonlySet<string>;
}

interface DeploymentTarget {
  readonly accountId: string;
  readonly region: "il-central-1";
  readonly deployRoleName: string;
}

interface FoundationOutputs {
  readonly stage: StageName;
  readonly routerUrl: string;
  readonly healthUrl: string;
  readonly apiFunctionName: string;
  readonly tableNames: {
    readonly ClientTable: string;
    readonly SubmissionTable: string;
  };
}

interface IncidentClients {
  readonly sts: Pick<STSClient, "send">;
  readonly iam: Pick<IAMClient, "send">;
  readonly logs: Pick<CloudWatchLogsClient, "send">;
  readonly dynamo: Pick<DynamoDBDocumentClient, "send">;
}

interface CommandDependencies {
  readonly clients?: IncidentClients;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: () => Date;
  readonly idGenerator?: () => string;
  readonly tokenGenerator?: () => string;
  readonly outputs?: FoundationOutputs;
}

function fail(message: string): never {
  throw new Error(message);
}

function isStageName(value: string): value is StageName {
  return value === "test" || value === "production";
}

export function parseIncidentArguments(argv: readonly string[]): IncidentArguments {
  const command = argv[0];
  if (!command || !allowedCommands.has(command)) {
    fail(
      "Expected one of: preflight, logs, boundary-diff, boundary-sync, boundary-rollback, probe-health, probe-public-first-save",
    );
  }
  const options = new Map<string, string>();
  const confirmations = new Set<string>();
  for (let index = 1; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw?.startsWith("--")) fail(`Unexpected argument: ${raw ?? ""}`);
    const name = raw.slice(2);
    if (confirmationFlags.has(name)) {
      confirmations.add(name);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`Missing value for --${name}`);
    if (options.has(name)) fail(`Duplicate option: --${name}`);
    options.set(name, value);
    index += 1;
  }
  const unknown = [...options.keys()].filter(
    (name) => !["minutes", "profile", "request-id", "stage", "version-id"].includes(name),
  );
  if (unknown.length > 0) fail(`Unknown option: --${unknown[0]}`);
  const stage = options.get("stage");
  if (!stage || !isStageName(stage)) fail("--stage must be test or production");
  const profile = options.get("profile");
  if (!profile || !/^[A-Za-z0-9_.@+-]{1,128}$/u.test(profile)) {
    fail("An explicit safe --profile value is required");
  }
  const minutes = Number(options.get("minutes") ?? "15");
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    fail("--minutes must be an integer from 1 to 60");
  }
  const requestId = options.get("request-id");
  if (requestId && !/^[A-Za-z0-9._:/-]{1,256}$/u.test(requestId)) {
    fail("--request-id has an invalid format");
  }
  const versionId = options.get("version-id");
  if (versionId && !/^v\d+$/u.test(versionId)) {
    fail("--version-id must be an IAM policy version such as v2");
  }
  return {
    command: command as IncidentCommand,
    stage,
    profile,
    requestId,
    minutes,
    versionId,
    confirmations,
  };
}

function deploymentTarget(stage: StageName): DeploymentTarget {
  const manifest = deploymentTargetsJson as {
    readonly schemaVersion: number;
    readonly app: string;
    readonly targets: Record<StageName, DeploymentTarget>;
  };
  const target = manifest.targets[stage];
  if (
    manifest.schemaVersion !== 1 ||
    manifest.app !== "auditflow" ||
    !/^\d{12}$/u.test(target?.accountId ?? "") ||
    target.region !== "il-central-1" ||
    target.deployRoleName !== `auditflow-${stage}-github-deploy`
  ) {
    fail("The AuditFlow deployment target contract is invalid");
  }
  return target;
}

function createClients(profile: string, target: DeploymentTarget): IncidentClients {
  // This repository intentionally pins Node 20.17.0; keep CLI JSON free of SDK lifecycle warnings.
  process.env.AWS_SDK_JS_NODE_VERSION_SUPPORT_WARNING_DISABLED = "true";
  const credentials = fromIni({ profile });
  return {
    sts: new STSClient({ region: target.region, credentials }),
    iam: new IAMClient({ region: target.region, credentials }),
    logs: new CloudWatchLogsClient({ region: target.region, credentials }),
    dynamo: DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: target.region, credentials }),
      { marshallOptions: { removeUndefinedValues: true } },
    ),
  };
}

function readOutputs(stage: StageName): FoundationOutputs {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      readFileSync(resolve(repositoryRoot, ".sst/outputs.json"), "utf8"),
    );
  } catch {
    fail(".sst/outputs.json is missing or invalid; run an SST diff for the selected stage first");
  }
  const value = parsed as Partial<FoundationOutputs>;
  if (
    value.stage !== stage ||
    typeof value.routerUrl !== "string" ||
    typeof value.healthUrl !== "string" ||
    typeof value.apiFunctionName !== "string" ||
    !value.apiFunctionName.startsWith(`auditflow-${stage}-`) ||
    typeof value.tableNames?.ClientTable !== "string" ||
    typeof value.tableNames?.SubmissionTable !== "string"
  ) {
    fail(".sst/outputs.json does not match the selected AuditFlow stage");
  }
  return value as FoundationOutputs;
}

export function validateIncidentIdentity(
  identity: { readonly Account?: string; readonly Arn?: string },
  target: DeploymentTarget,
  ownerMutation = false,
) {
  if (identity.Account !== target.accountId) {
    fail("AWS caller does not match the configured AuditFlow stage account");
  }
  if (
    ownerMutation &&
    (identity.Arn?.endsWith(":root") ||
      identity.Arn?.includes(`assumed-role/${target.deployRoleName}/`))
  ) {
    fail("This operation requires a non-root owner-authenticated profile");
  }
  return { status: "verified" as const };
}

async function verifiedIdentity(
  clients: IncidentClients,
  target: DeploymentTarget,
  ownerMutation = false,
) {
  const identity = await clients.sts.send(new GetCallerIdentityCommand({}));
  validateIncidentIdentity(identity, target, ownerMutation);
}

function policyArn(target: DeploymentTarget, stage: StageName) {
  return `arn:aws:iam::${target.accountId}:policy/auditflow-${stage}-workload-boundary`;
}

function normalized(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(normalized).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${normalized((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

function parsePolicyDocument(value: unknown): IamPolicyDocument {
  if (value && typeof value === "object") return value as IamPolicyDocument;
  if (typeof value !== "string") fail("The deployed boundary document is missing");
  for (const candidate of [value, decodeURIComponent(value)]) {
    try {
      return JSON.parse(candidate) as IamPolicyDocument;
    } catch {
      // Try the next representation returned by IAM.
    }
  }
  fail("The deployed boundary document is invalid");
}

function statementActions(statement: IamPolicyStatement | undefined) {
  if (!statement) return [];
  return (Array.isArray(statement.Action) ? statement.Action : [statement.Action]) as string[];
}

export function diffBoundaryPolicies(
  current: IamPolicyDocument,
  desired: IamPolicyDocument,
) {
  const currentBySid = new Map(current.Statement.map((entry) => [entry.Sid, entry]));
  const desiredBySid = new Map(desired.Statement.map((entry) => [entry.Sid, entry]));
  const statementIds = new Set([...currentBySid.keys(), ...desiredBySid.keys()]);
  const changes = [...statementIds]
    .sort()
    .flatMap((sid) => {
      const before = currentBySid.get(sid);
      const after = desiredBySid.get(sid);
      const beforeActions = new Set(statementActions(before));
      const afterActions = new Set(statementActions(after));
      const addedActions = [...afterActions].filter((action) => !beforeActions.has(action)).sort();
      const removedActions = [...beforeActions].filter((action) => !afterActions.has(action)).sort();
      const resourceChanged = normalized(before?.Resource) !== normalized(after?.Resource);
      const conditionChanged = normalized(before?.Condition) !== normalized(after?.Condition);
      return addedActions.length || removedActions.length || resourceChanged || conditionChanged
        ? [{ sid, addedActions, removedActions, resourceChanged, conditionChanged }]
        : [];
    });
  return { identical: normalized(current) === normalized(desired), changes };
}

async function boundaryState(
  clients: IncidentClients,
  target: DeploymentTarget,
  stage: StageName,
) {
  const arn = policyArn(target, stage);
  const policy = (
    await clients.iam.send(new GetPolicyCommand({ PolicyArn: arn }))
  ).Policy;
  if (
    !policy ||
    policy.Arn !== arn ||
    policy.PolicyName !== `auditflow-${stage}-workload-boundary` ||
    !policy.DefaultVersionId
  ) {
    fail("The deployed workload boundary does not match the AuditFlow contract");
  }
  const version = await clients.iam.send(
    new GetPolicyVersionCommand({
      PolicyArn: arn,
      VersionId: policy.DefaultVersionId,
    }),
  );
  return {
    arn,
    versionId: policy.DefaultVersionId,
    document: parsePolicyDocument(version.PolicyVersion?.Document),
  };
}

async function listPolicyVersions(clients: IncidentClients, arn: string) {
  const versions = (
    await clients.iam.send(new ListPolicyVersionsCommand({ PolicyArn: arn }))
  ).Versions;
  return [...(versions ?? [])].filter(
    (version): version is PolicyVersion & { VersionId: string } =>
      typeof version.VersionId === "string",
  );
}

function oldestNonDefault(versions: readonly PolicyVersion[]) {
  return [...versions]
    .filter((version) => !version.IsDefaultVersion && version.VersionId)
    .sort(
      (left, right) =>
        (left.CreateDate?.getTime() ?? 0) - (right.CreateDate?.getTime() ?? 0),
    )[0]?.VersionId;
}

export async function syncBoundary(
  args: IncidentArguments,
  clients: IncidentClients,
) {
  if (
    args.stage !== "test" ||
    !args.confirmations.has("confirm-test-boundary-sync")
  ) {
    fail("Boundary sync is test-only and requires --confirm-test-boundary-sync");
  }
  const target = deploymentTarget(args.stage);
  await verifiedIdentity(clients, target, true);
  const current = await boundaryState(clients, target, args.stage);
  const desired = buildWorkloadBoundaryPolicy(target.accountId, args.stage, target.region);
  const diff = diffBoundaryPolicies(current.document, desired);
  if (diff.identical) {
    return { status: "unchanged" as const, stage: args.stage, versionId: current.versionId };
  }
  let versions = await listPolicyVersions(clients, current.arn);
  if (versions.length >= 5) {
    const stale = oldestNonDefault(versions);
    if (!stale) fail("The boundary has no removable non-default policy version");
    await clients.iam.send(
      new DeletePolicyVersionCommand({ PolicyArn: current.arn, VersionId: stale }),
    );
  }
  const created = await clients.iam.send(
    new CreatePolicyVersionCommand({
      PolicyArn: current.arn,
      PolicyDocument: JSON.stringify(desired),
      SetAsDefault: true,
    }),
  );
  const versionId = created.PolicyVersion?.VersionId;
  if (!versionId) fail("IAM did not return the new boundary version");
  const readback = parsePolicyDocument(
    (
      await clients.iam.send(
        new GetPolicyVersionCommand({
          PolicyArn: current.arn,
          VersionId: versionId,
        }),
      )
    ).PolicyVersion?.Document,
  );
  if (normalized(readback) !== normalized(desired)) {
    await clients.iam.send(
      new SetDefaultPolicyVersionCommand({
        PolicyArn: current.arn,
        VersionId: current.versionId,
      }),
    );
    fail("Boundary readback failed; the previous default was restored");
  }
  versions = await listPolicyVersions(clients, current.arn);
  const removedVersions: string[] = [];
  for (const version of versions) {
    if (
      !version.IsDefaultVersion &&
      version.VersionId &&
      version.VersionId !== current.versionId
    ) {
      await clients.iam.send(
        new DeletePolicyVersionCommand({
          PolicyArn: current.arn,
          VersionId: version.VersionId,
        }),
      );
      removedVersions.push(version.VersionId);
    }
  }
  return {
    status: "updated" as const,
    stage: args.stage,
    previousVersionId: current.versionId,
    versionId,
    removedVersions,
    changes: diff.changes,
  };
}

async function rollbackBoundary(
  args: IncidentArguments,
  clients: IncidentClients,
) {
  if (
    args.stage !== "test" ||
    !args.confirmations.has("confirm-test-boundary-rollback") ||
    !args.versionId
  ) {
    fail(
      "Boundary rollback is test-only and requires --version-id plus --confirm-test-boundary-rollback",
    );
  }
  const target = deploymentTarget(args.stage);
  await verifiedIdentity(clients, target, true);
  const current = await boundaryState(clients, target, args.stage);
  const versions = await listPolicyVersions(clients, current.arn);
  const rollbackCandidates = versions
    .filter((version) => !version.IsDefaultVersion && version.VersionId)
    .sort(
      (left, right) =>
        (right.CreateDate?.getTime() ?? 0) - (left.CreateDate?.getTime() ?? 0),
    );
  if (rollbackCandidates[0]?.VersionId !== args.versionId) {
    fail("Rollback is restricted to the newest non-default boundary version");
  }
  await clients.iam.send(
    new SetDefaultPolicyVersionCommand({
      PolicyArn: current.arn,
      VersionId: args.versionId,
    }),
  );
  const after = await boundaryState(clients, target, args.stage);
  if (after.versionId !== args.versionId) fail("Boundary rollback readback failed");
  return {
    status: "rolled-back" as const,
    stage: args.stage,
    previousVersionId: current.versionId,
    versionId: after.versionId,
  };
}

function safeLogMessage(message: string) {
  return redactProviderMessage(message.replace(/[\r\n]+/gu, " "));
}

async function queryLogs(
  args: IncidentArguments,
  clients: IncidentClients,
  outputs: FoundationOutputs,
  now: Date,
) {
  if (!args.requestId) fail("logs requires --request-id");
  const response = await clients.logs.send(
    new FilterLogEventsCommand({
      logGroupName: `/aws/lambda/${outputs.apiFunctionName}`,
      startTime: now.getTime() - args.minutes * 60_000,
      filterPattern: `\"${args.requestId}\"`,
      limit: 50,
    }),
  );
  return {
    status: "complete" as const,
    stage: args.stage,
    requestId: args.requestId,
    events: (response.events ?? []).map((event) => ({
      timestamp: event.timestamp
        ? new Date(event.timestamp).toISOString()
        : undefined,
      message: safeLogMessage(event.message ?? ""),
    })),
  };
}

async function probeHealth(
  args: IncidentArguments,
  fetcher: typeof globalThis.fetch,
  outputs: FoundationOutputs,
) {
  const response = await fetcher(outputs.healthUrl, {
    headers: { accept: "application/json" },
  });
  const body = (await response.json().catch(() => undefined)) as
    | { readonly ok?: unknown; readonly stage?: unknown }
    | undefined;
  if (!response.ok || body?.ok !== true || body.stage !== args.stage) {
    fail(`AuditFlow health probe failed with HTTP ${response.status}`);
  }
  return { status: "healthy" as const, stage: args.stage, httpStatus: response.status };
}

async function queryProbeSubmissions(
  dynamo: IncidentClients["dynamo"],
  tableName: string,
  clientId: string,
) {
  const response = await dynamo.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: "byClientYear",
      KeyConditionExpression: "#client_id = :client_id",
      ExpressionAttributeNames: { "#client_id": "client_id" },
      ExpressionAttributeValues: { ":client_id": clientId },
      ProjectionExpression: "id",
    }),
  );
  return (response.Items ?? []).flatMap((item) =>
    typeof item.id === "string" ? [item.id] : [],
  );
}

async function probePublicFirstSave(
  args: IncidentArguments,
  clients: IncidentClients,
  fetcher: typeof globalThis.fetch,
  outputs: FoundationOutputs,
  dependencies: CommandDependencies,
) {
  if (
    args.stage !== "test" ||
    !args.confirmations.has("confirm-test-first-save")
  ) {
    fail("The first-save probe is test-only and requires --confirm-test-first-save");
  }
  const now = (dependencies.clock ?? (() => new Date()))();
  const clientId = (dependencies.idGenerator ?? randomUUID)();
  const token = (dependencies.tokenGenerator ?? (() => randomBytes(32).toString("base64url")))();
  const taxYear = now.getUTCFullYear();
  const clientTable = outputs.tableNames.ClientTable;
  const submissionTable = outputs.tableNames.SubmissionTable;
  const createdAt = now.toISOString();
  let httpStatus = 0;
  let providerRequestId: string | undefined;
  let responseSubmissionId: string | undefined;
  let requestFailure: Error | undefined;

  await clients.dynamo.send(
    new PutCommand({
      TableName: clientTable,
      Item: {
        id: clientId,
        full_name: "AuditFlow incident probe",
        tax_year: taxYear,
        status: "in_progress",
        token,
        record_type: "Client",
        _version: 1,
        created_date: createdAt,
        updated_date: createdAt,
        created_by: "auditflow-incident-probe",
      },
      ConditionExpression: "attribute_not_exists(#id)",
      ExpressionAttributeNames: { "#id": "id" },
    }),
  );

  try {
    const response = await fetcher(
      `${outputs.routerUrl.replace(/\/$/u, "")}/api/apps/auditflow/functions/updateClientSubmission`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          token,
          data: { responses: "{}", step_completed: 0 },
          completed: false,
        }),
      },
    );
    httpStatus = response.status;
    providerRequestId =
      response.headers.get("x-amzn-requestid") ??
      response.headers.get("x-amz-apigw-id") ??
      undefined;
    const body = (await response.json().catch(() => undefined)) as
      | { readonly submission?: { readonly id?: unknown } }
      | undefined;
    if (typeof body?.submission?.id === "string") {
      responseSubmissionId = body.submission.id;
    }
    if (!response.ok || !responseSubmissionId) {
      requestFailure = new Error(
        `Public first-save probe failed with HTTP ${response.status}${
          providerRequestId ? ` (request ${providerRequestId})` : ""
        }`,
      );
    }
  } catch (error) {
    requestFailure = new Error("Public first-save probe request failed", {
      cause: error,
    });
  }

  let submissionIds = responseSubmissionId ? [responseSubmissionId] : [];
  try {
    submissionIds = [
      ...new Set([
        ...submissionIds,
        ...(await queryProbeSubmissions(clients.dynamo, submissionTable, clientId)),
      ]),
    ];
  } finally {
    const cleanup = await Promise.allSettled([
      ...submissionIds.map((submissionId) =>
        clients.dynamo.send(
          new DeleteCommand({ TableName: submissionTable, Key: { id: submissionId } }),
        ),
      ),
      clients.dynamo.send(
        new DeleteCommand({
          TableName: submissionTable,
          Key: { id: `!ACTIVE#${clientId}#${taxYear}` },
        }),
      ),
      clients.dynamo.send(
        new DeleteCommand({ TableName: clientTable, Key: { id: clientId } }),
      ),
    ]);
    if (cleanup.some((result) => result.status === "rejected")) {
      fail("Public first-save probe cleanup failed; inspect diagnostic records by marker");
    }
  }
  if (requestFailure) throw requestFailure;
  return {
    status: "passed" as const,
    stage: args.stage,
    httpStatus,
    providerRequestId,
    cleanedBusinessRecords: submissionIds.length + 2,
    auditTrailRetained: true,
  };
}

export async function runIncidentCommand(
  args: IncidentArguments,
  dependencies: CommandDependencies = {},
) {
  const target = deploymentTarget(args.stage);
  const clients = dependencies.clients ?? createClients(args.profile, target);
  if (args.command === "boundary-sync") return syncBoundary(args, clients);
  if (args.command === "boundary-rollback") return rollbackBoundary(args, clients);
  await verifiedIdentity(clients, target);
  if (args.command === "preflight") {
    return {
      status: "verified" as const,
      stage: args.stage,
      region: target.region,
      profile: args.profile,
    };
  }
  if (args.command === "boundary-diff") {
    const current = await boundaryState(clients, target, args.stage);
    const desired = buildWorkloadBoundaryPolicy(target.accountId, args.stage, target.region);
    return {
      status: "complete" as const,
      stage: args.stage,
      versionId: current.versionId,
      ...diffBoundaryPolicies(current.document, desired),
    };
  }
  const outputs = dependencies.outputs ?? readOutputs(args.stage);
  if (args.command === "probe-health") {
    return probeHealth(args, dependencies.fetch ?? globalThis.fetch, outputs);
  }
  if (args.command === "logs") {
    return queryLogs(
      args,
      clients,
      outputs,
      (dependencies.clock ?? (() => new Date()))(),
    );
  }
  return probePublicFirstSave(
    args,
    clients,
    dependencies.fetch ?? globalThis.fetch,
    outputs,
    dependencies,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const args = parseIncidentArguments(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(await runIncidentCommand(args), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? redactProviderMessage(error.message) : "AuditFlow incident command failed"}\n`,
    );
    process.exitCode = 1;
  }
}
