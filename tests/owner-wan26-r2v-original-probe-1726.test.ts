import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFile as execFileCallback } from "node:child_process";
import { existsSync } from "node:fs";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import {
  copyTrustedOwnerWan26R2vOriginalBytes,
  createOwnerWan26R2vOriginalProbe,
  isTrustedOwnerWan26R2vOriginalProbeResult,
  OwnerWan26R2vOriginalProbeError,
  releaseTrustedOwnerWan26R2vOriginalProbeResult,
  WAN26_R2V_ORIGINAL_VIDEO_POLICY
} from "../src/application/owner-wan26-r2v-original-probe.js";

const execFile = promisify(execFileCallback);
const FFMPEG = ["/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"].find(existsSync);
const FFPROBE = ["/opt/homebrew/bin/ffprobe", "/usr/bin/ffprobe"].find(existsSync);
const fixtureRoots: string[] = [];
let mp4FixturePromise: ReturnType<typeof mediaFixture> | undefined;
let movFixturePromise: ReturnType<typeof mediaFixture> | undefined;

after(async () => { await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true }))); });

async function mediaFixture(format: "mp4" | "mov"): Promise<{ directory: string; filename: string; bytes: Uint8Array }> {
  assert.ok(FFMPEG, "local ffmpeg is required for the generated media fixture");
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-r2v-source-"));
  fixtureRoots.push(directory);
  const filename = join(directory, `source.${format}`);
  await execFile(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=384x384:r=2",
    "-t", "1", "-an", "-c:v", "mpeg4", "-f", format, filename]);
  return { directory, filename, bytes: new Uint8Array(await readFile(filename)) };
}

function originalMp4Fixture(): ReturnType<typeof mediaFixture> {
  return mp4FixturePromise ??= mediaFixture("mp4");
}

function originalMovFixture(): ReturnType<typeof mediaFixture> {
  return movFixturePromise ??= mediaFixture("mov");
}

async function fakeFfprobe(output: string): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-r2v-ffprobe-"));
  fixtureRoots.push(directory);
  const binary = join(directory, "ffprobe-fixture");
  const script = `#!/bin/sh\nfor last do :; done\n[ -s "$last" ] || exit 32\nprintf '%s' '${output.replaceAll("'", "'\\''")}'\n`;
  await writeFile(binary, script, { mode: 0o700, flag: "wx" });
  return { directory, binary };
}

function tinyMp4(): Uint8Array {
  return Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
}

async function executableProbe(directory: string, body: string): Promise<string> {
  const binary = join(directory, "operator-ffprobe");
  await writeFile(binary, `#!${process.execPath}\n${body}\n`, { mode: 0o700, flag: "wx" });
  return binary;
}

test("C396 local policy is separate from the operator memory guard", () => {
  assert.equal(WAN26_R2V_ORIGINAL_VIDEO_POLICY.public_catalog_version,
    "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json");
  assert.equal(WAN26_R2V_ORIGINAL_VIDEO_POLICY.catalog_build_id, "1791904852");
  assert.deepEqual(WAN26_R2V_ORIGINAL_VIDEO_POLICY.catalog_limits, {
    max_file_size_bytes: 1_048_576_000, min_side: 384, max_side: 5_000,
    min_duration_seconds: 1, max_duration_seconds: 30,
    accepted_video_mime_types: ["video/mp4", "video/mov"], prohibited_codecs: []
  });
  assert.equal(WAN26_R2V_ORIGINAL_VIDEO_POLICY.default_operator_local_max_bytes, 104_857_600);
  assert.equal(WAN26_R2V_ORIGINAL_VIDEO_POLICY.operator_limit_kind, "LOCAL_MEMORY_COPY_GUARD_NOT_VENDOR_LIMIT");
});

