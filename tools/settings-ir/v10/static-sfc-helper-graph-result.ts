import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { createImmutableJsonSnapshot } from "../immutable-json-snapshot.js";
import { deriveStaticSfcHelperGraph } from "../v9/static-sfc-helper-graph.js";
import { assertSettingsSourceInventoryMatchesPublicCatalog, serializeSettingsSourceInventory, type SettingsSourceInventory } from "../../../src/catalog/settings-source-inventory.js";
import { serializeSyntxPublicCatalogSnapshot, type SyntxPublicCatalogSnapshot } from "../../../src/catalog/syntx-public-catalog.js";

export const STATIC_SFC_HELPER_GRAPH_RESULT_MAX_BYTES = 4 * 1024 * 1024;
const VERSION = /^sha256-[a-f0-9]{64}\.json$/u;
const SHA = /^sha256:[a-f0-9]{64}$/u;
const FORM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const BODY_LIMIT = 2 * 1024 * 1024;
const SETTINGS_PREFIX = "/src/components/chat/forms/settings/";
const JS_TYPES = new Set(["application/javascript", "application/x-javascript", "text/javascript"]);
const MAP_TYPES = new Set(["application/json", "application/octet-stream"]);

const nodeSchema = z.object({ module_name: z.string().min(1).max(300), source_path: z.string().min(1).max(2_000), source_content_sha256: z.string().regex(SHA), relation: z.enum(["DIRECT_IMPORT", "PROVIDER_ROOT"]) }).strict();
const importSchema = z.object({ specifier: z.string().min(1).max(2_000), kind: z.enum(["IMPORT_DECLARATION", "DYNAMIC_IMPORT"]), locator: z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict() }).strict();
const graphSchema = z.object({ profile: z.literal("STATIC_SFC_HELPER_GRAPH_V1"), form_id: z.string().regex(FORM), provider_source_sha256: z.string().regex(SHA), nodes: z.array(nodeSchema).max(512), unresolved_imports: z.array(importSchema).max(512), blockers: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u)).max(512), runtime_usable: z.literal(false), vendor_code_executed: z.literal(false), source_persisted: z.literal(false) }).strict();
const artifactSchema = z.object({ role: z.literal("PROVIDER_FORM"), kind: z.enum(["JAVASCRIPT", "SOURCE_MAP_V3"]), module_name: z.string().min(1).max(300), form_id: z.string().regex(FORM), url: z.string().url(), content_type: z.string().min(1).max(200), bytes: z.number().int().positive(), sha256: z.string().regex(SHA), source_map: z.unknown() }).strict();
const schema = z.object({ schema_version: z.literal(1), kind: z.literal("STATIC_SFC_HELPER_GRAPH_RESULT"), public_version: z.string().regex(VERSION), settings_version: z.string().regex(VERSION), observed_at: z.iso.datetime(), build_id: z.string().regex(/^\d{6,20}$/u), form_id: z.string().regex(FORM), provider_source_path: z.string().regex(/^\/src\/components\/chat\/forms\/settings\/[a-z0-9]+(?:-[a-z0-9]+)*\.vue$/u), provider_source_sha256: z.string().regex(SHA), provider: z.object({ javascript: artifactSchema, source_map: artifactSchema }).strict(), graph: graphSchema, runtime_usable: z.literal(false), vendor_code_executed: z.literal(false), source_persisted: z.literal(false) }).strict();
export type StaticSfcHelperGraphResultV10 = z.infer<typeof schema>;
export interface ProviderSourceBundleV10 { readonly javascript: Uint8Array; readonly sourceMap: Uint8Array; readonly providerSource: string; }

export function validateStaticSfcHelperGraphResult(value: unknown, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot): StaticSfcHelperGraphResultV10 {
  const result = schema.parse(value);
  assertSettingsSourceInventoryMatchesPublicCatalog(inventory, publicCatalog);
  const pv = `sha256-${digest(Buffer.from(serializeSyntxPublicCatalogSnapshot(publicCatalog)))}.json`;
  const sv = `sha256-${digest(Buffer.from(serializeSettingsSourceInventory(inventory)))}.json`;
  if (result.public_version !== pv || result.settings_version !== sv || result.build_id !== inventory.build.id || result.graph.form_id !== result.form_id || result.provider_source_sha256 !== result.graph.provider_source_sha256) throw new Error("STATIC_SFC_GRAPH_BINDING_MISMATCH");
  const expected = providerPair(inventory, result.form_id);
  if (canonical(result.provider.javascript) !== canonical(expected.javascript) || canonical(result.provider.source_map) !== canonical(expected.source_map)) throw new Error("STATIC_SFC_GRAPH_PROVIDER_MISMATCH");
  if (result.provider_source_path !== `${SETTINGS_PREFIX}${result.form_id}.vue`) throw new Error("STATIC_SFC_GRAPH_PROVIDER_PATH_INVALID");
  const root = result.graph.nodes.find((node) => node.relation === "PROVIDER_ROOT");
  if (!root || root.source_path !== result.provider_source_path || root.source_content_sha256 !== result.provider_source_sha256) throw new Error("STATIC_SFC_GRAPH_ROOT_MISMATCH");
  return result;
}

