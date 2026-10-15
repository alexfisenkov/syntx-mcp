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
import { OwnerWan26R2vReferenceService } from "../src/application/owner-wan26-r2v-reference-service.js";
import {
  createOwnerWan26R2vRequestPreparer,
  isOwnerWan26R2vPreparedCandidate,
  OwnerWan26R2vRequestPreparerError
} from "../src/application/owner-wan26-r2v-request-preparer.js";

const ATTEMPT = "link_wan26_r2v_preparer_0123456789";
const OWNER_ATTEMPT = "link_wan26_r2v_owner_0123456789";
const CLIENT_ATTEMPT = "link_wan26_r2v_client_0123456789";
const BINDING = { tenant_id: "wan26-preparer-test", subject: "owner" };
const TOOLS = [
  { ffmpegPath: "/opt/homebrew/bin/ffmpeg", ffprobePath: "/opt/homebrew/bin/ffprobe" },
  { ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "/usr/bin/ffprobe" }
].find((item) => existsSync(item.ffmpegPath) && existsSync(item.ffprobePath));
const run = promisify(execFile);
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function crc32(bytes: Uint8Array): number {
  let checksum = 0xffff_ffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb8_8320 : 0);
  }
  return (checksum ^ 0xffff_ffff) >>> 0;
}

function image384(): Buffer {
  const bytes = Buffer.from(png);
  bytes.writeUInt32BE(384, 16);
  bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(use: (token: string) => Promise<T>) { return use("synthetic-wan26-preparer-token"); } };
}

function uploadResponse(file: File, index: number): Response {
  const video = file.type.startsWith("video/");
  return new Response(JSON.stringify({ files: [{ id: index, url: `https://r2.syntx.ai/preparer/${index}`,
    filename: file.name, mime_type: file.type, content_type: file.type, type: video ? "video" : "image",
    media_type: video ? "video" : "image", status: "uploaded", size: file.size }] }),
  { status: 200, headers: { "content-type": "application/json" } });
}

async function linked(attemptId = ATTEMPT): Promise<PerUserLinkService> {
  let sequence = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `preparer-${sequence}`, approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => 1_000), {
    now: () => 1_000,
    attemptIdGenerator: () => [attemptId][sequence++]!
  });
  await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, attemptId);
  await links.checkAttempt(BINDING, attemptId);
  return links;
}

function parameters(modelId: "wan_26_r2v" | "wan_26_r2v_flash") {
  return { resolution: "1080P", aspect_ratio: "16:9", video_duration: 6, seed: 0,
    ...(modelId === "wan_26_r2v_flash" ? { native_audio: false } : {}) };
}

