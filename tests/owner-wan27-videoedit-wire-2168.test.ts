import assert from "node:assert/strict";
import test from "node:test";
import * as importedWire from "../src/application/owner-wan27-videoedit-wire.js";

const WIRE_API = importedWire as unknown as {
  buildOwnerWan27VideoEditWire(input: unknown, references: unknown): Readonly<Record<string, unknown>>;
};

function input(overrides: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    model_id: "wan_27_videoedit",
    prompt: "Preserve the exact prompt, without markers.",
    resolution: "720P",
    aspect_ratio: "16:9",
    audio_setting: "auto",
    prompt_extend: true,
    seed: null,
    duration_mode: "preserve_input",
    ...overrides
  };
}

function image(handle: string, url: string, sha256: string): Record<string, unknown> {
  return { reference_handle: handle, kind: "image", url, sha256, duration_seconds: null };
}

function video(handle: string, url: string, sha256: string, duration_seconds: number): Record<string, unknown> {
  return { reference_handle: handle, kind: "video", url, sha256, duration_seconds };
}

function safeUrl(name: string): string { return `https://r2.syntx.ai/wan27-videoedit/${name}`; }

function validMixedReferences(): Record<string, unknown>[] {
  return [
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000001", safeUrl("first.png"), "a".repeat(64)),
    video("wan27_videoedit_reference_00000000-0000-4000-8000-000000000002", safeUrl("clip.mp4"), "b".repeat(64), 4.137),
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000003", safeUrl("last.webp"), "c".repeat(64))
  ];
}

function invalidWire(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: unknown }).code === "INVALID_WIRE_CANDIDATE";
}

function build(userInput: unknown, references: unknown): Readonly<Record<string, unknown>> {
  return WIRE_API.buildOwnerWan27VideoEditWire(userInput, references);
}

function wireOf(candidate: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return candidate.wire as Readonly<Record<string, unknown>>;
}

function settingsOf(candidate: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return wireOf(candidate).settings as Readonly<Record<string, unknown>>;
}

test("builds exact ordered typed wire and cost projection from one captured video duration", () => {
  const refs = validMixedReferences();
  const candidate = build(input(), refs);
  const wire = wireOf(candidate);
  assert.equal(wire.ai_name, "wan_video");
  assert.equal(wire.prompt, "Preserve the exact prompt, without markers.");
  assert.deepEqual(settingsOf(candidate), {
    model_type: "wan_27_videoedit",
    resolution: "720P",
    aspect_ratio: "16:9",
    video_duration: 4.14,
    audio_setting: "auto",
    prompt_extend: true,
    seed: null,
    native_audio: false,
    shot_type: "single",
    duration: 4.14,
    rendering_speed: "basic",
    file_urls: [
      { type: "image", url: safeUrl("first.png") },
      { type: "video", url: safeUrl("clip.mp4") },
      { type: "image", url: safeUrl("last.webp") }
    ]
  });
  assert.deepEqual(candidate.cost_parameters, { resolution: "720P", video_duration: 4.14, duration: 4.14 });
  assert.equal(candidate.files_mention, false);
  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(candidate.reference_binding, "SOURCE_ROWS_ONLY_NOT_NOMINAL");
  assert.equal(candidate.backend_acceptance, "UNPROVEN");
  assert.match(String(candidate.profile_sha256), /^sha256:[a-f0-9]{64}$/u);
  assert.equal("reference_handles" in candidate, false);
  assert.equal("duration_mode" in settingsOf(candidate), false);
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(wire), true);
  assert.equal(Object.isFrozen(settingsOf(candidate).file_urls), true);
});

test("uses only the video reference duration and rejects caller-supplied duration context", () => {
  const refs = validMixedReferences();
  const custom = build(input({ duration_mode: "custom", custom_video_duration: 3 }), refs);
  assert.deepEqual(settingsOf(custom), {
    model_type: "wan_27_videoedit",
    resolution: "720P",
    aspect_ratio: "16:9",
    video_duration: 3,
    audio_setting: "auto",
    prompt_extend: true,
    seed: null,
    native_audio: false,
    shot_type: "single",
    duration: 4.14,
    rendering_speed: "basic",
    file_urls: [
      { type: "image", url: safeUrl("first.png") },
      { type: "video", url: safeUrl("clip.mp4") },
      { type: "image", url: safeUrl("last.webp") }
    ]
  });
  assert.throws(() => build(input({ source_input_duration_seconds: 10 }), refs), invalidWire);
});

