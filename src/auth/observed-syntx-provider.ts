import { TextDecoder } from "node:util";
import { z } from "zod/v4";
import {
  AuthLinkError,
  AuthProviderError,
  OBSERVED_AUTHORIZATION_PROFILE
} from "./types.js";
import type {
  AuthLinkProvider,
  ProviderChallenge,
  ProviderCredentialReceiver,
  ProviderPollOutcome
} from "./types.js";

const DEFAULT_API_BASE_URL = "https://api.syntx.ai/api/v1/";
const ALLOWED_API_ORIGINS = new Set(["https://api.syntx.ai"]);
const REQUIRED_API_BASE_PATH = "/api/v1/";
const MAX_JSON_RESPONSE_BYTES = 32 * 1024;
const TELEGRAM_WEB_HOSTS = new Set(["t.me", "telegram.me"]);
const BOT_DOMAIN = "syntxaibot";

const upstreamAttemptIdSchema = z.uuid();
const startResponseSchema = z.object({ uuid: upstreamAttemptIdSchema }).strict();
const TOKEN_RESPONSE_FIELD = "token" as const;
const bearerCredentialSchema = z
  .string()
  .min(16)
  .max(16_384)
  .refine((value) => !/[\s\u0000-\u001f\u007f]/u.test(value));
const tokenResponseSchema = z.union([
  z.object({ valid: z.literal(true), complete: z.literal(false) }).strict(),
  z
    .object({
      valid: z.literal(true),
      complete: z.literal(true),
      [TOKEN_RESPONSE_FIELD]: bearerCredentialSchema,
      is_new_user: z.boolean()
    })
    .strict(),
  z
    .object({ valid: z.literal(false), complete: z.boolean() })
    .strict()
]);

export type ApprovalTransport = "tg" | "t.me" | "telegram.me";

export interface ObservedSyntxAuthProviderOptions {
  apiBaseUrl?: string;
  approvalTransport?: ApprovalTransport;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
}

/**
 * Adapter for the owner-authorized flow observed on 2026-09-02:
 * POST /api/v1/auth/startauth -> Telegram handoff ->
 * GET /api/v1/auth/token/{uuid}.
 *
 * It is not an OAuth implementation and makes no claim about a public contract.
 */
export class ObservedSyntxAuthProvider implements AuthLinkProvider {
  readonly authorizationProfile = OBSERVED_AUTHORIZATION_PROFILE;

  readonly #apiBaseUrl: URL;
  readonly #approvalTransport: ApprovalTransport;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;

