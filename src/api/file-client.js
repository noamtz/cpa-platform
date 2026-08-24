import { cognitoAuth } from "./cognito-auth";
import { invokePublicFunction } from "./function-client";
import { createHttpClient } from "./http-client";

const CONTENT_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
};

function contentTypeFor(file) {
  if (Object.values(CONTENT_TYPES).includes(file.type)) return file.type;
  const extension = String(file.name || "").split(".").pop()?.toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) throw new Error("Unsupported file type");
  return contentType;
}

function putFile(xhrFactory, upload, file, onProgress, clock) {
  const expiresAt = new Date(upload.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= clock().getTime()) {
    throw new Error("Upload URL expired");
  }
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open("PUT", upload.upload_url);
    Object.entries(upload.headers).forEach(([name, value]) =>
      xhr.setRequestHeader(name, value),
    );
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(Math.round((event.loaded / event.total) * 90), 90));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed: ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}

export function createFileClient(options) {
  const {
    http,
    invokePublic = invokePublicFunction,
    xhrFactory = () => new XMLHttpRequest(),
    clock = () => new Date(),
    delay = (milliseconds) =>
      new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)),
    documentRef = globalThis.document,
  } = options;
  async function upload({ initiate, complete, file, onProgress }) {
    const initiated = await initiate({
      size: file.size,
      content_type: contentTypeFor(file),
    });
    await putFile(xhrFactory, initiated, file, onProgress, clock);
    const completed = await complete(initiated.upload_id);
    onProgress?.(100);
    return completed.file_uri;
  }

  return {
    uploadPublicFile({
      file,
      clientId,
      token,
      submissionId,
      purpose,
      stepId,
      onProgress = undefined,
    }) {
      const credentials = {
        client_id: clientId,
        token,
        submission_id: submissionId,
      };
      return upload({
        file,
        onProgress,
        initiate: (metadata) =>
          invokePublic("uploadFile", {
            operation: "initiate",
            ...credentials,
            purpose,
            step_id: stepId,
            ...metadata,
          }),
        complete: (uploadId) =>
          invokePublic("uploadFile", {
            operation: "complete",
            ...credentials,
            upload_id: uploadId,
          }),
      });
    },

    uploadCpaFile({
      file,
      ownerType,
      ownerId,
      purpose,
      stepId = undefined,
      onProgress = undefined,
    }) {
      return upload({
        file,
        onProgress,
        initiate: (metadata) =>
          http.request("/cpa/files/uploads/initiate", {
            method: "POST",
            body: {
              owner_type: ownerType,
              owner_id: ownerId,
              purpose,
              ...(stepId ? { step_id: stepId } : {}),
              ...metadata,
            },
          }),
        complete: (uploadId) =>
          http.request("/cpa/files/uploads/complete", {
            method: "POST",
            body: {
              upload_id: uploadId,
              owner_type: ownerType,
              owner_id: ownerId,
            },
          }),
      });
    },

    getPublicSignedPdfUrl(payload) {
      return invokePublic("getSignedPdfUrl", payload);
    },
    getPublicTemplateFileUrl(payload) {
      return invokePublic("getTemplateFileUrl", payload);
    },
    getCpaSubmissionFileUrl(payload) {
      return http.request("/cpa/files/submission-url", {
        method: "POST",
        body: payload,
      });
    },
    getCpaTemplateFileUrl(templateId) {
      return http.request("/cpa/files/template-url", {
        method: "POST",
        body: { template_id: templateId },
      });
    },

    async downloadSubmissionZip(submissionId, { pollInterval = 1000 } = {}) {
      const requested = await http.request(
        `/cpa/submissions/${encodeURIComponent(submissionId)}/zip-downloads`,
        { method: "POST", body: {} },
      );
      for (;;) {
        const status = await http.request(
          `/cpa/submissions/${encodeURIComponent(submissionId)}/zip-downloads/${encodeURIComponent(requested.job_id)}`,
        );
        if (status.status === "failed") throw new Error(status.error || "ZIP download failed");
        if (status.status === "ready") {
          const anchor = documentRef.createElement("a");
          anchor.href = status.signed_url;
          anchor.download = status.download_name;
          anchor.rel = "noopener";
          anchor.click();
          return status;
        }
        await delay(pollInterval);
      }
    },
  };
}

const runtimeHttp = createHttpClient({ auth: cognitoAuth });
export const fileClient = createFileClient({ http: runtimeHttp });
