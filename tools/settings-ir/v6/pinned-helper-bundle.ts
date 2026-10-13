import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { z } from "zod/v4";
import {
  settingsSourceInventorySchema,
  type SettingsSourceArtifact,
  type SettingsSourceInventory
} from "../../../src/catalog/settings-source-inventory.js";

const MAX_BODY_BYTES = 1_048_576;
const MAX_TOTAL_BYTES = 2 * MAX_BODY_BYTES;
const MAX_TIMEOUT_MS = 60_000;
const SETTINGS_PREFIX = "/src/components/chat/forms/settings/";
const MODULES = ["video.js", "useLuma.js"] as const;
const JS_MEDIA = ["application/javascript", "application/x-javascript", "text/javascript"];
const MAP_MEDIA = ["application/json", "application/octet-stream"];
const ERROR_CODES = [
  "SETTINGS_V6_HELPER_SOURCE_INVALID",
  "SETTINGS_V6_HELPER_SOURCE_DRIFT",
  "SETTINGS_V6_HELPER_SOURCE_FETCH_NOT_CONFIRMED",
  "SETTINGS_V6_HELPER_SOURCE_FETCH_FAILED",
  "SETTINGS_V6_HELPER_SOURCE_TIMEOUT",
  "SETTINGS_V6_HELPER_SOURCE_ABORTED"
] as const;

export type SettingsV6HelperSourceErrorCode = typeof ERROR_CODES[number];
export class SettingsV6HelperSourceError extends Error {
  constructor(readonly code: SettingsV6HelperSourceErrorCode) {
    super("The pinned v6 settings helper could not be verified safely.");
    this.name = "SettingsV6HelperSourceError";
  }
}

export interface PinnedHelperScopeV6 {
  readonly role: "DIRECT_SETTINGS_HELPER";
  readonly form_id: null;
  readonly module_name: typeof MODULES[number];
  readonly build: { readonly id: string; readonly base_url: string };
  readonly javascript: SettingsSourceArtifact;
  readonly source_map: SettingsSourceArtifact;
}

/** A validated helper scope for a module discovered in the current inventory.
 * The module name is deliberately data-driven; callers cannot construct an
 * accepted scope without the inventory's exact DIRECT_SETTINGS_HELPER pair.
 */
export interface PinnedGenericHelperScopeV6 {
  readonly role: "DIRECT_SETTINGS_HELPER";
  readonly form_id: null;
  readonly module_name: string;
  readonly build: { readonly id: string; readonly base_url: string };
  readonly javascript: SettingsSourceArtifact;
  readonly source_map: SettingsSourceArtifact;
}

export interface PinnedHelperSourceV6 {
  readonly source_index: number;
  readonly source_path: string;
  readonly source_content_sha256: string;
}

/** Contains ephemeral vendor text: do not serialize this object into an artifact. */
export interface VerifiedHelperBundleV6 {
  readonly scope: PinnedHelperScopeV6;
  readonly sources: readonly (PinnedHelperSourceV6 & { readonly content: string })[];
}

export interface VerifiedGenericHelperBundleV6 {
  readonly scope: PinnedGenericHelperScopeV6;
  readonly sources: readonly (PinnedHelperSourceV6 & { readonly content: string })[];
}