  constructor(options: ObservedSyntxAuthProviderOptions = {}) {
    this.#apiBaseUrl = validateApiBaseUrl(
      options.apiBaseUrl ?? DEFAULT_API_BASE_URL
    );
    this.#approvalTransport = options.approvalTransport ?? "tg";
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    if (
      !Number.isInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 1 ||
      this.#requestTimeoutMs > 60_000
    ) {
      throw new AuthLinkError(
        "INVALID_API_BASE",
        "The authentication request timeout is outside the allowed range."
      );
    }
  }

  async createChallenge(signal?: AbortSignal): Promise<ProviderChallenge> {
    const raw = await this.#requestJson(
      new URL("auth/startauth", this.#apiBaseUrl),
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: "{}",
        cache: "no-store",
        redirect: "error"
      },
      signal
    );
    const parsed = startResponseSchema.safeParse(raw);
    if (!parsed.success) throw malformedProviderResponse();
    const approvalUrl = buildApprovalUrl(
      parsed.data.uuid,
      this.#approvalTransport
    );
    return {
      upstream_attempt_id: parsed.data.uuid,
      approval_url: approvalUrl
    };
  }

  async pollChallenge(
    upstreamAttemptId: string,
    receiveCredential: ProviderCredentialReceiver,
    signal?: AbortSignal
  ): Promise<ProviderPollOutcome> {
    const parsedAttemptId = upstreamAttemptIdSchema.safeParse(upstreamAttemptId);
    if (!parsedAttemptId.success) throw malformedProviderResponse();

    // Deliberately one request per invocation. Scheduling/retries belong to the
    // caller so a single check can never turn into an unbounded poll loop.
    const raw = await this.#requestJson(
      new URL(
        `auth/token/${encodeURIComponent(parsedAttemptId.data)}`,
        this.#apiBaseUrl
      ),
      {
        method: "GET",
        headers: { accept: "application/json" },
        cache: "no-store",
        redirect: "error"
      },
      signal
    );
    const parsed = tokenResponseSchema.safeParse(raw);
    if (!parsed.success) throw malformedProviderResponse();
    if (!parsed.data.valid) return { state: "FAILED_TERMINAL" };
    if (!parsed.data.complete) return { state: "PENDING" };

    try {
      await receiveCredential({ scheme: "Bearer", value: parsed.data.token });
    } catch {
      throw new AuthProviderError(
        "AUTH_PROVIDER_RETRYABLE",
        true,
        "The authentication credential could not be stored."
      );
    }
    return { state: "LINKED" };
  }

  async #requestJson(
    url: URL,
    init: RequestInit,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    assertAllowedApiRequestUrl(url, this.#apiBaseUrl);
    const controller = new AbortController();
    let abortSource: "external" | "timeout" | null = null;
    const abortWith = (source: "external" | "timeout") => {
      if (abortSource === null) abortSource = source;
      controller.abort();
    };
    const abortFromExternal = () => abortWith("external");
    if (externalSignal?.aborted) abortFromExternal();
    externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    const timeout = setTimeout(
      () => abortWith("timeout"),
      this.#requestTimeoutMs
    );
    const abortPromise = new Promise<never>((_resolve, reject) => {
      const rejectForAbort = () =>
        reject(
          abortSource === "external"
            ? requestAbortedError()
            : retryableProviderError()
        );
      controller.signal.addEventListener("abort", rejectForAbort, { once: true });
    });

    try {
      if (controller.signal.aborted) {
        throw abortSource === "external"
          ? requestAbortedError()
          : retryableProviderError();
      }
      const fetchPromise = this.#fetch(url, {
          ...init,
          signal: controller.signal
        })
        .then((response) => {
          if (controller.signal.aborted) cancelResponseBody(response);
          return response;
        });
      const response = await Promise.race([fetchPromise, abortPromise]);
      if (
        response.redirected ||
        response.type === "opaqueredirect" ||
        (response.url.length > 0 && response.url !== url.href)
      ) {
        cancelResponseBody(response);
        throw malformedProviderResponse();
      }
      if (!response.ok) {
        cancelResponseBody(response);
        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        throw new AuthProviderError(
          retryable ? "AUTH_PROVIDER_RETRYABLE" : "AUTH_PROVIDER_TERMINAL",
          retryable,
          retryable
            ? "The authentication provider is temporarily unavailable."
            : "The authentication provider rejected the request."
        );
      }
      const contentType = response.headers
        .get("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase();
      const declaredLengthHeader = response.headers.get("content-length");
      const declaredLength =
        declaredLengthHeader === null ? null : Number(declaredLengthHeader);
      if (
        contentType !== "application/json" ||
        (declaredLength !== null &&
          (!Number.isSafeInteger(declaredLength) ||
            declaredLength < 0 ||
            declaredLength > MAX_JSON_RESPONSE_BYTES))
      ) {
        cancelResponseBody(response);
        throw malformedProviderResponse();
      }
      try {
        return await Promise.race([
          readBoundedJson(response, controller.signal),
          abortPromise
        ]);
      } catch (error) {
        if (error instanceof AuthLinkError) throw error;
        throw malformedProviderResponse();
      }
    } catch (error) {
      if (error instanceof AuthLinkError) throw error;
      throw retryableProviderError();
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromExternal);
    }
  }
}

async function readBoundedJson(
  response: Response,
  signal: AbortSignal
): Promise<unknown> {
  if (response.body === null) throw malformedProviderResponse();
  const reader = response.body.getReader();
  const cancelForAbort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancelForAbort, { once: true });
  if (signal.aborted) cancelForAbort();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > MAX_JSON_RESPONSE_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw malformedProviderResponse();
      }
      chunks.push(Buffer.from(chunk.value));
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.concat(chunks, totalBytes)
      )
    ) as unknown;
  } catch (error) {
    if (error instanceof AuthProviderError) throw error;
    throw malformedProviderResponse();
  } finally {
    signal.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }
}

function cancelResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Best effort only: the normalized provider error must win.
  }
}

function retryableProviderError(): AuthProviderError {
  return new AuthProviderError(
    "AUTH_PROVIDER_RETRYABLE",
    true,
    "The authentication provider request did not complete."
  );
}

function requestAbortedError(): AuthLinkError {
  return new AuthLinkError(
    "AUTH_REQUEST_ABORTED",
    "The authentication request was canceled by the caller."
  );
}

export function validateApiBaseUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidApiBase();
  }
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_API_ORIGINS.has(parsed.origin) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== REQUIRED_API_BASE_PATH ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw invalidApiBase();
  }
  return parsed;
}

export function validateApprovalUrl(
  value: string,
  expectedUpstreamAttemptId: string
): string {
  if (!upstreamAttemptIdSchema.safeParse(expectedUpstreamAttemptId).success) {
    throw invalidApprovalUrl();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw invalidApprovalUrl();
  }
  const expectedStart = `auth_${expectedUpstreamAttemptId}`;
  const safeCommon =
    parsed.username.length === 0 &&
    parsed.password.length === 0 &&
    parsed.port.length === 0 &&
    parsed.hash.length === 0;
  if (!safeCommon) throw invalidApprovalUrl();

  if (parsed.protocol === "https:") {
    const keys = [...parsed.searchParams.keys()];
    if (
      !TELEGRAM_WEB_HOSTS.has(parsed.hostname.toLowerCase()) ||
      parsed.pathname.toLowerCase() !== `/${BOT_DOMAIN}` ||
      keys.length !== 1 ||
      keys[0] !== "start" ||
      parsed.searchParams.getAll("start").length !== 1 ||
      parsed.searchParams.get("start") !== expectedStart
    ) {
      throw invalidApprovalUrl();
    }
    return parsed.href;
  }

  if (parsed.protocol === "tg:") {
    const keys = [...parsed.searchParams.keys()].sort();
    if (
      parsed.hostname.toLowerCase() !== "resolve" ||
      (parsed.pathname !== "" && parsed.pathname !== "/") ||
      keys.length !== 2 ||
      keys[0] !== "domain" ||
      keys[1] !== "start" ||
      parsed.searchParams.getAll("domain").length !== 1 ||
      parsed.searchParams.getAll("start").length !== 1 ||
      parsed.searchParams.get("domain")?.toLowerCase() !== BOT_DOMAIN ||
      parsed.searchParams.get("start") !== expectedStart
    ) {
      throw invalidApprovalUrl();
    }
    return parsed.href;
  }

  throw invalidApprovalUrl();
}

function buildApprovalUrl(
  upstreamAttemptId: string,
  transport: ApprovalTransport
): string {
  const payload = `auth_${upstreamAttemptId}`;
  const value =
    transport === "tg"
      ? `tg://resolve?domain=${BOT_DOMAIN}&start=${encodeURIComponent(payload)}`
      : `https://${transport}/${BOT_DOMAIN}?start=${encodeURIComponent(payload)}`;
  return validateApprovalUrl(value, upstreamAttemptId);
}

function assertAllowedApiRequestUrl(url: URL, base: URL): void {
  if (
    url.protocol !== "https:" ||
    url.origin !== base.origin ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    !(
      url.pathname === "/api/v1/auth/startauth" ||
      /^\/api\/v1\/auth\/token\/[0-9a-f-]{36}$/iu.test(url.pathname)
    )
  ) {
    throw invalidApiBase();
  }
}

function invalidApiBase(): AuthLinkError {
  return new AuthLinkError(
    "INVALID_API_BASE",
    "The SYNTX authentication API base is not allowlisted."
  );
}

function invalidApprovalUrl(): AuthLinkError {
  return new AuthLinkError(
    "INVALID_APPROVAL_URL",
    "The Telegram approval URL is not allowlisted."
  );
}

function malformedProviderResponse(): AuthProviderError {
  return new AuthProviderError(
    "MALFORMED_PROVIDER_RESPONSE",
    false,
    "The authentication provider returned an unsupported response."
  );
}
