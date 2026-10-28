import test from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyTrustedOwnerTopazEnhanceOriginalBytes,
  createOwnerTopazEnhanceOriginalProbe,
  isTrustedOwnerTopazEnhanceOriginalProbeResult,
  OwnerTopazEnhanceOriginalProbeError,
  releaseTrustedOwnerTopazEnhanceOriginalProbeResult
} from "../src/application/owner-topaz-enhance-original-probe.js";

const SOURCE_CATALOG = "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json";
const BASE_PROBE = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", codec_tag_string: "avc1", width: 640, height: 360, nb_read_frames: "60", duration: "2.000000", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "aac", duration: "2.000000" }
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000" }
});

function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0);
  bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { model_id: "topaz_enhance", ai_name: "topaz_ai", source_catalog_version: SOURCE_CATALOG,
    filename: "source.mp4", mime_type: "video/mp4", bytes: mp4Bytes(), ...overrides };
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

async function fakeFfprobe(output: string, requireAttachedPictureEntry = false): Promise<{ directory: string; binary: string; marker: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-enhance-1974-fixture-"));
  const binary = join(directory, "ffprobe-fixture");
  const marker = join(directory, "input-at-invocation");
  const dispositionCheck = requireAttachedPictureEntry ? `show_entries=''\nexpect_value=0\nfor arg do\n  if [ "$expect_value" = 1 ]; then show_entries="$arg"; expect_value=0; continue; fi\n  [ "$arg" = "-show_entries" ] && expect_value=1\ndone\ncase ":$show_entries:" in *":stream_disposition=attached_pic:"*) ;; *) exit 33 ;; esac\n` : "";
  const script = `#!/bin/sh\n[ "$1" = "-v" ] && [ "$2" = "error" ] || exit 31\n${dispositionCheck}for last do :; done\n[ -f "$last" ] || exit 32\nprintf '%s' "$last" > ${shellQuote(marker)}\nprintf '%s' ${shellQuote(output)}\n`;
  await writeFile(binary, script, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary), marker };
}

function runner(binary: string) {
  return createOwnerTopazEnhanceOriginalProbe({ ffprobePath: binary });
}

test("returns sealed local MP4 metadata, allows audio, and retains only branded private bytes", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await fakeFfprobe(BASE_PROBE);
  try {
    const source = input();
    const originalBytes = new Uint8Array(source.bytes as Uint8Array);
    const result = await runner(fixture.binary).probe(source);
    assert.equal(isTrustedOwnerTopazEnhanceOriginalProbeResult(result), true);
    assert.equal(result.model_id, "topaz_enhance");
    assert.equal(result.ai_name, "topaz_ai");
    assert.equal(result.source_catalog_version, SOURCE_CATALOG);
    assert.match(result.source_sha256, /^[a-f0-9]{64}$/u);
    assert.equal(result.bytes_copied, 28);
    assert.deepEqual(result.public_input_limits, { max_file_size_bytes: 52_428_800, min_duration_seconds: 2,
      max_duration_seconds: 26.25, accepted_mime_types: ["video/mp4", "video/webm", "video/quicktime"] });
    assert.deepEqual(result.local_supported_mime_types, ["video/mp4"]);
    assert.deepEqual(result.metadata.video, { codec_name: "h264", width: 640, height: 360, duration_seconds: 2, frame_count: 60 });
    assert.deepEqual(result.metadata.audio_codec_names, ["aac"]);
    assert.equal(result.metadata.inspection, "LOCAL_FFPROBE_FRAME_COUNT_NOT_FULL_MEDIA_VALIDATION");
    assert.equal(result.local_input_limit_kind, "LOCAL_MP4_ONLY_LIMITATION_PUBLIC_ALSO_ACCEPTS_WEBM_QUICKTIME");
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.runtime_usable, false);
    assert.equal(result.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal(result.content_quality, "NOT_ASSESSED");
    assert.equal("bytes" in result, false);
    assert.equal("path" in result, false);
    assert.equal("public_url" in result, false);
    const privateCopy = copyTrustedOwnerTopazEnhanceOriginalBytes(result);
    assert.deepEqual(privateCopy, new Uint8Array(source.bytes as Uint8Array));
    assert.deepEqual(source.bytes, originalBytes);
    privateCopy.fill(0);
    assert.deepEqual(copyTrustedOwnerTopazEnhanceOriginalBytes(result), new Uint8Array(source.bytes as Uint8Array));
    assert.equal(isTrustedOwnerTopazEnhanceOriginalProbeResult(new Proxy(result, {})), false);
    const probedPath = await readFile(fixture.marker, "utf8");
    assert.equal(probedPath.endsWith("/source.mp4"), true);
    await assert.rejects(access(probedPath));
    releaseTrustedOwnerTopazEnhanceOriginalProbeResult(result);
    assert.equal(isTrustedOwnerTopazEnhanceOriginalProbeResult(result), false);
    assert.throws(() => copyTrustedOwnerTopazEnhanceOriginalBytes(result), OwnerTopazEnhanceOriginalProbeError);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("requests attached-picture disposition as a distinct ffprobe show_entries section", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await fakeFfprobe(BASE_PROBE, true);
  try {
    const result = await runner(fixture.binary).probe(input());
    assert.equal(result.metadata.video.frame_count, 60);
    releaseTrustedOwnerTopazEnhanceOriginalProbeResult(result);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("rejects a container duration whose rounded quote second exceeds the video-stream duration", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const mismatch = JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "h264", codec_tag_string: "avc1", width: 640, height: 360, nb_read_frames: "60", duration: "2.000000", disposition: { attached_pic: 0 } }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.000000" }
  });
  const fixture = await fakeFfprobe(mismatch);
  try {
    await assert.rejects(runner(fixture.binary).probe(input()), (error: unknown) =>
      error instanceof OwnerTopazEnhanceOriginalProbeError && error.code === "INVALID_ORIGINAL");
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }

  for (const [label, stream, format] of [
    ["stream-only", "2.000000", undefined],
    ["container-only", undefined, "2.000000"]
  ] as const) {
    const onlyOneDuration = JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", codec_tag_string: "avc1", width: 640, height: 360,
      nb_read_frames: "60", ...(stream === undefined ? {} : { duration: stream }), disposition: { attached_pic: 0 } }],
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", ...(format === undefined ? {} : { duration: format }) } });
    const singleFixture = await fakeFfprobe(onlyOneDuration);
    try {
      const result = await runner(singleFixture.binary).probe(input());
      assert.equal(result.metadata.video.duration_seconds, 2, label);
      releaseTrustedOwnerTopazEnhanceOriginalProbeResult(result);
    } finally { await rm(singleFixture.directory, { recursive: true, force: true }); }
  }
});