export interface FetchPinnedHelperBundleV6Options {
  readonly confirmedSourceFetch: true;
  readonly fetchImpl?: typeof fetch;
  /** May reduce, but never raise, the shared 60-second deadline. */
  readonly absoluteTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

const shaSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const countSchema = z.number().int().min(1).max(5_000);
const sourceSchema = z.object({
  source_index: z.number().int().min(0).max(4_999),
  source_path: z.string().min(1).max(2_000),
  source_content_sha256: shaSchema
}).strict();
const mapSchema = z.object({
  version: z.literal(3),
  file: z.string().min(1).max(2_000),
  source_count: countSchema,
  sources_content_count: countSchema,
  settings_source_count: countSchema,
  settings_sources: z.array(sourceSchema).min(1).max(5_000)
}).strict();
const artifactSchema = z.object({
  role: z.literal("DIRECT_SETTINGS_HELPER"),
  form_id: z.null(),
  kind: z.enum(["JAVASCRIPT", "SOURCE_MAP_V3"]),
  module_name: z.string().min(4).max(300).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u),
  url: z.string().max(2_000),
  content_type: z.string().max(200),
  bytes: z.number().int().min(1).max(MAX_BODY_BYTES),
  sha256: shaSchema,
  source_map: mapSchema.nullable()
}).strict();
const scopeSchema = z.object({
  role: z.literal("DIRECT_SETTINGS_HELPER"),
  form_id: z.null(),
  module_name: z.string().min(4).max(300).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u),
  build: z.object({ id: z.string().regex(/^\d{6,20}$/u), base_url: z.string().max(2_000) }).strict(),
  javascript: artifactSchema,
  source_map: artifactSchema
}).strict();

/** The caller separately binds this inventory to its exact public-catalog version. */
export function derivePinnedHelperScope(
  inventory: SettingsSourceInventory,
  moduleName: typeof MODULES[number]
): PinnedHelperScopeV6 {
  try {
    if (!(MODULES as readonly unknown[]).includes(moduleName)) invalid();
    const parsed = settingsSourceInventorySchema.safeParse(inventory);
    if (!parsed.success) invalid();
    const artifacts = parsed.data.source_artifacts.filter((entry) => entry.module_name === moduleName);
    const javascript = artifacts.find((entry) => entry.kind === "JAVASCRIPT");
    const sourceMap = artifacts.find((entry) => entry.kind === "SOURCE_MAP_V3");
    if (artifacts.length !== 2 || !javascript || !sourceMap) invalid();
    return validateScope({
      role: "DIRECT_SETTINGS_HELPER", form_id: null, module_name: moduleName,
      build: parsed.data.build, javascript, source_map: sourceMap
    }) as PinnedHelperScopeV6;
  } catch (error) { throw safeError(error); }
}

/**
 * Derive a helper scope for a module present in the validated inventory.
 * Only an exact two-artifact DIRECT_SETTINGS_HELPER pair with null form_id is
 * accepted. This is intentionally separate from the historical two-module
 * allowlist used by derivePinnedHelperScope().
 */
export function derivePinnedHelperScopeFromInventory(
  inventory: SettingsSourceInventory,
  moduleName: string
): PinnedGenericHelperScopeV6 {
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(moduleName) || moduleName.length > 300) invalid();
    const parsed = settingsSourceInventorySchema.safeParse(inventory);
    if (!parsed.success) invalid();
    const artifacts = parsed.data.source_artifacts.filter((entry) => entry.module_name === moduleName);
    if (artifacts.length !== 2 || artifacts.some((entry) => entry.role !== "DIRECT_SETTINGS_HELPER" || entry.form_id !== null)) invalid();
    const javascript = artifacts.find((entry) => entry.kind === "JAVASCRIPT");
    const sourceMap = artifacts.find((entry) => entry.kind === "SOURCE_MAP_V3");
    if (!javascript || !sourceMap) invalid();
    return validateScope({
      role: "DIRECT_SETTINGS_HELPER", form_id: null, module_name: moduleName,
      build: parsed.data.build, javascript, source_map: sourceMap
    });
  } catch (error) { throw safeError(error); }
}