test("prepares genuine ordered mixed references for regular and Flash with explicit-only readiness", async (t) => {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "wan26-r2v-preparer-1758-"));
  let uploadCount = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    uploadCount += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return uploadResponse(file, uploadCount);
  } });
  const links = await linked();
  const referenceService = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, ffmpegPath: TOOLS.ffmpegPath, ffprobePath: TOOLS.ffprobePath });
  const preparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService });
  const image = image384();
  const videoPath = join(directory, "source.mp4");
  let sourceBytes: Uint8Array | undefined;
  try {
    await run(TOOLS.ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "testsrc=size=384x384:rate=24:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoPath]);
    sourceBytes = new Uint8Array(await readFile(videoPath));
    const regularImage = await referenceService.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_r2v",
      content_base64: image.toString("base64"), filename: "regular.png", mime_type: "image/png" });
    const regularVideo = await referenceService.uploadSelectedVideo({ attemptId: ATTEMPT, model_id: "wan_26_r2v",
      content_base64: Buffer.from(sourceBytes).toString("base64"), filename: "source.mp4", mime_type: "video/mp4",
      start_seconds: 0, end_seconds: 0.8, total_reference_count: 2 });
    const flashImage = await referenceService.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_r2v_flash",
      content_base64: image.toString("base64"), filename: "flash.png", mime_type: "image/png" });

    let getterCalls = 0;
    const accessorHandles = Object.defineProperty([], "0", {
      enumerable: true,
      get() { getterCalls += 1; return regularImage.reference_handle; }
    });
    await assert.rejects(preparer.prepare({ attemptId: ATTEMPT, model_id: "wan_26_r2v", prompt: "p",
      parameters: parameters("wan_26_r2v"), reference_handles: accessorHandles }),
    (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "INVALID_REQUEST");
    assert.equal(getterCalls, 0);

    const orderedHandles = [regularVideo.reference_handle, regularImage.reference_handle];
    const regularInput = { attemptId: ATTEMPT, model_id: "wan_26_r2v" as const, prompt: "ordinary multi-line\nprompt",
      parameters: parameters("wan_26_r2v"), reference_handles: orderedHandles };
    await Promise.all(Array.from({ length: 128 }, (_, index) =>
      preparer.invalidateAttempt(`link_unknown_attempt_${String(index).padStart(20, "0")}`)));
    const regularPromise = preparer.prepare(regularInput);
    orderedHandles.reverse();
    const regular = await regularPromise;
    assert.equal(isOwnerWan26R2vPreparedCandidate(regular), true);
    assert.equal(regular.source_readiness, "PARTIAL_SOURCE_EXPLICIT_SETTINGS");
    assert.equal(regular.prompt_readiness, "CURRENT_PROMPT_RULES_NOT_ESTABLISHED");
    assert.equal(regular.settings_readiness, "FULL_CURRENT_SETTINGS_NOT_ESTABLISHED");
    assert.equal(regular.dispatch_allowed, false);
    assert.equal(regular.backend_acceptance, "UNPROVEN");
    assert.equal(regular.image_reference_count, 1);
    assert.equal(regular.video_reference_count, 1);
    assert.deepEqual(regular.input_references.map((ref) => ref.media_type), ["selected_video", "image"]);
    const wire = preparer.getPrivateRequest(regular);
    assert.equal(wire.prompt, "ordinary multi-line\nprompt");
    assert.deepEqual(wire.settings.file_urls.map((ref) => ref.type), ["video", "image"]);
    assert.equal(wire.settings.duration, Math.round(regularVideo.selected_duration_seconds! * 100) / 100);
    assert.equal(wire.settings.model_type, "wan_26_r2v");
    assert.equal(JSON.stringify(regular).includes("r2.syntx.ai"), false);
    assert.equal(JSON.stringify(regular).includes("ordinary multi-line"), false);
    assert.equal(preparer.inspectCandidate({ ...regular }), undefined);
    assert.equal(isOwnerWan26R2vPreparedCandidate({ ...regular }), false);
    await assert.rejects(preparer.revalidateCandidate({ ...regular }),
      (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "CANDIDATE_UNBOUND");

    const flash = await preparer.prepare({ attemptId: ATTEMPT, model_id: "wan_26_r2v_flash", prompt: "flash prompt",
      parameters: parameters("wan_26_r2v_flash"), reference_handles: [flashImage.reference_handle] });
    const flashWire = preparer.getPrivateRequest(flash);
    assert.equal(flashWire.settings.model_type, "wan_26_r2v_flash");
    assert.equal(flashWire.settings.native_audio, false);
    assert.equal(flashWire.settings.duration, 0);
    assert.deepEqual(flashWire.settings.file_urls.map((ref) => ref.type), ["image"]);

    const foreignPreparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService });
    await assert.rejects(foreignPreparer.revalidateCandidate(regular),
      (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "CANDIDATE_UNBOUND");
    await foreignPreparer.close();
    await preparer.invalidateAttempt(ATTEMPT);
    assert.equal(isOwnerWan26R2vPreparedCandidate(regular), false);
    await assert.rejects(preparer.revalidateCandidate(regular),
      (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "CANDIDATE_EXPIRED");
  } finally {
    sourceBytes?.fill(0);
    image.fill(0);
    await preparer.close();
    await referenceService.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("candidate expiry follows the monotonic clock", async (t) => {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  let now = 10;
  let uploadCount = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    uploadCount += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return uploadResponse(file, uploadCount);
  } });
  const links = await linked();
  const referenceService = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, ffmpegPath: TOOLS.ffmpegPath, ffprobePath: TOOLS.ffprobePath, now: () => now });
  const preparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService, now: () => now });
  const image = image384();
  try {
    const uploaded = await referenceService.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_r2v",
      content_base64: image.toString("base64"), filename: "ttl.png", mime_type: "image/png" });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: "wan_26_r2v", prompt: "p",
      parameters: parameters("wan_26_r2v"), reference_handles: [uploaded.reference_handle] });
    now += 15 * 60_000;
    await assert.rejects(preparer.revalidateCandidate(candidate),
      (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "CANDIDATE_EXPIRED");
    await preparer.close();
    assert.throws(() => preparer.getPrivateRequest(candidate),
      (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "SERVICE_CLOSED");
  } finally {
    image.fill(0);
    await preparer.close();
    await referenceService.close();
  }
});

