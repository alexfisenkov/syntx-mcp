import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNormalizedSettingsParserCensusManifestMatchesSources,
  normalizedSettingsParserCensusManifestSchema,
  serializeNormalizedSettingsParserCensusManifest
} from "../../../src/catalog/normalized-settings-parser-census-manifest.js";
import {
  assertSettingsSourceInventoryMatchesPublicCatalog,
  settingsSourceInventorySchema,
  serializeSettingsSourceInventory
} from "../../../src/catalog/settings-source-inventory.js";
import {
  sha256CanonicalPayload,
  syntxPublicCatalogSnapshotSchema,
  serializeSyntxPublicCatalogSnapshot
} from "../../../src/catalog/syntx-public-catalog.js";
import { rootOnlyScopeV5Schema } from "../../../src/catalog/settings-root-only-result-v5.js";

export interface RootOnlyBindingV5 {
  readonly name: "public_catalog" | "inventory" | "census";
  readonly bytes: number;
  readonly sha256: string;
}

export interface PinnedRootArtifactV5 {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface RootOnlySourceV5 {
  readonly source_ref_id: string;
  readonly role: "ROOT" | "AUXILIARY";
  readonly source_index: number;
  readonly source_path: string;
  readonly source_content_sha256: string;
}

export interface RootOnlyScopeV5 {
  readonly form_id: "beeble";
  readonly ai_name: "beeble";
  readonly model_ids: readonly ["switchx"];
  readonly root_source_ref_id: string;
  readonly auxiliary_source_ref_ids: readonly [string];
  /** Date of the pinned inventory observation, not a fresh fetch timestamp. */
  readonly source_observed_at: string;
  readonly bindings: readonly RootOnlyBindingV5[];
  readonly javascript: PinnedRootArtifactV5;
  readonly source_map: PinnedRootArtifactV5;
  readonly sources: readonly RootOnlySourceV5[];
}

/** Vendor content is ephemeral; never serialize this object as an artifact. */
export interface VerifiedRootBundleV5 {
  readonly scope: RootOnlyScopeV5;
  readonly sources: readonly (RootOnlySourceV5 & { readonly content: string })[];
}

export interface FetchPinnedRootBundleV5Options {
  readonly confirmedSourceFetch: true;
  readonly fetchImpl?: typeof fetch;
  readonly absoluteTimeoutMs?: number;
  readonly signal?: AbortSignal;
}

export type SettingsV5SourceErrorCode =
  | "SETTINGS_V5_SOURCE_INVALID"
  | "SETTINGS_V5_SOURCE_DRIFT"
  | "SETTINGS_V5_SOURCE_FETCH_NOT_CONFIRMED";

export class SettingsV5SourceError extends Error {
  constructor(readonly code: SettingsV5SourceErrorCode) {
    super("The pinned v5 settings source could not be verified safely.");
    this.name = "SettingsV5SourceError";
  }
}

const JAVASCRIPT_URL = "https://syntx.ai/assets/1788368942/beeble.js";
const SOURCE_MAP_URL = `${JAVASCRIPT_URL}.map`;
const ROOT_PATH = "/src/components/chat/forms/settings/beeble.vue";
const AUXILIARY_PATH = "/src/components/chat/forms/settings/components/beeble/MaskEditor.vue";
const MAX_JAVASCRIPT_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_MAP_BYTES = 32 * 1024 * 1024;
const MAX_LOCAL_ARTIFACT_BYTES = 8 * 1024 * 1024;

/** Load each local artifact once and verify the same bytes used for bindings. */
export function loadRootOnlyScopeV5(
  projectRoot: string,
  formId = "beeble"
): RootOnlyScopeV5 {
  try {
    if (formId !== "beeble" || typeof projectRoot !== "string" || projectRoot.includes("\0")) invalid();
    const files = [
      { name: "public_catalog" as const, path: "catalog/v1/official-public-api.json" },
      { name: "inventory" as const, path: "catalog/runtime/v1/settings-source-inventory.json" },
      { name: "census" as const, path: "catalog/runtime/v2/normalized-settings-parser-census-manifest.json" }
    ].map((file) => {
      const bytes = readFileSync(join(projectRoot, file.path));
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOCAL_ARTIFACT_BYTES) invalid();
      return { name: file.name, bytes, text: decodeUtf8(bytes) };
    });
    const [publicFile, inventoryFile, censusFile] = files;
    if (!publicFile || !inventoryFile || !censusFile) invalid();
    const publicCatalog = syntxPublicCatalogSnapshotSchema.parse(JSON.parse(publicFile.text));
    const inventory = settingsSourceInventorySchema.parse(JSON.parse(inventoryFile.text));
    const census = normalizedSettingsParserCensusManifestSchema.parse(JSON.parse(censusFile.text));
    assertSettingsSourceInventoryMatchesPublicCatalog(inventory, publicCatalog);
    assertNormalizedSettingsParserCensusManifestMatchesSources(census, publicCatalog, inventory);
    if (
      serializeSyntxPublicCatalogSnapshot(publicCatalog) !== publicFile.text ||
      serializeSettingsSourceInventory(inventory) !== inventoryFile.text ||
      serializeNormalizedSettingsParserCensusManifest(census, publicCatalog, inventory) !== censusFile.text
    ) invalid();
    const form = census.forms.find((entry) => entry.form_id === formId);
    const ai = publicCatalog.ai.find((entry) => entry.value === "beeble");
    const models = publicCatalog.models.filter((entry) => entry.ai_name === "beeble");
    if (!form || form.ai_name !== "beeble" || form.model_ids.length !== 1 || form.model_ids[0] !== "switchx" ||
        form.auxiliary_source_ref_ids.length !== 1 || !ai?.active || ai.scope !== "video" ||
        models.length !== 1 || models[0]?.value !== "switchx" || !models[0].active) invalid();
    const references = [form.root_source_ref_id, ...form.auxiliary_source_ref_ids];
    const sources = census.source_identities.filter((entry) => references.includes(entry.source_ref_id));
    const artifacts = inventory.source_artifacts.filter((entry) => entry.form_id === formId && entry.role === "PROVIDER_FORM");
    const javascript = artifacts.find((entry) => entry.kind === "JAVASCRIPT");
    const sourceMap = artifacts.find((entry) => entry.kind === "SOURCE_MAP_V3");
    if (artifacts.length !== 2 || !javascript || !sourceMap || sources.length !== 2 ||
        javascript.module_name !== "beeble.js" || sourceMap.module_name !== "beeble.js") invalid();
    for (const source of sources) {
      if (source.module_name !== "beeble.js" || source.form_id !== "beeble" || source.role !== "PROVIDER_FORM" ||
          source.module_javascript_sha256 !== javascript.sha256 || source.module_source_map_sha256 !== sourceMap.sha256) invalid();
    }
    return validateScope({
      form_id: "beeble", ai_name: "beeble", model_ids: ["switchx"],
      root_source_ref_id: form.root_source_ref_id,
      auxiliary_source_ref_ids: [...form.auxiliary_source_ref_ids],
      source_observed_at: inventory.generated_at,
      bindings: files.map((file) => ({ name: file.name, bytes: file.bytes.byteLength, sha256: hashBytes(file.bytes) })),
      javascript: { url: javascript.url, bytes: javascript.bytes, sha256: javascript.sha256 },
      source_map: { url: sourceMap.url, bytes: sourceMap.bytes, sha256: sourceMap.sha256 },
      sources: sources.sort((left, right) => left.source_index - right.source_index).map((source) => ({
        source_ref_id: source.source_ref_id,
        role: source.source_ref_id === form.root_source_ref_id ? "ROOT" : "AUXILIARY",
        source_index: source.source_index,
        source_path: source.source_path,
        source_content_sha256: source.source_content_sha256
      }))
    });
  } catch (error) {
    throw safeError(error);
  }
}

