import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { createImmutableJsonSnapshot } from "../immutable-json-snapshot.js";
import { derivePinnedHelperScope } from "./pinned-helper-bundle.js";
import { assertSettingsSourceInventoryMatchesPublicCatalog, serializeSettingsSourceInventory, type SettingsSourceInventory } from "../../../src/catalog/settings-source-inventory.js";
import { serializeSyntxPublicCatalogSnapshot, type SyntxPublicCatalogSnapshot } from "../../../src/catalog/syntx-public-catalog.js";

export const HELPER_RESULT_MAX_BYTES = 2 * 1024 * 1024;
export const HELPER_MODULES = ["video.js", "useLuma.js"] as const;
export const HELPER_SOURCE_PATHS = {
  "video.js": ["/src/components/chat/forms/settings/data/hailuo/constants.js"],
  "useLuma.js": [
    "/src/components/chat/forms/settings/data/luma-image/payload.ts",
    "/src/components/chat/forms/settings/composables/useLuma.js"
  ]
} as const;
const versionSchema = z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u);
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const identifier = z.string().min(1).max(200).regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/u);
const recordBase = {
  scope: identifier, name: identifier, exported: z.boolean(),
  locator: z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict()
};
const recordSchema = z.discriminatedUnion("status", [
  z.object({ ...recordBase, status: z.literal("STATIC_VALUE"), value: z.json() }).strict(),
  z.object({ ...recordBase, status: z.literal("BLOCKED"), blocker: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u) }).strict()
]);
const constantsSchema = z.object({
  profile: z.literal("STATIC_ESM_CONSTANTS_V1"),
  proof_scope: z.literal("DECLARATION_INITIALIZERS_ONLY"), runtime_usable: z.literal(false),
  vendor_code_executed: z.literal(false), source_persisted: z.literal(false),
  records: z.array(recordSchema).max(512)
}).strict();
const resultSchema = z.object({
  schema_version: z.literal(1), kind: z.literal("HELPER_CONSTANT_INITIALIZERS"),
  public_version: versionSchema, settings_version: versionSchema,
  observed_at: z.iso.datetime(), build_id: z.string().regex(/^\d{6,20}$/u),
  runtime_usable: z.literal(false), closure: z.literal("OPEN"),
  model_binding: z.literal("NOT_PROVEN"), root_forms_compiled: z.literal(false),
  toolchain: z.object({
    scope: z.literal("RECORDED_FILES_ONLY"), typescript_version: z.string().max(100),
    files: z.array(z.object({ path: z.string().min(1).max(250), sha256: sha }).strict()).min(1).max(40)
  }).strict(),
  modules: z.array(z.object({
    module_name: z.enum(HELPER_MODULES),
    // Exact artifact DTO is independently compared with the validated inventory.
    scope: z.unknown(),
    sources: z.array(z.object({
      source_index: z.number().int().nonnegative(), source_path: z.string().min(1).max(2000),
      source_content_sha256: sha,
      local_function_scopes: z.enum(["NOT_REQUESTED", "COMPILED", "SKIPPED_NOT_A_FUNCTION_DECLARATION"]),
      constants: constantsSchema
    }).strict()).min(1).max(8)
  }).strict()).length(2)
}).strict();
export type HelperConstantsResult = z.infer<typeof resultSchema>;

/** Structural/provenance validation, NOT a recompile or proof of source semantics. */
export function validateHelperConstantsResult(value: unknown, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot): HelperConstantsResult {
  checkJsonLimits(value);
  const result = resultSchema.parse(value);
  assertSettingsSourceInventoryMatchesPublicCatalog(inventory, publicCatalog);
  if (result.settings_version !== `sha256-${digest(Buffer.from(serializeSettingsSourceInventory(inventory)))}.json` || result.public_version !== `sha256-${digest(Buffer.from(serializeSyntxPublicCatalogSnapshot(publicCatalog)))}.json`) throw new Error("HELPER_RESULT_BINDING_MISMATCH");
  if (result.build_id !== inventory.build.id) throw new Error("HELPER_RESULT_BINDING_MISMATCH");
  for (const [index, name] of HELPER_MODULES.entries()) {
    const item = result.modules[index]!;
    const expected = derivePinnedHelperScope(inventory, name);
    if (item.module_name !== name || canonical(item.scope) !== canonical(expected)) throw new Error("HELPER_RESULT_SCOPE_MISMATCH");
    const identities = expected.source_map.source_map!.settings_sources;
    if (item.sources.length !== identities.length || identities.length !== HELPER_SOURCE_PATHS[name].length) throw new Error("HELPER_RESULT_SCOPE_CHANGED");
    for (const [i, identity] of identities.entries()) {
      const source = item.sources[i]!;
      if (source.source_index !== identity.source_index || source.source_path !== identity.source_path || source.source_content_sha256 !== identity.source_content_sha256 || source.source_path !== HELPER_SOURCE_PATHS[name][i]) throw new Error("HELPER_RESULT_SOURCE_MISMATCH");
      const seen = new Set<string>();
      for (const record of source.constants.records) {
        const key = `${record.scope}:${record.name}`;
        if (seen.has(key) || (record.scope !== "module" && !(name === "useLuma.js" && i === 1 && record.scope === "useLumaSettings"))) throw new Error("HELPER_RESULT_RECORD_INVALID");
        seen.add(key);
      }
    }
  }
  const files = result.toolchain.files.map((item) => item.path);
  if (new Set(files).size !== files.length || files.some((path) => !/^(?:tools|src|scripts|dist)\/[A-Za-z0-9_./-]+\.(?:ts|js|mjs)$/u.test(path) || path.split("/").includes(".."))) throw new Error("HELPER_RESULT_TOOLCHAIN_INVALID");
  return result;
}

