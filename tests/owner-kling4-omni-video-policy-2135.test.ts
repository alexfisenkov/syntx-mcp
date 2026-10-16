import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OWNER_KLING4_OMNI_VIDEO_POLICY,
  OwnerKling4OmniVideoPolicyError,
  isValidatedOwnerKling4OmniVideo,
  readValidatedOwnerKling4OmniVideo,
  releaseValidatedOwnerKling4OmniVideo,
  validateOwnerKling4OmniVideo
} from "../src/application/owner-kling4-omni-video-policy.js";

const FFPROBE = process.env.SYNTX_K4_OMNI_TEST_FFPROBE ?? "/opt/homebrew/Cellar/ffmpeg/8.1/bin/ffprobe";
const MP4_FIXTURE_BASE64 = [
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAaUbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAC7gAAQAAAQAA",
  "AAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAA",
  "Bb50cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAC7gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAA",
  "AAAAAAAAAAAAAABAAAAAArwAAAK8AAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAu4AAAEAAABAAAAAAU2bWRpYQAAACBtZGhk",
  "AAAAAAAAAAAAAAAAAAAwAAAAkABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAE4W1p",
  "bmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAABKFzdGJsAAAAwXN0c2QA",
  "AAAAAAAAAQAAALFhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAArwCvABIAAAASAAAAAAAAAABFUxhdmM2Mi4yOC4xMDAgbGli",
  "eDI2NAAAAAAAAAAAAAAAGP//AAAAN2F2Y0MBZAAf/+EAGmdkAB+s2UCwFnu8BEAAAAMAQAAADAPGDGWAAQAGaOvjyyLA/fj4AAAA",
  "ABBwYXNwAAAAAQAAAAEAAAAUYnRydAAAAAAAAB0lAAAAAAAAABhzdHRzAAAAAAAAAAEAAABIAAACAAAAABRzdHNzAAAAAAAAAAEA",
  "AAABAAACSGN0dHMAAAAAAAAARwAAAAEAAAQAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQA",
  "AAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAA",
  "AQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAA",
  "CgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAA",
  "AAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAAB",
  "AAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAABAAAK",
  "AAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAA",
  "AAEAAAAAAAAAAQAAAgAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAgAAAAAAgAAAgAAAAAcc3RzYwAAAAAA",
  "AAABAAAAAQAAAEgAAAABAAABNHN0c3oAAAAAAAAAAAAAAEgAAANBAAAAHAAAABkAAAAZAAAAGQAAACIAAAAbAAAAGQAAABkAAAAi",
  "AAAAGwAAABkAAAAZAAAAIgAAABsAAAAZAAAAGQAAACIAAAAbAAAAGQAAABkAAAAiAAAAGwAAABkAAAAZAAAAIgAAABsAAAAZAAAA",
  "GQAAACIAAAAbAAAAGQAAABkAAAAiAAAAGwAAABkAAAAZAAAAIgAAABsAAAAZAAAAGQAAACIAAAAbAAAAGQAAABkAAAAiAAAAGwAA",
  "ABkAAAAZAAAAIgAAABsAAAAZAAAAGQAAACIAAAAbAAAAGQAAABkAAAAiAAAAGwAAABkAAAAZAAAAIgAAABsAAAAZAAAAGQAAACIA",
  "AAAbAAAAGQAAABkAAAAiAAAAGwAAABkAAAAUc3RjbwAAAAAAAAABAAAGxAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAA",
  "AAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjIuMTIuMTAwAAAACGZyZWUA",
  "AAr2bWRhdAAAAq8GBf//q9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUct",
  "NCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRp",
  "b25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5",
  "X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAg",
  "ZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0yMiBsb29rYWhlYWRfdGhyZWFk",
  "cz0zIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWlu",
  "ZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVu",
  "X2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjQgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xv",
  "b2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlw",
  "X3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAACKZYiEADv//vdOvwKbVMIqA5JXCvbKpCZZuVJrAfKmAAADAAADAAADAAk76KQ+5z+I",
  "eZgAAAMAPkANUCoAx4RsHiDZB6BJBBA3wuw0QAAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAAAwAA",
  "AwAAAwAAAwAAAwAAAwH7AAAAGEGaJGxDv/6plgAAAwAAAwAAAwAAAwAErAAAABVBnkJ4hf8AAAMAAAMAAAMAAAMABZUAAAAVAZ5h",
  "dEK/AAADAAADAAADAAADAAd0AAAAFQGeY2pCvwAAAwAAAwAAAwAAAwAHdQAAAB5BmmhJqEFomUwId//+qZYAAAMAAAMAAAMAAAMA",
  "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",
].join("");
const FORMAT_NAME = "mov,mp4,m4a,3gp,3g2,mj2";
const mp4Bytes = Buffer.from(MP4_FIXTURE_BASE64, "base64");
const quicktimeBrandedBytes = Buffer.from(mp4Bytes);
quicktimeBrandedBytes.write("qt  ", 8, "ascii");

