import { describe, expect, it, vi } from "vitest";

import { startQuestionnaireWithSubmission } from "../questionnaire-start";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("questionnaire start", () => {
  it("keeps the first upload step unavailable until a new Submission is acknowledged", async () => {
    const acknowledgement = deferred();
    const createSubmission = vi.fn(() => acknowledgement.promise);
    const showFirstStep = vi.fn();

    const start = startQuestionnaireWithSubmission({
      submission: null,
      createSubmission,
      showFirstStep,
    });

    await Promise.resolve();
    expect(createSubmission).toHaveBeenCalledOnce();
    expect(showFirstStep).not.toHaveBeenCalled();

    const submission = { id: "submission-1", _version: 1 };
    acknowledgement.resolve(submission);

    await expect(start).resolves.toBe(true);
    expect(showFirstStep).toHaveBeenCalledWith(submission);
  });

  it("reuses an existing Submission without creating another one", async () => {
    const submission = { id: "submission-1", _version: 3 };
    const createSubmission = vi.fn();
    const showFirstStep = vi.fn();

    await expect(
      startQuestionnaireWithSubmission({
        submission,
        createSubmission,
        showFirstStep,
      }),
    ).resolves.toBe(true);

    expect(createSubmission).not.toHaveBeenCalled();
    expect(showFirstStep).toHaveBeenCalledWith(submission);
  });
});
