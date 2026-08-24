import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { S3Event } from "aws-lambda";
import JSZip from "jszip";
import type { Readable } from "node:stream";
import { ZodError } from "zod";

import {
  ZIP_REQUEST_PREFIX,
  ZIP_RESULT_PREFIX,
  ZIP_STATUS_PREFIX,
  zipManifestSchema,
  zipStatusSchema,
  type ZipStatus,
} from "../contracts/files";
import type { S3CommandClient } from "../services/files";

interface ObjectBody {
  readonly Body?: NodeJS.ReadableStream & { transformToString?(): Promise<string> };
}

interface ArchiveUpload {
  done(): Promise<unknown>;
  abort(): Promise<unknown>;
}

class InvalidZipJobError extends Error {}
class SourceUnavailableError extends Error {}

export interface ZipWorkerOptions {
  readonly s3: S3CommandClient;
  readonly filesBucketName: string;
  readonly temporaryOutputsBucketName: string;
  readonly createUpload: (key: string, body: NodeJS.ReadableStream) => ArchiveUpload;
  readonly clock?: () => Date;
}

function isMissingObject(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

async function textBody(result: ObjectBody) {
  if (!result.Body?.transformToString) throw new Error("Invalid object body");
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
    throw error;
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

async function processJob(
  options: ZipWorkerOptions,
  requestKey: string,
  clock: () => Date,
) {
  const jobId = requestKey.slice(ZIP_REQUEST_PREFIX.length, -".json".length);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) return;
  const existing = await optionalStatus(options, jobId);
  if (existing) return;

  const resultKey = `${ZIP_RESULT_PREFIX}${jobId}.zip`;
  let upload: ArchiveUpload | undefined;
  try {
    const request = (await options.s3.send(
      new GetObjectCommand({
        Bucket: options.temporaryOutputsBucketName,
        Key: requestKey,
      }),
    )) as ObjectBody;
    const manifest = zipManifestSchema.parse(JSON.parse(await textBody(request)));
    if (
      manifest.job_id !== jobId ||
      new Date(manifest.expires_at).getTime() <= clock().getTime()
    ) {
      throw new InvalidZipJobError("Invalid job");
    }

    const zip = new JSZip();
    for (const entry of manifest.entries) {
      const { key: sourceKey, name } = entry;
      const source = (await options.s3.send(
        new GetObjectCommand({ Bucket: options.filesBucketName, Key: sourceKey }),
      )) as ObjectBody;
      if (!source.Body) throw new SourceUnavailableError("Missing source");
      zip.file(name, source.Body);
    }
    const stream = zip.generateNodeStream({
      type: "nodebuffer",
      streamFiles: true,
      compression: "DEFLATE",
    });
    upload = options.createUpload(resultKey, stream);
    await upload.done();
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
    await writeStatus(
      options,
      zipStatusSchema.parse({
        version: 1,
        job_id: jobId,
        state: "failed",
        failure_code:
          isMissingObject(error) || error instanceof SourceUnavailableError
            ? "source_unavailable"
            : error instanceof InvalidZipJobError || error instanceof ZodError
              ? "invalid_job"
              : "archive_failed",
        completed_at: clock().toISOString(),
      }),
    );
    console.error("AuditFlow ZIP job failed", {
      jobId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

export function createZipDownloadHandler(options: ZipWorkerOptions) {
  const clock = options.clock ?? (() => new Date());
  return async (event: S3Event) => {
    for (const record of event.Records) {
      const { key: encodedKey } = record.s3.object;
      const requestKey = decodeURIComponent(encodedKey.replaceAll("+", " "));
      if (
        record.s3.bucket.name !== options.temporaryOutputsBucketName ||
        !requestKey.startsWith(ZIP_REQUEST_PREFIX) ||
        !requestKey.endsWith(".json")
      ) {
        continue;
      }
      await processJob(options, requestKey, clock);
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

let runtimeHandler: ReturnType<typeof createZipDownloadHandler> | undefined;
export async function handler(event: S3Event) {
  runtimeHandler ??= createRuntimeHandler();
  return runtimeHandler(event);
}