interface ProbeOverrides {
  readonly formatName?: string;
  readonly width?: number;
  readonly height?: number;
  readonly duration?: number;
  readonly codecName?: string;
  readonly colorTransfer?: string | null;
  readonly videoStreams?: number;
  readonly otherStreams?: number;
}

function probeOutput(overrides: ProbeOverrides = {}): string {
  const videoCount = overrides.videoStreams ?? 1;
  const streams: Record<string, unknown>[] = Array.from({ length: videoCount }, () => ({
    codec_type: "video",
    codec_name: overrides.codecName ?? "unknowncodec",
    width: overrides.width ?? 700,
    height: overrides.height ?? 700,
    start_time: "0.000000",
    duration: String(overrides.duration ?? 3),
    ...(overrides.colorTransfer === undefined ? {} : { color_transfer: overrides.colorTransfer })
  }));
  for (let i = 0; i < (overrides.otherStreams ?? 0); i += 1) {
    streams.push({ codec_type: "audio", codec_name: "unknownaudio", start_time: "0.000000", duration: String(overrides.duration ?? 3) });
  }
  return JSON.stringify({ streams, format: { format_name: overrides.formatName ?? FORMAT_NAME, duration: String(overrides.duration ?? 3) } });
}

async function makeFfprobe(output: string, options: { readonly delayMs?: number; readonly marker?: string } = {}): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-k4-omni-ffprobe-fixture-"));
  const interpreter = join(directory, "node");
  const path = join(directory, "ffprobe-fixture");
  await symlink(process.execPath, interpreter);
  const script = `#!/${interpreter}\nconst fs = require("node:fs");\nconst args = process.argv.slice(2);\n` +
    `const whitelist = args.indexOf("-protocol_whitelist");\nif (whitelist < 0 || args[whitelist + 1] !== "file,pipe") process.exit(31);\n` +
    `const mediaPath = args[args.length - 1];\nif (!fs.statSync(mediaPath).isFile()) process.exit(32);\n` +
    (options.marker ? `fs.writeFileSync(${JSON.stringify(options.marker)}, JSON.stringify({path:mediaPath,file_mode:fs.statSync(mediaPath).mode & 0o777,directory_mode:fs.statSync(require("node:path").dirname(mediaPath)).mode & 0o777}));\n` : "") +
    (options.delayMs ? `setTimeout(() => process.stdout.write(${JSON.stringify(output)}), ${options.delayMs});\n` :
      `process.stdout.write(${JSON.stringify(output)});\n`);
  await writeFile(path, script, { encoding: "utf8", mode: 0o700, flag: "wx" });
  await chmod(path, 0o700);
  return { directory, path };
}

function input(
  bytes: Uint8Array = mp4Bytes,
  overrides: Partial<{ filename: string; mime_type: string; maxFileBytes: number; ffprobePath: string }> = {},
  ffprobePath = FFPROBE
): Record<string, unknown> {
  return {
    filename: "source.mp4",
    mime_type: "video/mp4",
    bytes,
    ffprobePath,
    ...overrides
  };
}

