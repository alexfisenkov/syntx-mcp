import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyTrustedOwnerTopazAstraOriginalBytes,
  createOwnerTopazAstraOriginalProbe,
  isTrustedOwnerTopazAstraOriginalProbeResult,
  OwnerTopazAstraOriginalProbeError,
  releaseTrustedOwnerTopazAstraOriginalProbeResult
} from "../src/application/owner-topaz-astra-original-probe.js";

const GOOD_PROBE = JSON.stringify({
  streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, nb_read_frames: "72", duration: "3.000000" }],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "3.000000" }
});

async function fakeFfprobe(output: string): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-probe-test-"));
  const binary = join(directory, "ffprobe-fixture");
  const script = `#!/bin/sh\n[ "$1" = "-v" ] && [ "$2" = "error" ] || exit 31\nprintf '%s' '${output.replaceAll("'", "'\\''")}'\n`;
  await writeFile(binary, script, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary };
}

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4", bytes: Uint8Array.from({ length: 64 }, (_, i) => i), ...overrides };
}

test("trusted Topaz probe returns a sealed evidence DTO and private byte-copy seam", async () => {
  const fixture = await fakeFfprobe(GOOD_PROBE);
  try {
    const source = input();
    const result = await createOwnerTopazAstraOriginalProbe({ ffprobePath: fixture.binary }).probe(source);
    assert.equal(isTrustedOwnerTopazAstraOriginalProbeResult(result), true);
    assert.match(result.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.bytes_copied, 64);
    assert.deepEqual(result.metadata, {
      container: "ISO_BMFF_MOV_MP4", codec_name: "h264", width: 640, height: 360,
      duration_seconds: 3, decoded_frame_count: 72
    });
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal("path" in result, false);
    assert.equal("stderr" in result, false);
    const copy = copyTrustedOwnerTopazAstraOriginalBytes(result);
    assert.equal(copy[0], 0);
    copy[0] = 255;
    assert.equal(copyTrustedOwnerTopazAstraOriginalBytes(result)[0], 0);
    assert.equal(isTrustedOwnerTopazAstraOriginalProbeResult(new Proxy(result, {})), false);
    releaseTrustedOwnerTopazAstraOriginalProbeResult(result);
    assert.equal(isTrustedOwnerTopazAstraOriginalProbeResult(result), false);
    assert.throws(() => copyTrustedOwnerTopazAstraOriginalBytes(result), OwnerTopazAstraOriginalProbeError);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("intrinsic byte length rejects oversize and detached inputs before attempting a copy", async () => {
  const fixture = await fakeFfprobe(GOOD_PROBE);
  try {
    const probe = createOwnerTopazAstraOriginalProbe({ ffprobePath: fixture.binary });
    const oversized = new Uint8Array(52_428_801);
    Object.defineProperty(oversized, "byteLength", { value: 64 });
    Object.defineProperty(oversized, "slice", { value: () => { throw new Error("copy must not run"); } });
    await assert.rejects(probe.probe(input({ bytes: oversized })), (error: unknown) =>
      error instanceof OwnerTopazAstraOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");

    const detached = new Uint8Array(32);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    await assert.rejects(probe.probe(input({ bytes: detached })), (error: unknown) =>
      error instanceof OwnerTopazAstraOriginalProbeError && error.code === "INVALID_ORIGINAL");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("abort waits for child close before the probe removes its private input", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "syntx-topaz-close-test-"));
  try {
    const marker = join(fixture, "input-presence-at-close");
    const started = join(fixture, "child-started");
    const binary = join(fixture, "ffprobe-close-fixture");
    const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const parentCode = `const fs=require("node:fs");const input=process.argv.at(-1);fs.writeFileSync(${JSON.stringify(started)},"started");process.on("SIGTERM",()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(marker)},fs.existsSync(input)?"present":"absent");process.exit(0)},350));setInterval(()=>{},10000)`;
    const script = `#!/bin/sh\nexec ${shellQuote(process.execPath)} -e ${shellQuote(parentCode)} -- "$@"\n`;
    await writeFile(binary, script, { mode: 0o700, flag: "wx" });
    await chmod(binary, 0o700);
    const controller = new AbortController();
    const pending = createOwnerTopazAstraOriginalProbe({ ffprobePath: binary }).probe(input(), { signal: controller.signal });
    let childStarted = false;
    for (let attempt = 0; attempt < 50 && !childStarted; attempt += 1) {
      try { childStarted = (await readFile(started, "utf8")) === "started"; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.equal(childStarted, true);
    controller.abort();
    await assert.rejects(pending,
      (error: unknown) => error instanceof OwnerTopazAstraOriginalProbeError && error.code === "PROBE_ABORTED");
    assert.equal(await readFile(marker, "utf8"), "present");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

test("probe input is closed and applies pinned size, MIME, extension, and measured limits", async () => {
  const fixture = await fakeFfprobe(GOOD_PROBE);
  try {
    const probe = createOwnerTopazAstraOriginalProbe({ ffprobePath: fixture.binary });
    await assert.rejects(probe.probe(input({ extra: true })), OwnerTopazAstraOriginalProbeError);
    await assert.rejects(probe.probe(input({ filename: "source.mov" })), (error: unknown) =>
      error instanceof OwnerTopazAstraOriginalProbeError && error.code === "INVALID_ORIGINAL");
    await assert.rejects(probe.probe(input({ bytes: new Uint8Array(52_428_801) })), (error: unknown) =>
      error instanceof OwnerTopazAstraOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");

    const overLimit = await fakeFfprobe(JSON.stringify({
      streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, nb_read_frames: "451", duration: "25.1" }],
      format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "25.1" }
    }));
    try {
      await assert.rejects(createOwnerTopazAstraOriginalProbe({ ffprobePath: overLimit.binary }).probe(input()), (error: unknown) =>
        error instanceof OwnerTopazAstraOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
    } finally {
      await rm(overLimit.directory, { recursive: true, force: true });
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("malformed or non-video ffprobe output fails closed without exposing diagnostics", async () => {
  const fixture = await fakeFfprobe(JSON.stringify({
    streams: [{ codec_type: "audio", codec_name: "aac", width: 640, height: 360, nb_read_frames: "1", duration: "1" }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "1" }
  }));
  try {
    await assert.rejects(createOwnerTopazAstraOriginalProbe({ ffprobePath: fixture.binary }).probe(input()), (error: unknown) => {
      assert.ok(error instanceof OwnerTopazAstraOriginalProbeError);
      assert.equal(error.code, "INVALID_ORIGINAL");
      assert.equal(error.message.includes(fixture.directory), false);
      assert.equal("stderr" in error, false);
      return true;
    });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
