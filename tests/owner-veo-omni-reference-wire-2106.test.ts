import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256 } from "../src/application/owner-veo-omni-reference-profile.js";
import { buildOwnerVeoOmniReferenceWire } from "../src/application/owner-veo-omni-reference-wire.js";

const ATTEMPT = "link_veo_omni_references_2106_000001";
const HANDLES = Object.freeze([
  "veo_omni_reference_11111111-1111-4111-8111-111111111111",
  "veo_omni_reference_22222222-2222-4222-8222-222222222222",
  "veo_omni_reference_33333333-3333-4333-8333-333333333333",
  "veo_omni_reference_44444444-4444-4444-8444-444444444444",
  "veo_omni_reference_55555555-5555-4555-8555-555555555555",
  "veo_omni_reference_66666666-6666-4666-8666-666666666666",
  "veo_omni_reference_77777777-7777-4777-8777-777777777777"
]);
const IMAGE_URL_1 = "https://r2.syntx.ai/veo-omni/image-one";
const IMAGE_URL_2 = "https://r2.syntx.ai/veo-omni/image-two";
const VIDEO_URL = "https://r2.syntx.ai/veo-omni/video-one";
const BASE = Object.freeze({
  attemptId: ATTEMPT,
  prompt: "A quiet scene with [[ref:1]] in the foreground.",
  input_type: "image",
  upscale: 3,
  aspect_ratio: "16:9",
  video_duration: 6,
  reference_handles: [HANDLES[0]!, HANDLES[1]!]
});

test("Omni image mode emits explicit source settings and one ordered typed owned reference", () => {
  const wire = buildOwnerVeoOmniReferenceWire(BASE, [
    reference(HANDLES[0]!, "image", IMAGE_URL_1),
    reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ]);
  assert.deepEqual(wire, {
    status: "SOURCE_BOUND_REFERENCE_WIRE_CANDIDATE",
    profile_sha256: OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256,
    ai_name: "veo3",
    prompt: `A quiet scene with <<<${IMAGE_URL_1}>>> in the foreground.`,
    settings: {
      model_type: "veo_omni", type: "image", upscale: 3, aspect_ratio: "16:9", video_duration: 6,
      file_urls: [{ type: "image", url: IMAGE_URL_1 }, { type: "image", url: IMAGE_URL_2 }]
    },
    cost_parameters: { upscale: 3, video_duration: 6 },
    input_reference_count: 2,
    wire_reference_count: 2,
    wire_fingerprint: fingerprint({
      ai_name: "veo3",
      prompt: `A quiet scene with <<<${IMAGE_URL_1}>>> in the foreground.`,
      settings: {
        model_type: "veo_omni", type: "image", upscale: 3, aspect_ratio: "16:9", video_duration: 6,
        file_urls: [{ type: "image", url: IMAGE_URL_1 }, { type: "image", url: IMAGE_URL_2 }]
      },
      cost_parameters: { upscale: 3, video_duration: 6 }
    }),
    generation_permit: false
  });
  assert.equal(Object.isFrozen(wire), true);
  assert.equal(Object.isFrozen(wire.settings), true);
  assert.equal(Object.isFrozen(wire.settings.file_urls), true);
  assert.equal(Object.isFrozen(wire.settings.file_urls[0]), true);
  assert.equal(Object.hasOwn(wire.settings, "mode"), false);
});