async function expectPolicyError(
  request: unknown,
  code: OwnerKling4OmniVideoPolicyError["code"],
  signal?: AbortSignal
): Promise<void> {
  await assert.rejects(validateOwnerKling4OmniVideo(request, signal), (error: unknown) =>
    error instanceof OwnerKling4OmniVideoPolicyError && error.code === code);
}

test("accepts MP4 and QuickTime-branded metadata tuples without claiming pixel or codec support", async () => {
  const fixtures = [
    { bytes: mp4Bytes, filename: "source.mp4", mime_type: "video/mp4", output: probeOutput({ width: 700, height: 10_000, duration: 3 }) },
    { bytes: quicktimeBrandedBytes, filename: "source.mov", mime_type: "video/quicktime", output: probeOutput({ width: 10_000, height: 700, duration: 30 }) }
  ] as const;
  for (const item of fixtures) {
    const fake = await makeFfprobe(item.output);
    const callerBytes = Buffer.from(item.bytes);
    const before = Buffer.from(callerBytes);
    try {
      const receipt = await validateOwnerKling4OmniVideo(input(callerBytes, { filename: item.filename, mime_type: item.mime_type }, fake.path));
      assert.equal(isValidatedOwnerKling4OmniVideo(receipt), true);
      assert.equal(receipt.model_id, "kling_4_omni");
      assert.equal(receipt.source_catalog_version, OWNER_KLING4_OMNI_VIDEO_POLICY.public_catalog_version);
      assert.equal(receipt.metadata.width, item.filename.endsWith(".mp4") ? 700 : 10_000);
      assert.equal(receipt.metadata.height, item.filename.endsWith(".mp4") ? 10_000 : 700);
      assert.equal(receipt.metadata.duration_seconds, item.filename.endsWith(".mp4") ? 3 : 30);
      assert.equal(receipt.metadata.video_codec, "unknowncodec");
      assert.equal(receipt.metadata.color_transfer_status, "UNKNOWN_NOT_ESTABLISHED");
      assert.equal(receipt.metadata_confidence, "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED");
      assert.equal(receipt.generation_permit, false);
      assert.equal(receipt.owner_upload_binding, "NOT_ESTABLISHED");
      assert.deepEqual(callerBytes, before);
      const firstCopy = readValidatedOwnerKling4OmniVideo(receipt);
      assert.deepEqual(Buffer.from(firstCopy!), before);
      firstCopy!.fill(0);
      const secondCopy = readValidatedOwnerKling4OmniVideo(receipt);
      assert.deepEqual(Buffer.from(secondCopy!), before);
      assert.notEqual(firstCopy, secondCopy);
      secondCopy!.fill(0);
      assert.equal(releaseValidatedOwnerKling4OmniVideo(receipt), true);
      assert.equal(isValidatedOwnerKling4OmniVideo(receipt), false);
      assert.equal(readValidatedOwnerKling4OmniVideo(receipt), null);
      assert.equal(releaseValidatedOwnerKling4OmniVideo(receipt), false);
      assert.deepEqual(callerBytes, before);
    } finally { await rm(fake.directory, { recursive: true, force: true }); }
  }
});

test("accepts valid input with an explicit in-range local size override", async () => {
  const fake = await makeFfprobe(probeOutput());
  const sourceBytes = Buffer.from(mp4Bytes);
  try {
    const receipt = await validateOwnerKling4OmniVideo(input(sourceBytes, { maxFileBytes: 300 * 1024 * 1024 }, fake.path));
    assert.equal(receipt.local_file_limit_bytes, 300 * 1024 * 1024);
    releaseValidatedOwnerKling4OmniVideo(receipt);
  } finally { await rm(fake.directory, { recursive: true, force: true }); }
});

test("binds MP4 and QuickTime MIME claims to known video ftyp major brands", async () => {
  const fake = await makeFfprobe(probeOutput());
  const mislabeledMp4 = Buffer.from(mp4Bytes);
  mislabeledMp4.write("avif", 8, "ascii");
  const compatibleBrandsEnd = mislabeledMp4.readUInt32BE(0);
  for (let offset = 16; offset < compatibleBrandsEnd; offset += 4) mislabeledMp4.write("mif1", offset, "ascii");
  try {
    await expectPolicyError(input(mp4Bytes, { filename: "source.mov", mime_type: "video/quicktime" }, fake.path), "INVALID_INPUT");
    await expectPolicyError(input(mislabeledMp4, {}, fake.path), "INVALID_INPUT");
  } finally { await rm(fake.directory, { recursive: true, force: true }); }
});

