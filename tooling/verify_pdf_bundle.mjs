import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const EXPECTED_FONT_BYTES = 122_012;
const EXPECTED_FONT_SHA256 =
  "18F930B583FA8FE6B40B2F8263B7AC6AFBAC07ADC91A12467874E7467D3ACE30";
const EXPECTED_NATIVE_PACKAGE = "@napi-rs/canvas-linux-arm64-gnu";
const EXPECTED_NATIVE_VERSION = "0.1.100";
const AARCH64_ELF_MACHINE = 183;

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const parsed = {
    artifacts: undefined,
    function: undefined,
    fontSource: "lambda/pdf-generator/fonts/Heebo-Regular.ttf",
  };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      fail("Expected --artifacts and --function value pairs.");
    }
    const key = flag
      .slice(2)
      .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in parsed)) fail(`Unknown bundle verifier option: ${flag}`);
    parsed[key] = value;
  }
  if (!parsed.artifacts || !parsed.function) {
    fail("Both --artifacts and --function are required.");
  }
  return parsed;
}

function verifyFont(fontBytes) {
  const fontSha256 = createHash("sha256")
    .update(fontBytes)
    .digest("hex")
    .toUpperCase();
  if (
    fontBytes.length !== EXPECTED_FONT_BYTES ||
    fontSha256 !== EXPECTED_FONT_SHA256
  ) {
    fail("Staged PDF bundle Heebo bytes do not match the pinned browser asset.");
  }
  return fontSha256;
}

function verifyAarch64Elf(nativeBytes) {
  if (
    nativeBytes.length < 20 ||
    !nativeBytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
    nativeBytes[4] !== 2 ||
    nativeBytes[5] !== 1 ||
    nativeBytes.readUInt16LE(18) !== AARCH64_ELF_MACHINE
  ) {
    fail("A staged canvas binary is not a little-endian AArch64 ELF64 artifact.");
  }
}

function nativePackagePrefix() {
  return `node_modules/${EXPECTED_NATIVE_PACKAGE}/`;
}

async function inspectEntries({ names, readEntry, fontBytes, fontEvidence }) {
  const fontSha256 = verifyFont(fontBytes);
  const nativeEntries = names.filter((name) => name.endsWith(".node"));
  const arm64Entries = nativeEntries.filter((name) =>
    name.replaceAll("\\", "/").startsWith(nativePackagePrefix()),
  );
  if (arm64Entries.length === 0) {
    fail("Staged PDF bundle is missing a Linux ARM64 canvas native binary.");
  }
  for (const name of arm64Entries) {
    verifyAarch64Elf(Buffer.from(await readEntry(name)));
  }

  const packageJsonName = `${nativePackagePrefix()}package.json`;
  if (!names.includes(packageJsonName)) {
    fail("Staged PDF bundle is missing the Linux ARM64 canvas package manifest.");
  }
  const packageManifest = JSON.parse(
    Buffer.from(await readEntry(packageJsonName)).toString("utf8"),
  );
  if (
    packageManifest.name !== EXPECTED_NATIVE_PACKAGE ||
    packageManifest.version !== EXPECTED_NATIVE_VERSION
  ) {
    fail("Staged Linux ARM64 canvas package identity or version has drifted.");
  }

  return {
    fontBytes: fontBytes.length,
    fontSha256,
    fontEvidence,
    nativePackage: EXPECTED_NATIVE_PACKAGE,
    nativeVersion: EXPECTED_NATIVE_VERSION,
    nativeArm64BinaryCount: arm64Entries.length,
    nativeBinaryCount: nativeEntries.length,
  };
}

export async function inspectPdfBundle(zipBytes) {
  const archive = await JSZip.loadAsync(zipBytes);
  const fontEntry = archive.file("fonts/Heebo-Regular.ttf");
  if (!fontEntry) fail("Staged PDF bundle is missing fonts/Heebo-Regular.ttf.");
  const names = Object.keys(archive.files).filter(
    (name) => !archive.files[name].dir,
  );
  return inspectEntries({
    names,
    readEntry: async (name) => archive.file(name).async("uint8array"),
    fontBytes: Buffer.from(await fontEntry.async("uint8array")),
    fontEvidence: "deployment-archive",
  });
}

function walk(directory, root = directory) {
  const names = [];
  for (const entry of readdirSync(directory)) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) names.push(...walk(absolute, root));
    else names.push(relative(root, absolute).replaceAll("\\", "/"));
  }
  return names;
}

export async function inspectPdfStagingDirectory(directory, fontSource) {
  const names = walk(directory);
  const stagedFontPath = join(directory, "fonts", "Heebo-Regular.ttf");
  const fontPath = existsSync(stagedFontPath) ? stagedFontPath : fontSource;
  if (!fontPath || !existsSync(fontPath)) {
    fail("PDF preview has neither a staged Heebo font nor a readable copy source.");
  }
  return inspectEntries({
    names,
    readEntry: async (name) => readFileSync(join(directory, name)),
    fontBytes: readFileSync(fontPath),
    fontEvidence: existsSync(stagedFontPath) ? "preview-staging" : "copy-source",
  });
}

async function main() {
  const arguments_ = parseArguments(process.argv.slice(2));
  const functionDirectory = resolve(
    arguments_.artifacts,
    arguments_.function,
  );
  const zipPath = join(functionDirectory, "code.zip");
  const stagingDirectory = resolve(
    arguments_.artifacts,
    `${arguments_.function}-src`,
  );
  const usesArchive = existsSync(zipPath);
  if (!usesArchive && !existsSync(stagingDirectory)) {
    fail("No PDF deployment archive or preview staging directory was found.");
  }
  const result = usesArchive
    ? await inspectPdfBundle(readFileSync(zipPath))
    : await inspectPdfStagingDirectory(
        stagingDirectory,
        resolve(arguments_.fontSource),
      );
  process.stdout.write(
    `${JSON.stringify(
      {
        function: arguments_.function,
        artifact: usesArchive ? "code.zip" : `${arguments_.function}-src`,
        ...result,
      },
      null,
      2,
    )}\n`,
  );
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`PDF bundle verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
