import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { getDeploymentTarget } from "../deployment-targets";
import { allowedStages } from "../stage";

describe("deployment targets", () => {
  it.each(allowedStages)("pins the %s stage to the canonical account and region", (stage) => {
    expect(getDeploymentTarget(stage)).toEqual({
      accountId: "006296770641",
      region: "il-central-1",
      deployRoleName: `auditflow-${stage}-github-deploy`,
    });
  });

  it("enforces the account at the SST provider boundary", () => {
    const config = readFileSync(
      new URL("../../../sst.config.ts", import.meta.url),
      "utf8",
    );

    expect(config).toContain("allowedAccountIds: [deploymentTarget.accountId]");
    expect(config).toContain("region: deploymentTarget.region");
  });
});
