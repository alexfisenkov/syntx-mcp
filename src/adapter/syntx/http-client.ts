import { TextDecoder } from "node:util";
import { z } from "zod/v4";
import {
  decodeAccountBalance,
  decodeSubscription,
  type SyntxAccountBalance,
  type SyntxSubscription
} from "./account-decoder.js";
import {
  AbsoluteRequestDeadline,
  type RequestAbortSource
} from "./request-deadline.js";
import { parseInternalUploadReferences } from "./upload-reference-bridge.js";

export const OBSERVED_OWNER_AUTHORIZED_HTTP_PROFILE =
  "OBSERVED_OWNER_AUTHORIZED" as const;

const V2_BASE_URL = new URL("https://api.syntx.ai/api/v2/");
const V1_BASE_URL = new URL("https://api.syntx.ai/api/v1/");
const SAFE_IDENTIFIER = /^[A-Za-z0-9._-]{1,160}$/u;
const SAFE_PARAMETER_KEY = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u;
const RESERVED_PARAMETER_KEYS = new Set([
  "ai_name",
  "model_type",
  "__proto__",
  "prototype",
  "constructor"
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_UPLOADED_FILES_MAX_RESPONSE_BYTES = 256 * 1024;
const SAFE_UPLOAD_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u;
const UPLOAD_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/quicktime",
  "audio/mpeg", "audio/wav"
]);

const modelInfoSchema = z
  .object({
    access: z.boolean().nullable(),
    cost: z.number().finite().nonnegative().nullable(),
    discount_cost: z.number().finite().nonnegative().nullable(),
    free_remaining_generations: z.number().finite().nonnegative().nullable(),
    limit: z.number().finite().nonnegative().nullable(),
    show_warning: z.boolean().nullable()
  })
  .strip();

const ELEVENLABS_VOICE_PAGE = 1 as const;
const ELEVENLABS_VOICE_PAGE_SIZE = 10 as const;
const MAX_ELEVENLABS_VOICE_ROWS = 100;
const elevenLabsVoiceRowSchema = z.object({
  voice_id: z.string().min(1).max(160).regex(SAFE_IDENTIFIER),
  name: z.string().min(1).max(256).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value))
}).strip();
const elevenLabsVoiceRowsSchema = z.array(elevenLabsVoiceRowSchema).max(MAX_ELEVENLABS_VOICE_ROWS);
const elevenLabsVoicePageSchema = z.object({
  results: elevenLabsVoiceRowsSchema,
  total: z.number().int().nonnegative().max(1_000_000_000).nullable(),
  page: z.number().int().min(1).max(1000),
  facets: z.unknown().optional()
}).strip().refine((value) => Object.hasOwn(value, "facets") &&
  (value.total === null || value.total >= value.results.length));
const elevenLabsVoiceListRequestSchema = z.strictObject({
  page: z.literal(ELEVENLABS_VOICE_PAGE),
  page_size: z.literal(ELEVENLABS_VOICE_PAGE_SIZE)
});

