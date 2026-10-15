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
import { OWNER_KLING_MOTION_CONTROL_REFERENCE_INPUT_LIMITS, OwnerKlingMotionControlReferenceService, OwnerKlingMotionControlReferenceServiceError } from "../src/application/owner-kling-motion-control-reference-service.js";

const ATTEMPT = "link_mcv_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "mcv-reference-test", subject: "owner" });
const NOW = Date.parse("2026-10-15T00:00:00.000Z");
const FFMPEG = process.env.SYNTX_MCV_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.SYNTX_MCV_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";

function crc32(bytes: Uint8Array): number { let c = 0xffff_ffff; for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb8_8320 : 0); } return (c ^ 0xffff_ffff) >>> 0; }
function png300(): Buffer { const b = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64"); b.writeUInt32BE(300, 16); b.writeUInt32BE(300, 20); b.writeUInt32BE(crc32(b.subarray(12, 29)), 29); return b; }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(f: (token: string) => Promise<T>) { return f("synthetic-mcv-test-token"); } }; }
async function linked(ids: readonly string[] = [ATTEMPT]) {
  let next = 0; const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `test-${next}`, approval_url: "https://example.invalid" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-link-token" }); return { state: "LINKED" }; } };
  const store = new InMemoryAuthLinkStore(() => NOW); const service = new PerUserLinkService(provider, store, { now: () => NOW,
    defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ids[next++]! });
  for (const id of ids) { await service.createAttempt(BINDING); await service.issueHandoff(BINDING, id); await service.checkAttempt(BINDING, id); }
  return service;
}
async function videoFile() {
  const dir = await mkdtemp(join(tmpdir(), "syntx-mcv-ref-1616-")); const path = join(dir, "motion.mp4");
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=320x320:r=24:d=3.2",
    "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", "-y", path]);
  return { dir, bytes: await readFile(path) };
}
function makeClient(onUpload: (file: File, model: FormDataEntryValue | null) => Promise<Response>) {
  return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    const form = init?.body as FormData; const file = form.get("files"); assert.ok(file instanceof File);
    assert.equal(form.get("destination"), "uploaded"); assert.equal(form.get("check_duplicates"), "true");
    return onUpload(file, form.get("model_type"));
  }, requestTimeoutMs: 1_000 });
}
function response(file: File, url: string): Response { return Response.json({ files: [{ filename: file.name, url, mime_type: file.type, size: file.size }] }); }
function service(auth: PerUserLinkService, client: SyntxChatHttpClient, now: () => number = () => NOW) {
  return new OwnerKlingMotionControlReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => client, ffprobePath: FFPROBE, now });
}
function upload(attemptId: string, filename: string, mime_type: string, bytes: Buffer) { return { attemptId, filename, mime_type, content_base64: bytes.toString("base64") }; }

test("real image and probed MP4 uploads yield safe handles and only a genuine typed own-pair seam", async () => {
  const auth = await linked(); const media = await videoFile(); const image = png300(); let posts = 0;
  const client = makeClient(async (file, model) => { posts++; assert.equal(model, "kling_motion_control");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), file.name === "motion.png" ? image : media.bytes);
    return response(file, `https://r2.syntx.ai/test/${file.name}`); });
  const refs = service(auth, client);
  try {
    const imageReceipt = await refs.uploadImage(upload(ATTEMPT, "motion.png", "image/png", image));
    const duplicateImageReceipt = await refs.uploadImage(upload(ATTEMPT, "motion.png", "image/png", image));
    assert.equal(duplicateImageReceipt.image_handle, imageReceipt.image_handle, "known image semantics reuse the safe handle");
    const videoReceipt = await refs.uploadVideo(upload(ATTEMPT, "motion.mp4", "video/mp4", media.bytes));
    assert.equal(posts, 2); assert.equal(imageReceipt.generation_permit, false); assert.equal(videoReceipt.generation_permit, false);
    assert.equal(JSON.stringify([imageReceipt, videoReceipt]).includes("https://"), false);
    const pairInput = { attempt_id: ATTEMPT, image_handle: imageReceipt.image_handle, video_handle: videoReceipt.video_handle };
    const pair = await refs.resolveOwnPair(pairInput); assert.equal(refs.isOwnedOwnPairResolution(pair, pairInput), true);
    let seen: unknown;
    const native = refs.withNativeOwnPair(pair, pairInput, (actualClient, contexts) => { seen = [actualClient, contexts]; return contexts.map((c) => c.media_type); });
    assert.deepEqual(native, ["image", "video"]); assert.equal((seen as unknown[])[0], client);
    assert.equal(refs.isOwnedOwnPairResolution(Object.freeze({ ...pair }), pairInput), false);
    assert.equal(posts, 2);
  } finally { await refs.close(); await rm(media.dir, { recursive: true, force: true }); }
});

