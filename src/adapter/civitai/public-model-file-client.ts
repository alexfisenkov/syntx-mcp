import { types } from "node:util";

const API_ORIGIN = "https://civitai.com";
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_HEADERS = 128;
const MAX_HEADER_BYTES = 32_768;
const MAX_VERSION_LINKS = 4_096;
const MAX_FILES = 256;
const SHA256 = /^[a-fA-F0-9]{64}$/u;

export type CivitaiPublicModelFileErrorCode =
  | "INVALID_INPUT" | "REQUEST_ABORTED" | "REQUEST_TIMEOUT" | "FETCH_FAILED" | "HTTP_REJECTED"
  | "METADATA_REDIRECT_REJECTED" | "RESPONSE_HEADERS_INVALID" | "RESPONSE_TOO_LARGE" | "RESPONSE_SHAPE_INVALID"
  | "MODEL_ID_MISMATCH" | "MODEL_NOT_LORA" | "MODEL_NOT_PUBLIC" | "MODEL_VERSION_NOT_LINKED"
  | "VERSION_ID_MISMATCH" | "VERSION_NOT_PUBLIC" | "FILE_SELECTION_AMBIGUOUS" | "FILE_NOT_ELIGIBLE"
  | "FILE_METADATA_INCOMPLETE" | "DOWNLOAD_SELECTION_UNVERIFIABLE";

export class CivitaiPublicModelFileClientError extends Error {
  constructor(readonly code: CivitaiPublicModelFileErrorCode) {
    super("The public Civitai model file could not be verified safely.");
    this.name = "CivitaiPublicModelFileClientError";
  }
}

export interface CivitaiPublicModelFileClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly maxResponseBytes?: number;
  readonly requestTimeoutMs?: number;
}

export interface GetCivitaiPublicModelFileMetadataInput {
  readonly model_id?: number;
  readonly model_version_id: number;
  readonly file_id: number;
}

export interface CivitaiPublicModelFileMetadata {
  readonly metadata_status: "VERIFIED";
  readonly source_kind: "MODEL_PAGE_VERSION_SELECTION" | "MODEL_VERSION_FILE_SELECTION";
  readonly model_id: number;
  readonly model_version_id: number;
  readonly file_id: number;
  readonly model_type: "LORA";
  readonly base_model: string | null;
  readonly version_status: "Published";
  readonly model_availability: "Public";
  readonly version_availability: "Public" | "NOT_REPORTED";
  readonly usage_control: "Download";
  readonly file_type: "Model";
  readonly format: "SafeTensor";
  readonly primary: boolean | null;
  readonly size_kb: number;
  readonly sha256: string;
  readonly virus_scan_result: "Success";
  readonly pickle_scan_result: "Success";
  readonly license_flags: Readonly<{
    allow_commercial_use: string | readonly string[] | null;
    allow_no_credit: boolean | null;
    allow_derivatives: boolean | null;
    allow_different_license: boolean | null;
    legal_approval: "NOT_ESTABLISHED";
  }>;
  readonly download_path: string;
  readonly download_selection: "VERIFIED_SOURCE_SELECTOR" | "NOT_VERIFIED";
  readonly content_attestation: "NOT_CHECKED";
  readonly content_gap: "DYNAMIC_DOWNLOAD_REDIRECT_UNVERIFIED";
}

/** Reads only fixed public metadata routes; metadata never attests to file bytes. */
export class CivitaiPublicModelFileClient {
  readonly #fetch: typeof fetch;
  readonly #maxResponseBytes: number;
  readonly #requestTimeoutMs: number;