test("probes only a private 0700 directory and 0600 temporary video file", async () => {
  const markerDirectory = await mkdtemp(join(tmpdir(), "syntx-k4-omni-mode-marker-"));
  const marker = join(markerDirectory, "probe.json");
  const fake = await makeFfprobe(probeOutput(), { marker });
  try {
    const receipt = await validateOwnerKling4OmniVideo(input(mp4Bytes, {}, fake.path));
    const observed = JSON.parse(await readFile(marker, "utf8")) as { path: string; file_mode: number; directory_mode: number };
    assert.equal(observed.file_mode, 0o600);
    assert.equal(observed.directory_mode, 0o700);
    releaseValidatedOwnerKling4OmniVideo(receipt);
  } finally {
    await rm(fake.directory, { recursive: true, force: true });
    await rm(markerDirectory, { recursive: true, force: true });
  }
});

test("rejects per-file duration and dimensions outside C19 bounds", async () => {
  const cases = [
    { width: 699 }, { height: 699 }, { width: 10_001 }, { height: 10_001 },
    { duration: 2.999 }, { duration: 30.001 }
  ];
  for (const override of cases) {
    const fake = await makeFfprobe(probeOutput(override));
    try { await expectPolicyError(input(mp4Bytes, {}, fake.path), "SOURCE_LIMIT_EXCEEDED"); }
    finally { await rm(fake.directory, { recursive: true, force: true }); }
  }
});

test("rejects known PQ and HLG metadata but reports missing transfer metadata as unknown", async () => {
  for (const transfer of ["smpte2084", "pq", "arib-std-b67", "hlg"]) {
    const fake = await makeFfprobe(probeOutput({ colorTransfer: transfer }));
    try { await expectPolicyError(input(mp4Bytes, {}, fake.path), "HDR_METADATA_REJECTED"); }
    finally { await rm(fake.directory, { recursive: true, force: true }); }
  }
  const otherTransfer = await makeFfprobe(probeOutput({ colorTransfer: "bt709" }));
  try {
    const receipt = await validateOwnerKling4OmniVideo(input(mp4Bytes, {}, otherTransfer.path));
    assert.equal(receipt.metadata.color_transfer_status, "REPORTED_NOT_KNOWN_HDR");
    assert.equal(receipt.metadata.color_transfer, "bt709");
    releaseValidatedOwnerKling4OmniVideo(receipt);
  } finally { await rm(otherTransfer.directory, { recursive: true, force: true }); }
  const unknownTransfer = await makeFfprobe(probeOutput({ colorTransfer: "unknown" }));
  try {
    const receipt = await validateOwnerKling4OmniVideo(input(mp4Bytes, {}, unknownTransfer.path));
    assert.equal(receipt.metadata.color_transfer_status, "UNKNOWN_NOT_ESTABLISHED");
    releaseValidatedOwnerKling4OmniVideo(receipt);
  } finally { await rm(unknownTransfer.directory, { recursive: true, force: true }); }
});

test("rejects MIME/extension mismatch, malformed BMFF, unsupported container and multiple video streams", async () => {
  const fake = await makeFfprobe(probeOutput());
  try {
    await expectPolicyError(input(mp4Bytes, { filename: "source.mov", mime_type: "video/mp4" }, fake.path), "INVALID_INPUT");
    const malformed = Buffer.from(mp4Bytes); malformed.fill(0, 4, 8);
    await expectPolicyError(input(malformed, {}, fake.path), "INVALID_INPUT");
  } finally { await rm(fake.directory, { recursive: true, force: true }); }
  for (const output of [probeOutput({ formatName: "matroska,webm" }), probeOutput({ videoStreams: 2 }), probeOutput({ otherStreams: 32 })]) {
    const bad = await makeFfprobe(output);
    try { await expectPolicyError(input(mp4Bytes, {}, bad.path), "UNSUPPORTED_MEDIA_METADATA"); }
    finally { await rm(bad.directory, { recursive: true, force: true }); }
  }
});

