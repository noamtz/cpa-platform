import { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { S3Event } from "aws-lambda";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";

import { deriveSubmissionFileEntries } from "../services/files";
import { createZipDownloadHandler } from "../workers/zip-download";

const jobId = "123e4567-e89b-12d3-a456-426614174000";
const firstOwnerId = "223e4567-e89b-12d3-a456-426614174000";
const secondOwnerId = "323e4567-e89b-12d3-a456-426614174000";
const now = "2026-01-01T00:00:00.000Z";
const manifest = {
  version: 1,
  job_id: jobId,
  actor_id: "user-test",
  submission_id: "submission-test",
  client_id: "client-test",
  archive_name: "Synthetic Client.zip",
  created_at: now,
  expires_at: "2026-01-01T01:00:00.000Z",
  entries: [
    { key: "legacy/" + "a".repeat(64), name: "מסמך_1.pdf" },
    { key: "legacy/" + "b".repeat(64), name: "מסמך_1_2.pdf" },
  ],
};
const [{ key: firstSourceKey }, { key: secondSourceKey }] = manifest.entries;

function event(): S3Event {
  return {
    Records: [
      {
        s3: {
          bucket: { name: "TemporaryOutputsBucket.test" },
          object: { key: `zip-jobs/requests/${jobId}.json` },
        },
      },
    ],
  } as S3Event;
}

function textObject(value: unknown, etag?: string) {
  return {
    ...(etag ? { ETag: etag } : {}),
    Body: {
      transformToString: async () => JSON.stringify(value),
    },
  };
}

function conditionalConflict() {
  return Object.assign(new Error("conditional conflict"), {
    name: "PreconditionFailed",
    $metadata: { httpStatusCode: 412 },
  });
}

function createLeaseStore(
  initial?: { record: unknown; etag: string },
  beforePut?: (input: {
    readonly record: Record<string, unknown>;
    readonly ifMatch?: string;
    readonly ifNoneMatch?: string;
  }) => Promise<void> | void,
) {
  let record = initial?.record;
  let etag = initial?.etag;
  let revision = 0;
  return {
    async send(command: unknown) {
      let key: string | undefined;
      if (
        command instanceof GetObjectCommand ||
        command instanceof PutObjectCommand
      ) {
        ({ Key: key } = command.input);
      }
      if (key !== `zip-jobs/locks/${jobId}.json`) {
        return { handled: false as const };
      }
      if (command instanceof GetObjectCommand) {
        if (!record || !etag) {
          throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        }
        return { handled: true as const, value: textObject(record, etag) };
      }
      if (command instanceof PutObjectCommand) {
        const {
          IfNoneMatch: ifNoneMatch,
          IfMatch: ifMatch,
          Body: body,
        } = command.input;
        const candidate = JSON.parse(String(body)) as Record<string, unknown>;
        await beforePut?.({ record: candidate, ifMatch, ifNoneMatch });
        if (ifNoneMatch === "*" && record) throw conditionalConflict();
        if (ifMatch && ifMatch !== etag) throw conditionalConflict();
        record = candidate;
        revision += 1;
        etag = `"lease-${revision}"`;
        return { handled: true as const, value: { ETag: etag } };
      }
      return { handled: false as const };
    },
    current() {
      return { record, etag };
    },
  };
}

function leaseOptions(ownerId = firstOwnerId) {
  return {
    ownerId: () => ownerId,
    scheduleLeaseRenewal: vi.fn(() => Symbol("lease-renewal")),
    cancelLeaseRenewal: vi.fn(),
  };
}

describe("ZIP inventory", () => {
  it("derives current, removed-step, legacy, and signed files with stable collision names", () => {
    const submission = {
      id: "submission-test",
      client_id: "client-test",
      record_type: "Submission" as const,
      _version: 1,
      created_date: now,
      updated_date: now,
      responses: JSON.stringify({
        current: {
          answer: true,
          files: ["private://synthetic/current.pdf"],
          file_names: ["source.pdf"],
        },
        removed: {
          answer: true,
          title: "מסמך",
          files: ["private://synthetic/removed.pdf"],
          file_names: ["source.pdf"],
        },
      }),
      donation_files: ["private://synthetic/legacy.png"],
      signed_pdfs: JSON.stringify([
        {
          step_id: "signed",
          step_title: "חתום",
          pdf_file_url: "private://synthetic/signed.pdf",
        },
      ]),
    };
    const entries = deriveSubmissionFileEntries(submission, [
      { id: "current", title: "מסמך" },
    ]);
    expect(entries).toHaveLength(4);
    expect(entries.map(({ name }) => name)).toEqual([
      "מסמך_1.pdf",
      "מסמך_1_2.pdf",
      "donations_1.png",
      "חתום_1.pdf",
    ]);
    expect(entries.every(({ key }) => /^legacy\/[a-f0-9]{64}$/.test(key))).toBe(true);
  });
});

describe("ZIP worker", () => {
  it("does not repeat a terminal job", async () => {
    const send = vi.fn().mockResolvedValue(
      textObject({
        version: 1,
        job_id: jobId,
        owner_id: firstOwnerId,
        expires_at: "2026-01-01T00:01:00.000Z",
        terminal_status: {
          version: 1,
          job_id: jobId,
          state: "ready",
          result_key: `zip-jobs/results/${jobId}/${firstOwnerId}.zip`,
          completed_at: now,
        },
      }),
    );
    const createUpload = vi.fn();
    const handler = createZipDownloadHandler({
      s3: { send },
      filesBucketName: "FilesBucket.test",
      temporaryOutputsBucketName: "TemporaryOutputsBucket.test",
      createUpload,
      clock: () => new Date(now),
    });
    await handler(event());
    expect(send).toHaveBeenCalledOnce();
    expect(createUpload).not.toHaveBeenCalled();
  });

  it("streams every source into a complete multipart-uploaded archive", async () => {
    const leases = createLeaseStore();
    const send = vi.fn(async (command: unknown) => {
      const leaseResult = await leases.send(command);
      if (leaseResult.handled) return leaseResult.value;
      if (command instanceof GetObjectCommand) {
        const { Key: objectKey } = command.input;
        if (objectKey === `zip-jobs/requests/${jobId}.json`) return textObject(manifest);
        if (objectKey === firstSourceKey) return { Body: Readable.from("first") };
        if (objectKey === secondSourceKey) return { Body: Readable.from("second") };
      }
      return {};
    });
    let archive: Buffer | undefined;
    const createUpload = vi.fn((_objectKey: string, body: NodeJS.ReadableStream) => ({
      async done() {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          body.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          body.on("end", resolve);
          body.on("error", reject);
        });
        archive = Buffer.concat(chunks);
      },
      async abort() {},
    }));
    const handler = createZipDownloadHandler({
      s3: { send },
      filesBucketName: "FilesBucket.test",
      temporaryOutputsBucketName: "TemporaryOutputsBucket.test",
      createUpload,
      clock: () => new Date(now),
      ...leaseOptions(),
    });
    await handler(event());
    expect(createUpload).toHaveBeenCalledOnce();
    const zip = await JSZip.loadAsync(archive as Buffer);
    await expect(zip.file("מסמך_1.pdf")?.async("string")).resolves.toBe("first");
    await expect(zip.file("מסמך_1_2.pdf")?.async("string")).resolves.toBe("second");
    expect(leases.current().record).toMatchObject({
      terminal_status: { state: "ready", job_id: jobId },
    });
  });

  it("fails the whole job and cleans partial output when any source is missing", async () => {
    const leases = createLeaseStore();
    const send = vi.fn(async (command: unknown) => {
      const leaseResult = await leases.send(command);
      if (leaseResult.handled) return leaseResult.value;
      if (command instanceof GetObjectCommand) {
        const { Key: objectKey } = command.input;
        if (objectKey === `zip-jobs/requests/${jobId}.json`) return textObject(manifest);
        if (objectKey === firstSourceKey) return { Body: Readable.from("first") };
        throw Object.assign(
          new Error(
            "private://synthetic/secret.pdf customer-file.pdf opaque-token-value",
          ),
          { name: "NoSuchKey" },
        );
      }
      return {};
    });
    const createUpload = vi.fn();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createZipDownloadHandler({
      s3: { send },
      filesBucketName: "FilesBucket.test",
      temporaryOutputsBucketName: "TemporaryOutputsBucket.test",
      createUpload,
      clock: () => new Date(now),
      ...leaseOptions(),
    });
    await handler(event());
    expect(createUpload).not.toHaveBeenCalled();
    expect(
      send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand),
    ).toBe(true);
    expect(leases.current().record).toMatchObject({
      terminal_status: {
        state: "failed",
        failure_code: "source_unavailable",
      },
    });
    expect(error).toHaveBeenCalledWith(
      "AuditFlow ZIP job failed",
      {
        jobId,
        failureClass: "source_unavailable",
        message: "ZIP job reached a terminal failure",
      },
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain("private://synthetic/secret.pdf");
    expect(logged).not.toContain("customer-file.pdf");
    expect(logged).not.toContain("opaque-token-value");
    error.mockRestore();
  });

  it("allows only one overlapping delivery to own result and terminal writes", async () => {
    let releaseUpload: (() => void) | undefined;
    const uploadStarted = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    let finishUpload: (() => void) | undefined;
    const uploadMayFinish = new Promise<void>((resolve) => {
      finishUpload = resolve;
    });
    const deletes: string[] = [];
    const leases = createLeaseStore();
    const nextOwner = vi
      .fn()
      .mockReturnValueOnce(firstOwnerId)
      .mockReturnValueOnce(secondOwnerId);
    const send = vi.fn(async (command: unknown) => {
      const leaseResult = await leases.send(command);
      if (leaseResult.handled) return leaseResult.value;
      if (command instanceof GetObjectCommand) {
        const { Key: objectKey } = command.input;
        if (objectKey === `zip-jobs/requests/${jobId}.json`) {
          return textObject(manifest);
        }
        if (objectKey === firstSourceKey) return { Body: Readable.from("first") };
        if (objectKey === secondSourceKey) return { Body: Readable.from("second") };
      }
      if (command instanceof DeleteObjectCommand) {
        const { Key: objectKey } = command.input;
        deletes.push(String(objectKey));
      }
      return {};
    });
    const createUpload = vi.fn(() => ({
      async done() {
        releaseUpload?.();
        await uploadMayFinish;
      },
      async abort() {},
    }));
    const handler = createZipDownloadHandler({
      s3: { send },
      filesBucketName: "FilesBucket.test",
      temporaryOutputsBucketName: "TemporaryOutputsBucket.test",
      createUpload,
      clock: () => new Date(now),
      ownerId: nextOwner,
      scheduleLeaseRenewal: vi.fn(() => Symbol("lease-renewal")),
      cancelLeaseRenewal: vi.fn(),
    });

    const owner = handler(event());
    await uploadStarted;
    await handler(event());
    finishUpload?.();
    await owner;

    expect(createUpload).toHaveBeenCalledOnce();
    expect(leases.current().record).toMatchObject({
      terminal_status: { state: "ready", job_id: jobId },
    });
    expect(deletes).toEqual([]);
    expect(nextOwner).toHaveBeenCalledTimes(2);
  });

  it("takes over an expired lease left by a crashed worker", async () => {
    const leases = createLeaseStore({
      record: {
        version: 1,
        job_id: jobId,
        owner_id: firstOwnerId,
        expires_at: "2026-01-01T00:01:00.000Z",
      },
      etag: '"crashed-owner"',
    });
    const send = vi.fn(async (command: unknown) => {
      const leaseResult = await leases.send(command);
      if (leaseResult.handled) return leaseResult.value;
      if (command instanceof GetObjectCommand) {
        const { Key: objectKey } = command.input;
        if (objectKey === `zip-jobs/requests/${jobId}.json`) {
          return textObject(manifest);
        }
        if (objectKey === firstSourceKey) return { Body: Readable.from("first") };
        if (objectKey === secondSourceKey) return { Body: Readable.from("second") };
      }
      return {};
    });
    const createUpload = vi.fn(() => ({
      async done() {},
      async abort() {},
    }));
    const handler = createZipDownloadHandler({
      s3: { send },
      filesBucketName: "FilesBucket.test",
      temporaryOutputsBucketName: "TemporaryOutputsBucket.test",
      createUpload,
      clock: () => new Date("2026-01-01T00:02:00.000Z"),
      ...leaseOptions(secondOwnerId),
    });

    await handler(event());

    expect(createUpload).toHaveBeenCalledWith(
      `zip-jobs/results/${jobId}/${secondOwnerId}.zip`,
      expect.anything(),
    );
    expect(leases.current().record).toMatchObject({
      owner_id: secondOwnerId,
      terminal_status: {
        state: "ready",
        result_key: `zip-jobs/results/${jobId}/${secondOwnerId}.zip`,
      },
    });
  });

  it("fences a stale owner whose terminal write resumes after takeover", async () => {
    let markDelayedWrite: (() => void) | undefined;
    const delayedWriteStarted = new Promise<void>((resolve) => {
      markDelayedWrite = resolve;
    });
    let releaseDelayedWrite: (() => void) | undefined;
    const delayedWriteMayFinish = new Promise<void>((resolve) => {
      releaseDelayedWrite = resolve;
    });
    let delayedFirstOwner = false;
    const leases = createLeaseStore(undefined, async ({ record }) => {
      if (
        !delayedFirstOwner &&
        record.owner_id === firstOwnerId &&
        record.terminal_status
      ) {
        delayedFirstOwner = true;
        markDelayedWrite?.();
        await delayedWriteMayFinish;
      }
    });
    const deletedResults: string[] = [];
    let currentTime = new Date(now);
    const send = vi.fn(async (command: unknown) => {
      const leaseResult = await leases.send(command);
      if (leaseResult.handled) return leaseResult.value;
      if (command instanceof GetObjectCommand) {
        const { Key: objectKey } = command.input;
        if (objectKey === `zip-jobs/requests/${jobId}.json`) {
          return textObject(manifest);
        }
        if (objectKey === firstSourceKey) return { Body: Readable.from("first") };
        if (objectKey === secondSourceKey) return { Body: Readable.from("second") };
      }
      if (command instanceof DeleteObjectCommand) {
        const { Key: objectKey } = command.input;
        deletedResults.push(String(objectKey));
      }
      return {};
    });
    const createUpload = vi.fn(() => ({
      async done() {},
      async abort() {},
    }));
    const nextOwner = vi
      .fn()
      .mockReturnValueOnce(firstOwnerId)
      .mockReturnValueOnce(secondOwnerId);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createZipDownloadHandler({
      s3: { send },
      filesBucketName: "FilesBucket.test",
      temporaryOutputsBucketName: "TemporaryOutputsBucket.test",
      createUpload,
      clock: () => currentTime,
      ownerId: nextOwner,
      scheduleLeaseRenewal: vi.fn(() => Symbol("lease-renewal")),
      cancelLeaseRenewal: vi.fn(),
    });

    const staleOwner = handler(event());
    await delayedWriteStarted;
    currentTime = new Date("2026-01-01T00:02:00.000Z");
    await expect(handler(event())).resolves.toBeUndefined();
    releaseDelayedWrite?.();
    await expect(staleOwner).rejects.toThrow("ZIP worker retry required");

    expect(leases.current().record).toMatchObject({
      owner_id: secondOwnerId,
      terminal_status: {
        state: "ready",
        result_key: `zip-jobs/results/${jobId}/${secondOwnerId}.zip`,
      },
    });
    expect(deletedResults).toContain(
      `zip-jobs/results/${jobId}/${firstOwnerId}.zip`,
    );
    error.mockRestore();
  });

  it("releases the lease when terminal status persistence fails so a retry completes", async () => {
    let statusWriteAttempt = 0;
    const leases = createLeaseStore(undefined, ({ record }) => {
      if (!record.terminal_status) return;
      statusWriteAttempt += 1;
      if (statusWriteAttempt <= 2) {
        throw new Error("synthetic status persistence failure");
      }
    });
    const deletedResults: string[] = [];
    const send = vi.fn(async (command: unknown) => {
      const leaseResult = await leases.send(command);
      if (leaseResult.handled) return leaseResult.value;
      if (command instanceof GetObjectCommand) {
        const { Key: objectKey } = command.input;
        if (objectKey === `zip-jobs/requests/${jobId}.json`) {
          return textObject(manifest);
        }
        if (objectKey === firstSourceKey) return { Body: Readable.from("first") };
        if (objectKey === secondSourceKey) return { Body: Readable.from("second") };
      }
      if (command instanceof DeleteObjectCommand) {
        const { Key: objectKey } = command.input;
        deletedResults.push(String(objectKey));
      }
      return {};
    });
    const createUpload = vi.fn(() => ({
      async done() {},
      async abort() {},
    }));
    const nextOwner = vi
      .fn()
      .mockReturnValueOnce(firstOwnerId)
      .mockReturnValueOnce(secondOwnerId);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = createZipDownloadHandler({
      s3: { send },
      filesBucketName: "FilesBucket.test",
      temporaryOutputsBucketName: "TemporaryOutputsBucket.test",
      createUpload,
      clock: () => new Date(now),
      ownerId: nextOwner,
      scheduleLeaseRenewal: vi.fn(() => Symbol("lease-renewal")),
      cancelLeaseRenewal: vi.fn(),
    });

    await expect(handler(event())).rejects.toThrow("ZIP worker retry required");
    await expect(handler(event())).resolves.toBeUndefined();

    expect(leases.current().record).toMatchObject({
      owner_id: secondOwnerId,
      terminal_status: {
        state: "ready",
        result_key: `zip-jobs/results/${jobId}/${secondOwnerId}.zip`,
      },
    });
    expect(deletedResults).toContain(
      `zip-jobs/results/${jobId}/${firstOwnerId}.zip`,
    );
    expect(createUpload).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
