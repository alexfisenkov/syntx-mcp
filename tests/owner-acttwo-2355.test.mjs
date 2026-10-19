import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const moduleRoot = process.env.SYNTX_ACTTWO_TEST_MODULE_ROOT
  ? pathToFileURL(`${resolve(process.env.SYNTX_ACTTWO_TEST_MODULE_ROOT)}${sep}`)
  : new URL("../dist/src/application/", import.meta.url);
const importApplication = name => import(new URL(name, moduleRoot));
const catalogDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..", "catalog");
const stdioConfig = await import(new URL("../runtime/owner-acttwo-stdio-config.js", moduleRoot));
const parameters = await importApplication("owner-acttwo-parameters.js");
const imagePolicy = await importApplication("owner-acttwo-image-policy.js");
const videoPolicy = await importApplication("owner-acttwo-video-policy.js");
const cost = await importApplication("owner-acttwo-cost.js");
const wireModule = await importApplication("owner-acttwo-wire.js");
const FFMPEG = process.env.SYNTX_ACTTWO_TEST_FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.SYNTX_ACTTWO_TEST_FFPROBE ?? "/opt/homebrew/bin/ffprobe";

function crc32(bytes) {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png640() {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(640, 16); bytes.writeUInt32BE(640, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

test("ActTwo accepts only the measured five-second source-bound parameter slice", () => {
  const input = Object.freeze({ model_id: "acttwo", aspect_ratio: "1:1", video_duration: 5, seed: null, expression: 3 });
  const normalized = parameters.normalizeOwnerActTwoParameters(input);
  assert.deepEqual(normalized.source_parameters, {
    model_type: "acttwo", aspect_ratio: "11", video_duration: 5, seed: null, expression: 3
  });
  assert.equal(Object.hasOwn(normalized.source_parameters, "prompt"), false);
  assert.equal(Object.hasOwn(normalized.source_parameters, "gestures"), false);
});

test("ActTwo rejects prompt, gestures, alternate duration/aspect/seed, and extra fields", () => {
  const valid = { model_id: "acttwo", aspect_ratio: "1:1", video_duration: 5, seed: null, expression: 3 };
  for (const input of [
    { ...valid, prompt: "invented prompt" },
    { ...valid, gestures: false },
    { ...valid, aspect_ratio: "16:9" },
    { ...valid, video_duration: 6 },
    { ...valid, seed: 123 },
    { ...valid, expression: 4 },
    { ...valid, extra: true }
  ]) assert.throws(() => parameters.normalizeOwnerActTwoParameters(input));
});

test("ActTwo character image policy validates JPEG/PNG and keeps upload bytes private", () => {
  const bytes = png640();
  const receipt = imagePolicy.validateOwnerActTwoCharacterImage({ model_id: "acttwo", filename: "character.png", mime_type: "image/png", bytes });
  assert.equal(receipt.model_id, "acttwo");
  assert.equal(receipt.mime_type, "image/png");
  assert.equal(receipt.generation_permit, false);
  const owned = imagePolicy.readValidatedOwnerActTwoCharacterImage(receipt);
  assert.ok(owned);
  assert.deepEqual(Buffer.from(owned.bytes), bytes);
  owned.bytes.fill(0);
  assert.equal(imagePolicy.releaseValidatedOwnerActTwoCharacterImage(receipt), true);
  assert.equal(imagePolicy.readValidatedOwnerActTwoCharacterImage(receipt), null);
  assert.throws(() => imagePolicy.validateOwnerActTwoCharacterImage({ model_id: "acttwo", filename: "character.webp", mime_type: "image/webp", bytes }));
});

test("ActTwo measures one local 5-second 24-fps MP4 and rejects a different measured duration", async t => {
  if (!existsSync(FFMPEG) || !existsSync(FFPROBE)) { t.skip("local ffmpeg/ffprobe pair unavailable for synthetic ActTwo video fixture"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-acttwo-2355-"));
  const fiveSecondPath = join(directory, "performance.mp4"), fourSecondPath = join(directory, "wrong-duration.mp4");
  try {
    for (const [path, duration] of [[fiveSecondPath, "5"], [fourSecondPath, "4"]]) {
      execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=teal:s=640x480:r=24:d=${duration}`,
        "-vf", "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709", "-an", "-pix_fmt", "yuv420p", "-c:v", "libx264",
        "-movflags", "+faststart", "-y", path]);
    }
    const validator = videoPolicy.createOwnerActTwoPerformanceVideoValidator(FFPROBE);
    const fiveSeconds = await validator.validate({ model_id: "acttwo", filename: "performance.mp4", mime_type: "video/mp4", bytes: await readFile(fiveSecondPath) });
    assert.equal(fiveSeconds.measured_duration_seconds, 5);
    assert.equal(fiveSeconds.mime_type, "video/mp4");
    assert.equal(fiveSeconds.generation_permit, false);
    assert.equal(videoPolicy.releaseValidatedOwnerActTwoPerformanceVideo(fiveSeconds), true);
    await assert.rejects(async () => validator.validate({ model_id: "acttwo", filename: "wrong-duration.mp4", mime_type: "video/mp4", bytes: await readFile(fourSecondPath) }),
      error => error?.code === "DURATION_MISMATCH");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ActTwo quote uses only numeric measured video_duration and pins the public model row", () => {
  assert.deepEqual(cost.buildOwnerActTwoCostParameters({ model_id: "acttwo", video_duration: 5 }), { video_duration: 5 });
  assert.throws(() => cost.buildOwnerActTwoCostParameters({ model_id: "acttwo", video_duration: 6 }));
  assert.throws(() => cost.buildOwnerActTwoCostParameters({ model_id: "acttwo", video_duration: "5" }));
  assert.throws(() => cost.buildOwnerActTwoCostParameters({ model_id: "acttwo", video_duration: 5, prompt: "" }));
  const catalog = cost.loadOwnerActTwoRuntimeCatalog(catalogDirectory);
  assert.deepEqual(catalog.cost_bindings, [{ model_id: "acttwo", ai_name: "runway", scope: "video", cost_keys: ["video_duration"] }]);
});

test("ActTwo wire keeps performance video before character image and marks the empty prompt candidate", () => {
  const input = { model_id: "acttwo", aspect_ratio: "1:1", video_duration: 5, seed: null, expression: 3 };
  const captured = {
    character_image: { url: "https://r2.syntx.ai/acttwo2355/character.png", sha256: "a".repeat(64), size: 3523,
      width: 640, height: 640, mime_type: "image/png" },
    performance_video: { url: "https://r2.syntx.ai/acttwo2355/performance.mp4", sha256: "b".repeat(64), size: 4096,
      width: 640, height: 480, mime_type: "video/mp4", measured_duration_seconds: 5 }
  };
  const candidate = wireModule.buildOwnerActTwoWire(input, captured);
  assert.equal(candidate.wire.ai_name, "runway");
  assert.equal(candidate.wire.prompt, "");
  assert.deepEqual(candidate.wire.settings, { model_type: "acttwo", aspect_ratio: "11", video_duration: 5, seed: null, expression: 3,
    file_urls: [{ type: "video", url: captured.performance_video.url }, { type: "image", url: captured.character_image.url }] });
  assert.equal(candidate.prompt_evidence, "EMPTY_STRING_CANDIDATE_UNTIL_LIVE_ACCEPTANCE");
  assert.equal(candidate.dispatch_allowed, false);
  assert.throws(() => wireModule.buildOwnerActTwoWire(input, { ...captured, extra: true }));
});

test("ActTwo opt-in is default-off and enabled mode requires trusted destination and ffprobe configuration", () => {
  for (const value of [undefined, "", "0"]) assert.equal(stdioConfig.readOwnerActTwoFlag(value), false);
  assert.equal(stdioConfig.readOwnerActTwoFlag("1"), true);
  assert.throws(() => stdioConfig.readOwnerActTwoFlag("true"));
  assert.equal(stdioConfig.readOwnerActTwoOperatorConfiguration(false, undefined, undefined), undefined);
  assert.equal(stdioConfig.readOwnerActTwoOperatorConfiguration(false, "invalid", "relative/ffprobe"), undefined);
  assert.throws(() => stdioConfig.readOwnerActTwoOperatorConfiguration(true, "uploaded", undefined));
  assert.throws(() => stdioConfig.readOwnerActTwoOperatorConfiguration(true, "other", "/usr/bin/ffprobe"));
  assert.deepEqual(stdioConfig.readOwnerActTwoOperatorConfiguration(true, "hidden", "/usr/bin/ffprobe"),
    { uploadDestination: "hidden", ffprobePath: "/usr/bin/ffprobe" });
});
