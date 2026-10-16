import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256,
  getOwnerVeoOmniReferenceProfile,
  normalizeOwnerVeoOmniReferenceGenerationInput
} from "../src/application/owner-veo-omni-reference-profile.js";

const ATTEMPT = "link_veo_omni_references_2104_000001";
const HANDLE_1 = "veo_omni_reference_11111111-1111-4111-8111-111111111111";
const HANDLE_2 = "veo_omni_reference_22222222-2222-4222-8222-222222222222";
const HANDLE_3 = "veo_omni_reference_33333333-3333-4333-8333-333333333333";
const BASE = Object.freeze({
  attemptId: ATTEMPT,
  prompt: "A bright scene with [[ref:2]] beside [[ref:1]].",
  input_type: "references",
  upscale: 2,
  aspect_ratio: "9:16",
  video_duration: 8,
  reference_handles: [HANDLE_1, HANDLE_2]
});

test("Omni references profile preserves source modes, controls, upload facts, and a content hash", () => {
  const profile = getOwnerVeoOmniReferenceProfile();
  const hashable = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "profile_sha256"));

  assert.equal(profile.status, "CURRENT_1792156098_SOURCE_JOIN_OMNI_REFERENCES");
  assert.equal(profile.identity.model_id, "veo_omni");
  assert.equal(profile.identity.ai_name, "veo3");
  assert.deepEqual(profile.source_pins, {
    public_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
    public_models_sha256: "sha256:92c31dba26eb9c0ccf68cdf92a105e6e808c92b187286e4fb366debe051982e1",
    source_build_id: "1792156098",
    modules: {
      veo_form: "sha256:75c37d86280482f13b12d5edd546c36c0314cac91c24984aae0a6e9c7ba925a1",
      constants: "sha256:f56c58e705e32b6a4ddfc7cc44e62fd6ca029e6c33a848621812428a365ef2c2",
      video_sender: "sha256:3dbb36e710d6e35ae9babef856678af06cb5d2352beb7a67aa60d47cd6ffc49b",
      quality_helper: "sha256:7a38ef339db6700d1ccf7fe5a5be23e56722144f216e1db29bf7ff07b8849bf4",
      app: "sha256:eb1b2c82b9f62fbe378064bbd607cdb5cc875a4df1d2ae6f2d531d4baa59f042",
      settings_helper: "sha256:7fb7a1113b89060cdd9af313cb3f4a140c754959fbda3d997f49bdcacabc52e6",
      video_route: "sha256:8310cb1c9ac8221077220da873cfe785e35408b43b1cfba85d409272c9b44596",
      chat_input: "sha256:4b6139e2115b651af482800684f569f27dfa46e9154486814d1a8d376701a464",
      file_normalizer: "sha256:0ae5d53af76019a25d158d19e16ad513a13814c667b7768ee2d70c39465493dc"
    }
  });
  assert.deepEqual(profile.controls.input_type, ["text", "image", "references"]);
  assert.deepEqual(profile.controls.upscale.values, [0, 1, 2, 3]);
  assert.deepEqual(profile.controls.aspect_ratio, ["16:9", "9:16"]);
  assert.deepEqual(profile.controls.video_duration, [4, 6, 8, 10]);
  assert.deepEqual(profile.source_modes.text, { images: [0, 0], videos: [0, 0] });
  assert.deepEqual(profile.source_modes.image, { images: [1, 2], videos: [0, 0] });
  assert.deepEqual(profile.source_modes.references.images_only, { images: [1, 7], videos: [0, 0] });
  assert.deepEqual(profile.source_modes.references.one_video_with_images, { images: [0, 5], videos: [1, 1] });
  assert.deepEqual(profile.upload.source_tuple, {
    destination: "uploaded", check_duplicates: true, model_type: "veo_omni"
  });
  assert.deepEqual(profile.file_semantics.first_wins_dedupe_key, ["type", "url"]);
  assert.equal(profile.prompt_mentions.source_marker, "URL_MARKERS_ONLY_REPLACED_BY_SOURCE_SENDER");
  assert.equal(profile.prompt_mentions.adapter_convention, "[[ref:N]]_TO_SOURCE_URL_MARKER");
  assert.equal(profile.prompt_mentions.input_prompt_bounds, "CHECK_BEFORE_RENDERING");
  assert.equal(profile.prompt_mentions.expanded_prompt, "RECHECK_BOUND_BEFORE_POST");
  assert.equal(profile.local_resource_policy.default_max_file_bytes, 67_108_864);
  assert.equal(profile.local_resource_policy.minimum_configurable_file_bytes, 1);
  assert.equal(profile.local_resource_policy.configurable_cap_type, "POSITIVE_SAFE_INTEGER_BYTES");
  assert.equal(profile.public_limits.max_file_size_bytes, 1_048_576_000);
  assert.deepEqual(profile.public_limits.file_count_limit, { images: 7, videos: 1 });
  assert.equal(profile.effective_defaults, "UNKNOWN");
  assert.equal(profile.duration_upscale_compatibility, "UNKNOWN_NOT_ENFORCED");
  assert.equal(profile.dispatch_allowed, false);
  assert.equal(profile.backend_acceptance, "UNPROVEN");
  assert.match(OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(profile.profile_sha256, OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256);
  assert.equal(OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256,
    `sha256:${createHash("sha256").update(canonicalJson(hashable), "utf8").digest("hex")}`);
  assert.equal(getOwnerVeoOmniReferenceProfile(), profile);
  assert.equal(Object.isFrozen(profile), true);
  assert.equal(Object.isFrozen(profile.controls.upscale.values), true);
  assert.equal(Object.isFrozen(profile.source_modes.references.one_video_with_images), true);
});

