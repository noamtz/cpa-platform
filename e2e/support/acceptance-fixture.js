import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "@playwright/test";

const productionHosts = new Set(["app.ddcpa.co.il"]);

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing acceptance fixture field: ${name}`);
  return value;
}

const actionKinds = new Set(["check", "click", "fill", "select", "uncheck"]);
const assertionKinds = new Set(["checked", "hidden", "text", "value", "visible"]);

function validateSteps(steps, name, allowedKinds) {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error(`Stateful acceptance scenario ${name} must not be empty.`);
  }
  return steps.map((step, index) => {
    if (!step || !allowedKinds.has(step.kind)) {
      throw new Error(`Unsupported ${name}[${index}].kind.`);
    }
    requireString(step.selector, `${name}[${index}].selector`);
    if (["fill", "select", "text", "value"].includes(step.kind)) {
      requireString(step.value, `${name}[${index}].value`);
    }
    if (step.kind === "checked" && typeof step.value !== "boolean") {
      throw new Error(`Stateful acceptance field ${name}[${index}].value must be boolean.`);
    }
    return step;
  });
}

export function validateStatefulScenario(scenario, name = "stateful") {
  if (!scenario || typeof scenario !== "object") {
    throw new Error(`Missing acceptance fixture field: ${name}`);
  }
  if (scenario.route !== undefined) {
    const route = requireString(scenario.route, `${name}.route`);
    if (!route.startsWith("/") || route.startsWith("//")) {
      throw new Error(`Stateful acceptance field ${name}.route must be relative.`);
    }
  }
  return {
    ...scenario,
    mutate: validateSteps(scenario.mutate, `${name}.mutate`, actionKinds),
    persisted: validateSteps(scenario.persisted, `${name}.persisted`, assertionKinds),
    restore: validateSteps(scenario.restore, `${name}.restore`, actionKinds),
    restored: validateSteps(scenario.restored, `${name}.restored`, assertionKinds),
  };
}

export function validateDeniedRequests(cases) {
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error("Stateful acceptance requires cross-resource denied requests.");
  }
  return cases.map((entry, index) => {
    const name = `stateful.deniedRequests[${index}]`;
    const path = requireString(entry?.path, `${name}.path`);
    if (!path.startsWith("/api/") || path.startsWith("//")) {
      throw new Error(`${name}.path must be a relative API path.`);
    }
    const method = requireString(entry.method, `${name}.method`).toUpperCase();
    if (!["DELETE", "GET", "PATCH", "POST", "PUT"].includes(method)) {
      throw new Error(`${name}.method is unsupported.`);
    }
    if (![403, 404].includes(entry.expectedStatus)) {
      throw new Error(`${name}.expectedStatus must be 403 or 404.`);
    }
    return {
      ...entry,
      path,
      method,
      expectedCode: requireString(entry.expectedCode, `${name}.expectedCode`),
    };
  });
}

export function loadAcceptanceFixture(environment = process.env) {
  const baseUrlValue = environment.AUDITFLOW_E2E_BASE_URL;
  const descriptorValue = environment.AUDITFLOW_E2E_FIXTURE;
  if (!baseUrlValue || !descriptorValue) return undefined;

  const baseUrl = new URL(baseUrlValue);
  if (baseUrl.protocol !== "https:" || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("AUDITFLOW_E2E_BASE_URL must be a credential-free HTTPS origin.");
  }
  if (productionHosts.has(baseUrl.hostname) || environment.AUDITFLOW_E2E_STAGE !== "test") {
    throw new Error("Acceptance automation is restricted to the SST test stage.");
  }

  const descriptorPath = resolve(descriptorValue);
  if (!existsSync(descriptorPath)) throw new Error("Acceptance fixture descriptor does not exist.");
  const descriptor = JSON.parse(readFileSync(descriptorPath, "utf8"));
  if (descriptor.schemaVersion !== 1 || descriptor.stage !== "test" || descriptor.disposable !== true) {
    throw new Error("Acceptance fixture must be a schema-v1 disposable test-stage descriptor.");
  }
  const publicClient = descriptor.publicClient ?? {};
  const fixture = {
    baseUrl: baseUrl.origin,
    publicClient: {
      id: requireString(publicClient.id, "publicClient.id"),
      token: requireString(publicClient.token, "publicClient.token"),
      invalidToken: requireString(publicClient.invalidToken, "publicClient.invalidToken"),
    },
    expected: descriptor.expected ?? {},
    stateful: descriptor.stateful ?? {},
    allowWrites: environment.AUDITFLOW_E2E_ALLOW_WRITES === "confirmed-test-stage",
    restore: descriptor.restore,
  };
  if (fixture.allowWrites && (!fixture.restore || fixture.restore.confirmed !== true)) {
    throw new Error("Stateful acceptance requires an explicit restore contract.");
  }
  if (fixture.allowWrites) {
    fixture.stateful = Object.fromEntries(
      ["questionnaire", "pdfSigning", "cpaWorkflow"].map((name) => [
        name,
        validateStatefulScenario(fixture.stateful[name], `stateful.${name}`),
      ]),
    );
    fixture.stateful.deniedRequests = validateDeniedRequests(
      descriptor.stateful?.deniedRequests,
    );
  }
  return fixture;
}

export function questionnaireUrl(fixture, token = fixture.publicClient.token) {
  const url = new URL("/questionnaire", fixture.baseUrl);
  url.searchParams.set("client", fixture.publicClient.id);
  url.searchParams.set("token", token);
  return `${url.pathname}${url.search}`;
}

export function forbidExternalRuntimeRequests(page) {
  const forbidden = /(?:base44\.(?:app|com|io)|googleapis\.com|api\.telegram\.org)/iu;
  const observed = [];
  page.on("request", (request) => {
    if (forbidden.test(request.url())) observed.push(new URL(request.url()).hostname);
  });
  return () => observed;
}

async function executeActions(page, actions) {
  for (const action of actions) {
    const target = page.locator(action.selector);
    if (action.kind === "click") await target.click();
    if (action.kind === "fill") await target.fill(action.value);
    if (action.kind === "check") await target.check();
    if (action.kind === "uncheck") await target.uncheck();
    if (action.kind === "select") await target.selectOption(action.value);
  }
}

async function verifyAssertions(page, assertions) {
  for (const assertion of assertions) {
    const target = page.locator(assertion.selector);
    if (assertion.kind === "text") await expect(target).toContainText(assertion.value);
    if (assertion.kind === "value") await expect(target).toHaveValue(assertion.value);
    if (assertion.kind === "checked") await expect(target).toBeChecked({ checked: assertion.value });
    if (assertion.kind === "visible") await expect(target).toBeVisible();
    if (assertion.kind === "hidden") await expect(target).toBeHidden();
  }
}

export async function runStatefulScenario(page, scenario, defaultRoute) {
  const route = scenario.route ?? defaultRoute;
  if (!route) throw new Error("Stateful acceptance scenario requires a route.");
  await page.goto(route);
  try {
    await executeActions(page, scenario.mutate);
    await page.reload();
    await verifyAssertions(page, scenario.persisted);
  } finally {
    await executeActions(page, scenario.restore);
    await page.reload();
    await verifyAssertions(page, scenario.restored);
  }
}

export async function runDeniedRequestCases(page, cases) {
  for (const requestCase of cases) {
    const result = await page.evaluate(async ({ path, method, body }) => {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const responseBody = await response.json();
      return { status: response.status, code: responseBody.code };
    }, requestCase);
    expect(result).toEqual({
      status: requestCase.expectedStatus,
      code: requestCase.expectedCode,
    });
  }
}
