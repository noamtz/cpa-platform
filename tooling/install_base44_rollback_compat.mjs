import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const helperPath = join(scriptDirectory, "base44-rollback-compat", "resolveClientByLink.ts");
const ENTITY_NAMES = [
  "Client",
  "Submission",
  "QuestionnaireTemplate",
  "PdfTemplate",
  "SyncedDriveFile",
];
const FUNCTION_NAMES = [
  "getClientByToken",
  "updateClientSubmission",
  "uploadFile",
  "getSignedPdfUrl",
  "getTemplateFileUrl",
];
const LOCAL_IMPORT = "import { resolveClientByLink } from './resolveClientByLink.ts';";
const SOURCE_FIELDS = {
  auditflow_source_id: {
    type: "string",
    description: "Immutable AWS source ID used for rollback replay",
  },
  auditflow_source_created_date: {
    type: "string",
    format: "date-time",
    description: "AWS source creation timestamp preserved during rollback replay",
  },
  auditflow_source_updated_date: {
    type: "string",
    format: "date-time",
    description: "AWS source update timestamp preserved during rollback replay",
  },
};

function fail(category) {
  const error = new Error(category);
  error.category = category;
  throw error;
}

function isContained(root, candidate) {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

function atomicWrite(path, contents) {
  const temporary = `${path}.auditflow-rollback-compat.tmp`;
  writeFileSync(temporary, contents, { encoding: "utf8", flag: "w" });
  renameSync(temporary, path);
}

function readJsonc(path) {
  return JSON.parse(
    readFileSync(path, "utf8")
      .replace(/^\s*\/\/.*$/gm, "")
      .trim(),
  );
}

function replaceRequired(source, before, after) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) fail("rollback_compat_source_drift");
  return source.replace(before, after);
}

function addResolverImport(source) {
  if (source.includes(LOCAL_IMPORT)) return source;
  const sdkImport = "import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';";
  return replaceRequired(source, sdkImport, `${sdkImport}\n${LOCAL_IMPORT}`);
}

function transformFunction(name, source) {
  // The provenance clone can contain CRLF while the guarded replacements use
  // repository-normalized LF. Normalize before matching so installation is
  // deterministic across Windows and CI.
  let result = addResolverImport(source.replaceAll("\r\n", "\n"));
  if (name === "getClientByToken") {
    result = replaceRequired(
      result,
      "const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });",
      "const client = await resolveClientByLink(base44.asServiceRole, client_id);",
    );
    result = replaceRequired(result, "if (!clients || clients.length === 0)", "if (!client)");
    result = result.replace(/\n\s*const client = clients\[0\];\s*\n/, "\n");
    result = replaceRequired(
      result,
      "filter({ client_id, tax_year: taxYear })",
      "filter({ client_id: client.id, tax_year: taxYear })",
    );
  } else if (name === "updateClientSubmission") {
    result = replaceRequired(
      result,
      "const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });",
      "const client = await resolveClientByLink(base44.asServiceRole, client_id);",
    );
    result = replaceRequired(result, "if (!clients || clients.length === 0)", "if (!client)");
    result = result.replace(/\n\s*const client = clients\[0\];\s*\n/, "\n");
    result = replaceRequired(
      result,
      "filter({ client_id, tax_year: taxYear })",
      "filter({ client_id: client.id, tax_year: taxYear })",
    );
    result = replaceRequired(result, "          client_id,", "          client_id: client.id,");
    result = replaceRequired(
      result,
      "entities.Client.update(client_id, {",
      "entities.Client.update(client.id, {",
    );
  } else if (name === "uploadFile") {
    result = replaceRequired(
      result,
      "const clients = await base44.asServiceRole.entities.Client.filter({ id: clientId });\n      const client = clients?.[0];",
      "const client = await resolveClientByLink(base44.asServiceRole, clientId);",
    );
  } else if (name === "getSignedPdfUrl") {
    result = replaceRequired(
      result,
      "const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });\n    const client = clients?.[0];",
      "const client = await resolveClientByLink(base44.asServiceRole, client_id);",
    );
    result = replaceRequired(
      result,
      "filter({ client_id })",
      "filter({ client_id: client.id })",
    );
  } else if (name === "getTemplateFileUrl") {
    result = replaceRequired(
      result,
      "const clients = await base44.asServiceRole.entities.Client.filter({ id: client_id });\n    const client = clients?.[0];",
      "const client = await resolveClientByLink(base44.asServiceRole, client_id);",
    );
  } else {
    fail("rollback_compat_function_invalid");
  }
  if (result.includes("entities.Client.filter({ id:")) fail("rollback_compat_source_drift");
  return result;
}

