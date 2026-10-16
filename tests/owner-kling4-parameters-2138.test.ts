import assert from "node:assert/strict";
import test from "node:test";
import {
  getOwnerKling4SourceProfile,
  normalizeOwnerKling4Parameters,
  OwnerKling4ParametersError,
  type OwnerKling4ParametersModelId
} from "../src/application/owner-kling4-parameters.js";

const LINK_ATTEMPT = `link_${"a".repeat(20)}`;
const HANDLE_1 = "kling4_reference_00000000-0000-4000-8000-000000000001";
const HANDLE_2 = "kling4_reference_00000000-0000-4000-8000-000000000002";
const HANDLE_3 = "kling4_reference_00000000-0000-4000-8000-000000000003";

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    attemptId: LINK_ATTEMPT,
    model_id: "kling_4_keyframes",
    prompt: "Arrange the supplied frames into one coherent shot.",
    version: "4.0",
    mode: "standart",
    aspect_ratio: "16:9",
    video_duration: 3,
    native_audio: true,
    reference_handles: [HANDLE_1],
    ...overrides
  };
}

function handles(count: number): string[] {
  const ids = [HANDLE_1, HANDLE_2, HANDLE_3];
  for (let index = ids.length; index < count; index += 1) {
    const suffix = (index + 1).toString(16).padStart(12, "0");
    ids.push(`kling4_reference_00000000-0000-4000-8000-${suffix}`);
  }
  return ids.slice(0, count);
}

function expectInvalid(input: unknown): void {
  assert.throws(() => normalizeOwnerKling4Parameters(input), (error: unknown) =>
    error instanceof OwnerKling4ParametersError && error.code === "INVALID_CANDIDATE");
}

test("builds a source-only immutable K4 candidate and records UTF-16 mention spans", () => {
  const prompt = "😀 [[ref:1]]\nKeep the original wording. ";
  const normalized = normalizeOwnerKling4Parameters(candidate({ prompt, aspect_ratio: "21:9", mode: "hd" }));
  const profile = getOwnerKling4SourceProfile("kling_4_keyframes");

  assert.equal(normalized.prompt, prompt);
  assert.deepEqual(normalized.reference_mentions, [{ index: 1, start_utf16: 3, end_utf16: 12 }]);
  assert.deepEqual(normalized.reference_handles, [HANDLE_1]);
  assert.equal(normalized.profile_sha256, profile.source_sha256);
  assert.deepEqual(normalized.semanticIntent, {
    model_id: "kling_4_keyframes", version: "4.0", mode: "hd", aspect_ratio: "21:9",
    video_duration: 3, native_audio: true, reference_count: 1
  });
  assert.equal(normalized.runtime_usable, false);
  assert.equal(normalized.dispatch_allowed, false);
  assert.equal(normalized.provider_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.reference_handles), true);
  assert.equal(Object.isFrozen(normalized.reference_mentions), true);
  assert.equal(Object.isFrozen(normalized.semanticIntent), true);
});