/** Pure raw-byte verification: no file I/O, network, compilation, or clock. */
export function verifyPinnedRootBundleV5(
  scopeInput: RootOnlyScopeV5,
  javascriptBytes: Uint8Array,
  sourceMapBytes: Uint8Array
): VerifiedRootBundleV5 {
  try {
    const scope = validateScope(scopeInput);
    verifyArtifact(javascriptBytes, scope.javascript, MAX_JAVASCRIPT_BYTES);
    verifyArtifact(sourceMapBytes, scope.source_map, MAX_SOURCE_MAP_BYTES);
    decodeUtf8(javascriptBytes);
    const candidate: unknown = JSON.parse(decodeUtf8(sourceMapBytes));
    if (!isPlainRecord(candidate) || candidate.version !== 3 || candidate.file !== "beeble.js" ||
        !Array.isArray(candidate.names) || candidate.names.length > 100_000 ||
        candidate.names.some((name) => typeof name !== "string" || name.length > 20_000) ||
        typeof candidate.mappings !== "string" || !Array.isArray(candidate.sources) ||
        !Array.isArray(candidate.sourcesContent) || candidate.sources.length !== 2 ||
        candidate.sourcesContent.length !== 2 ||
        (candidate.sourceRoot !== undefined && candidate.sourceRoot !== "")) invalid();
    const mapSources = candidate.sources;
    const mapContents = candidate.sourcesContent;
    const paths = new Set<string>();
    const verified = scope.sources.map((source) => {
      const path = normalizeSourcePath(mapSources[source.source_index]);
      const content = mapContents[source.source_index];
      if (typeof content !== "string" || paths.has(path)) invalid();
      paths.add(path);
      if (source.source_path !== path || hashBytes(new TextEncoder().encode(content)) !== source.source_content_sha256) drift();
      return { ...source, content };
    });
    return { scope, sources: verified };
  } catch (error) {
    throw safeError(error);
  }
}