test("Omni image and references modes enforce typed counts before first-wins URL dedupe", () => {
  const twoImageWire = buildOwnerVeoOmniReferenceWire({
    ...BASE, input_type: "image", reference_handles: [HANDLES[0]!, HANDLES[1]!]
  }, [reference(HANDLES[0]!, "image", IMAGE_URL_1), reference(HANDLES[1]!, "image", IMAGE_URL_2)]);
  assert.equal(twoImageWire.settings.file_urls.length, 2);
  assert.equal(twoImageWire.input_reference_count, 2);
  assert.equal(twoImageWire.wire_reference_count, 2);

  const sevenImageInput = input("references", HANDLES, "Scene [[ref:7]].");
  const sevenImageWire = buildOwnerVeoOmniReferenceWire(sevenImageInput,
    HANDLES.map((handle, index) => reference(handle, "image", `https://r2.syntx.ai/veo-omni/image-${index + 1}`)));
  assert.equal(sevenImageWire.settings.file_urls.length, 7);
  assert.equal(sevenImageWire.settings.file_urls[6]?.url, "https://r2.syntx.ai/veo-omni/image-7");
  assert.equal(sevenImageWire.prompt, "Scene <<<https://r2.syntx.ai/veo-omni/image-7>>>.");

  const sixReferenceInput = input("references", HANDLES.slice(0, 6), "Image [[ref:1]], video [[ref:6]].");
  const sixReferenceWire = buildOwnerVeoOmniReferenceWire(sixReferenceInput, [
    reference(HANDLES[0]!, "image", IMAGE_URL_1),
    reference(HANDLES[1]!, "image", IMAGE_URL_2),
    reference(HANDLES[2]!, "image", IMAGE_URL_2),
    reference(HANDLES[3]!, "image", "https://r2.syntx.ai/veo-omni/image-four"),
    reference(HANDLES[4]!, "image", "https://r2.syntx.ai/veo-omni/image-five"),
    reference(HANDLES[5]!, "video", VIDEO_URL)
  ]);
  assert.deepEqual(sixReferenceWire.settings.file_urls, [
    { type: "image", url: IMAGE_URL_1 },
    { type: "image", url: IMAGE_URL_2 },
    { type: "image", url: "https://r2.syntx.ai/veo-omni/image-four" },
    { type: "image", url: "https://r2.syntx.ai/veo-omni/image-five" },
    { type: "video", url: VIDEO_URL }
  ]);
  assert.equal(sixReferenceWire.input_reference_count, 6);
  assert.equal(sixReferenceWire.wire_reference_count, 5);
  assert.equal(sixReferenceWire.prompt, `Image <<<${IMAGE_URL_1}>>>, video <<<${VIDEO_URL}>>>.`);
  assert.deepEqual(sixReferenceWire.cost_parameters, { upscale: 3, video_duration: 6, mode: "video_ref" });
  assert.equal(Object.hasOwn(sixReferenceWire.settings, "mode"), false);

  const videoOnly = buildOwnerVeoOmniReferenceWire(input("references", [HANDLES[0]!], "A video scene [[ref:1]]."), [
    reference(HANDLES[0]!, "video", VIDEO_URL)
  ]);
  assert.equal(videoOnly.settings.file_urls[0]?.type, "video");
  assert.deepEqual(videoOnly.cost_parameters, { upscale: 3, video_duration: 6, mode: "video_ref" });
});

test("Omni references encoder rejects media counts and kind combinations outside source modes", () => {
  const cases = [
    { input: input("references", HANDLES.slice(0, 7)), refs: HANDLES.slice(0, 7).map((h, i) =>
      reference(h, i < 6 ? "image" : "video", i < 6 ? `https://r2.syntx.ai/m/${Math.min(i, 4)}` : VIDEO_URL)) },
    { input: input("references", HANDLES.slice(0, 2)), refs: [reference(HANDLES[0]!, "video", VIDEO_URL), reference(HANDLES[1]!, "video", "https://r2.syntx.ai/video-2")] },
    { input: input("image", HANDLES.slice(0, 2)), refs: [reference(HANDLES[0]!, "image", IMAGE_URL_1), reference(HANDLES[1]!, "video", VIDEO_URL)] }
  ];
  for (const { input: raw, refs } of cases) {
    assert.throws(() => buildOwnerVeoOmniReferenceWire(raw, refs), /INVALID_REFERENCE_WIRE/u);
  }
  assert.throws(() => buildOwnerVeoOmniReferenceWire(
    input("image", HANDLES.slice(0, 3)), HANDLES.slice(0, 3).map((h, i) => reference(h, "image", `https://r2.syntx.ai/i/${i}`))
  ), /INVALID_REQUEST/u);
  assert.throws(() => buildOwnerVeoOmniReferenceWire(
    input("references", HANDLES.slice(0, 7)), [...HANDLES.slice(0, 7).map((h, i) => reference(h, "image", `https://r2.syntx.ai/i/${i}`)),
      reference(HANDLES[0]!, "image", "https://r2.syntx.ai/i/0")]
  ), /INVALID_REFERENCE_WIRE/u);
  assert.throws(() => buildOwnerVeoOmniReferenceWire(input("references", []), []), /INVALID_REQUEST/u);
});

