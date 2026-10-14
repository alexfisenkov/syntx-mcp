import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
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
import { validateOwnerWan27R2vImage, releaseValidatedOwnerWan27R2vImage } from "../src/application/owner-wan27-r2v-image-policy.js";
import { createOwnerWan27R2vOriginalProbe, releaseTrustedOwnerWan27R2vOriginalProbeResult } from "../src/application/owner-wan27-r2v-original-probe.js";
import { validateOwnerWan27R2vVideoSelection } from "../src/application/owner-wan27-r2v-video-selection.js";
import { createOwnerWan27R2vVideoCropProcessor, releaseTrustedOwnerWan27R2vVideoCropReceipt } from "../src/application/owner-wan27-r2v-video-crop.js";
import { OwnerWan27R2vReferenceService } from "../src/application/owner-wan27-r2v-reference-service.js";
import {
  getOwnerWan27R2vGenerationParametersSource,
  normalizeOwnerWan27R2vGenerationParameters,
  OwnerWan27R2vGenerationParametersError
} from "../src/application/owner-wan27-r2v-generation-parameters.js";

const ATTEMPT = "link_wan27_parameters_owner_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan27-parameters-tenant", subject: "wan27-parameters-owner" });
const TEST_PROMPT = "A paper kite over a quiet blue sky";
const PRIVATE_URL = "https://r2.syntx.ai/wan27/parameters-test.png";
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
  const bytes = Buffer.from(PNG_1);
  bytes.writeUInt32BE(240, 16); bytes.writeUInt32BE(240, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(consume: (credential: string) => Promise<T>) { return consume("synthetic-wan27-parameters-credential"); } };
}

async function linked(now: () => number, attemptId = ATTEMPT): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-wan27-parameters", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) {
      await receive({ scheme: "Bearer", value: "synthetic-owner-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now, defaultTtlMs: 30 * 60_000, attemptIdGenerator: () => attemptId
  });
  await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, attemptId);
  await links.checkAttempt(BINDING, attemptId);
  return links;
}

