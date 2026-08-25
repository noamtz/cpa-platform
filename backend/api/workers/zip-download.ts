import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { S3Event } from "aws-lambda";
import JSZip from "jszip";
import { ZodError } from "zod";

import {
  ZIP_LEASE_DURATION_MS,
  ZIP_LEASE_HEARTBEAT_MS,
  ZIP_LOCK_PREFIX,
  ZIP_REQUEST_PREFIX,
  ZIP_STATUS_PREFIX,
  zipManifestSchema,
  zipProcessingLeaseSchema,
  zipResultKey,
  zipStatusSchema,
  type ZipProcessingLease,
  type ZipStatus,
} from "../contracts/files";
import type { S3CommandClient } from "../services/files";

interface ObjectBody {
  readonly Body?: NodeJS.ReadableStream & {
    transformToString?(): Promise<string>;
  };
  readonly ETag?: string;
}

interface PutResult {
  readonly ETag?: string;
}

interface ArchiveUpload {
  done(): Promise<unknown>;
  abort(): Promise<unknown>;
}

interface LeaseHandle {
  readonly record: ZipProcessingLease;
  readonly etag: string;
}

class InvalidZipJobError extends Error {}
class SourceUnavailableError extends Error {}
class LeaseLostError extends Error {}
class ZipWorkerRetryError extends Error {}

export interface ZipWorkerOptions {
  readonly s3: S3CommandClient;
  readonly filesBucketName: string;
  readonly temporaryOutputsBucketName: string;
  readonly createUpload: (
    key: string,
    body: NodeJS.ReadableStream,
  ) => ArchiveUpload;
  readonly clock?: () => Date;
  readonly ownerId?: () => string;
  readonly scheduleLeaseRenewal?: (
    callback: () => void,
    milliseconds: number,
  ) => unknown;
  readonly cancelLeaseRenewal?: (handle: unknown) => void;
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function isConditionalConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "PreconditionFailed" ||
    candidate.name === "ConditionalRequestConflict" ||
    candidate.$metadata?.httpStatusCode === 409 ||
    candidate.$metadata?.httpStatusCode === 412
  );
}

async function textBody(result: ObjectBody) {
  if (!result.Body?.transformToString) throw new InvalidZipJobError();
  return result.Body.transformToString();
}

async function optionalStatus(options: ZipWorkerOptions, jobId: string) {
  try {
    const result = (await options.s3.send(
      new GetObjectCommand({
        Bucket: options.temporaryOutputsBucketName,
        Key: `${ZIP_STATUS_PREFIX}${jobId}.json`,
      }),
    )) as ObjectBody;
    return zipStatusSchema.parse(JSON.parse(await textBody(result)));
  } catch (error) {
    if (isMissingObject(error)) return undefined;
    throw new ZipWorkerRetryError();
  }
}

async function writeStatus(options: ZipWorkerOptions, status: ZipStatus) {
  await options.s3.send(
    new PutObjectCommand({
      Bucket: options.temporaryOutputsBucketName,
      Key: `${ZIP_STATUS_PREFIX}${status.job_id}.json`,
      Body: JSON.stringify(status),
      ContentType: "application/json",
    }),
  );
}

function leaseRecord(jobId: string, ownerId: string, clock: () => Date) {
  return zipProcessingLeaseSchema.parse({
    version: 1,
    job_id: jobId,
    owner_id: ownerId,
    expires_at: new Date(
      clock().getTime() + ZIP_LEASE_DURATION_MS,
    ).toISOString(),
  });
}

async function putLease(
  options: ZipWorkerOptions,
  record: ZipProcessingLease,
  condition: { readonly IfNoneMatch?: string; readonly IfMatch?: string },
): Promise<LeaseHandle> {
  const result = (await options.s3.send(
    new PutObjectCommand({
      Bucket: options.temporaryOutputsBucketName,
      Key: `${ZIP_LOCK_PREFIX}${record.job_id}.json`,
      Body: JSON.stringify(record),
      ContentType: "application/json",
      ...condition,
    }),
  )) as PutResult;
  if (!result.ETag) throw new ZipWorkerRetryError();
  return { record, etag: result.ETag };
}

