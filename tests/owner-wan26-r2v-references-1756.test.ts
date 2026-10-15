import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerWan26R2vReferenceService, OwnerWan26R2vReferenceServiceError } from "../src/application/owner-wan26-r2v-reference-service.js";

const ATTEMPT = "link_wan26_r2v_reference_0123456789";
const BINDING = { tenant_id: "wan26-test", subject: "owner" };
const TOOLS = [
  { ffmpegPath: "/opt/homebrew/bin/ffmpeg", ffprobePath: "/opt/homebrew/bin/ffprobe" },
  { ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe" }
].find((tools) => existsSync(tools.ffmpegPath) && existsSync(tools.ffprobePath));
const run = promisify(execFile);
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
  "base64"
);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function image384(): Buffer {
  const bytes = Buffer.from(PNG_1PX);
  bytes.writeUInt32BE(384, 16);
  bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}
function response(file: File, index: number): Response {
  const url = file.name === "duplicate.png"
    ? "https://r2.syntx.ai/test/duplicate"
    : `https://r2.syntx.ai/test/${index}`;
  const mediaType = file.type.startsWith("video/") ? "video" : "image";
  return new Response(JSON.stringify({
    files: [{
      id: index,
      url,
      filename: file.name,
      mime_type: file.type,
      content_type: file.type,
      type: mediaType,
      media_type: mediaType,
      status: "uploaded",
      size: file.size
    }]
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
function broker(): SyntxCredentialBroker {
  return {
    async useCredential<T>(operation: (token: string) => Promise<T>): Promise<T> {
      return operation("synthetic-wan26-reference-token");
    }
  };
}
async function linked(
  attemptIds: readonly string[] = [ATTEMPT],
  binding: typeof BINDING = BINDING
): Promise<PerUserLinkService> {
  let index = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() {
      return { upstream_attempt_id: `synthetic-${index}`, approval_url: "https://example.invalid/" };
    },
    async pollChallenge(_id, receive) {
      await receive({ scheme: "Bearer", value: "synthetic" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => 1_000), {
    now: () => 1_000,
    attemptIdGenerator: () => attemptIds[index++]!
  });
  for (const attemptId of attemptIds) {
    await links.createAttempt(binding);
    await links.issueHandoff(binding, attemptId);
    await links.checkAttempt(binding, attemptId);
  }
  return links;
}

test("ordered mixed references retain ownership, enforce count and drain on invalidation", async (t) => {
  if (!TOOLS) {
    t.skip("ffmpeg/ffprobe pair unavailable");
    return;
  }
  const dir = await mkdtemp(join(tmpdir(), "wan26-r2v-1756-"));
  let uploads = 0;
  const native = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_url, init) => {
      uploads++;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      return response(file, uploads);
    }
  });
  let now = 1_000;
  const links = await linked();
  const svc = new OwnerWan26R2vReferenceService({
    binding: BINDING,
    linkService: links,
    resolveClient: () => native,
    ffmpegPath: TOOLS.ffmpegPath,
    ffprobePath: TOOLS.ffprobePath,
    now: () => now
  });
  const im = image384();
  const video = join(dir, "source.mp4");
  try {
    await run(TOOLS.ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "testsrc=size=384x384:rate=24:duration=3", "-c:v", "libx264",
      "-pix_fmt", "yuv420p", "-an", video
    ]);
    const sourceBytes = new Uint8Array(await readFile(video));
    const imageInput = (filename: string) => ({
      attemptId: ATTEMPT,
      model_id: "wan_26_r2v" as const,
      content_base64: im.toString("base64"),
      filename,
      mime_type: "image/png"
    });
    const videoInput = (start_seconds: number, end_seconds: number, total_reference_count: number) => ({
      attemptId: ATTEMPT,
      model_id: "wan_26_r2v" as const,
      content_base64: Buffer.from(sourceBytes).toString("base64"),
      filename: "source.mp4",
      mime_type: "video/mp4",
      start_seconds,
      end_seconds,
      total_reference_count
    });
    const img1 = await svc.uploadImage(imageInput("one.png"));
    const img2 = await svc.uploadImage(imageInput("two.png"));
    const videos = [];
    for (let index = 0; index < 3; index++) {
      videos.push(await svc.uploadSelectedVideo(videoInput(index, index + 0.8, 5)));
    }
    const handles = [img1.reference_handle, videos[0]!.reference_handle, img2.reference_handle, videos[1]!.reference_handle, videos[2]!.reference_handle];
    const manifest = await svc.resolveManifest({ attempt_id: ATTEMPT, model_id: "wan_26_r2v", reference_handles: handles });
    assert.deepEqual(manifest.references.map((reference) => reference.reference_handle), handles);
    assert.equal(manifest.image_count, 2);
    assert.equal(manifest.video_count, 3);
    assert.equal(manifest.total_reference_count, 5);
    assert.equal(manifest.generation_permit, false);
    assert.equal(svc.isOwnedManifest(manifest), true);
    await assert.rejects(
      svc.resolveManifest({ attempt_id: ATTEMPT, model_id: "wan_26_r2v_flash", reference_handles: [img1.reference_handle] }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE"
    );
    const thirdImage = await svc.uploadImage(imageInput("three.png"));
    await assert.rejects(
      svc.resolveManifest({
        attempt_id: ATTEMPT,
        model_id: "wan_26_r2v",
        reference_handles: [img1.reference_handle, img2.reference_handle, thirdImage.reference_handle]
      }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "REFERENCE_LIMIT_EXCEEDED"
    );
    const fourthVideo = await svc.uploadSelectedVideo(videoInput(0, 0.8, 5));
    await assert.rejects(
      svc.resolveManifest({
        attempt_id: ATTEMPT,
        model_id: "wan_26_r2v",
        reference_handles: [img1.reference_handle, videos[0]!.reference_handle,
          videos[1]!.reference_handle, videos[2]!.reference_handle, fourthVideo.reference_handle]
      }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "REFERENCE_LIMIT_EXCEEDED"
    );
    const overlong = await svc.uploadSelectedVideo(videoInput(0, 2, 1));
    await assert.rejects(svc.resolveManifest({
      attempt_id: ATTEMPT,
      model_id: "wan_26_r2v",
      reference_handles: [img1.reference_handle, img2.reference_handle, overlong.reference_handle]
    }), (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "REFERENCE_LIMIT_EXCEEDED");
    await assert.rejects(svc.resolveManifest({
      attempt_id: ATTEMPT, model_id: "wan_26_r2v", reference_handles: [...handles, handles[0]!]
    }), (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "INVALID_REQUEST");
    const dup1 = await svc.uploadImage(imageInput("duplicate.png"));
    const dup2 = await svc.uploadImage(imageInput("duplicate.png"));
    await assert.rejects(svc.resolveManifest({
      attempt_id: ATTEMPT,
      model_id: "wan_26_r2v",
      reference_handles: [dup1.reference_handle, dup2.reference_handle]
    }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "DUPLICATE_REFERENCE");
    const getterArray = [] as unknown[];
    Object.defineProperty(getterArray, "0", { enumerable: true, get() { throw new Error("must not invoke accessor"); } });
    Object.defineProperty(getterArray, "length", { value: 1 });
    await assert.rejects(svc.resolveManifest({ attempt_id: ATTEMPT, model_id: "wan_26_r2v", reference_handles: getterArray }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "INVALID_REQUEST");
    await assert.rejects(svc.resolveManifest({ attempt_id: ATTEMPT, model_id: "wan_26_r2v", reference_handles: new Proxy([img1.reference_handle], {}) }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "INVALID_REQUEST");
    now += 900_001;
    assert.equal(svc.isOwnedManifest(manifest), false);
    await assert.rejects(svc.resolveManifest({ attempt_id: ATTEMPT, model_id: "wan_26_r2v", reference_handles: handles }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
    await svc.invalidateAttempt(ATTEMPT);
    assert.equal(svc.isOwnedManifest(manifest), false);
    await assert.rejects(svc.withCapturedNativeReferences(manifest, () => null));
    assert.equal(uploads, 10);
    sourceBytes.fill(0);
  } finally { im.fill(0); await svc.close(); await rm(dir, { recursive: true, force: true }); }
});

test("attempt invalidation drains an in-flight native upload without minting a handle", async () => {
  let entered!: () => void, release!: (response: Response) => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const native = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_url, init) => {
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      entered();
      return held;
    }
  });
  const links = await linked();
  const svc = new OwnerWan26R2vReferenceService({
    binding: BINDING,
    linkService: links,
    resolveClient: () => native,
    ffmpegPath: TOOLS?.ffmpegPath ?? "/usr/bin/ffmpeg",
    ffprobePath: TOOLS?.ffprobePath ?? "/usr/bin/ffprobe"
  });
  const bytes = image384();
  try {
    const pending = svc.uploadImage({
      attemptId: ATTEMPT,
      model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"),
      filename: "frame.png",
      mime_type: "image/png"
    });
    await started;
    const invalidation = svc.invalidateAttempt(ATTEMPT);
    await assert.rejects(pending, (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError);
    await invalidation;
    release(response(new File([Uint8Array.from(bytes)], "frame.png", { type: "image/png" }), 1));
    await svc.close();
    await assert.rejects(svc.uploadImage({
      attemptId: ATTEMPT,
      model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"),
      filename: "frame.png",
      mime_type: "image/png"
    }), (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "SERVICE_CLOSED");
  } finally {
    bytes.fill(0);
    await svc.close();
  }
});

test("native signal checks reject proxies and never invoke shadow getters", async () => {
  const links = await linked();
  let requests = 0;
  const native = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_url, init) => {
      requests++;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      return response(file, requests);
    }
  });
  const svc = new OwnerWan26R2vReferenceService({
    binding: BINDING,
    linkService: links,
    resolveClient: () => native,
    ffmpegPath: TOOLS?.ffmpegPath ?? "/usr/bin/ffmpeg",
    ffprobePath: TOOLS?.ffprobePath ?? "/usr/bin/ffprobe"
  });
  const bytes = image384();
  try {
    const input = { attemptId: ATTEMPT, model_id: "wan_26_r2v" as const,
      content_base64: bytes.toString("base64"), filename: "frame.png", mime_type: "image/png" };
    await assert.rejects(svc.uploadImage(input, new Proxy(new AbortController().signal, {}) as AbortSignal),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "INVALID_REQUEST");
    const signal = new AbortController().signal;
    let getterCalls = 0;
    Object.defineProperty(signal, "aborted", { configurable: true, get() { getterCalls++; throw new Error("shadow getter"); } });
    const receipt = await svc.uploadImage(input, signal);
    assert.equal(getterCalls, 0);
    assert.equal(receipt.generation_permit, false);
    assert.equal(requests, 1);
  } finally {
    bytes.fill(0);
    await svc.close();
  }
});

test("repeated close calls share the drain promise and block stale upload handles", async () => {
  let entered!: () => void;
  let release!: (value: Response) => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const held = new Promise<Response>((resolve) => { release = resolve; });
  const native = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_url, init) => {
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      entered();
      return held;
    }
  });
  const links = await linked();
  const svc = new OwnerWan26R2vReferenceService({
    binding: BINDING,
    linkService: links,
    resolveClient: () => native,
    ffmpegPath: TOOLS?.ffmpegPath ?? "/usr/bin/ffmpeg",
    ffprobePath: TOOLS?.ffprobePath ?? "/usr/bin/ffprobe"
  });
  const bytes = image384();
  try {
    const pending = svc.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"), filename: "frame.png", mime_type: "image/png" })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await started;
    const closeOne = svc.close();
    const closeTwo = svc.close();
    assert.equal(closeOne, closeTwo);
    const outcome = await pending;
    await closeOne;
    assert.ok("error" in outcome && outcome.error instanceof OwnerWan26R2vReferenceServiceError);
    release(response(new File([Uint8Array.from(bytes)], "frame.png", { type: "image/png" }), 1));
    await assert.rejects(svc.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"), filename: "frame.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "SERVICE_CLOSED");
  } finally {
    bytes.fill(0);
    await svc.close();
  }
});

test("stale client resolver completion cannot repopulate caches after attempt invalidation", async () => {
  let resolverEntered!: () => void;
  let releaseResolver!: (client: unknown) => void;
  const entered = new Promise<void>((resolve) => { resolverEntered = resolve; });
  const resolverGate = new Promise<unknown>((resolve) => { releaseResolver = resolve; });
  let resolverCalls = 0;
  let requests = 0;
  const nativeOne = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_url, init) => {
      requests++;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      return response(file, requests);
    }
  });
  const nativeTwo = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_url, init) => {
      requests++;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      return response(file, requests);
    }
  });
  const links = await linked();
  const svc = new OwnerWan26R2vReferenceService({
    binding: BINDING,
    linkService: links,
    resolveClient: () => {
      resolverCalls++;
      if (resolverCalls === 1) {
        resolverEntered();
        return resolverGate;
      }
      return nativeTwo;
    },
    ffmpegPath: TOOLS?.ffmpegPath ?? "/usr/bin/ffmpeg",
    ffprobePath: TOOLS?.ffprobePath ?? "/usr/bin/ffprobe"
  });
  const bytes = image384();
  try {
    const pending = svc.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"), filename: "first.png", mime_type: "image/png" })
      .then((value) => ({ value }), (error: unknown) => ({ error }));
    await entered;
    const invalidation = svc.invalidateAttempt(ATTEMPT);
    releaseResolver(nativeOne);
    const result = await pending;
    await invalidation;
    assert.ok("error" in result && result.error instanceof OwnerWan26R2vReferenceServiceError);
    assert.equal(requests, 0);
    const fresh = await svc.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"), filename: "second.png", mime_type: "image/png" });
    assert.equal(fresh.model_id, "wan_26_r2v");
    assert.equal(resolverCalls, 4);
    assert.equal(requests, 1);

    const originalStatus = links.getStatus.bind(links);
    let statusStarted!: () => void;
    let resumeStatus!: () => void;
    const statusEntered = new Promise<void>((resolve) => { statusStarted = resolve; });
    const statusGate = new Promise<void>((resolve) => { resumeStatus = resolve; });
    Object.defineProperty(links, "getStatus", {
      configurable: true,
      value: async (...args: Parameters<PerUserLinkService["getStatus"]>) => {
        statusStarted();
        await statusGate;
        return originalStatus(...args);
      }
    });
    const mutableHandles = [fresh.reference_handle];
    const manifestPromise = svc.resolveManifest({
      attempt_id: ATTEMPT,
      model_id: "wan_26_r2v",
      reference_handles: mutableHandles
    });
    await statusEntered;
    mutableHandles[0] = "wan26ref_mutated-after-snapshot";
    resumeStatus();
    const manifest = await manifestPromise;
    assert.deepEqual(manifest.references.map((reference) => reference.reference_handle), [fresh.reference_handle]);
  } finally {
    bytes.fill(0);
    await svc.close();
  }
});