const uploadedFileText = z.string().max(256).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value));
const uploadedFileSchema = z.object({
  id: z.union([uploadedFileText, z.number().int().nonnegative().max(1_000_000_000_000)]).optional(),
  filename: uploadedFileText.optional(),
  mime_type: uploadedFileText.optional(),
  size: z.number().int().nonnegative().max(1_000_000_000_000).optional(),
  created_at: uploadedFileText.max(64).optional()
}).strip();
const uploadedFilesSchema = z.object({
  page: z.number().int().min(1).max(1000),
  page_size: z.number().int().min(1).max(100),
  has_more: z.boolean(),
  total: z.number().int().nonnegative().max(1_000_000_000).nullable().optional(),
  items: z.array(uploadedFileSchema).max(100)
}).strip();
const uploadResponseSchema = z.object({
  id: z.union([uploadedFileText, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).optional(),
  file_id: z.union([uploadedFileText, z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).optional(),
  status: z.string().regex(SAFE_IDENTIFIER).optional(),
  mime_type: uploadedFileText.optional(),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES).optional()
}).strip().refine((value) => value.id !== undefined || value.file_id !== undefined, {
  message: "Upload response has no file identifier."
});

export type SyntxCostParameter = string | number | boolean;

export interface GetModelInfoRequest {
  ai_name: string;
  model_type: string;
  cost_parameters?: Readonly<Record<string, SyntxCostParameter>> | undefined;
}

export interface SyntxModelInfo {
  access: boolean | null;
  cost: number | null;
  discount_cost: number | null;
  free_remaining_generations: number | null;
  limit: number | null;
  show_warning: boolean | null;
}

export const SYNTX_UPLOADED_FILE_SCOPES = ["all", "uploaded", "hidden"] as const;
export type SyntxUploadedFileScope = (typeof SYNTX_UPLOADED_FILE_SCOPES)[number];
export interface ListUploadedFilesRequest {
  scope: SyntxUploadedFileScope;
  page: number;
  page_size: number;
}
export interface SyntxUploadedFile {
  id?: string;
  filename?: string;
  mime_type?: string;
  size?: number;
  created_at?: string;
}
export interface SyntxUploadedFiles {
  page: number;
  page_size: number;
  has_more: boolean;
  total: number | null;
  items: SyntxUploadedFile[];
}

/** Internal authenticated source rows; voice_id must not cross the public tool barrel. */
export interface SyntxElevenLabsVoice {
  voice_id: string;
  name: string;
}
export interface SyntxElevenLabsVoicePage {
  page: typeof ELEVENLABS_VOICE_PAGE;
  page_size: typeof ELEVENLABS_VOICE_PAGE_SIZE;
  total: number | null;
  has_more: boolean | null;
  voices: SyntxElevenLabsVoice[];
}

export type SyntxJsonShapeType = "null" | "object" | "array" | "string" | "number" | "boolean";
export interface SyntxUploadedFilesShapeSummary {
  decoder_status: "PASS" | "UPSTREAM_PROTOCOL_ERROR";
  top_level: { keys: string[]; types: Record<string, SyntxJsonShapeType> };
  item?: { keys: string[]; types: Record<string, SyntxJsonShapeType> };
}
export interface UploadFileRequest {
  bytes: Uint8Array;
  filename: string;
  mime_type: string;
  model_type: string;
}
export interface UploadFileReceipt {
  status: string;
  file_id: string | null;
  mime_type: string;
  size: number;
}

/**
 * Supplies a tenant-scoped credential only for the duration of one callback.
 * Implementations must not serialize or return the credential outside it.
 */
export interface SyntxCredentialBroker {
  useCredential<T>(
    operation: (credential: string) => Promise<T>
  ): Promise<T>;
}

export interface SyntxHttpClientOptions {
  credentialBroker: SyntxCredentialBroker;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

/**
 * Returns true only for model-info query keys supplied by the caller.
 * Transport-owned keys are always derived from the selected catalog model.
 */
export function isSyntxModelInfoCallerParameterKey(key: string): boolean {
  return (
    SAFE_PARAMETER_KEY.test(key) &&
    !RESERVED_PARAMETER_KEYS.has(key.toLowerCase())
  );
}

export type SyntxHttpErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_REQUIRED"
  | "AUTH_OR_ACCESS_DENIED"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_REQUEST_ABORTED"
  | "UPSTREAM_PROTOCOL_ERROR";

export class SyntxHttpError extends Error {
  constructor(readonly code: SyntxHttpErrorCode, message: string) {
    super(message);
    this.name = "SyntxHttpError";
  }
}

/**
 * Read-only client for the owner-authorized API shape observed on 2026-09-02.
 * This is not presented as a published or version-stable SYNTX API contract.
 */
export class SyntxHttpClient {
  readonly authorizationProfile = OBSERVED_OWNER_AUTHORIZED_HTTP_PROFILE;

  readonly #credentialBroker: SyntxCredentialBroker;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #uploadedFilesMaxResponseBytes: number;

  constructor(options: SyntxHttpClientOptions) {
    this.#credentialBroker = options.credentialBroker;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.#uploadedFilesMaxResponseBytes = options.maxResponseBytes ?? DEFAULT_UPLOADED_FILES_MAX_RESPONSE_BYTES;

    if (
      !Number.isInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 1 ||
      this.#requestTimeoutMs > 60_000 ||
      !Number.isInteger(this.#maxResponseBytes) ||
      this.#maxResponseBytes < 256 ||
      this.#maxResponseBytes > 1024 * 1024
    ) {
      throw invalidRequest();
    }
  }

  async getModelInfo(
    request: GetModelInfoRequest,
    signal?: AbortSignal
  ): Promise<SyntxModelInfo> {
    const url = buildModelInfoUrl(request);
    return this.#withCredential(url, (raw) => {
      const parsed = modelInfoSchema.safeParse(raw);
      if (!parsed.success) throw protocolError();
      return parsed.data;
    }, signal);
  }

  async getAccountBalance(signal?: AbortSignal): Promise<SyntxAccountBalance> {
    return this.#withCredential(
      new URL("user/balance", V1_BASE_URL),
      decodeAccountBalance,
      signal,
      parseAccountBalanceJson
    );
  }

  async getSubscription(signal?: AbortSignal): Promise<SyntxSubscription> {
    const url = new URL("user/subscription", V1_BASE_URL);
    url.searchParams.set("ref", "false");
    return this.#withCredential(url, decodeSubscription, signal);
  }

  async listUploadedFiles(
    request: ListUploadedFilesRequest,
    signal?: AbortSignal
  ): Promise<SyntxUploadedFiles> {
    validateUploadedFilesRequest(request);
    const url = new URL("files/uploaded", V1_BASE_URL);
    url.searchParams.set("scope", request.scope);
    url.searchParams.set("page", String(request.page));
    url.searchParams.set("page_size", String(request.page_size));
    return this.#withCredential(url, (raw) => {
      const parsed = uploadedFilesSchema.safeParse(raw);
      if (!parsed.success || parsed.data.page !== request.page || parsed.data.page_size !== request.page_size) {
        throw protocolError();
      }
      return {
        page: parsed.data.page,
        page_size: parsed.data.page_size,
        has_more: parsed.data.has_more,
        total: parsed.data.total ?? null,
        items: parsed.data.items.map((item) => ({
          ...(item.id === undefined ? {} : { id: String(item.id) }),
          ...(item.filename === undefined ? {} : { filename: item.filename }),
          ...(item.mime_type === undefined ? {} : { mime_type: item.mime_type }),
          ...(item.size === undefined ? {} : { size: item.size }),
          ...(item.created_at === undefined ? {} : { created_at: item.created_at })
        }))
      };
    }, signal, JSON.parse, this.#uploadedFilesMaxResponseBytes);
  }

  async listElevenLabsVoices(
    request: { readonly page: 1; readonly page_size: 10 },
    signal?: AbortSignal
  ): Promise<SyntxElevenLabsVoicePage> {
    const requestParsed = elevenLabsVoiceListRequestSchema.safeParse(request);
    if (!requestParsed.success) throw invalidRequest();
    const url = new URL("audio/elevenlabs/voice_examples", V1_BASE_URL);
    url.searchParams.set("page", String(ELEVENLABS_VOICE_PAGE));
    url.searchParams.set("page_size", String(ELEVENLABS_VOICE_PAGE_SIZE));
    return this.#withCredential(url, (raw) => {
      const parsed = z.union([elevenLabsVoiceRowsSchema, elevenLabsVoicePageSchema]).safeParse(raw);
      if (!parsed.success) throw protocolError();
      if (Array.isArray(parsed.data)) {
        return {
          page: ELEVENLABS_VOICE_PAGE,
          page_size: ELEVENLABS_VOICE_PAGE_SIZE,
          total: null,
          has_more: null,
          voices: parsed.data.map((voice) => ({ voice_id: voice.voice_id, name: voice.name }))
        };
      }
      if (parsed.data.page !== ELEVENLABS_VOICE_PAGE) throw protocolError();
      return {
        page: ELEVENLABS_VOICE_PAGE,
        page_size: ELEVENLABS_VOICE_PAGE_SIZE,
        total: parsed.data.total,
        has_more: parsed.data.total === null ? null : parsed.data.total > parsed.data.results.length,
        voices: parsed.data.results.map((voice) => ({ voice_id: voice.voice_id, name: voice.name }))
      };
    }, signal);
  }

  /** Diagnostic-only shape inspection; never returns response values. */
  async inspectUploadedFilesResponseShape(
    request: ListUploadedFilesRequest,
    signal?: AbortSignal
  ): Promise<SyntxUploadedFilesShapeSummary> {
    validateUploadedFilesRequest(request);
    const url = new URL("files/uploaded", V1_BASE_URL);
    url.searchParams.set("scope", request.scope);
    url.searchParams.set("page", String(request.page));
    url.searchParams.set("page_size", String(request.page_size));
    return this.#withCredential(url, (raw) => {
      const summary = summarizeUploadedFilesShape(raw);
      const parsed = uploadedFilesSchema.safeParse(raw);
      const decoderStatus = parsed.success &&
        parsed.data.page === request.page && parsed.data.page_size === request.page_size
        ? "PASS" : "UPSTREAM_PROTOCOL_ERROR";
      return { decoder_status: decoderStatus, ...summary };
    }, signal);
  }

  async uploadFile(
    request: UploadFileRequest,
    signal?: AbortSignal
  ): Promise<UploadFileReceipt> {
    validateUploadFileRequest(request);
    const bytes = new Uint8Array(request.bytes);
    const form = new FormData();
    form.append("files", new Blob([bytes.buffer], { type: request.mime_type }), request.filename);
    form.append("destination", "hidden");
    form.append("check_duplicates", "true");
    form.append("model_type", request.model_type);
    const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
    const parsed = uploadResponseSchema.safeParse(raw);
    if (parsed.success) {
      if (parsed.data.mime_type !== undefined && parsed.data.mime_type !== request.mime_type) {
        throw protocolError();
      }
      return {
        status: parsed.data.status ?? "accepted",
        file_id: String(parsed.data.file_id ?? parsed.data.id),
        mime_type: parsed.data.mime_type ?? request.mime_type,
        size: parsed.data.size ?? bytes.byteLength
      };
    }
    try {
      parseInternalUploadReferences(raw);
    } catch {
      throw protocolError();
    }
    return {
      status: "accepted",
      file_id: null,
      mime_type: request.mime_type,
      size: bytes.byteLength
    };
  }

  async #withCredential<T>(
    url: URL,
    decode: (raw: unknown) => T,
    signal?: AbortSignal,
    parse: (text: string) => unknown = JSON.parse,
    responseByteLimit = this.#maxResponseBytes
  ): Promise<T> {
    const deadline = new AbsoluteRequestDeadline(
      this.#requestTimeoutMs,
      signal,
      abortError
    );
    try {
      deadline.throwIfAborted();
      const brokerOperation = this.#credentialBroker.useCredential(
        async (credential) => {
          deadline.throwIfAborted();
          validateCredential(credential);
          return this.#request(url, credential, deadline, decode, parse, responseByteLimit);
        }
      );
      return await deadline.waitFor(brokerOperation);
    } catch (error) {
      if (error instanceof SyntxHttpError) throw error;
      throw new SyntxHttpError(
        "AUTH_REQUIRED",
        "A linked SYNTX account is required for this request."
      );
    } finally {
      deadline.close();
    }
  }

  async #request<T>(
    url: URL,
    credential: string,
    deadline: AbsoluteRequestDeadline,
    decode: (raw: unknown) => T,
    parse: (text: string) => unknown,
    responseByteLimit: number
  ): Promise<T> {
    assertReadUrl(url);

    try {
      deadline.throwIfAborted();
      const fetchPromise = this.#fetch(url, {
          method: "GET",
          headers: {
            accept: "application/json",
            authorization: `Bearer ${credential}`
          },
          cache: "no-store",
          redirect: "error",
          signal: deadline.signal
        })
        .then((response) => {
          if (deadline.signal.aborted) cancelResponseBody(response);
          return response;
        });
      const response = await deadline.waitFor(fetchPromise);

      if (
        response.redirected ||
        response.type === "opaqueredirect" ||
        (response.url.length > 0 && response.url !== url.href)
      ) {
        cancelResponseBody(response);
        throw protocolError();
      }
      if (!response.ok) {
        cancelResponseBody(response);
        throw mapHttpFailure(response.status);
      }
      const mediaType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
        cancelResponseBody(response);
        throw protocolError();
      }

      const bytes = await deadline.waitFor(
        readBoundedBody(
          response,
          responseByteLimit,
          deadline.signal
        )
      );
      let raw: unknown;
      try {
        raw = parse(
          new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        ) as unknown;
      } catch {
        throw protocolError();
      }
      try {
        return decode(raw);
      } catch {
        throw protocolError();
      }
    } catch (error) {
      if (error instanceof SyntxHttpError) throw error;
      if (deadline.abortSource !== null) {
        throw abortError(deadline.abortSource);
      }
      throw unavailableError();
    }
  }

  async #requestUpload(
    url: URL,
    form: FormData,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    if (url.protocol !== "https:" || url.origin !== V1_BASE_URL.origin ||
      url.pathname !== "/api/v1/chats/upload-files" || url.search !== "") {
      throw invalidRequest();
    }
    const deadline = new AbsoluteRequestDeadline(this.#requestTimeoutMs, externalSignal, abortError);
    let credentialCallbackEntered = false;
    try {
      const operation = this.#credentialBroker.useCredential(async (credential) => {
        credentialCallbackEntered = true;
        validateCredential(credential);
        deadline.throwIfAborted();
        const response = await deadline.waitFor(this.#fetch(url, {
          method: "POST",
          headers: { accept: "application/json", authorization: `Bearer ${credential}` },
          body: form,
          cache: "no-store",
          redirect: "error",
          signal: deadline.signal
        }));
        if (response.redirected || response.type === "opaqueredirect" || (response.url.length > 0 && response.url !== url.href)) {
          cancelResponseBody(response);
          throw protocolError();
        }
        if (!response.ok) {
          cancelResponseBody(response);
          throw mapHttpFailure(response.status);
        }
        const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
          cancelResponseBody(response);
          throw protocolError();
        }
        const bytes = await deadline.waitFor(readBoundedBody(response, this.#maxResponseBytes, deadline.signal));
        try {
          return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
        } catch {
          throw protocolError();
        }
      });
      return await deadline.waitFor(operation);
    } catch (error) {
      if (error instanceof SyntxHttpError) throw error;
      if (!credentialCallbackEntered) throw new SyntxHttpError("AUTH_REQUIRED", "A linked SYNTX account is required for this request.");
      throw unavailableError();
    } finally {
      deadline.close();
    }
  }
}

