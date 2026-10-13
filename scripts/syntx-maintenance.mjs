#!/usr/bin/env node

import { resolve } from "node:path";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { types } from "node:util";
import { fileURLToPath } from "node:url";

const VERSION_PATTERN = /^sha256-[a-f0-9]{64}\.json$/u;
const REPORT_ERROR_CODES = new Set([
  "INVALID_PUBLIC_SNAPSHOT",
  "SETTINGS_PAIR_REQUIRED",
  "INVALID_SETTINGS_SNAPSHOT",
  "SETTINGS_PUBLIC_BINDING_MISMATCH",
  "UNSAFE_INPUT"
]);
const PLAN_ERROR_CODES = new Set(["INVALID_INPUT", "UNSAFE_CHECKPOINT", "CHECKPOINT_SOURCE_MISMATCH"]);
const CONTROL_WALK_ERROR_CODES = new Set(["INVALID_INPUT", "UNSAFE_CHECKPOINT", "CHECKPOINT_SOURCE_MISMATCH", "CONTROL_CHECKPOINT_LIMIT_EXCEEDED"]);
const CLI_ERROR_CODES = new Set([
  "MAINTENANCE_ARGUMENTS_INVALID",
  "PUBLIC_CATALOG_PROBE_FAILED",
  "PUBLIC_CATALOG_ARCHIVE_INVALID",
  "MAPLESS_SETTINGS_ARCHIVE_INVALID",
  "MAINTENANCE_OPERATION_FAILED",
  "MAINTENANCE_CHECKPOINT_INVALID",
  "MAINTENANCE_CONTROL_WALK_INVALID",
  "MAINTENANCE_CONTROL_CHECKPOINT_INVALID",
  "MAINTENANCE_CONTROL_CHECKPOINT_SOURCE_MISMATCH"
]);

export class SyntxMaintenanceCliError extends Error {
  constructor(code) {
    super(code);
    this.name = "SyntxMaintenanceCliError";
    this.code = code;
  }
}

export function parseArguments(argumentsList) {
  if (!Array.isArray(argumentsList) || argumentsList.some((item) => typeof item !== "string")) {
    throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
  }
  if (argumentsList.length === 0 || (argumentsList.length === 1 && argumentsList[0] === "--help")) {
    return { kind: "help" };
  }

  const values = new Map();
  const valueFlags = new Set([
    "--baseline-public",
    "--candidate-public",
    "--baseline-settings",
    "--candidate-settings",
    "--catalog-directory",
    "--checkpoint",
    "--control-checkpoint"
  ]);
  const switchFlags = new Set(["--compare", "--probe-public", "--plan-audit", "--confirm-source-fetch", "--control-walk"]);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const flag = argumentsList[index];
    if (values.has(flag)) throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
    if (switchFlags.has(flag)) {
      values.set(flag, true);
      continue;
    }
    if (!valueFlags.has(flag)) throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
    const value = argumentsList[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
    }
    values.set(flag, value);
    index += 1;
  }

  const compare = values.has("--compare");
  const probe = values.has("--probe-public");
  const planAudit = values.has("--plan-audit");
  if ([compare, probe, planAudit].filter(Boolean).length !== 1) {
    throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
  }
  const baselinePublic = values.get("--baseline-public");
  if (!isExactVersion(baselinePublic)) {
    throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
  }
  const catalogDirectory = values.get("--catalog-directory");

  if (compare || planAudit) {
    const candidatePublic = values.get("--candidate-public");
    const baselineSettings = values.get("--baseline-settings");
    const candidateSettings = values.get("--candidate-settings");
    const controlWalk = values.has("--control-walk");
    if (
      values.has("--confirm-source-fetch") ||
      typeof candidatePublic !== "string" ||
      !isExactVersion(candidatePublic) ||
      (baselineSettings === undefined) !== (candidateSettings === undefined) ||
      (baselineSettings !== undefined && !isExactVersion(baselineSettings)) ||
      (candidateSettings !== undefined && !isExactVersion(candidateSettings))
    ) {
      throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
    }
    const checkpointPath = values.get("--checkpoint");
    const controlCheckpointPath = values.get("--control-checkpoint");
    if ((compare && checkpointPath !== undefined) ||
        (checkpointPath !== undefined && !isSafeCheckpointPath(checkpointPath)) ||
        (compare && (controlWalk || controlCheckpointPath !== undefined)) ||
        (controlWalk && (baselineSettings === undefined || candidateSettings === undefined)) ||
        (controlCheckpointPath !== undefined && (!controlWalk || !isSafeCheckpointPath(controlCheckpointPath)))) {
      throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
    }
    return {
      kind: planAudit ? "plan-audit" : "compare",
      baselinePublic,
      candidatePublic,
      ...(baselineSettings === undefined ? {} : { baselineSettings, candidateSettings }),
      ...(checkpointPath === undefined ? {} : { checkpointPath }),
      ...(controlWalk ? { controlWalk: true } : {}),
      ...(controlCheckpointPath === undefined ? {} : { controlCheckpointPath }),
      ...(catalogDirectory === undefined ? {} : { catalogDirectory })
    };
  }

  if (
    values.has("--candidate-public") ||
    values.has("--baseline-settings") ||
    values.has("--candidate-settings") ||
    values.has("--checkpoint") ||
    values.has("--control-walk") ||
    values.has("--control-checkpoint") ||
    !values.has("--confirm-source-fetch")
  ) {
    throw new SyntxMaintenanceCliError("MAINTENANCE_ARGUMENTS_INVALID");
  }
  return {
    kind: "probe-public",
    baselinePublic,
    ...(catalogDirectory === undefined ? {} : { catalogDirectory })
  };
}