async function acquireProcessingLease(
  options: ZipWorkerOptions,
  jobId: string,
  ownerId: string,
  clock: () => Date,
) {
  const candidate = leaseRecord(jobId, ownerId, clock);
  try {
    return await putLease(options, candidate, { IfNoneMatch: "*" });
  } catch (error) {
    if (!isConditionalConflict(error)) {
      if (error instanceof ZipWorkerRetryError) throw error;
      throw new ZipWorkerRetryError();
    }
  }

  let current: ObjectBody;
  try {
    current = (await options.s3.send(
      new GetObjectCommand({
        Bucket: options.temporaryOutputsBucketName,
        Key: `${ZIP_LOCK_PREFIX}${jobId}.json`,
      }),
    )) as ObjectBody;
  } catch (error) {
    if (isMissingObject(error)) return undefined;
    throw new ZipWorkerRetryError();
  }
  if (!current.ETag) throw new ZipWorkerRetryError();
  let existing: ZipProcessingLease;
  try {
    existing = zipProcessingLeaseSchema.parse(
      JSON.parse(await textBody(current)),
    );
  } catch {
    throw new ZipWorkerRetryError();
  }
  if (new Date(existing.expires_at).getTime() > clock().getTime()) {
    return undefined;
  }
  try {
    return await putLease(options, candidate, { IfMatch: current.ETag });
  } catch (error) {
    if (isConditionalConflict(error)) return undefined;
    if (error instanceof ZipWorkerRetryError) throw error;
    throw new ZipWorkerRetryError();
  }
}

function createLeaseController(
  options: ZipWorkerOptions,
  initial: LeaseHandle,
  clock: () => Date,
) {
  let current = initial;
  let lost = false;
  let renewal = Promise.resolve();
  const renew = async () => {
    const next = leaseRecord(
      current.record.job_id,
      current.record.owner_id,
      clock,
    );
    current = await putLease(options, next, { IfMatch: current.etag });
  };
  const schedule =
    options.scheduleLeaseRenewal ??
    ((callback: () => void, milliseconds: number) =>
      globalThis.setInterval(callback, milliseconds));
  const cancel =
    options.cancelLeaseRenewal ??
    ((handle: unknown) =>
      globalThis.clearInterval(
        handle as ReturnType<typeof globalThis.setInterval>,
      ));
  const scheduled = schedule(() => {
    renewal = renewal
      .then(async () => {
        if (!lost) await renew();
      })
      .catch(() => {
        lost = true;
      });
  }, ZIP_LEASE_HEARTBEAT_MS);

  return {
    assertOwned() {
      if (lost) throw new LeaseLostError();
    },
    async renewNow() {
      const immediate = renewal.then(async () => {
        if (lost) throw new LeaseLostError();
        await renew();
      });
      renewal = immediate.catch(() => {
        lost = true;
      });
      try {
        await immediate;
      } catch {
        throw new LeaseLostError();
      }
    },
    async release() {
      cancel(scheduled);
      await renewal;
      if (lost) return;
      const expired = zipProcessingLeaseSchema.parse({
        ...current.record,
        expires_at: clock().toISOString(),
      });
      await putLease(options, expired, { IfMatch: current.etag }).catch(
        () => undefined,
      );
    },
  };
}

function failureCode(
  error: unknown,
): "source_unavailable" | "archive_failed" | "invalid_job" {
  if (isMissingObject(error) || error instanceof SourceUnavailableError) {
    return "source_unavailable";
  }
  if (error instanceof InvalidZipJobError || error instanceof ZodError) {
    return "invalid_job";
  }
  return "archive_failed";
}