/**
 * Native reviver source retains the root balance's original numeric token.
 * Never trust the already-rounded JS number (including underflow to zero).
 * Exponents are deliberately unsupported; decimal tokens and strings keep
 * their digits. Older engines without reviver source fail closed for numbers.
 */
function parseAccountBalanceJson(text: string): unknown {
  const sources = new WeakMap<object, string | undefined>();
  const raw: unknown = JSON.parse(text, function (
    this: object,
    key: string,
    value: unknown,
    context?: { source?: string }
  ): unknown {
    if (key === "balance" && typeof value === "number") {
      sources.set(this, context?.source);
    }
    return value;
  });
  if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
    const balance = Object.getOwnPropertyDescriptor(raw, "balance");
    if (balance && "value" in balance && typeof balance.value === "number") {
      const source = sources.get(raw);
      if (
        typeof source !== "string" || source.length > 128 ||
        !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(source)
      ) throw protocolError();
      Object.defineProperty(raw, "balance", { ...balance, value: source });
    }
  }
  return raw;
}

export function buildModelInfoUrl(request: GetModelInfoRequest): URL {
  validateIdentifier(request.ai_name);
  validateIdentifier(request.model_type);
  const entries = Object.entries(request.cost_parameters ?? {});
  if (entries.length > 32) throw invalidRequest();

  const url = new URL("get_model_info", V2_BASE_URL);
  url.searchParams.set("ai_name", request.ai_name);
  url.searchParams.set("model_type", request.model_type);
  for (const [key, value] of entries.sort(([left], [right]) =>
    left.localeCompare(right)
  )) {
    if (!isSyntxModelInfoCallerParameterKey(key)) {
      throw invalidRequest();
    }
    url.searchParams.append(key, normalizeCostParameter(value));
  }
  assertModelInfoUrl(url);
  return url;
}

