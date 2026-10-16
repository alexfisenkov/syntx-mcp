import assert from "node:assert/strict";
import test, { after } from "node:test";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  copyTrustedOwnerWan30EditOriginalBytes,
  createOwnerWan30EditOriginalProbe,
  isTrustedOwnerWan30EditOriginalProbeResult,
  OwnerWan30EditOriginalProbeError,
  releaseTrustedOwnerWan30EditOriginalProbeResult
} from "../src/adapter/syntx/owner-wan30-edit-original-probe.js";

const fixtureRoots: string[] = [];
after(async () => { await Promise.all(fixtureRoots.map((root) => rm(root, { recursive: true, force: true }))); });

function tinyMp4(): Uint8Array {
  return Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
}

async function localFfprobe(output: string, extraBody = ""): Promise<{ directory: string; binary: string; argumentLog: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan30-edit-probe-test-"));
  fixtureRoots.push(directory);
  const binary = join(directory, "operator-ffprobe");
  const argumentLog = join(directory, "arguments.json");
  const body = `
    const fs = require("node:fs");
    const args = process.argv.slice(2);
    fs.writeFileSync(${JSON.stringify(argumentLog)}, JSON.stringify(args));
    const input = args.at(-1);
    if (!fs.statSync(input).isFile() || fs.statSync(input).size < 16) process.exit(31);
    ${extraBody}
    process.stdout.write(${JSON.stringify(output)});
  `;
  await writeFile(binary, `#!${process.execPath}\n${body}\n`, { mode: 0o700, flag: "wx" });
  return { directory, binary, argumentLog };
}

function metadata(overrides: {
  formatName?: string; formatDuration?: string; streamDuration?: string; width?: number; height?: number;
  avgRate?: string; nominalRate?: string; frameCount?: string; audio?: boolean; streams?: unknown[];
} = {}): string {
  const video = {
    codec_type: "video",
    width: overrides.width ?? 854,
    height: overrides.height ?? 480,
    duration: overrides.streamDuration ?? "2.000000",
    avg_frame_rate: overrides.avgRate ?? "30/1",
    r_frame_rate: overrides.nominalRate ?? "30/1",
    ...(overrides.frameCount === undefined ? {} : { nb_frames: overrides.frameCount })
  };
  return JSON.stringify({
    streams: overrides.streams ?? [video, ...(overrides.audio ? [{ codec_type: "audio" }] : [])],
    format: { format_name: overrides.formatName ?? "mov,mp4,m4a,3gp,3g2,mj2", duration: overrides.formatDuration ?? "2.000000" }
  });
}

async function probeFixture(output = metadata(), extraBody = "") {
  const fixture = await localFfprobe(output, extraBody);
  const runner = createOwnerWan30EditOriginalProbe({ ffprobePath: fixture.binary });
  return { fixture, runner };
}

function input(bytes: Uint8Array = tinyMp4(), extras: Record<string, unknown> = {}) {
  return { filename: "owned-source.mp4", mime_type: "video/mp4", bytes, ...extras };
}