/** Pure exact-byte verification. No source execution, file access, or network. */
export function verifyPinnedHelperBundle(
  scopeInput: PinnedHelperScopeV6,
  javascriptBytes: Uint8Array,
  sourceMapBytes: Uint8Array
): VerifiedHelperBundleV6 {
  try {
    const scope = validateScope(scopeInput) as PinnedHelperScopeV6;
    const javascript = copyBytes(javascriptBytes);
    const sourceMap = copyBytes(sourceMapBytes);
    verifyArtifact(javascript, scope.javascript);
    verifyArtifact(sourceMap, scope.source_map);
    decodeUtf8(javascript);
    const map: unknown = JSON.parse(decodeUtf8(sourceMap));
    const expected = scope.source_map.source_map!;
    if (!plainRecord(map) || map.version !== 3 || map.file !== expected.file ||
        !Array.isArray(map.names) || map.names.length > 100_000 ||
        map.names.some((name) => typeof name !== "string" || name.length > 20_000) ||
        typeof map.mappings !== "string" || !Array.isArray(map.sources) ||
        !Array.isArray(map.sourcesContent) || map.sources.length !== expected.source_count ||
        map.sourcesContent.length !== expected.sources_content_count ||
        (map.sourceRoot !== undefined && map.sourceRoot !== "") || map.sections !== undefined) invalid();
    const paths = new Set<string>();
    const observed: (PinnedHelperSourceV6 & { content: string })[] = [];
    for (let index = 0; index < map.sources.length; index += 1) {
      const rawPath: unknown = map.sources[index];
      const content: unknown = map.sourcesContent[index];
      if (typeof rawPath !== "string" || typeof content !== "string") invalid();
      const path = normalizeSourcePath(rawPath);
      if (paths.has(path)) invalid();
      paths.add(path);
      if (path.startsWith(SETTINGS_PREFIX)) {
        observed.push({
          source_index: index, source_path: path,
          source_content_sha256: hash(new TextEncoder().encode(content)), content
        });
      }
    }
    if (observed.length !== expected.settings_source_count) drift();
    for (const [index, actual] of observed.entries()) {
      const pinned = expected.settings_sources[index];
      if (!pinned || actual.source_index !== pinned.source_index || actual.source_path !== pinned.source_path ||
          actual.source_content_sha256 !== pinned.source_content_sha256) drift();
    }
    return { scope, sources: observed };
  } catch (error) { throw safeError(error); }
}

/** Generic counterpart of verifyPinnedHelperBundle for inventory-discovered modules. */
export function verifyPinnedGenericHelperBundle(
  scopeInput: PinnedGenericHelperScopeV6,
  javascriptBytes: Uint8Array,
  sourceMapBytes: Uint8Array
): VerifiedGenericHelperBundleV6 {
  return verifyBundle(scopeInput, javascriptBytes, sourceMapBytes);
}

/** Exactly two sequential anonymous GETs. The first hash is checked before the second GET. */
export async function fetchPinnedHelperBundle(
  scopeInput: PinnedHelperScopeV6,
  options: FetchPinnedHelperBundleV6Options
): Promise<VerifiedHelperBundleV6> {
  let deadline: Deadline | undefined;
  try {
    if (!plainRecord(options) || options.confirmedSourceFetch !== true) {
      throw new SettingsV6HelperSourceError("SETTINGS_V6_HELPER_SOURCE_FETCH_NOT_CONFIRMED");
    }
    if (Object.keys(options).some((key) => !["confirmedSourceFetch", "fetchImpl", "absoluteTimeoutMs", "signal"].includes(key))) invalid();
    const timeout = options.absoluteTimeoutMs ?? MAX_TIMEOUT_MS;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS || typeof fetchImpl !== "function" ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal))) invalid();
    const scope = validateScope(scopeInput) as PinnedHelperScopeV6;
    deadline = new Deadline(timeout, options.signal);
    deadline.check();
    const budget = { bytes: 0 };
    const javascript = await fetchArtifact(scope.javascript, fetchImpl, deadline, budget);
    verifyArtifact(javascript, scope.javascript);
    decodeUtf8(javascript);
    deadline.check();
    const sourceMap = await fetchArtifact(scope.source_map, fetchImpl, deadline, budget);
    const result = verifyPinnedHelperBundle(scope, javascript, sourceMap);
    deadline.check();
    return result;
  } catch (error) { throw safeError(error); }
  finally { deadline?.close(); }
}

/** Generic counterpart of fetchPinnedHelperBundle for inventory-discovered modules. */
export async function fetchPinnedGenericHelperBundle(
  scopeInput: PinnedGenericHelperScopeV6,
  options: FetchPinnedHelperBundleV6Options
): Promise<VerifiedGenericHelperBundleV6> {
  return fetchBundle(scopeInput, options);
}

