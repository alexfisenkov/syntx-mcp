import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerWan27I2vSourceProfile,
  normalizeOwnerWan27I2vParameters
} from "../src/application/owner-wan27-i2v-parameters.js";
import {
  OWNER_WAN27_I2V_IMAGE_POLICY,
  OwnerWan27I2vImagePolicyError,
  readValidatedOwnerWan27I2vImage,
  releaseValidatedOwnerWan27I2vImage,
  validateOwnerWan27I2vImage
} from "../src/application/owner-wan27-i2v-image-policy.js";
import { buildOwnerWan27I2vWire } from "../src/application/owner-wan27-i2v-wire.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";

const MODEL = "wan_27_i2v" as const;
const URL = "https://r2.syntx.ai/wan27-i2v2334/source.png";
const prompt = "A single source portrait begins moving naturally.";
function input(overrides: Readonly<Record<string, unknown>> = {}) {
  return { model_id: MODEL, prompt, resolution: "720P", aspect_ratio: "1:1", video_duration: 5,
    prompt_extend: false, shot_type: "single", audio_setting: "auto", seed: null, native_audio: false,
    rendering_speed: "basic", ...overrides };
}
function png(width: number, height: number): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function crc32(data: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function image(bytes = png(300, 300), overrides: Readonly<Record<string, unknown>> = {}) {
  return { model_id: MODEL, filename: "source.png", mime_type: "image/png", bytes, ...overrides };
}

test("2334 exact source-bound I2V tuple pins one model, WAN27 branch and shared sender scope", () => {
  const profile = getOwnerWan27I2vSourceProfile();
  assert.equal(profile.model_id, MODEL); assert.equal(profile.ai_name, "wan_video"); assert.equal(profile.scope, "video");
  assert.equal(profile.source_pins.form_build_id, "1792363638");
  assert.deepEqual(normalizeOwnerWan27I2vParameters(input()).settings, {
    model_type: MODEL, resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: false,
    shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, rendering_speed: "basic"
  });
  assert.deepEqual(profile.cost_query_keys, ["resolution", "video_duration"]);
  assert.deepEqual(profile.wire.image_file_url, { type: "first_frame", slot: "firstSlot", source_validator: "REQUIRED",
    cardinality: 1, last_frame: "OPTIONAL_NOT_SUPPORTED_IN_INITIAL_SLICE" });
  assert.equal(profile.dispatch_allowed, false); assert.equal(profile.provider_acceptance, "UNPROVEN");
});

test("2334 rejects neighboring model IDs, off-slice settings and incomplete explicit parameters", () => {
  for (const value of [
    input({ model_id: "wan_27_videoedit" }),
    input({ model_id: "wan_26_i2v" }),
    input({ resolution: "1080P" }),
    input({ aspect_ratio: "16:9" }),
    input({ video_duration: 6 }),
    input({ prompt_extend: true }),
    input({ native_audio: true }),
    input({ rendering_speed: "fast" }),
    input({ shot_type: "multi" }),
    input({ audio_setting: "origin" }),
    input({ seed: 42 }),
    (() => { const row = input(); delete (row as Record<string, unknown>).rendering_speed; return row; })(),
    { ...input(), destination: "uploaded" }
  ]) assert.throws(() => normalizeOwnerWan27I2vParameters(value), { code: "INVALID_PARAMETERS" });
});

test("2334 image policy enforces current positive public image bounds and a one-image local slice", () => {
  assert.deepEqual(OWNER_WAN27_I2V_IMAGE_POLICY.public_bounds, {
    max_file_size: 20 * 1024 * 1024, min_side: 240, max_side: 8_000, min_aspect_ratio: 0.125, max_aspect_ratio: 8
  });
  assert.equal(OWNER_WAN27_I2V_IMAGE_POLICY.initial_cardinality, 1);
  const receipt = validateOwnerWan27I2vImage(image());
  const copy = readValidatedOwnerWan27I2vImage(receipt);
  assert.ok(copy); assert.equal(copy.model_id, MODEL); assert.equal(copy.mime_type, "image/png");
  assert.equal(receipt.owner_upload_binding, "NOT_ESTABLISHED");
  assert.equal(releaseValidatedOwnerWan27I2vImage(receipt), true);
  assert.equal(readValidatedOwnerWan27I2vImage(receipt), null);
  assert.throws(() => validateOwnerWan27I2vImage(image(png(239, 300))), { code: "INVALID_IMAGE_INPUT" });
  assert.throws(() => validateOwnerWan27I2vImage(image(png(8_001, 300))), { code: "INVALID_IMAGE_INPUT" });
  assert.throws(() => validateOwnerWan27I2vImage(image(png(300, 300), { mime_type: "image/gif" })),
    (error: unknown) => error instanceof OwnerWan27I2vImagePolicyError && error.code === "INVALID_IMAGE_INPUT");
});

test("2334 exact candidate produces one typed image URL and no extra media or destination fields", () => {
  const parameters = normalizeOwnerWan27I2vParameters(input());
  const candidate = buildOwnerWan27I2vWire(parameters.intent, { model_id: MODEL, url: URL, sha256: "a".repeat(64),
    mime_type: "image/png", size: 68, width: 300, height: 300 });
  assert.deepEqual(candidate.wire, { ai_name: "wan_video", prompt, settings: {
    model_type: MODEL, resolution: "720P", aspect_ratio: "1:1", video_duration: 5, prompt_extend: false,
    shot_type: "single", audio_setting: "auto", seed: null, native_audio: false, rendering_speed: "basic",
    file_urls: [{ type: "first_frame", url: URL }]
  } });
  assert.equal(candidate.image_count, 1); assert.equal(candidate.video_count, 0); assert.equal(candidate.audio_count, 0);
  assert.equal(candidate.upload_destination, "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER");
  assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.provider_acceptance, "UNPROVEN");
});

test("WAN27 I2V native client exposes only the required fixed-route lifecycle surface", () => {
  for (const method of ["uploadOwnerWan27I2vImage", "createOwnerWan27I2vChat", "isOwnerWan27I2vChat",
    "invalidateOwnerWan27I2vChats", "startOwnerWan27I2vOperation", "readOwnerWan27I2vHistory", "readOwnerWan27I2vResult"]) {
    assert.equal(typeof Reflect.get(SyntxChatHttpClient.prototype, method), "function", method);
  }
});