/** Exactly the two fixed first-slice public GETs, with one shared deadline. */
export async function fetchPinnedRootBundleV5(
  scopeInput: RootOnlyScopeV5,
  options: FetchPinnedRootBundleV5Options
): Promise<VerifiedRootBundleV5> {
  let deadline: AbsoluteDeadline | undefined;
  try {
    if (!options || typeof options !== "object" || options.confirmedSourceFetch !== true) {
      throw new SettingsV5SourceError("SETTINGS_V5_SOURCE_FETCH_NOT_CONFIRMED");
    }
    if (Object.keys(options).some((key) => !["confirmedSourceFetch", "fetchImpl", "absoluteTimeoutMs", "signal"].includes(key))) invalid();
    if (options.signal !== undefined && (!(options.signal instanceof AbortSignal) || options.signal.aborted)) invalid();
    const scope = validateScope(scopeInput);
    const timeout = options.absoluteTimeoutMs ?? 30_000;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 120_000 || typeof fetchImpl !== "function") invalid();
    deadline = new AbsoluteDeadline(timeout, options.signal);
    const javascript = await fetchArtifact(scope.javascript, "javascript", fetchImpl, deadline);
    // Reject drift in the first body before requesting the map.
    verifyArtifact(javascript, scope.javascript, MAX_JAVASCRIPT_BYTES);
    decodeUtf8(javascript);
    const sourceMap = await fetchArtifact(scope.source_map, "source_map", fetchImpl, deadline);
    return verifyPinnedRootBundleV5(scope, javascript, sourceMap);
  } catch (error) {
    throw safeError(error);
  } finally {
    deadline?.close();
  }
}

function validateScope(input: unknown): RootOnlyScopeV5 {
  const parsed = rootOnlyScopeV5Schema.safeParse(input);
  if (!parsed.success) invalid();
  const scope = parsed.data as RootOnlyScopeV5;
  if (scope.form_id !== "beeble" || scope.ai_name !== "beeble" ||
      scope.model_ids.length !== 1 || scope.model_ids[0] !== "switchx" ||
      scope.javascript.url !== JAVASCRIPT_URL || scope.source_map.url !== SOURCE_MAP_URL ||
      scope.javascript.bytes > MAX_JAVASCRIPT_BYTES || scope.source_map.bytes > MAX_SOURCE_MAP_BYTES ||
      scope.sources.length !== 2 || scope.auxiliary_source_ref_ids.length !== 1 ||
      scope.bindings.length !== 3 || scope.bindings.some((binding, index) =>
        binding.name !== ["public_catalog", "inventory", "census"][index] || binding.bytes > MAX_LOCAL_ARTIFACT_BYTES)) invalid();
  const expectedSources = [
    { role: "AUXILIARY", path: AUXILIARY_PATH, id: scope.auxiliary_source_ref_ids[0] },
    { role: "ROOT", path: ROOT_PATH, id: scope.root_source_ref_id }
  ];
  scope.sources.forEach((source, index) => {
    const expected = expectedSources[index]!;
    if (source.role !== expected.role || source.source_index !== index || source.source_path !== expected.path ||
        source.source_ref_id !== expected.id || source.source_ref_id !== sourceRefId(scope, source)) invalid();
  });
  return scope;
}

