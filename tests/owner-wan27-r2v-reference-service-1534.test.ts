import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import test from "node:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { readOwnerWan27R2vUploadReferenceForClient, type OwnerWan27R2vUploadContext } from "../src/adapter/syntx/wan27-r2v-upload-context.js";
import { validateOwnerWan27R2vImage, readValidatedOwnerWan27R2vImage, releaseValidatedOwnerWan27R2vImage } from "../src/application/owner-wan27-r2v-image-policy.js";
import { createOwnerWan27R2vOriginalProbe, releaseTrustedOwnerWan27R2vOriginalProbeResult } from "../src/application/owner-wan27-r2v-original-probe.js";
import { validateOwnerWan27R2vVideoSelection } from "../src/application/owner-wan27-r2v-video-selection.js";
import { copyTrustedOwnerWan27R2vVideoCropBytes, createOwnerWan27R2vVideoCropProcessor, isTrustedOwnerWan27R2vVideoCropReceipt, releaseTrustedOwnerWan27R2vVideoCropReceipt } from "../src/application/owner-wan27-r2v-video-crop.js";
import {
  OwnerWan27R2vReferenceService, OwnerWan27R2vReferenceServiceError, isOwnerWan27R2vReferenceService
} from "../src/application/owner-wan27-r2v-reference-service.js";

const ATTEMPT = "link_wan27_reference_owner_0123456789";
const OTHER = "link_wan27_reference_owner_abcdefghij";
const BINDING = Object.freeze({ tenant_id: "wan27-reference-tenant", subject: "wan27-reference-owner" });
const URL = "https://r2.syntx.ai/wan27/input.png";
const PNG_1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
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
function png240(): Buffer {
  const bytes = Buffer.from(PNG_1); bytes.writeUInt32BE(240, 16); bytes.writeUInt32BE(240, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function pngDimensions(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG_1); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function response(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } }); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-wan27-reference-credential"); } }; }
async function linked(ids: readonly string[], now = () => 1_000): Promise<PerUserLinkService> {
  let index = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${index}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ids[index++]! });
  for (const id of ids) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  return links;
}
function client(onFetch: (init: RequestInit | undefined) => Promise<Response>) {
  return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => onFetch(init) });
}
function image(bytes = png240()) { return validateOwnerWan27R2vImage({ filename: "кадр.png", mime_type: "image/png", bytes }); }
function uploadedImage() {
  const bytes = png240(); const receipt = image(bytes); return { receipt, bytes };
}
function service(links: PerUserLinkService, resolveClient: (attemptId: string) => unknown, now = () => 1_000) {
  return new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient, now });
}