test("Omni references encoder binds each store record to the matching input handle and rejects caller URLs", () => {
  assert.throws(() => buildOwnerVeoOmniReferenceWire({ ...BASE, url: IMAGE_URL_1 }, [
    reference(HANDLES[0]!, "image", IMAGE_URL_1), reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ]), /INVALID_REQUEST/u);
  assert.throws(() => buildOwnerVeoOmniReferenceWire(BASE, [
    reference(HANDLES[1]!, "image", IMAGE_URL_1), reference(HANDLES[0]!, "image", IMAGE_URL_2)
  ]), /INVALID_REFERENCE_WIRE/u);
  assert.throws(() => buildOwnerVeoOmniReferenceWire(BASE, [
    { ...reference(HANDLES[0]!, "image", IMAGE_URL_1), extra: "file_id" }, reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ]), /INVALID_REFERENCE_WIRE/u);
  assert.throws(() => buildOwnerVeoOmniReferenceWire(BASE, [
    new Proxy(reference(HANDLES[0]!, "image", IMAGE_URL_1), {}), reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ]), /INVALID_REFERENCE_WIRE/u);

  let getterCalls = 0;
  const accessorReference = Object.defineProperty({ ...reference(HANDLES[0]!, "image", IMAGE_URL_1) }, "url", {
    enumerable: true,
    get() { getterCalls += 1; return IMAGE_URL_1; }
  });
  assert.throws(() => buildOwnerVeoOmniReferenceWire(BASE, [accessorReference, reference(HANDLES[1]!, "image", IMAGE_URL_2)]), /INVALID_REFERENCE_WIRE/u);
  assert.equal(getterCalls, 0);
  assert.throws(() => buildOwnerVeoOmniReferenceWire(BASE, new Proxy([
    reference(HANDLES[0]!, "image", IMAGE_URL_1), reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ], {})), /INVALID_REFERENCE_WIRE/u);
});

test("Omni references encoder rejects unsafe, raw-whitespace, control, malformed-Unicode, and angle URLs", () => {
  for (const url of [
    "http://r2.syntx.ai/file", "https://attacker.example/file", "https://user@r2.syntx.ai/file",
    "https://r2.syntx.ai/file#fragment", "https://r2.syntx.ai/path with-space", "https://r2.syntx.ai/with\nline",
    "https://r2.syntx.ai/\u0000file", "https://r2.syntx.ai/<<<marker>>>", `https://r2.syntx.ai/bad\ud800`
  ]) {
    assert.throws(() => buildOwnerVeoOmniReferenceWire(BASE, [
      reference(HANDLES[0]!, "image", url), reference(HANDLES[1]!, "image", IMAGE_URL_2)
    ]), /INVALID_REFERENCE_WIRE/u);
  }
});

test("Omni references encoder preserves signed owned URLs byte-for-byte", () => {
  const signedUrl = "https://r2.syntx.ai/private/key%2Fpart?X-Amz-Signature=a%2Fb&X-Amz-Date=20261017T000000Z";
  const wire = buildOwnerVeoOmniReferenceWire(BASE, [
    reference(HANDLES[0]!, "image", signedUrl), reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ]);
  assert.equal(wire.settings.file_urls[0]?.url, signedUrl);
  assert.equal(wire.prompt, `A quiet scene with <<<${signedUrl}>>> in the foreground.`);
});

