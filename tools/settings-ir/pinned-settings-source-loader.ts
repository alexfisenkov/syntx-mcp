import { createHash } from "node:crypto";
import {
  SettingsSourceInventoryError,
  settingsSourceInventorySchema,
  type SettingsSourceArtifact,
  type SettingsSourceInventory
} from "../../src/catalog/settings-source-inventory.js";

const JAVASCRIPT_MEDIA_TYPES = new Set([
  "application/javascript",
  "application/x-javascript",
  "text/javascript"
]);
const SOURCE_MAP_MEDIA_TYPES = new Set([
  "application/json",
  "application/octet-stream"
]);
const SETTINGS_SOURCE_MARKER = "/src/components/chat/forms/settings/";
const SOURCE_MAP_LEGACY_ROOT_PREFIX = "../../../src/";
const SOURCE_MAP_CANONICAL_ROOT_PREFIX = "/src/";
const SOURCE_MAP_RELATIVE_ROOT_PREFIX = "src/";
const SOURCE_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const MODULE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u;
const FORM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

interface FetchPinnedSettingsFormSourceMaterialOptions {
  fetchImpl?: typeof fetch;
  absoluteTimeoutMs?: number;
  maxJavaScriptBytes?: number;
  maxSourceMapBytes?: number;
}

interface PinnedSettingsSourceArtifactReference {
  kind: "JAVASCRIPT" | "SOURCE_MAP_V3";
  module_name: string;
  url: string;
  content_type: string;
  bytes: number;
  sha256: string;
}

interface PinnedSettingsFormSourceMaterial {
  form_id: string;
  source: {
    source_index: number;
    source_path: string;
    source_content_sha256: string;
    content: string;
  };
  artifacts: {
    javascript: PinnedSettingsSourceArtifactReference;
    source_map: PinnedSettingsSourceArtifactReference;
  };
}

interface FetchedArtifact {
  metadata: SettingsSourceArtifact;
  text: string;
}

interface ParsedSourceMap {
  metadata: NonNullable<SettingsSourceArtifact["source_map"]>;
  settingsSources: Array<{
    index: number;
    path: string;
    content: string;
  }>;
}

/**
 * Fetches one form source from the exact public artifacts pinned by an
 * inventory. This source-checkout-only tool verifies raw provider bodies in
 * memory and returns only the requested Vue source to the static compiler.
 */
