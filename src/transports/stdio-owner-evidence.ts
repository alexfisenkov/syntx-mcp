#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultApplication } from "../application/factory.js";
import { videoEvidenceOutputSchema, type VideoEvidenceOutput, type VideoEvidenceQuery } from "../mcp/video-evidence-tool.js";
import { isMainModule } from "./is-main.js";
import { runStdioServer } from "./stdio.js";

const PUBLIC_ARCHIVE = "catalog/public/sha256-666d92aa4baa59ae21c210f9296a23ef73a01f4a2af0ce7e4e3d9fa9c55e6293.json";
const SETTINGS_ARCHIVE = "catalog/settings/sha256-38887915375c724b247ebe82e111b30f88c60c41f7d3e864bb43b4b38988cdec.json";
const V8_ARCHIVE = "catalog/runtime/v8/sha256-5d16913f579e8221c252ac878cdd3669f2aebdd9e5c667cf1258ab60e8cf1441.json";
const V10_ARCHIVES = [
  "catalog/runtime/v10/sha256-20ae819e243d39101570b6b9a4711a7ff3da87b3ccdb64a555c05ef377bbb135.json",
  "catalog/runtime/v10/sha256-f1a2ff324aea572a4e92630caeec2f9d08902e49f0bb2b4c6a06d73885a3c110.json"
] as const;
const EXPECTED_PUBLIC_VERSION = "sha256-666d92aa4baa59ae21c210f9296a23ef73a01f4a2af0ce7e4e3d9fa9c55e6293.json";
const EXPECTED_SETTINGS_VERSION = "sha256-38887915375c724b247ebe82e111b30f88c60c41f7d3e864bb43b4b38988cdec.json";
const EXPECTED_BUILD_ID = "1789134564";

type JsonRecord = Record<string, unknown>;
type Archives = { v8: JsonRecord; v10: JsonRecord[] };

function packageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  while (current !== dirname(current)) {
    try {
      const manifest = JSON.parse(readFileSync(join(current, "package.json"), "utf8")) as JsonRecord;
      if (manifest.name === "syntx-mcp") return current;
    } catch { /* Continue only through trusted package-relative parents. */ }
    current = dirname(current);
  }
  throw new Error("VIDEO_EVIDENCE_ARCHIVE_DRIFT: package root not found.");
}

function loadJson(relativePath: string): JsonRecord {
  try {
    const bytes = readFileSync(resolve(packageRoot(), relativePath));
    const expectedHash = relativePath.match(/sha256-([a-f0-9]{64})\.json$/u)?.[1];
    if (expectedHash === undefined || createHash("sha256").update(bytes).digest("hex") !== expectedHash) {
      throw new Error("content hash mismatch");
    }
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as JsonRecord;
  } catch {
    throw new Error(`VIDEO_EVIDENCE_ARCHIVE_UNAVAILABLE: ${relativePath}`);
  }
}

function stringField(value: JsonRecord, key: string): string {
  const field = value[key];
  if (typeof field !== "string" || field.length === 0) throw new Error(`VIDEO_EVIDENCE_ARCHIVE_DRIFT: ${key}`);
  return field;
}

