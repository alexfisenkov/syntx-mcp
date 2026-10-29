import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { releaseValidatedOwnerWan27R2vImage, validateOwnerWan27R2vImage } from "../src/application/owner-wan27-r2v-image-policy.js";
import { createOwnerWan27R2vOriginalProbe, releaseTrustedOwnerWan27R2vOriginalProbeResult } from "../src/application/owner-wan27-r2v-original-probe.js";
import { createOwnerWan27R2vVideoCropProcessor, releaseTrustedOwnerWan27R2vVideoCropReceipt } from "../src/application/owner-wan27-r2v-video-crop.js";
import { validateOwnerWan27R2vVideoSelection } from "../src/application/owner-wan27-r2v-video-selection.js";
import { OwnerWan27R2vReferenceService } from "../src/application/owner-wan27-r2v-reference-service.js";
import { createOwnerWan27R2vRequestPreparer } from "../src/application/owner-wan27-r2v-request-preparer.js";

const ATTEMPT = "link_wan27_preparer_owner_0123456789";
const OTHER = "link_wan27_preparer_owner_abcdefghij";
const BINDING = Object.freeze({ tenant_id: "wan27-preparer-tenant", subject: "wan27-preparer-owner" });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const run = promisify(execFile);
const MEDIA_TOOLS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function imageBytes(width = 240, height = 240): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function imageReceipt(bytes = imageBytes()) { return validateOwnerWan27R2vImage({ filename: "frame.png", mime_type: "image/png", bytes }); }
function response(value: unknown) { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-r2v-preparer-credential"); } }; }
async function linked(ids: readonly string[], now: () => number): Promise<PerUserLinkService> {
  let index = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${index}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const service = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ids[index++]! });
  for (const id of ids) { await service.createAttempt(BINDING); await service.issueHandoff(BINDING, id); await service.checkAttempt(BINDING, id); }
  return service;
}
function currentInput(attemptId: string, manifest_handle: string, prompt = "Preserve the selected references.") {
  return { attemptId, manifest_handle, model_id: "wan_27_r2v", prompt, parameters: {
    resolution: "1080P", aspect_ratio: "16:9", video_duration: 2, prompt_extend: false, seed: null, native_audio: false
  } };
}
function harness(ids: readonly string[], nowRef: { value: number }) {
  const authPromise = linked(ids, () => nowRef.value);
  const clients = new Map<string, SyntxChatHttpClient>();
  const fetchCounts = new Map<string, number>();
  for (const id of ids) {
    fetchCounts.set(id, 0);
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
      fetchCounts.set(id, (fetchCounts.get(id) ?? 0) + 1);
      const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
      const extension = file.type === "video/mp4" ? "mp4" : "png";
      const url = `https://r2.syntx.ai/wan27/${id}.${extension}`;
      return response({ files: [{ id: `${id}-owned`, filename: file.name, url, mime_type: file.type, content_type: file.type, size: file.size }] });
    } });
    clients.set(id, client);
  }
  return authPromise.then((linkService) => {
    const referenceService = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService,
      resolveClient: (attemptId: string) => clients.get(attemptId), now: () => nowRef.value });
    const preparer = createOwnerWan27R2vRequestPreparer({ binding: BINDING, linkService, referenceService, now: () => nowRef.value });
    return { linkService, referenceService, preparer, fetchCounts, clients };
  });
}
async function makeManifest(referenceService: OwnerWan27R2vReferenceService, attemptId: string, images: readonly Buffer[], videoCount = 0, crop?: unknown) {
  const draft = await referenceService.createManifest({ attemptId, video_reference_count: videoCount });
  for (const bytes of images) { const receipt = imageReceipt(bytes); try { await referenceService.addImage({ manifest_handle: draft.manifest_handle, image: receipt }); }
    finally { releaseValidatedOwnerWan27R2vImage(receipt); } }
  const crops = Array.isArray(crop) ? crop : crop ? [crop] : [];
  for (const selectedCrop of crops) await referenceService.addSelectedVideo({ manifest_handle: draft.manifest_handle, crop: selectedCrop });
  return referenceService.finalizeManifest({ manifest_handle: draft.manifest_handle });
}
function isPreparerError(code: string) { return (error: unknown) => error instanceof Error && "code" in error && error.code === code; }

