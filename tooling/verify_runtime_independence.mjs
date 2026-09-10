import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const textExtensions = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".mjs", ".map", ".ts", ".tsx", ".txt",
]);
const forbiddenPatterns = [
  { code: "base44_sdk", pattern: /@base44\/(?:sdk|vite-plugin)/iu },
  { code: "base44_host", pattern: /https?:\/\/[^\s"'`]*(?:base44\.(?:app|com|io)|base44api)[^\s"'`]*/iu },
  { code: "base44_protocol", pattern: /base44(?:-storage)?:\/\//iu },
  { code: "base44_import", pattern: /(?:from\s*|import\s*\()["']@base44\//iu },
];

function fail(message) {
  throw new Error(message);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertInside(root, candidate) {
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel.includes(":") || rel === "") {
    fail(`Unsafe or empty artifact path: ${candidate}`);
  }
  return rel.replaceAll("\\", "/");
}

function collectFiles(root) {
  if (!existsSync(root)) fail(`Scan root does not exist: ${root}`);
  if (!lstatSync(root).isDirectory()) fail(`Scan root is not a directory: ${root}`);
  const files = [];
  const visitedDirectories = new Set();
  const visit = (directory) => {
    const realDirectory = realpathSync(directory);
    const realRelative = relative(root, realDirectory);
    if (realRelative.startsWith("..") || realRelative.includes(":")) {
      fail(`Symlink escapes runtime artifact root: ${directory}`);
    }
    if (visitedDirectories.has(realDirectory)) return;
    visitedDirectories.add(realDirectory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      assertInside(root, path);
      if (entry.isSymbolicLink()) {
        let realTarget;
        try {
          realTarget = realpathSync(path);
        } catch {
          fail(`Broken symlink in runtime artifacts: ${path}`);
        }
        assertInside(root, realTarget);
        const target = statSync(realTarget);
        if (target.isDirectory()) visit(path);
        else if (target.isFile()) files.push(path);
        else fail(`Unsupported symlink target in runtime artifacts: ${path}`);
      } else if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  if (files.length === 0) fail(`Scan root is empty: ${root}`);
  return files;
}

function inspectText(label, buffer) {
  const text = buffer.toString("utf8");
  return forbiddenPatterns
    .filter(({ pattern }) => pattern.test(text))
    .map(({ code }) => ({ artifact: label, code }));
}

async function inspectFile(root, path) {
  const label = assertInside(root, path);
  const buffer = readFileSync(path);
  const findings = [];
  if (extname(path).toLowerCase() === ".zip") {
    const archive = await JSZip.loadAsync(buffer);
    for (const [entryName, entry] of Object.entries(archive.files)) {
      if (entry.dir) continue;
      if (entryName.startsWith("/") || entryName.split(/[\\/]/u).includes("..")) {
        fail(`Unsafe archive entry: ${label}:${entryName}`);
      }
      const entryBuffer = await entry.async("nodebuffer");
      if (textExtensions.has(extname(entryName).toLowerCase())) {
        findings.push(...inspectText(`${label}:${entryName}`, entryBuffer));
      }
    }
  } else if (textExtensions.has(extname(path).toLowerCase())) {
    findings.push(...inspectText(label, buffer));
  }
  return { label, sha256: sha256(buffer), findings };
}

export async function scanRuntimeIndependence({
  frontend,
  artifacts,
  root = repositoryRoot,
  includeManifests = true,
}) {
  const groups = [];
  if (includeManifests) {
    for (const name of ["package.json", "package-lock.json"]) {
      const path = resolve(root, name);
      if (!existsSync(path)) fail(`Required manifest is missing: ${name}`);
      groups.push({ kind: "manifest", root, files: [path] });
    }
  }
  if (frontend) {
    const scanRoot = resolve(root, frontend);
    groups.push({ kind: "frontend", root: scanRoot, files: collectFiles(scanRoot) });
  }
  if (artifacts) {
    const scanRoot = resolve(root, artifacts);
    groups.push({ kind: "artifacts", root: scanRoot, files: collectFiles(scanRoot) });
  }
  if (!frontend && !artifacts && !includeManifests) fail("No runtime inputs were selected.");

  const scanned = [];
  const findings = [];
  for (const group of groups) {
    for (const path of group.files) {
      const result = await inspectFile(group.root, path);
      scanned.push({ kind: group.kind, path: result.label, sha256: result.sha256 });
      findings.push(...result.findings.map((finding) => ({ ...finding, kind: group.kind })));
    }
  }
  return {
    schemaVersion: 1,
    status: findings.length === 0 ? "passed" : "failed",
    scannedFileCount: scanned.length,
    scanned,
    findings,
    allowedMigrationSeams: ["src/api/base44Client.js", "same-origin /api/apps/{appId}/functions/{name}"],
  };
}

function parseArguments(argv) {
  const result = { includeManifests: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-manifests") result.includeManifests = false;
    else if (["--frontend", "--artifacts"].includes(argument)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) fail(`Expected value after ${argument}.`);
      result[argument.slice(2)] = value;
      index += 1;
    } else fail(`Unknown argument: ${argument}`);
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await scanRuntimeIndependence(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.status !== "passed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