test("ordered image manifest is owner-bound, finalizes once, and keeps native URLs private", async () => {
  const links = await linked([ATTEMPT]); let posts = 0; let native!: SyntxChatHttpClient;
  native = client(async (init) => { posts++; const form = init?.body as FormData; assert.equal(form.get("model_type"), "wan_27_r2v");
    const file = form.get("files"); assert.ok(file instanceof File); return response({ files: [{ filename: file.name, url: URL, mime_type: "image/png", size: file.size }] }); });
  const svc = service(links, () => native); assert.equal(isOwnerWan27R2vReferenceService(svc), true);
  const first = uploadedImage(), second = uploadedImage(); const callerBytes = Buffer.from(first.bytes);
  try {
    const draft = await svc.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    await svc.addImage({ manifest_handle: draft.manifest_handle, image: first.receipt });
    await svc.addImage({ manifest_handle: draft.manifest_handle, image: second.receipt });
    assert.deepEqual(first.bytes, callerBytes); assert.notEqual(readValidatedOwnerWan27R2vImage(first.receipt), null);
    const manifest = await svc.finalizeManifest({ manifest_handle: draft.manifest_handle });
    assert.equal(svc.isOwnedManifest(manifest), true); assert.equal(manifest.generation_permit, false);
    assert.deepEqual(manifest.references.map((r: { readonly media_type: string }) => r.media_type), ["image", "image"]);
    assert.deepEqual(manifest.references.map((r: { readonly sha256: string }) => r.sha256), [createHash("sha256").update(first.bytes).digest("hex"), createHash("sha256").update(second.bytes).digest("hex")]);
    assert.equal(JSON.stringify(manifest).includes(URL), false);
    assert.deepEqual(await svc.withCapturedNativeReferences(manifest, (_client: SyntxChatHttpClient, contexts: readonly OwnerWan27R2vUploadContext[]) => contexts.map((context) =>
      readOwnerWan27R2vUploadReferenceForClient(_client, context)?.url)), [URL, URL]);
    assert.equal(svc.isOwnedManifest({ ...manifest }), false);
    await assert.rejects(svc.finalizeManifest({ manifest_handle: draft.manifest_handle }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "MANIFEST_UNAVAILABLE");
    await svc.invalidateAttempt(ATTEMPT); assert.equal(svc.isOwnedManifest(manifest), false);
    assert.equal(posts, 2);
  } finally {
    await svc.close(); first.bytes.fill(0); second.bytes.fill(0);
    releaseValidatedOwnerWan27R2vImage(first.receipt); releaseValidatedOwnerWan27R2vImage(second.receipt);
  }
});

test("video count is frozen; incomplete manifests cannot finalize and N=0 rejects video before upload", async () => {
  const links = await linked([ATTEMPT]); let posts = 0;
  const native = client(async () => { posts++; return response({ files: [{ filename: "crop.mp4", url: URL, mime_type: "video/mp4", size: 100, duration: 1 }] }); });
  const svc = service(links, () => native);
  try {
    const zero = await svc.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    await assert.rejects(svc.addSelectedVideo({ manifest_handle: zero.manifest_handle, crop: {} }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "MANIFEST_VIDEO_COUNT_INVALID");
    const one = await svc.createManifest({ attemptId: ATTEMPT, video_reference_count: 1 });
    await assert.rejects(svc.finalizeManifest({ manifest_handle: one.manifest_handle }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "MANIFEST_INCOMPLETE");
    assert.equal(posts, 0);
  } finally { await svc.close(); }
});

test("mixed manifest preserves upload order and admits N=2 genuine measured crops at the 5/N and aggregate caps", async (t) => {
  if (!MEDIA_TOOLS) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await run(MEDIA_TOOLS.ffmpeg, ["-version"]); await run(MEDIA_TOOLS.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-reference-test-")), sourcePath = join(directory, "source.mp4");
  let original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>> | undefined;
  const crops: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>>[] = [];
  const imageReceipt = image();
  const links = await linked([ATTEMPT]); let videoUploads = 0;
  const native = client(async (init) => { const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
    if (file.type === "video/mp4") videoUploads++;
    return response({ files: [{ id: `r2v-${videoUploads}`, url: `https://r2.syntx.ai/wan27/${videoUploads}`, filename: file.name,
      content_type: file.type, size: file.size, ...(file.type === "video/mp4" ? { duration: 2.5 } : {}) }] }); });
  const svc = service(links, () => native);
  try {
    await run(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]);
    const sourceBytes = new Uint8Array(await readFile(sourcePath));
    original = await createOwnerWan27R2vOriginalProbe({ ffprobePath: MEDIA_TOOLS.ffprobe }).probe({ filename: "source.mp4", mime_type: "video/mp4", bytes: sourceBytes });
    sourceBytes.fill(0);
    const processor = createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: MEDIA_TOOLS.ffmpeg, ffprobePath: MEDIA_TOOLS.ffprobe });
    for (const [start_seconds, end_seconds] of [[0, 2.5], [0.5, 3]] as const) {
      const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds, end_seconds, video_reference_count: 2 });
      crops.push(await processor.crop(original, selection));
    }
    assert.deepEqual(crops.map((crop) => crop.metadata.video_duration_seconds), [2.5, 2.5]);
    const draft = await svc.createManifest({ attemptId: ATTEMPT, video_reference_count: 2 });
    const imageItem = await svc.addImage({ manifest_handle: draft.manifest_handle, image: imageReceipt });
    const videoOne = await svc.addSelectedVideo({ manifest_handle: draft.manifest_handle, crop: crops[0]! });
    const videoTwo = await svc.addSelectedVideo({ manifest_handle: draft.manifest_handle, crop: crops[1]! });
    assert.equal(crops.every((crop) => crop.metadata.video_duration_seconds === 2.5), true);
    const borrowedCropBytes = copyTrustedOwnerWan27R2vVideoCropBytes(crops[0]!);
    assert.equal(borrowedCropBytes.byteLength, crops[0]!.bytes); borrowedCropBytes.fill(0);
    assert.equal(isTrustedOwnerWan27R2vVideoCropReceipt(crops[0]), true);
    const manifest = await svc.finalizeManifest({ manifest_handle: draft.manifest_handle });
    assert.deepEqual(manifest.references.map((reference) => reference.reference_handle), [imageItem.reference_handle, videoOne.reference_handle, videoTwo.reference_handle]);
    assert.deepEqual(manifest.references.map((reference) => reference.media_type), ["image", "selected_video", "selected_video"]);
    assert.equal(manifest.video_reference_count, 2); assert.equal(manifest.total_reference_count, 3);
    assert.equal(manifest.references.reduce((sum, reference) => sum + (reference.video_duration_seconds ?? 0), 0), 5);
    assert.equal(manifest.generation_permit, false); assert.equal(videoUploads, 2);
  } finally {
    await svc.close();
    releaseValidatedOwnerWan27R2vImage(imageReceipt);
    for (const crop of crops) releaseTrustedOwnerWan27R2vVideoCropReceipt(crop);
    if (original) releaseTrustedOwnerWan27R2vOriginalProbeResult(original);
    await rm(directory, { recursive: true, force: true });
  }
});