test("enforces a bounded local size and validates the trusted operator executable before spawning", async () => {
  const fake = await makeFfprobe(probeOutput());
  try {
    await expectPolicyError(input(mp4Bytes, { maxFileBytes: 1 }, fake.path), "LOCAL_RESOURCE_LIMIT_EXCEEDED");
    await expectPolicyError(input(mp4Bytes, { maxFileBytes: 300 * 1024 * 1024 + 1 }, fake.path), "INVALID_INPUT");
    await expectPolicyError(input(mp4Bytes, { ffprobePath: "relative/ffprobe" }), "INVALID_INPUT");
  } finally { await rm(fake.directory, { recursive: true, force: true }); }
});

test("rejects accessors, proxies and SharedArrayBuffer views without invoking getters", async () => {
  const fake = await makeFfprobe(probeOutput());
  let touched = false;
  const withGetter = { filename: "source.mp4", mime_type: "video/mp4", bytes: mp4Bytes, ffprobePath: fake.path,
    get maxFileBytes() { touched = true; return 1024; } };
  try {
    await expectPolicyError(withGetter, "INVALID_INPUT");
    assert.equal(touched, false);
    await expectPolicyError(new Proxy(input(mp4Bytes, {}, fake.path), {}), "INVALID_INPUT");
    await expectPolicyError(input(new Proxy(mp4Bytes, {}), {}, fake.path), "INVALID_INPUT");
    const shared = new Uint8Array(new SharedArrayBuffer(mp4Bytes.byteLength)); shared.set(mp4Bytes);
    await expectPolicyError(input(shared, {}, fake.path), "INVALID_INPUT");
  } finally { await rm(fake.directory, { recursive: true, force: true }); }
});

test("aborts the active probe, awaits temp-file cleanup, and rejects a concurrent probe", async () => {
  const markerDirectory = await mkdtemp(join(tmpdir(), "syntx-k4-omni-abort-marker-"));
  const marker = join(markerDirectory, "input-path.txt");
  const slow = await makeFfprobe(probeOutput(), { delayMs: 30_000, marker });
  const good = await makeFfprobe(probeOutput());
  const controller = new AbortController();
  const pending = validateOwnerKling4OmniVideo(input(mp4Bytes, {}, slow.path), controller.signal);
  try {
    for (let count = 0; count < 100 && !existsSync(marker); count += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(existsSync(marker), true);
    await expectPolicyError(input(mp4Bytes, {}, good.path), "LOCAL_RESOURCE_BUSY");
    const markerData = JSON.parse(await readFile(marker, "utf8")) as { path: string };
    const mediaPath = markerData.path;
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof OwnerKling4OmniVideoPolicyError && error.code === "PROBE_ABORTED");
    await assert.rejects(readFile(mediaPath), (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT");
    const receipt = await validateOwnerKling4OmniVideo(input(mp4Bytes, {}, good.path));
    releaseValidatedOwnerKling4OmniVideo(receipt);
  } finally {
    controller.abort();
    await rm(slow.directory, { recursive: true, force: true });
    await rm(good.directory, { recursive: true, force: true });
    await rm(markerDirectory, { recursive: true, force: true });
  }
});

test("real ffprobe accepts one synthetic MP4 without claiming decoded pixels", async (t) => {
  if (!existsSync(FFPROBE)) { t.skip("optional local ffprobe binary is unavailable"); return; }
  const receipt = await validateOwnerKling4OmniVideo(input(mp4Bytes, {}, FFPROBE));
  assert.equal(receipt.metadata.width, 700);
  assert.equal(receipt.metadata.height, 700);
  assert.ok(receipt.metadata.duration_seconds >= 3 && receipt.metadata.duration_seconds <= 30);
  assert.equal(receipt.metadata_confidence, "TRUSTED_FFPROBE_METADATA_NOT_PIXEL_DECODED");
  releaseValidatedOwnerKling4OmniVideo(receipt);
});
