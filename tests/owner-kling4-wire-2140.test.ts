import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  getOwnerKling4SourceProfile,
  OwnerKling4ParametersError
} from "../src/application/owner-kling4-parameters.js";
import { buildOwnerKling4Wire as buildOwnerKling4WireCandidate } from "../src/application/owner-kling4-wire.js";

const HANDLE_1 = "kling4_reference_11111111-1111-4111-8111-111111111111";
const HANDLE_2 = "kling4_reference_22222222-2222-4222-8222-222222222222";
const HANDLE_3 = "kling4_reference_33333333-3333-4333-8333-333333333333";
const URL_1 = "https://r2.syntx.ai/private/kling4/image-one";
const URL_2 = "https://r2.syntx.ai/private/kling4/image-two";
const URL_3 = "https://r2.syntx.ai/private/kling4/video-one";
const HASH_1 = "1".repeat(64);
const HASH_2 = "2".repeat(64);
const HASH_3 = "3".repeat(64);
const ATTEMPT = "link_owner_kling4_wire_2140_000001";

test("Keyframes emits only source-backed settings and expands one-based mentions in handle order", () => {
  const input = candidate({
    prompt: "First [[ref:2]], then [[ref:1]].\n",
    reference_handles: [HANDLE_1, HANDLE_2]
  });
  const wire = buildOwnerKling4WireCandidate(input, [
    reference(HANDLE_1, "image", URL_1, HASH_1),
    reference(HANDLE_2, "image", URL_2, HASH_2)
  ]);

  assert.equal(wire.status, "SOURCE_ONLY_KLING4_WIRE_CANDIDATE");
  assert.equal(wire.ai_name, "kling");
  assert.equal(wire.prompt, `First <<<${URL_2}>>>, then <<<${URL_1}>>>.\n`);
  assert.deepEqual(wire.settings, {
    model_type: "kling_4_keyframes",
    version: "4.0",
    mode: "standart",
    aspect_ratio: "16:9",
    video_duration: 3,
    native_audio: true,
    file_urls: [{ type: "image", url: URL_1 }, { type: "image", url: URL_2 }]
  });
  assert.deepEqual(wire.cost_parameters, { mode: "standart", version: "4.0", video_duration: 3 });
  assert.equal(wire.input_reference_count, 2);
  assert.equal(wire.wire_reference_count, 2);
  assert.equal(wire.generation_permit, false);
  assert.equal(wire.runtime_usable, false);
  assert.equal(wire.dispatch_allowed, false);
  assert.equal(wire.provider_acceptance, "UNPROVEN");
  assert.equal(Object.isFrozen(wire), true);
  assert.equal(Object.isFrozen(wire.settings.file_urls), true);
  assert.equal(Object.isFrozen(wire.settings.file_urls[0]), true);
});

test("Omni cost uses selected video seconds and keeps cost duration out of GEN settings", () => {
  const wire = buildOwnerKling4WireCandidate(candidate({
    model_id: "kling_4_omni",
    native_audio: false,
    reference_handles: [HANDLE_1, HANDLE_2, HANDLE_3],
    prompt: "Animate [[ref:2]] with [[ref:1]]."
  }), [
    reference(HANDLE_1, "image", URL_1, HASH_1),
    reference(HANDLE_2, "video", URL_3, HASH_2, 3.25),
    reference(HANDLE_3, "video", "https://r2.syntx.ai/private/kling4/video-two", HASH_3, 4.5)
  ]);

  assert.equal(wire.prompt, `Animate <<<${URL_3}>>> with <<<${URL_1}>>>.`);
  assert.deepEqual(wire.settings, {
    model_type: "kling_4_omni",
    version: "4.0",
    mode: "standart",
    aspect_ratio: "16:9",
    video_duration: 3,
    native_audio: false,
    file_urls: [
      { type: "image", url: URL_1 },
      { type: "video", url: URL_3 },
      { type: "video", url: "https://r2.syntx.ai/private/kling4/video-two" }
    ]
  });
  assert.deepEqual(wire.cost_parameters, {
    duration: "7.75", mode: "standart", version: "4.0", video_duration: 3
  });
  assert.equal(Object.hasOwn(wire.settings, "duration"), false);
  assert.equal(Object.hasOwn(wire.settings, "inputVideoDuration"), false);
});