test("image-only resolution is distinct; wrong pair cardinality, foreign principal and cloned resolutions fail closed", async () => {
  const auth = await linked([ATTEMPT, "link_mcv_other_0123456789"]); const image = png300(); let posts = 0;
  const client = makeClient(async (file, model) => { posts++; assert.equal(model, "kling_motion_control"); return response(file, `https://r2.syntx.ai/test/${file.name}`); });
  let activeClient = client;
  const refs = new OwnerKlingMotionControlReferenceService({ binding: BINDING, linkService: auth, resolveClient: () => activeClient, ffprobePath: FFPROBE, now: () => NOW });
  const receipt = await refs.uploadImage(upload(ATTEMPT, "motion.png", "image/png", image));
  try {
    const input = { attempt_id: ATTEMPT, image_handle: receipt.image_handle }; const resolution = await refs.resolveImage(input);
    assert.equal(refs.isOwnedImageResolution(resolution, input), true);
    assert.equal(refs.withNativeImage(resolution, input, (_client, context) => context.media_type), "image");
    await assert.rejects(refs.resolveOwnPair({ attempt_id: ATTEMPT, image_handle: receipt.image_handle, video_handle: receipt.image_handle }),
      (e: unknown) => e instanceof OwnerKlingMotionControlReferenceServiceError && e.code === "INVALID_REQUEST");
    const foreign = { attempt_id: "link_mcv_other_0123456789", image_handle: receipt.image_handle };
    await assert.rejects(refs.resolveImage(foreign)); assert.equal(refs.isOwnedImageResolution(Object.freeze({ ...resolution }), input), false);
    activeClient = makeClient(async (file) => response(file, `https://r2.syntx.ai/other/${file.name}`));
    await assert.rejects(refs.resolveImage(input), (e: unknown) => e instanceof OwnerKlingMotionControlReferenceServiceError && e.code === "PROFILE_BINDING_MISMATCH");
    assert.equal(posts, 1);
  } finally { await refs.close(); }
});

test("expired image handles cannot be resolved after the service TTL", async () => {
  const auth = await linked(); const image = png300(); let now = NOW;
  const client = makeClient(async (file) => response(file, `https://r2.syntx.ai/test/${file.name}`)); const refs = service(auth, client, () => now);
  try {
    const receipt = await refs.uploadImage(upload(ATTEMPT, "motion.png", "image/png", image));
    now += 15 * 60_000;
    await assert.rejects(refs.resolveImage({ attempt_id: ATTEMPT, image_handle: receipt.image_handle }),
      (e: unknown) => e instanceof OwnerKlingMotionControlReferenceServiceError && e.code === "REFERENCE_UNAVAILABLE");
  } finally { await refs.close(); }
});

