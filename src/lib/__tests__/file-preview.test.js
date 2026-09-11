import { describe, expect, it } from "vitest";

import { getFileExtension } from "../file-preview";

describe("file preview type detection", () => {
  it("uses the original file name before an extensionless signed legacy URL", () => {
    expect(getFileExtension(
      "annual-report.PDF",
      "https://files.example.com/legacy/f75d97ff?signature=test",
    )).toBe("pdf");
  });

  it("reads an extension from the original reference when no file name exists", () => {
    expect(getFileExtension(
      undefined,
      "https://legacy.example.test/uploads/receipt.jpeg?version=1",
    )).toBe("jpeg");
  });

  it("does not treat a signed URL host and path as a file extension", () => {
    expect(getFileExtension(
      "https://files.example.com/legacy/f75d97ff?signature=test",
    )).toBe("file");
  });
});
