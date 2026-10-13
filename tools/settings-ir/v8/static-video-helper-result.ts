import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { createImmutableJsonSnapshot } from "../immutable-json-snapshot.js";
import { derivePinnedHelperScopeFromInventory } from "../v6/pinned-helper-bundle.js";
import { assertSettingsSourceInventoryMatchesPublicCatalog, serializeSettingsSourceInventory, type SettingsSourceInventory } from "../../../src/catalog/settings-source-inventory.js";
import { serializeSyntxPublicCatalogSnapshot, type SyntxPublicCatalogSnapshot } from "../../../src/catalog/syntx-public-catalog.js";

export const VIDEO_HELPER_RESULT_MAX_BYTES = 4 * 1024 * 1024;
const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const SHA = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const locator = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const record = z.discriminatedUnion("status", [
  z.object({ scope: z.string().min(1).max(200), name: z.string().min(1).max(200), exported: z.boolean(), locator, status: z.literal("STATIC_VALUE"), value: z.json() }).strict(),
  z.object({ scope: z.string().min(1).max(200), name: z.string().min(1).max(200), exported: z.boolean(), locator, status: z.literal("BLOCKED"), blocker: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u) }).strict()
]);
const constantsSchema = z.object({ profile: z.literal("STATIC_ESM_CONSTANTS_V1"), proof_scope: z.literal("DECLARATION_INITIALIZERS_ONLY"), runtime_usable: z.literal(false), vendor_code_executed: z.literal(false), source_persisted: z.literal(false), records: z.array(record).max(512) }).strict();
const scope = z.object({ role: z.literal("DIRECT_SETTINGS_HELPER"), form_id: z.null(), module_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u), build: z.object({ id: z.string().regex(/^\d{6,20}$/u), base_url: z.string().url() }).strict(), javascript: z.unknown(), source_map: z.unknown() }).strict();
const source = z.object({ source_index: z.number().int().nonnegative(), source_path: z.string().min(1).max(2000), source_content_sha256: SHA, local_function_scopes: z.enum(["NOT_REQUESTED", "COMPILED", "SKIPPED_NOT_A_FUNCTION_DECLARATION"]), constants: constantsSchema }).strict();
const schema = z.object({ schema_version: z.literal(1), kind: z.literal("VIDEO_HELPER_STATIC_EXTRACTION"), public_version: z.string().regex(VERSION), settings_version: z.string().regex(VERSION), observed_at: z.iso.datetime(), build_id: z.string().regex(/^\d{6,20}$/u), runtime_usable: z.literal(false), closure: z.literal("OPEN"), model_binding: z.literal("NOT_PROVEN"), proof_scope: z.literal("DECLARATION_INITIALIZERS_ONLY"), modules: z.array(z.object({ module_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u), scope, sources: z.array(source).min(1).max(500) }).strict()).min(1).max(500) }).strict();
export type StaticVideoHelperResult = z.infer<typeof schema>;

export function validateStaticVideoHelperResult(value: unknown, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot): StaticVideoHelperResult {
  const result = schema.parse(value);
  assertSettingsSourceInventoryMatchesPublicCatalog(inventory, publicCatalog);
  if (result.public_version !== `sha256-${digest(Buffer.from(serializeSyntxPublicCatalogSnapshot(publicCatalog)))}.json` || result.settings_version !== `sha256-${digest(Buffer.from(serializeSettingsSourceInventory(inventory)))}.json` || result.build_id !== inventory.build.id) throw new Error("VIDEO_HELPER_RESULT_BINDING_MISMATCH");
  const names = new Set<string>();
  for (const item of result.modules) {
    if (names.has(item.module_name)) throw new Error("VIDEO_HELPER_RESULT_DUPLICATE_MODULE");
    names.add(item.module_name);
    const expected = derivePinnedHelperScopeFromInventory(inventory, item.module_name);
    if (canonical(item.scope) !== canonical(expected)) throw new Error("VIDEO_HELPER_RESULT_SCOPE_MISMATCH");
    const expectedSources = expected.source_map.source_map!.settings_sources;
    if (item.sources.length !== expectedSources.length) throw new Error("VIDEO_HELPER_RESULT_SOURCE_MISMATCH");
    for (const [index, actual] of item.sources.entries()) {
      const pinned = expectedSources[index]!;
      if (actual.source_index !== pinned.source_index || actual.source_path !== pinned.source_path || actual.source_content_sha256 !== pinned.source_content_sha256) throw new Error("VIDEO_HELPER_RESULT_SOURCE_MISMATCH");
    }
  }
  return result;
}
export function serializeStaticVideoHelperResult(result: StaticVideoHelperResult): string { return `${JSON.stringify(schema.parse(result), null, 2)}\n`; }
export async function archiveStaticVideoHelperResult(result: StaticVideoHelperResult, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot, projectRoot: string): Promise<{version:string;path:string;status:"created"|"existing"}> {
  const bytes = Buffer.from(serializeStaticVideoHelperResult(validateStaticVideoHelperResult(result, inventory, publicCatalog)));
  if (bytes.length > VIDEO_HELPER_RESULT_MAX_BYTES) throw new Error("VIDEO_HELPER_RESULT_TOO_LARGE");
  const directory = join(resolve(projectRoot), "catalog", "runtime", "v8");
  await mkdir(directory, { recursive: true });
  assertDirectory(directory);
  const version = `sha256-${digest(bytes)}.json`; const path = join(directory, version); let status: "created"|"existing" = "created";
  try { await createImmutableJsonSnapshot(path, bytes.toString("utf8"), { maxBytes: VIDEO_HELPER_RESULT_MAX_BYTES }); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "IMMUTABLE_SNAPSHOT_TARGET_EXISTS")) throw error; status = "existing"; }
  if (!readRegular(path).equals(bytes)) throw new Error("VIDEO_HELPER_RESULT_COLLISION");
  return { version, path, status };
}
export function loadStaticVideoHelperResult(version: string, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot, projectRoot: string): StaticVideoHelperResult {
  if (!VERSION.test(version)) throw new Error("VIDEO_HELPER_RESULT_VERSION_INVALID");
  const bytes = readRegular(join(resolve(projectRoot), "catalog", "runtime", "v8", version));
  if (`sha256-${digest(bytes)}.json` !== version) throw new Error("VIDEO_HELPER_RESULT_HASH_MISMATCH");
  return validateStaticVideoHelperResult(JSON.parse(new TextDecoder("utf-8", {fatal:true}).decode(bytes)), inventory, publicCatalog);
}
function digest(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`; return JSON.stringify(value); }
function assertDirectory(path: string): void { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("VIDEO_HELPER_RESULT_DIRECTORY_UNSAFE"); }
function readRegular(path: string): Buffer { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); try { const before = fstatSync(fd); if (!before.isFile() || before.size < 1 || before.size > VIDEO_HELPER_RESULT_MAX_BYTES) throw new Error("VIDEO_HELPER_RESULT_FILE_INVALID"); const out = Buffer.alloc(before.size); let pos = 0; while (pos < out.length) { const n = readSync(fd, out, pos, out.length - pos, null); if (!n) break; pos += n; } const after = fstatSync(fd); if (pos !== before.size || after.size !== before.size) throw new Error("VIDEO_HELPER_RESULT_READ_CHANGED"); return out; } finally { closeSync(fd); } }