function normalizeCostParameter(value: SyntxCostParameter): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
      throw invalidRequest();
    }
    return String(value);
  }
  if (
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw invalidRequest();
  }
  return value;
}

function validateIdentifier(value: string): void {
  if (!SAFE_IDENTIFIER.test(value)) throw invalidRequest();
}

function validateCredential(value: string): void {
  if (
    value.length < 16 ||
    value.length > 16_384 ||
    /[\s\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new SyntxHttpError(
      "AUTH_REQUIRED",
      "A linked SYNTX account is required for this request."
    );
  }
}

function assertModelInfoUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.origin !== V2_BASE_URL.origin ||
    url.pathname !== "/api/v2/get_model_info" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    url.searchParams.getAll("ai_name").length !== 1 ||
    url.searchParams.getAll("model_type").length !== 1
  ) {
    throw invalidRequest();
  }
}

function assertReadUrl(url: URL): void {
  if (url.pathname === "/api/v2/get_model_info") {
    assertModelInfoUrl(url);
    return;
  }
  if (
    url.origin !== V1_BASE_URL.origin || url.protocol !== "https:" ||
    url.username !== "" || url.password !== "" || url.hash !== "" ||
    !(
      (url.pathname === "/api/v1/user/balance" && url.search === "") ||
      (url.pathname === "/api/v1/user/subscription" && url.search === "?ref=false") ||
      (url.pathname === "/api/v1/files/uploaded" && /^\?scope=(?:all|uploaded|hidden)&page=\d{1,4}&page_size=\d{1,3}$/u.test(url.search)) ||
      (url.pathname === "/api/v1/audio/elevenlabs/voice_examples" && url.search === "?page=1&page_size=10")
    )
  ) throw invalidRequest();
}