function verifyBundle(
  scopeInput: PinnedGenericHelperScopeV6,
  javascriptBytes: Uint8Array,
  sourceMapBytes: Uint8Array
): VerifiedGenericHelperBundleV6 {
  try {
    const scope = validateScope(scopeInput);
    const javascript = copyBytes(javascriptBytes);
    const sourceMap = copyBytes(sourceMapBytes);
    verifyArtifact(javascript, scope.javascript);
    verifyArtifact(sourceMap, scope.source_map);
    decodeUtf8(javascript);
    const map: unknown = JSON.parse(decodeUtf8(sourceMap));
    const expected = scope.source_map.source_map!;
    if (!plainRecord(map) || map.version !== 3 || map.file !== expected.file ||
        !Array.isArray(map.names) || map.names.length > 100_000 ||
        map.names.some((name) => typeof name !== "string" || name.length > 20_000) ||
        typeof map.mappings !== "string" || !Array.isArray(map.sources) ||
        !Array.isArray(map.sourcesContent) || map.sources.length !== expected.source_count ||
        map.sourcesContent.length !== expected.sources_content_count ||
        (map.sourceRoot !== undefined && map.sourceRoot !== "") || map.sections !== undefined) invalid();
    const paths = new Set<string>();
    const observed: (PinnedHelperSourceV6 & { readonly content: string })[] = [];
    for (let index = 0; index < map.sources.length; index += 1) {
      const rawPath: unknown = map.sources[index];
      const content: unknown = map.sourcesContent[index];
      if (typeof rawPath !== "string" || typeof content !== "string") invalid();
      const path = normalizeSourcePath(rawPath);
      if (paths.has(path)) invalid();
      paths.add(path);
      if (path.startsWith(SETTINGS_PREFIX)) observed.push({
        source_index: index, source_path: path,
        source_content_sha256: hash(new TextEncoder().encode(content)), content
      });
    }
    if (observed.length !== expected.settings_source_count) drift();
    for (const [index, actual] of observed.entries()) {
      const pinned = expected.settings_sources[index];
      if (!pinned || actual.source_index !== pinned.source_index || actual.source_path !== pinned.source_path ||
          actual.source_content_sha256 !== pinned.source_content_sha256) drift();
    }
    return { scope, sources: observed };
  } catch (error) { throw safeError(error); }
}

async function fetchBundle(
  scopeInput: PinnedGenericHelperScopeV6,
  options: FetchPinnedHelperBundleV6Options
): Promise<VerifiedGenericHelperBundleV6> {
  let deadline: Deadline | undefined;
  try {
    if (!plainRecord(options) || options.confirmedSourceFetch !== true) throw new SettingsV6HelperSourceError("SETTINGS_V6_HELPER_SOURCE_FETCH_NOT_CONFIRMED");
    if (Object.keys(options).some((key) => !["confirmedSourceFetch", "fetchImpl", "absoluteTimeoutMs", "signal"].includes(key))) invalid();
    const timeout = options.absoluteTimeoutMs ?? MAX_TIMEOUT_MS;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS || typeof fetchImpl !== "function" ||
        (options.signal !== undefined && !(options.signal instanceof AbortSignal))) invalid();
    const scope = validateScope(scopeInput);
    deadline = new Deadline(timeout, options.signal);
    deadline.check();
    const budget = { bytes: 0 };
    const javascript = await fetchArtifact(scope.javascript, fetchImpl, deadline, budget);
    verifyArtifact(javascript, scope.javascript);
    decodeUtf8(javascript);
    deadline.check();
    const sourceMap = await fetchArtifact(scope.source_map, fetchImpl, deadline, budget);
    return verifyBundle(scope, javascript, sourceMap);
  } catch (error) { throw safeError(error); }
  finally { deadline?.close(); }
}