test("close shares its drain promise and waits for an in-flight trusted callback", async (t) => {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  let uploadCount = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    uploadCount += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return uploadResponse(file, uploadCount);
  } });
  const links = await linked();
  const referenceService = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: links,
    resolveClient: () => client, ffmpegPath: TOOLS.ffmpegPath, ffprobePath: TOOLS.ffprobePath });
  const preparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService });
  const image = image384();
  try {
    const uploaded = await referenceService.uploadImage({ attemptId: ATTEMPT, model_id: "wan_26_r2v",
      content_base64: image.toString("base64"), filename: "drain.png", mime_type: "image/png" });
    const candidate = await preparer.prepare({ attemptId: ATTEMPT, model_id: "wan_26_r2v", prompt: "p",
      parameters: parameters("wan_26_r2v"), reference_handles: [uploaded.reference_handle] });
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const consuming = preparer.withCapturedNativeReferences(candidate, async () => { enter(); await held; return "done"; });
    await entered;
    const firstInvalidation = preparer.invalidateAttempt(ATTEMPT);
    assert.strictEqual(preparer.invalidateAttempt(ATTEMPT), firstInvalidation);
    await assert.rejects(preparer.prepare({ attemptId: ATTEMPT, model_id: "wan_26_r2v", prompt: "p",
      parameters: parameters("wan_26_r2v"), reference_handles: [uploaded.reference_handle] }),
    (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "REQUEST_ABORTED");
    const firstClose = preparer.close();
    assert.strictEqual(preparer.close(), firstClose);
    let settled = false;
    void firstClose.then(() => { settled = true; });
    await Promise.resolve();
    assert.equal(settled, false);
    release();
    await assert.rejects(consuming,
      (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "SERVICE_CLOSED");
    await firstInvalidation;
    await firstClose;
    assert.equal(settled, true);
    assert.equal(isOwnerWan26R2vPreparedCandidate(candidate), false);
  } finally {
    image.fill(0);
    await preparer.close();
    await referenceService.close();
  }
});

test("fresh owner and native client checks reject revoked or replaced bindings", async (t) => {
  if (!TOOLS) { t.skip("ffmpeg/ffprobe pair unavailable"); return; }
  const image = image384();
  const makeClient = () => new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return uploadResponse(file, 1);
  } });
  const ownerLinks = await linked(OWNER_ATTEMPT);
  const ownerClient = makeClient();
  const ownerReferences = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: ownerLinks,
    resolveClient: () => ownerClient, ffmpegPath: TOOLS.ffmpegPath, ffprobePath: TOOLS.ffprobePath });
  const ownerPreparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: ownerLinks, referenceService: ownerReferences });
  const clientLinks = await linked(CLIENT_ATTEMPT);
  const firstClient = makeClient();
  const replacementClient = makeClient();
  let activeClient = firstClient;
  const clientReferences = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: clientLinks,
    resolveClient: () => activeClient, ffmpegPath: TOOLS.ffmpegPath, ffprobePath: TOOLS.ffprobePath });
  const clientPreparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: clientLinks, referenceService: clientReferences });
  try {
    const ownerUpload = await ownerReferences.uploadImage({ attemptId: OWNER_ATTEMPT, model_id: "wan_26_r2v",
      content_base64: image.toString("base64"), filename: "owner.png", mime_type: "image/png" });
    const ownerCandidate = await ownerPreparer.prepare({ attemptId: OWNER_ATTEMPT, model_id: "wan_26_r2v", prompt: "p",
      parameters: parameters("wan_26_r2v"), reference_handles: [ownerUpload.reference_handle] });
    await ownerLinks.revoke(BINDING, OWNER_ATTEMPT);
    await assert.rejects(ownerPreparer.revalidateCandidate(ownerCandidate),
      (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "PRINCIPAL_NOT_LINKED");

    const clientUpload = await clientReferences.uploadImage({ attemptId: CLIENT_ATTEMPT, model_id: "wan_26_r2v",
      content_base64: image.toString("base64"), filename: "client.png", mime_type: "image/png" });
    const clientCandidate = await clientPreparer.prepare({ attemptId: CLIENT_ATTEMPT, model_id: "wan_26_r2v", prompt: "p",
      parameters: parameters("wan_26_r2v"), reference_handles: [clientUpload.reference_handle] });
    activeClient = replacementClient;
    await assert.rejects(clientPreparer.revalidateCandidate(clientCandidate),
      (error: unknown) => error instanceof OwnerWan26R2vRequestPreparerError && error.code === "REFERENCE_UNAVAILABLE");
  } finally {
    image.fill(0);
    await ownerPreparer.close();
    await ownerReferences.close();
    await clientPreparer.close();
    await clientReferences.close();
  }
});