test("keeps intent fingerprint stable across upload URLs and duration aliases but wire fingerprint tracks URLs", () => {
  const refs = [video("wan27_videoedit_reference_00000000-0000-4000-8000-000000000004", safeUrl("one.mp4"), "d".repeat(64), 2)];
  const preserve = build(input(), refs);
  const custom = build(input({ duration_mode: "custom", custom_video_duration: 2 }), [
    video("wan27_videoedit_reference_00000000-0000-4000-8000-000000000005", safeUrl("two.mp4"), "d".repeat(64), 2)
  ]);
  assert.equal(preserve.intent_fingerprint, custom.intent_fingerprint);
  assert.notEqual(preserve.wire_fingerprint, custom.wire_fingerprint);
  assert.notDeepEqual(settingsOf(preserve).file_urls, settingsOf(custom).file_urls);
});

test("changes semantic fingerprint when ordered reference types or source hashes change", () => {
  const imageRef = image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000006", safeUrl("same.png"), "e".repeat(64));
  const videoRef = video("wan27_videoedit_reference_00000000-0000-4000-8000-000000000007", safeUrl("same.mp4"), "f".repeat(64), 4);
  const imageThenVideo = build(input(), [imageRef, videoRef]);
  const videoThenImage = build(input(), [videoRef, imageRef]);
  assert.notEqual(imageThenVideo.intent_fingerprint, videoThenImage.intent_fingerprint);
  const changedContent = build(input(), [{ ...imageRef, sha256: "1".repeat(64) }, videoRef]);
  assert.notEqual(imageThenVideo.intent_fingerprint, changedContent.intent_fingerprint);
});

test("rejects missing or excess media kinds, duplicate handles, typed URLs and content hashes", () => {
  const imageOnly = [image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000008", safeUrl("image.png"), "1".repeat(64))];
  assert.throws(() => build(input(), imageOnly), invalidWire);
  const maxSupported = [
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000020", safeUrl("max1.png"), "2".repeat(64)),
    video("wan27_videoedit_reference_00000000-0000-4000-8000-000000000021", safeUrl("max.mp4"), "3".repeat(64), 4),
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000022", safeUrl("max2.png"), "4".repeat(64)),
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000023", safeUrl("max3.png"), "5".repeat(64)),
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000024", safeUrl("max4.png"), "6".repeat(64))
  ];
  assert.equal((settingsOf(build(input(), maxSupported)).file_urls as unknown[]).length, 5);
  const refs = validMixedReferences();
  assert.throws(() => build(input(), [...refs, video("wan27_videoedit_reference_00000000-0000-4000-8000-000000000009", safeUrl("second.mp4"), "9".repeat(64), 3)]), invalidWire);
  assert.throws(() => build(input(), [...refs,
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000010", safeUrl("extra.png"), "8".repeat(64)),
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000011", safeUrl("extra2.png"), "7".repeat(64)),
    image("wan27_videoedit_reference_00000000-0000-4000-8000-000000000012", safeUrl("extra3.png"), "6".repeat(64))]), invalidWire);
  assert.throws(() => build(input(), [refs[0]!, refs[1]!, { ...refs[2]!, reference_handle: refs[0]!.reference_handle }]), invalidWire);
  assert.throws(() => build(input(), [refs[0]!, refs[1]!, { ...refs[2]!, url: refs[0]!.url }]), invalidWire);
  assert.throws(() => build(input(), [refs[0]!, refs[1]!, { ...refs[2]!, sha256: refs[0]!.sha256 }]), invalidWire);
  assert.throws(() => build(input(), [refs[0]!, { ...refs[1]!, reference_handle: "forged" }, refs[2]!]), invalidWire);
});

test("rejects unsafe URLs, invalid hashes, malformed rows and hostile arrays or accessors", () => {
  const refs = validMixedReferences();
  assert.throws(() => build(input(), [refs[0]!, { ...refs[1]!, url: "https://attacker.invalid/clip.mp4" }, refs[2]!]), invalidWire);
  assert.throws(() => build(input(), [refs[0]!, { ...refs[1]!, sha256: "not-a-digest" }, refs[2]!]), invalidWire);
  assert.throws(() => build(input(), [refs[0]!, { ...refs[1]!, duration_seconds: 11 }, refs[2]!]), invalidWire);
  assert.throws(() => build(input(), [refs[0]!, { ...refs[1]!, duration_seconds: null }, refs[2]!]), invalidWire);
  assert.throws(() => build(input({ file_urls: [] }), refs), invalidWire);
  assert.throws(() => build(input({ files_mention: true }), refs), invalidWire);
  assert.throws(() => build(new Proxy(input(), {}), refs), invalidWire);
  assert.throws(() => build(input(), new Proxy(refs, {})), invalidWire);
  const getterRef = { ...refs[0]! };
  Object.defineProperty(getterRef, "url", { enumerable: true, get: () => safeUrl("getter.png") });
  assert.throws(() => build(input(), [getterRef, refs[1]!, refs[2]!]), invalidWire);
});
