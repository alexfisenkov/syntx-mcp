import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getStandardImageReferencePreparationPolicy, prepareStandardImageReference, StandardImageReferencePreparationError, STANDARD_IMAGE_REFERENCE_PREPARATION_POLICY } from "../src/application/standard-image-reference-preparation.js";
import { inspectBoundedOwnerImageBytesWithMax } from "../src/application/owner-image-reference-input-validator.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";

const FFMPEG = process.env.SYNTX_MEDIA_FFMPEG_PATH ?? "/opt/homebrew/Cellar/ffmpeg/8.1/bin/ffmpeg";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

test("preserves valid in-limit input byte-for-byte and returns an owned buffer", async () => {
  const source = Buffer.from(PNG);
  const result = await prepareStandardImageReference({ bytes: source, filename: "original.png", mime_type: "image/png", variant: "banana-2.1" });
  assert.deepEqual(Buffer.from(result.bytes), source);
  assert.notEqual(result.bytes, source);
  assert.equal(result.filename, "original.png");
  assert.equal(result.preparation.applied, false);
  assert.equal(result.preparation.original_bytes, source.byteLength);
});

test("rejects unrecognized binary data without invoking an encoder", async () => {
  await assert.rejects(prepareStandardImageReference({ bytes: Buffer.alloc(8 * 1024 * 1024, 7), filename: "bad.jpg", mime_type: "image/jpeg", variant: "banana-2.1" }, { ffmpegPath: FFMPEG }),
    (error: unknown) => error instanceof StandardImageReferencePreparationError && error.code === "INVALID_IMAGE_INPUT");
});

test("oversize image requires an absolute configured FFmpeg path", async () => {
  const image = oversizedJpeg();
  const configured = process.env.SYNTX_MEDIA_FFMPEG_PATH;
  delete process.env.SYNTX_MEDIA_FFMPEG_PATH;
  try {
    await assert.rejects(prepareStandardImageReference({ bytes: image, filename: "large.jpg", mime_type: "image/jpeg", variant: "banana-2.1" }),
      (error: unknown) => error instanceof StandardImageReferencePreparationError && error.code === "IMAGE_PREPARATION_UNAVAILABLE");
  } finally {
    if (configured === undefined) delete process.env.SYNTX_MEDIA_FFMPEG_PATH;
    else process.env.SYNTX_MEDIA_FFMPEG_PATH = configured;
  }
});

test("oversize HEIC reports the formats supported by local preparation", async () => {
  await assert.rejects(prepareStandardImageReference({ bytes: oversizedJpeg(), filename: "large.heic", mime_type: "image/heic", variant: "banana-2.1" }, { ffmpegPath: FFMPEG }),
    (error: unknown) => error instanceof StandardImageReferencePreparationError && error.code === "UNSUPPORTED_IMAGE_FORMAT" && /JPEG, PNG, or WebP/u.test(error.message));
});

test("pinned Banana 2.1 preparation thresholds match the archived public catalog metadata", () => {
  const catalog = loadPublicCatalogVersion(STANDARD_IMAGE_REFERENCE_PREPARATION_POLICY.source_catalog_version);
  const banana = catalog.models.find((model) => model.value === "banana-2.1");
  assert.ok(banana);
  assert.ok(banana.settings);
  assert.equal(banana.settings.max_image_file_size, STANDARD_IMAGE_REFERENCE_PREPARATION_POLICY.banana_21_source_limit_bytes);
  assert.equal(banana.settings.image_resize_limit, STANDARD_IMAGE_REFERENCE_PREPARATION_POLICY.banana_21_target_bytes);
});

