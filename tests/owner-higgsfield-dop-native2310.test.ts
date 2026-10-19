import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerHiggsfieldDopSourceProfile,
  normalizeOwnerHiggsfieldDopParameters
} from "../src/application/owner-higgsfield-dop-parameters.js";
import {
  OWNER_HIGGSFIELD_DOP_IMAGE_POLICY,
  OwnerHiggsfieldDopImagePolicyError,
  readValidatedOwnerHiggsfieldDopImageUpload,
  releaseValidatedOwnerHiggsfieldDopImageUpload,
  validateOwnerHiggsfieldDopImageUpload
} from "../src/application/owner-higgsfield-dop-image-policy.js";
import { buildOwnerHiggsfieldDopWire } from "../src/application/owner-higgsfield-dop-wire.js";

const MODEL_IDS = ["dop-lite", "dop-turbo"] as const;
const IMAGE_URL = "https://r2.syntx.ai/higgsfield-dop/private/frame.png";
const MOTIONS = Object.freeze([Object.freeze({ id: "motion-a", label: "Soft orbit", strength: 1 as const })]);

function input(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return { model_id: "dop-lite", prompt: "Animate the subject gently.", enhance_prompt: false, motions: MOTIONS, ...overrides };
}

function image(model_id: string, bytes: Uint8Array, mime_type: string, filename = "frame.png") {
  return { model_id, bytes, mime_type, filename };
}

function invalidParameters(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: unknown }).code === "INVALID_PARAMETERS";
}

function invalidImage(code = "INVALID_IMAGE_INPUT") {
  return (error: unknown): boolean => error instanceof OwnerHiggsfieldDopImagePolicyError && error.code === code;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 0x0b, 8, height >> 8, height & 0xff, width >> 8, width & 0xff,
    1, 1, 0x11, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
}

function webp(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(18); chunk.write("VP8 ", 0, 4, "ascii"); chunk.writeUInt32LE(10, 4);
  chunk[11] = 0x9d; chunk[12] = 0x01; chunk[13] = 0x2a; chunk.writeUInt16LE(width, 14); chunk.writeUInt16LE(height, 16);
  const bytes = Buffer.alloc(12 + chunk.length); bytes.write("RIFF", 0, 4, "ascii"); bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, 4, "ascii"); chunk.copy(bytes, 12); return bytes;
}

test("2310 profile records the source-supported DOP picker bounds and explicit checkbox values", () => {
  const profile = getOwnerHiggsfieldDopSourceProfile();
  assert.deepEqual(profile.model_ids, MODEL_IDS);
  assert.equal(profile.ai_name, "higgsfield"); assert.equal(profile.scope, "video");
  assert.deepEqual(profile.cost_query_keys, []);
  assert.deepEqual(profile.initial_settings, { enhance_prompt: true, motions: [] });
  assert.deepEqual(profile.controls.enhance_prompt.explicit_values, [false, true]);
  assert.equal(profile.controls.motions.initial_value_valid, false);
  assert.equal(profile.controls.motions.min_selected, 1);
  assert.equal(profile.controls.motions.max_selected, 2);
  assert.equal(profile.upload_destination, "TRUSTED_RUNTIME_CONFIGURATION_REQUIRED_NOT_PARAMETER");
  assert.equal(profile.prompt_maximum_utf16_length, 1_000);
  assert.equal(profile.prompt_limit_confidence, "LOCAL_CONSERVATIVE_BOUND_NOT_PROVIDER_LIMIT");
  assert.equal(profile.effective_defaults, "UNKNOWN");
  assert.equal(profile.dispatch_allowed, false); assert.equal(profile.backend_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(profile), true);
});

test("2310 normalizes either exact DOP ID with explicit prompt and exact selected motion objects", () => {
  for (const model_id of MODEL_IDS) {
    const normalized = normalizeOwnerHiggsfieldDopParameters(input({ model_id }));
    assert.deepEqual(normalized.intent, { model_id, prompt: "Animate the subject gently.", enhance_prompt: false, motions: MOTIONS });
    assert.deepEqual(normalized.source_parameters, { model_type: model_id, enhance_prompt: false, motions: MOTIONS });
    assert.equal(normalized.cost_query_keys.length, 0);
    assert.equal(normalized.dispatch_allowed, false); assert.equal(normalized.backend_acceptance, "UNPROVEN");
  }
});

