import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutputPath = resolve(repositoryRoot, ".sst", "deployment-cockpit.html");
const allowedStages = ["test", "production"];
const repositoryUrl = "https://github.com/noamtz/cpa-platform";

function fail(message) {
  throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function tryCommand(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function insideRepository(path) {
  const relation = relative(repositoryRoot, path);
  return relation === "" || (!relation.startsWith("..") && !relation.includes(":"));
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

export function parseArguments(argv) {
  const parsed = {
    open: false,
    output: defaultOutputPath,
    outputs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--open") {
      parsed.open = true;
      continue;
    }
    if (argument === "--help") {
      parsed.help = true;
      continue;
    }
    if (!["--output", "--outputs"].includes(argument)) {
      fail(`Unknown option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      fail(`Missing value for ${argument}.`);
    }
    index += 1;
    if (argument === "--output") parsed.output = resolve(value);
    else parsed.outputs.push(resolve(value));
  }

  if (extname(parsed.output).toLowerCase() !== ".html") {
    fail("Cockpit output must be an .html file.");
  }
  return parsed;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function encoded(value) {
  return encodeURIComponent(String(value));
}

function consoleLinks(region) {
  const regionQuery = `region=${encoded(region)}`;
  return {
    api: (id) =>
      `https://${region}.console.aws.amazon.com/apigateway/main/apis/${encoded(id)}/routes?api=${encoded(id)}&${regionQuery}`,
    bucket: (name) =>
      `https://s3.console.aws.amazon.com/s3/buckets/${encoded(name)}?${regionQuery}`,
    cloudFront: (id) =>
      `https://console.aws.amazon.com/cloudfront/v4/home#/distributions/${encoded(id)}`,
    cognito: (id) =>
      `https://${region}.console.aws.amazon.com/cognito/v2/idp/user-pools/${encoded(id)}/overview?${regionQuery}`,
    dynamo: (name) =>
      `https://${region}.console.aws.amazon.com/dynamodbv2/home?${regionQuery}#table?name=${encoded(name)}`,
    home: `https://${region}.console.aws.amazon.com/console/home?${regionQuery}`,
    lambda: (name) =>
      `https://${region}.console.aws.amazon.com/lambda/home?${regionQuery}#/functions/${encoded(name)}`,
    logs: `https://${region}.console.aws.amazon.com/cloudwatch/home?${regionQuery}#logsV2:log-groups`,
    role: (name) =>
      `https://us-east-1.console.aws.amazon.com/iam/home#/roles/details/${encoded(name)}`,
  };
}

function githubFile(path) {
  return `${repositoryUrl}/blob/main/${normalizePath(path)}`;
}

function githubEnvironment(name) {
  return `${repositoryUrl}/settings/environments/${encoded(name)}`;
}

function readGitSnapshot() {
  const commit = tryCommand("git", ["rev-parse", "--short", "HEAD"]);
  const branch = tryCommand("git", ["branch", "--show-current"]);
  const changes = tryCommand("git", ["status", "--porcelain"])
    .split(/\r?\n/u)
    .filter(Boolean).length;
  return {
    branch: branch || "unknown",
    changes,
    commit: commit || "unknown",
  };
}

function discoverOutputs(explicitPaths) {
  const candidates =
    explicitPaths.length > 0
      ? explicitPaths
      : [
          resolve(repositoryRoot, ".sst", "outputs.json"),
          resolve(repositoryRoot, ".sst", "test-outputs.json"),
          resolve(repositoryRoot, ".sst", "production-outputs.json"),
        ];
  const snapshots = new Map();
  for (const path of new Set(candidates)) {
    if (!existsSync(path)) continue;
    const output = readJson(path);
    if (!allowedStages.includes(output.stage)) {
      fail(`SST outputs use an unsupported stage: ${path}`);
    }
    if (snapshots.has(output.stage)) {
      fail(`More than one SST output snapshot was supplied for ${output.stage}.`);
    }
    snapshots.set(output.stage, {
      output,
      path: insideRepository(path) ? normalizePath(relative(repositoryRoot, path)) : path,
    });
  }
  return snapshots;
}

function readTerraformInventory(path) {
  const source = readFileSync(resolve(repositoryRoot, path), "utf8");
  return [...source.matchAll(/^resource\s+"([^"]+)"\s+"([^"]+)"/gmu)].map(
    ([, type, name]) => ({ name, type }),
  );
}

function readConfigurationNames() {
  const source = readFileSync(resolve(repositoryRoot, ".env.example"), "utf8");
  return [...source.matchAll(/^([A-Z][A-Z0-9_]*)=/gmu)].map(([, name]) => name);
}

function commandFor(stage, action) {
  const commands = {
    production: {
      preview: "npx sst diff --stage production --print-logs",
      verify: "node tooling/verify_sst_foundation.mjs --mode live --stage production --outputs .sst/production-outputs.json",
    },
    test: {
      deploy: "npm run sst:deploy:test",
      preview: "npm run sst:diff:test",
      verify: "node tooling/verify_sst_foundation.mjs --mode live --stage test --outputs .sst/outputs.json",
    },
  };
  return commands[stage]?.[action];
}

function buildEnvironment(stage, target, foundation, snapshot) {
  const output = snapshot?.output;
  const links = consoleLinks(target.region);
  const tables = foundation.tables.map(({ logicalName }) => ({
    consoleUrl: output?.tableNames?.[logicalName]
      ? links.dynamo(output.tableNames[logicalName])
      : undefined,
    logicalName,
    physicalName: output?.tableNames?.[logicalName],
  }));
  const buckets = foundation.buckets.map(({ logicalName, private: isPrivate }) => ({
    consoleUrl: output?.bucketNames?.[logicalName]
      ? links.bucket(output.bucketNames[logicalName])
      : undefined,
    isPrivate,
    logicalName,
    physicalName: output?.bucketNames?.[logicalName],
  }));
  const roleName = target.deployRoleName;
  const resources = [
    {
      consoleUrl: output?.routerDistributionId
        ? links.cloudFront(output.routerDistributionId)
        : undefined,
      kind: "CloudFront",
      name: output?.routerDistributionId,
      logicalName: "ApplicationRouter",
    },
    {
      consoleUrl: output?.apiId ? links.api(output.apiId) : undefined,
      kind: "API Gateway",
      name: output?.apiId,
      logicalName: "ApplicationApi",
    },
    {
      consoleUrl: output?.apiFunctionName
        ? links.lambda(output.apiFunctionName)
        : undefined,
      kind: "Lambda",
      name: output?.apiFunctionName,
      logicalName: "ApiFunction",
    },
    {
      consoleUrl: output?.pdfApiId ? links.api(output.pdfApiId) : undefined,
      kind: "API Gateway",
      name: output?.pdfApiId,
      logicalName: "PdfApi",
    },
    {
      consoleUrl: output?.pdfFunctionName
        ? links.lambda(output.pdfFunctionName)
        : undefined,
      kind: "Lambda",
      name: output?.pdfFunctionName,
      logicalName: "PdfRendererFunction",
    },
    {
      consoleUrl: output?.zipWorkerFunctionName
        ? links.lambda(output.zipWorkerFunctionName)
        : undefined,
      kind: "Lambda",
      name: output?.zipWorkerFunctionName,
      logicalName: "ZipDownloadWorker",
    },
    {
      consoleUrl: output?.userPoolId ? links.cognito(output.userPoolId) : undefined,
      kind: "Cognito",
      name: output?.userPoolId,
      logicalName: "UserPool",
    },
    {
      consoleUrl: links.role(roleName),
      kind: "IAM",
      name: roleName,
      logicalName: stage === "test" ? "TestDeployRole" : "ProductionDeployRole",
    },
  ];

  return {
    buckets,
    commands: {
      deploy: commandFor(stage, "deploy"),
      preview: commandFor(stage, "preview"),
      verify: commandFor(stage, "verify"),
    },
    githubEnvironmentUrl: githubEnvironment(stage),
    links,
    output,
    resources,
    snapshotPath: snapshot?.path,
    stage,
    tables,
    target: {
      region: target.region,
      roleName,
    },
  };
}

export function createCockpitModel({ root = repositoryRoot, outputs = [] } = {}) {
  if (resolve(root) !== repositoryRoot) {
    fail("Custom repository roots are not supported by this generator.");
  }
  const targets = readJson(resolve(root, "infra/sst/deployment-targets.json"));
  const foundation = readJson(resolve(root, "infra/sst/foundation-contract.json"));
  const snapshots = discoverOutputs(outputs);
  const terraform = {
    production: readTerraformInventory("infra/prod/main.tf"),
    test: readTerraformInventory("infra/test/main.tf"),
  };
  return {
    configurationNames: readConfigurationNames(),
    environments: allowedStages.map((stage) =>
      buildEnvironment(
        stage,
        targets.targets[stage],
        foundation,
        snapshots.get(stage),
      ),
    ),
    foundation: {
      bucketCount: foundation.buckets.length,
      routeCount: foundation.routes.length,
      sstVersion: foundation.sstVersion,
      tableCount: foundation.tables.length,
    },
    generatedAt: new Date().toISOString(),
    git: readGitSnapshot(),
    terraform,
  };
}

function link(url, label, className = "") {
  if (!url) return `<span class="muted">${escapeHtml(label)}</span>`;
  return `<a class="${className}" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function badge(label, tone = "neutral") {
  return `<span class="badge badge-${tone}">${escapeHtml(label)}</span>`;
}

function resourceRows(environment) {
  const rows = [
    ...environment.resources,
    ...environment.tables.map((resource) => ({
      ...resource,
      kind: "DynamoDB",
      name: resource.physicalName,
    })),
    ...environment.buckets.map((resource) => ({
      ...resource,
      kind: "S3",
      name: resource.physicalName,
    })),
  ];
  return rows
    .map(
      ({ consoleUrl, kind, logicalName, name }) => `
        <tr>
          <td data-label="Service">${escapeHtml(kind)}</td>
          <td data-label="Logical"><code>${escapeHtml(logicalName)}</code></td>
          <td data-label="Physical">${name ? `<code>${escapeHtml(name)}</code>` : '<span class="muted">Not in local snapshot</span>'}</td>
          <td data-label="Action">${consoleUrl ? link(consoleUrl, "Open console", "row-link") : '<span class="muted">Unavailable</span>'}</td>
        </tr>`,
    )
    .join("");
}

function commandBlock(label, command) {
  if (!command) return "";
  return `
    <div class="command-row">
      <div><span class="command-label">${escapeHtml(label)}</span><code>${escapeHtml(command)}</code></div>
      <button type="button" class="copy-button" data-copy="${escapeHtml(command)}">Copy</button>
    </div>`;
}

function environmentSection(environment) {
  const hasSnapshot = Boolean(environment.output);
  const urls = [
    ["Application", environment.output?.siteUrl],
    ["API", environment.output?.apiUrl],
    ["PDF through router", environment.output?.pdfBaseUrl],
    ["Health", environment.output?.healthUrl],
  ].filter(([, url]) => url);
  return `
    <section class="environment-panel" data-stage-panel="${escapeHtml(environment.stage)}" ${environment.stage === "test" ? "" : "hidden"}>
      <div class="section-heading">
        <div>
          <p class="eyebrow">Environment</p>
          <h2>${escapeHtml(environment.stage)}</h2>
        </div>
        <div class="badges">
          ${badge(hasSnapshot ? "Local output snapshot" : "No local snapshot", hasSnapshot ? "good" : "warn")}
          ${badge(environment.stage === "production" ? "Protected · retained" : "Removable", environment.stage === "production" ? "good" : "neutral")}
          ${badge("Not a live health check", "neutral")}
        </div>
      </div>

      <div class="summary-grid">
        <article class="summary-card">
          <span>Region</span>
          <strong>${escapeHtml(environment.target.region)}</strong>
          ${link(environment.links.home, "AWS Console")}
        </article>
        <article class="summary-card">
          <span>Deployment role</span>
          <strong>${escapeHtml(environment.target.roleName)}</strong>
          ${link(environment.links.role(environment.target.roleName), "IAM Console")}
        </article>
        <article class="summary-card">
          <span>SST snapshot</span>
          <strong>${hasSnapshot ? "Available" : "Missing"}</strong>
          <small>${escapeHtml(environment.snapshotPath ?? "Generate or supply an SST outputs file")}</small>
        </article>
        <article class="summary-card">
          <span>GitHub environment</span>
          <strong>${escapeHtml(environment.stage)}</strong>
          ${link(environment.githubEnvironmentUrl, "Environment settings")}
        </article>
      </div>

      <div class="content-grid">
        <div class="content-section">
          <h3>Deployment commands</h3>
          <p class="section-note">Commands are copied only. Authorization and repository gates still apply.</p>
          <div class="commands">
            ${commandBlock("Preview", environment.commands.preview)}
            ${commandBlock("Deploy", environment.commands.deploy)}
            ${commandBlock("Verify live", environment.commands.verify)}
          </div>
        </div>
        <div class="content-section">
          <h3>Endpoints</h3>
          <p class="section-note">Values come from the local SST output snapshot.</p>
          <div class="endpoint-list">
            ${urls.length > 0 ? urls.map(([label, url]) => `<div><span>${escapeHtml(label)}</span>${link(url, url)}</div>`).join("") : '<p class="empty">No endpoint snapshot is available for this stage.</p>'}
          </div>
        </div>
      </div>

      <div class="content-section resource-section">
        <div class="resource-heading">
          <div>
            <h3>AWS resources</h3>
            <p class="section-note">Expected logical inventory plus physical identifiers found in the snapshot.</p>
          </div>
          ${link(environment.links.logs, "CloudWatch logs", "button-link")}
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Service</th><th>Logical resource</th><th>Physical resource</th><th>Action</th></tr></thead>
            <tbody>${resourceRows(environment)}</tbody>
          </table>
        </div>
      </div>
    </section>`;
}

function terraformSummary(model) {
  return allowedStages
    .map((stage) => {
      const resources = model.terraform[stage];
      const types = [...new Set(resources.map(({ type }) => type))];
      return `
        <article class="ownership-item">
          <div>
            <span class="ownership-label">Terraform · ${escapeHtml(stage)}</span>
            <strong>${resources.length} retained legacy PDF resources</strong>
            <small>${escapeHtml(types.join(", "))}</small>
          </div>
          ${link(githubFile(`infra/${stage === "production" ? "prod" : "test"}/main.tf`), "Open definition")}
        </article>`;
    })
    .join("");
}

export function renderCockpit(model) {
  const snapshotCount = model.environments.filter(({ output }) => output).length;
  const totalTerraform = Object.values(model.terraform).flat().length;
  const dirtyLabel = model.git.changes === 0 ? "Clean" : `${model.git.changes} local changes`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>AuditFlow Deployment Cockpit</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #08111f;
      --panel: #101c2d;
      --panel-2: #142338;
      --text: #edf5ff;
      --muted: #95a8c2;
      --border: #263a53;
      --accent: #6ee7d8;
      --accent-2: #7bb7ff;
      --good: #78e6a3;
      --warn: #ffd27a;
      --shadow: 0 18px 50px rgba(0, 0, 0, .22);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at top left, #102a43 0, var(--bg) 38rem);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
    }
    a { color: var(--accent-2); text-decoration: none; }
    a:hover { text-decoration: underline; }
    button, a { outline-offset: 3px; }
    code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; overflow-wrap: anywhere; }
    .shell { width: min(1440px, calc(100% - 32px)); margin: 0 auto; padding: 34px 0 60px; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 26px; }
    .eyebrow { color: var(--accent); font-size: 12px; font-weight: 700; letter-spacing: .16em; margin: 0 0 8px; text-transform: uppercase; }
    h1, h2, h3 { margin: 0; }
    h1 { font-size: clamp(29px, 4vw, 46px); letter-spacing: -.04em; }
    h2 { font-size: 28px; text-transform: capitalize; }
    h3 { font-size: 17px; }
    .subtitle { color: var(--muted); line-height: 1.55; margin: 10px 0 0; max-width: 740px; }
    .quick-links { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .button-link, .tab, .copy-button {
      align-items: center;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 9px;
      color: var(--text);
      cursor: pointer;
      display: inline-flex;
      font: inherit;
      font-size: 13px;
      gap: 6px;
      justify-content: center;
      padding: 9px 12px;
      text-decoration: none;
    }
    .button-link:hover, .tab:hover, .copy-button:hover { background: var(--panel-2); text-decoration: none; }
    .notice {
      align-items: center;
      background: rgba(255, 210, 122, .08);
      border: 1px solid rgba(255, 210, 122, .3);
      border-radius: 10px;
      color: var(--warn);
      display: flex;
      font-size: 13px;
      gap: 10px;
      margin-bottom: 20px;
      padding: 11px 14px;
    }
    .metrics { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 20px; }
    .metric, .summary-card, .content-section, .ownership {
      background: linear-gradient(145deg, rgba(20, 35, 56, .96), rgba(14, 26, 43, .96));
      border: 1px solid var(--border);
      border-radius: 14px;
      box-shadow: var(--shadow);
    }
    .metric { padding: 17px; }
    .metric span, .summary-card span, .ownership-label { color: var(--muted); display: block; font-size: 12px; letter-spacing: .04em; margin-bottom: 7px; text-transform: uppercase; }
    .metric strong { font-size: 23px; }
    .tabs { display: flex; gap: 8px; margin: 24px 0 16px; }
    .tab[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: #06231f; font-weight: 700; }
    .environment-panel { display: grid; gap: 16px; }
    .section-heading, .resource-heading { align-items: flex-start; display: flex; justify-content: space-between; gap: 18px; }
    .badges { display: flex; flex-wrap: wrap; gap: 7px; justify-content: flex-end; }
    .badge { border: 1px solid var(--border); border-radius: 999px; color: var(--muted); font-size: 12px; padding: 5px 9px; }
    .badge-good { border-color: rgba(120, 230, 163, .45); color: var(--good); }
    .badge-warn { border-color: rgba(255, 210, 122, .45); color: var(--warn); }
    .summary-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .summary-card { box-shadow: none; min-height: 118px; padding: 16px; }
    .summary-card strong { display: block; font-size: 16px; margin-bottom: 10px; overflow-wrap: anywhere; }
    .summary-card a, .summary-card small { color: var(--muted); display: block; font-size: 12px; overflow-wrap: anywhere; }
    .content-grid { display: grid; gap: 16px; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); }
    .content-section { padding: 18px; }
    .section-note { color: var(--muted); font-size: 13px; margin: 6px 0 16px; }
    .commands, .endpoint-list { display: grid; gap: 9px; }
    .command-row, .endpoint-list > div {
      align-items: center;
      background: rgba(8, 17, 31, .55);
      border-radius: 9px;
      display: flex;
      gap: 14px;
      justify-content: space-between;
      min-height: 48px;
      padding: 10px 11px;
    }
    .command-row > div { min-width: 0; }
    .command-label { color: var(--muted); display: block; font-size: 11px; margin-bottom: 4px; text-transform: uppercase; }
    .command-row code { font-size: 12px; }
    .copy-button { flex: 0 0 auto; padding: 7px 10px; }
    .endpoint-list span { color: var(--muted); font-size: 12px; min-width: 118px; }
    .endpoint-list a { font-family: "SFMono-Regular", Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; text-align: right; }
    .empty, .muted { color: var(--muted); }
    .resource-section { margin-top: 0; }
    .table-wrap { overflow-x: auto; }
    table { border-collapse: collapse; font-size: 13px; width: 100%; }
    th { color: var(--muted); font-size: 11px; letter-spacing: .06em; text-align: left; text-transform: uppercase; }
    th, td { border-bottom: 1px solid var(--border); padding: 11px 9px; vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    .ownership { margin-top: 22px; padding: 18px; }
    .ownership-list { display: grid; gap: 2px; margin-top: 12px; }
    .ownership-item { align-items: center; border-bottom: 1px solid var(--border); display: flex; gap: 18px; justify-content: space-between; padding: 13px 2px; }
    .ownership-item:last-child { border-bottom: 0; }
    .ownership-item strong, .ownership-item small { display: block; }
    .ownership-item small { color: var(--muted); font-size: 12px; margin-top: 5px; }
    .configuration { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 13px; }
    .configuration code { background: rgba(8, 17, 31, .65); border-radius: 6px; color: var(--muted); font-size: 11px; padding: 5px 7px; }
    footer { color: var(--muted); font-size: 12px; margin-top: 20px; text-align: center; }
    [hidden] { display: none !important; }
    @media (max-width: 900px) {
      .metrics, .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .content-grid { grid-template-columns: 1fr; }
      .topbar { flex-direction: column; }
      .quick-links { justify-content: flex-start; }
    }
    @media (max-width: 560px) {
      .shell { width: min(100% - 20px, 1440px); padding-top: 22px; }
      .metrics, .summary-grid { grid-template-columns: 1fr; }
      .section-heading, .resource-heading, .ownership-item { align-items: flex-start; flex-direction: column; }
      .badges { justify-content: flex-start; }
      .command-row, .endpoint-list > div { align-items: flex-start; flex-direction: column; }
      .endpoint-list a { text-align: left; }
      .resource-section .table-wrap { overflow: visible; }
      .resource-section table, .resource-section tbody, .resource-section tr, .resource-section td { display: block; width: 100%; }
      .resource-section thead { display: none; }
      .resource-section tr { border-bottom: 1px solid var(--border); padding: 9px 0; }
      .resource-section tr:last-child { border-bottom: 0; }
      .resource-section td { border: 0; display: grid; gap: 10px; grid-template-columns: 72px minmax(0, 1fr); padding: 6px 0; }
      .resource-section td::before { color: var(--muted); content: attr(data-label); font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">AuditFlow operations</p>
        <h1>Deployment Cockpit</h1>
        <p class="subtitle">A local, read-only index of deployment definitions, resource snapshots, environments, commands, and operational links.</p>
      </div>
      <nav class="quick-links" aria-label="Project links">
        ${link(`${repositoryUrl}/actions`, "GitHub Actions", "button-link")}
        ${link(`${repositoryUrl}/deployments`, "Deployments", "button-link")}
        ${link(githubFile("docs/migration/production-readiness-runbook.md"), "Production runbook", "button-link")}
        ${link(githubFile(".agents/references/auditflow-aws-operations.md"), "AWS operations", "button-link")}
      </nav>
    </header>

    <div class="notice"><strong>Local-only artifact.</strong> Resource identifiers may be operationally sensitive. This file is generated under ignored <code>.sst/</code> and must not be committed or published.</div>

    <section class="metrics" aria-label="Cockpit summary">
      <article class="metric"><span>SST version</span><strong>${escapeHtml(model.foundation.sstVersion)}</strong></article>
      <article class="metric"><span>Local stage snapshots</span><strong>${snapshotCount} / ${model.environments.length}</strong></article>
      <article class="metric"><span>SST data resources</span><strong>${model.foundation.tableCount + model.foundation.bucketCount}</strong></article>
      <article class="metric"><span>Retained Terraform resources</span><strong>${totalTerraform}</strong></article>
    </section>

    <div class="tabs" role="tablist" aria-label="Deployment environment">
      ${model.environments.map(({ stage }, index) => `<button type="button" class="tab" role="tab" aria-selected="${index === 0}" data-stage-tab="${escapeHtml(stage)}">${escapeHtml(stage)}</button>`).join("")}
    </div>

    ${model.environments.map(environmentSection).join("")}

    <section class="ownership">
      <p class="eyebrow">Ownership and external state</p>
      <h3>Infrastructure boundaries</h3>
      <div class="ownership-list">
        <article class="ownership-item">
          <div><span class="ownership-label">SST</span><strong>Application foundation and SST PDF API</strong><small>${model.foundation.tableCount} DynamoDB tables · ${model.foundation.bucketCount} S3 buckets · ${model.foundation.routeCount} application routes · remote SST state in AWS</small></div>
          ${link(githubFile("sst.config.ts"), "Open definition")}
        </article>
        ${terraformSummary(model)}
        <article class="ownership-item">
          <div><span class="ownership-label">External</span><strong>GitHub configuration, AWS live state, DNS, credentials, and telemetry</strong><small>Values and live health are intentionally not embedded. Use the stage links and live verifier.</small></div>
          ${link(`${repositoryUrl}/settings/environments`, "GitHub environments")}
        </article>
      </div>
      <div class="configuration" aria-label="Declared environment variables">
        ${model.configurationNames.map((name) => `<code>${escapeHtml(name)}</code>`).join("")}
      </div>
    </section>

    <footer>Generated ${escapeHtml(model.generatedAt)} · branch ${escapeHtml(model.git.branch)} · commit ${escapeHtml(model.git.commit)} · ${escapeHtml(dirtyLabel)}</footer>
  </main>
  <script>
    const tabs = [...document.querySelectorAll("[data-stage-tab]")];
    const panels = [...document.querySelectorAll("[data-stage-panel]")];
    for (const tab of tabs) {
      tab.addEventListener("click", () => {
        const stage = tab.dataset.stageTab;
        for (const candidate of tabs) candidate.setAttribute("aria-selected", String(candidate === tab));
        for (const panel of panels) panel.hidden = panel.dataset.stagePanel !== stage;
      });
    }
    for (const button of document.querySelectorAll("[data-copy]")) {
      button.addEventListener("click", async () => {
        const original = button.textContent;
        try {
          await navigator.clipboard.writeText(button.dataset.copy);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Copy failed";
        }
        window.setTimeout(() => { button.textContent = original; }, 1400);
      });
    }
  </script>
</body>
</html>`;
}

function openFile(path) {
  const platform = process.platform;
  const invocation =
    platform === "win32"
      ? ["cmd", ["/c", "start", "", path]]
      : platform === "darwin"
        ? ["open", [path]]
        : ["xdg-open", [path]];
  const child = spawn(invocation[0], invocation[1], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

export function generateCockpit({ open = false, output = defaultOutputPath, outputs = [] } = {}) {
  const model = createCockpitModel({ outputs });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, renderCockpit(model), "utf8");
  if (open) openFile(output);
  return { model, output };
}

export function usage() {
  return `Usage: node tooling/generate_deployment_cockpit.mjs [options]

Options:
  --output <path>   HTML destination (default: .sst/deployment-cockpit.html)
  --outputs <path>  SST outputs JSON; repeat once per stage
  --open            Open the generated cockpit in the default browser
  --help            Show this help
`;
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.help) {
    process.stdout.write(usage());
    return;
  }
  const result = generateCockpit(arguments_);
  process.stdout.write(`Deployment cockpit generated: ${result.output}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
