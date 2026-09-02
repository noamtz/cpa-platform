import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";

import {
  inspectPdfBundle,
  inspectPdfStagingDirectory,
} from "./verify_pdf_bundle.mjs";

const fontPath = new URL(
  "../lambda/pdf-generator/fonts/Heebo-Regular.ttf",
  import.meta.url,
);
const temporaryDirectories = [];

function elf(machine = 183) {
  const bytes = Buffer.alloc(64);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
  bytes.writeUInt16LE(machine, 18);
  return bytes;
}

function createStagingDirectory(machine = 183) {
  const directory = mkdtempSync(join(tmpdir(), "auditflow-pdf-bundle-"));
  temporaryDirectories.push(directory);
  const packageDirectory = join(
    directory,
    "node_modules",
    "@napi-rs",
    "canvas-linux-arm64-gnu",
  );
  mkdirSync(packageDirectory, { recursive: true });
  writeFileSync(join(packageDirectory, "skia.linux-arm64-gnu.node"), elf(machine));
  writeFileSync(
    join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@napi-rs/canvas-linux-arm64-gnu",
      version: "0.1.100",
    }),
  );
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("PDF deployment artifact verification", () => {
  it("accepts preview staging with the exact copy source and AArch64 package", async () => {
    const result = await inspectPdfStagingDirectory(
      createStagingDirectory(),
      fontPath,
    );
    expect(result).toMatchObject({
      fontBytes: 122_012,
      fontEvidence: "copy-source",
      nativePackage: "@napi-rs/canvas-linux-arm64-gnu",
      nativeVersion: "0.1.100",
      nativeArm64BinaryCount: 1,
    });
  });

  it("rejects a renamed x64 ELF binary", async () => {
    await expect(
      inspectPdfStagingDirectory(createStagingDirectory(62), fontPath),
    ).rejects.toThrow("AArch64 ELF64");
  });

  it("verifies the exact font and native package in a deployment archive", async () => {
    const archive = new JSZip();
    archive.file("fonts/Heebo-Regular.ttf", readFileSync(fontPath));
    archive.file(
      "node_modules/@napi-rs/canvas-linux-arm64-gnu/skia.linux-arm64-gnu.node",
      elf(),
    );
    archive.file(
      "node_modules/@napi-rs/canvas-linux-arm64-gnu/package.json",
      JSON.stringify({
        name: "@napi-rs/canvas-linux-arm64-gnu",
        version: "0.1.100",
      }),
    );
    const result = await inspectPdfBundle(
      await archive.generateAsync({ type: "nodebuffer" }),
    );
    expect(result).toMatchObject({
      fontEvidence: "deployment-archive",
      fontBytes: 122_012,
      nativeArm64BinaryCount: 1,
    });
  });
});