function validateScope(input: unknown): PinnedGenericHelperScopeV6 {
  const parsed = scopeSchema.safeParse(input);
  if (!parsed.success) invalid();
  const scope = parsed.data;
  const base = `https://syntx.ai/assets/${scope.build.id}/`;
  const js = scope.javascript;
  const map = scope.source_map;
  if (scope.build.base_url !== base || js.module_name !== scope.module_name || map.module_name !== scope.module_name ||
      js.kind !== "JAVASCRIPT" || map.kind !== "SOURCE_MAP_V3" ||
      js.url !== `${base}${scope.module_name}` || map.url !== `${base}${scope.module_name}.map` ||
      !JS_MEDIA.includes(js.content_type) || !MAP_MEDIA.includes(map.content_type) ||
      js.source_map !== null || map.source_map === null || js.bytes + map.bytes > MAX_TOTAL_BYTES) invalid();
  const metadata = map.source_map;
  // Both forms occur in the inventory generator; neither permits a different module/build.
  if (![scope.module_name, `assets/${scope.build.id}/${scope.module_name}`].includes(metadata.file) ||
      metadata.source_count !== metadata.sources_content_count ||
      metadata.settings_source_count !== metadata.settings_sources.length ||
      metadata.settings_source_count > metadata.source_count) invalid();
  const paths = new Set<string>();
  let previousIndex = -1;
  for (const source of metadata.settings_sources) {
    if (source.source_index <= previousIndex || source.source_index >= metadata.source_count ||
        !source.source_path.startsWith(SETTINGS_PREFIX) || normalizeSourcePath(source.source_path) !== source.source_path ||
        paths.has(source.source_path)) invalid();
    previousIndex = source.source_index;
    paths.add(source.source_path);
  }
  return scope;
}

function normalizeSourcePath(value: string): string {
  if (value.length < 1 || value.length > 2_000) invalid();
  let canonical: string | undefined;
  if (value.startsWith("/src/")) canonical = value;
  else if (value.startsWith("src/")) canonical = `/${value}`;
  else if (value.startsWith("../../../src/")) canonical = `/src/${value.slice("../../../src/".length)}`;
  if (canonical !== undefined) {
    // Only a recognized settings-source candidate is held to the strict charset/canonical form;
    // an unrelated bundler-internal path (e.g. a "scheme://" source-map entry) never reaches here.
    if (/[\\%\u0000-\u001f\u007f-\uffff]/u.test(canonical) || canonical.includes("//") ||
        canonical.slice(1).split("/").some((part) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(part))) invalid();
    if (looksLikeSettingsPath(canonical) && !canonical.startsWith(SETTINGS_PREFIX)) invalid();
    return canonical;
  }
  // Unrelated sources are never resolved, fetched or returned. Do not disguise settings sources as opaque paths.
  if (looksLikeSettingsPath(value)) invalid();
  return value;
}

function looksLikeSettingsPath(path: string): boolean {
  const lower = path.toLowerCase();
  const marker = "components/chat/forms/";
  const index = lower.indexOf(marker);
  return index >= 0 && lower.slice(index + marker.length).split("/", 1)[0]!.startsWith("settings");
}

function copyBytes(input: Uint8Array): Uint8Array {
  if (!(input instanceof Uint8Array) || input.byteLength === 0 || input.byteLength > MAX_BODY_BYTES) invalid();
  return new Uint8Array(input);
}
function verifyArtifact(bytes: Uint8Array, expected: SettingsSourceArtifact): void {
  if (bytes.byteLength !== expected.bytes || hash(bytes) !== expected.sha256) drift();
}