  constructor(optionsInput: CivitaiPublicModelFileClientOptions | unknown = {}) {
    const options = exactRecord(optionsInput, ["fetchImpl", "maxResponseBytes", "requestTimeoutMs"], []);
    const fetchImpl = options.fetchImpl === undefined ? globalThis.fetch : options.fetchImpl;
    const maxResponseBytes = options.maxResponseBytes === undefined ? DEFAULT_MAX_RESPONSE_BYTES : options.maxResponseBytes;
    const requestTimeoutMs = options.requestTimeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.requestTimeoutMs;
    if (typeof fetchImpl !== "function" || types.isProxy(fetchImpl) ||
        !Number.isSafeInteger(maxResponseBytes) || (maxResponseBytes as number) < 1_024 ||
        (maxResponseBytes as number) > MAX_RESPONSE_BYTES || !Number.isSafeInteger(requestTimeoutMs) ||
        (requestTimeoutMs as number) < 1 || (requestTimeoutMs as number) > MAX_TIMEOUT_MS) fail("INVALID_INPUT");
    this.#fetch = fetchImpl as typeof fetch;
    this.#maxResponseBytes = maxResponseBytes as number;
    this.#requestTimeoutMs = requestTimeoutMs as number;
  }

  async getPublicLoraFileMetadata(
    input: GetCivitaiPublicModelFileMetadataInput | unknown,
    signal?: AbortSignal
  ): Promise<Readonly<CivitaiPublicModelFileMetadata>> {
    const selection = snapshotSelection(input);
    const version = asRecord(await this.#getJson(`/api/v1/model-versions/${selection.model_version_id}`, signal));
    if (version.id !== selection.model_version_id) fail("VERSION_ID_MISMATCH");
    if (!isPositiveInteger(version.modelId)) fail("FILE_METADATA_INCOMPLETE");
    const modelId = version.modelId;
    if (selection.model_id !== undefined && modelId !== selection.model_id) fail("MODEL_ID_MISMATCH");
    if (version.status !== "Published" || version.usageControl !== "Download" ||
        (version.availability !== undefined && version.availability !== null && version.availability !== "Public")) {
      fail("VERSION_NOT_PUBLIC");
    }

    const model = asRecord(await this.#getJson(`/api/v1/models/${modelId}`, signal));
    if (model.id !== modelId) fail("MODEL_ID_MISMATCH");
    if (model.type !== "LORA") fail("MODEL_NOT_LORA");
    if ((model.status !== undefined && model.status !== "Published") || model.availability !== "Public" ||
        (model.mode !== undefined && model.mode !== null)) fail("MODEL_NOT_PUBLIC");
    const modelVersions = readArray(model.modelVersions, MAX_VERSION_LINKS);
    const linkedVersions = modelVersions.filter((entry) => isRecord(entry) && entry.id === selection.model_version_id);
    if (linkedVersions.length !== 1) fail("MODEL_VERSION_NOT_LINKED");

    const files = readArray(version.files, MAX_FILES);
    const selectedFiles = files.filter((entry) => isRecord(entry) && entry.id === selection.file_id);
    if (selectedFiles.length === 0) fail("FILE_SELECTION_AMBIGUOUS");
    if (selectedFiles.length !== 1) fail("FILE_SELECTION_AMBIGUOUS");
    const file = asRecord(selectedFiles[0]);
    if (file.type !== "Model") fail("FILE_NOT_ELIGIBLE");
    const fileMetadata = asRecord(file.metadata);
    if (fileMetadata.format !== "SafeTensor" || file.virusScanResult !== "Success" || file.pickleScanResult !== "Success") {
      fail("FILE_NOT_ELIGIBLE");
    }
    if (typeof file.sizeKB !== "number" || !Number.isFinite(file.sizeKB) || file.sizeKB <= 0 ||
        typeof asRecord(file.hashes).SHA256 !== "string" || !SHA256.test(asRecord(file.hashes).SHA256 as string) ||
        !(file.primary === undefined || typeof file.primary === "boolean")) fail("FILE_METADATA_INCOMPLETE");
    const download = inspectDownloadPath(file.downloadUrl, selection.model_version_id, selection.file_id);
    const licenseFlags = Object.freeze({
      allow_commercial_use: permissionValue(model.allowCommercialUse),
      allow_no_credit: optionalBoolean(model.allowNoCredit),
      allow_derivatives: optionalBoolean(model.allowDerivatives),
      allow_different_license: optionalBoolean(model.allowDifferentLicense),
      legal_approval: "NOT_ESTABLISHED" as const
    });
    return Object.freeze({
      metadata_status: "VERIFIED", source_kind: selection.model_id === undefined ? "MODEL_VERSION_FILE_SELECTION" : "MODEL_PAGE_VERSION_SELECTION",
      model_id: modelId, model_version_id: selection.model_version_id, file_id: selection.file_id, model_type: "LORA",
      base_model: safeReportedString(version.baseModel, 256),
      version_status: "Published", model_availability: "Public",
      version_availability: version.availability === "Public" ? "Public" : "NOT_REPORTED",
      usage_control: "Download", file_type: "Model",
      format: "SafeTensor", primary: typeof file.primary === "boolean" ? file.primary : null,
      size_kb: file.sizeKB as number, sha256: (asRecord(file.hashes).SHA256 as string).toLowerCase(),
      virus_scan_result: "Success", pickle_scan_result: "Success", license_flags: licenseFlags,
      download_path: download.path, download_selection: download.selection,
      content_attestation: "NOT_CHECKED", content_gap: "DYNAMIC_DOWNLOAD_REDIRECT_UNVERIFIED"
    });
  }

  async #getJson(pathname: string, parentSignal?: AbortSignal): Promise<unknown> {
    const timeoutSignal = AbortSignal.timeout(this.#requestTimeoutMs);
    const signal = parentSignal === undefined ? timeoutSignal : AbortSignal.any([timeoutSignal, parentSignal]);
    let response: Response;
    try {
      response = await waitForSignal(this.#fetch(new URL(pathname, API_ORIGIN), {
        method: "GET", redirect: "error", credentials: "omit", signal,
        headers: { accept: "application/json" }
      }), signal, parentSignal, timeoutSignal);
    } catch (error) {
      if (error instanceof CivitaiPublicModelFileClientError) throw error;
      if (parentSignal?.aborted) fail("REQUEST_ABORTED");
      if (timeoutSignal.aborted) fail("REQUEST_TIMEOUT");
      fail("FETCH_FAILED");
    }
    if (response.redirected || response.status >= 300 && response.status < 400) fail("METADATA_REDIRECT_REJECTED");
    if (!response.ok) fail("HTTP_REJECTED");
    validateHeaders(response.headers, this.#maxResponseBytes);
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json") fail("RESPONSE_SHAPE_INVALID");
    try { return await readBoundedJson(response, this.#maxResponseBytes, signal, parentSignal, timeoutSignal); }
    catch (error) {
      if (error instanceof CivitaiPublicModelFileClientError) throw error;
      if (parentSignal?.aborted) fail("REQUEST_ABORTED");
      if (timeoutSignal.aborted) fail("REQUEST_TIMEOUT");
      fail("RESPONSE_SHAPE_INVALID");
    }
  }
}

function snapshotSelection(value: unknown): Readonly<GetCivitaiPublicModelFileMetadataInput> {
  const fields = exactRecord(value, ["model_id", "model_version_id", "file_id"], ["model_version_id", "file_id"]);
  if ((fields.model_id !== undefined && !isPositiveInteger(fields.model_id)) ||
      !isPositiveInteger(fields.model_version_id) || !isPositiveInteger(fields.file_id)) fail("INVALID_INPUT");
  return Object.freeze({ ...(fields.model_id === undefined ? {} : { model_id: fields.model_id as number }),
    model_version_id: fields.model_version_id as number, file_id: fields.file_id as number });
}

function inspectDownloadPath(
  value: unknown,
  versionId: number,
  fileId: number
): { readonly path: string; readonly selection: "VERIFIED_SOURCE_SELECTOR" | "NOT_VERIFIED" } {
  if (typeof value !== "string" || value.length > 2_048) fail("DOWNLOAD_SELECTION_UNVERIFIABLE");
  let url: URL;
  try { url = new URL(value); } catch { fail("DOWNLOAD_SELECTION_UNVERIFIABLE"); }
  const path = `/api/download/models/${versionId}`;
  if (url.origin !== API_ORIGIN || url.username || url.password || url.hash || url.pathname !== path) {
    fail("DOWNLOAD_SELECTION_UNVERIFIABLE");
  }
  if (value === `${API_ORIGIN}${path}?fileId=${fileId}`) {
    return Object.freeze({ path: `${path}?fileId=${fileId}`, selection: "VERIFIED_SOURCE_SELECTOR" });
  }
  if (value === `${API_ORIGIN}${path}`) return Object.freeze({ path, selection: "NOT_VERIFIED" });
  fail("DOWNLOAD_SELECTION_UNVERIFIABLE");
}

function permissionValue(value: unknown): string | readonly string[] | null {
  if (typeof value === "string" && value.length <= 128 && !/[\u0000-\u001f\u007f]/u.test(value)) return value;
  if (Array.isArray(value) && value.length <= 8 && value.every((item) => typeof item === "string" && item.length <= 32 && !/[\u0000-\u001f\u007f]/u.test(item))) {
    return Object.freeze([...value] as string[]);
  }
  return null;
}

function optionalBoolean(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function safeReportedString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value) ? value : null;
}
function isPositiveInteger(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail("RESPONSE_SHAPE_INVALID");
  return value;
}
function readArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    fail("RESPONSE_SHAPE_INVALID");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) fail("RESPONSE_SHAPE_INVALID");
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]!.value);
}
function validateHeaders(headers: Headers, maximumBodyBytes: number): void {
  let count = 0;
  let byteCount = 0;
  for (const [name, value] of headers) {
    count += 1;
    byteCount += Buffer.byteLength(name, "utf8") + Buffer.byteLength(value, "utf8");
    if (count > MAX_HEADERS || byteCount > MAX_HEADER_BYTES) fail("RESPONSE_HEADERS_INVALID");
    if (name.toLowerCase() === "content-length") {
      if (!/^\d{1,16}$/u.test(value)) fail("RESPONSE_HEADERS_INVALID");
      const declared = Number(value);
      if (!Number.isSafeInteger(declared)) fail("RESPONSE_HEADERS_INVALID");
      if (declared > maximumBodyBytes) fail("RESPONSE_TOO_LARGE");
    }
  }
}
async function readBoundedJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  parentSignal?: AbortSignal,
  timeoutSignal?: AbortSignal
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) fail("RESPONSE_SHAPE_INVALID");
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw abortError(parentSignal, timeoutSignal);
      const { done, value } = await waitForSignal(reader.read(), signal, parentSignal, timeoutSignal);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        fail("RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total))); }
  catch { fail("RESPONSE_SHAPE_INVALID"); }
}

function waitForSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  parentSignal?: AbortSignal,
  timeoutSignal?: AbortSignal
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(parentSignal, timeoutSignal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError(parentSignal, timeoutSignal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}

function abortError(parentSignal?: AbortSignal, timeoutSignal?: AbortSignal): CivitaiPublicModelFileClientError {
  return new CivitaiPublicModelFileClientError(parentSignal?.aborted ? "REQUEST_ABORTED" :
    timeoutSignal?.aborted ? "REQUEST_TIMEOUT" : "REQUEST_ABORTED");
}

function exactRecord(value: unknown, keys: readonly string[], required: readonly string[] = keys): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail("INVALID_INPUT");
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const own = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) ||
        own.some((key) => typeof key !== "string" || !keys.includes(key) || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
        required.some((key) => !Object.hasOwn(descriptors, key))) fail("INVALID_INPUT");
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of own as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch (error) {
    if (error instanceof CivitaiPublicModelFileClientError) throw error;
    fail("INVALID_INPUT");
  }
}

function fail(code: CivitaiPublicModelFileErrorCode): never { throw new CivitaiPublicModelFileClientError(code); }
