import assert from "node:assert/strict";
import { constants as fsConstants, lstat, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OwnerSeedanceEditorVideoPolicyError,
  isValidatedOwnerSeedanceEditorVideo,
  readValidatedOwnerSeedanceEditorVideo,
  releaseValidatedOwnerSeedanceEditorVideo,
  validateOwnerSeedanceEditorVideo
} from "../src/application/owner-seedance-editor-video-policy.js";

const MIB = 1024 * 1024;

function syntheticMp4(majorBrand = "isom"): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write(majorBrand, 8, "ascii");
  bytes.write("isom", 16, "ascii");
  bytes.write("mp42", 20, "ascii");
  return bytes;
}

function ffprobeJson(options: { width?: number; height?: number; start?: string; duration?: string }): string {
  const start = options.start ?? "0";
  const duration = options.duration ?? "4";
  return JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "unrestricted-fixture-codec", width: options.width ?? 640,
      height: options.height ?? 360, start_time: start, start_pts: Math.round(Number(start) * 1000),
      duration, duration_ts: Math.round(Number(duration) * 1000), time_base: "1/1000" }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "999" }
  });
}

async function makeFfprobe(json: string, markerPath?: string): Promise<{ directory: string; executable: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-editor-video2223-"));
  const interpreter = join(directory, "node");
  const executable = join(directory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  const marker = markerPath === undefined ? "" :
    `require("node:fs").writeFileSync(${JSON.stringify(markerPath)},JSON.stringify({args:process.argv.slice(2)}));\n`;
  const script = `#!${interpreter}\n` +
    `const fs=require("node:fs");const args=process.argv.slice(2);` +
    `const whitelist=args.indexOf("-protocol_whitelist");if(whitelist<0||args[whitelist+1]!=="file,pipe")process.exit(31);` +
    `const input=args[args.length-1];if(!fs.statSync(input).isFile())process.exit(32);\n` + marker +
    `process.stdout.write(${JSON.stringify(json)});\n`;
  await writeFile(executable, script, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await (await import("node:fs/promises")).access(executable, fsConstants.X_OK);
  return { directory, executable: await realpath(executable) };
}

function input(ffprobePath: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { filename: "source.mp4", mime_type: "video/mp4", bytes: syntheticMp4(), ffprobePath, ...overrides };
}

async function expectPolicyError(request: unknown, code: string): Promise<void> {
  await assert.rejects(validateOwnerSeedanceEditorVideo(request as never), (error: unknown) =>
    error instanceof OwnerSeedanceEditorVideoPolicyError && error.code === code);
}

test("probes bounded ffprobe metadata and mints a model-bound receipt without decode claims", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-editor-video2223-marker-"));
  const markerPath = join(directory, "probe.json");
  const probe = await makeFfprobe(ffprobeJson({ width: 127, height: 1, duration: "4.25" }), markerPath);
  const bytes = syntheticMp4();
  try {
    const receipt = await validateOwnerSeedanceEditorVideo(input(probe.executable, { bytes }));
    assert.equal(isValidatedOwnerSeedanceEditorVideo(receipt), true);
    assert.equal(receipt.model_id, "seedance-2.5-editor");
    assert.equal(receipt.width, 127);
    assert.equal(receipt.height, 1);
    assert.equal(receipt.duration_seconds, 4.25);
    assert.equal(receipt.metadata_confidence, "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED");
    assert.equal(receipt.pixel_decode, false);
    assert.equal(receipt.provider_acceptance, "UNPROVEN");
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as { args: string[] };
    assert.ok(marker.args.includes("-show_entries"));
    assert.ok(marker.args.includes("-protocol_whitelist"));
    const read = readValidatedOwnerSeedanceEditorVideo(receipt);
    assert.ok(read);
    assert.deepEqual([...read.bytes], [...bytes]);
    assert.equal(read.sha256, receipt.source_sha256);
    assert.equal(releaseValidatedOwnerSeedanceEditorVideo(receipt), true);
    assert.equal(isValidatedOwnerSeedanceEditorVideo(receipt), false);
    assert.equal(readValidatedOwnerSeedanceEditorVideo(receipt), null);
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("accepts inclusive 4-to-30 second boundaries and rejects values outside them", async () => {
  for (const seconds of ["4", "30"]) {
    const probe = await makeFfprobe(ffprobeJson({ duration: seconds }));
    try {
      const receipt = await validateOwnerSeedanceEditorVideo(input(probe.executable));
      assert.equal(receipt.duration_seconds, Number(seconds));
      releaseValidatedOwnerSeedanceEditorVideo(receipt);
    } finally { await rm(probe.directory, { recursive: true, force: true }); }
  }
  for (const seconds of ["3.999", "30.001"]) {
    const probe = await makeFfprobe(ffprobeJson({ duration: seconds }));
    try { await expectPolicyError(input(probe.executable), "SOURCE_LIMIT_EXCEEDED"); }
    finally { await rm(probe.directory, { recursive: true, force: true }); }
  }
});

test("applies the conservative configurable 100 MiB cap and rejects invalid records before spawning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-editor-video2223-input-"));
  const markerPath = join(directory, "spawned");
  const probe = await makeFfprobe(ffprobeJson({}), markerPath);
  try {
    await expectPolicyError(input(probe.executable, { maxFileBytes: 1 }), "LOCAL_RESOURCE_LIMIT_EXCEEDED");
    await expectPolicyError(input(probe.executable, { maxFileBytes: 100 * MIB + 1 }), "INVALID_INPUT");
    const accessorInput = input(probe.executable);
    Object.defineProperty(accessorInput, "filename", { enumerable: true, get: () => "source.mp4" });
    await expectPolicyError(accessorInput, "INVALID_INPUT");
    await assert.rejects(lstat(markerPath), { code: "ENOENT" });
  } finally {
    await rm(probe.directory, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects missing or invalid ffprobe dimensions and non-finite duration metadata", async () => {
  const invalidMetadata = [
    { json: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "x", width: 0, height: 1, start_time: "0", duration: "4", time_base: "1/1" }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" } }), code: "UNSUPPORTED_MEDIA_METADATA" },
    { json: JSON.stringify({ streams: [{ codec_type: "video", codec_name: "x", width: 1, height: 1, start_time: "0", duration: "NaN", time_base: "1/1" }], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" } }), code: "UNSUPPORTED_MEDIA_METADATA" }
  ];
  for (const item of invalidMetadata) {
    const probe = await makeFfprobe(item.json);
    try { await expectPolicyError(input(probe.executable), item.code); }
    finally { await rm(probe.directory, { recursive: true, force: true }); }
  }
});

test("requires MIME and filename agreement, rejects cloned receipts, and returns guarded byte copies", async () => {
  const probe = await makeFfprobe(ffprobeJson({}));
  try {
    await expectPolicyError(input(probe.executable, { filename: "source.mov" }), "INVALID_INPUT");
    const receipt = await validateOwnerSeedanceEditorVideo(input(probe.executable));
    assert.equal(isValidatedOwnerSeedanceEditorVideo(Object.freeze({ ...receipt })), false);
    const first = readValidatedOwnerSeedanceEditorVideo(receipt);
    assert.ok(first);
    first.bytes.fill(0);
    const second = readValidatedOwnerSeedanceEditorVideo(receipt);
    assert.ok(second);
    assert.deepEqual([...second.bytes], [...syntheticMp4()]);
    assert.equal(releaseValidatedOwnerSeedanceEditorVideo(receipt), true);
  } finally { await rm(probe.directory, { recursive: true, force: true }); }
});

test("accepts a QuickTime container as a distinct MIME and extension pair", async () => {
  const probe = await makeFfprobe(ffprobeJson({ duration: "4" }));
  try {
    const receipt = await validateOwnerSeedanceEditorVideo(input(probe.executable, {
      filename: "source.mov", mime_type: "video/quicktime", bytes: syntheticMp4("qt  ")
    }));
    assert.equal(receipt.mime_type, "video/quicktime");
    assert.equal(receipt.model_id, "seedance-2.5-editor");
    releaseValidatedOwnerSeedanceEditorVideo(receipt);
  } finally { await rm(probe.directory, { recursive: true, force: true }); }
});