async function processJob(
  options: ZipWorkerOptions,
  requestKey: string,
  clock: () => Date,
  ownerId: () => string,
) {
  const jobId = requestKey.slice(
    ZIP_REQUEST_PREFIX.length,
    -".json".length,
  );
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      jobId,
    )
  ) {
    return;
  }
  const existing = await optionalStatus(options, jobId);
  if (existing) return;
  const acquired = await acquireProcessingLease(
    options,
    jobId,
    ownerId(),
    clock,
  );
  if (!acquired) return;

  const lease = createLeaseController(options, acquired, clock);
  const resultKey = zipResultKey(jobId, acquired.record.owner_id);
  let upload: ArchiveUpload | undefined;
  try {
    const request = (await options.s3.send(
      new GetObjectCommand({
        Bucket: options.temporaryOutputsBucketName,
        Key: requestKey,
      }),
    )) as ObjectBody;
    lease.assertOwned();
    const manifest = zipManifestSchema.parse(
      JSON.parse(await textBody(request)),
    );
    if (
      manifest.job_id !== jobId ||
      new Date(manifest.expires_at).getTime() <= clock().getTime()
    ) {
      throw new InvalidZipJobError();
    }

    const zip = new JSZip();
    for (const entry of manifest.entries) {
      const { key: sourceKey, name } = entry;
      const source = (await options.s3.send(
        new GetObjectCommand({
          Bucket: options.filesBucketName,
          Key: sourceKey,
        }),
      )) as ObjectBody;
      lease.assertOwned();
      if (!source.Body) throw new SourceUnavailableError();
      zip.file(name, source.Body);
    }
    const stream = zip.generateNodeStream({
      type: "nodebuffer",
      streamFiles: true,
      compression: "DEFLATE",
    });
    upload = options.createUpload(resultKey, stream);
    await upload.done();
    await lease.renewNow();
    await writeStatus(
      options,
      zipStatusSchema.parse({
        version: 1,
        job_id: jobId,
        state: "ready",
        result_key: resultKey,
        completed_at: clock().toISOString(),
      }),
    );
  } catch (error) {
    if (upload) await upload.abort().catch(() => undefined);
    await options.s3
      .send(
        new DeleteObjectCommand({
          Bucket: options.temporaryOutputsBucketName,
          Key: resultKey,
        }),
      )
      .catch(() => undefined);
    if (error instanceof LeaseLostError) throw new ZipWorkerRetryError();
    await lease.renewNow();
    const code = failureCode(error);
    await writeStatus(
      options,
      zipStatusSchema.parse({
        version: 1,
        job_id: jobId,
        state: "failed",
        failure_code: code,
        completed_at: clock().toISOString(),
      }),
    );
    console.error("AuditFlow ZIP job failed", {
      jobId,
      failureClass: code,
      message: "ZIP job reached a terminal failure",
    });
  } finally {
    await lease.release();
  }
}

export function createZipDownloadHandler(options: ZipWorkerOptions) {
  const clock = options.clock ?? (() => new Date());
  const ownerId = options.ownerId ?? randomUUID;
  return async (event: S3Event) => {
    for (const record of event.Records) {
      const { key: encodedKey } = record.s3.object;
      const requestKey = decodeURIComponent(
        encodedKey.replaceAll("+", " "),
      );
      if (
        record.s3.bucket.name !== options.temporaryOutputsBucketName ||
        !requestKey.startsWith(ZIP_REQUEST_PREFIX) ||
        !requestKey.endsWith(".json")
      ) {
        continue;
      }
      const jobId = requestKey.slice(
        ZIP_REQUEST_PREFIX.length,
        -".json".length,
      );
      try {
        await processJob(options, requestKey, clock, ownerId);
      } catch {
        console.error("AuditFlow ZIP job retry required", {
          jobId,
          failureClass: "worker_retry",
          message: "ZIP job did not reach a terminal state",
        });
        throw new ZipWorkerRetryError("ZIP worker retry required");
      }
    }
  };
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing runtime configuration: ${name}`);
  return value;
}

function createRuntimeHandler() {
  const sdkS3 = new S3Client({});
  const temporaryOutputsBucketName = requiredEnvironment(
    "TEMPORARY_OUTPUTS_BUCKET_NAME",
  );
  return createZipDownloadHandler({
    s3: { send: (command) => sdkS3.send(command as never) },
    filesBucketName: requiredEnvironment("FILES_BUCKET_NAME"),
    temporaryOutputsBucketName,
    createUpload(key, body) {
      const upload = new Upload({
        client: sdkS3,
        params: {
          Bucket: temporaryOutputsBucketName,
          Key: key,
          Body: body as Readable,
          ContentType: "application/zip",
        },
        leavePartsOnError: false,
      });
      return {
        done: () => upload.done(),
        abort: () => upload.abort(),
      };
    },
  });
}

let runtimeHandler:
  | ReturnType<typeof createZipDownloadHandler>
  | undefined;
export async function handler(event: S3Event) {
  runtimeHandler ??= createRuntimeHandler();
  return runtimeHandler(event);
}