test("exposes distinct source-bound profiles without promoting runtime or unresolved roles", () => {
  const keyframes = getOwnerKling4SourceProfile("kling_4_keyframes");
  const omni = getOwnerKling4SourceProfile("kling_4_omni");

  assert.notEqual(keyframes.source_sha256, omni.source_sha256);
  assert.equal(keyframes.model_id, "kling_4_keyframes");
  assert.equal(omni.model_id, "kling_4_omni");
  assert.equal(keyframes.input_profile.allowed_media_types[0], "images");
  assert.deepEqual(omni.input_profile.allowed_media_types, ["images", "videos"]);
  assert.equal(omni.input_profile.per_media_count_enforcement, "FUTURE_TYPED_PREPARER");
  assert.equal(omni.input_profile.aggregate_video_duration_enforcement, "FUTURE_PREPARER");
  assert.equal(keyframes.gaps.multi_shots_cache_absence, "UNPROVEN");
  assert.equal(keyframes.settings.local_closed_exclusions.includes("multi_shots"), true);
  assert.equal(keyframes.runtime_usable, false);
  assert.equal(omni.dispatch_allowed, false);
  assert.match(keyframes.source_sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(keyframes.source_bindings.current_form.sha256, keyframes.source_bindings.settings_helper.sha256);
  assert.equal(Object.isFrozen(keyframes.source_bindings), true);
  assert.equal(Object.isFrozen(keyframes.input_profile.allowed_media_types), true);
  assert.throws(() => getOwnerKling4SourceProfile("kling_keyframes" as OwnerKling4ParametersModelId), OwnerKling4ParametersError);
});

test("requires explicit K4 version, allowed mode, ratio, duration, and audio branch", () => {
  for (const patch of [
    { version: "3.0-turbo" }, { version: "" }, { mode: "4k" }, { aspect_ratio: "4:3" },
    { video_duration: 2 }, { video_duration: 31 }, { video_duration: 3.5 }, { native_audio: false }
  ]) expectInvalid(candidate(patch));

  const omni = normalizeOwnerKling4Parameters(candidate({ model_id: "kling_4_omni", native_audio: false }));
  assert.equal(omni.model_id, "kling_4_omni");
  assert.equal(omni.native_audio, false);
  assert.equal(omni.semanticIntent.native_audio, false);
});

test("enforces Keyframes duration-based count and Omni total-count bounds only", () => {
  const keyframesAtFour = normalizeOwnerKling4Parameters(candidate({ video_duration: 3, reference_handles: handles(4) }));
  assert.equal(keyframesAtFour.reference_handles.length, 4);
  expectInvalid(candidate({ video_duration: 3, reference_handles: handles(5) }));
  assert.equal(normalizeOwnerKling4Parameters(candidate({ video_duration: 30, reference_handles: handles(10) })).reference_handles.length, 10);
  expectInvalid(candidate({ video_duration: 30, reference_handles: handles(11) }));

  const omniAtFifteen = normalizeOwnerKling4Parameters(candidate({ model_id: "kling_4_omni", reference_handles: handles(15) }));
  assert.equal(omniAtFifteen.reference_handles.length, 15);
  expectInvalid(candidate({ model_id: "kling_4_omni", reference_handles: handles(16) }));
  assert.equal(omniAtFifteen.semanticIntent.reference_count, 15);
});

test("keeps zero-reference candidates source-only and requires references for an empty prompt", () => {
  const candidateWithoutReferences = normalizeOwnerKling4Parameters(candidate({ reference_handles: [] }));
  assert.equal(candidateWithoutReferences.reference_handles.length, 0);
  assert.equal(candidateWithoutReferences.runtime_usable, false);
  assert.equal(candidateWithoutReferences.dispatch_allowed, false);
  expectInvalid(candidate({ prompt: " \n\t ", reference_handles: [] }));
  const referenceOnly = normalizeOwnerKling4Parameters(candidate({ prompt: " \n\t ", reference_handles: [HANDLE_1] }));
  assert.equal(referenceOnly.prompt, " \n\t ");
});

test("parses only ordered local reference mentions with in-range targets", () => {
  const prompt = "A [[ref:1]] + [[ref:2]]\n";
  const normalized = normalizeOwnerKling4Parameters(candidate({ prompt, reference_handles: [HANDLE_1, HANDLE_2] }));
  assert.deepEqual(normalized.reference_mentions, [
    { index: 1, start_utf16: 2, end_utf16: 11 },
    { index: 2, start_utf16: 14, end_utf16: 23 }
  ]);
  for (const malformed of ["[[ref:0]]", "[[ref:01]]", "[[ref:2]]", "[[ref:1]", "[[ref:x]]", "<<<raw-url>>>"]) {
    expectInvalid(candidate({ prompt: malformed }));
  }
});

test("enforces local prompt length, well-formed Unicode, and controls while preserving text", () => {
  expectInvalid(candidate({ prompt: "x".repeat(24_001) }));
  expectInvalid(candidate({ prompt: "bad\u0000text" }));
  expectInvalid(candidate({ prompt: "lone high surrogate: \ud800" }));
  expectInvalid(candidate({ prompt: "lone low surrogate: \udc00" }));
  const allowedWhitespace = "\tLine one\r\nLine two  ";
  assert.equal(normalizeOwnerKling4Parameters(candidate({ prompt: allowedWhitespace })).prompt, allowedWhitespace);
});

test("rejects duplicate, malformed, sparse, accessor, and proxied reference handles", () => {
  expectInvalid(candidate({ reference_handles: [HANDLE_1, HANDLE_1] }));
  expectInvalid(candidate({ reference_handles: ["https://example.invalid/video.mp4"] }));
  expectInvalid(candidate({ reference_handles: ["kling4_reference_not-a-uuid"] }));
  const sparse = new Array<string>(2);
  sparse[0] = HANDLE_1;
  expectInvalid(candidate({ reference_handles: sparse }));
  expectInvalid(candidate({ reference_handles: new Proxy([HANDLE_1], {}) }));
  let touched = false;
  const accessorHandle = Object.defineProperty([], "0", { enumerable: true, configurable: true, get() { touched = true; return HANDLE_1; } });
  Object.defineProperty(accessorHandle, "length", { value: 1 });
  expectInvalid(candidate({ reference_handles: accessorHandle }));
  assert.equal(touched, false);
});

test("rejects branch fields, raw extra settings, malformed objects, and untrusted field access", () => {
  for (const field of ["temperature", "camera_movement", "multi_shots", "gen_type", "motion", "type", "n", "customPayload"]) {
    expectInvalid(candidate({ [field]: "stale" }));
  }
  for (const field of ["attemptId", "model_id", "prompt", "version", "mode", "aspect_ratio", "video_duration", "native_audio", "reference_handles"]) {
    const missing = candidate();
    delete missing[field];
    expectInvalid(missing);
  }
  let touched = false;
  const withGetter = candidate();
  Object.defineProperty(withGetter, "prompt", { enumerable: true, configurable: true, get() { touched = true; return "do not call"; } });
  expectInvalid(withGetter);
  assert.equal(touched, false);
  expectInvalid(new Proxy(candidate(), {}));
});