test("a manifest branded by a different owner service is not consumable", async () => {
  const foreignAttempt = "link_wan26_foreign_reference_0123456789";
  const foreignBinding = { tenant_id: "wan26-foreign", subject: "other-owner" };
  const native = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_url, init) => {
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      return response(file, 1);
    }
  });
  const ownerLinks = await linked();
  const foreignLinks = await linked([foreignAttempt], foreignBinding);
  const options = {
    resolveClient: () => native,
    ffmpegPath: TOOLS?.ffmpegPath ?? "/usr/bin/ffmpeg",
    ffprobePath: TOOLS?.ffprobePath ?? "/usr/bin/ffprobe"
  };
  const ownerService = new OwnerWan26R2vReferenceService({ ...options, binding: BINDING, linkService: ownerLinks });
  const foreignService = new OwnerWan26R2vReferenceService({ ...options, binding: foreignBinding, linkService: foreignLinks });
  const bytes = image384();
  try {
    const foreignReceipt = await foreignService.uploadImage({
      attemptId: foreignAttempt,
      model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"),
      filename: "foreign.png",
      mime_type: "image/png"
    });
    const foreignManifest = await foreignService.resolveManifest({
      attempt_id: foreignAttempt,
      model_id: "wan_26_r2v",
      reference_handles: [foreignReceipt.reference_handle]
    });
    assert.equal(foreignService.isOwnedManifest(foreignManifest), true);
    assert.equal(ownerService.isOwnedManifest(foreignManifest), false);
    await assert.rejects(ownerService.withCapturedNativeReferences(foreignManifest, () => null),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
  } finally {
    bytes.fill(0);
    await Promise.all([ownerService.close(), foreignService.close()]);
  }
});