export async function main(argumentsList = process.argv.slice(2), options = {}) {
  const mode = parseArguments(argumentsList);
  if (mode.kind === "help") {
    writeOutput(options, `${USAGE}\n`);
    return { status: "HELP" };
  }

  let runtime;
  try {
    runtime = options.runtime ?? await loadRuntime();
    const catalogDirectory = mode.catalogDirectory;
    const baselinePublic = loadPublicSnapshot(runtime, mode.baselinePublic, catalogDirectory);
    if (mode.kind === "plan-audit") {
      const candidatePublic = loadPublicSnapshot(runtime, mode.candidatePublic, catalogDirectory);
      const baselineSettings = mode.baselineSettings === undefined
        ? undefined
        : loadSettingsInventory(runtime, mode.baselineSettings, catalogDirectory);
      const candidateSettings = mode.candidateSettings === undefined
        ? undefined
        : loadSettingsInventory(runtime, mode.candidateSettings, catalogDirectory);
      const checkpoint = mode.checkpointPath === undefined ? undefined : loadCheckpoint(mode.checkpointPath);
      const plan = runtime.buildSyntxMaintenanceAuditPlan({
        baseline_public: baselinePublic,
        candidate_public: candidatePublic,
        ...(baselineSettings === undefined ? {} : {
          baseline_settings: baselineSettings,
          candidate_settings: candidateSettings
        }),
        ...(checkpoint === undefined ? {} : { checkpoint })
      });
      let controlWalk;
      if (mode.controlWalk === true) {
        const controlCheckpoint = mode.controlCheckpointPath === undefined
          ? undefined
          : loadCheckpoint(mode.controlCheckpointPath);
        controlWalk = runtime.buildSyntxMaintenanceControlWalk({
          audit_plan: plan,
          baseline_settings: baselineSettings,
          candidate_settings: candidateSettings,
          ...(controlCheckpoint === undefined ? {} : { checkpoint: controlCheckpoint })
        });
      }
      const result = {
        schema_version: "1.0.0",
        operation: "INCREMENTAL_AUDIT_PLAN",
        baseline_public_version: mode.baselinePublic,
        candidate_public_version: mode.candidatePublic,
        baseline_settings_version: mode.baselineSettings ?? null,
        candidate_settings_version: mode.candidateSettings ?? null,
        plan,
        ...(controlWalk === undefined ? {} : { control_walk: controlWalk })
      };
      writeOutput(options, `${JSON.stringify(result, null, 2)}\n`);
      return result;
    }
    let candidatePublic;
    let baselineSettings;
    let candidateSettings;
    let candidatePublicVersion;

    if (mode.kind === "compare") {
      candidatePublic = loadPublicSnapshot(runtime, mode.candidatePublic, catalogDirectory);
      candidatePublicVersion = mode.candidatePublic;
      if (mode.baselineSettings !== undefined) {
        baselineSettings = loadSettingsInventory(runtime, mode.baselineSettings, catalogDirectory);
        candidateSettings = loadSettingsInventory(runtime, mode.candidateSettings, catalogDirectory);
      }
    } else {
      const fetchImpl = options.fetchImpl ?? fetch;
      try {
        const aiPayload = await runtime.fetchPublicJson(runtime.endpoints.ai, fetchImpl);
        const modelsPayload = await runtime.fetchPublicJson(runtime.endpoints.models, fetchImpl);
        const llmModelsPayload = await runtime.fetchPublicJson(runtime.endpoints.llm_models, fetchImpl);
        const fetchedAt = (options.now ?? (() => new Date().toISOString()))();
        candidatePublic = runtime.buildSyntxPublicCatalogSnapshot({
          aiPayload,
          llmModelsPayload,
          modelsPayload,
          fetchedAt
        });
      } catch {
        throw new SyntxMaintenanceCliError("PUBLIC_CATALOG_PROBE_FAILED");
      }
      candidatePublicVersion = null;
    }

    const report = runtime.compareSyntxMaintenanceSnapshots({
      baseline_public: baselinePublic,
      candidate_public: candidatePublic,
      ...(baselineSettings === undefined ? {} : { baseline_settings: baselineSettings, candidate_settings: candidateSettings })
    });
    const result = {
      schema_version: "1.0.0",
      operation: mode.kind === "compare" ? "OFFLINE_COMPARE" : "CONFIRMED_PUBLIC_PROBE",
      baseline_public_version: mode.baselinePublic,
      candidate_public_version: candidatePublicVersion,
      baseline_settings_version: mode.kind === "compare" ? mode.baselineSettings ?? null : null,
      candidate_settings_version: mode.kind === "compare" ? mode.candidateSettings ?? null : null,
      report
    };
    writeOutput(options, `${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    throw new SyntxMaintenanceCliError(toSafeErrorCode(error, runtime));
  }
}

async function loadRuntime() {
  const [report, auditPlan, controlWalk, publicHistory, maplessSettings, publicCatalog, publicSync] = await Promise.all([
    import("../dist/src/application/syntx-maintenance-report.js"),
    import("../dist/src/application/syntx-maintenance-audit-plan.js"),
    import("../dist/src/application/syntx-maintenance-control-walk.js"),
    import("../dist/src/catalog/public-catalog-history.js"),
    import("../dist/src/catalog/mapless-settings-inventory.js"),
    import("../dist/src/catalog/syntx-public-catalog.js"),
    import("./sync-public-catalog.mjs")
  ]);
  return {
    compareSyntxMaintenanceSnapshots: report.compareSyntxMaintenanceSnapshots,
    SyntxMaintenanceReportError: report.SyntxMaintenanceReportError,
    buildSyntxMaintenanceAuditPlan: auditPlan.buildSyntxMaintenanceAuditPlan,
    SyntxMaintenanceAuditPlanError: auditPlan.SyntxMaintenanceAuditPlanError,
    buildSyntxMaintenanceControlWalk: controlWalk.buildSyntxMaintenanceControlWalk,
    SyntxMaintenanceControlWalkError: controlWalk.SyntxMaintenanceControlWalkError,
    loadPublicCatalogVersion: publicHistory.loadPublicCatalogVersion,
    loadMaplessSettingsInventoryVersion: maplessSettings.loadMaplessSettingsInventoryVersion,
    buildSyntxPublicCatalogSnapshot: publicCatalog.buildSyntxPublicCatalogSnapshot,
    endpoints: publicCatalog.SYNTX_PUBLIC_CATALOG_ENDPOINTS,
    fetchPublicJson: publicSync.fetchPublicJson
  };
}

function loadPublicSnapshot(runtime, version, catalogDirectory) {
  try {
    return runtime.loadPublicCatalogVersion(version, catalogDirectory);
  } catch {
    throw new SyntxMaintenanceCliError("PUBLIC_CATALOG_ARCHIVE_INVALID");
  }
}

function loadSettingsInventory(runtime, version, catalogDirectory) {
  try {
    return runtime.loadMaplessSettingsInventoryVersion(version, catalogDirectory);
  } catch {
    throw new SyntxMaintenanceCliError("MAPLESS_SETTINGS_ARCHIVE_INVALID");
  }
}

function isSafeCheckpointPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 4096 || path.includes("\0")) return false;
  return !path.split(/[\\/]/u).some((part) => part === "..");
}

function loadCheckpoint(path) {
  let descriptor;
  try {
    const resolvedPath = resolve(path);
    const linkStats = lstatSync(resolvedPath);
    if (linkStats.isSymbolicLink() || !linkStats.isFile()) throw new Error();
    descriptor = openSync(resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size < 1 || stats.size > 1024 * 1024) throw new Error();
    const bytes = Buffer.alloc(stats.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(descriptor, bytes, size, bytes.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size !== stats.size || fstatSync(descriptor).size !== stats.size) throw new Error();
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size));
    return JSON.parse(source);
  } catch {
    throw new SyntxMaintenanceCliError("MAINTENANCE_CHECKPOINT_INVALID");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function toSafeErrorCode(error, runtime) {
  if (typeof error !== "object" || error === null || types.isProxy(error)) {
    return "MAINTENANCE_OPERATION_FAILED";
  }
  const cliCode = readOwnAllowedCode(error, CLI_ERROR_CODES);
  if (error instanceof SyntxMaintenanceCliError && cliCode !== undefined) return cliCode;

  const reportErrorDescriptor = isSafeRecord(runtime)
    ? Object.getOwnPropertyDescriptor(runtime, "SyntxMaintenanceReportError")
    : undefined;
  const reportErrorClass = reportErrorDescriptor && "value" in reportErrorDescriptor
    ? reportErrorDescriptor.value
    : undefined;
  if (typeof reportErrorClass === "function" && error instanceof reportErrorClass) {
    return readOwnAllowedCode(error, REPORT_ERROR_CODES) ?? "MAINTENANCE_OPERATION_FAILED";
  }
  const planErrorDescriptor = isSafeRecord(runtime)
    ? Object.getOwnPropertyDescriptor(runtime, "SyntxMaintenanceAuditPlanError")
    : undefined;
  const planErrorClass = planErrorDescriptor && "value" in planErrorDescriptor
    ? planErrorDescriptor.value
    : undefined;
  if (typeof planErrorClass === "function" && error instanceof planErrorClass) {
    return readOwnAllowedCode(error, PLAN_ERROR_CODES) ?? "MAINTENANCE_OPERATION_FAILED";
  }
  const controlWalkErrorDescriptor = isSafeRecord(runtime)
    ? Object.getOwnPropertyDescriptor(runtime, "SyntxMaintenanceControlWalkError")
    : undefined;
  const controlWalkErrorClass = controlWalkErrorDescriptor && "value" in controlWalkErrorDescriptor
    ? controlWalkErrorDescriptor.value
    : undefined;
  if (typeof controlWalkErrorClass === "function" && error instanceof controlWalkErrorClass) {
    const code = readOwnAllowedCode(error, CONTROL_WALK_ERROR_CODES);
    if (code === "UNSAFE_CHECKPOINT") return "MAINTENANCE_CONTROL_CHECKPOINT_INVALID";
    if (code === "CHECKPOINT_SOURCE_MISMATCH") return "MAINTENANCE_CONTROL_CHECKPOINT_SOURCE_MISMATCH";
    if (code === "CONTROL_CHECKPOINT_LIMIT_EXCEEDED") return "MAINTENANCE_CONTROL_CHECKPOINT_INVALID";
    if (code === "INVALID_INPUT") return "MAINTENANCE_CONTROL_WALK_INVALID";
  }
  return "MAINTENANCE_OPERATION_FAILED";
}

function readOwnAllowedCode(error, allowedCodes) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    if (
      descriptor === undefined ||
      !Object.hasOwn(descriptor, "value") ||
      typeof descriptor.value !== "string" ||
      !allowedCodes.has(descriptor.value)
    ) {
      return undefined;
    }
    return descriptor.value;
  } catch {
    return undefined;
  }
}

function isSafeRecord(value) {
  return typeof value === "object" && value !== null && !types.isProxy(value);
}

function isExactVersion(value) {
  if (typeof value !== "string") return false;
  const match = VERSION_PATTERN.exec(value);
  return match !== null && match[0] === value;
}

function writeOutput(options, text) {
  const writer = options.writeStdout ?? ((value) => process.stdout.write(value));
  writer(text);
}

const USAGE = [
  "Usage:",
  "  syntx-mcp-maintenance --compare --baseline-public VERSION --candidate-public VERSION [--baseline-settings VERSION --candidate-settings VERSION] [--catalog-directory PATH]",
  "  syntx-mcp-maintenance --plan-audit --baseline-public VERSION --candidate-public VERSION [--baseline-settings VERSION --candidate-settings VERSION] [--checkpoint PATH] [--catalog-directory PATH]",
  "  syntx-mcp-maintenance --plan-audit --baseline-public VERSION --candidate-public VERSION --baseline-settings VERSION --candidate-settings VERSION --control-walk [--control-checkpoint PATH] [--catalog-directory PATH]",
  "  syntx-mcp-maintenance --probe-public --baseline-public VERSION --confirm-source-fetch [--catalog-directory PATH]",
  "  syntx-mcp-maintenance --help",
  "Offline compare never fetches. Public probe performs only bounded allowlisted GETs and never archives or changes selectors."
].join("\n");

if (isCliEntrypoint()) {
  main().catch((error) => {
    const code = toSafeErrorCode(error);
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}

function isCliEntrypoint() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  }
}