export function installCompatibility(cloneRoot, { apply = false } = {}) {
  const absoluteRoot = resolve(cloneRoot);
  if (!isAbsolute(cloneRoot) || isContained(repositoryRoot, absoluteRoot)) {
    fail("rollback_compat_clone_invalid");
  }
  const configPath = join(absoluteRoot, "base44", "config.jsonc");
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (config.name !== "AuditFlow Rollback Rehearsal") fail("rollback_compat_clone_invalid");
  const helper = readFileSync(helperPath, "utf8");
  let changedEntities = 0;
  let changedFunctions = 0;

  for (const name of ENTITY_NAMES) {
    const path = join(absoluteRoot, "base44", "entities", `${name}.jsonc`);
    const schema = JSON.parse(readFileSync(path, "utf8"));
    if (schema.name !== name || !schema.properties || typeof schema.properties !== "object") {
      fail("rollback_compat_schema_invalid");
    }
    const next = {
      ...schema,
      properties: { ...SOURCE_FIELDS, ...schema.properties },
    };
    const contents = `${JSON.stringify(next, null, 2)}\n`;
    if (contents !== readFileSync(path, "utf8")) {
      changedEntities += 1;
      if (apply) atomicWrite(path, contents);
    }
  }

  for (const name of FUNCTION_NAMES) {
    const root = join(absoluteRoot, "base44", "functions", name);
    const entryPath = join(root, "entry.ts");
    const resolverPath = join(root, "resolveClientByLink.ts");
    const source = readFileSync(entryPath, "utf8");
    const transformed = transformFunction(name, source);
    const helperMatches = existsSync(resolverPath) && readFileSync(resolverPath, "utf8") === helper;
    if (transformed !== source || !helperMatches) {
      changedFunctions += 1;
      if (apply) {
        mkdirSync(root, { recursive: true });
        atomicWrite(entryPath, transformed);
        atomicWrite(resolverPath, helper);
      }
    }
  }

  return {
    status: apply ? "applied" : "checked",
    changedEntities,
    changedFunctions,
    compatible: changedEntities === 0 && changedFunctions === 0,
  };
}

export function loadInstallerTarget(descriptorPath) {
  if (!isAbsolute(descriptorPath)) fail("rollback_compat_target_forbidden");
  const absoluteDescriptor = resolve(descriptorPath);
  if (isContained(repositoryRoot, absoluteDescriptor)) {
    fail("rollback_compat_target_forbidden");
  }
  const descriptor = JSON.parse(readFileSync(absoluteDescriptor, "utf8"));
  const cloneRoot = descriptor.local_paths?.clone_root;
  if (
    descriptor.production ||
    descriptor.purpose !== "rollback-replay-rehearsal" ||
    descriptor.base44?.visibility !== "private" ||
    descriptor.base44?.credential_provider !== "base44-cli-authenticated-profile" ||
    typeof descriptor.base44?.app_id !== "string" ||
    !descriptor.base44.app_id ||
    typeof cloneRoot !== "string" ||
    !isAbsolute(cloneRoot) ||
    isContained(repositoryRoot, cloneRoot)
  ) {
    fail("rollback_compat_target_forbidden");
  }
  const linkedApp = readJsonc(join(resolve(cloneRoot), "base44", ".app.jsonc"));
  if (linkedApp.id !== descriptor.base44.app_id) {
    fail("rollback_compat_target_forbidden");
  }
  return { descriptor, cloneRoot: resolve(cloneRoot) };
}

function parseArguments(argv) {
  const result = { apply: false, confirm: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") result.apply = true;
    else if (value === "--confirm-controlled-rehearsal") result.confirm = true;
    else if (value === "--target-descriptor") result.descriptor = argv[++index];
    else fail("invalid_arguments");
  }
  if (!result.descriptor || (result.apply && !result.confirm)) fail("invalid_arguments");
  return result;
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    const target = loadInstallerTarget(arguments_.descriptor);
    const result = installCompatibility(target.cloneRoot, {
      apply: arguments_.apply,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Rollback compatibility failed: ${error.category ?? "safe_failure"}\n`);
    process.exitCode = 1;
  }
}