test("attempt and record capacity is bounded; expired records free capacity before a new upload", async () => {
  const attemptIds = Array.from({ length: 129 }, (_, index) =>
    `link_1756_bound_${String(index).padStart(3, "0")}_abcdefghijk`
  );
  let now = 1_000;
  let requests = 0;
  const native = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_url, init) => {
      requests++;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      return response(file, requests);
    }
  });
  const links = await linked(attemptIds);
  const svc = new OwnerWan26R2vReferenceService({
    binding: BINDING,
    linkService: links,
    resolveClient: () => native,
    ffmpegPath: TOOLS?.ffmpegPath ?? "/usr/bin/ffmpeg",
    ffprobePath: TOOLS?.ffprobePath ?? "/usr/bin/ffprobe",
    now: () => now
  });
  const bytes = image384();
  try {
    for (const attemptId of attemptIds.slice(0, 128)) {
      await svc.uploadImage({ attemptId, model_id: "wan_26_r2v", content_base64: bytes.toString("base64"),
        filename: "same.png", mime_type: "image/png" });
    }
    for (let index = 0; index < 150; index++) {
      await svc.invalidateAttempt(`link_unknown_${String(index).padStart(4, "0")}_abcdefghijk`);
    }
    await assert.rejects(svc.uploadImage({ attemptId: attemptIds[128]!, model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"), filename: "same.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof OwnerWan26R2vReferenceServiceError && error.code === "CAPACITY_EXCEEDED");
    assert.equal(requests, 128);
    now += 900_001;
    const afterExpiry = await svc.uploadImage({ attemptId: attemptIds[128]!, model_id: "wan_26_r2v",
      content_base64: bytes.toString("base64"), filename: "same.png", mime_type: "image/png" });
    assert.equal(afterExpiry.model_id, "wan_26_r2v");
    assert.equal(requests, 129);
  } finally {
    bytes.fill(0);
    await svc.close();
  }
});