test("genuine MP4 and MOV sources are model-bound, copyable once, and revocable without dispatch authority",
  { skip: !(FFMPEG && FFPROBE) }, async () => {
  assert.ok(FFMPEG && FFPROBE, "local ffmpeg and ffprobe are required for the generated media fixture");
  const results: Array<{ value: Awaited<ReturnType<ReturnType<typeof createOwnerWan26R2vOriginalProbe>["probe"]>>; directory: string }> = [];
  for (const item of [
    { model_id: "wan_26_r2v" as const, format: "mp4" as const, mime_type: "video/mp4" as const },
    { model_id: "wan_26_r2v_flash" as const, format: "mov" as const, mime_type: "video/mov" as const }
  ]) {
    const fixture = await (item.format === "mp4" ? originalMp4Fixture() : originalMovFixture());
    const runner = createOwnerWan26R2vOriginalProbe({ ffprobePath: FFPROBE });
    const input = {
      model_id: item.model_id, filename: `source.${item.format}`, mime_type: item.mime_type, bytes: fixture.bytes
    };
    const pending = runner.probe(input);
    if (results.length === 0) {
      await assert.rejects(runner.probe(input), (error: unknown) =>
        error instanceof OwnerWan26R2vOriginalProbeError && error.code === "LOCAL_RESOURCE_BUSY");
    }
    const result = await pending;
    results.push({ value: result, directory: fixture.directory });
    assert.equal(isTrustedOwnerWan26R2vOriginalProbeResult(result), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.metadata), true);
    assert.equal(result.model_id, item.model_id);
    assert.equal(result.mime_type, item.mime_type);
    assert.equal(result.source_catalog_version, "sha256-396de1c43fcaa64082a3b6adb4539054929ca388b5b1cf951afff0130ffe2e7e.json");
    assert.equal(result.source_sha256.length, 64);
    assert.equal(result.bytes_copied, fixture.bytes.byteLength);
    assert.equal(result.metadata.container, "ISO_BMFF_MOV_MP4");
    assert.equal(result.metadata.width, 384);
    assert.equal(result.metadata.height, 384);
    assert.equal(result.metadata.duration_seconds, 1);
    assert.equal(result.generation_permit, false);
    assert.equal(result.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal(result.selection_crop, "NOT_PERFORMED");

    const copy = copyTrustedOwnerWan26R2vOriginalBytes(result);
    assert.deepEqual(copy, fixture.bytes);
    copy.fill(0);
    assert.deepEqual(copyTrustedOwnerWan26R2vOriginalBytes(result), fixture.bytes);
    assert.equal(isTrustedOwnerWan26R2vOriginalProbeResult(new Proxy(result, {})), false);
    assert.equal(isTrustedOwnerWan26R2vOriginalProbeResult({ ...result }), false);
    releaseTrustedOwnerWan26R2vOriginalProbeResult(result);
    assert.equal(isTrustedOwnerWan26R2vOriginalProbeResult(result), false);
    assert.throws(() => copyTrustedOwnerWan26R2vOriginalBytes(result), OwnerWan26R2vOriginalProbeError);
  }
  assert.deepEqual(results.map(({ value }) => value.model_id), ["wan_26_r2v", "wan_26_r2v_flash"]);
});

