import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const productionHosts = new Set(["app.ddcpa.co.il"]);

function requireString(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`Missing acceptance fixture field: ${name}`);
  return value;
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