function imageClient(): SyntxChatHttpClient {
  return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return new Response(JSON.stringify({ files: [{ filename: file.name, url: PRIVATE_URL, mime_type: file.type, size: file.size }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } });
}

test("image-only owner manifest permits explicit 15-second local intent without leaking private reference data", async () => {
  let now = 1_000;
  const clock = () => now;
  const links = await linked(clock);
  const native = imageClient();
  const references = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => native, now: clock });
  const bytes = png240();
  const image = validateOwnerWan27R2vImage({ filename: "frame.png", mime_type: "image/png", bytes });
  try {
    const draft = await references.createManifest({ attemptId: ATTEMPT, video_reference_count: 0 });
    await references.addImage({ manifest_handle: draft.manifest_handle, image });
    const manifest = await references.finalizeManifest({ manifest_handle: draft.manifest_handle });
    const normalized = await normalizeOwnerWan27R2vGenerationParameters({
      model_id: "wan_27_r2v", prompt: TEST_PROMPT,
      parameters: { resolution: "1080P", aspect_ratio: "4:3", video_duration: 15, prompt_extend: false, seed: null, native_audio: false }
    }, { referenceService: references, manifest });
    assert.equal(normalized.reference_context.selected_video_reference_count, 0);
    assert.equal(normalized.reference_context.maximum_video_duration_seconds, 15);
    assert.equal(normalized.intent.parameters.video_duration, 15);
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized.intent.parameters), true);
    assert.equal(JSON.stringify(normalized).includes(PRIVATE_URL), false);
    assert.equal(JSON.stringify(normalized).includes(ATTEMPT), false);
    assert.equal(JSON.stringify(normalized).includes(manifest.manifest_handle), false);

    for (const resolution of ["720P", "1080P"] as const) {
      for (const aspect_ratio of ["16:9", "9:16", "1:1", "4:3", "3:4"] as const) {
        for (const seed of [null, 0, 2_147_483_647] as const) {
          const edge = await normalizeOwnerWan27R2vGenerationParameters({
            model_id: "wan_27_r2v", parameters: {
              resolution, aspect_ratio, video_duration: 2, prompt_extend: false, seed, native_audio: false
            }
          }, { referenceService: references, manifest });
          assert.equal(edge.intent.parameters.resolution, resolution);
          assert.equal(edge.intent.parameters.aspect_ratio, aspect_ratio);
          assert.equal(edge.intent.parameters.seed, seed);
          assert.equal(edge.intent.parameters.video_duration, 2);
          assert.equal(Object.hasOwn(edge.intent, "prompt"), false);
        }
      }
    }
    const maximumPrompt = await normalizeOwnerWan27R2vGenerationParameters({
      model_id: "wan_27_r2v", prompt: "x".repeat(1_500),
      parameters: { resolution: "1080P", aspect_ratio: "1:1", video_duration: 2, prompt_extend: false, seed: null, native_audio: false }
    }, { referenceService: references, manifest });
    assert.equal(maximumPrompt.intent.prompt?.length, 1_500);
    assert.equal(maximumPrompt.effective_defaults, "UNKNOWN");

    await assert.rejects(normalizeOwnerWan27R2vGenerationParameters({
      model_id: "wan_27_r2v", prompt: TEST_PROMPT,
      parameters: { resolution: "1080P", aspect_ratio: "4:3", video_duration: 15, prompt_extend: false, seed: null, native_audio: false }
    }, { referenceService: references, manifest: { ...manifest } }), (error: unknown) =>
      error instanceof OwnerWan27R2vGenerationParametersError && error.code === "REFERENCE_CONTEXT_UNAVAILABLE");

    await links.revoke(BINDING, ATTEMPT);
    await assert.rejects(normalizeOwnerWan27R2vGenerationParameters({
      model_id: "wan_27_r2v", prompt: TEST_PROMPT,
      parameters: { resolution: "1080P", aspect_ratio: "4:3", video_duration: 15, prompt_extend: false, seed: null, native_audio: false }
    }, { referenceService: references, manifest }), (error: unknown) =>
      error instanceof OwnerWan27R2vGenerationParametersError && error.code === "REFERENCE_CONTEXT_UNAVAILABLE");
  } finally {
    await references.close();
    releaseValidatedOwnerWan27R2vImage(image);
    bytes.fill(0);
  }

  const ttlAttempt = "link_wan27_parameters_ttl_0123456789";
  const ttlLinks = await linked(() => 1_000, ttlAttempt);
  let expireAtRead: number | undefined;
  let serviceClockReads = 0;
  const serviceClock = () => {
    if (expireAtRead === undefined) return 1_000;
    serviceClockReads += 1;
    return serviceClockReads >= expireAtRead ? 901_001 : 1_000;
  };
  const ttlNative = imageClient();
  const ttlReferences = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: ttlLinks, resolveClient: () => ttlNative, now: serviceClock });
  const ttlBytes = png240();
  const ttlImage = validateOwnerWan27R2vImage({ filename: "ttl-frame.png", mime_type: "image/png", bytes: ttlBytes });
  try {
    const draft = await ttlReferences.createManifest({ attemptId: ttlAttempt, video_reference_count: 0 });
    await ttlReferences.addImage({ manifest_handle: draft.manifest_handle, image: ttlImage });
    const manifest = await ttlReferences.finalizeManifest({ manifest_handle: draft.manifest_handle });
    expireAtRead = 6;
    await assert.rejects(normalizeOwnerWan27R2vGenerationParameters({
      model_id: "wan_27_r2v", parameters: {
        resolution: "720P", aspect_ratio: "16:9", video_duration: 2, prompt_extend: false, seed: null, native_audio: false
      }
    }, { referenceService: ttlReferences, manifest }), (error: unknown) =>
      error instanceof OwnerWan27R2vGenerationParametersError && error.code === "REFERENCE_CONTEXT_UNAVAILABLE");
    assert.equal(serviceClockReads, 6, "reference TTL expires during the awaited captured-reference callback");
  } finally {
    await ttlReferences.close();
    releaseValidatedOwnerWan27R2vImage(ttlImage);
    ttlBytes.fill(0);
  }
});

