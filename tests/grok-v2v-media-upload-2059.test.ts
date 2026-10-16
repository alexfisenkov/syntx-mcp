import assert from "node:assert/strict";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  isOwnerFlux3V2vOriginalProbe,
  probeOwnerFlux3V2vOriginal,
  releaseOwnerFlux3V2vOriginalProbe
} from "../src/application/owner-flux3-v2v-original-probe.js";
import {
  isOwnerGrokV2vOriginalProbe,
  probeOwnerGrokV2vOriginal,
  readOwnerGrokV2vOriginalProbeBytes,
  releaseOwnerGrokV2vOriginalProbe
} from "../src/application/owner-grok-v2v-original-probe.js";
import {
  createOwnerGrokV2vUploadContext,
  parseOwnerGrokV2vUploadReceipt,
  validateOwnerGrokV2vOriginalForUpload,
  type OwnerGrokV2vUploadDestination
} from "../src/adapter/syntx/grok-v2v-media-upload.js";

const SOURCE_URL = "https://r2.syntx.ai/grok-v2v/uploaded/source.mp4";

function mediaBytes(brand: "isom" | "qt  " = "isom"): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftyp"), 4);
  bytes.set(new TextEncoder().encode(brand), 8);
  view.setUint32(12, 0);
  bytes.set(new TextEncoder().encode(brand), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

function ffprobeOutput(duration = "4.6", formatName = "mov,mp4,m4a,3gp,3g2,mj2"): string {
  return JSON.stringify({ streams: [{ codec_type: "video", codec_name: "h264", width: 854, height: 480,
    duration, disposition: { attached_pic: 0 } }], format: { format_name: formatName, duration } });
}

async function executableProbe(output: string): Promise<{ binary: string; directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-grok-v2v-upload-2059-"));
  const binary = join(directory, "ffprobe-fixture");
  const source = `#!${process.execPath}\nconst args=process.argv.slice(2);const input=args.at(-1);\n` +
    `if(!input||!require("node:fs").statSync(input).isFile())process.exit(40);\n` +
    `const entries=args.indexOf("-show_entries");if(entries<0||!args[entries+1].includes("stream_disposition=attached_pic"))process.exit(41);\n` +
    `process.stdout.write(${JSON.stringify(output)});\n`;
  await writeFile(binary, source, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { binary: await realpath(binary), directory };
}

async function makeGenuineProbe(options: { quicktime?: boolean; duration?: string } = {}) {
  const quicktime = options.quicktime === true;
  const duration = options.duration ?? "4.6";
  const fixture = await executableProbe(ffprobeOutput(duration));
  try {
    const bytes = mediaBytes(quicktime ? "qt  " : "isom");
    const probe = await probeOwnerGrokV2vOriginal({ model_id: "grok_v2v",
      filename: quicktime ? "source.mov" : "source.mp4", mime_type: quicktime ? "video/quicktime" : "video/mp4",
      bytes, ffprobePath: fixture.binary });
    return { probe, bytes, fixture };
  } catch (error) {
    await rm(fixture.directory, { recursive: true, force: true });
    throw error;
  }
}

function validReceipt(expected: { filename: string; mime_type: string; size: number; sha256: string; duration: number }) {
  return { files: [{ url: SOURCE_URL, filename: expected.filename, status: "success", size: expected.size,
    mime_type: expected.mime_type, content_type: expected.mime_type, sha256: expected.sha256,
    duration: expected.duration }] };
}

test("validates a genuine Grok V2V probe, rehashes copied bytes, and returns a URL-free frozen context", {
  skip: process.platform === "win32" ? "POSIX fake-ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const { probe, bytes, fixture } = await makeGenuineProbe();
  try {
    assert.equal(isOwnerGrokV2vOriginalProbe(probe), true);
    const validated = validateOwnerGrokV2vOriginalForUpload(probe);
    assert.equal(validated.model_id, "grok_v2v");
    assert.equal(validated.filename, "source.mp4");
    assert.equal(validated.mime_type, "video/mp4");
    assert.equal(validated.size, 28);
    assert.equal(validated.sha256, probe.source_sha256);
    assert.deepEqual(validated.bytes, bytes);
    assert.equal(validated.context_fields.metadata.video.duration_seconds, 4.6);
    assert.notEqual(validated.bytes, bytes);
    assert.deepEqual(readOwnerGrokV2vOriginalProbeBytes(probe), bytes);

    const parsed = parseOwnerGrokV2vUploadReceipt(validReceipt({ filename: validated.filename,
      mime_type: validated.mime_type, size: validated.size, sha256: validated.sha256, duration: 4.6 }), validated);
    assert.deepEqual(parsed, { url: SOURCE_URL });
    const destination: OwnerGrokV2vUploadDestination = "hidden";
    const context = createOwnerGrokV2vUploadContext(validated, destination);
    assert.equal(context.status, "OWNER_GROK_V2V_ORIGINAL_UPLOADED");
    assert.equal(context.model_id, "grok_v2v");
    assert.equal(context.ai_name, "grok_video");
    assert.equal(context.destination, destination);
    assert.equal(context.size, bytes.byteLength);
    assert.equal(context.sha256, validated.sha256);
    assert.deepEqual(context.metadata, validated.context_fields.metadata);
    assert.equal("url" in context, false);
    assert.equal(JSON.stringify(context).includes(SOURCE_URL), false);
    assert.equal(Object.isFrozen(context), true);
    validated.bytes.fill(0);
  } finally {
    releaseOwnerGrokV2vOriginalProbe(probe);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("preserves matching QuickTime MIME and filename without expanding the model's allowed input types", {
  skip: process.platform === "win32" ? "POSIX fake-ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const { probe, bytes, fixture } = await makeGenuineProbe({ quicktime: true });
  try {
    const validated = validateOwnerGrokV2vOriginalForUpload(probe);
    assert.equal(validated.filename, "source.mov");
    assert.equal(validated.mime_type, "video/quicktime");
    assert.equal(validated.size, bytes.byteLength);
    assert.equal(validated.context_fields.metadata.container, "QUICKTIME_MOV");
    validated.bytes.fill(0);
  } finally {
    releaseOwnerGrokV2vOriginalProbe(probe);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects forged, accessor-backed, proxy, and wrong-model probes before reading attacker properties", {
  skip: process.platform === "win32" ? "POSIX fake-ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, "model_id", { get() { reads += 1; return "grok_v2v"; } });
  const flux = await (async () => {
    const fixture = await executableProbe(ffprobeOutput());
    try { return { probe: await probeOwnerFlux3V2vOriginal({ model_id: "flux3_v2v", filename: "source.mp4",
      mime_type: "video/mp4", bytes: mediaBytes(), ffprobePath: fixture.binary }), fixture }; }
    catch (error) { await rm(fixture.directory, { recursive: true, force: true }); throw error; }
  })();
  try {
    assert.throws(() => validateOwnerGrokV2vOriginalForUpload({ ...flux.probe }), /GROK_V2V_PROBE_UNTRUSTED/u);
    assert.throws(() => validateOwnerGrokV2vOriginalForUpload(new Proxy({}, {})), /GROK_V2V_PROBE_UNTRUSTED/u);
    assert.throws(() => validateOwnerGrokV2vOriginalForUpload(accessor), /GROK_V2V_PROBE_UNTRUSTED/u);
    assert.equal(reads, 0);
    assert.equal(isOwnerFlux3V2vOriginalProbe(flux.probe), true);
  } finally {
    releaseOwnerFlux3V2vOriginalProbe(flux.probe);
    await rm(flux.fixture.directory, { recursive: true, force: true });
  }
});

test("rejects receipt URL, shape, and optional source-echo mismatches", {
  skip: process.platform === "win32" ? "POSIX fake-ffprobe fixture; Windows probe path NOT_RUN" : false
}, async () => {
  const { probe, fixture } = await makeGenuineProbe();
  try {
    const baseline = validateOwnerGrokV2vOriginalForUpload(probe);
    const valid = validReceipt({ filename: baseline.filename, mime_type: baseline.mime_type, size: baseline.size,
      sha256: baseline.sha256, duration: baseline.context_fields.metadata.duration_seconds });
    baseline.bytes.fill(0);
    const invalidReceipts: unknown[] = [
      { files: [] },
      { files: [valid.files[0], valid.files[0]] },
      ...[
      { ...valid.files[0], url: "https://example.invalid/source.mp4" },
      { ...valid.files[0], sha256: "0".repeat(64) },
      { ...valid.files[0], duration: 8.7 },
      { ...valid.files[0], content_type: "video/quicktime" },
      { ...valid.files[0], status: "pending" },
        { ...valid.files[0], size: baseline.size + 1 }
      ].map((file) => ({ files: [file] }))
    ];
    for (const raw of invalidReceipts) {
      const expected = validateOwnerGrokV2vOriginalForUpload(probe);
      assert.throws(() => parseOwnerGrokV2vUploadReceipt(raw, expected), /GROK_V2V_UPLOAD_RECEIPT_INVALID/u);
      assert.ok(expected.bytes.every((value) => value === 0), "receipt failure must zero its copied source bytes");
    }

    let getterReads = 0;
    const file = Object.defineProperty({}, "url", { get() { getterReads += 1; return SOURCE_URL; } });
    const getterExpected = validateOwnerGrokV2vOriginalForUpload(probe);
    assert.throws(() => parseOwnerGrokV2vUploadReceipt({ files: [file] }, getterExpected), /GROK_V2V_UPLOAD_RECEIPT_INVALID/u);
    assert.equal(getterReads, 0);
    assert.ok(getterExpected.bytes.every((value) => value === 0));

    const tampered = validateOwnerGrokV2vOriginalForUpload(probe);
    tampered.bytes[0] = (tampered.bytes[0] ?? 0) ^ 0xff;
    assert.throws(() => createOwnerGrokV2vUploadContext(tampered, "uploaded"), /GROK_V2V_PROBE_INVALID/u);
    assert.ok(tampered.bytes.every((value) => value === 0));
  } finally {
    releaseOwnerGrokV2vOriginalProbe(probe);
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