test("candidate contains a source-reviewed semantic fingerprint and private exact native wire request", async () => {
  const now = { value: 1_000 }; const h = await harness([ATTEMPT, OTHER], now);
  const bytes = imageBytes(), otherBytes = imageBytes(241, 240); const digest = createHash("sha256").update(bytes).digest("hex");
  try {
    const firstManifest = await makeManifest(h.referenceService, ATTEMPT, [bytes, bytes]);
    const secondManifest = await makeManifest(h.referenceService, OTHER, [bytes, bytes]);
    const first = await h.preparer.prepare(currentInput(ATTEMPT, firstManifest.manifest_handle));
    const second = await h.preparer.prepare(currentInput(OTHER, secondManifest.manifest_handle));
    assert.equal(first.status, "prepared"); assert.equal(first.dispatch_allowed, false); assert.equal(first.backend_acceptance, "UNPROVEN");
    assert.equal(first.intent_fingerprint, second.intent_fingerprint);
    assert.notEqual(first.request_fingerprint, second.request_fingerprint);
    assert.notEqual(h.preparer.inspectCandidate(first)?.wire_fingerprint, h.preparer.inspectCandidate(second)?.wire_fingerprint);
    assert.equal(first.input_references.length, 2);
    const request = h.preparer.getPrivateRequest(first);
    assert.deepEqual(Object.keys(request.settings).sort(), ["aspect_ratio", "audio_setting", "duration", "file_urls", "model_type", "native_audio", "prompt_extend", "resolution", "seed", "shot_type", "video_duration"].sort());
    assert.equal("n" in request.settings, false);
    assert.equal(request.settings.model_type, "wan_27_r2v"); assert.equal(request.settings.shot_type, "single");
    assert.equal(request.settings.audio_setting, "auto"); assert.equal(request.settings.duration, 0);
    assert.equal(request.settings.video_duration, 2); assert.deepEqual(request.settings.file_urls, [{ type: "image", url: `https://r2.syntx.ai/wan27/${ATTEMPT}.png` }]);
    assert.equal(first.input_references[0]?.sha256, digest); assert.equal(first.input_references[1]?.sha256, digest);
    const ordered = await h.preparer.prepare(currentInput(ATTEMPT,
      (await makeManifest(h.referenceService, ATTEMPT, [bytes, otherBytes])).manifest_handle));
    const reversed = await h.preparer.prepare(currentInput(ATTEMPT,
      (await makeManifest(h.referenceService, ATTEMPT, [otherBytes, bytes])).manifest_handle));
    assert.notEqual(ordered.intent_fingerprint, reversed.intent_fingerprint);
    assert.deepEqual(ordered.input_references.map((reference) => reference.sha256), [digest, createHash("sha256").update(otherBytes).digest("hex")]);
    assert.deepEqual(reversed.input_references.map((reference) => reference.sha256), [createHash("sha256").update(otherBytes).digest("hex"), digest]);
    assert.equal(JSON.stringify(first).includes(`https://r2.syntx.ai/wan27/${ATTEMPT}.png`), false);
    assert.equal(JSON.stringify(first).includes("Preserve the selected references."), false);
    assert.equal(JSON.stringify(first).includes(firstManifest.manifest_handle), false);
    const captured = await h.preparer.withCapturedNativeReferences(first, async (client, contexts, privateRequest) => {
      await Promise.resolve();
      return { currentClient: client === h.clients.get(ATTEMPT), referenceCount: contexts.length, requestFingerprint: privateRequest.settings.file_urls.length };
    });
    assert.deepEqual(captured, { currentClient: true, referenceCount: 2, requestFingerprint: 1 });
    for (let count = 1; count <= 5; count += 1) {
      const manifest = await makeManifest(h.referenceService, ATTEMPT, Array.from({ length: count }, () => bytes));
      const imageOnly = await h.preparer.prepare(currentInput(ATTEMPT, manifest.manifest_handle));
      assert.equal(imageOnly.input_references.length, count);
      assert.equal(imageOnly.image_reference_count, count);
      assert.equal(imageOnly.selected_video_reference_count, 0);
      assert.equal(h.preparer.getPrivateRequest(imageOnly).settings.duration, 0);
    }
    const sixImageManifest = await makeManifest(h.referenceService, ATTEMPT, Array.from({ length: 6 }, () => bytes));
    const sixImageCandidate = await h.preparer.prepare(currentInput(ATTEMPT, sixImageManifest.manifest_handle));
    assert.equal(sixImageCandidate.image_reference_count, 6);
    assert.equal(sixImageCandidate.selected_video_reference_count, 0);
    assert.equal(sixImageCandidate.input_references.length, 6);
    assert.equal(h.preparer.getPrivateRequest(sixImageCandidate).settings.file_urls.length, 1);
    await assert.rejects(makeManifest(h.referenceService, ATTEMPT, Array.from({ length: 7 }, () => bytes)),
      isPreparerError("CAPACITY_EXCEEDED"));

    const inlinePrompt = `Use <<<https://r2.syntx.ai/wan27/${ATTEMPT}.png>>>; keep <<<https://outside.example/foreign.png>>> as text.`;
    const prompted = await h.preparer.prepare(currentInput(ATTEMPT, firstManifest.manifest_handle, inlinePrompt));
    assert.equal(h.preparer.getPrivateRequest(prompted).prompt, inlinePrompt);
    assert.equal(h.preparer.getPrivateRequest(prompted).settings.file_urls[0]?.url, `https://r2.syntx.ai/wan27/${ATTEMPT}.png`);
    assert.equal(JSON.stringify(prompted).includes(inlinePrompt), false);
    const relinkedPrompt = `Use <<<https://r2.syntx.ai/wan27/${OTHER}.png>>>; keep <<<https://outside.example/foreign.png>>> as text.`;
    const relinked = await h.preparer.prepare(currentInput(OTHER, secondManifest.manifest_handle, relinkedPrompt));
    assert.equal(h.preparer.getPrivateRequest(relinked).prompt, relinkedPrompt);
    assert.equal(prompted.intent_fingerprint, relinked.intent_fingerprint);
    assert.notEqual(prompted.request_fingerprint, relinked.request_fingerprint);
  } finally { await h.preparer.close(); await h.referenceService.close(); bytes.fill(0); otherBytes.fill(0); }
});