test("returns an immutable nominal receipt bound to a private byte copy without granting generation",
  { skip: process.platform === "win32" ? "POSIX fixture; real ffprobe.exe coverage NOT_RUN" : false }, async () => {
  const { fixture, runner } = await probeFixture(metadata({ frameCount: "60" }));
  const bytes = tinyMp4();
  const result = await runner.probe(input(bytes));
  assert.deepEqual(Object.keys(result), [
    "model_id", "filename", "mime_type", "size", "sha256", "width", "height", "duration_seconds", "fps", "frame_count",
    "container_confidence", "generation_permit"
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.model_id, "wan_30_edit");
  assert.equal(result.filename, "owned-source.mp4");
  assert.equal(result.mime_type, "video/mp4");
  assert.equal(result.size, bytes.byteLength);
  assert.equal(result.sha256.length, 64);
  assert.equal(result.width, 854);
  assert.equal(result.height, 480);
  assert.equal(result.duration_seconds, 2);
  assert.equal(result.fps, 30);
  assert.equal(result.frame_count, 60);
  assert.equal(result.container_confidence, "LOCAL_FFPROBE_METADATA_ONLY");
  assert.equal(result.generation_permit, false);
  assert.equal(isTrustedOwnerWan30EditOriginalProbeResult(result), true);
  assert.equal(isTrustedOwnerWan30EditOriginalProbeResult({ ...result }), false);
  assert.equal(isTrustedOwnerWan30EditOriginalProbeResult(new Proxy(result, {})), false);
  const copied = copyTrustedOwnerWan30EditOriginalBytes(result);
  assert.deepEqual(copied, bytes);
  assert.notEqual(copied.buffer, bytes.buffer);
  copied.fill(0);
  assert.deepEqual(copyTrustedOwnerWan30EditOriginalBytes(result), bytes);
  const args = JSON.parse(await readFile(fixture.argumentLog, "utf8")) as string[];
  assert.equal(args.includes("-count_frames"), false);
  assert.equal(args.includes("-show_frames"), false);
  assert.deepEqual(args.slice(0, 3), ["-v", "error", "-protocol_whitelist"]);
  assert.equal(existsSync(args.at(-1)!), false, "temporary source is removed after probing");
  releaseTrustedOwnerWan30EditOriginalProbeResult(result);
  assert.equal(isTrustedOwnerWan30EditOriginalProbeResult(result), false);
  assert.throws(() => copyTrustedOwnerWan30EditOriginalBytes(result), (error: unknown) =>
    error instanceof OwnerWan30EditOriginalProbeError && error.code === "INVALID_ORIGINAL");
});

test("accepts the 2 second local duration window and rejects unsupported media bounds",
  { skip: process.platform === "win32" ? "POSIX fixture; real ffprobe.exe coverage NOT_RUN" : false }, async () => {
  const accepted = await probeFixture(metadata({ formatDuration: "2.001000", streamDuration: "2.001000" }));
  const edge = await accepted.runner.probe(input());
  assert.equal(edge.duration_seconds, 2.001);
  releaseTrustedOwnerWan30EditOriginalProbeResult(edge);

  const rejects = [
    metadata({ formatDuration: "1.998", streamDuration: "1.998" }),
    metadata({ formatDuration: "2.002", streamDuration: "2.002" }),
    metadata({ width: 239 }),
    metadata({ height: 8_001 }),
    metadata({ width: 7_251, height: 7_241 }),
    metadata({ avgRate: "15/1", nominalRate: "15/1" }),
    metadata({ avgRate: "121/1", nominalRate: "121/1" })
  ];
  for (const output of rejects) {
    const { runner } = await probeFixture(output);
    await assert.rejects(runner.probe(input()), (error: unknown) =>
      error instanceof OwnerWan30EditOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
  }
});

test("rejects non-MP4 brands, audio, missing or discordant metadata, and frame-rate disagreement",
  { skip: process.platform === "win32" ? "POSIX fixture; real ffprobe.exe coverage NOT_RUN" : false }, async () => {
  const local = await probeFixture();
  const mixedQuickTimeMajor = tinyMp4();
  mixedQuickTimeMajor.set([0x71, 0x74, 0x20, 0x20], 8);
  const mixedQuickTimeCompatible = tinyMp4();
  mixedQuickTimeCompatible.set([0x71, 0x74, 0x20, 0x20], 16);
  const oversizedFtyp = new Uint8Array(1_028);
  oversizedFtyp.set(tinyMp4());
  oversizedFtyp[2] = 4; oversizedFtyp[3] = 4;
  for (let offset = 16; offset < oversizedFtyp.byteLength; offset += 4) oversizedFtyp.set([0x69, 0x73, 0x6f, 0x6d], offset);
  for (const bytes of [mixedQuickTimeMajor, mixedQuickTimeCompatible, oversizedFtyp]) {
    await assert.rejects(local.runner.probe(input(bytes)), (error: unknown) =>
      error instanceof OwnerWan30EditOriginalProbeError && error.code === "INVALID_ORIGINAL");
    assert.equal(existsSync(local.fixture.argumentLog), false, "invalid ftyp headers must be rejected before launching ffprobe");
  }
  for (const output of [
    metadata({ audio: true }),
    metadata({ formatDuration: "2.1" }),
    metadata({ formatDuration: "NaN" }),
    metadata({ avgRate: "30/1", nominalRate: "24/1" }),
    metadata({ streams: [] }),
    metadata({ formatName: "mov,mp4,m4a,3gp,3g2,mj2", streams: [{ codec_type: "audio" }] })
  ]) {
    const { runner } = await probeFixture(output);
    await assert.rejects(runner.probe(input()), (error: unknown) =>
      error instanceof OwnerWan30EditOriginalProbeError && error.code === "INVALID_ORIGINAL");
  }
});

test("fails closed on invalid paths and malformed inputs without disclosing diagnostics", async () => {
  await assert.rejects(Promise.resolve().then(() => createOwnerWan30EditOriginalProbe({ ffprobePath: "relative/ffprobe" })),
    (error: unknown) => error instanceof OwnerWan30EditOriginalProbeError && error.code === "INVALID_ORIGINAL");
  const { fixture, runner } = await probeFixture();
  for (const request of [
    input(tinyMp4(), { filename: "../source.mp4" }),
    input(tinyMp4(), { mime_type: "video/quicktime" }),
    input(new Uint8Array(30 * 1024 * 1024 + 1)),
    { filename: "source.mp4", mime_type: "video/mp4", bytes: tinyMp4(), model_id: "wan_30_edit" }
  ]) {
    await assert.rejects(runner.probe(request), (error: unknown) => {
      assert.ok(error instanceof OwnerWan30EditOriginalProbeError);
      assert.equal("path" in error, false);
      assert.equal("stderr" in error, false);
      return error.code === ("bytes" in request && request.bytes instanceof Uint8Array && request.bytes.byteLength > 30 * 1024 * 1024
        ? "ORIGINAL_LOCAL_LIMIT_EXCEEDED" : "INVALID_ORIGINAL");
    });
  }
  assert.equal(existsSync(fixture.argumentLog), false, "invalid inputs do not launch ffprobe");
});

test("pre-aborted input signal prevents probing and temporary-file creation", async () => {
  const { fixture, runner } = await probeFixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runner.probe(input(tinyMp4(), { signal: controller.signal })), (error: unknown) =>
    error instanceof OwnerWan30EditOriginalProbeError && error.code === "PROBE_ABORTED");
  assert.equal(existsSync(fixture.argumentLog), false);
});

test("rejects a group/world-writable resolved ffprobe binary before launch on POSIX",
  { skip: process.platform === "win32" ? "POSIX permission bits; real ffprobe.exe coverage NOT_RUN" : false }, async () => {
  const { fixture, runner } = await probeFixture();
  await chmod(fixture.binary, 0o777);
  try {
    await assert.rejects(runner.probe(input()), (error: unknown) =>
      error instanceof OwnerWan30EditOriginalProbeError && error.code === "INVALID_ORIGINAL");
    assert.equal(existsSync(fixture.argumentLog), false);
  } finally { await chmod(fixture.binary, 0o700); }
});

test("abort after metadata receipt minting waits for cleanup and revokes retained bytes",
  { skip: process.platform === "win32" ? "POSIX fixture; real ffprobe.exe coverage NOT_RUN" : false }, async () => {
  const { fixture, runner } = await probeFixture();
  const controller = new AbortController();
  const originalFreeze = Object.freeze;
  let minted: unknown;
  Object.freeze = ((value: object) => {
    const frozen = originalFreeze(value);
    if (Object.getOwnPropertyDescriptor(value, "model_id")?.value === "wan_30_edit") {
      minted = frozen;
      controller.abort();
    }
    return frozen;
  }) as typeof Object.freeze;
  try {
    await assert.rejects(runner.probe(input(tinyMp4(), { signal: controller.signal })), (error: unknown) =>
      error instanceof OwnerWan30EditOriginalProbeError && error.code === "PROBE_ABORTED");
    assert.ok(minted);
    assert.equal(isTrustedOwnerWan30EditOriginalProbeResult(minted), false);
    assert.throws(() => copyTrustedOwnerWan30EditOriginalBytes(minted), (error: unknown) =>
      error instanceof OwnerWan30EditOriginalProbeError && error.code === "INVALID_ORIGINAL");
  } finally { Object.freeze = originalFreeze; }
  const args = JSON.parse(await readFile(fixture.argumentLog, "utf8")) as string[];
  assert.equal(existsSync(args.at(-1)!), false);
  assert.equal(existsSync(dirname(args.at(-1)!)), false);
});

test("bounds ffprobe runtime and removes its private source after timeout",
  { skip: process.platform === "win32" ? "POSIX fixture; real ffprobe.exe coverage NOT_RUN" : false }, async () => {
  const fixture = await localFfprobe(metadata(), "setInterval(() => {}, 1000);");
  const runner = createOwnerWan30EditOriginalProbe({ ffprobePath: fixture.binary, timeoutMs: 1_500 });
  await assert.rejects(runner.probe(input()), (error: unknown) =>
    error instanceof OwnerWan30EditOriginalProbeError && error.code === "PROBE_FAILED");
  const args = JSON.parse(await readFile(fixture.argumentLog, "utf8")) as string[];
  const inputPath = args.at(-1)!;
  assert.equal(existsSync(inputPath), false);
  assert.equal(existsSync(dirname(inputPath)), false);
});