export function serializeHelperConstantsResult(result: HelperConstantsResult): string {
  checkJsonLimits(result);
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function archiveHelperConstantsResult(result: HelperConstantsResult, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot, projectRoot: string): Promise<{version:string; path:string; status:"created"|"existing"}> {
  const validated = validateHelperConstantsResult(result, inventory, publicCatalog);
  const bytes = Buffer.from(serializeHelperConstantsResult(validated));
  if (bytes.length > HELPER_RESULT_MAX_BYTES) throw new Error("HELPER_RESULT_TOO_LARGE");
  const directory = await resultDirectory(projectRoot, true);
  const version = `sha256-${digest(bytes)}.json`;
  const path = join(directory, version);
  let status: "created" | "existing" = "created";
  try {
    await createImmutableJsonSnapshot(path, bytes.toString("utf8"), { maxBytes: HELPER_RESULT_MAX_BYTES });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "IMMUTABLE_SNAPSHOT_TARGET_EXISTS")) throw error;
    status = "existing";
  }
  if (!readRegular(path).equals(bytes)) throw new Error("HELPER_RESULT_COLLISION");
  await syncDirectory(directory);
  return {version, path, status};
}

export async function loadHelperConstantsResult(version: string, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot, projectRoot: string): Promise<HelperConstantsResult> {
  if (!versionSchema.safeParse(version).success) throw new Error("HELPER_RESULT_VERSION_INVALID");
  const bytes = readRegular(join(await resultDirectory(projectRoot, false), version));
  if (`sha256-${digest(bytes)}.json` !== version) throw new Error("HELPER_RESULT_HASH_MISMATCH");
  return validateHelperConstantsResult(JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(bytes)), inventory, publicCatalog);
}

function checkJsonLimits(value: unknown): void {
  const pending = [{value, depth:0}];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++count > 40000 || current.depth > 40) throw new Error("HELPER_RESULT_TOO_LARGE");
    const item = current.value;
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("HELPER_RESULT_JSON_INVALID");
    if (typeof item === "string" && item.length > 32000) throw new Error("HELPER_RESULT_TOO_LARGE");
    if (item !== null && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("HELPER_RESULT_JSON_INVALID");
        pending.push({value:child, depth:current.depth+1});
      }
    } else if (!["string", "number", "boolean"].includes(typeof item) && item !== null) throw new Error("HELPER_RESULT_JSON_INVALID");
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
function readRegular(path: string): Buffer {
  let handle;
  try { handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error("HELPER_RESULT_MISSING");
    throw error;
  }
  try {
    const before = fstatSync(handle);
    if (!before.isFile() || before.size < 1 || before.size > HELPER_RESULT_MAX_BYTES) throw new Error("HELPER_RESULT_FILE_INVALID");
    const bytes = Buffer.alloc(before.size+1);
    let size = 0;
    while (size < bytes.length) {
      const n = readSync(handle, bytes, size, bytes.length-size, null);
      if (n === 0) break;
      size += n;
    }
    const after = fstatSync(handle);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("HELPER_RESULT_READ_CHANGED");
    return bytes.subarray(0,size);
  } finally { closeSync(handle); }
}
async function resultDirectory(root: string, create: boolean): Promise<string> {
  let path = resolve(root);
  assertDirectory(path);
  for (const segment of ["catalog", "runtime", "v6"]) {
    const parent = path;
    path = join(path,segment);
    if (create) {
      try { await mkdir(path); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
    }
    assertDirectory(path);
    if (create) await syncDirectory(parent);
  }
  return path;
}
function assertDirectory(path: string): void {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new Error("HELPER_RESULT_MISSING");
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("HELPER_RESULT_DIRECTORY_UNSAFE");
}
async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { await handle.sync(); } finally { await handle.close(); }
}
function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