async function fetchArtifact(
  expected: SettingsSourceArtifact,
  fetchImpl: typeof fetch,
  deadline: Deadline,
  budget: { bytes: number }
): Promise<Uint8Array> {
  deadline.check();
  let pending: Promise<Response> | undefined;
  let response: Response;
  try {
    pending = Promise.resolve(fetchImpl(expected.url, {
      method: "GET", credentials: "omit", redirect: "manual", cache: "no-store",
      headers: {
        accept: expected.kind === "JAVASCRIPT" ? "application/javascript" : "application/json, application/octet-stream;q=0.9",
        "accept-encoding": "identity"
      },
      signal: deadline.signal
    }));
    response = await deadline.wait(pending);
  } catch (error) {
    if (pending) void pending.then((late) => cancelBody(late.body), () => undefined).catch(() => undefined);
    if (error instanceof SettingsV6HelperSourceError) throw error;
    throw new SettingsV6HelperSourceError("SETTINGS_V6_HELPER_SOURCE_FETCH_FAILED");
  }
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    deadline.check();
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const declared = response.headers.get("content-length");
    if (response.status < 200 || response.status > 299 || response.redirected || response.url !== expected.url ||
        contentType !== expected.content_type || !response.body ||
        (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) !== expected.bytes))) invalid();
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await deadline.wait(reader.read());
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) invalid();
      size += part.value.byteLength;
      budget.bytes += part.value.byteLength;
      if (size > expected.bytes || size > MAX_BODY_BYTES || budget.bytes > MAX_TOTAL_BYTES) invalid();
      chunks.push(new Uint8Array(part.value));
    }
    deadline.check();
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch (error) {
    if (reader) { try { void reader.cancel().catch(() => undefined); } catch { /* Cleanup must not mask the safe error. */ } }
    else cancelBody(response.body);
    throw error;
  } finally {
    try { reader?.releaseLock(); } catch { /* Pending hostile read remains bounded by the deadline race. */ }
  }
}

class Deadline {
  private readonly controller = new AbortController();
  private readonly expiresAt: number;
  private readonly expiration: Promise<never>;
  private readonly timer: ReturnType<typeof setTimeout>;
  private failure: SettingsV6HelperSourceError | undefined;
  private readonly onAbort: () => void;
  constructor(milliseconds: number, private readonly externalSignal?: AbortSignal) {
    this.expiresAt = performance.now() + milliseconds;
    let rejectExpiration: (error: Error) => void = () => undefined;
    this.expiration = new Promise((_, reject) => { rejectExpiration = reject; });
    const stop = (code: SettingsV6HelperSourceErrorCode): void => {
      if (this.failure) return;
      this.failure = new SettingsV6HelperSourceError(code);
      this.controller.abort();
      rejectExpiration(this.failure);
    };
    this.onAbort = () => stop("SETTINGS_V6_HELPER_SOURCE_ABORTED");
    this.timer = setTimeout(() => stop("SETTINGS_V6_HELPER_SOURCE_TIMEOUT"), milliseconds);
    void this.expiration.catch(() => undefined);
    externalSignal?.addEventListener("abort", this.onAbort, { once: true });
    if (externalSignal?.aborted) this.onAbort();
  }
  get signal(): AbortSignal { return this.controller.signal; }
  check(): void {
    if (this.failure) throw this.failure;
    if (performance.now() >= this.expiresAt) throw new SettingsV6HelperSourceError("SETTINGS_V6_HELPER_SOURCE_TIMEOUT");
  }
  async wait<T>(operation: Promise<T>): Promise<T> {
    // A read/fetch may already have started while the deadline expires. Always consume its rejection.
    void operation.catch(() => undefined);
    this.check();
    const value = await Promise.race([operation, this.expiration]);
    this.check();
    return value;
  }
  close(): void {
    clearTimeout(this.timer);
    this.externalSignal?.removeEventListener("abort", this.onAbort);
    this.controller.abort();
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  try { if (body) void body.cancel().catch(() => undefined); } catch { /* Best-effort cleanup only. */ }
}
function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return invalid(); }
}
function hash(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function invalid(): never { throw new SettingsV6HelperSourceError("SETTINGS_V6_HELPER_SOURCE_INVALID"); }
function drift(): never { throw new SettingsV6HelperSourceError("SETTINGS_V6_HELPER_SOURCE_DRIFT"); }
function safeError(error: unknown): SettingsV6HelperSourceError {
  const code = error instanceof SettingsV6HelperSourceError && ERROR_CODES.includes(error.code)
    ? error.code : "SETTINGS_V6_HELPER_SOURCE_INVALID";
  return new SettingsV6HelperSourceError(code);
}
