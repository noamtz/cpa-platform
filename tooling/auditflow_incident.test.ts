import {
  CreatePolicyVersionCommand,
  DeletePolicyVersionCommand,
  GetPolicyCommand,
  GetPolicyVersionCommand,
  ListPolicyVersionsCommand,
} from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import { DeleteCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";

import { buildWorkloadBoundaryPolicy } from "../infra/sst/deployment-policy";
import targets from "../infra/sst/deployment-targets.json";
import {
  diffBoundaryPolicies,
  parseIncidentArguments,
  runIncidentCommand,
  validateIncidentIdentity,
} from "./auditflow_incident";

const target = { ...targets.targets.test, region: "il-central-1" as const };
const boundaryArn = `arn:aws:iam::${target.accountId}:policy/auditflow-test-workload-boundary`;

function clients(options: {
  readonly account?: string;
  readonly iamSend?: ReturnType<typeof vi.fn>;
  readonly logsSend?: ReturnType<typeof vi.fn>;
  readonly dynamoSend?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    sts: {
      send: vi.fn(async (command) => {
        expect(command).toBeInstanceOf(GetCallerIdentityCommand);
        return {
          Account: options.account ?? target.accountId,
          Arn: `arn:aws:iam::${options.account ?? target.accountId}:user/operator`,
        };
      }),
    },
    iam: { send: options.iamSend ?? vi.fn() },
    logs: { send: options.logsSend ?? vi.fn() },
    dynamo: { send: options.dynamoSend ?? vi.fn() },
  };
}

const outputs = {
  stage: "test" as const,
  routerUrl: "https://test.example.invalid",
  healthUrl: "https://test.example.invalid/api/health",
  apiFunctionName: "auditflow-test-api",
  tableNames: {
    ClientTable: "auditflow-test-client",
    SubmissionTable: "auditflow-test-submission",
  },
};

describe("AuditFlow incident fast path", () => {
  it("requires explicit stage and profile inputs", () => {
    expect(() => parseIncidentArguments(["preflight", "--stage", "test"])).toThrow(
      "explicit safe --profile",
    );
    expect(() =>
      parseIncidentArguments([
        "preflight",
        "--stage",
        "test",
        "--profile",
        "unsafe profile",
      ]),
    ).toThrow("explicit safe --profile");
  });

  it("rejects account mismatch without disclosing either account", () => {
    const action = () =>
      validateIncidentIdentity(
        { Account: "123456789012", Arn: "arn:aws:iam::123456789012:user/wrong" },
        target,
      );
    expect(action).toThrow("does not match");
    try {
      action();
    } catch (error) {
      expect(String(error)).not.toContain("123456789012");
      expect(String(error)).not.toContain(target.accountId);
    }
  });

  it("rejects root and the deployment role for owner-managed mutations", () => {
    expect(() =>
      validateIncidentIdentity(
        { Account: target.accountId, Arn: `arn:aws:iam::${target.accountId}:root` },
        target,
        true,
      ),
    ).toThrow("non-root owner-authenticated profile");
    expect(() =>
      validateIncidentIdentity(
        {
          Account: target.accountId,
          Arn: `arn:aws:sts::${target.accountId}:assumed-role/${target.deployRoleName}/run`,
        },
        target,
        true,
      ),
    ).toThrow("non-root owner-authenticated profile");
  });

  it("reports only action-level boundary drift", () => {
    const desired = buildWorkloadBoundaryPolicy(target.accountId, "test");
    const current = structuredClone(desired);
    const statement = current.Statement.find(({ Sid }) => Sid === "WorkloadDynamoData")!;
    const currentActions = Array.isArray(statement.Action)
      ? statement.Action
      : [statement.Action];
    (statement as unknown as { Action: string[] }).Action = currentActions.filter(
      (action) => action !== "dynamodb:ConditionCheckItem",
    );

    expect(diffBoundaryPolicies(current, desired)).toMatchObject({
      identical: false,
      changes: [
        {
          sid: "WorkloadDynamoData",
          addedActions: ["dynamodb:ConditionCheckItem"],
          removedActions: [],
          resourceChanged: false,
          conditionChanged: false,
        },
      ],
    });
  });

  it("treats an already synchronized boundary as a zero-write operation", async () => {
    const desired = buildWorkloadBoundaryPolicy(target.accountId, "test");
    const iamSend = vi.fn(async (command) => {
      if (command instanceof GetPolicyCommand) {
        return {
          Policy: {
            Arn: boundaryArn,
            PolicyName: "auditflow-test-workload-boundary",
            DefaultVersionId: "v2",
          },
        };
      }
      if (command instanceof GetPolicyVersionCommand) {
        return { PolicyVersion: { Document: desired } };
      }
      throw new Error(`Unexpected IAM command: ${command.constructor.name}`);
    });
    const args = parseIncidentArguments([
      "boundary-sync",
      "--stage",
      "test",
      "--profile",
      "owner",
      "--confirm-test-boundary-sync",
    ]);

    await expect(
      runIncidentCommand(args, { clients: clients({ iamSend }) as never }),
    ).resolves.toEqual({ status: "unchanged", stage: "test", versionId: "v2" });
    expect(
      iamSend.mock.calls.some(([command]) => command instanceof CreatePolicyVersionCommand),
    ).toBe(false);
  });

  it("updates only drifted test boundary state and preserves its previous default", async () => {
    const desired = buildWorkloadBoundaryPolicy(target.accountId, "test");
    const current = structuredClone(desired);
    const statement = current.Statement.find(({ Sid }) => Sid === "WorkloadDynamoData")!;
    const currentActions = Array.isArray(statement.Action)
      ? statement.Action
      : [statement.Action];
    (statement as unknown as { Action: string[] }).Action = currentActions.filter(
      (action) => action !== "dynamodb:ConditionCheckItem",
    );
    let versionListCall = 0;
    const iamSend = vi.fn(async (command) => {
      if (command instanceof GetPolicyCommand) {
        return {
          Policy: {
            Arn: boundaryArn,
            PolicyName: "auditflow-test-workload-boundary",
            DefaultVersionId: "v2",
          },
        };
      }
      if (command instanceof GetPolicyVersionCommand) {
        return {
          PolicyVersion: {
            Document: command.input.VersionId === "v3" ? desired : current,
          },
        };
      }
      if (command instanceof ListPolicyVersionsCommand) {
        versionListCall += 1;
        return {
          Versions:
            versionListCall === 1
              ? [
                  { VersionId: "v1", IsDefaultVersion: false, CreateDate: new Date(1) },
                  { VersionId: "v2", IsDefaultVersion: true, CreateDate: new Date(2) },
                ]
              : [
                  { VersionId: "v1", IsDefaultVersion: false, CreateDate: new Date(1) },
                  { VersionId: "v2", IsDefaultVersion: false, CreateDate: new Date(2) },
                  { VersionId: "v3", IsDefaultVersion: true, CreateDate: new Date(3) },
                ],
        };
      }
      if (command instanceof CreatePolicyVersionCommand) {
        return { PolicyVersion: { VersionId: "v3", IsDefaultVersion: true } };
      }
      if (command instanceof DeletePolicyVersionCommand) return {};
      throw new Error(`Unexpected IAM command: ${command.constructor.name}`);
    });
    const args = parseIncidentArguments([
      "boundary-sync",
      "--stage",
      "test",
      "--profile",
      "owner",
      "--confirm-test-boundary-sync",
    ]);

    await expect(
      runIncidentCommand(args, { clients: clients({ iamSend }) as never }),
    ).resolves.toMatchObject({
      status: "updated",
      previousVersionId: "v2",
      versionId: "v3",
      removedVersions: ["v1"],
    });
    expect(
      iamSend.mock.calls
        .filter(([command]) => command instanceof DeletePolicyVersionCommand)
        .map(([command]) => command.input.VersionId),
    ).toEqual(["v1"]);
  });

  it("redacts request-correlated log output", async () => {
    const logsSend = vi.fn().mockResolvedValue({
      events: [
        {
          timestamp: Date.parse("2026-09-11T00:00:00.000Z"),
          message:
            "AccessDenied for 123456789012 Bearer private-value token=secret-value",
        },
      ],
    });
    const args = parseIncidentArguments([
      "logs",
      "--stage",
      "test",
      "--profile",
      "owner",
      "--request-id",
      "request-1",
    ]);

    const result = await runIncidentCommand(args, {
      clients: clients({ logsSend }) as never,
      outputs,
      clock: () => new Date("2026-09-11T00:10:00.000Z"),
    });

    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(JSON.stringify(result)).not.toContain("secret-value");
    expect(JSON.stringify(result)).not.toContain("123456789012");
  });

  it("cleans disposable first-save business records and retains only the audit trail", async () => {
    const dynamoSend = vi.fn(async (command) => {
      if (command instanceof QueryCommand) {
        return { Items: [{ id: "submission-1" }] };
      }
      return {};
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ submission: { id: "submission-1" } }), {
        status: 200,
        headers: { "x-amzn-requestid": "provider-request-1" },
      }),
    );
    const args = parseIncidentArguments([
      "probe-public-first-save",
      "--stage",
      "test",
      "--profile",
      "owner",
      "--confirm-test-first-save",
    ]);

    const result = await runIncidentCommand(args, {
      clients: clients({ dynamoSend }) as never,
      outputs,
      fetch: fetcher,
      idGenerator: () => "probe-client-1",
      tokenGenerator: () => "never-return-this-token",
      clock: () => new Date("2026-09-11T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "passed",
      httpStatus: 200,
      cleanedBusinessRecords: 3,
      auditTrailRetained: true,
    });
    expect(JSON.stringify(result)).not.toContain("never-return-this-token");
    expect(dynamoSend.mock.calls.filter(([command]) => command instanceof PutCommand)).toHaveLength(1);
    expect(
      dynamoSend.mock.calls.filter(([command]) => command instanceof DeleteCommand),
    ).toHaveLength(3);
  });

  it("refuses every production boundary mutation before IAM inspection", async () => {
    const iamSend = vi.fn();
    const args = parseIncidentArguments([
      "boundary-sync",
      "--stage",
      "production",
      "--profile",
      "owner",
      "--confirm-test-boundary-sync",
    ]);

    await expect(
      runIncidentCommand(args, { clients: clients({ iamSend }) as never }),
    ).rejects.toThrow("test-only");
    expect(iamSend).not.toHaveBeenCalled();
  });
});