test("Omni image-only inputs cost zero duration while image records require null duration", () => {
  const wire = buildOwnerKling4WireCandidate(candidate({
    model_id: "kling_4_omni", native_audio: true, reference_handles: [HANDLE_1]
  }), [reference(HANDLE_1, "image", URL_1, HASH_1, null)]);
  assert.deepEqual(wire.cost_parameters, {
    duration: 0, mode: "standart", version: "4.0", video_duration: 3
  });
  assert.equal(wire.settings.file_urls[0]?.type, "image");
});

test("zero references remain a non-permitted candidate because no minimum is source-proven", () => {
  const wire = buildOwnerKling4WireCandidate(candidate({ reference_handles: [], prompt: "A quiet scene." }), []);
  assert.deepEqual(wire.settings.file_urls, []);
  assert.equal(wire.input_reference_count, 0);
  assert.equal(wire.wire_reference_count, 0);
  assert.equal(wire.generation_permit, false);
});

test("Keyframes enforces its duration-derived image count, image-only kind and forced audio", () => {
  const handles = [HANDLE_1, HANDLE_2, HANDLE_3, ...makeHandles(1)];
  const accepted = buildOwnerKling4WireCandidate(candidate({ reference_handles: handles }),
    handles.map((handle, index) => reference(handle, "image", `https://r2.syntx.ai/k4/image-${index}`, hash(index + 1))));
  assert.equal(accepted.input_reference_count, 4);
  const overLimitHandles = [HANDLE_1, HANDLE_2, HANDLE_3, ...makeHandles(2)];
  assert.throws(() => buildOwnerKling4WireCandidate(candidate({ reference_handles: overLimitHandles }),
    overLimitHandles.map((handle, index) => reference(handle, "image", `https://r2.syntx.ai/k4/image-${index}`, hash(index + 1)))),
  (error: unknown) => error instanceof OwnerKling4ParametersError && error.code === "INVALID_CANDIDATE");
  assert.throws(() => buildOwnerKling4WireCandidate(candidate({ native_audio: false }), [
    reference(HANDLE_1, "image", URL_1, HASH_1)
  ]), (error: unknown) => error instanceof OwnerKling4ParametersError && error.code === "INVALID_CANDIDATE");
  assert.throws(() => buildOwnerKling4WireCandidate(candidate(), [
    reference(HANDLE_1, "video", URL_3, HASH_1, 3)
  ]), /INVALID_REFERENCE_WIRE/u);
});

test("Omni applies per-kind file limits, selected video bounds, and aggregate duration cap", () => {
  const imageHandles = makeHandles(11);
  assert.throws(() => buildOwnerKling4WireCandidate(candidate({
    model_id: "kling_4_omni", native_audio: false, reference_handles: imageHandles
  }), imageHandles.map((handle, index) => reference(handle, "image", `https://r2.syntx.ai/k4/i-${index}`, hash(index + 1)))),
  /INVALID_REFERENCE_WIRE/u);

  const sixVideoHandles = makeHandles(6);
  assert.throws(() => buildOwnerKling4WireCandidate(candidate({
    model_id: "kling_4_omni", native_audio: false, reference_handles: sixVideoHandles
  }), sixVideoHandles.map((handle, index) => reference(handle, "video", `https://r2.syntx.ai/k4/v-${index}`, hash(index + 1), 3))),
  /INVALID_REFERENCE_WIRE/u);

  const twoVideoHandles = [HANDLE_1, HANDLE_2];
  for (const duration of [2.99, 30.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => buildOwnerKling4WireCandidate(candidate({
      model_id: "kling_4_omni", native_audio: false, reference_handles: [HANDLE_1]
    }), [reference(HANDLE_1, "video", URL_3, HASH_1, duration)]), /INVALID_REFERENCE_WIRE/u);
  }
  assert.throws(() => buildOwnerKling4WireCandidate(candidate({
    model_id: "kling_4_omni", native_audio: false, reference_handles: twoVideoHandles
  }), [
    reference(HANDLE_1, "video", URL_3, HASH_1, 15.01),
    reference(HANDLE_2, "video", "https://r2.syntx.ai/k4/v2", HASH_2, 15)
  ]), /INVALID_REFERENCE_WIRE/u);
});

