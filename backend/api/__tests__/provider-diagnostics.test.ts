import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { internalError } from "../core/errors";
import {
  providerErrorDiagnostics,
  redactProviderMessage,
} from "../core/provider-diagnostics";

describe("provider error diagnostics", () => {
  it("extracts a provider cause without exposing common secrets or PII", () => {
    const provider = Object.assign(
      new Error(
        "Bearer private-value failed for person@example.com in 123456789012 at ?token=link-secret",
      ),
      {
        name: "AccessDeniedException",
        Code: "AccessDenied",
        $metadata: { requestId: "aws-request-1" },
        CancellationReasons: [{ Code: "None" }, { Code: "AccessDenied" }],
      },
    );

    expect(providerErrorDiagnostics(internalError(provider))).toEqual({
      errorName: "AccessDeniedException",
      providerMessage:
        "Bearer [REDACTED] failed for [REDACTED_EMAIL] in [REDACTED_ACCOUNT] at ?token=[REDACTED]",
      providerCode: "AccessDenied",
      awsRequestId: "aws-request-1",
      cancellationCodes: ["None", "AccessDenied"],
    });
  });

  it("bounds diagnostic messages", () => {
    expect(redactProviderMessage("prefix " + "x".repeat(2_000)).length).toBeLessThanOrEqual(
      1_024,
    );
  });

  it("requires caught failures converted to internal errors to preserve their cause", () => {
    const root = resolve(import.meta.dirname, "..");
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.endsWith(".ts") &&
          !entry.parentPath.includes("__tests__"),
      )
      .map((entry) => resolve(entry.parentPath, entry.name));
    const violations: string[] = [];

    for (const file of files) {
      const relativePath = relative(root, file).replaceAll("\\", "/");
      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(
        relativePath,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const visitCatch = (node: ts.Node) => {
        if (ts.isCatchClause(node)) {
          const visitCall = (child: ts.Node) => {
            if (
              ts.isCallExpression(child) &&
              ts.isIdentifier(child.expression) &&
              child.expression.text === "internalError" &&
              child.arguments.length === 0
            ) {
              const line =
                sourceFile.getLineAndCharacterOfPosition(child.getStart()).line + 1;
              violations.push(`${relativePath}:${line}`);
            }
            ts.forEachChild(child, visitCall);
          };
          ts.forEachChild(node.block, visitCall);
          return;
        }
        ts.forEachChild(node, visitCatch);
      };
      visitCatch(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