function sourceRefId(scope: RootOnlyScopeV5, source: RootOnlySourceV5): string {
  const digest = sha256CanonicalPayload({
    role: "PROVIDER_FORM", module_name: "beeble.js", form_id: "beeble",
    module_javascript_sha256: scope.javascript.sha256,
    module_source_map_sha256: scope.source_map.sha256,
    source_index: source.source_index, source_path: source.source_path,
    source_content_sha256: source.source_content_sha256
  });
  return `settings-source-${digest.slice("sha256:".length)}`;
}

function verifyArtifact(bytes: Uint8Array, expected: PinnedRootArtifactV5, maxBytes: number): void {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > maxBytes) invalid();
  if (bytes.byteLength !== expected.bytes || hashBytes(bytes) !== expected.sha256) drift();
}

function normalizeSourcePath(value: unknown): string {
  if (typeof value !== "string" || value.length > 2_000 ||
      /[\\%\u0000-\u001f\u007f-\uffff]/u.test(value) || value.includes("//")) invalid();
  let path: string;
  if (value.startsWith("/src/")) path = value;
  else if (value.startsWith("src/")) path = `/${value}`;
  else if (value.startsWith("../../../src/")) path = `/src/${value.slice("../../../src/".length)}`;
  else return invalid();
  if (!path.startsWith("/src/components/chat/forms/settings/") ||
      path.slice(1).split("/").some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) || segment === "." || segment === "..")) invalid();
  return path;
}

async function fetchArtifact(
  expected: PinnedRootArtifactV5,
  kind: "javascript" | "source_map",
  fetchImpl: typeof fetch,
  deadline: AbsoluteDeadline
): Promise<Uint8Array> {
  let pending: Promise<Response> | undefined;
  let response: Response;
  try {
    pending = Promise.resolve(fetchImpl(expected.url, {
      method: "GET",
      headers: { accept: kind === "javascript" ? "application/javascript" : "application/json, application/octet-stream;q=0.9", "accept-encoding": "identity" },
      credentials: "omit", redirect: "manual", cache: "no-store", signal: deadline.signal
    }));
    response = await deadline.wait(pending);
  } catch {
    if (pending) void pending.then((late) => cancelBody(late.body), () => undefined);
    return invalid();
  }
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const allowedTypes = kind === "javascript"
    ? ["application/javascript", "application/x-javascript", "text/javascript"]
    : ["application/json", "application/octet-stream"];
  const declaredLength = response.headers.get("content-length");
  if (response.status !== 200 || response.url !== expected.url || response.redirected ||
      !mediaType || !allowedTypes.includes(mediaType) || !response.body ||
      (declaredLength !== null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) !== expected.bytes))) {
    cancelBody(response.body);
    return invalid();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await deadline.wait(reader.read());
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) invalid();
      size += part.value.byteLength;
      if (size > expected.bytes) invalid();
      chunks.push(part.value);
    }
  } catch {
    void reader.cancel().catch(() => undefined);
    return invalid();
  } finally {
    try { reader.releaseLock(); } catch { /* A hostile stream may leave its read pending. */ }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

class AbsoluteDeadline {
  readonly controller = new AbortController();
  readonly expired: Promise<never>;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly onAbort: () => void;
  constructor(milliseconds: number, readonly externalSignal?: AbortSignal) {
    let expire: (error: Error) => void = () => undefined;
    this.expired = new Promise((_, reject) => {
      expire = reject;
    });
    this.onAbort = () => {
      this.controller.abort();
      expire(new SettingsV5SourceError("SETTINGS_V5_SOURCE_INVALID"));
    };
    this.timer = setTimeout(this.onAbort, milliseconds);
    void this.expired.catch(() => undefined);
    externalSignal?.addEventListener("abort", this.onAbort, { once: true });
    if (externalSignal?.aborted) this.onAbort();
  }
  get signal(): AbortSignal { return this.controller.signal; }
  wait<T>(operation: Promise<T>): Promise<T> { return Promise.race([operation, this.expired]); }
  close(): void {
    clearTimeout(this.timer);
    this.externalSignal?.removeEventListener("abort", this.onAbort);
    this.controller.abort();
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body) void body.cancel().catch(() => undefined);
}

function decodeUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return invalid(); }
}

function hashBytes(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function invalid(): never { throw new SettingsV5SourceError("SETTINGS_V5_SOURCE_INVALID"); }
function drift(): never { throw new SettingsV5SourceError("SETTINGS_V5_SOURCE_DRIFT"); }
function safeError(error: unknown): SettingsV5SourceError {
  return error instanceof SettingsV5SourceError ? error : new SettingsV5SourceError("SETTINGS_V5_SOURCE_INVALID");
}