test("2310 rejects missing or invalid DOP prompt/model and controls outside the initial slice", () => {
  for (const bad of [
    {}, input({ model_id: "dop-lite-extra" }), input({ model_id: "grok_i2v" }), input({ enhance_prompt: undefined }),
    input({ prompt: "   " }), input({ prompt: "x".repeat(1_001) }), input({ prompt: "\ud800" }),
    input({ motions: [] }), input({ motions: ["cinematic"] }), input({ motions: [{ id: "motion-a", label: "Soft orbit", strength: 1 },
      { id: "motion-a", label: "Soft orbit", strength: 1 }] }), input({ enhance_prompt: true }), input({ seed: null }),
    input({ aspect_ratio: "16:9" }), input({ video_duration: 5 }), input({ destination: "hidden" })
  ]) assert.throws(() => normalizeOwnerHiggsfieldDopParameters(bad), invalidParameters);

  assert.throws(() => normalizeOwnerHiggsfieldDopParameters(new Proxy(input(), {})), invalidParameters);
  assert.throws(() => normalizeOwnerHiggsfieldDopParameters({ ...input(), motions: new Proxy([], {}) }), invalidParameters);
  let getterCalls = 0;
  const motionsAccessor: unknown[] = [];
  Object.defineProperty(motionsAccessor, "extra", { enumerable: true, get() { getterCalls += 1; return "must not run"; } });
  assert.throws(() => normalizeOwnerHiggsfieldDopParameters({ ...input(), motions: motionsAccessor }), invalidParameters);
  const accessor = input();
  Object.defineProperty(accessor, "prompt", { enumerable: true, get() { getterCalls += 1; return "must not run"; } });
  assert.throws(() => normalizeOwnerHiggsfieldDopParameters(accessor), invalidParameters);
  assert.equal(getterCalls, 0);
});

test("2310 image policy accepts its bounded JPEG, PNG, and WebP subset and privately owns a copy", () => {
  for (const [bytes, mime_type] of [[jpeg(160, 90), "image/jpeg"], [png(90, 90), "image/png"], [webp(100, 70), "image/webp"]] as const) {
    const source = Buffer.from(bytes);
    const receipt = validateOwnerHiggsfieldDopImageUpload(image("dop-lite", source, mime_type));
    source.fill(0);
    const copy = readValidatedOwnerHiggsfieldDopImageUpload(receipt);
    assert.ok(copy); assert.equal(copy.mime_type, mime_type); assert.deepEqual(Buffer.from(copy.bytes), bytes);
    assert.equal(receipt.provider_acceptance, "UNPROVEN"); assert.equal(receipt.upload_authority, false);
    assert.equal(receipt.width, mime_type === "image/webp" ? 100 : (mime_type === "image/jpeg" ? 160 : 90));
    copy.bytes.fill(0); assert.deepEqual(Buffer.from(readValidatedOwnerHiggsfieldDopImageUpload(receipt)!.bytes), bytes);
    assert.equal(releaseValidatedOwnerHiggsfieldDopImageUpload(receipt), true);
    assert.equal(readValidatedOwnerHiggsfieldDopImageUpload(receipt), null);
  }
  assert.equal(OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.crop_resize_policy, "ORIGINAL_BYTES_NO_LOCAL_CROP_OR_RESIZE");
});

