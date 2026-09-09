import { describe, expect, it, vi } from "vitest";

import {
  ANALYTICS_FAILURE_CATEGORIES,
  OPERATIONAL_EVENT_SCHEMAS,
  POSTHOG_EU_HOST,
  classifyOperationalFailure,
  createAnalytics,
  filterPostHogEvent,
} from "../analytics";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeSdk() {
  const client = { capture: vi.fn() };
  const sdk = { init: vi.fn(() => client) };
  return { client, sdk, loadSdk: vi.fn().mockResolvedValue({ default: sdk }) };
}

describe("privacy-safe operational analytics", () => {
  it("does not load the SDK when configuration is absent", async () => {
    const loadSdk = vi.fn();
    const analytics = createAnalytics({ apiKey: "  ", loadSdk });

    analytics.capture("cpa_sign_in", { outcome: "success" });

    await expect(analytics.initialize()).resolves.toBe(false);
    expect(loadSdk).not.toHaveBeenCalled();
  });

  it("loads once, queues early events, and uses the exact privacy configuration", async () => {
    const { client, sdk, loadSdk } = fakeSdk();
    const analytics = createAnalytics({ apiKey: " test-key ", loadSdk });

    analytics.capture("cpa_sign_in", { outcome: "success" });
    analytics.capture("questionnaire_resume", { outcome: "success" });
    await flush();

    expect(loadSdk).toHaveBeenCalledOnce();
    expect(sdk.init).toHaveBeenCalledOnce();
    expect(sdk.init.mock.calls[0][0]).toBe("test-key");
    expect(sdk.init.mock.calls[0][1]).toEqual({
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
      before_send: expect.any(Function),
      on_request_error: expect.any(Function),
    });
    expect(client.capture.mock.calls).toEqual([
      ["cpa_sign_in", { outcome: "success" }],
      ["questionnaire_resume", { outcome: "success" }],
    ]);
    expect(analytics).not.toHaveProperty("identify");

    const finalEvent = sdk.init.mock.calls[0][1].before_send({
      uuid: "01991d7b-08ae-7e1b-a2de-b6a050bdda98",
      event: "cpa_sign_in",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      properties: {
        outcome: "success",
        token: "test-key",
        distinct_id: "anonymous-session-id",
        $lib: "web",
        $lib_version: "1.428.6",
        $process_person_profile: false,
        $time: 1767225600,
      },
    });
    expect(finalEvent).toEqual({
      uuid: "01991d7b-08ae-7e1b-a2de-b6a050bdda98",
      event: "cpa_sign_in",
      properties: {
        outcome: "success",
        token: "test-key",
        distinct_id: "anonymous-session-id",
        $lib: "web",
        $lib_version: "1.428.6",
        $process_person_profile: false,
      },
    });
  });

  it.each([
    ["cpa_sign_in", { outcome: "success" }],
    ["questionnaire_start", { outcome: "failure", failure_category: "persistence" }],
    ["questionnaire_resume", { outcome: "success" }],
    ["questionnaire_complete", { outcome: "success" }],
    ["file_upload", { outcome: "success", surface: "public" }],
    ["pdf_generate", { outcome: "failure", failure_category: "service" }],
    ["pdf_sign", { outcome: "success" }],
    ["cpa_workflow_complete", { outcome: "success", milestone: "filed" }],
  ])("accepts the documented %s schema", async (eventName, properties) => {
    const { client, loadSdk } = fakeSdk();
    createAnalytics({ apiKey: "key", loadSdk }).capture(eventName, properties);
    await flush();
    expect(client.capture).toHaveBeenCalledWith(eventName, properties);
  });

  it.each([
    ["file_upload", { outcome: "success", surface: "public" }],
    ["file_upload", { outcome: "success", surface: "cpa" }],
    ["cpa_workflow_complete", { outcome: "success", milestone: "assisted_questionnaire" }],
    ["cpa_workflow_complete", { outcome: "success", milestone: "ready_for_filing" }],
    ["cpa_workflow_complete", { outcome: "success", milestone: "filed" }],
  ])("accepts documented property enums for %s", async (eventName, properties) => {
    const { client, loadSdk } = fakeSdk();
    createAnalytics({ apiKey: "key", loadSdk }).capture(eventName, properties);
    await flush();
    expect(client.capture).toHaveBeenCalledWith(eventName, properties);
  });

  it.each(ANALYTICS_FAILURE_CATEGORIES)(
    "accepts the fixed failure category %s",
    async (failureCategory) => {
      const { client, loadSdk } = fakeSdk();
      createAnalytics({ apiKey: "key", loadSdk }).capture("pdf_sign", {
        outcome: "failure",
        failure_category: failureCategory,
      });
      await flush();
      expect(client.capture).toHaveBeenCalledOnce();
    },
  );

  it("drops unknown events, properties, enum values, and sensitive workflow data", async () => {
    const { client, loadSdk } = fakeSdk();
    const analytics = createAnalytics({ apiKey: "key", loadSdk });
    const forbidden = {
      name: "Sensitive Name",
      email: "person@example.test",
      client_id: "client-secret",
      submission_id: "submission-secret",
      token_url: "https://app.example.test/?token=secret",
      answer: "tax answer",
      filename: "private.pdf",
      file_uri: "private://secret",
      template: { content: "secret" },
      signature: "data:image/png;base64,secret",
      error: new Error("raw secret"),
    };

    analytics.capture("unknown_event", { outcome: "success" });
    analytics.capture("file_upload", { outcome: "success", surface: "admin" });
    analytics.capture("pdf_sign", { outcome: "failure", failure_category: "raw" });
    analytics.capture("pdf_sign", { outcome: "success", ...forbidden });
    analytics.capture("pdf_sign", {
      outcome: "success",
      token: "caller-project-key",
      distinct_id: "caller-identity",
    });
    await flush();

    expect(client.capture).not.toHaveBeenCalled();
    expect(JSON.stringify(client.capture.mock.calls)).not.toContain("secret");
  });

  it("keeps only the required anonymous SDK envelope after enrichment", () => {
    const finalEvent = filterPostHogEvent({
      uuid: "01991d7b-08ae-7e1b-a2de-b6a050bdda98",
      event: "file_upload",
      timestamp: new Date("2026-01-01T00:00:00.000Z"),
      $set: { email: "person@example.test" },
      unexpected_top_level: { token: "top-level-secret" },
      properties: {
        outcome: "failure",
        surface: "cpa",
        failure_category: "transport",
        token: "test-project-key",
        distinct_id: "anonymous-random-id",
        $lib: "web",
        $lib_version: "1.428.6",
        $process_person_profile: false,
        $time: 1767225600,
        $current_url: "https://app.example.test/?token=secret",
        $pathname: "/secret",
        $referrer: "https://private.example.test",
        $useragent: "private browser data",
        $device_type: "Desktop",
        $session_id: "session-secret",
        unexpected: { answer: "private" },
      },
    }, "test-project-key");

    expect(finalEvent.properties).toEqual({
      outcome: "failure",
      surface: "cpa",
      failure_category: "transport",
      token: "test-project-key",
      distinct_id: "anonymous-random-id",
      $lib: "web",
      $lib_version: "1.428.6",
      $process_person_profile: false,
    });
    expect(finalEvent).toEqual({
      uuid: "01991d7b-08ae-7e1b-a2de-b6a050bdda98",
      event: "file_upload",
      properties: finalEvent.properties,
    });
    expect(JSON.stringify(finalEvent)).not.toContain("secret");
    expect(JSON.stringify(finalEvent)).not.toContain("person@example.test");
    expect(finalEvent).not.toHaveProperty("timestamp");
    expect(finalEvent.properties).not.toHaveProperty("$time");
  });

  it("rejects envelopes with missing or mismatched SDK ingestion fields", () => {
    const properties = {
      outcome: "success",
      distinct_id: "anonymous-session-id",
      $process_person_profile: false,
    };
    expect(filterPostHogEvent({ event: "pdf_sign", properties }, "key")).toBeNull();
    expect(filterPostHogEvent({
      event: "pdf_sign",
      properties: { ...properties, token: "wrong-key" },
    }, "key")).toBeNull();
    expect(filterPostHogEvent({
      event: "pdf_sign",
      properties: { ...properties, token: "key", distinct_id: "" },
    }, "key")).toBeNull();
  });

  it("rejects invalid final events and keeps schemas frozen", () => {
    expect(filterPostHogEvent({ event: "unknown", properties: {} })).toBeNull();
    expect(filterPostHogEvent({
      event: "pdf_sign",
      properties: { outcome: "success", failure_category: "unknown" },
    })).toBeNull();
    expect(Object.isFrozen(OPERATIONAL_EVENT_SCHEMAS)).toBe(true);
    expect(Object.values(OPERATIONAL_EVENT_SCHEMAS).every(Object.isFrozen)).toBe(true);
  });

  it("classifies only structured status and error names", () => {
    expect(classifyOperationalFailure({ status: 401 })).toBe("authentication");
    expect(classifyOperationalFailure({ response: { status: 403 } })).toBe("authorization");
    expect(classifyOperationalFailure({ statusCode: 404 })).toBe("not_found");
    expect(classifyOperationalFailure({ status: 409 })).toBe("conflict");
    expect(classifyOperationalFailure({ status: 422 })).toBe("validation");
    expect(classifyOperationalFailure({ status: 503 })).toBe("service");
    expect(classifyOperationalFailure({ name: "AbortError" })).toBe("transport");
    expect(classifyOperationalFailure(new Error("contains private data"))).toBe("unknown");
  });

  it.each(["loader", "init", "init_async", "capture", "capture_async"])(
    "swallows %s failures without changing product state",
    async (failurePoint) => {
      const productState = { saved: true, route: "/unchanged" };
      const client = {
        capture: failurePoint === "capture"
          ? vi.fn(() => { throw new Error("capture"); })
          : failurePoint === "capture_async"
            ? vi.fn(() => Promise.reject(new Error("capture")))
            : vi.fn(),
      };
      const sdk = {
        init: failurePoint === "init"
          ? vi.fn(() => { throw new Error("init"); })
          : failurePoint === "init_async"
            ? vi.fn(() => Promise.reject(new Error("init")))
            : vi.fn(() => client),
      };
      const loadSdk = failurePoint === "loader"
        ? vi.fn().mockRejectedValue(new Error("loader"))
        : vi.fn().mockResolvedValue({ default: sdk });
      const analytics = createAnalytics({ apiKey: "key", loadSdk });

      expect(() => analytics.capture("pdf_sign", { outcome: "success" })).not.toThrow();
      await flush();
      expect(productState).toEqual({ saved: true, route: "/unchanged" });
    },
  );

  it("keeps request-error callbacks non-throwing", async () => {
    const { sdk, loadSdk } = fakeSdk();
    await createAnalytics({ apiKey: "key", loadSdk }).initialize();
    expect(() => sdk.init.mock.calls[0][1].on_request_error(new Error("private"))).not.toThrow();
  });

  it("treats blocked session storage during SDK init as a no-op", async () => {
    const storageFailure = new DOMException("blocked private storage", "SecurityError");
    const sdk = { init: vi.fn(() => { throw storageFailure; }) };
    const analytics = createAnalytics({
      apiKey: "key",
      loadSdk: vi.fn().mockResolvedValue({ default: sdk }),
    });

    await expect(analytics.initialize()).resolves.toBe(false);
    expect(() => analytics.capture("cpa_sign_in", { outcome: "success" })).not.toThrow();
  });
});