test("preparation policies match the exact archived source limits for all ten standard variants", () => {
  const variants = ["banana-2.1", "banana3", "banana3_light", "banana2", "banana", "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const;
  const catalog = loadPublicCatalogVersion(STANDARD_IMAGE_REFERENCE_PREPARATION_POLICY.source_catalog_version);
  for (const variant of variants) {
    const policy = getStandardImageReferencePreparationPolicy(variant);
    const row = catalog.models.find((model) => model.value === variant);
    assert.ok(row?.settings);
    const fileLimit = typeof row.settings.max_file_size === "number" ? row.settings.max_file_size : row.settings.max_file_size?.images;
    assert.equal(policy.source_limit_bytes, fileLimit);
    const desiredTarget = [fileLimit, row.settings.max_image_file_size, row.settings.image_resize_limit, policy.legacy_validator_limit_bytes]
      .filter((value): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0);
    assert.equal(policy.prepared_target_bytes, Math.min(...desiredTarget));
    assert.equal(policy.max_width, row.settings.max_image_width);
    assert.equal(policy.max_height, row.settings.max_image_height);
    assert.equal(policy.provider_acceptance, "NOT_PROVEN");
  }
});

test("compresses high-entropy JPEG to the variant cap, keeps input unchanged, and emits decodable JPEG", { skip: !binaryExists(FFMPEG) }, async () => {
  const pixels = Buffer.alloc(2048 * 2048 * 3);
  let seed = 0x12345678;
  for (let index = 0; index < pixels.length; index += 1) { seed = (seed * 1664525 + 1013904223) >>> 0; pixels[index] = seed >>> 24; }
  const source = execFileSync(FFMPEG, ["-nostdin", "-hide_banner", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "2048x2048", "-i", "pipe:0", "-frames:v", "1", "-q:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"], { input: pixels, maxBuffer: 20 * 1024 * 1024 });
  assert.ok(source.byteLength > 7 * 1024 * 1024);
  const original = Buffer.from(source);
  const result = await prepareStandardImageReference({ bytes: source, filename: "texture.final.jpeg", mime_type: "image/jpeg", variant: "banana-2.1" }, { ffmpegPath: FFMPEG });
  assert.equal(result.preparation.applied, true);
  assert.ok(result.bytes.byteLength < 5 * 1024 * 1024);
  assert.equal(result.filename, "texture.final.jpg");
  assert.equal(result.mime_type, "image/jpeg");
  assert.deepEqual(source, original);
  const metadata = inspectBoundedOwnerImageBytesWithMax(result.bytes, 7 * 1024 * 1024);
  assert.equal(metadata.mime, "image/jpeg");
  assert.equal(metadata.width, result.preparation.prepared_width);
  assert.equal(metadata.height, result.preparation.prepared_height);
  const decoded = execFileSync(FFMPEG, ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-frames:v", "1", "-f", "null", "-"], { input: result.bytes, maxBuffer: 1_000_000 });
  assert.equal(decoded.byteLength, 0);
  const alias = await prepareStandardImageReference({ bytes: source, filename: "alias.jpg", mime_type: "image/jpg", variant: "banana-2.1" }, { ffmpegPath: FFMPEG });
  assert.equal(alias.mime_type, "image/jpeg");
  assert.equal(alias.preparation.original_mime_type, "image/jpeg");
});

test("abort kills and drains an active encoder before returning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-image-abort-test-"));
  try {
    const pidFile = join(directory, "pid");
    const fake = join(directory, "fake-ffmpeg");
    await writeFile(fake, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    await chmod(fake, 0o700);
    const controller = new AbortController();
    const running = prepareStandardImageReference({ bytes: oversizedJpeg(), filename: "large.jpg", mime_type: "image/jpeg", variant: "banana-2.1" }, { ffmpegPath: fake }, controller.signal);
    const waitForPid = async () => {
      for (let tries = 0; tries < 50; tries += 1) {
        try { return Number(await readFile(pidFile, "utf8")); } catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
      }
      throw new Error("fake encoder did not start");
    };
    const pid = await waitForPid();
    controller.abort();
    await assert.rejects(running, (error: unknown) => error instanceof StandardImageReferencePreparationError && error.code === "IMAGE_PREPARATION_ABORTED");
    assert.throws(() => process.kill(pid, 0));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("caps normalization to eight fixed encode attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-image-attempt-test-"));
  try {
    const countFile = join(directory, "count");
    const fake = join(directory, "fake-ffmpeg");
    await writeFile(countFile, "0");
    await writeFile(fake, `#!/usr/bin/env node\nconst fs=require('node:fs');const p=${JSON.stringify(countFile)};fs.writeFileSync(p,String(Number(fs.readFileSync(p,'utf8'))+1));\n`, { mode: 0o700 });
    await chmod(fake, 0o700);
    await assert.rejects(prepareStandardImageReference({ bytes: oversizedJpeg(), filename: "large.jpg", mime_type: "image/jpeg", variant: "banana-2.1" }, { ffmpegPath: fake }),
      (error: unknown) => error instanceof StandardImageReferencePreparationError && error.code === "IMAGE_PREPARATION_FAILED");
    assert.equal(await readFile(countFile, "utf8"), "8");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("abort is reported as a stable safe error", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareStandardImageReference({ bytes: PNG, filename: "x.png", mime_type: "image/png", variant: "banana-2.1" }, {}, controller.signal),
    (error: unknown) => error instanceof StandardImageReferencePreparationError && error.code === "IMAGE_PREPARATION_ABORTED");
});

function oversizedJpeg(): Buffer {
  const size = 7 * 1024 * 1024 + 128;
  const segmentSize = 65_533;
  const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = size - 28;
  while (remaining > 0) {
    const payloadLength = Math.min(segmentSize, remaining - 4);
    const segment = Buffer.alloc(payloadLength + 4, 0x22);
    segment[0] = 0xff; segment[1] = 0xe0; segment.writeUInt16BE(payloadLength + 2, 2);
    chunks.push(segment); remaining -= segment.byteLength;
  }
  chunks.push(Buffer.from([0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]));
  return Buffer.concat(chunks);
}
function binaryExists(path: string): boolean { try { execFileSync(path, ["-version"], { stdio: "ignore" }); return true; } catch { return false; } }