test("candidate factory scopes identity, rejects clones and revocation, and close leaves borrowed references open", async () => {
  let now = 1_000; const clock = { value: now }; const h = await harness([ATTEMPT, OTHER], clock);
  const bytes = imageBytes();
  try {
    const manifest = await makeManifest(h.referenceService, ATTEMPT, [bytes]);
    const candidate = await h.preparer.prepare(currentInput(ATTEMPT, manifest.manifest_handle));
    const foreign = createOwnerWan27R2vRequestPreparer({ binding: BINDING, linkService: h.linkService,
      referenceService: h.referenceService, now: () => clock.value });
    try {
      assert.equal(foreign.inspectCandidate(candidate), undefined);
      assert.throws(() => foreign.getPrivateRequest(candidate), isPreparerError("CANDIDATE_UNBOUND"));
      assert.equal(h.preparer.inspectCandidate(structuredClone(candidate)), undefined);
      const originalClient = h.clients.get(ATTEMPT)!;
      h.clients.set(ATTEMPT, new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => response({ files: [] }) }));
      await assert.rejects(h.preparer.revalidateCandidate(candidate), isPreparerError("PRINCIPAL_NOT_LINKED"));
      h.clients.set(ATTEMPT, originalClient);
      await assert.rejects(h.preparer.prepare(new Proxy(currentInput(ATTEMPT, manifest.manifest_handle), { get() { throw new Error("proxy read"); } })),
        isPreparerError("INVALID_REQUEST"));
      await assert.rejects(h.preparer.prepare(currentInput(OTHER, manifest.manifest_handle)), isPreparerError("REFERENCE_UNAVAILABLE"));
      await assert.rejects(h.preparer.withCapturedNativeReferences(candidate, async () => {
        await Promise.resolve();
        await h.linkService.revoke(BINDING, ATTEMPT);
        return "callback-result-must-not-escape";
      }), isPreparerError("PRINCIPAL_NOT_LINKED"));
      await assert.rejects(h.preparer.revalidateCandidate(candidate), isPreparerError("PRINCIPAL_NOT_LINKED"));
      assert.equal(h.fetchCounts.get(ATTEMPT), 1);
    } finally { await foreign.close(); }

    const secondManifest = await makeManifest(h.referenceService, OTHER, [bytes]);
    await h.preparer.close();
    assert.equal(h.referenceService.isOwnedManifest(secondManifest), true);
    assert.strictEqual(await h.referenceService.resolveManifest({ attemptId: OTHER, manifest_handle: secondManifest.manifest_handle }), secondManifest);
  } finally { await h.preparer.close(); await h.referenceService.close(); bytes.fill(0); }
});