function loadArchives(): Archives {
  const publicArchive = loadJson(PUBLIC_ARCHIVE);
  const settingsArchive = loadJson(SETTINGS_ARCHIVE);
  const v8 = loadJson(V8_ARCHIVE);
  const v10 = V10_ARCHIVES.map(loadJson);
  if (publicArchive.schema_version !== "1.0.0" || settingsArchive.schema_version !== "1.0.0") {
    throw new Error("VIDEO_EVIDENCE_ARCHIVE_DRIFT: catalog schema version");
  }
  if (stringField(v8, "public_version") !== EXPECTED_PUBLIC_VERSION || stringField(v8, "settings_version") !== EXPECTED_SETTINGS_VERSION || stringField(v8, "build_id") !== EXPECTED_BUILD_ID) {
    throw new Error("VIDEO_EVIDENCE_ARCHIVE_DRIFT: v8 binding");
  }
  for (const archive of v10) {
    if (stringField(archive, "public_version") !== EXPECTED_PUBLIC_VERSION || stringField(archive, "settings_version") !== EXPECTED_SETTINGS_VERSION || stringField(archive, "build_id") !== EXPECTED_BUILD_ID) {
      throw new Error("VIDEO_EVIDENCE_ARCHIVE_DRIFT: v10 binding");
    }
  }
  return { v8, v10 };
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

export function resolveOwnerVideoEvidence(query: VideoEvidenceQuery = {}): VideoEvidenceOutput {
  const archives = loadArchives();
  const v10Matches = archives.v10.filter((archive) => archive.form_id === query.form_id || query.form_id === undefined);
  const knownForms = archives.v10.map((archive) => archive.form_id).filter((form): form is string => typeof form === "string");
  const v8Modules = asRecords(archives.v8.modules);
  const knownModules = [...v8Modules.map((module) => module.module_name), ...v10Matches.flatMap((archive) => asRecords((archive.graph as JsonRecord | undefined)?.nodes).map((node) => node.module_name))].filter((name): name is string => typeof name === "string");
  if (query.form_id !== undefined && !knownForms.includes(query.form_id)) throw new Error("Unknown video evidence selector: form_id.");
  if (query.module_name !== undefined && !knownModules.includes(query.module_name)) throw new Error("Unknown video evidence selector: module_name.");

  const evidenceRecords: JsonRecord[] = [];
  for (const module of v8Modules) {
    if (query.form_id === "veo-3" && !["constants.js", "quality.js"].includes(String(module.module_name))) continue;
    if (query.form_id === "seedance" && module.module_name !== "constants2.js") continue;
    if (query.module_name !== undefined && module.module_name !== query.module_name) continue;
    const sources = asRecords(module.sources);
    for (const source of sources) {
      for (const record of asRecords((source.constants as JsonRecord | undefined)?.records)) {
        const output: JsonRecord = { scope: String(record.scope ?? "module"), name: String(record.name), exported: record.exported === true, locator: record.locator, status: record.status };
        if ("value" in record) output.value = record.value;
        if ("blocker" in record) output.blocker = record.blocker;
        evidenceRecords.push(output);
      }
    }
  }
  const nodes: JsonRecord[] = [];
  const blockers = new Set<string>();
  for (const archive of v10Matches) {
    for (const node of asRecords((archive.graph as JsonRecord | undefined)?.nodes)) {
      if (query.module_name === undefined || node.module_name === query.module_name) nodes.push(node);
    }
    const archiveBlockers = (archive.graph as JsonRecord | undefined)?.blockers;
    for (const blocker of (Array.isArray(archiveBlockers) ? archiveBlockers : []).map((item) => item && typeof item === "object" ? (item as JsonRecord).code : item)) {
      if (typeof blocker === "string") blockers.add(blocker);
    }
  }
  for (const record of evidenceRecords) if (record.status === "BLOCKED" && typeof record.blocker === "string") blockers.add(record.blocker);
  const result = { schema_version: 1, kind: "VIDEO_EVIDENCE", public_version: EXPECTED_PUBLIC_VERSION, settings_version: EXPECTED_SETTINGS_VERSION, build_id: EXPECTED_BUILD_ID, runtime_usable: false, form_id: query.form_id ?? null, module_name: query.module_name ?? null, evidence_records: evidenceRecords, nodes, blockers: [...blockers].sort() };
  return videoEvidenceOutputSchema.parse(result);
}

export async function runOwnerEvidenceStdioServer(): Promise<void> {
  loadArchives();
  await runStdioServer(createDefaultApplication(), { videoEvidence: { resolveEvidence: resolveOwnerVideoEvidence } });
}

if (isMainModule(import.meta.url)) {
  runOwnerEvidenceStdioServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown startup error";
    console.error(`Failed to start owner evidence stdio MCP server: ${message}`);
    process.exitCode = 1;
  });
}