export function serializeStaticSfcHelperGraphResult(result: StaticSfcHelperGraphResultV10): string { return `${JSON.stringify(schema.parse(result), null, 2)}\n`; }

export async function archiveStaticSfcHelperGraphResult(result: StaticSfcHelperGraphResultV10, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot, projectRoot: string): Promise<{ version: string; path: string; status: "created" | "existing" }> {
  const bytes = Buffer.from(serializeStaticSfcHelperGraphResult(validateStaticSfcHelperGraphResult(result, inventory, publicCatalog)));
  if (bytes.length > STATIC_SFC_HELPER_GRAPH_RESULT_MAX_BYTES) throw new Error("STATIC_SFC_GRAPH_RESULT_TOO_LARGE");
  const directory = join(resolve(projectRoot), "catalog", "runtime", "v10"); await mkdir(directory, { recursive: true }); assertDirectory(directory);
  const version = `sha256-${digest(bytes)}.json`; const path = join(directory, version); let status: "created" | "existing" = "created";
  try { await createImmutableJsonSnapshot(path, bytes.toString("utf8"), { maxBytes: STATIC_SFC_HELPER_GRAPH_RESULT_MAX_BYTES }); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "IMMUTABLE_SNAPSHOT_TARGET_EXISTS")) throw error; status = "existing"; }
  if (!readRegular(path).equals(bytes)) throw new Error("STATIC_SFC_GRAPH_RESULT_COLLISION"); return { version, path, status };
}

export function loadStaticSfcHelperGraphResult(version: string, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot, projectRoot: string): StaticSfcHelperGraphResultV10 {
  if (!VERSION.test(version)) throw new Error("STATIC_SFC_GRAPH_VERSION_INVALID"); const bytes = readRegular(join(resolve(projectRoot), "catalog", "runtime", "v10", version)); if (`sha256-${digest(bytes)}.json` !== version) throw new Error("STATIC_SFC_GRAPH_HASH_MISMATCH");
  try { return validateStaticSfcHelperGraphResult(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), inventory, publicCatalog); } catch (error) { if (error instanceof SyntaxError) throw new Error("STATIC_SFC_GRAPH_JSON_INVALID"); throw error; }
}