export async function fetchPinnedSettingsFormSourceMaterial(
  inventory: SettingsSourceInventory,
  formId: string,
  options: FetchPinnedSettingsFormSourceMaterialOptions = {}
): Promise<PinnedSettingsFormSourceMaterial> {
  const parsedInventory = settingsSourceInventorySchema.safeParse(inventory);
  if (!parsedInventory.success) {
    throw new SettingsSourceInventoryError("SOURCE_DRIFT_DETECTED");
  }
  if (
    formId.length < 1 ||
    formId.length > 160 ||
    !FORM_ID_PATTERN.test(formId)
  ) {
    throw new TypeError("Pinned settings form source request is invalid.");
  }

  const absoluteTimeoutMs = options.absoluteTimeoutMs ?? 30_000;
  const maxJavaScriptBytes = options.maxJavaScriptBytes ?? 16 * 1024 * 1024;
  const maxSourceMapBytes = options.maxSourceMapBytes ?? 32 * 1024 * 1024;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  validatePinnedSourceOptions({
    fetchImpl,
    absoluteTimeoutMs,
    maxJavaScriptBytes,
    maxSourceMapBytes
  });

  const expectedModuleName = `${formId}.js`;
  const formArtifacts = parsedInventory.data.source_artifacts.filter(
    (artifact) =>
      artifact.role === "PROVIDER_FORM" && artifact.form_id === formId
  );
  const recordedJavaScript = formArtifacts.filter(
    (artifact) =>
      artifact.kind === "JAVASCRIPT" &&
      artifact.module_name === expectedModuleName
  );
  const recordedSourceMap = formArtifacts.filter(
    (artifact) =>
      artifact.kind === "SOURCE_MAP_V3" &&
      artifact.module_name === expectedModuleName
  );
  if (
    formArtifacts.length !== 2 ||
    recordedJavaScript.length !== 1 ||
    recordedSourceMap.length !== 1
  ) {
    throw new SettingsSourceInventoryError("SOURCE_DRIFT_DETECTED");
  }

  const deadline = new AbsoluteDeadline(absoluteTimeoutMs);
  try {
    const javascript = await fetchTextArtifact({
      moduleName: expectedModuleName,
      artifactName: expectedModuleName,
      formId,
      kind: "JAVASCRIPT",
      baseUrl: parsedInventory.data.build.base_url,
      fetchImpl,
      deadline,
      maxBytes: maxJavaScriptBytes
    });
    const sourceMapBody = await fetchTextArtifact({
      moduleName: expectedModuleName,
      artifactName: `${expectedModuleName}.map`,
      formId,
      kind: "SOURCE_MAP_V3",
      baseUrl: parsedInventory.data.build.base_url,
      fetchImpl,
      deadline,
      maxBytes: maxSourceMapBytes
    });
    const parsedMap = parseSourceMap(sourceMapBody.text);
    const sourceMap: FetchedArtifact = {
      text: sourceMapBody.text,
      metadata: {
        ...sourceMapBody.metadata,
        source_map: parsedMap.metadata
      }
    };
    const expectedSourcePath = `${SETTINGS_SOURCE_MARKER}${formId}.vue`;
    const observedSources = parsedMap.settingsSources.filter(
      (source) => source.path === expectedSourcePath
    );
    if (observedSources.length !== 1) {
      throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
    }

    const pinnedMapMetadata = recordedSourceMap[0]!.source_map;
    const pinnedSources = pinnedMapMetadata?.settings_sources.filter(
      (source) => source.source_path === expectedSourcePath
    );
    if (pinnedMapMetadata === null || pinnedSources?.length !== 1) {
      throw new SettingsSourceInventoryError("SOURCE_DRIFT_DETECTED");
    }

    if (
      !sourceArtifactMetadataMatches(recordedJavaScript[0]!, javascript.metadata) ||
      !sourceArtifactMetadataMatches(recordedSourceMap[0]!, sourceMap.metadata)
    ) {
      throw new SettingsSourceInventoryError("SOURCE_DRIFT_DETECTED");
    }

    const observedSource = observedSources[0]!;
    const pinnedSource = pinnedSources[0]!;
    const observedContentSha256 = sha256Text(observedSource.content);
    if (
      observedSource.index !== pinnedSource.source_index ||
      observedSource.path !== pinnedSource.source_path ||
      observedContentSha256 !== pinnedSource.source_content_sha256
    ) {
      throw new SettingsSourceInventoryError("SOURCE_DRIFT_DETECTED");
    }

    return {
      form_id: formId,
      source: {
        source_index: observedSource.index,
        source_path: observedSource.path,
        source_content_sha256: observedContentSha256,
        content: observedSource.content
      },
      artifacts: {
        javascript: toPinnedArtifactReference(recordedJavaScript[0]!),
        source_map: toPinnedArtifactReference(recordedSourceMap[0]!)
      }
    };
  } finally {
    deadline.close();
  }
}

function validatePinnedSourceOptions(options: {
  fetchImpl: typeof fetch;
  absoluteTimeoutMs: number;
  maxJavaScriptBytes: number;
  maxSourceMapBytes: number;
}): void {
  if (
    typeof options.fetchImpl !== "function" ||
    !isBoundedInteger(options.absoluteTimeoutMs, 1, 300_000) ||
    !isBoundedInteger(options.maxJavaScriptBytes, 1_024, 64 * 1024 * 1024) ||
    !isBoundedInteger(options.maxSourceMapBytes, 1_024, 64 * 1024 * 1024)
  ) {
    throw new TypeError("Pinned settings form source bounds are invalid.");
  }
}