test("input size guard is configurable only up to the C396 cap and is not represented as a vendor cap",
  { skip: !(FFMPEG && FFPROBE) }, async () => {
  assert.ok(FFMPEG && FFPROBE, "local ffmpeg and ffprobe are required for the generated media fixture");
  const fixture = await originalMp4Fixture();
  const input = { model_id: "wan_26_r2v" as const, filename: "source.mp4", mime_type: "video/mp4" as const, bytes: fixture.bytes };
  const guard = Math.max(16, fixture.bytes.byteLength - 1);
  await assert.rejects(createOwnerWan26R2vOriginalProbe({ ffprobePath: FFPROBE, operatorLocalMaxBytes: guard }).probe(input),
    (error: unknown) => error instanceof OwnerWan26R2vOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
  const catalogCap = await createOwnerWan26R2vOriginalProbe({ ffprobePath: FFPROBE, operatorLocalMaxBytes: 1_048_576_000 }).probe(input);
  assert.equal(catalogCap.operator_local_max_bytes, 1_048_576_000);
  assert.equal(catalogCap.local_guard_id, "LOCAL_MEMORY_COPY_GUARD_NOT_VENDOR_LIMIT");
  releaseTrustedOwnerWan26R2vOriginalProbeResult(catalogCap);
  await assert.rejects(Promise.resolve().then(() => createOwnerWan26R2vOriginalProbe({
    ffprobePath: FFPROBE, operatorLocalMaxBytes: 1_048_576_001
  })), OwnerWan26R2vOriginalProbeError);
  await assert.rejects(createOwnerWan26R2vOriginalProbe({ ffprobePath: FFPROBE }).probe({
    ...input, model_id: "wan_27_r2v"
  }), (error: unknown) => error instanceof OwnerWan26R2vOriginalProbeError && error.code === "INVALID_ORIGINAL");
});

test("measured C396 side and duration limits accept exact edges and reject values just outside",
  { skip: !(FFMPEG && FFPROBE) }, async () => {
  const fixture = await originalMp4Fixture();
  const output = (width: number, height: number, duration: number) => JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "h264", width, height, nb_read_frames: "60", duration: String(duration), avg_frame_rate: "2/1" }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: String(duration) }
  });
  const upper = await fakeFfprobe(output(5_000, 5_000, 30));
  const accepted = await createOwnerWan26R2vOriginalProbe({ ffprobePath: upper.binary }).probe({
    model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes: fixture.bytes
  });
  assert.equal(accepted.metadata.width, 5_000);
  assert.equal(accepted.metadata.height, 5_000);
  assert.equal(accepted.metadata.duration_seconds, 30);
  releaseTrustedOwnerWan26R2vOriginalProbeResult(accepted);

  for (const [width, height, duration] of [[383, 384, 1], [5_001, 5_000, 1], [384, 384, 0.999], [384, 384, 30.001]]) {
    const outside = await fakeFfprobe(output(width!, height!, duration!));
    await assert.rejects(createOwnerWan26R2vOriginalProbe({ ffprobePath: outside.binary }).probe({
      model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes: fixture.bytes
    }), (error: unknown) => error instanceof OwnerWan26R2vOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
  }
});

test("a genuine pre-aborted Node signal is accepted and starts no subprocess", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-r2v-preabort-"));
  fixtureRoots.push(directory);
  const marker = join(directory, "ffprobe-was-started");
  const binary = await executableProbe(directory, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started");`);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createOwnerWan26R2vOriginalProbe({ ffprobePath: binary }).probe({
    model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes: tinyMp4()
  }, { signal: controller.signal }), (error: unknown) =>
    error instanceof OwnerWan26R2vOriginalProbeError && error.code === "PROBE_ABORTED");
  assert.equal(existsSync(marker), false);
});

test("intrinsic byte snapshot rejects own shadow accessors, shared backing, and subclasses before I/O", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-r2v-shadow-"));
  fixtureRoots.push(directory);
  const marker = join(directory, "ffprobe-was-started");
  const binary = await executableProbe(directory, `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started");`);
  const runner = createOwnerWan26R2vOriginalProbe({ ffprobePath: binary });
  const base = tinyMp4();
  let shadowLengthReads = 0;
  Object.defineProperty(base, "length", { get() { shadowLengthReads += 1; return 20; } });
  await assert.rejects(runner.probe({ model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes: base }),
    (error: unknown) => error instanceof OwnerWan26R2vOriginalProbeError && error.code === "INVALID_ORIGINAL");
  assert.equal(shadowLengthReads, 0);

  class SubclassedBytes extends Uint8Array {}
  const subclass = new SubclassedBytes(tinyMp4());
  await assert.rejects(runner.probe({ model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes: subclass }),
    (error: unknown) => error instanceof OwnerWan26R2vOriginalProbeError && error.code === "INVALID_ORIGINAL");

  const shared = new Uint8Array(new SharedArrayBuffer(20));
  shared.set(tinyMp4());
  await assert.rejects(runner.probe({ model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes: shared }),
    (error: unknown) => error instanceof OwnerWan26R2vOriginalProbeError && error.code === "INVALID_ORIGINAL");
  assert.equal(existsSync(marker), false);
});