function validateUploadedFilesRequest(request: ListUploadedFilesRequest): void {
  if (
    !SYNTX_UPLOADED_FILE_SCOPES.includes(request.scope) ||
    !Number.isInteger(request.page) || request.page < 1 || request.page > 1000 ||
    !Number.isInteger(request.page_size) || request.page_size < 1 || request.page_size > 100
  ) throw invalidRequest();
}

function validateUploadFileRequest(request: UploadFileRequest): void {
  if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength < 1 || request.bytes.byteLength > MAX_UPLOAD_BYTES) throw invalidRequest();
  if (!SAFE_UPLOAD_FILENAME.test(request.filename) || /[\\/]/u.test(request.filename)) throw invalidRequest();
  if (!UPLOAD_MIME_TYPES.has(request.mime_type)) throw invalidRequest();
  validateIdentifier(request.model_type);
}

function summarizeUploadedFilesShape(value: unknown): Omit<SyntxUploadedFilesShapeSummary, "decoder_status"> {
  const topLevel = summarizeRecordShape(value);
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return { top_level: topLevel };
  }
  const firstItem = value.items.find(isRecord);
  return firstItem === undefined
    ? { top_level: topLevel }
    : { top_level: topLevel, item: summarizeRecordShape(firstItem) };
}

function summarizeRecordShape(value: unknown): {
  keys: string[];
  types: Record<string, SyntxJsonShapeType>;
} {
  if (!isRecord(value)) return { keys: [], types: {} };
  const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
  const types: Record<string, SyntxJsonShapeType> = {};
  for (const key of keys) types[key] = jsonShapeType(value[key]);
  return { keys, types };
}