test("Omni references encoder renders only numbered mentions and rechecks the expanded prompt bound", () => {
  const raw = input("references", [HANDLES[0]!, HANDLES[1]!], "Café 🙂 uses [[ref:2]], not [[ref:1]].");
  const wire = buildOwnerVeoOmniReferenceWire(raw, [
    reference(HANDLES[0]!, "image", IMAGE_URL_1), reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ]);
  assert.equal(wire.prompt, `Café 🙂 uses <<<${IMAGE_URL_2}>>>, not <<<${IMAGE_URL_1}>>>.`);

  const rawAtLimit = input("image", [HANDLES[0]!], `${"a".repeat(49_990)} [[ref:1]]`);
  assert.equal(rawAtLimit.prompt.length, 50_000);
  assert.throws(() => buildOwnerVeoOmniReferenceWire(rawAtLimit, [
    reference(HANDLES[0]!, "image", IMAGE_URL_1)
  ]), /INVALID_REFERENCE_WIRE/u);
});

test("Omni references wire fingerprint uses the explicit versioned layout and changes with settings", () => {
  const wire = buildOwnerVeoOmniReferenceWire(BASE, [
    reference(HANDLES[0]!, "image", IMAGE_URL_1), reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ]);
  const expectedLayout = [
    "owner-veo-omni-reference-wire-v1",
    OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256,
    {
      ai_name: "veo3",
      prompt: `A quiet scene with <<<${IMAGE_URL_1}>>> in the foreground.`,
      settings: {
        model_type: "veo_omni", type: "image", upscale: 3, aspect_ratio: "16:9", video_duration: 6,
        file_urls: [{ type: "image", url: IMAGE_URL_1 }, { type: "image", url: IMAGE_URL_2 }]
      }
    },
    { upscale: 3, video_duration: 6 }
  ];
  assert.equal(wire.wire_fingerprint,
    `sha256:${createHash("sha256").update(JSON.stringify(expectedLayout), "utf8").digest("hex")}`);
  const changed = buildOwnerVeoOmniReferenceWire({ ...BASE, video_duration: 8 }, [
    reference(HANDLES[0]!, "image", IMAGE_URL_1), reference(HANDLES[1]!, "image", IMAGE_URL_2)
  ]);
  assert.notEqual(changed.wire_fingerprint, wire.wire_fingerprint);
  assert.equal(changed.generation_permit, false);
  assert.equal(changed.input_reference_count, 2);
  assert.equal(changed.wire_reference_count, 2);
});

test("Omni private rendering preserves profile-accepted multiline prompt whitespace", () => {
  const rawPrompt = "A quiet scene\nwith [[ref:1]]\r\nand\ta soft sky.";
  const wire = buildOwnerVeoOmniReferenceWire(input("image", [HANDLES[0]!], rawPrompt), [
    reference(HANDLES[0]!, "image", IMAGE_URL_1)
  ]);
  assert.equal(wire.prompt, `A quiet scene\nwith <<<${IMAGE_URL_1}>>>\r\nand\ta soft sky.`);
  for (const control of ["\u0000", "\u000b", "\u007f"]) {
    assert.throws(() => buildOwnerVeoOmniReferenceWire(input("image", [HANDLES[0]!], `Scene ${control} with reference.`), [
      reference(HANDLES[0]!, "image", IMAGE_URL_1)
    ]), /INVALID_REQUEST/u);
  }
});

function input(input_type: "image" | "references", reference_handles: readonly string[], prompt?: string) {
  const raw = {
    ...BASE,
    input_type,
    reference_handles: [...reference_handles],
    ...(prompt === undefined ? {} : { prompt })
  };
  return raw;
}

function reference(reference_handle: string, kind: "image" | "video", url: string) {
  return { reference_handle, kind, url } as const;
}

function fingerprint(payload: {
  ai_name: "veo3";
  prompt: string;
  settings: {
    model_type: "veo_omni";
    type: "image" | "references";
    upscale: number;
    aspect_ratio: "16:9" | "9:16";
    video_duration: number;
    file_urls: readonly { type: "image" | "video"; url: string }[];
  };
  cost_parameters: { upscale: number; video_duration: number; mode?: "video_ref" };
}): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([
    "owner-veo-omni-reference-wire-v1",
    OWNER_VEO_OMNI_REFERENCE_PROFILE_SHA256,
    { ai_name: payload.ai_name, prompt: payload.prompt, settings: payload.settings },
    payload.cost_parameters
  ]), "utf8").digest("hex")}`;
}