test("revoked owner cannot complete a pending upload or consume a captured manifest; unknown content is not replayed", async () => {
  const links = await linked([ATTEMPT, OTHER]); let posts = 0; let heldAck: ((value: Response) => void) | undefined; let hold = false;
  const native = client(async (init) => {
    posts++; const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
    if (hold) return new Promise<Response>((resolve) => { heldAck = resolve; });
    return response({ files: [{ id: `revoked-${posts}`, url: URL, filename: file.name, content_type: file.type, size: file.size }] });
  });
  const svc = service(links, () => native); const stableImage = image(png240()), uncertainImage = image(pngDimensions(241, 240));
  try {
    const readyDraft = await svc.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    await svc.addImage({ manifest_handle: readyDraft.manifest_handle, image: stableImage });
    const ready = await svc.finalizeManifest({ manifest_handle: readyDraft.manifest_handle });
    const emptyDraft = await svc.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    const uncertainDraft = await svc.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    hold = true;
    const pending = svc.addImage({ manifest_handle: uncertainDraft.manifest_handle, image: uncertainImage });
    for (let turn = 0; !heldAck && turn < 40; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(typeof heldAck, "function");
    await links.revoke(BINDING, ATTEMPT);
    heldAck!(response({ files: [{ id: "ack-after-revoke", url: URL, filename: "кадр.png", content_type: "image/png", size: uncertainImage.size }] }));
    await assert.rejects(pending, (error: unknown) => error instanceof OwnerWan27R2vReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(svc.finalizeManifest({ manifest_handle: emptyDraft.manifest_handle }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    let consumed = 0;
    await assert.rejects(svc.withCapturedNativeReferences(ready, () => { consumed++; }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(consumed, 0);
    const newOwnerAttempt = await svc.createManifest({ attemptId: OTHER, video_reference_count: 0 });
    await assert.rejects(svc.addImage({ manifest_handle: newOwnerAttempt.manifest_handle, image: uncertainImage }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 2);
  } finally { await svc.close(); releaseValidatedOwnerWan27R2vImage(stableImage); releaseValidatedOwnerWan27R2vImage(uncertainImage); }
});

test("ambiguous native upload becomes sticky by owner and content before a replay POST", async () => {
  const links = await linked([ATTEMPT, OTHER]); let posts = 0;
  const native = client(async () => { posts++; throw new Error("synthetic disconnect"); }); const svc = service(links, () => native);
  const source = uploadedImage();
  try {
    const first = await svc.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    await assert.rejects(svc.addImage({ manifest_handle: first.manifest_handle, image: source.receipt }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    const second = await svc.createManifest({ attemptId: OTHER, video_reference_count: 0 });
    await assert.rejects(svc.addImage({ manifest_handle: second.manifest_handle, image: source.receipt }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1); assert.notEqual(readValidatedOwnerWan27R2vImage(source.receipt), null);
  } finally { await svc.close(); source.bytes.fill(0); releaseValidatedOwnerWan27R2vImage(source.receipt); }
});
