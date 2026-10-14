import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  copyTrustedOwnerElevenLabsStsOriginalBytes,
  createOwnerElevenLabsStsOriginalProbe,
  isTrustedOwnerElevenLabsStsOriginalProbeResult,
  OwnerElevenLabsStsOriginalProbeError,
  releaseTrustedOwnerElevenLabsStsOriginalProbeResult
} from "../src/application/owner-elevenlabs-sts-original-probe.js";

const GOOD_AUDIO = JSON.stringify({
  streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "24000", channels: 1,
    nb_read_frames: "432", duration: "11.060000" }],
  format: { format_name: "mp3", duration: "11.060000" }
});

async function fakeFfprobe(output: string): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-eleven-sts-probe-test-"));
  const binary = join(directory, "ffprobe-fixture");
  const quoted = output.replaceAll("'", "'\\''");
  await writeFile(binary, `#!/bin/sh\n[ "$1" = "-v" ] && [ "$2" = "error" ] || exit 31\nprintf '%s' '${quoted}'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary };
}

function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { filename: "source.mp3", mime_type: "audio/mpeg", bytes: Uint8Array.from({ length: 64 }, (_, i) => i), ...overrides };
}

test("trusted STS probe seals actual bytes, bare semantic SHA and ffprobe-measured audio duration", async () => {
  const fixture = await fakeFfprobe(GOOD_AUDIO);
  try {
    const result = await createOwnerElevenLabsStsOriginalProbe({ ffprobePath: fixture.binary }).probe(input());
    assert.equal(isTrustedOwnerElevenLabsStsOriginalProbeResult(result), true);
    assert.match(result.source_sha256, /^[a-f0-9]{64}$/);
    assert.equal(result.bytes_copied, 64);
    assert.deepEqual(result.metadata, {
      container: "MP3", codec_name: "mp3", sample_rate: 24_000, channels: 1,
      duration_seconds: 11.06, decoded_frame_count: 432
    });
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.runtime_usable, false);
    assert.equal("path" in result, false);
    assert.equal("stderr" in result, false);
    const copy = copyTrustedOwnerElevenLabsStsOriginalBytes(result);
    copy[0] = 255;
    assert.equal(copyTrustedOwnerElevenLabsStsOriginalBytes(result)[0], 0);
    releaseTrustedOwnerElevenLabsStsOriginalProbeResult(result);
    assert.equal(isTrustedOwnerElevenLabsStsOriginalProbeResult(result), false);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("STS probe enforces measured 5..300 second duration and 50 MiB bytes before copying", async () => {
  const fixture = await fakeFfprobe(GOOD_AUDIO);
  try {
    const probe = createOwnerElevenLabsStsOriginalProbe({ ffprobePath: fixture.binary });
    const oversized = new Uint8Array(50 * 1024 * 1024 + 1);
    Object.defineProperty(oversized, "slice", { value: () => { throw new Error("copy must not run"); } });
    await assert.rejects(probe.probe(input({ bytes: oversized })), (error: unknown) =>
      error instanceof OwnerElevenLabsStsOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");

    for (const seconds of ["4.999", "300.001"]) {
      const invalidDuration = await fakeFfprobe(JSON.stringify({
        streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "24000", channels: 1,
          nb_read_frames: "100", duration: seconds }],
        format: { format_name: "mp3", duration: seconds }
      }));
      try {
        await assert.rejects(createOwnerElevenLabsStsOriginalProbe({ ffprobePath: invalidDuration.binary }).probe(input()),
          (error: unknown) => error instanceof OwnerElevenLabsStsOriginalProbeError && error.code === "ORIGINAL_LOCAL_LIMIT_EXCEEDED");
      } finally {
        await rm(invalidDuration.directory, { recursive: true, force: true });
      }
    }
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("aborted STS probe drains the child before removing its private input file", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "syntx-eleven-sts-close-test-"));
  try {
    const marker = join(fixture, "input-presence-at-close");
    const started = join(fixture, "child-started");
    const binary = join(fixture, "ffprobe-close-fixture");
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const childCode = `const fs=require("node:fs");const input=process.argv.at(-1);fs.writeFileSync(${JSON.stringify(started)},"started");process.on("SIGTERM",()=>setTimeout(()=>{fs.writeFileSync(${JSON.stringify(marker)},fs.existsSync(input)?"present":"absent");process.exit(0)},200));setInterval(()=>{},10000)`;
    await writeFile(binary, `#!/bin/sh\nexec ${quote(process.execPath)} -e ${quote(childCode)} -- "$@"\n`, { mode: 0o700, flag: "wx" });
    await chmod(binary, 0o700);
    const controller = new AbortController();
    const pending = createOwnerElevenLabsStsOriginalProbe({ ffprobePath: binary }).probe(input(), { signal: controller.signal });
    let childStarted = false;
    for (let attempt = 0; attempt < 50 && !childStarted; attempt += 1) {
      try { childStarted = (await readFile(started, "utf8")) === "started"; }
      catch { await new Promise((resolve) => setTimeout(resolve, 20)); }
    }
    assert.equal(childStarted, true);
    controller.abort();
    await assert.rejects(pending, (error: unknown) =>
      error instanceof OwnerElevenLabsStsOriginalProbeError && error.code === "PROBE_ABORTED");
    assert.equal(await readFile(marker, "utf8"), "present");
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