test("wire records must be exact, dense, ordered, safe, hash-bound candidates", () => {
  const base = [reference(HANDLE_1, "image", URL_1, HASH_1), reference(HANDLE_2, "image", URL_2, HASH_2)];
  assert.throws(() => buildOwnerKling4WireCandidate(candidate({ reference_handles: [HANDLE_1, HANDLE_2] }), [base[1]!, base[0]!]),
    /INVALID_REFERENCE_WIRE/u);
  assert.throws(() => buildOwnerKling4WireCandidate(candidate(), [{ ...base[0]!, extra: "role" }]),
    /INVALID_REFERENCE_WIRE/u);
  assert.throws(() => buildOwnerKling4WireCandidate(candidate(), [
    Object.defineProperty({ ...base[0]! }, "url", { enumerable: true, get: () => URL_1 })
  ]), /INVALID_REFERENCE_WIRE/u);
  assert.throws(() => buildOwnerKling4WireCandidate(candidate(), new Proxy(base, {})), /INVALID_REFERENCE_WIRE/u);
  assert.throws(() => buildOwnerKling4WireCandidate(candidate(), [base[0], , base[1]]), /INVALID_REFERENCE_WIRE/u);

  for (const url of [
    "http://r2.syntx.ai/file", "https://attacker.example/file", "https://user@r2.syntx.ai/file",
    "https://r2.syntx.ai/file#fragment", "https://r2.syntx.ai/path with-space", "https://r2.syntx.ai/<<<marker>>>"
  ]) {
    assert.throws(() => buildOwnerKling4WireCandidate(candidate(), [reference(HANDLE_1, "image", url, HASH_1)]),
      /INVALID_REFERENCE_WIRE/u);
  }
  assert.throws(() => buildOwnerKling4WireCandidate(candidate(), [reference(HANDLE_1, "image", URL_1, "A".repeat(64))]),
    /INVALID_REFERENCE_WIRE/u);
});

test("same-content duplicates fail, while type-and-URL wire duplicates are first-wins", () => {
  const duplicateHash = [
    reference(HANDLE_1, "image", URL_1, HASH_1),
    reference(HANDLE_2, "image", URL_2, HASH_1)
  ];
  assert.throws(() => buildOwnerKling4WireCandidate(candidate({ reference_handles: [HANDLE_1, HANDLE_2] }), duplicateHash),
    /INVALID_REFERENCE_WIRE/u);

  const duplicateUrlInput = candidate({ reference_handles: [HANDLE_1, HANDLE_2], prompt: "Choose [[ref:2]]." });
  const duplicateUrlWire = buildOwnerKling4WireCandidate(duplicateUrlInput, [
    reference(HANDLE_1, "image", URL_1, HASH_1),
    reference(HANDLE_2, "image", URL_1, HASH_2)
  ]);
  assert.deepEqual(duplicateUrlWire.settings.file_urls, [{ type: "image", url: URL_1 }]);
  assert.equal(duplicateUrlWire.input_reference_count, 2);
  assert.equal(duplicateUrlWire.wire_reference_count, 1);
  assert.equal(duplicateUrlWire.prompt, `Choose <<<${URL_1}>>>.`);
});

test("semantic fingerprint excludes attempt, handle and URL but wire fingerprint binds the private wire", () => {
  const original = buildOwnerKling4WireCandidate(candidate({ reference_handles: [HANDLE_1] }), [
    reference(HANDLE_1, "image", URL_1, HASH_1)
  ]);
  const rotated = buildOwnerKling4WireCandidate(candidate({
    attemptId: "link_owner_kling4_wire_2140_000002", reference_handles: [HANDLE_2]
  }), [reference(HANDLE_2, "image", "https://r2.syntx.ai/private/kling4/image-rotated", HASH_1)]);
  assert.equal(rotated.intent_fingerprint, original.intent_fingerprint);
  assert.notEqual(rotated.wire_fingerprint, original.wire_fingerprint);

  const differentAttempt = buildOwnerKling4WireCandidate(candidate({
    attemptId: "link_owner_kling4_wire_2140_000003", reference_handles: [HANDLE_1]
  }), [reference(HANDLE_1, "image", URL_1, HASH_1)]);
  assert.equal(differentAttempt.intent_fingerprint, original.intent_fingerprint);
  assert.equal(differentAttempt.wire_fingerprint, original.wire_fingerprint);

  const differentContent = buildOwnerKling4WireCandidate(candidate({ reference_handles: [HANDLE_1] }), [
    reference(HANDLE_1, "image", URL_1, HASH_2)
  ]);
  assert.notEqual(differentContent.intent_fingerprint, original.intent_fingerprint);
  assert.equal(differentContent.wire_fingerprint, original.wire_fingerprint);

  const differentControls = buildOwnerKling4WireCandidate(candidate({
    reference_handles: [HANDLE_1], mode: "hd"
  }), [reference(HANDLE_1, "image", URL_1, HASH_1)]);
  assert.notEqual(differentControls.intent_fingerprint, original.intent_fingerprint);
  assert.notEqual(differentControls.wire_fingerprint, original.wire_fingerprint);

  const changedIntent = buildOwnerKling4WireCandidate(candidate({
    reference_handles: [HANDLE_1], prompt: "A different scene with [[ref:1]]."
  }), [reference(HANDLE_1, "image", URL_1, HASH_1)]);
  assert.notEqual(changedIntent.intent_fingerprint, original.intent_fingerprint);

  const profile = getOwnerKling4SourceProfile("kling_4_keyframes");
  const expectedWireLayout = [
    "owner-kling4-reference-wire-v1",
    profile.source_sha256,
    {
      ai_name: "kling",
      prompt: `A quiet frame <<<${URL_1}>>>.`,
      settings: {
        model_type: "kling_4_keyframes", version: "4.0", mode: "standart", aspect_ratio: "16:9",
        video_duration: 3, native_audio: true, file_urls: [{ type: "image", url: URL_1 }]
      }
    },
    { mode: "standart", version: "4.0", video_duration: 3 }
  ];
  assert.equal(original.wire_fingerprint,
    `sha256:${createHash("sha256").update(JSON.stringify(expectedWireLayout), "utf8").digest("hex")}`);
});

