const FILE_EXTENSION_PATTERN = /\.([a-z0-9]{1,10})$/i;
const EXTENSION_BY_CONTENT_TYPE = Object.freeze({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/heic": "heic",
  "image/heif": "heic",
});

function finalPathSegment(value) {
  const withoutQueryOrFragment = String(value || "").split(/[?#]/, 1)[0];
  const segment = withoutQueryOrFragment.split(/[\\/]/).pop() || "";
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function getFileExtension(...candidates) {
  for (const candidate of candidates) {
    const match = finalPathSegment(candidate).match(FILE_EXTENSION_PATTERN);
    if (match) return match[1].toLowerCase();
  }
  return "file";
}

export function getContentTypeExtension(contentType) {
  return EXTENSION_BY_CONTENT_TYPE[String(contentType || "").toLowerCase()];
}
