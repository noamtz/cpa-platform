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

function textObject(value: unknown) {
  return {
    Body: {
      transformToString: async () => JSON.stringify(value),
    },
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
        state: "ready",
        result_key: `zip-jobs/results/${jobId}.zip`,
        completed_at: now,
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
    const statusWrites: unknown[] = [];
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        const { Key: objectKey } = command.input;
        if (objectKey === `zip-jobs/status/${jobId}.json`) {
          throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        }
        if (objectKey === `zip-jobs/requests/${jobId}.json`) return textObject(manifest);
        if (objectKey === firstSourceKey) return { Body: Readable.from("first") };
        if (objectKey === secondSourceKey) return { Body: Readable.from("second") };
      }
      if (command instanceof PutObjectCommand) {
        statusWrites.push(JSON.parse(String(command.input.Body)));
        return {};
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
    });
    await handler(event());
    expect(createUpload).toHaveBeenCalledOnce();
    const zip = await JSZip.loadAsync(archive as Buffer);
    await expect(zip.file("מסמך_1.pdf")?.async("string")).resolves.toBe("first");
    await expect(zip.file("מסמך_1_2.pdf")?.async("string")).resolves.toBe("second");
    expect(statusWrites[0]).toMatchObject({ state: "ready", job_id: jobId });
  });

  it("fails the whole job and cleans partial output when any source is missing", async () => {
    const writes: unknown[] = [];
    const send = vi.fn(async (command: unknown) => {
      if (command instanceof GetObjectCommand) {
        const { Key: objectKey } = command.input;
        if (objectKey === `zip-jobs/status/${jobId}.json`) {
          throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
        }
        if (objectKey === `zip-jobs/requests/${jobId}.json`) return textObject(manifest);
        if (objectKey === firstSourceKey) return { Body: Readable.from("first") };
        throw Object.assign(new Error("missing"), { name: "NoSuchKey" });
      }
      if (command instanceof PutObjectCommand) {
        writes.push(JSON.parse(String(command.input.Body)));
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
    });
    await handler(event());
    expect(createUpload).not.toHaveBeenCalled();
    expect(
      send.mock.calls.some(([command]) => command instanceof DeleteObjectCommand),
    ).toBe(true);
    expect(writes[0]).toMatchObject({
      state: "failed",
      failure_code: "source_unavailable",
    });
    expect(error).toHaveBeenCalledWith(
      "AuditFlow ZIP job failed",
      expect.objectContaining({ jobId, errorName: "NoSuchKey" }),
    );
    error.mockRestore();
  });
});