test("attempt invalidation revokes resolutions and pending abort drains without upload retry", async () => {
  const auth = await linked(); const image = png300(); let posts = 0; let release!: (r: Response) => void;
  const client = makeClient(async (_file) => { posts++; return new Promise<Response>((resolve) => { release = resolve; }); });
  const refs = service(auth, client); const ctrl = new AbortController();
  try {
    const pending = refs.uploadImage(upload(ATTEMPT, "motion.png", "image/png", image), ctrl.signal);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    const closing = refs.invalidateAttempt(ATTEMPT); ctrl.abort(); release(Response.json({ files: [] }));
    await assert.rejects(refs.uploadImage(upload(ATTEMPT, "motion.png", "image/png", image)),
      (e: unknown) => e instanceof OwnerKlingMotionControlReferenceServiceError && e.code === "SERVICE_BUSY");
    await assert.rejects(pending); await closing; assert.equal(posts, 1);
    await assert.rejects(refs.uploadImage(upload(ATTEMPT, "motion.png", "image/png", image)));
  } finally { await refs.close(); }
});

test("a duplicate waiting behind an upload cannot release its reservation or cause a second POST", async () => {
  const auth = await linked(); const image = png300(); let posts = 0; let release!: (r: Response) => void;
  const client = makeClient(async (_file) => { posts++; return new Promise<Response>((resolve) => { release = (r) => resolve(r); }); });
  const refs = service(auth, client); const request = upload(ATTEMPT, "motion.png", "image/png", image);
  try {
    const first = refs.uploadImage(request);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    for (let i = 0; i < 2; i++) await assert.rejects(refs.uploadImage(request),
      (e: unknown) => e instanceof OwnerKlingMotionControlReferenceServiceError && e.code === "SERVICE_BUSY");
    assert.equal(posts, 1);
    release(Response.json({ files: [{ filename: "motion.png", url: "https://r2.syntx.ai/test/motion.png", mime_type: "image/png", size: image.length }] }));
    await first; assert.equal(posts, 1);
  } finally { await refs.close(); }
});

test("principal change during an acknowledged upload returns unknown promptly and revokes its attempt", async () => {
  const auth = await linked(); const image = png300(); let posts = 0; let release!: (r: Response) => void; let changed = false;
  const getStatus = auth.getStatus.bind(auth);
  auth.getStatus = async (...args: Parameters<typeof auth.getStatus>) => {
    const status = await getStatus(...args); return changed ? Object.freeze({ ...status, linked: false }) : status;
  };
  const client = makeClient(async (_file) => { posts++; return new Promise<Response>((resolve) => { release = resolve; }); });
  const refs = service(auth, client); const pending = refs.uploadImage(upload(ATTEMPT, "motion.png", "image/png", image));
  try {
    while (!release) await new Promise((resolve) => setImmediate(resolve)); changed = true;
    release(Response.json({ files: [{ filename: "motion.png", url: "https://r2.syntx.ai/test/motion.png", mime_type: "image/png", size: image.length }] }));
    const outcome = await Promise.race([pending.then(() => "unexpected-success", (error: unknown) => error),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 1_000))]);
    assert.notEqual(outcome, "timeout", "owner recheck must not wait on the operation that initiated revocation");
    assert.ok(outcome instanceof OwnerKlingMotionControlReferenceServiceError);
    assert.equal(outcome.code, "UPLOAD_OUTCOME_UNKNOWN"); assert.equal(posts, 1);
  } finally { await refs.close(); }
});

test("image and video base64 caps match their distinct local input policies", () => {
  assert.equal(OWNER_KLING_MOTION_CONTROL_REFERENCE_INPUT_LIMITS.image_max_bytes, 64 * 1024 * 1024);
  assert.equal(OWNER_KLING_MOTION_CONTROL_REFERENCE_INPUT_LIMITS.video_max_bytes, 100 * 1024 * 1024);
  assert.ok(OWNER_KLING_MOTION_CONTROL_REFERENCE_INPUT_LIMITS.video_max_base64_chars > OWNER_KLING_MOTION_CONTROL_REFERENCE_INPUT_LIMITS.image_max_base64_chars);
});