test("preparer TTL and attempt invalidation reject stale candidates", async () => {
  const clock = { value: 1_000 }; const h = await harness([ATTEMPT, OTHER], clock); const bytes = imageBytes();
  try {
    const manifest = await makeManifest(h.referenceService, ATTEMPT, [bytes]);
    const candidate = await h.preparer.prepare(currentInput(ATTEMPT, manifest.manifest_handle));
    await h.preparer.invalidateAttempt(ATTEMPT);
    assert.equal(h.preparer.inspectCandidate(candidate), undefined);
    await assert.rejects(h.preparer.revalidateCandidate(candidate), isPreparerError("CANDIDATE_EXPIRED"));
    const otherManifest = await makeManifest(h.referenceService, OTHER, [bytes]);
    const other = await h.preparer.prepare(currentInput(OTHER, otherManifest.manifest_handle));
    clock.value += 15 * 60_000;
    assert.equal(h.preparer.inspectCandidate(other), undefined);
    assert.throws(() => h.preparer.getPrivateRequest(other), isPreparerError("CANDIDATE_EXPIRED"));
  } finally { await h.preparer.close(); await h.referenceService.close(); bytes.fill(0); }
});

test("selected video duration derives from frame-aligned selected seconds and rounds each clip before summing", async (t) => {
  if (!MEDIA_TOOLS) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await run(MEDIA_TOOLS.ffmpeg, ["-version"]); await run(MEDIA_TOOLS.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-r2v-preparer-1555-")), sourcePath = join(directory, "source.mp4");
  const clock = { value: 1_000 }; const h = await harness([ATTEMPT], clock);
  let original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>> | undefined;
  const crops: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>>[] = [];
  const bytes = imageBytes();
  try {
    await run(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]);
    const sourceBytes = new Uint8Array(await readFile(sourcePath));
    original = await createOwnerWan27R2vOriginalProbe({ ffprobePath: MEDIA_TOOLS.ffprobe }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes: sourceBytes });
    sourceBytes.fill(0);
    const processor = createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: MEDIA_TOOLS.ffmpeg, ffprobePath: MEDIA_TOOLS.ffprobe });
    for (const [start_seconds, end_seconds] of [[0.125, 0.25], [0.5, 0.625]] as const) {
      const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds, end_seconds, video_reference_count: 2 });
      crops.push(await processor.crop(original, selection));
    }
    const manifest = await makeManifest(h.referenceService, ATTEMPT, [bytes], 2, crops);
    const candidate = await h.preparer.prepare(currentInput(ATTEMPT, manifest.manifest_handle));
    const request = h.preparer.getPrivateRequest(candidate);
    const rawSelected = crops.map((crop) => crop.metadata.frame_count * crop.metadata.frame_rate.denominator /
      crop.metadata.frame_rate.numerator);
    const selected = rawSelected.map((duration) => Math.round(duration * 100) / 100);
    assert.deepEqual(rawSelected, [0.125, 0.125]);
    assert.deepEqual(selected, [0.13, 0.13]);
    assert.equal(request.settings.duration, 0.26);
    assert.notEqual(request.settings.duration, Math.round(rawSelected.reduce((sum, value) => sum + value, 0) * 100) / 100);
    assert.deepEqual(request.settings.file_urls.map((file: { readonly type: string }) => file.type), ["image", "video"]);
    assert.equal(candidate.input_references[1]?.selected_duration_seconds, rawSelected[0]);
    assert.equal(candidate.input_references[2]?.selected_duration_seconds, rawSelected[1]);
    assert.equal(candidate.input_references[1]?.video_duration_seconds, crops[0]?.metadata.video_duration_seconds);
    assert.equal(candidate.dispatch_allowed, false);
    for (let totalReferences = 1; totalReferences <= 5; totalReferences += 1) {
      const imageCount = totalReferences - 1;
      const sizedManifest = await makeManifest(h.referenceService, ATTEMPT, Array.from({ length: imageCount }, () => bytes), 1, crops[0]);
      const sizedCandidate = await h.preparer.prepare(currentInput(ATTEMPT, sizedManifest.manifest_handle));
      assert.equal(sizedCandidate.input_references.length, totalReferences);
      assert.equal(sizedCandidate.selected_video_reference_count, 1);
      assert.equal(sizedCandidate.image_reference_count, imageCount);
    }
    await assert.rejects(makeManifest(h.referenceService, ATTEMPT, Array.from({ length: 5 }, () => bytes), 1, crops[0]),
      isPreparerError("CAPACITY_EXCEEDED"));
  } finally {
    await h.preparer.close(); await h.referenceService.close();
    for (const crop of crops) releaseTrustedOwnerWan27R2vVideoCropReceipt(crop);
    if (original) releaseTrustedOwnerWan27R2vOriginalProbeResult(original);
    bytes.fill(0); await rm(directory, { recursive: true, force: true });
  }
});
