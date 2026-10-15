import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerKlingMotionControlPresetReferenceService, OwnerKlingMotionControlPresetReferenceServiceError } from "../src/application/owner-kling-motion-control-preset-reference-service.js";
import { readOwnerKlingMotionControlPresetVideoReferenceForClient } from "../src/application/owner-kling-motion-control-preset-reference-service.js";

const ATTEMPT = "link_mcv_preset_0123456789", BINDING = Object.freeze({ tenant_id: "mcv-preset-test", subject: "owner" });
const NOW = Date.parse("2026-10-15T00:00:00Z"), FFPROBE = process.env.SYNTX_MCV_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (token: string) => Promise<T>) { return fn("synthetic-test-credential"); } }; }
async function linked(now = Date.now()) {
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED", async createChallenge() { return { upstream_attempt_id: "x", approval_url: "https://example.invalid" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-token" }); return { state: "LINKED" }; } };
  const service = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => now), { now: () => now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ATTEMPT });
  await service.createAttempt(BINDING); await service.issueHandoff(BINDING, ATTEMPT); await service.checkAttempt(BINDING, ATTEMPT); return service;
}
async function media() { const dir = await mkdtemp(join(tmpdir(), "syntx-mcv-preset-1623-")), path = join(dir, "selected.mp4");
  execFileSync(process.env.SYNTX_MCV_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:s=320x320:r=24:d=3.4", "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", "-y", path]);
  return { dir, bytes: await readFile(path) }; }
function response(status: number, body: unknown, url = "") { const r = body instanceof Uint8Array ? new Response(Buffer.from(body) as BodyInit, { status }) : Response.json(body, { status }); if (url) Object.defineProperty(r, "url", { value: url }); return r; }

test("native library selection downloads only the chosen actual video and returns a private probed context", async () => {
  const auth = await linked(), clip = await media(); let nativeGets = 0, videoGets = 0, requested = "";
  const actual = "https://r2.syntx.ai/preset/actual.mp4", preview = "https://r2.syntx.ai/preset/preview.mp4";
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 1_000, fetchImpl: async (input) => {
    nativeGets++; assert.equal(new URL(String(input)).pathname, "/api/v1/kling/motions");
    return response(200, [{ name: "Flying", audio: actual, noaudio: actual, audio_preview: preview, noaudio_preview: preview }]);
  } });
  const service = new OwnerKlingMotionControlPresetReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => client, ffprobePath: FFPROBE,
    now: () => NOW, fetchImpl: (async (input, init) => { videoGets++; requested = String(input); assert.equal(init?.method, "GET"); assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "manual");
      assert.equal(init?.referrerPolicy, "no-referrer"); return response(200, new Uint8Array(clip.bytes), requested); }) as typeof fetch });
  try {
    const library = await service.listPresets({ attemptId: ATTEMPT }); assert.equal(nativeGets, 1); assert.equal(library.presets.length, 1);
    assert.equal(JSON.stringify(library).includes("https://"), false);
    const chosen = library.presets[0]!;
    const [receipt, duplicate] = await Promise.all([
      service.selectPreset({ attemptId: ATTEMPT, preset_handle: chosen.preset_handle, variant: "audio" }),
      service.selectPreset({ attemptId: ATTEMPT, preset_handle: chosen.preset_handle, variant: "audio" })
    ]);
    assert.equal(duplicate.preset_video_handle, receipt.preset_video_handle, "concurrent identical selection shares its known safe handle");
    assert.equal(videoGets, 1); assert.equal(requested, actual); assert.equal(receipt.variant, "audio"); assert.equal(receipt.generation_permit, false);
    const input = { attempt_id: ATTEMPT, preset_video_handle: receipt.preset_video_handle }, resolution = await service.resolvePresetVideo(input);
    assert.deepEqual(service.withNativePresetVideo(resolution, input, (nativeClient, context) => readOwnerKlingMotionControlPresetVideoReferenceForClient(nativeClient, context)),
      { uri: actual, sha256: receipt.sha256, duration_seconds: receipt.duration_seconds, variant: "audio" });
    assert.throws(() => service.withNativePresetVideo(Object.freeze({ ...resolution }), input, () => "bad"),
      (e: unknown) => e instanceof OwnerKlingMotionControlPresetReferenceServiceError && e.code === "REFERENCE_EXPIRED");
  } finally { await service.close(); await rm(clip.dir, { recursive: true, force: true }); }
});

