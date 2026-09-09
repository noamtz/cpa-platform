import { describe, expect, it, vi } from "vitest";

import { createFileClient } from "../file-client";

function xhrHarness(status = 200) {
  const xhr = {
    status,
    upload: {},
    open: vi.fn(),
    setRequestHeader: vi.fn(),
    send: vi.fn(function send(body) {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.onload();
      return body;
    }),
  };
  return { xhr, factory: vi.fn(() => xhr) };
}

describe("private file client", () => {
  it("uses metadata JSON, a signed PUT, completion, and real progress", async () => {
    const invokePublic = vi
      .fn()
      .mockResolvedValueOnce({
        upload_id: "private://files/synthetic.pdf",
        upload_url: "https://signed.example.test/put",
        headers: {
          "content-type": "application/pdf",
          "x-amz-meta-purpose": "questionnaire_document",
        },
        expires_at: "2026-01-01T00:15:00.000Z",
      })
      .mockResolvedValueOnce({ file_uri: "private://files/synthetic.pdf" });
    const { xhr, factory } = xhrHarness();
    const progress = vi.fn();
    const captureEvent = vi.fn();
    const client = createFileClient({
      http: { request: vi.fn() },
      invokePublic,
      xhrFactory: factory,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
      captureEvent,
    });
    const file = new File(["pdf"], "tax.pdf", { type: "application/pdf" });

    await expect(
      client.uploadPublicFile({
        file,
        clientId: "client-test",
        token: "opaque-test-token",
        submissionId: "submission-test",
        purpose: "questionnaire_document",
        stepId: "step-test",
        onProgress: progress,
      }),
    ).resolves.toBe("private://files/synthetic.pdf");

    expect(invokePublic.mock.calls[0]).toEqual([
      "uploadFile",
      expect.objectContaining({
        operation: "initiate",
        size: 3,
        content_type: "application/pdf",
      }),
    ]);
    expect(invokePublic.mock.calls[0][1]).not.toHaveProperty("file");
    expect(invokePublic.mock.calls[1][1]).not.toHaveProperty("file");
    expect(xhr.open).toHaveBeenCalledWith("PUT", "https://signed.example.test/put");
    expect(xhr.send).toHaveBeenCalledWith(file);
    expect(progress.mock.calls).toEqual([[45], [100]]);
    expect(invokePublic.mock.calls[1]).toEqual([
      "uploadFile",
      expect.objectContaining({
        operation: "complete",
        upload_id: "private://files/synthetic.pdf",
      }),
    ]);
    expect(captureEvent).toHaveBeenCalledWith("file_upload", {
      outcome: "success",
      surface: "public",
    });
    expect(captureEvent.mock.invocationCallOrder[0]).toBeGreaterThan(
      invokePublic.mock.invocationCallOrder[1],
    );
    const capturedJson = JSON.stringify(captureEvent.mock.calls);
    for (const sensitiveValue of [
      "tax.pdf",
      "client-test",
      "opaque-test-token",
      "submission-test",
      "questionnaire_document",
      "step-test",
      "private://files/synthetic.pdf",
      "https://signed.example.test/put",
      "application/pdf",
    ]) {
      expect(capturedJson).not.toContain(sensitiveValue);
    }
  });

  it("rejects an expired initiation without sending bytes", async () => {
    const invokePublic = vi.fn().mockResolvedValue({
      upload_id: "private://files/synthetic.pdf",
      upload_url: "https://signed.example.test/put",
      headers: {},
      expires_at: "2025-12-31T23:59:59.000Z",
    });
    const { xhr, factory } = xhrHarness();
    const client = createFileClient({
      http: { request: vi.fn() },
      invokePublic,
      xhrFactory: factory,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(
      client.uploadPublicFile({
        file: new File(["pdf"], "tax.pdf", { type: "application/pdf" }),
        clientId: "client-test",
        token: "opaque-test-token",
        submissionId: "submission-test",
        purpose: "questionnaire_document",
        stepId: "step-test",
      }),
    ).rejects.toThrow("Upload URL expired");
    expect(xhr.send).not.toHaveBeenCalled();
  });

  it("reports CPA upload completion without exposing file metadata", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        upload_id: "private://files/cpa-synthetic.pdf",
        upload_url: "https://signed.example.test/put",
        headers: {},
        expires_at: "2026-01-01T00:15:00.000Z",
      })
      .mockResolvedValueOnce({ file_uri: "private://files/cpa-synthetic.pdf" });
    const captureEvent = vi.fn();
    const { factory } = xhrHarness();
    const client = createFileClient({
      http: { request },
      xhrFactory: factory,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
      captureEvent,
    });

    await client.uploadCpaFile({
      file: new File(["private tax content"], "private-tax.pdf", { type: "application/pdf" }),
      ownerType: "submission",
      ownerId: "private-client-id",
      purpose: "questionnaire_document",
    });

    expect(captureEvent).toHaveBeenCalledWith("file_upload", {
      outcome: "success",
      surface: "cpa",
    });
    expect(JSON.stringify(captureEvent.mock.calls)).not.toContain("private");
  });

  it("reports one safe failure and rethrows the identical upload error", async () => {
    const failure = Object.assign(new Error("private server detail"), { status: 503 });
    const captureEvent = vi.fn();
    const client = createFileClient({
      http: { request: vi.fn() },
      invokePublic: vi.fn().mockRejectedValue(failure),
      captureEvent,
    });

    const upload = client.uploadPublicFile({
      file: new File(["pdf"], "private-tax.pdf", { type: "application/pdf" }),
      clientId: "private-client-id",
      token: "private-token",
      submissionId: "private-submission-id",
      purpose: "questionnaire_document",
    });

    await expect(upload).rejects.toBe(failure);
    expect(captureEvent).toHaveBeenCalledOnce();
    expect(captureEvent).toHaveBeenCalledWith("file_upload", {
      outcome: "failure",
      surface: "public",
      failure_category: "service",
    });
    expect(captureEvent.mock.calls.flat()).not.toContain(failure);
  });

  it("reports a signed PUT rejection once and does not call completion", async () => {
    const invokePublic = vi.fn().mockResolvedValue({
      upload_id: "private://files/put-failure.pdf",
      upload_url: "https://signed.example.test/put-failure",
      headers: {},
      expires_at: "2026-01-01T00:15:00.000Z",
    });
    const captureEvent = vi.fn();
    const { factory } = xhrHarness(503);
    const progress = vi.fn();
    const client = createFileClient({
      http: { request: vi.fn() },
      invokePublic,
      xhrFactory: factory,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
      captureEvent,
    });

    await expect(client.uploadPublicFile({
      file: new File(["private content"], "private-put.pdf", { type: "application/pdf" }),
      clientId: "private-client-id",
      token: "private-token",
      submissionId: "private-submission-id",
      purpose: "questionnaire_document",
      onProgress: progress,
    })).rejects.toThrow("Upload failed: 503");

    expect(invokePublic).toHaveBeenCalledOnce();
    expect(progress.mock.calls).toEqual([[45]]);
    expect(captureEvent).toHaveBeenCalledOnce();
    expect(captureEvent).toHaveBeenCalledWith("file_upload", {
      outcome: "failure",
      surface: "public",
      failure_category: "unknown",
    });
    expect(JSON.stringify(captureEvent.mock.calls)).not.toContain("private");
  });

  it("reports a completion rejection once and preserves its error identity", async () => {
    const failure = Object.assign(new Error("private completion detail"), { status: 409 });
    const invokePublic = vi
      .fn()
      .mockResolvedValueOnce({
        upload_id: "private://files/complete-failure.pdf",
        upload_url: "https://signed.example.test/complete-failure",
        headers: {},
        expires_at: "2026-01-01T00:15:00.000Z",
      })
      .mockRejectedValueOnce(failure);
    const captureEvent = vi.fn();
    const { factory } = xhrHarness();
    const progress = vi.fn();
    const client = createFileClient({
      http: { request: vi.fn() },
      invokePublic,
      xhrFactory: factory,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
      captureEvent,
    });

    const upload = client.uploadPublicFile({
      file: new File(["private content"], "private-complete.pdf", { type: "application/pdf" }),
      clientId: "private-client-id",
      token: "private-token",
      submissionId: "private-submission-id",
      purpose: "questionnaire_document",
      onProgress: progress,
    });

    await expect(upload).rejects.toBe(failure);
    expect(progress.mock.calls).toEqual([[45]]);
    expect(captureEvent).toHaveBeenCalledOnce();
    expect(captureEvent).toHaveBeenCalledWith("file_upload", {
      outcome: "failure",
      surface: "public",
      failure_category: "conflict",
    });
    expect(captureEvent.mock.calls.flat()).not.toContain(failure);
  });

  it.each(["throw", "reject"])(
    "ignores capture %s without changing upload success or failure behavior",
    async (captureFailureMode) => {
      const analyticsFailure = new Error("analytics unavailable");
      const captureEvent = captureFailureMode === "throw"
        ? vi.fn(() => { throw analyticsFailure; })
        : vi.fn(() => Promise.reject(analyticsFailure));
      const invokePublic = vi
        .fn()
        .mockResolvedValueOnce({
          upload_id: "private://files/success.pdf",
          upload_url: "https://signed.example.test/success",
          headers: {},
          expires_at: "2026-01-01T00:15:00.000Z",
        })
        .mockResolvedValueOnce({ file_uri: "private://files/success.pdf" });
      const { factory } = xhrHarness();
      const progress = vi.fn();
      const successClient = createFileClient({
        http: { request: vi.fn() },
        invokePublic,
        xhrFactory: factory,
        clock: () => new Date("2026-01-01T00:00:00.000Z"),
        captureEvent,
      });

      await expect(successClient.uploadPublicFile({
        file: new File(["pdf"], "success.pdf", { type: "application/pdf" }),
        clientId: "client-test",
        token: "token-test",
        submissionId: "submission-test",
        purpose: "questionnaire_document",
        onProgress: progress,
      })).resolves.toBe("private://files/success.pdf");
      expect(progress.mock.calls).toEqual([[45], [100]]);

      const productFailure = Object.assign(new Error("service unavailable"), { status: 503 });
      const failureClient = createFileClient({
        http: { request: vi.fn() },
        invokePublic: vi.fn().mockRejectedValue(productFailure),
        captureEvent,
      });
      await expect(failureClient.uploadPublicFile({
        file: new File(["pdf"], "failure.pdf", { type: "application/pdf" }),
        clientId: "client-test",
        token: "token-test",
        submissionId: "submission-test",
        purpose: "questionnaire_document",
      })).rejects.toBe(productFailure);
      expect(captureEvent).toHaveBeenCalledTimes(2);
    },
  );

  it("polls a server-side ZIP job and downloads only the ready result", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ job_id: "job-test", status: "pending" })
      .mockResolvedValueOnce({ job_id: "job-test", status: "pending" })
      .mockResolvedValueOnce({
        job_id: "job-test",
        status: "ready",
        signed_url: "https://signed.example.test/result",
        download_name: "Synthetic Client.zip",
      });
    const anchor = { click: vi.fn() };
    const delay = vi.fn().mockResolvedValue(undefined);
    const client = createFileClient({
      http: { request },
      delay,
      documentRef: { createElement: vi.fn(() => anchor) },
    });

    await client.downloadSubmissionZip("submission/test", { pollInterval: 25 });
    expect(request.mock.calls[0][0]).toBe(
      "/cpa/submissions/submission%2Ftest/zip-downloads",
    );
    expect(delay).toHaveBeenCalledWith(25);
    expect(anchor).toMatchObject({
      href: "https://signed.example.test/result",
      download: "Synthetic Client.zip",
      rel: "noopener",
    });
    expect(anchor.click).toHaveBeenCalledOnce();
  });

  it("persists the authenticated template file mirror before scoped reads", async () => {
    const request = vi.fn().mockResolvedValue({
      template_id: "template-test",
      mirrored: true,
    });
    const client = createFileClient({ http: { request } });
    const payload = {
      template_id: "template-test",
      file_reference: "private://synthetic/template.pdf",
      name: "Synthetic template",
      is_active: true,
      source_version: 1,
    };

    await expect(client.mirrorCpaTemplateFile(payload)).resolves.toMatchObject({
      mirrored: true,
    });
    expect(request).toHaveBeenCalledWith("/cpa/files/template-mirror", {
      method: "POST",
      body: payload,
    });
  });
});
