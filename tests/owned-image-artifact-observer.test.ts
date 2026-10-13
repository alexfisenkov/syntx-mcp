import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { observeOwnedImageArtifact } from "../src/adapter/syntx/owned-image-artifact-observer.js";

function jpeg(width: number, height: number, progressive = false): Uint8Array {
  return Uint8Array.from([
    0xff, 0xd8,
    0xff, progressive ? 0xc2 : 0xc0, 0x00, 0x11, 0x08,
    (height >>> 8) & 0xff, height & 0xff, (width >>> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x0c, 0x03, 0x01, 0x00, 0x02, 0x11, 0x03, 0x11, 0x00, 0x3f, 0x00,
    0x11, 0xff, 0xd9
  ]);
}

function response(bytes: Uint8Array, headers: Record<string, string> = {}) {
  return {
    ok: true,
    status: 200,
    redirected: false,
    headers: new Headers({ "content-type": "image/jpeg", "content-length": String(bytes.byteLength), ...headers }),
    body: new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(bytes); controller.close(); }
    })
  } as Response;
}

test("observes bytes from one owned JPEG GET and derives 16:9 dimensions", async () => {
  const bytes = jpeg(1792, 1024);
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const result = await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/generated/result.jpg?sig=private", mime_type: "image/jpeg", byte_size: 900 }],
    requestedRatio: "16:9",
    fetchImpl: async (url, init) => { calls.push({ url: String(url), init: init ?? {} }); return response(bytes); }
  });
  assert.deepEqual(result, {
    status: "OBSERVED",
    mime: "image/jpeg",
    declared_mime: "image/jpeg",
    response_mime_type: "image/jpeg",
    byte_size: bytes.byteLength,
    width: 1792,
    height: 1024,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    requested_ratio: "16:9",
    ratio_match: true,
    sdk_metadata: { mime_type: "image/jpeg", byte_size: 900 }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://r2.syntx.ai/generated/result.jpg?sig=private");
  assert.equal(calls[0]?.init.method, "GET");
  assert.equal(calls[0]?.init.redirect, "manual");
  assert.equal(calls[0]?.init.credentials, "omit");
  assert.equal(calls[0]?.init.headers, undefined);
});

test("observes an image without inventing a requested ratio", async () => {
  const bytes = jpeg(1536, 1024);
  const result = await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/generated/result.jpg", mime_type: "image/jpeg" }],
    fetchImpl: async () => response(bytes)
  });
  assert.deepEqual(result, {
    status: "OBSERVED", mime: "image/jpeg", declared_mime: "image/jpeg", response_mime_type: "image/jpeg",
    byte_size: bytes.byteLength, width: 1536, height: 1024,
    sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    ratio_status: "NOT_REQUESTED", sdk_metadata: { mime_type: "image/jpeg" }
  });
});

test("reads progressive JPEG and PNG dimensions while keeping SDK and response MIME metadata separate", async () => {
  const progressive = jpeg(1024, 1024, true);
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ]);
  const observed = await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/result.jpg", mime_type: "image/jpeg", width: 1, height: 1 }],
    requestedRatio: "16:9",
    fetchImpl: async () => response(progressive, { "content-type": "image/jpeg; charset=binary" })
  });
  assert.equal(observed.status, "OBSERVED");
  assert.equal(observed.ratio_match, false);
  assert.deepEqual(observed.sdk_metadata, { mime_type: "image/jpeg", width: 1, height: 1 });
  assert.equal(observed.response_mime_type, "image/jpeg");

  const pngResult = await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/result.png", mime_type: "image/png" }],
    requestedRatio: "1:1",
    fetchImpl: async () => ({ ...response(png), headers: new Headers({ "content-type": "application/octet-stream" }) } as Response)
  });
  assert.equal(pngResult.status, "OBSERVED");
  assert.equal(pngResult.mime, "image/png");
  assert.equal(pngResult.width, 1024);
  assert.equal(pngResult.height, 1024);
  assert.equal(pngResult.response_mime_type, "application/octet-stream");
});

test("rejects ambiguous, external, redirected, oversized, truncated, and MIME-mismatched artifacts with redacted reasons", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response(jpeg(1792, 1024)); };
  assert.deepEqual(await observeOwnedImageArtifact({ artifacts: [], requestedRatio: "16:9", fetchImpl }),
    { status: "UNKNOWN", reason: "ARTIFACT_COUNT_INVALID" });
  assert.deepEqual(await observeOwnedImageArtifact({ artifacts: [
    { url: "https://r2.syntx.ai/a.jpg", mime_type: "image/jpeg" }, { url: "https://r2.syntx.ai/b.jpg", mime_type: "image/jpeg" }
  ], requestedRatio: "16:9", fetchImpl }), { status: "UNKNOWN", reason: "ARTIFACT_COUNT_INVALID" });
  assert.deepEqual(await observeOwnedImageArtifact({ artifacts: [{ url: "https://evil.invalid/a.jpg", mime_type: "image/jpeg" }], requestedRatio: "16:9", fetchImpl }),
    { status: "UNKNOWN", reason: "UNSAFE_ARTIFACT_URL" });
  assert.equal(calls, 0);
  assert.deepEqual(await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/a.jpg", mime_type: "image/jpeg" }], requestedRatio: "16:9",
    fetchImpl: async () => ({ ...response(jpeg(1, 1)), status: 302, ok: false } as Response)
  }), { status: "UNKNOWN", reason: "REDIRECT_REJECTED" });
  assert.deepEqual(await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/a.jpg", mime_type: "image/jpeg" }], requestedRatio: "16:9",
    fetchImpl: async () => ({ ...response(jpeg(1, 1)), headers: new Headers({ "content-length": String(8 * 1024 * 1024 + 1) }) } as Response)
  }), { status: "UNKNOWN", reason: "ARTIFACT_TOO_LARGE" });
  assert.deepEqual(await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/a.jpg", mime_type: "image/png" }], requestedRatio: "16:9",
    fetchImpl: async () => response(jpeg(1792, 1024))
  }), { status: "UNKNOWN", reason: "DECLARED_MIME_MISMATCH" });
  assert.deepEqual(await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/a.jpg", mime_type: "image/jpeg" }], requestedRatio: "16:9",
    fetchImpl: async () => response(Uint8Array.from([0xff, 0xd8, 0xff, 0xc0]))
  }), { status: "UNKNOWN", reason: "IMAGE_BYTES_INVALID" });
});

test("aborts a stalled artifact GET at the fixed 15 second deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  const resultPromise = observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/stalled.jpg", mime_type: "image/jpeg" }],
    requestedRatio: "16:9",
    fetchImpl: async (_url, init) => {
      signal = init?.signal ?? undefined;
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    }
  });
  await context.mock.timers.tick(15_000);
  assert.deepEqual(await resultPromise, { status: "UNKNOWN", reason: "FETCH_TIMEOUT" });
  assert.equal(signal?.aborted, true);
});

test("enforces the 8 MiB cap while streaming when content-length is absent", async () => {
  const result = await observeOwnedImageArtifact({
    artifacts: [{ url: "https://r2.syntx.ai/large.jpg", mime_type: "image/jpeg" }],
    requestedRatio: "16:9",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      redirected: false,
      headers: new Headers({ "content-type": "image/jpeg" }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(4 * 1024 * 1024));
          controller.enqueue(new Uint8Array(4 * 1024 * 1024));
          controller.enqueue(new Uint8Array(1));
          controller.close();
        }
      })
    } as Response)
  });
  assert.deepEqual(result, { status: "UNKNOWN", reason: "ARTIFACT_TOO_LARGE" });
});