function jsonShapeType(value: unknown): SyntxJsonShapeType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "object": return "object";
    case "string": return "string";
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "string";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxResponseBytes) {
      cancelResponseBody(response);
      throw protocolError();
    }
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const cancelForAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancelForAbort, { once: true });
  if (signal.aborted) cancelForAbort();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxResponseBytes) {
        void reader.cancel().catch(() => undefined);
        throw protocolError();
      }
      chunks.push(item.value);
    }
  } finally {
    signal.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function cancelResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Best effort only: the safe protocol error must win over cleanup failures.
  }
}

function mapHttpFailure(status: number): SyntxHttpError {
  if (status === 401 || status === 403) {
    return new SyntxHttpError(
      "AUTH_OR_ACCESS_DENIED",
      "The linked SYNTX account did not authorize this request."
    );
  }
  if (status === 429) {
    return new SyntxHttpError(
      "UPSTREAM_RATE_LIMITED",
      "SYNTX temporarily rate-limited this request."
    );
  }
  if (status === 408 || status === 504) {
    return timeoutError();
  }
  return new SyntxHttpError(
    "UPSTREAM_UNAVAILABLE",
    "SYNTX is temporarily unavailable for this request."
  );
}

function invalidRequest(): SyntxHttpError {
  return new SyntxHttpError(
    "INVALID_REQUEST",
    "The SYNTX request parameters are invalid."
  );
}

function protocolError(): SyntxHttpError {
  return new SyntxHttpError(
    "UPSTREAM_PROTOCOL_ERROR",
    "SYNTX returned an unsupported response."
  );
}

function timeoutError(): SyntxHttpError {
  return new SyntxHttpError(
    "UPSTREAM_TIMEOUT",
    "The SYNTX request did not complete within the allowed time."
  );
}

function requestAbortedError(): SyntxHttpError {
  return new SyntxHttpError(
    "UPSTREAM_REQUEST_ABORTED",
    "The SYNTX request was canceled by the caller."
  );
}

function abortError(source: RequestAbortSource): SyntxHttpError {
  return source === "external" ? requestAbortedError() : timeoutError();
}

function unavailableError(): SyntxHttpError {
  return new SyntxHttpError(
    "UPSTREAM_UNAVAILABLE",
    "SYNTX is temporarily unavailable for this request."
  );
}
