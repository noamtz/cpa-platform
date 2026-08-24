import { describe, expect, it, vi } from "vitest";

import { createRecoverableSaveQueue } from "../questionnaire-save-queue";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("questionnaire save queue", () => {
  it("dispatches the next save after a transport rejection and waits for its acknowledgement", async () => {
    const queue = createRecoverableSaveQueue();
    const calls = [];
    const secondResponse = deferred();
    const advance = vi.fn();

    const firstSave = queue.enqueue(async () => {
      calls.push("first");
      throw new Error("network unavailable");
    });
    const secondSave = queue.enqueue(async () => {
      calls.push("second");
      return secondResponse.promise;
    });
    const navigation = secondSave.then((submission) => advance(submission));

    await expect(firstSave).rejects.toThrow("network unavailable");
    await Promise.resolve();
    expect(calls).toEqual(["first", "second"]);
    expect(advance).not.toHaveBeenCalled();

    const acknowledgedSubmission = { id: "submission-1", _version: 2 };
    secondResponse.resolve(acknowledgedSubmission);

    await expect(secondSave).resolves.toEqual(acknowledgedSubmission);
    await navigation;
    expect(advance).toHaveBeenCalledOnce();
    expect(advance).toHaveBeenCalledWith(acknowledgedSubmission);
  });
});