test("rejects forged DTOs, unsupported broader public MIME contours, and unsafe ffprobe paths before probing", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  const fixture = await fakeFfprobe(BASE_PROBE);
  try {
    const probe = runner(fixture.binary);
    await assert.rejects(probe.probe(input({ extra: true })), OwnerTopazEnhanceOriginalProbeError);
    await assert.rejects(probe.probe(input({ model_id: "topaz-astra" })), OwnerTopazEnhanceOriginalProbeError);
    await assert.rejects(probe.probe(input({ ai_name: "topaz_astra" })), OwnerTopazEnhanceOriginalProbeError);
    await assert.rejects(probe.probe(input({ filename: "source.mov", mime_type: "video/quicktime" })), OwnerTopazEnhanceOriginalProbeError);
    await assert.rejects(probe.probe(input({ filename: "source.webm", mime_type: "video/webm" })), OwnerTopazEnhanceOriginalProbeError);
    await assert.rejects(probe.probe(input({ filename: "source.mov" })), OwnerTopazEnhanceOriginalProbeError);
    const oversized = new Uint8Array(52_428_801);
    Object.defineProperty(oversized, "byteLength", { value: 28 });
    await assert.rejects(probe.probe(input({ bytes: oversized })), (error: unknown) =>
      error instanceof OwnerTopazEnhanceOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    await assert.rejects(probe.probe(input({ bytes: Uint8Array.from(new TextEncoder().encode("webm-not-mp4-brand")) })), OwnerTopazEnhanceOriginalProbeError);
    assert.throws(() => createOwnerTopazEnhanceOriginalProbe({ ffprobePath: "relative/ffprobe" }), OwnerTopazEnhanceOriginalProbeError);
    const link = join(fixture.directory, "ffprobe-link");
    await symlink(fixture.binary, link);
    assert.throws(() => createOwnerTopazEnhanceOriginalProbe({ ffprobePath: link }), OwnerTopazEnhanceOriginalProbeError);
    await assert.rejects(probe.probe(input({ bytes: new Proxy(mp4Bytes(), {}) })), OwnerTopazEnhanceOriginalProbeError);
    assert.equal((await readFile(fixture.marker).catch(() => Buffer.alloc(0))).length, 0);
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});

test("enforces only explicit duration and local frame resource guards and rejects attached pictures", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fixture executable is unavailable on Windows"); return; }
  for (const [label, metadata, expectedCode] of [
    ["below public minimum", JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", codec_tag_string: "avc1", width: 640, height: 360, nb_read_frames: "30", duration: "1.99", disposition: { attached_pic: 0 } }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1.99" } }), "ORIGINAL_LOCAL_LIMIT_EXCEEDED"],
    ["above public maximum", JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", codec_tag_string: "avc1", width: 640, height: 360, nb_read_frames: "788", duration: "26.26", disposition: { attached_pic: 0 } }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "26.26" } }), "ORIGINAL_LOCAL_LIMIT_EXCEEDED"],
    ["local frame resource cap", JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", codec_tag_string: "avc1", width: 640, height: 360, nb_read_frames: "10001", duration: "26.25", disposition: { attached_pic: 0 } }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "26.25" } }), "ORIGINAL_LOCAL_LIMIT_EXCEEDED"],
    ["attached picture", JSON.stringify({ streams: [{ codec_type: "video", codec_name: "mjpeg", codec_tag_string: "avc1", width: 640, height: 360, nb_read_frames: "1", duration: "2", disposition: { attached_pic: 1 } }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2" } }), "INVALID_ORIGINAL"]
  ] as const) {
    const fixture = await fakeFfprobe(metadata);
    try {
      await assert.rejects(runner(fixture.binary).probe(input()), (error: unknown) =>
        error instanceof OwnerTopazEnhanceOriginalProbeError && error.code === expectedCode, label);
    } finally { await rm(fixture.directory, { recursive: true, force: true }); }
  }
});
