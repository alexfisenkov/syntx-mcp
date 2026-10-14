import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  copyTrustedOwnerWan27R2vOriginalBytes,
  createOwnerWan27R2vOriginalProbe,
  isTrustedOwnerWan27R2vOriginalProbeResult,
  OwnerWan27R2vOriginalProbeError,
  releaseTrustedOwnerWan27R2vOriginalProbeResult,
  WAN27R2V_ORIGINAL_VIDEO_POLICY
} from "../src/application/owner-wan27-r2v-original-probe.js";

const GOOD_VIDEO = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001", r_frame_rate: "30/1", nb_read_frames: "301", duration: "10.043367" },
    { codec_type: "audio", codec_name: "aac" }
  ], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "10.043367" }
});

async function fixture(output: string): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-r2v-test-"));
  const binary = join(directory, "ffprobe-fixture");
  const quoted = output.replaceAll("'", "'\\''");
  await writeFile(binary, `#!/bin/sh\n[ "$1" = "-v" ] && [ "$2" = "error" ] || exit 31\nfor last do :; done\n[ -s "$last" ] || exit 32\nprintf '%s' '${quoted}'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary };
}

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const bytes = new Uint8Array(64);
  bytes.set([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
  return { filename: "source.mp4", mime_type: "video/mp4", bytes, ...overrides };
}

test("WAN27 R2V probe seals local ffprobe metadata and retains only a genuine copy seam", async () => {
  const f = await fixture(GOOD_VIDEO);
  const request = input();
  const original = Uint8Array.from(request.bytes as Uint8Array);
  try {
    const result = await createOwnerWan27R2vOriginalProbe({ ffprobePath: f.binary }).probe(request);
    assert.equal(isTrustedOwnerWan27R2vOriginalProbeResult(result), true);
    assert.equal(result.model_id, "wan_27_r2v");
    assert.equal(result.source_policy_id, WAN27R2V_ORIGINAL_VIDEO_POLICY.policy_id);
    assert.equal(Object.isFrozen(WAN27R2V_ORIGINAL_VIDEO_POLICY), true);
    assert.equal(Object.isFrozen(WAN27R2V_ORIGINAL_VIDEO_POLICY.limits), true);
    assert.deepEqual(WAN27R2V_ORIGINAL_VIDEO_POLICY, {
      policy_id: "OWNER_WAN27_R2V_ORIGINAL_VIDEO_POLICY_B066_LOCAL_GUARD_V1",
      public_catalog_version: "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
      model_id: "wan_27_r2v",
      limits: { max_file_size_bytes: 104_857_600, min_side: 240, max_side: 8_000, min_duration_seconds: 1, max_duration_seconds: 30 },
      kind: "CATALOG_METADATA_PLUS_LOCAL_RESOURCE_GUARD_NOT_PROVIDER_PROOF", selection_crop: "NOT_PERFORMED"
    });
    assert.match(result.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.bytes_copied, 64);
    assert.deepEqual(result.metadata, {
      container: "ISO_BMFF_MOV_MP4", codec_streams: [{ type: "video", codec_name: "h264" }, { type: "audio", codec_name: "aac" }],
      width: 1920, height: 1080, duration_seconds: 10.043367, frame_rate: { numerator: 30000, denominator: 1001 }, decoded_frame_count: 301
    });
    assert.equal(result.generation_permit, false);
    assert.equal(result.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal(result.selection_crop, "NOT_PERFORMED");
    assert.deepEqual(request.bytes, original);
    const copy = copyTrustedOwnerWan27R2vOriginalBytes(result);
    copy.fill(0);
    assert.equal(copyTrustedOwnerWan27R2vOriginalBytes(result)[0], original[0]);
    const forged = { ...result };
    assert.equal(isTrustedOwnerWan27R2vOriginalProbeResult(forged), false);
    assert.throws(() => copyTrustedOwnerWan27R2vOriginalBytes(forged), OwnerWan27R2vOriginalProbeError);
    releaseTrustedOwnerWan27R2vOriginalProbeResult(result);
    assert.equal(isTrustedOwnerWan27R2vOriginalProbeResult(result), false);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("local input size and measured source duration/dimensions enforce B066 limits", async () => {
  const f = await fixture(GOOD_VIDEO);
  try {
    const oversized = new Uint8Array(100 * 1024 * 1024 + 1);
    Object.defineProperty(oversized, "slice", { value: () => { throw new Error("must reject before copying"); } });
    await assert.rejects(createOwnerWan27R2vOriginalProbe({ ffprobePath: f.binary }).probe(input({ bytes: oversized })),
      (error: unknown) => error instanceof OwnerWan27R2vOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    for (const bad of [
      GOOD_VIDEO.replace('"duration":"10.043367"', '"duration":"0.999"'),
      GOOD_VIDEO.replace('"duration":"10.043367"', '"duration":"30.001"'),
      GOOD_VIDEO.replace('"width":1920', '"width":239'),
      GOOD_VIDEO.replace('"height":1080', '"height":8001')
    ]) {
      const badFixture = await fixture(bad);
      try { await assert.rejects(createOwnerWan27R2vOriginalProbe({ ffprobePath: badFixture.binary }).probe(input()), OwnerWan27R2vOriginalProbeError); }
      finally { await rm(badFixture.directory, { recursive: true, force: true }); }
    }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("accepts QuickTime only when the filename, MIME and BMFF brand agree", async () => {
  const f = await fixture(GOOD_VIDEO);
  const request = input({ filename: "source.mov", mime_type: "video/quicktime" });
  const bytes = request.bytes as Uint8Array;
  bytes.set([0x71, 0x74, 0x20, 0x20], 8);
  bytes.set([0x71, 0x74, 0x20, 0x20], 16);
  try {
    const result = await createOwnerWan27R2vOriginalProbe({ ffprobePath: f.binary }).probe(request);
    assert.equal(result.mime_type, "video/quicktime");
    assert.equal(result.metadata.frame_rate.numerator, 30_000);
    releaseTrustedOwnerWan27R2vOriginalProbeResult(result);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("rejects forged metadata, non-BMFF structure, MIME/brand mismatch, and invalid fps/frame counts", async () => {
  const invalidProbe = [
    GOOD_VIDEO.replace('"format_name":"mov,mp4,m4a,3gp,3g2,mj2"', '"format_name":"matroska,webm"'),
    GOOD_VIDEO.replace('"avg_frame_rate":"30000/1001"', '"avg_frame_rate":"0/0"').replace('"r_frame_rate":"30/1"', '"r_frame_rate":"0/0"'),
    GOOD_VIDEO.replace('"nb_read_frames":"301"', '"nb_read_frames":"0"'),
    GOOD_VIDEO.replace('"codec_type":"video"', '"codec_type":"audio"')
  ];
  for (const output of invalidProbe) {
    const f = await fixture(output);
    try { await assert.rejects(createOwnerWan27R2vOriginalProbe({ ffprobePath: f.binary }).probe(input()), OwnerWan27R2vOriginalProbeError); }
    finally { await rm(f.directory, { recursive: true, force: true }); }
  }
  const f = await fixture(GOOD_VIDEO);
  try {
    for (const extra of [{ path: "/tmp/source.mp4" }, { url: "https://example.invalid/source.mp4" },
      { duration_seconds: 10 }, { source_sha256: "0".repeat(64) }, { metadata: { width: 1920 } }]) {
      await assert.rejects(createOwnerWan27R2vOriginalProbe({ ffprobePath: f.binary }).probe(input(extra)), OwnerWan27R2vOriginalProbeError);
    }
    const badStructure = input();
    (badStructure.bytes as Uint8Array)[4] = 0;
    await assert.rejects(createOwnerWan27R2vOriginalProbe({ ffprobePath: f.binary }).probe(badStructure), OwnerWan27R2vOriginalProbeError);
    const mismatch = input({ filename: "source.mov", mime_type: "video/quicktime" });
    await assert.rejects(createOwnerWan27R2vOriginalProbe({ ffprobePath: f.binary }).probe(mismatch), OwnerWan27R2vOriginalProbeError);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test("aborted ffprobe is drained, temporary source is wiped/removed, and caller bytes are unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan27-r2v-abort-"));
  try {
    const marker = join(directory, "input-path"), started = join(directory, "started"), binary = join(directory, "slow-ffprobe");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const code = `const fs=require("node:fs");const p=process.argv.at(-1);fs.writeFileSync(${JSON.stringify(marker)},p);fs.writeFileSync(${JSON.stringify(started)},"yes");setInterval(()=>{},10000)`;
    await writeFile(binary, `#!/bin/sh\nexec ${quote(process.execPath)} -e ${quote(code)} -- "$@"\n`, { mode: 0o700, flag: "wx" });
    await chmod(binary, 0o700);
    const request = input(), before = Uint8Array.from(request.bytes as Uint8Array), controller = new AbortController();
    const pending = createOwnerWan27R2vOriginalProbe({ ffprobePath: binary }).probe(request, { signal: controller.signal });
    let launched = false;
    for (let i = 0; i < 100 && !launched; i += 1) {
      try { launched = (await readFile(started, "utf8")) === "yes"; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.equal(launched, true);
    const sourcePath = await readFile(marker, "utf8");
    const sourceDirectory = dirname(sourcePath);
    controller.abort();
    await assert.rejects(pending, (error: unknown) => error instanceof OwnerWan27R2vOriginalProbeError && error.code === "PROBE_ABORTED");
    await assert.rejects(stat(sourcePath), { code: "ENOENT" });
    await assert.rejects(stat(sourceDirectory), { code: "ENOENT" });
    assert.deepEqual(request.bytes, before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
