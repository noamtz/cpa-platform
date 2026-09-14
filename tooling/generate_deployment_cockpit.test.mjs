import { readFileSync } from "node:fs";

import {
  createCockpitModel,
  escapeHtml,
  parseArguments,
  renderCockpit,
} from "./generate_deployment_cockpit.mjs";

describe("deployment cockpit generator", () => {
  it("escapes operational values before rendering HTML", () => {
    expect(escapeHtml('<bucket data-owner="cpa">&')).toBe(
      "&lt;bucket data-owner=&quot;cpa&quot;&gt;&amp;",
    );
  });

  it("accepts repeatable SST output snapshots", () => {
    const parsed = parseArguments([
      "--outputs",
      ".sst/outputs.json",
      "--outputs",
      ".sst/production-outputs.json",
      "--output",
      ".sst/cockpit.html",
      "--open",
    ]);
    expect(parsed.outputs).toHaveLength(2);
    expect(parsed.output.endsWith(".sst\\cockpit.html") || parsed.output.endsWith(".sst/cockpit.html")).toBe(true);
    expect(parsed.open).toBe(true);
  });

  it("rejects non-HTML destinations and unknown arguments", () => {
    expect(() => parseArguments(["--output", ".sst/cockpit.json"])).toThrow(
      "must be an .html file",
    );
    expect(() => parseArguments(["--live"])).toThrow("Unknown option");
  });

  it("renders both environments, ownership, links, and safe commands", () => {
    const model = createCockpitModel();
    const html = renderCockpit(model);
    expect(html).toContain("AuditFlow Deployment Cockpit");
    expect(html).toContain('data-stage-tab="test"');
    expect(html).toContain('data-stage-tab="production"');
    expect(html).toContain("Retained Terraform resources");
    expect(html).toContain("npm run sst:diff:test");
    expect(html).toContain("GitHub environments");
    expect(html).toContain("Not a live health check");
    expect(html).not.toContain("006296770641");
  });

  it("does not embed ignored operator configuration", () => {
    const model = createCockpitModel();
    const html = renderCockpit(model);
    const example = readFileSync(".env.example", "utf8");
    for (const match of example.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)) {
      expect(html).toContain(match[1]);
    }
    expect(html).not.toContain(".env.production.local");
  });
});