test("Omni references normalizer accepts only explicit modes and every source control value", () => {
  for (const input_type of ["image", "references"] as const) {
    for (const upscale of [0, 1, 2, 3] as const) {
      for (const aspect_ratio of ["16:9", "9:16"] as const) {
        for (const video_duration of [4, 6, 8, 10] as const) {
          const input = { ...BASE, input_type, upscale, aspect_ratio, video_duration };
          const normalized = normalizeOwnerVeoOmniReferenceGenerationInput(input);
          assert.equal(normalized.attemptId, ATTEMPT);
          assert.equal(normalized.input_type, input_type);
          assert.equal(normalized.upscale, upscale);
          assert.equal(normalized.aspect_ratio, aspect_ratio);
          assert.equal(normalized.video_duration, video_duration);
          assert.deepEqual(normalized.reference_handles, [HANDLE_1, HANDLE_2]);
          assert.equal(Object.hasOwn(normalized, "mode"), false);
          assert.equal(Object.hasOwn(normalized, "model_id"), false);
          assert.equal(Object.hasOwn(normalized.semanticIntent, "attemptId"), false);
        }
      }
    }
  }
  assert.deepEqual(normalizeOwnerVeoOmniReferenceGenerationInput({
    ...BASE, input_type: "image", reference_handles: [HANDLE_1, HANDLE_2]
  }).semanticIntent, {
    prompt: BASE.prompt, input_type: "image", upscale: 2, aspect_ratio: "9:16",
    video_duration: 8, reference_handles: [HANDLE_1, HANDLE_2]
  });
  const sevenHandles = [HANDLE_1, HANDLE_2, HANDLE_3,
    "veo_omni_reference_44444444-4444-4444-8444-444444444444",
    "veo_omni_reference_55555555-5555-4555-8555-555555555555",
    "veo_omni_reference_66666666-6666-4666-8666-666666666666",
    "veo_omni_reference_77777777-7777-4777-8777-777777777777"];
  assert.equal(normalizeOwnerVeoOmniReferenceGenerationInput({
    ...BASE, reference_handles: sevenHandles
  }).reference_handles.length, 7);
  const noMentions = normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, prompt: "A calm scene with no links." });
  assert.deepEqual(noMentions.reference_mentions, []);
  assert.equal(noMentions.prompt, "A calm scene with no links.");
  assert.equal(normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, prompt: "12345678" }).prompt, "12345678");
});