test("unverified preset handles, origins, redirects and oversized declared bodies fail closed", async () => {
  const auth = await linked(); let videoGets = 0, uri = "https://cdn.example.invalid/video.mp4", status = 302, contentLength: string | null = null;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 1_000, fetchImpl: async () => response(200, [{ name: "Only", audio: uri }]) });
  const service = new OwnerKlingMotionControlPresetReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => client, ffprobePath: FFPROBE, now: () => NOW,
    fetchImpl: (async (input) => { videoGets++; const r = response(status, new Uint8Array([0]), String(input)); if (contentLength) Object.defineProperty(r, "headers", { value: new Headers({ "content-length": contentLength }) }); return r; }) as typeof fetch });
  try {
    const unverified = await service.listPresets({ attemptId: ATTEMPT });
    assert.equal(unverified.presets.length, 0); assert.equal(unverified.gaps.some((gap) => gap.code === "VARIANT_URL_ORIGIN_UNVERIFIED"), true);
    uri = "https://r2.syntx.ai/video.mp4";
    const list = await service.listPresets({ attemptId: ATTEMPT }), handle = list.presets[0]!.preset_handle;
    await assert.rejects(service.selectPreset({ attemptId: ATTEMPT, preset_handle: "forged", variant: "audio" }),
      (e: unknown) => e instanceof OwnerKlingMotionControlPresetReferenceServiceError && e.code === "PRESET_UNAVAILABLE");
    await assert.rejects(service.selectPreset({ attemptId: ATTEMPT, preset_handle: handle, variant: "audio" }),
      (e: unknown) => e instanceof OwnerKlingMotionControlPresetReferenceServiceError && e.code === "DOWNLOAD_REJECTED");
    assert.equal(videoGets, 1);
    contentLength = String(100 * 1024 * 1024 + 1); status = 200;
    const list2 = await service.listPresets({ attemptId: ATTEMPT });
    await assert.rejects(service.selectPreset({ attemptId: ATTEMPT, preset_handle: list2.presets[0]!.preset_handle, variant: "audio" }),
      (e: unknown) => e instanceof OwnerKlingMotionControlPresetReferenceServiceError && e.code === "DOWNLOAD_LIMIT_EXCEEDED");
    assert.equal(videoGets, 2);
  } finally { await service.close(); }
});

test("selected preset handles are attempt-bound and expire with the local handle TTL", async () => {
  const auth = await linked(), clip = await media(); let now = NOW;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 1_000,
    fetchImpl: async () => response(200, [{ name: "Short", audio: "https://r2.syntx.ai/short.mp4" }]) });
  const service = new OwnerKlingMotionControlPresetReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => client, ffprobePath: FFPROBE, now: () => now,
    fetchImpl: (async (input) => response(200, clip.bytes, String(input))) as typeof fetch });
  try {
    const list = await service.listPresets({ attemptId: ATTEMPT }), preset = list.presets[0]!;
    const receipt = await service.selectPreset({ attemptId: ATTEMPT, preset_handle: preset.preset_handle, variant: "audio" });
    await assert.rejects(service.resolvePresetVideo({ attempt_id: "link_mcv_other_0123456789", preset_video_handle: receipt.preset_video_handle }));
    const input = { attempt_id: ATTEMPT, preset_video_handle: receipt.preset_video_handle }, resolution = await service.resolvePresetVideo(input);
    let captured: unknown;
    service.withNativePresetVideo(resolution, input, (_client, context) => { captured = context; });
    now += 15 * 60_000;
    await assert.rejects(service.resolvePresetVideo(input), (e: unknown) => e instanceof OwnerKlingMotionControlPresetReferenceServiceError && e.code === "REFERENCE_EXPIRED");
    assert.equal(readOwnerKlingMotionControlPresetVideoReferenceForClient(client, captured), null);
  } finally { await service.close(); await rm(clip.dir, { recursive: true, force: true }); }
});