test("midflight abort waits for ffprobe close, then wipes and removes its private source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-r2v-abort-close-"));
  fixtureRoots.push(directory);
  const marker = join(directory, "input-path");
  const binary = await executableProbe(directory, `
    const fs = require("node:fs");
    fs.writeFileSync(${JSON.stringify(marker)}, process.argv.at(-1));
    setInterval(() => {}, 1000);
  `);
  const controller = new AbortController();
  const pending = createOwnerWan26R2vOriginalProbe({ ffprobePath: binary }).probe({
    model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes: tinyMp4()
  }, { signal: controller.signal });
  let inputPath: string | undefined;
  for (let attempt = 0; attempt < 100 && !inputPath; attempt += 1) {
    try { inputPath = await readFile(marker, "utf8"); }
    catch { await new Promise((resolve) => setTimeout(resolve, 10)); }
  }
  assert.ok(inputPath, "fake operator probe must start before abort");
  controller.abort();
  await assert.rejects(pending, (error: unknown) =>
    error instanceof OwnerWan26R2vOriginalProbeError && error.code === "PROBE_ABORTED");
  assert.equal(existsSync(inputPath), false);
  await assert.rejects(access(dirname(inputPath)), (error: unknown) =>
    Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"));
});

test("cleanup failure rejects and revokes a receipt that was minted before temporary cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan26-r2v-cleanup-fail-"));
  fixtureRoots.push(directory);
  const marker = join(directory, "input-path");
  const output = JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "h264", width: 384, height: 384, nb_read_frames: "2", duration: "1", avg_frame_rate: "2/1" }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1" }
  });
  const binary = await executableProbe(directory, `
    const fs = require("node:fs");
    const path = require("node:path");
    const input = process.argv.at(-1);
    fs.writeFileSync(${JSON.stringify(marker)}, input);
    fs.writeFileSync(path.join(path.dirname(input), "leftover"), "forces directory cleanup failure");
    process.stdout.write(${JSON.stringify(output)});
  `);
  const originalFreeze = Object.freeze;
  let minted: unknown;
  Object.freeze = ((value: object) => {
    const frozen = originalFreeze(value);
    if (Object.getOwnPropertyDescriptor(value, "status")?.value === "TRUSTED_LOCAL_MEDIA_PROBE") minted = frozen;
    return frozen;
  }) as typeof Object.freeze;
  let inputPath: string | undefined;
  try {
    await assert.rejects(createOwnerWan26R2vOriginalProbe({ ffprobePath: binary }).probe({
      model_id: "wan_26_r2v", filename: "source.mp4", mime_type: "video/mp4", bytes: tinyMp4()
    }), (error: unknown) => error instanceof OwnerWan26R2vOriginalProbeError && error.code === "PROBE_FAILED");
    inputPath = await readFile(marker, "utf8");
    assert.equal(existsSync(inputPath), false, "the source file is wiped and removed even when directory cleanup fails");
    assert.ok(minted, "the failure path must exercise the locally minted but not returned receipt");
    assert.equal(isTrustedOwnerWan26R2vOriginalProbeResult(minted), false);
    assert.throws(() => copyTrustedOwnerWan26R2vOriginalBytes(minted), OwnerWan26R2vOriginalProbeError);
  } finally {
    Object.freeze = originalFreeze;
    if (inputPath) await rm(dirname(inputPath), { recursive: true, force: true });
  }
});
