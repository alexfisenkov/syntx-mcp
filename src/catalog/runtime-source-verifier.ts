import { createHash } from "node:crypto";
import {
  runtimeCapabilityOverlaySchema,
  type RuntimeCapabilityOverlay
} from "./runtime-capability-catalog.js";

const JAVASCRIPT_MEDIA_TYPES = new Set([
  "application/javascript",
  "text/javascript",
  "application/x-javascript"
]);

export type RuntimeSourceVerificationErrorCode =
  | "SOURCE_FETCH_FAILED"
  | "SOURCE_REDIRECTED"
  | "SOURCE_MEDIA_TYPE_INVALID"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_HASH_MISMATCH";

export class RuntimeSourceVerificationError extends Error {
  constructor(readonly code: RuntimeSourceVerificationErrorCode) {
    super("A recorded SYNTX runtime source could not be verified.");
    this.name = "RuntimeSourceVerificationError";
  }
}

export interface RuntimeSourceVerificationResult {
  verified_count: number;
  manifest_matches: true;
}

export interface VerifyRuntimeSourcesOptions {
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxArtifactBytes?: number;
}

/**
 * Re-fetches only the exact public first-party URLs recorded in the validated
 * overlay. Bodies are hashed while bounded and are never returned or logged.
 */
export async function verifyRuntimeSourceArtifacts(
  overlay: RuntimeCapabilityOverlay,
  options: VerifyRuntimeSourcesOptions = {}
): Promise<RuntimeSourceVerificationResult> {
  const validated = runtimeCapabilityOverlaySchema.parse(overlay);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const maxArtifactBytes = options.maxArtifactBytes ?? 16 * 1024 * 1024;

  if (
    !Number.isInteger(requestTimeoutMs) ||
    requestTimeoutMs < 1 ||
    requestTimeoutMs > 60_000 ||
    !Number.isInteger(maxArtifactBytes) ||
    maxArtifactBytes < 1_024 ||
    maxArtifactBytes > 64 * 1024 * 1024
  ) {
    throw new TypeError("Runtime source verifier bounds are invalid.");
  }

  for (const artifact of validated.source_artifacts) {
    await verifyArtifact(
      artifact.url,
      artifact.sha256,
      fetchImpl,
      requestTimeoutMs,
      maxArtifactBytes
    );
  }

  return {
    verified_count: validated.source_artifacts.length,
    manifest_matches: true
  };
}

async function verifyArtifact(
  url: string,
  expectedHash: string,
  fetchImpl: typeof fetch,
  requestTimeoutMs: number,
  maxArtifactBytes: number
): Promise<void> {
  const deadline = new VerificationDeadline(requestTimeoutMs);
  let response: Response;
  try {
    response = await deadline.waitFor(
      fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/javascript" },
        credentials: "omit",
        redirect: "manual",
        cache: "no-store",
        signal: deadline.signal
      })
    );
  } catch {
    deadline.close();
    throw new RuntimeSourceVerificationError("SOURCE_FETCH_FAILED");
  }

  try {
    if (response.status >= 300 && response.status <= 399) {
      cancelBody(response.body);
      throw new RuntimeSourceVerificationError("SOURCE_REDIRECTED");
    }
    if (!response.ok) {
      cancelBody(response.body);
      throw new RuntimeSourceVerificationError("SOURCE_FETCH_FAILED");
    }
    if (response.url !== url) {
      cancelBody(response.body);
      throw new RuntimeSourceVerificationError("SOURCE_REDIRECTED");
    }
    const mediaType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType === undefined || !JAVASCRIPT_MEDIA_TYPES.has(mediaType)) {
      cancelBody(response.body);
      throw new RuntimeSourceVerificationError("SOURCE_MEDIA_TYPE_INVALID");
    }

    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (
        !Number.isSafeInteger(parsedLength) ||
        parsedLength < 0 ||
        parsedLength > maxArtifactBytes
      ) {
        cancelBody(response.body);
        throw new RuntimeSourceVerificationError("SOURCE_TOO_LARGE");
      }
    }

    if (!response.body) {
      throw new RuntimeSourceVerificationError("SOURCE_FETCH_FAILED");
    }
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let totalBytes = 0;
    try {
      while (true) {
        const item = await deadline.waitFor(reader.read());
        if (item.done) break;
        totalBytes += item.value.byteLength;
        if (totalBytes > maxArtifactBytes) {
          cancelReader(reader);
          throw new RuntimeSourceVerificationError("SOURCE_TOO_LARGE");
        }
        hash.update(item.value);
      }
    } catch (error) {
      cancelReader(reader);
      if (error instanceof RuntimeSourceVerificationError) throw error;
      throw new RuntimeSourceVerificationError("SOURCE_FETCH_FAILED");
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // A hostile injected stream may retain a pending read after timeout.
      }
    }

    if (`sha256:${hash.digest("hex")}` !== expectedHash) {
      throw new RuntimeSourceVerificationError("SOURCE_HASH_MISMATCH");
    }
  } finally {
    deadline.close();
  }
}

class VerificationDeadline {
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