async function fetchTextArtifact(input: {
  moduleName: string;
  artifactName: string;
  formId: string;
  kind: SettingsSourceArtifact["kind"];
  baseUrl: string;
  fetchImpl: typeof fetch;
  deadline: AbsoluteDeadline;
  maxBytes: number;
}): Promise<FetchedArtifact> {
  if (
    !MODULE_NAME_PATTERN.test(input.moduleName) ||
    !new RegExp(
      `^${escapeRegularExpression(input.moduleName)}(?:\\.map)?$`,
      "u"
    ).test(input.artifactName)
  ) {
    throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
  }
  const url = new URL(input.artifactName, input.baseUrl).href;
  let response: Response;
  let pendingResponse: Promise<Response> | undefined;
  try {
    pendingResponse = input.fetchImpl(url, {
      method: "GET",
      headers: {
        accept:
          input.kind === "JAVASCRIPT"
            ? "application/javascript"
            : "application/json, application/octet-stream;q=0.9",
        "accept-encoding": "identity"
      },
      credentials: "omit",
      redirect: "manual",
      cache: "no-store",
      signal: input.deadline.signal
    });
    response = await input.deadline.waitFor(pendingResponse);
  } catch {
    if (pendingResponse !== undefined) {
      void pendingResponse.then(
        (lateResponse) => cancelBody(lateResponse.body),
        () => undefined
      );
    }
    throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
  }

  if (response.status >= 300 && response.status <= 399) {
    cancelBody(response.body);
    throw new SettingsSourceInventoryError("SOURCE_REDIRECTED");
  }
  if (!response.ok) {
    cancelBody(response.body);
    throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
  }
  if (response.url !== url) {
    cancelBody(response.body);
    throw new SettingsSourceInventoryError("SOURCE_REDIRECTED");
  }
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  const allowedMediaTypes =
    input.kind === "JAVASCRIPT"
      ? JAVASCRIPT_MEDIA_TYPES
      : SOURCE_MAP_MEDIA_TYPES;
  if (contentType === undefined || !allowedMediaTypes.has(contentType)) {
    cancelBody(response.body);
    throw new SettingsSourceInventoryError("SOURCE_MEDIA_TYPE_INVALID");
  }

  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > input.maxBytes
    ) {
      cancelBody(response.body);
      throw new SettingsSourceInventoryError("SOURCE_TOO_LARGE");
    }
  }
  if (response.body === null) {
    throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
  }

  const bytes = await readBoundedBody(
    response.body,
    input.maxBytes,
    input.deadline
  );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SettingsSourceInventoryError("SOURCE_UTF8_INVALID");
  }
  return {
    text,
    metadata: {
      role: "PROVIDER_FORM",
      kind: input.kind,
      module_name: input.moduleName,
      form_id: input.formId,
      url,
      content_type: contentType,
      bytes: bytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      source_map: null
    }
  };
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  deadline: AbsoluteDeadline
): Promise<Uint8Array> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      let item: ReadableStreamReadResult<Uint8Array>;
      try {
        item = await deadline.waitFor(reader.read());
      } catch {
        cancelReader(reader);
        throw new SettingsSourceInventoryError("SOURCE_FETCH_FAILED");
      }
      if (item.done) break;
      totalBytes += item.value.byteLength;
      if (totalBytes > maxBytes) {
        cancelReader(reader);
        throw new SettingsSourceInventoryError("SOURCE_TOO_LARGE");
      }
      chunks.push(item.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A hostile injected stream can retain a pending read after the deadline.
    }
  }

  const joined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function parseSourceMap(text: string): ParsedSourceMap {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }
  if (!isPlainRecord(candidate)) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }
  const { version, file, names, mappings, sources, sourcesContent } = candidate;
  if (
    version !== 3 ||
    typeof file !== "string" ||
    file.length < 1 ||
    file.length > 2_000 ||
    !Array.isArray(names) ||
    names.length > 100_000 ||
    names.some((name) => typeof name !== "string" || name.length > 20_000) ||
    typeof mappings !== "string" ||
    !Array.isArray(sources) ||
    !Array.isArray(sourcesContent) ||
    sources.length < 1 ||
    sources.length > 5_000 ||
    sources.length !== sourcesContent.length
  ) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }

  const settingsSources: ParsedSourceMap["settingsSources"] = [];
  const settingsPaths = new Set<string>();
  for (let index = 0; index < sources.length; index += 1) {
    const pathValue = sources[index];
    const contentValue = sourcesContent[index];
    if (
      typeof pathValue !== "string" ||
      pathValue.length < 1 ||
      pathValue.length > 2_000 ||
      pathValue.includes("\0") ||
      typeof contentValue !== "string"
    ) {
      throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
    }
    const normalizedPath = normalizeSettingsSourcePath(pathValue);
    if (normalizedPath === null) continue;
    if (settingsPaths.has(normalizedPath)) {
      throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
    }
    settingsPaths.add(normalizedPath);
    settingsSources.push({
      index,
      path: normalizedPath,
      content: contentValue
    });
  }

  return {
    metadata: {
      version: 3,
      file,
      source_count: sources.length,
      sources_content_count: sourcesContent.length,
      settings_source_count: settingsSources.length,
      settings_sources: settingsSources.map((source) => ({
        source_index: source.index,
        source_path: source.path,
        source_content_sha256: sha256Text(source.content)
      }))
    },
    settingsSources
  };
}

