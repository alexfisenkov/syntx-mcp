import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, readFile, realpath, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import test from "node:test";
import {
  consumeOwnerVeoOmniValidatedReference,
  isOwnerVeoOmniValidatedReference,
  OwnerVeoOmniReferenceInputError,
  releaseOwnerVeoOmniValidatedReference,
  validateOwnerVeoOmniReferenceInput
} from "../src/application/owner-veo-omni-reference-input-validator.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const AVIF_16X16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");

function videoBytes(brand: "isom" | "mp41" | "qt  " = "isom"): Uint8Array {
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

function ffprobeOutput(duration: string, options: { readonly streams?: unknown[]; readonly formatName?: string; readonly containerDuration?: string } = {}): string {
  return JSON.stringify({
    streams: options.streams ?? [{ codec_type: "video", codec_name: "h264", width: 640, height: 360, duration,
      disposition: { attached_pic: 0 } }],
    format: { format_name: options.formatName ?? "mov,mp4,m4a,3gp,3g2,mj2", duration: options.containerDuration ?? duration }
  });
}

async function fakeFfprobe(output: string, marker: string, delayMs = 0, exitCode = 0): Promise<{ readonly binary: string; readonly directory: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-veo-omni-reference-2103-"));
  const binary = join(directory, "ffprobe-fixture");
  const script = `#!${process.execPath}\nconst fs=require("node:fs");const args=process.argv.slice(2);const input=args.at(-1);if(!input||!fs.statSync(input).isFile())process.exit(41);const w=args.indexOf("-protocol_whitelist");if(w<0||args[w+1]!=="file")process.exit(42);fs.writeFileSync(${JSON.stringify(marker)},input);const emit=()=>{process.stdout.write(${JSON.stringify(output)});process.exit(${exitCode});};${delayMs > 0 ? `setTimeout(emit,${delayMs});` : "emit();"}\n`;
  await writeFile(binary, script, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { binary: await realpath(binary), directory };
}

function imageRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { filename: "portrait.png", mime_type: "image/png", bytes: new Uint8Array(PNG_1X1), ffprobePath: process.execPath, ...overrides };
}

function videoRequest(ffprobePath: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { filename: "clip.mp4", mime_type: "video/mp4", bytes: videoBytes(), ffprobePath, ...overrides };
}

test("accepts source MIME aliases and supported still formats while sealing an owned byte receipt", async () => {
  for (const [mime_type, filename, bytes, normalized] of [
    ["image/png", "portrait.png", PNG_1X1, "image/png"],
    ["image/jpg", "portrait.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9]), "image/jpeg"],
    ["image/jpeg", "portrait.jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 0, 0xff, 0xd9]), "image/jpeg"],
    ["image/avif", "portrait.avif", AVIF_16X16, "image/avif"]
  ] as const) {
    const callerBytes = new Uint8Array(bytes);
    const expectedBytes = new Uint8Array(callerBytes);
    const result = await validateOwnerVeoOmniReferenceInput(imageRequest({ filename, mime_type, bytes: callerBytes }));
    assert.equal(isOwnerVeoOmniValidatedReference(result), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(result.model_id, "veo_omni");
    assert.equal(result.kind, "image");
    assert.equal(result.mime_type, normalized);
    assert.equal(result.source_mime_type, mime_type);
    assert.equal(result.sha256, createHash("sha256").update(expectedBytes).digest("hex"));
    assert.equal(result.duration_seconds, null);
    assert.equal(result.dispatch_allowed, false);
    assert.equal(result.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal("bytes" in result, false);
    assert.equal("path" in result, false);
    callerBytes.fill(0);
    const consumed = consumeOwnerVeoOmniValidatedReference(result);
    assert.equal(consumed.filename, filename);
    assert.equal(consumed.mime_type, normalized);
    assert.equal(consumed.kind, "image");
    assert.deepEqual(new Uint8Array(consumed.bytes), expectedBytes);
    assert.equal(isOwnerVeoOmniValidatedReference(result), false);
    assert.throws(() => consumeOwnerVeoOmniValidatedReference(result), OwnerVeoOmniReferenceInputError);
    consumed.bytes.fill(0);
  }
});

test("reports structural WebP and AVIF dimensions without pixel-decode claims", async () => {
  const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0]);
  const webpResult = await validateOwnerVeoOmniReferenceInput(imageRequest({ filename: "portrait.webp", mime_type: "image/webp", bytes: webp }));
  assert.deepEqual([webpResult.width, webpResult.height], [1, 1]);
  assert.equal(webpResult.kind, "image");
  releaseOwnerVeoOmniValidatedReference(webpResult);
  assert.equal(isOwnerVeoOmniValidatedReference(webpResult), false);

  const avifResult = await validateOwnerVeoOmniReferenceInput(imageRequest({ filename: "portrait.avif", mime_type: "image/avif", bytes: AVIF_16X16 }));
  assert.deepEqual([avifResult.width, avifResult.height], [16, 16]);
  releaseOwnerVeoOmniValidatedReference(avifResult);
});

test("rejects caller metadata that disagrees with file bytes, extension, or portable filename policy", async () => {
  const badInputs = [
    imageRequest({ mime_type: "image/webp" }),
    imageRequest({ filename: "portrait.jpg" }),
    imageRequest({ filename: "../portrait.png" }),
    imageRequest({ filename: "CON.png" }),
    imageRequest({ filename: "portrait.png " }),
    imageRequest({ filename: "portrait-\uD800.png" }),
    imageRequest({ mime_type: "image/gif", filename: "portrait.gif" }),
    imageRequest({ bytes: new Uint8Array([1, 2, 3]) })
  ];
  for (const input of badInputs) {
    await assert.rejects(validateOwnerVeoOmniReferenceInput(input), (error: unknown) =>
      error instanceof OwnerVeoOmniReferenceInputError && error.code === "INVALID_INPUT");
  }
  const getterInput = Object.defineProperty({ mime_type: "image/png", bytes: PNG_1X1, ffprobePath: process.execPath }, "filename", {
    enumerable: true, get: () => "portrait.png"
  });
  await assert.rejects(validateOwnerVeoOmniReferenceInput(getterInput), OwnerVeoOmniReferenceInputError);
  await assert.rejects(validateOwnerVeoOmniReferenceInput(new Proxy(imageRequest(), {})), OwnerVeoOmniReferenceInputError);
  await assert.rejects(validateOwnerVeoOmniReferenceInput(imageRequest({ maxFileBytes: 0 })), OwnerVeoOmniReferenceInputError);
  await assert.rejects(validateOwnerVeoOmniReferenceInput(imageRequest({ maxFileBytes: 1_048_576_001 })), OwnerVeoOmniReferenceInputError);
});

test("enforces the explicit operator cap before retaining or probing bytes", async () => {
  await assert.rejects(validateOwnerVeoOmniReferenceInput(imageRequest({ bytes: new Uint8Array(65), maxFileBytes: 64 })),
    (error: unknown) => error instanceof OwnerVeoOmniReferenceInputError && error.code === "LOCAL_LIMIT_EXCEEDED");
  const oversized = new Uint8Array(65);
  await assert.rejects(validateOwnerVeoOmniReferenceInput(imageRequest({ bytes: oversized, maxFileBytes: 64 })),
    (error: unknown) => error instanceof OwnerVeoOmniReferenceInputError && error.code === "LOCAL_LIMIT_EXCEEDED");
  const result = await validateOwnerVeoOmniReferenceInput(imageRequest({ maxFileBytes: 128 }));
  assert.equal(result.local_max_file_bytes, 128);
  releaseOwnerVeoOmniValidatedReference(result);
});

test("probes one owned MP4 and MOV stream through the child boundary and wipes the temporary source", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe executable; actual Windows ffprobe path NOT_RUN"); return; }
  for (const [filename, mime_type, bytes] of [
    ["clip.mp4", "video/mp4", videoBytes("isom")],
    ["clip.mov", "video/quicktime", videoBytes("qt  ")]
  ] as const) {
    const marker = join(tmpdir(), `syntx-veo-omni-reference-marker-${process.pid}-${Date.now()}-${filename}`);
    const fixture = await fakeFfprobe(ffprobeOutput("0.5"), marker);
    try {
      const result = await validateOwnerVeoOmniReferenceInput(videoRequest(fixture.binary, { filename, mime_type, bytes }));
      assert.equal(isOwnerVeoOmniValidatedReference(result), true);
      assert.equal(result.kind, "video");
      assert.equal(result.mime_type, mime_type);
      assert.equal(result.duration_seconds, 0.5);
      assert.equal(result.local_max_file_bytes, 67_108_864);
      assert.equal(result.public_max_file_bytes, 1_048_576_000);
      const privatePath = await readFile(marker, "utf8");
      assert.ok(privatePath.endsWith(filename.endsWith(".mov") ? "source.mov" : "source.mp4"));
      await assert.rejects(access(privatePath));
      await assert.rejects(access(dirname(privatePath)));
      const consumed = consumeOwnerVeoOmniValidatedReference(result);
      assert.deepEqual(new Uint8Array(consumed.bytes), bytes);
      consumed.bytes.fill(0);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
      await rm(marker, { force: true });
    }
  }
});

test("accepts the 10.2-second boundary and rejects a longer container duration and ambiguous streams", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe executable; actual Windows ffprobe path NOT_RUN"); return; }
  const boundaryMarker = join(tmpdir(), `syntx-veo-omni-reference-boundary-marker-${process.pid}-${Date.now()}`);
  const boundaryFixture = await fakeFfprobe(ffprobeOutput("10.2"), boundaryMarker);
  try {
    const result = await validateOwnerVeoOmniReferenceInput(videoRequest(boundaryFixture.binary));
    assert.equal(result.duration_seconds, 10.2);
    releaseOwnerVeoOmniValidatedReference(result);
  } finally {
    await rm(boundaryFixture.directory, { recursive: true, force: true });
    await rm(boundaryMarker, { force: true });
  }
  const cases = [
    { name: "over-limit", output: ffprobeOutput("10.3") },
    { name: "container-preferred", output: ffprobeOutput("10.2", { containerDuration: "10.3" }) },
    { name: "no-video", output: ffprobeOutput("1", { streams: [{ codec_type: "audio", codec_name: "aac", duration: "1" }] }) },
    { name: "two-primary-videos", output: ffprobeOutput("1", { streams: [
      { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "1", disposition: { attached_pic: 0 } },
      { codec_type: "video", codec_name: "h264", width: 640, height: 360, duration: "1", disposition: { attached_pic: 0 } }
    ] }) }
  ];
  for (const item of cases) {
    const marker = join(tmpdir(), `syntx-veo-omni-reference-invalid-marker-${process.pid}-${Date.now()}-${item.name}`);
    const fixture = await fakeFfprobe(item.output, marker);
    try {
      await assert.rejects(validateOwnerVeoOmniReferenceInput(videoRequest(fixture.binary)), (error: unknown) =>
        error instanceof OwnerVeoOmniReferenceInputError && error.code === "UNSUPPORTED_MEDIA");
      const privatePath = await readFile(marker, "utf8");
      await assert.rejects(access(privatePath));
      await assert.rejects(access(dirname(privatePath)));
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
      await rm(marker, { force: true });
    }
  }
});

test("rejects AVIF animation or video containers rather than treating them as a still image", async () => {
  const box = Buffer.alloc(8);
  box.writeUInt32BE(8, 0);
  box.write("moov", 4, 4, "ascii");
  const animated = Buffer.concat([AVIF_16X16, box]);
  await assert.rejects(validateOwnerVeoOmniReferenceInput(imageRequest({ filename: "moving.avif", mime_type: "image/avif", bytes: animated })),
    (error: unknown) => error instanceof OwnerVeoOmniReferenceInputError && error.code === "UNSUPPORTED_MEDIA");
});

test("rejects unsupported video claims before starting ffprobe", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe executable; actual Windows ffprobe path NOT_RUN"); return; }
  const marker = join(tmpdir(), `syntx-veo-omni-reference-no-probe-${process.pid}-${Date.now()}`);
  const fixture = await fakeFfprobe(ffprobeOutput("1"), marker);
  try {
    await assert.rejects(validateOwnerVeoOmniReferenceInput(videoRequest(fixture.binary, { bytes: PNG_1X1 })), OwnerVeoOmniReferenceInputError);
    await assert.rejects(validateOwnerVeoOmniReferenceInput(videoRequest(fixture.binary, { filename: "clip.mov" })), OwnerVeoOmniReferenceInputError);
    await assert.rejects(validateOwnerVeoOmniReferenceInput(videoRequest("relative/ffprobe")), OwnerVeoOmniReferenceInputError);
    assert.equal((await readFile(marker).catch(() => Buffer.alloc(0))).length, 0);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});

test("aborts before probing and exposes no consumable receipt after malformed probe metadata", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe executable; actual Windows ffprobe path NOT_RUN"); return; }
  const marker = join(tmpdir(), `syntx-veo-omni-reference-abort-marker-${process.pid}-${Date.now()}`);
  const fixture = await fakeFfprobe(ffprobeOutput("1", { formatName: "avi" }), marker);
  try {
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(validateOwnerVeoOmniReferenceInput(videoRequest(fixture.binary), aborted.signal), (error: unknown) =>
      error instanceof OwnerVeoOmniReferenceInputError && error.code === "PROBE_ABORTED");
    await assert.rejects(validateOwnerVeoOmniReferenceInput(videoRequest(fixture.binary)), (error: unknown) =>
      error instanceof OwnerVeoOmniReferenceInputError && error.code === "UNSUPPORTED_MEDIA");
    const privatePath = await readFile(marker, "utf8");
    await assert.rejects(access(privatePath));
    await assert.rejects(access(dirname(privatePath)));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});

test("aborts an in-flight synthetic ffprobe child and wipes its private video file", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe executable; actual Windows ffprobe path NOT_RUN"); return; }
  const marker = join(tmpdir(), `syntx-veo-omni-reference-inflight-abort-${process.pid}-${Date.now()}`);
  const fixture = await fakeFfprobe(ffprobeOutput("1"), marker, 10_000);
  try {
    const controller = new AbortController();
    const validation = validateOwnerVeoOmniReferenceInput(videoRequest(fixture.binary), controller.signal);
    const deadline = Date.now() + 2_000;
    let privatePath: string | undefined;
    while (!privatePath && Date.now() < deadline) {
      privatePath = await readFile(marker, "utf8").catch(() => undefined);
      if (!privatePath) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    assert.ok(privatePath, "the fake ffprobe child should start after local validation");
    controller.abort();
    await assert.rejects(validation, (error: unknown) =>
      error instanceof OwnerVeoOmniReferenceInputError && error.code === "PROBE_ABORTED");
    await assert.rejects(access(privatePath));
    await assert.rejects(access(dirname(privatePath)));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});

test("removes the private probe file when the ffprobe child exits unsuccessfully", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX fake ffprobe executable; actual Windows ffprobe path NOT_RUN"); return; }
  const marker = join(tmpdir(), `syntx-veo-omni-reference-child-error-${process.pid}-${Date.now()}`);
  const fixture = await fakeFfprobe(ffprobeOutput("1"), marker, 0, 43);
  try {
    await assert.rejects(validateOwnerVeoOmniReferenceInput(videoRequest(fixture.binary)), (error: unknown) =>
      error instanceof OwnerVeoOmniReferenceInputError && error.code === "PROBE_FAILED");
    const privatePath = await readFile(marker, "utf8");
    await assert.rejects(access(privatePath));
    await assert.rejects(access(dirname(privatePath)));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(marker, { force: true });
  }
});

test("accepts a tiny MP4 through the actual local ffprobe binary when ffmpeg is installed", async (t) => {
  const ffprobeCandidates = ["/opt/homebrew/bin/ffprobe", "/usr/bin/ffprobe"];
  const ffmpegCandidates = ["/opt/homebrew/bin/ffmpeg", "/usr/bin/ffmpeg"];
  let ffprobePath: string | undefined, ffmpegPath: string | undefined;
  for (const path of ffprobeCandidates) { try { await stat(path); ffprobePath = await realpath(path); break; } catch { /* try the next standard path */ } }
  for (const path of ffmpegCandidates) { try { await stat(path); ffmpegPath = await realpath(path); break; } catch { /* try the next standard path */ } }
  if (!ffprobePath || !ffmpegPath) { t.skip("actual local ffprobe/ffmpeg pair unavailable; synthetic child-boundary tests cover parsing"); return; }
  const directory = await mkdtemp(join(tmpdir(), "syntx-veo-omni-reference-real-2103-"));
  const filename = join(directory, "tiny.mp4");
  try {
    await runExecutable(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=16x16:r=1",
      "-t", "1", "-an", "-c:v", "mpeg4", "-movflags", "+faststart", filename]);
    const bytes = await readFile(filename);
    const result = await validateOwnerVeoOmniReferenceInput({ filename: "tiny.mp4", mime_type: "video/mp4", bytes, ffprobePath });
    assert.equal(result.kind, "video");
    assert.deepEqual([result.width, result.height], [16, 16]);
    assert.ok((result.duration_seconds ?? 0) > 0 && (result.duration_seconds ?? 20) <= 10.2);
    releaseOwnerVeoOmniValidatedReference(result);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function runExecutable(path: string, args: readonly string[]): Promise<void> {
  return new Promise((resolveRun, rejectRun) => {
    execFileCallback(path, [...args], { timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 64 * 1024, windowsHide: true,
      env: { PATH: "", LANG: "C", LC_ALL: "C" } }, (error) => error ? rejectRun(error) : resolveRun());
  });
}