test("aborting a selected-video GET drains the operation without retry", async () => {
  const auth = await linked(); let nativeGets = 0, videoGets = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 1_000, fetchImpl: async () => {
    nativeGets++; return response(200, [{ name: "Once", audio: "https://r2.syntx.ai/once.mp4" }]);
  } });
  const service = new OwnerKlingMotionControlPresetReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => client, ffprobePath: FFPROBE,
    fetchImpl: (async (_input, init) => { videoGets++; return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }); }) as typeof fetch });
  const controller = new AbortController();
  try {
    const presets = await service.listPresets({ attemptId: ATTEMPT });
    const pending = service.selectPreset({ attemptId: ATTEMPT, preset_handle: presets.presets[0]!.preset_handle, variant: "audio" }, controller.signal);
    while (videoGets === 0) await new Promise((resolve) => setImmediate(resolve));
    const draining = service.invalidateAttempt(ATTEMPT); controller.abort();
    await assert.rejects(pending); await draining;
    assert.equal(nativeGets, 1); assert.equal(videoGets, 1);
  } finally { await service.close(); }
});

test("default expiry uses epoch time and a preset context bounds the retained URI lifetime", async () => {
  const auth = await linked(), clip = await media(), originalNow = Date.now; let wall = originalNow(); Date.now = () => wall;
  const uri = "https://r2.syntx.ai/ttl/preset.mp4";
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 1_000, fetchImpl: async () => response(200, [{ name: "TTL", audio: uri }]) });
  const service = new OwnerKlingMotionControlPresetReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => client, ffprobePath: FFPROBE,
    fetchImpl: (async (input) => response(200, clip.bytes, String(input))) as typeof fetch });
  try {
    const list = await service.listPresets({ attemptId: ATTEMPT }); wall += 10 * 60_000;
    const receipt = await service.selectPreset({ attemptId: ATTEMPT, preset_handle: list.presets[0]!.preset_handle, variant: "audio" });
    const input = { attempt_id: ATTEMPT, preset_video_handle: receipt.preset_video_handle }, resolution = await service.resolvePresetVideo(input);
    assert.ok(receipt.expires_in_seconds <= 300, "selected handle does not extend its source library context");
    assert.ok(resolution.expires_at > 1_000_000_000_000, "expiry is compatible with epoch-based callers");
    let captured: unknown;
    service.withNativePresetVideo(resolution, input, (_native, context) => { captured = context; });
    wall += 5 * 60_000 + 1;
    assert.equal(readOwnerKlingMotionControlPresetVideoReferenceForClient(client, captured), null, "reader rechecks the original native preset lifetime");
  } finally { Date.now = originalNow; await service.close(); await rm(clip.dir, { recursive: true, force: true }); }
});

test("canceling a duplicate waiter leaves the shared deferred download alive", async () => {
  const auth = await linked(), clip = await media(); let videoGets = 0, streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const uri = "https://r2.syntx.ai/deferred/actual.mp4";
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), requestTimeoutMs: 1_000, fetchImpl: async () => response(200, [{ name: "Deferred", audio: uri }]) });
  const service = new OwnerKlingMotionControlPresetReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => client, ffprobePath: FFPROBE,
    fetchImpl: (async (_input, init) => { videoGets++; const body = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; }, cancel() {} });
      const r = new Response(body); Object.defineProperty(r, "url", { value: uri });
      init?.signal?.addEventListener("abort", () => { void r.body?.cancel().catch(() => undefined); }, { once: true }); return r; }) as typeof fetch });
  const canceled = new AbortController();
  try {
    const presets = await service.listPresets({ attemptId: ATTEMPT }), handle = presets.presets[0]!.preset_handle;
    const first = service.selectPreset({ attemptId: ATTEMPT, preset_handle: handle, variant: "audio" });
    while (!streamController) await new Promise((resolve) => setImmediate(resolve));
    const duplicate = service.selectPreset({ attemptId: ATTEMPT, preset_handle: handle, variant: "audio" }, canceled.signal);
    canceled.abort();
    const duplicateSettled = await Promise.race([assert.rejects(duplicate).then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100))]);
    assert.equal(videoGets, 1, "duplicate cancellation does not cancel or repeat the owner's GET");
    streamController.enqueue(new Uint8Array(clip.bytes)); streamController.close();
    const receipt = await first; assert.equal(receipt.status, "selected_video_probed"); assert.equal(videoGets, 1);
    assert.equal(duplicateSettled, true, "duplicate cancellation settles promptly while the owner's deferred body remains usable");
  } finally { await service.close(); await rm(clip.dir, { recursive: true, force: true }); }
});