export async function fetchProviderSourceBundleV10(formId: string, inventory: SettingsSourceInventory, options: { readonly confirmedSourceFetch: true; readonly fetchImpl?: typeof fetch; readonly absoluteTimeoutMs?: number }): Promise<ProviderSourceBundleV10> {
  if (!FORM.test(formId) || options?.confirmedSourceFetch !== true) throw new Error("STATIC_SFC_GRAPH_SOURCE_FETCH_NOT_CONFIRMED"); const pair = providerPair(inventory, formId); const fetchImpl = options.fetchImpl ?? globalThis.fetch; if (typeof fetchImpl !== "function") throw new Error("STATIC_SFC_GRAPH_SOURCE_FETCH_FAILED");
  const deadline = Date.now() + Math.min(options.absoluteTimeoutMs ?? 30_000, 30_000); const get = async (artifact: z.infer<typeof artifactSchema>) => { if (Date.now() >= deadline) throw new Error("STATIC_SFC_GRAPH_SOURCE_TIMEOUT"); let response: Response; try { response = await fetchImpl(artifact.url, { method: "GET", redirect: "manual", credentials: "omit", headers: { accept: artifact.kind === "JAVASCRIPT" ? "application/javascript,text/javascript" : "application/json,application/octet-stream", "accept-encoding": "identity" } }); } catch { throw new Error("STATIC_SFC_GRAPH_SOURCE_FETCH_FAILED"); } if (!response.ok || response.redirected || response.url !== artifact.url) throw new Error("STATIC_SFC_GRAPH_SOURCE_FETCH_FAILED"); const type = (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase(); if (!((artifact.kind === "JAVASCRIPT" ? JS_TYPES : MAP_TYPES).has(type))) throw new Error("STATIC_SFC_GRAPH_SOURCE_MEDIA_INVALID"); const reader = response.body?.getReader(); if (!reader) throw new Error("STATIC_SFC_GRAPH_SOURCE_FETCH_FAILED"); const chunks: Uint8Array[] = []; let total = 0; try { for (;;) { const next = await reader.read(); if (next.done) break; total += next.value.byteLength; if (total > BODY_LIMIT || total !== artifact.bytes && total > artifact.bytes) throw new Error("STATIC_SFC_GRAPH_SOURCE_TOO_LARGE"); chunks.push(next.value); } } finally { reader.releaseLock(); } const bytes = Buffer.concat(chunks.map((x) => Buffer.from(x))); if (bytes.length !== artifact.bytes || `sha256:${digest(bytes)}` !== artifact.sha256) throw new Error("STATIC_SFC_GRAPH_SOURCE_DRIFT"); return bytes; };
  const javascript = await get(pair.javascript); const sourceMap = await get(pair.source_map); let map: any; try { map = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sourceMap)); } catch { throw new Error("STATIC_SFC_GRAPH_SOURCE_MAP_INVALID"); } const expected = pair.source_map.source_map as { source_count: number; sources_content_count: number; settings_sources: Array<{ source_index: number; source_path: string; source_content_sha256: string }> } | null; if (!expected || map.version !== 3 || map.sources?.length !== expected.source_count || map.sourcesContent?.length !== expected.sources_content_count) throw new Error("STATIC_SFC_GRAPH_SOURCE_MAP_INVALID"); const declaration = expected.settings_sources.find((item) => item.source_path === `${SETTINGS_PREFIX}${formId}.vue`); const index = declaration?.source_index; if (index === undefined || typeof map.sourcesContent?.[index] !== "string") throw new Error("STATIC_SFC_GRAPH_PROVIDER_SOURCE_MISSING"); const providerSource = map.sourcesContent[index]; if (`sha256:${digest(Buffer.from(providerSource, "utf8"))}` !== declaration!.source_content_sha256) throw new Error("STATIC_SFC_GRAPH_SOURCE_DRIFT"); return { javascript, sourceMap, providerSource };
}

export function makeStaticSfcHelperGraphResultV10(formId: string, providerSource: string, inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot, bundle: ProviderSourceBundleV10, observedAt = new Date().toISOString()): StaticSfcHelperGraphResultV10 {
  const pair = providerPair(inventory, formId); const providerPath = `${SETTINGS_PREFIX}${formId}.vue`; const graph = deriveStaticSfcHelperGraph({ formId, providerSourcePath: providerPath, providerSource, inventory }); void bundle; return { schema_version: 1, kind: "STATIC_SFC_HELPER_GRAPH_RESULT", public_version: `sha256-${digest(Buffer.from(serializeSyntxPublicCatalogSnapshot(publicCatalog)))}.json`, settings_version: `sha256-${digest(Buffer.from(serializeSettingsSourceInventory(inventory)))}.json`, observed_at: observedAt, build_id: inventory.build.id, form_id: formId, provider_source_path: providerPath, provider_source_sha256: graph.provider_source_sha256, provider: pair, graph: graph as unknown as StaticSfcHelperGraphResultV10["graph"], runtime_usable: false, vendor_code_executed: false, source_persisted: false };
}

function providerPair(inventory: SettingsSourceInventory, formId: string): { javascript: z.infer<typeof artifactSchema>; source_map: z.infer<typeof artifactSchema> } { const list = inventory.source_artifacts.filter((a) => a.role === "PROVIDER_FORM" && a.form_id === formId); const javascript = list.find((a) => a.kind === "JAVASCRIPT"); const source_map = list.find((a) => a.kind === "SOURCE_MAP_V3"); if (!javascript || !source_map) throw new Error("STATIC_SFC_GRAPH_PROVIDER_NOT_DECLARED"); return { javascript: artifactSchema.parse(javascript), source_map: artifactSchema.parse(source_map) }; }
function digest(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`; return JSON.stringify(value); }
function assertDirectory(path: string): void { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("STATIC_SFC_GRAPH_DIRECTORY_UNSAFE"); }
function readRegular(path: string): Buffer { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); try { const before = fstatSync(fd); if (!before.isFile() || before.size < 1 || before.size > STATIC_SFC_HELPER_GRAPH_RESULT_MAX_BYTES) throw new Error("STATIC_SFC_GRAPH_FILE_INVALID"); const out = Buffer.alloc(before.size); let pos = 0; while (pos < out.length) { const n = readSync(fd, out, pos, out.length - pos, null); if (!n) break; pos += n; } const after = fstatSync(fd); if (pos !== before.size || after.size !== before.size) throw new Error("STATIC_SFC_GRAPH_READ_CHANGED"); return out; } finally { closeSync(fd); } }
