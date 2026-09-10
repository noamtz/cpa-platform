export const POSTHOG_EU_HOST = "https://eu.i.posthog.com";

/**
 * @typedef {object} AnalyticsSdk
 * @property {(apiKey: string, options: Record<string, unknown>) => AnalyticsSdk | undefined} init
 * @property {(eventName: string, properties: Record<string, unknown>) => unknown} capture
 */

export const ANALYTICS_FAILURE_CATEGORIES = Object.freeze([
  "authentication",
  "authorization",
  "validation",
  "not_found",
  "conflict",
  "persistence",
  "transport",
  "service",
  "unknown",
]);

const OUTCOMES = Object.freeze(["success", "failure"]);
const SURFACES = Object.freeze(["public", "cpa"]);
const WORKFLOW_MILESTONES = Object.freeze([
  "assisted_questionnaire",
  "ready_for_filing",
  "filed",
]);

export const OPERATIONAL_EVENT_SCHEMAS = Object.freeze({
  cpa_sign_in: Object.freeze({}),
  questionnaire_start: Object.freeze({}),
  questionnaire_resume: Object.freeze({}),
  questionnaire_complete: Object.freeze({}),
  file_upload: Object.freeze({ surface: SURFACES }),
  pdf_generate: Object.freeze({}),
  pdf_sign: Object.freeze({}),
  cpa_workflow_complete: Object.freeze({ milestone: WORKFLOW_MILESTONES }),
});

const RESERVED_PROPERTY_VALIDATORS = Object.freeze({
  distinct_id: (value) => typeof value === "string" && value.length > 0,
  $lib: (value) => typeof value === "string" && value.length > 0,
  $lib_version: (value) => typeof value === "string" && value.length > 0,
  $process_person_profile: (value) => value === false,
});

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateApplicationProperties(eventName, properties, { exact }) {
  const schema = OPERATIONAL_EVENT_SCHEMAS[eventName];
  if (!schema || !isPlainObject(properties)) return null;

  const allowedKeys = new Set([
    "outcome",
    "failure_category",
    ...Object.keys(schema),
  ]);
  if (exact && Object.keys(properties).some((key) => !allowedKeys.has(key))) {
    return null;
  }
  if (!OUTCOMES.includes(properties.outcome)) return null;

  const result = { outcome: properties.outcome };
  for (const [key, values] of Object.entries(schema)) {
    if (!values.includes(properties[key])) return null;
    result[key] = properties[key];
  }

  if (properties.outcome === "failure") {
    if (!ANALYTICS_FAILURE_CATEGORIES.includes(properties.failure_category)) {
      return null;
    }
    result.failure_category = properties.failure_category;
  } else if (properties.failure_category !== undefined) {
    return null;
  }

  return result;
}

export function classifyOperationalFailure(error) {
  try {
    const status = [error?.status, error?.statusCode, error?.response?.status].find(
      (value) => Number.isInteger(value),
    );
    if (status === 401) return "authentication";
    if (status === 403) return "authorization";
    if (status === 404) return "not_found";
    if (status === 409) return "conflict";
    if (status === 0) return "transport";
    if (status >= 400 && status < 500) return "validation";
    if (status >= 500) return "service";
    if (["AbortError", "NetworkError", "TimeoutError"].includes(error?.name)) {
      return "transport";
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

export function filterPostHogEvent(event, projectKey) {
  if (!isPlainObject(event) || typeof event.event !== "string") return null;
  if (
    typeof projectKey !== "string" ||
    projectKey.length === 0 ||
    event.properties?.token !== projectKey ||
    !RESERVED_PROPERTY_VALIDATORS.distinct_id(event.properties?.distinct_id) ||
    event.properties?.$process_person_profile !== false
  ) {
    return null;
  }
  const applicationProperties = validateApplicationProperties(
    event.event,
    event.properties,
    { exact: false },
  );
  if (!applicationProperties) return null;

  const properties = { ...applicationProperties, token: projectKey };
  for (const [key, validate] of Object.entries(RESERVED_PROPERTY_VALIDATORS)) {
    const value = event.properties[key];
    if (validate(value)) properties[key] = value;
  }
  const filteredEvent = { event: event.event, properties };
  if (typeof event.uuid === "string" && event.uuid.length > 0) {
    filteredEvent.uuid = event.uuid;
  }
  return filteredEvent;
}

export function createAnalytics({ apiKey, loadSdk = () => import("posthog-js") }) {
  const projectKey = typeof apiKey === "string" ? apiKey.trim() : "";
  let initialization;
  let client;

  function initialize() {
    if (!projectKey) return Promise.resolve(false);
    if (!initialization) {
      initialization = Promise.resolve()
        .then(() => loadSdk())
        .then(async (module) => {
          const sdk = /** @type {AnalyticsSdk | undefined} */ (
            /** @type {unknown} */ (module?.default ?? module)
          );
          if (!sdk || typeof sdk.init !== "function") return false;
          const initialized = await sdk.init(projectKey, {
            api_host: POSTHOG_EU_HOST,
            persistence: "sessionStorage",
            person_profiles: "never",
            autocapture: false,
            capture_pageview: false,
            capture_pageleave: false,
            capture_dead_clicks: false,
            capture_exceptions: false,
            capture_heatmaps: false,
            capture_performance: false,
            disable_session_recording: true,
            save_campaign_params: false,
            save_referrer: false,
            disableDeviceModel: true,
            advanced_disable_flags: true,
            disable_surveys: true,
            disable_web_experiments: true,
            disable_product_tours: true,
            disable_conversations: true,
            disable_external_dependency_loading: true,
            ip: false,
            before_send: (event) => filterPostHogEvent(event, projectKey),
            on_request_error: () => {},
          });
          client = initialized ?? sdk;
          return typeof client.capture === "function";
        })
        .catch(() => false);
    }
    return initialization;
  }

  function capture(eventName, properties) {
    const safeProperties = validateApplicationProperties(
      eventName,
      properties,
      { exact: true },
    );
    if (!projectKey || !safeProperties) return;
    void initialize()
      .then((ready) => {
        if (!ready) return;
        try {
          Promise.resolve(client.capture(eventName, safeProperties)).catch(() => {});
        } catch {
          // Analytics must never affect a product workflow.
        }
      })
      .catch(() => {});
  }

  return Object.freeze({ initialize, capture });
}

const runtimeAnalytics = createAnalytics({
  apiKey: import.meta.env.VITE_POSTHOG_KEY,
});

export function initializeAnalytics() {
  return runtimeAnalytics.initialize();
}

export function captureOperationalEvent(eventName, properties) {
  runtimeAnalytics.capture(eventName, properties);
}