test("selected-video counts 1 through 5 come from genuine manifests and all use the 10-second output bound", async (t) => {
  if (!MEDIA_TOOLS) { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  try { await run(MEDIA_TOOLS.ffmpeg, ["-version"]); await run(MEDIA_TOOLS.ffprobe, ["-version"]); }
  catch { t.skip("supported ffmpeg/ffprobe pair is unavailable"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-parameters-1546-"));
  const sourcePath = join(directory, "source.mp4");
  let original: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vOriginalProbe>["probe"]>> | undefined;
  const crops: Awaited<ReturnType<ReturnType<typeof createOwnerWan27R2vVideoCropProcessor>["crop"]>>[] = [];
  const clock = () => 1_000;
  const links = await linked(clock);
  let uploads = 0;
  const native = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "video/mp4");
    uploads += 1;
    return new Response(JSON.stringify({ files: [{ id: `parameters-video-${uploads}`, filename: file.name,
      url: `https://r2.syntx.ai/wan27/parameters-${uploads}.mp4`, content_type: file.type, size: file.size }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  } });
  const references = new OwnerWan27R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => native, now: clock });
  try {
    await run(MEDIA_TOOLS.ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
      "testsrc=size=320x240:rate=24:duration=16", "-c:v", "libx264", "-pix_fmt", "yuv420p", sourcePath]);
    const sourceBytes = new Uint8Array(await readFile(sourcePath));
    original = await createOwnerWan27R2vOriginalProbe({ ffprobePath: MEDIA_TOOLS.ffprobe }).probe({
      filename: "source.mp4", mime_type: "video/mp4", bytes: sourceBytes
    });
    sourceBytes.fill(0);
    const processor = createOwnerWan27R2vVideoCropProcessor({ ffmpegPath: MEDIA_TOOLS.ffmpeg, ffprobePath: MEDIA_TOOLS.ffprobe });
    for (let index = 0; index < 15; index += 1) {
      const selection = validateOwnerWan27R2vVideoSelection({ original, start_seconds: index, end_seconds: index + 1, video_reference_count: 5 });
      crops.push(await processor.crop(original, selection));
    }
    assert.equal(crops.every((crop) => crop.metadata.video_duration_seconds === 1), true);

    let cropOffset = 0;
    for (let videoCount = 1; videoCount <= 5; videoCount += 1) {
      const draft = await references.createManifest({ attemptId: ATTEMPT, video_reference_count: videoCount });
      for (const crop of crops.slice(cropOffset, cropOffset + videoCount)) {
        await references.addSelectedVideo({ manifest_handle: draft.manifest_handle, crop });
      }
      cropOffset += videoCount;
      const manifest = await references.finalizeManifest({ manifest_handle: draft.manifest_handle });
      const normalized = await normalizeOwnerWan27R2vGenerationParameters({
        model_id: "wan_27_r2v", prompt: TEST_PROMPT,
        parameters: { resolution: "720P", aspect_ratio: "16:9", video_duration: 10, prompt_extend: true, seed: 0, native_audio: false }
      }, { referenceService: references, manifest });
      assert.equal(normalized.reference_context.image_reference_count, 0);
      assert.equal(normalized.reference_context.selected_video_reference_count, videoCount);
      assert.equal(normalized.reference_context.total_reference_count, videoCount);
      assert.equal(normalized.reference_context.maximum_video_duration_seconds, 10);
      assert.equal(normalized.intent.parameters.video_duration, 10);
      assert.equal(JSON.stringify(normalized).includes("r2.syntx.ai"), false);
      if (videoCount === 5) {
        await assert.rejects(normalizeOwnerWan27R2vGenerationParameters({
          model_id: "wan_27_r2v", prompt: TEST_PROMPT,
          parameters: { resolution: "720P", aspect_ratio: "16:9", video_duration: 11, prompt_extend: true, seed: 0, native_audio: false }
        }, { referenceService: references, manifest }), (error: unknown) =>
          error instanceof OwnerWan27R2vGenerationParametersError && error.code === "INVALID_PARAMETERS");
      }
    }
    assert.equal(uploads, 15);
  } finally {
    await references.close();
    for (const crop of crops) releaseTrustedOwnerWan27R2vVideoCropReceipt(crop);
    if (original) releaseTrustedOwnerWan27R2vOriginalProbeResult(original);
    await rm(directory, { recursive: true, force: true });
  }
});