function normalizeSettingsSourcePath(path: string): string | null {
  if (!looksLikeSettingsSourcePath(path)) return null;
  if (
    /[\\%\u0000-\u001f\u007f-\uffff]/u.test(path) ||
    path.includes("//")
  ) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }

  let canonical: string | null = null;
  if (path.startsWith(SOURCE_MAP_CANONICAL_ROOT_PREFIX)) {
    canonical = path;
  } else if (path.startsWith(SOURCE_MAP_RELATIVE_ROOT_PREFIX)) {
    canonical = `/${path}`;
  } else if (path.startsWith(SOURCE_MAP_LEGACY_ROOT_PREFIX)) {
    canonical = `/src/${path.slice(SOURCE_MAP_LEGACY_ROOT_PREFIX.length)}`;
  }
  if (canonical === null) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }

  const segments = canonical.slice(1).split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        !SOURCE_PATH_SEGMENT_PATTERN.test(segment)
    ) ||
    !canonical.startsWith(SETTINGS_SOURCE_MARKER) ||
    !isCanonicalSettingsSourcePath(canonical)
  ) {
    throw new SettingsSourceInventoryError("SOURCE_MAP_INVALID");
  }
  return canonical;
}

function looksLikeSettingsSourcePath(path: string): boolean {
  let candidate = path.normalize("NFKC");
  if (candidate.includes("%")) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      // Strict validation rejects malformed escapes if this remains settings-like.
    }
  }
  candidate = candidate.replace(/[\\\u2044\u2215\uff0f]/gu, "/");
  const marker = "components/chat/forms/";
  const markerIndex = candidate.toLowerCase().indexOf(marker);
  if (markerIndex < 0) return false;
  const nextSegment = candidate
    .slice(markerIndex + marker.length)
    .split("/", 1)[0]
    ?.toLowerCase();
  return nextSegment?.startsWith("settings") ?? false;
}

function isCanonicalSettingsSourcePath(path: string): boolean {
  if (
    !path.startsWith(SETTINGS_SOURCE_MARKER) ||
    /[\\%\u0000-\u001f\u007f-\uffff]/u.test(path) ||
    path.includes("//")
  ) {
    return false;
  }
  const relative = path.slice(SETTINGS_SOURCE_MARKER.length);
  return (
    relative.length > 0 &&
    relative
      .split("/")
      .every((segment) => SOURCE_PATH_SEGMENT_PATTERN.test(segment))
  );
}

function sourceArtifactMetadataMatches(
  recorded: SettingsSourceArtifact,
  observed: SettingsSourceArtifact
): boolean {
  return (
    recorded.role === observed.role &&
    recorded.kind === observed.kind &&
    recorded.module_name === observed.module_name &&
    recorded.form_id === observed.form_id &&
    recorded.url === observed.url &&
    recorded.content_type === observed.content_type &&
    recorded.bytes === observed.bytes &&
    recorded.sha256 === observed.sha256 &&
    JSON.stringify(recorded.source_map) === JSON.stringify(observed.source_map)
  );
}

function toPinnedArtifactReference(
  artifact: SettingsSourceArtifact
): PinnedSettingsSourceArtifactReference {
  return {
    kind: artifact.kind,
    module_name: artifact.module_name,
    url: artifact.url,
    content_type: artifact.content_type,
    bytes: artifact.bytes,
    sha256: artifact.sha256
  };
}

function sha256Text(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

class AbsoluteDeadline {
  readonly #controller = new AbortController();
  readonly #timeout: ReturnType<typeof setTimeout>;
  readonly #expired: Promise<never>;

  constructor(milliseconds: number) {
    let expire: (reason: Error) => void = () => undefined;
    this.#expired = new Promise((_, reject) => {
      expire = reject;
    });
    this.#timeout = setTimeout(() => {
      this.#controller.abort();
      expire(new Error("deadline"));
    }, milliseconds);
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  async waitFor<T>(operation: Promise<T>): Promise<T> {
    void operation.catch(() => undefined);
    return Promise.race([operation, this.#expired]);
  }

  close(): void {
    clearTimeout(this.#timeout);
    this.#controller.abort();
  }
}

function cancelBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  void body.cancel().catch(() => undefined);
}

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  void reader.cancel().catch(() => undefined);
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isBoundedInteger(
  value: number,
  minimum: number,
  maximum: number
): boolean {
  return Number.isInteger(value) && value >= minimum && value <= maximum;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
