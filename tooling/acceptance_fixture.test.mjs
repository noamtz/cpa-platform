import { describe, expect, it } from "vitest";

import {
  validateDeniedRequests,
  validateStatefulScenario,
} from "../e2e/support/acceptance-fixture.js";

const validScenario = {
  route: "/clients/synthetic",
  mutate: [{ kind: "fill", selector: "[data-test=note]", value: "changed" }],
  persisted: [{ kind: "value", selector: "[data-test=note]", value: "changed" }],
  restore: [{ kind: "fill", selector: "[data-test=note]", value: "original" }],
  restored: [{ kind: "value", selector: "[data-test=note]", value: "original" }],
};

describe("stateful acceptance fixture contract", () => {
  it("accepts a mutation, reload assertion, restoration, and restoration assertion", () => {
    expect(validateStatefulScenario(validScenario, "stateful.cpaWorkflow")).toEqual(
      validScenario,
    );
  });

  it.each(["mutate", "persisted", "restore", "restored"])(
    "rejects a scenario without %s evidence",
    (field) => {
      expect(() =>
        validateStatefulScenario(
          { ...validScenario, [field]: [] },
          "stateful.cpaWorkflow",
        ),
      ).toThrow("must not be empty");
    },
  );

  it("rejects external routes and executable fixture actions", () => {
    expect(() =>
      validateStatefulScenario({ ...validScenario, route: "https://example.com" }),
    ).toThrow("must be relative");
    expect(() =>
      validateStatefulScenario({
        ...validScenario,
        mutate: [{ kind: "evaluate", selector: "body" }],
      }),
    ).toThrow("Unsupported");
  });

  it("accepts only same-origin denied API cases", () => {
    expect(
      validateDeniedRequests([{
        path: "/api/cpa/clients/another-owner",
        method: "get",
        expectedStatus: 404,
        expectedCode: "NOT_FOUND",
      }]),
    ).toEqual([{
      path: "/api/cpa/clients/another-owner",
      method: "GET",
      expectedStatus: 404,
      expectedCode: "NOT_FOUND",
    }]);
    expect(() =>
      validateDeniedRequests([{
        path: "https://example.com/api/client",
        method: "GET",
        expectedStatus: 403,
        expectedCode: "FORBIDDEN",
      }]),
    ).toThrow("relative API path");
    expect(() =>
      validateDeniedRequests([{
        path: "/api/cpa/clients/another-owner",
        method: "GET",
        expectedStatus: 200,
        expectedCode: "OK",
      }]),
    ).toThrow("must be 403 or 404");
  });
});