test("2310 image policy applies explicit local resource ceilings without imposing aspect geometry", () => {
  const portrait = validateOwnerHiggsfieldDopImageUpload(image("dop-turbo", png(90, 160), "image/png"));
  assert.equal(portrait.width, 90); assert.equal(portrait.height, 160);
  assert.equal(OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.local_max_bytes, 10 * 1024 * 1024);
  assert.equal(OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.max_dimension, 8_400);
  assert.equal(OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.max_pixels, 52_500_000);
  assert.equal(OWNER_HIGGSFIELD_DOP_IMAGE_POLICY.local_max_bytes_policy, "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
  releaseValidatedOwnerHiggsfieldDopImageUpload(portrait);

  assert.throws(() => validateOwnerHiggsfieldDopImageUpload(image("dop-lite", png(90, 90), "image/avif")), invalidImage());
  assert.throws(() => validateOwnerHiggsfieldDopImageUpload(image("dop-lite", png(90, 90), "image/png", "../frame.png")), invalidImage());
  assert.throws(() => validateOwnerHiggsfieldDopImageUpload(image("dop-lite", new Uint8Array(10 * 1024 * 1024 + 1), "image/png")),
    invalidImage("LOCAL_RESOURCE_LIMIT_EXCEEDED"));
  assert.throws(() => validateOwnerHiggsfieldDopImageUpload(image("other", png(90, 90), "image/png")), invalidImage());
});

test("2310 wire maps the explicit DOP tuple and one captured image without authority or inferred controls", () => {
  const normalized = normalizeOwnerHiggsfieldDopParameters(input({ model_id: "dop-turbo" }));
  const candidate = buildOwnerHiggsfieldDopWire(input({ model_id: "dop-turbo" }), {
    url: IMAGE_URL, sha256: "a".repeat(64), width: 160, height: 90
  });
  assert.deepEqual(candidate.wire, {
    ai_name: "higgsfield", prompt: "Animate the subject gently.",
    settings: {
      model_type: "dop-turbo", enhance_prompt: false, motions: MOTIONS,
      file_urls: [{ type: "image", url: IMAGE_URL }]
    }
  });
  assert.equal(candidate.model_id, "dop-turbo"); assert.equal(candidate.profile_sha256, normalized.profile_sha256);
  assert.equal(candidate.dispatch_allowed, false); assert.equal(candidate.backend_acceptance, "UNPROVEN");
  assert.equal(candidate.reference_binding, "ONE_CAPTURED_IMAGE");
  for (const forbidden of ["seed", "aspect_ratio", "video_duration", "resolution", "destination"]) {
    assert.equal(forbidden in candidate.wire.settings, false); assert.equal(forbidden in candidate.wire, false);
  }
  assert.equal(Object.isFrozen(candidate), true); assert.equal(Object.isFrozen(candidate.wire.settings.motions), true);
  assert.equal(Object.isFrozen(candidate.wire.settings.file_urls), true);
});

test("2310 wire fingerprints bind image and model but never infer aspect, crop, or upload destination", () => {
  const params = input({ model_id: "dop-lite" });
  const first = buildOwnerHiggsfieldDopWire(params, { url: IMAGE_URL, sha256: "a".repeat(64), width: 90, height: 160 });
  const second = buildOwnerHiggsfieldDopWire(params, { url: "https://r2.syntx.ai/other/private/frame.png", sha256: "a".repeat(64), width: 90, height: 160 });
  assert.equal(first.intent_fingerprint, second.intent_fingerprint);
  assert.notEqual(first.wire_fingerprint, second.wire_fingerprint);
  assert.equal(first.source_image_context.width, 90); assert.equal(first.source_image_context.height, 160);
});

test("2310 wire rejects unsafe uploaded URLs, malformed hashes, unsupported IDs, and extra fields", () => {
  const params = input();
  for (const captured of [
    { url: "https://example.invalid/frame.png", sha256: "a".repeat(64), width: 90, height: 90 },
    { url: "https://user@r2.syntx.ai/frame.png", sha256: "a".repeat(64), width: 90, height: 90 },
    { url: IMAGE_URL, sha256: "bad", width: 90, height: 90 },
    { url: IMAGE_URL, sha256: "a".repeat(64), width: 8_401, height: 1 },
    { url: IMAGE_URL, sha256: "a".repeat(64), width: 90, height: 90, role: "first_frame" }
  ]) assert.throws(() => buildOwnerHiggsfieldDopWire(params, captured), { code: "INVALID_WIRE_CANDIDATE" });
  assert.throws(() => buildOwnerHiggsfieldDopWire(input({ model_id: "higgsfield" }), {
    url: IMAGE_URL, sha256: "a".repeat(64), width: 90, height: 90
  }), { code: "INVALID_WIRE_CANDIDATE" });
});
