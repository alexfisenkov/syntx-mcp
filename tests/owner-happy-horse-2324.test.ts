import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOwnerHappyHorseParameters } from "../src/application/owner-happy-horse-parameters.js";
import { buildOwnerHappyHorseEditWire, buildOwnerHappyHorseWire } from "../src/application/owner-happy-horse-wire.js";
import { readOwnerHappyHorseFlag, readOwnerHappyHorseOperatorConfiguration } from "../src/runtime/owner-happy-horse-stdio-config.js";

function tuple(model_id: "happy_horse_first_frame" | "happy_horse_references" | "happy_horse_edit") {
  return { model_id, prompt: "A small red boat crosses a calm lake at sunrise.", aspect_ratio: "16:9" as const,
    resolution: "720P" as const, video_duration: 5 as const, seed: null };
}

test("HappyHorse narrow candidate accepts only explicit initial controls and both model IDs", () => {
  for (const model_id of ["happy_horse_first_frame", "happy_horse_references", "happy_horse_edit"] as const) {
    const result = normalizeOwnerHappyHorseParameters(tuple(model_id));
    assert.equal(result.status, "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY");
    assert.equal(result.intent.model_id, model_id);
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.initializer_confidence, "FORM_INITIALIZER_ONLY_NOT_EFFECTIVE_DEFAULT_OR_VALID_COMBINATION");
  }
});

test("HappyHorse normalizer rejects injected values, unsupported settings and accessors", () => {
  assert.throws(() => normalizeOwnerHappyHorseParameters({ ...tuple("happy_horse_first_frame"), seed: 1 }));
  assert.throws(() => normalizeOwnerHappyHorseParameters({ ...tuple("happy_horse_first_frame"), resolution: "1080P" }));
  assert.throws(() => normalizeOwnerHappyHorseParameters({ ...tuple("happy_horse_first_frame"), extra: true }));
  const accessor = Object.defineProperty(tuple("happy_horse_first_frame"), "prompt", { enumerable: true, get: () => "no" });
  assert.throws(() => normalizeOwnerHappyHorseParameters(accessor));
  assert.throws(() => normalizeOwnerHappyHorseParameters({ ...tuple("happy_horse_first_frame"), prompt: "\ud800" }));
});

test("HappyHorse source role maps first_frame specially and references generically", () => {
  const image = { url: "https://r2.syntx.ai/private/file.png", sha256: "a".repeat(64), width: 640, height: 640 };
  const first = buildOwnerHappyHorseWire(tuple("happy_horse_first_frame"), image);
  const references = buildOwnerHappyHorseWire(tuple("happy_horse_references"), image);
  assert.deepEqual(first.wire.settings.file_urls, [{ type: "first_frame", url: image.url }]);
  assert.deepEqual(references.wire.settings.file_urls, [{ type: "image", url: image.url }]);
  assert.equal(first.wire.ai_name, "happy_horse");
  assert.equal(first.wire.settings.seed, null);
  assert.equal(first.dispatch_allowed, false);
});

test("HappyHorse edit sends one locally measured neutral video and no images", () => {
  const video = { url: "https://r2.syntx.ai/private/source.mov", sha256: "b".repeat(64), width: 1280, height: 720,
    mime_type: "video/quicktime" as const, measured_duration_seconds: 8.25 };
  const candidate = buildOwnerHappyHorseEditWire(tuple("happy_horse_edit"), video);
  assert.deepEqual(candidate.wire.settings.file_urls, [{ type: "video", url: video.url }]);
  assert.equal(candidate.wire.settings.seed, null);
  assert.equal(candidate.source_media.duration_seconds, 8.25);
  assert.equal(candidate.dispatch_allowed, false);
});

test("HappyHorse wire rejects unallowlisted URLs, bad geometry and model mismatch", () => {
  const good = tuple("happy_horse_first_frame");
  assert.throws(() => buildOwnerHappyHorseWire(good, { url: "https://example.invalid/file.png", sha256: "a".repeat(64), width: 640, height: 640 }));
  assert.throws(() => buildOwnerHappyHorseWire(good, { url: "https://r2.syntx.ai/file.png", sha256: "a".repeat(64), width: 399, height: 640 }));
  assert.throws(() => buildOwnerHappyHorseWire(good, { url: "https://r2.syntx.ai/file.png", sha256: "a".repeat(64), width: 640, height: 640, model_id: "happy_horse_references" }));
});

test("HappyHorse stdio config is independent/default-off and requires trusted config only when enabled", () => {
  assert.equal(readOwnerHappyHorseFlag(undefined), false);
  assert.equal(readOwnerHappyHorseFlag("0"), false);
  assert.equal(readOwnerHappyHorseFlag("1"), true);
  assert.equal(readOwnerHappyHorseOperatorConfiguration(false, undefined, undefined), undefined);
  assert.throws(() => readOwnerHappyHorseFlag("true"));
  assert.throws(() => readOwnerHappyHorseOperatorConfiguration(true, "uploaded", undefined));
  assert.throws(() => readOwnerHappyHorseOperatorConfiguration(true, "unknown", "/usr/bin/ffprobe"));
  assert.deepEqual(readOwnerHappyHorseOperatorConfiguration(true, "hidden", "/usr/bin/ffprobe"),
    { uploadDestination: "hidden", ffprobePath: "/usr/bin/ffprobe" });
});