test("Omni references normalizer maps local mentions to ordered handles with UTF-16 spans", () => {
  const prompt = "Café 🙂 [[ref:2]]; then [[ref:1]].";
  const normalized = normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, prompt });
  const firstStart = prompt.indexOf("[[ref:2]]");
  const secondStart = prompt.indexOf("[[ref:1]]");

  assert.deepEqual(normalized.reference_mentions, [
    { index: 2, start_utf16: firstStart, end_utf16: firstStart + 9 },
    { index: 1, start_utf16: secondStart, end_utf16: secondStart + 9 }
  ]);
  for (const mention of normalized.reference_mentions) {
    assert.equal(prompt.slice(mention.start_utf16, mention.end_utf16), `[[ref:${mention.index}]]`);
  }
  assert.equal(normalized.prompt, prompt);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.semanticIntent), true);
  assert.equal(Object.isFrozen(normalized.reference_handles), true);
  assert.equal(Object.isFrozen(normalized.reference_mentions), true);
  assert.equal(Object.isFrozen(normalized.reference_mentions[0]), true);
});

test("Omni references normalizer rejects missing defaults, extra routing fields, and invalid handles", () => {
  const invalid = [
    { ...BASE, upscale: undefined }, { ...BASE, video_duration: undefined },
    { ...BASE, input_type: "text" }, { ...BASE, input_type: undefined },
    { ...BASE, model_id: "veo_omni" }, { ...BASE, model_type: "veo_omni" },
    { ...BASE, file_urls: ["https://example.invalid/ref.png"] },
    { ...BASE, url: "https://example.invalid/ref.png" },
    { ...BASE, cost_parameters: { mode: "video_ref" } },
    { ...BASE, role: "first_frame" },
    { ...BASE, reference_handles: [] },
    { ...BASE, input_type: "image", reference_handles: [HANDLE_1, HANDLE_2, HANDLE_3] },
    { ...BASE, reference_handles: [HANDLE_1, HANDLE_1] },
    { ...BASE, attemptId: `${ATTEMPT}\n` },
    { ...BASE, attemptId: "unbound" },
    { ...BASE, reference_handles: ["not-a-veo-handle"] },
    { ...BASE, reference_handles: Array.from({ length: 8 }, (_, i) =>
      `veo_omni_reference_${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`) }
  ];
  for (const input of invalid) {
    assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput(input), /INVALID_REQUEST/u);
  }
});

test("Omni references normalizer rejects malformed mentions and raw source URL markers", () => {
  for (const prompt of [
    "short", "A prompt with [[ref:0]] token", "A prompt with [[ref:3]] token",
    "A prompt with [[ref:x]] token", "A prompt with [[ref:1] token",
    "A prompt with <<<https://example.invalid/a.png>>> token",
    "A prompt with <<< token", "A prompt with >>> token"
  ]) {
    assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, prompt }), /INVALID_REQUEST/u);
  }
  assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, prompt: "bad\u0000prompt" }), /INVALID_REQUEST/u);
  assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, prompt: "bad\ud800prompt" }), /INVALID_REQUEST/u);
  assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, prompt: "🙂".repeat(50_001) }), /INVALID_REQUEST/u);
  assert.equal(normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, prompt: "🙂".repeat(50_000) }).prompt.length, 100_000);
});

test("Omni references normalizer rejects proxies and accessors without invoking them", () => {
  let accessorCalls = 0;
  const accessorInput = Object.defineProperty({ ...BASE }, "prompt", {
    enumerable: true,
    get() { accessorCalls += 1; return BASE.prompt; }
  });
  assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput(accessorInput), /INVALID_REQUEST/u);
  assert.equal(accessorCalls, 0);
  assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput(new Proxy({ ...BASE }, {})), /INVALID_REQUEST/u);
  assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput({
    ...BASE, reference_handles: new Proxy([HANDLE_1, HANDLE_2], {})
  }), /INVALID_REQUEST/u);

  const accessorHandles = Object.defineProperty([HANDLE_1, HANDLE_2], "0", {
    enumerable: true,
    configurable: true,
    get() { accessorCalls += 1; return HANDLE_1; }
  });
  assert.throws(() => normalizeOwnerVeoOmniReferenceGenerationInput({ ...BASE, reference_handles: accessorHandles }), /INVALID_REQUEST/u);
  assert.equal(accessorCalls, 0);
});

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