test("only explicit controls are accepted; source metadata separates the pinned prompt limit from current UI", async () => {
  const source = getOwnerWan27R2vGenerationParametersSource();
  assert.equal(source.source_pins.form_build_id, "1791904852");
  assert.equal(source.source_pins.form_sha256, "sha256:f69db3d449d0051969def2229ed936d9835e0d65c8f257ec3ab289d6e9387737");
  assert.equal(source.source_pins.seed_helper_sha256, "sha256:c95fc355e29e33f6c3998cb62cc2da4d0879cc1ff4fb524e826e74bb24cd792b");
  assert.deepEqual(source.controls.resolution, ["720P", "1080P"]);
  assert.deepEqual(source.controls.aspect_ratio, ["16:9", "9:16", "1:1", "4:3", "3:4"]);
  assert.deepEqual(source.controls.video_duration, {
    minimum: 2, maximum_with_selected_video: 10, maximum_without_selected_video: 15, unit: "INTEGER_SECONDS"
  });
  assert.equal(source.prompt_limit.maximum_length, 1_500);
  assert.equal(source.prompt_limit.source, "PINNED_B066_PUBLIC_CATALOG_ONLY_NOT_CURRENT_UI_LIMIT");
  assert.equal(source.controls.native_audio, false);
  assert.ok(source.coverage_gaps.includes("SHOT_TYPE_AND_AUDIO_SETTING_VISIBILITY_RESET_NOT_ESTABLISHED"));
  assert.ok(Object.isFrozen(source) && Object.isFrozen(source.source_pins) && Object.isFrozen(source.coverage_gaps));

  const base = { model_id: "wan_27_r2v", parameters: {
    resolution: "1080P", aspect_ratio: "1:1", video_duration: 2, prompt_extend: false, seed: null, native_audio: false
  } };
  const invalidInputs: unknown[] = [
    { ...base, parameters: { ...base.parameters, native_audio: true } },
    { ...base, parameters: { ...base.parameters, shot_type: "single" } },
    { ...base, parameters: { ...base.parameters, audio_setting: "auto" } },
    { ...base, parameters: { ...base.parameters, seed: 2_147_483_648 } },
    { ...base, parameters: { ...base.parameters, video_duration: 2.5 } },
    { ...base, parameters: { ...base.parameters, resolution: "480P" } },
    { ...base, prompt: "x".repeat(1_501) }
  ];
  for (const input of invalidInputs) {
    await assert.rejects(normalizeOwnerWan27R2vGenerationParameters(input, {} as never), (error: unknown) =>
      error instanceof OwnerWan27R2vGenerationParametersError && error.code === "INVALID_PARAMETERS");
  }
  await assert.rejects(normalizeOwnerWan27R2vGenerationParameters(base, {
    referenceService: {}, manifest: {}
  } as never), (error: unknown) =>
    error instanceof OwnerWan27R2vGenerationParametersError && error.code === "REFERENCE_CONTEXT_UNAVAILABLE");
});
