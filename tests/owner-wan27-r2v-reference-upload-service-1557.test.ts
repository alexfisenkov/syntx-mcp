import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerWan27R2vReferenceService, OwnerWan27R2vReferenceServiceError } from "../src/application/owner-wan27-r2v-reference-service.js";
import { isOwnerWan27R2vReferenceUploadService, OwnerWan27R2vReferenceUploadService } from "../src/application/owner-wan27-r2v-reference-upload-service.js";

const ATTEMPT = "link_wan27_upload_owner_0123456789";
const OTHER = "link_wan27_upload_owner_abcdefghij";
const BINDING = Object.freeze({ tenant_id: "wan27-upload-tenant", subject: "wan27-upload-owner" });
const run = promisify(execFile);
const MEDIA_TOOLS = [
  { ffmpeg: "/opt/homebrew/bin/ffmpeg", ffprobe: "/opt/homebrew/bin/ffprobe" },
  { ffmpeg: "/usr/bin/ffmpeg", ffprobe: "/usr/bin/ffprobe" }
].find((pair) => existsSync(pair.ffmpeg) && existsSync(pair.ffprobe));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png240(): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(240, 16); bytes.writeUInt32BE(240, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function response(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function broker(): SyntxCredentialBroker { return { async useCredential<T>(fn: (credential: string) => Promise<T>) { return fn("synthetic-wan27-upload-credential"); } }; }
async function linked(ids: readonly string[]): Promise<PerUserLinkService> {
  let index = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${index}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(), { defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => ids[index++]! });
  for (const id of ids) { await links.createAttempt(BINDING); await links.issueHandoff(BINDING, id); await links.checkAttempt(BINDING, id); }
  return links;
}

test("WAN27 R2V upload application flow uses owner drafts and actual local image/video operators", async (t) => {
  if (!MEDIA_TOOLS) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await run(MEDIA_TOOLS.ffmpeg, ["-version"]); await run(MEDIA_TOOLS.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }

  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-upload-1557-"));
  const sourcePath = join(directory, "source.mp4"), foreignPath = join(directory, "foreign.mp4");
  const links = await linked([ATTEMPT, OTHER]);
  let posts = 0;
  const native = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    posts++;
    const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
    return response({ files: [{ id: `r2v-${posts}`, url: `https://r2.syntx.ai/wan27/${posts}`, filename: file.name,
      content_type: file.type, size: file.size, ...(file.type === "video/mp4" ? { duration: 2 } : {}) }] });
  } });
  const references = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => native });
  const upload = new OwnerWan27R2vReferenceUploadService({ referenceService: references, ffprobePath: MEDIA_TOOLS.ffprobe, ffmpegPath: MEDIA_TOOLS.ffmpeg });
  const imageBytes = png240(), preserved = Buffer.from(imageBytes);
  try {
    assert.equal(isOwnerWan27R2vReferenceUploadService(upload), true);
    assert.equal(Object.isFrozen(Object.getPrototypeOf(upload)), true);
    await run(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", sourcePath]);
    await run(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24:duration=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", foreignPath]);

    const draft = await upload.createManifest({ attemptId: ATTEMPT, video_reference_count: 1 });
    const draftReadback = await references.getDraftManifest({ attemptId: ATTEMPT, manifest_handle: draft.manifest_handle });
    assert.equal(draftReadback.manifest_handle, draft.manifest_handle);
    assert.equal(draftReadback.video_reference_count, 1);
    assert.ok(draftReadback.expires_in_seconds > 0 && draftReadback.expires_in_seconds <= 900);
    await assert.rejects(upload.uploadImage({ attemptId: OTHER, manifest_handle: draft.manifest_handle,
      filename: "frame.png", mime_type: "image/png", bytes: imageBytes }), (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "MANIFEST_UNAVAILABLE");
    assert.equal(posts, 0);

    const sourceOriginal = new Uint8Array(await readFile(sourcePath));
    const imageItem = await upload.uploadImage({ attemptId: ATTEMPT, manifest_handle: draft.manifest_handle,
      filename: "frame.png", mime_type: "image/png", bytes: imageBytes });
    assert.deepEqual(imageBytes, preserved);
    const videoItem = await upload.uploadVideo({ attemptId: ATTEMPT, manifest_handle: draft.manifest_handle,
      filename: "source.mp4", mime_type: "video/mp4", bytes: sourceOriginal, start_seconds: 0, end_seconds: 2 });
    assert.deepEqual(sourceOriginal, new Uint8Array(await readFile(sourcePath)));
    const ready = await upload.finalizeManifest({ attemptId: ATTEMPT, manifest_handle: draft.manifest_handle });
    assert.deepEqual(ready.references.map((item) => item.reference_handle), [imageItem.reference_handle, videoItem.reference_handle]);
    assert.deepEqual(ready.references.map((item) => item.media_type), ["image", "selected_video"]);
    assert.equal(ready.generation_permit, false);
    assert.equal(JSON.stringify(ready).includes("https://r2.syntx.ai/"), false);
    assert.equal(posts, 2);

    const noVideo = await upload.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    const foreignBytes = new Uint8Array(await readFile(foreignPath));
    await assert.rejects(upload.uploadVideo({ attemptId: ATTEMPT, manifest_handle: noVideo.manifest_handle,
      filename: "foreign.mp4", mime_type: "video/mp4", bytes: foreignBytes, start_seconds: 0, end_seconds: 1 }));
    assert.equal(posts, 2);

    const delayedDraft = await upload.createManifest({ attemptId: OTHER, video_reference_count: 1 });
    const marker = join(directory, "probe-started"), delayedProbe = join(directory, "delayed-ffprobe");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(delayedProbe, `#!/bin/sh\nprintf ready > ${quote(marker)}\n/bin/sleep 2\nexec ${quote(MEDIA_TOOLS.ffprobe)} "$@"\n`, { mode: 0o700, flag: "wx" });
    await chmod(delayedProbe, 0o700);
    const delayedUpload = new OwnerWan27R2vReferenceUploadService({ referenceService: references, ffprobePath: delayedProbe, ffmpegPath: MEDIA_TOOLS.ffmpeg });
    const revokeBytes = new Uint8Array(await readFile(sourcePath));
    const pendingUpload = delayedUpload.uploadVideo({ attemptId: OTHER, manifest_handle: delayedDraft.manifest_handle,
      filename: "source.mp4", mime_type: "video/mp4", bytes: revokeBytes, start_seconds: 0, end_seconds: 2 });
    const pendingRejected = assert.rejects(pendingUpload, (error: unknown) =>
      error instanceof OwnerWan27R2vReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED");
    let probeStarted = false;
    for (let i = 0; i < 100 && !probeStarted; i += 1) {
      try { probeStarted = (await readFile(marker, "utf8")) === "ready"; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.equal(probeStarted, true);
    await links.revoke(BINDING, OTHER);
    await pendingRejected;
    assert.deepEqual(revokeBytes, new Uint8Array(await readFile(sourcePath)));
    assert.equal(posts, 2);
    await delayedUpload.close();

    await upload.close();
    const stillOpen = await references.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    assert.equal(stillOpen.status, "draft");
  } finally {
    await upload.close();
    await references.close();
    imageBytes.fill(0);
    await rm(directory, { recursive: true, force: true });
  }
});
