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
    const client = createFileClient({
      http: { request: vi.fn() },
      invokePublic,
      xhrFactory: factory,
      clock: () => new Date("2026-01-01T00:00:00.000Z"),
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
});