test("expanded prompt preserves whitespace and is checked against the UTF-16 limit", () => {
  const prompt = "Café 🙂\n[[ref:1]]\r\nlast\tline.";
  const wire = buildOwnerKling4WireCandidate(candidate({ prompt, reference_handles: [HANDLE_1] }), [
    reference(HANDLE_1, "image", URL_1, HASH_1)
  ]);
  assert.equal(wire.prompt, `Café 🙂\n<<<${URL_1}>>>\r\nlast\tline.`);

  const longUrl = `https://r2.syntx.ai/${"a".repeat(4050)}`;
  const marker = "[[ref:1]]";
  const longPrompt = `${"x".repeat(23_990 - marker.length)}${marker}`;
  assert.equal(longPrompt.length, 23_990);
  assert.throws(() => buildOwnerKling4WireCandidate(candidate({ prompt: longPrompt, reference_handles: [HANDLE_1] }), [
    reference(HANDLE_1, "image", longUrl, HASH_1)
  ]), /INVALID_REFERENCE_WIRE/u);
});

test("signed owned upload URLs are preserved byte-for-byte in private output", () => {
  const signedUrl = "https://r2.syntx.ai/k4/private%2Fimage?X-Amz-Signature=a%2Fb&X-Amz-Date=20261017T000000Z";
  const wire = buildOwnerKling4WireCandidate(candidate({ reference_handles: [HANDLE_1] }), [
    reference(HANDLE_1, "image", signedUrl, HASH_1)
  ]);
  assert.equal(wire.settings.file_urls[0]?.url, signedUrl);
  assert.equal(wire.prompt, `A quiet frame <<<${signedUrl}>>>.`);
});

function candidate(overrides: Partial<{
  attemptId: string;
  model_id: "kling_4_keyframes" | "kling_4_omni";
  prompt: string;
  version: "4.0";
  mode: "standart" | "hd";
  aspect_ratio: "16:9" | "1:1" | "9:16" | "21:9";
  video_duration: number;
  native_audio: boolean;
  reference_handles: readonly string[];
}> = {}) {
  return {
    attemptId: ATTEMPT,
    model_id: "kling_4_keyframes" as const,
    prompt: "A quiet frame [[ref:1]].",
    version: "4.0" as const,
    mode: "standart" as const,
    aspect_ratio: "16:9" as const,
    video_duration: 3,
    native_audio: true,
    reference_handles: [HANDLE_1],
    ...overrides
  };
}

function reference(
  reference_handle: string,
  kind: "image" | "video",
  url: string,
  sha256: string,
  duration_seconds: number | null = null
) {
  return { reference_handle, kind, url, sha256, duration_seconds } as const;
}

function makeHandles(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `kling4_reference_${String(index + 10).padStart(8, "0")}-1111-4111-8111-111111111111`);
}

function hash(value: number): string {
  return value.toString(16).repeat(64).slice(0, 64);
}
