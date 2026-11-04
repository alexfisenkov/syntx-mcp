import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OwnerLocalImageFileService, OwnerLocalImageFileServiceError } from "../src/application/owner-local-image-file-service.js";

const ATTEMPT = "link_local_file_test_attempt_0123456789";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG_1X1 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const receipt = Object.freeze({ status: "uploaded" as const, reference_handle: "standard_image_12345678-1234-1234-1234-123456789012",
  variant: "banana-2.1" as const, kind: "image" as const, original_mime_type: "image/png", mime_type: "image/png", width: 1,
  height: 1, duration: null, size: PNG.byteLength, sha256: `sha256:${"a".repeat(64)}` as `sha256:${string}`,
  expires_in_seconds: 900, metadata_confidence: "CONTAINER_METADATA_ONLY" as const, validation_confidence: "fixture" });

function createService(root: string, options: { auth?: () => Promise<void>; maxBytes?: number } = {}) {
  const events: string[] = [];
  let uploaded: Record<string, unknown> | undefined;
  const service = new OwnerLocalImageFileService({ roots: [root], max_source_bytes: options.maxBytes,
    uploadService: {
      async assertLinkedAttempt() { events.push("auth"); await (options.auth?.() ?? Promise.resolve()); },
      async upload(input: Record<string, unknown>) { events.push("upload"); uploaded = input; return receipt; }
    },
    async prepare(input: { bytes: Uint8Array; filename: string; mime_type: string }, _options: unknown) {
      events.push("prepare");
      return { bytes: new Uint8Array(input.bytes), filename: input.filename, mime_type: input.mime_type,
        preparation: { applied: false, original_bytes: input.bytes.byteLength, prepared_bytes: input.bytes.byteLength,
          original_width: 1, original_height: 1, original_mime_type: input.mime_type, prepared_mime_type: input.mime_type } };
    }
  });
  return { service, events, get uploaded() { return uploaded; } };
}

test("local file upload preflights principal before reading and keeps file contents inside process", async () => {
  const root = await createTempRoot("syntx-local-image-");
  try {
    const folder = join(root, "Фото папка 🖼️");
    await mkdir(folder);
    const path = join(folder, "reference image.png");
    await writeFile(path, PNG);
    const harness = createService(root);
    const result = await harness.service.upload({ attemptId: ATTEMPT, variant: "banana-2.1", absolute_path: path });
    assert.deepEqual(harness.events, ["auth", "prepare", "upload"]);
    assert.equal(Buffer.from(harness.uploaded!.content_base64 as string, "base64").equals(PNG), true);
    assert.equal(harness.uploaded!.attemptId, ATTEMPT);
    assert.equal(harness.uploaded!.filename, "reference image.png");
    assert.equal(result.receipt.reference_handle, receipt.reference_handle);
    assert.equal(result.filename, "reference image.png");
    assert.deepEqual(result.preparation, { applied: false, original_bytes: PNG.byteLength, prepared_bytes: PNG.byteLength,
      original_width: 1, original_height: 1, original_mime_type: "image/png", prepared_mime_type: "image/png" });
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.deepEqual([...PNG], [...PNG]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local file upload checks owner authorization before even resolving a rejected path", async () => {
  const root = join(tmpdir(), "syntx-local-image-root-does-not-exist");
  const harness = createService(root, { auth: async () => { throw new Error("not linked"); } });
  await assert.rejects(() => harness.service.upload({ attemptId: ATTEMPT, variant: "banana", absolute_path: "/outside/secret.png" }),
    (error: unknown) => error instanceof OwnerLocalImageFileServiceError && error.code === "FILE_UNAVAILABLE");
  assert.deepEqual(harness.events, ["auth"]);
});

test("local byte path preserves a 3,945,971-byte JPEG and keeps a 10 MiB source out of the MCP argument", async () => {
  const root = await createTempRoot("syntx-local-image-size-");
  try {
    const medium = jpegWithMetadataBytes(3_945_971);
    const large = jpegWithMetadataBytes(10 * 1024 * 1024);
    await writeFile(join(root, "medium.jpg"), medium);
    await writeFile(join(root, "large.jpg"), large);
    const events: string[] = [];
    let uploaded: Record<string, unknown> | undefined;
    const service = new OwnerLocalImageFileService({ roots: [root], uploadService: {
      async assertLinkedAttempt() { events.push("auth"); },
      async upload(input: Record<string, unknown>) { events.push("upload"); uploaded = input; return receipt; }
    }, async prepare(input: { bytes: Uint8Array; filename: string; mime_type: string }) {
      events.push(`prepare:${input.bytes.byteLength}`);
      const compressed = input.bytes.byteLength > 7 * 1024 * 1024;
      const bytes = compressed ? new Uint8Array(5 * 1024 * 1024) : new Uint8Array(input.bytes);
      return { bytes, filename: compressed ? "large.jpg" : input.filename, mime_type: "image/jpeg",
        preparation: { applied: compressed, original_bytes: input.bytes.byteLength, prepared_bytes: bytes.byteLength,
          original_mime_type: "image/jpeg", prepared_mime_type: "image/jpeg" } };
    } });
    const first = await service.upload({ attemptId: ATTEMPT, variant: "banana-2.1", absolute_path: join(root, "medium.jpg") });
    assert.equal(first.preparation.applied, false);
    assert.equal(first.preparation.original_bytes, 3_945_971);
    assert.equal(Buffer.from(uploaded!.content_base64 as string, "base64").byteLength, 3_945_971);
    const second = await service.upload({ attemptId: ATTEMPT, variant: "banana-2.1", absolute_path: join(root, "large.jpg") });
    assert.equal(second.preparation.applied, true);
    assert.equal(second.preparation.original_bytes, 10 * 1024 * 1024);
    assert.equal(second.preparation.prepared_bytes, 5 * 1024 * 1024);
    assert.equal(Buffer.from(uploaded!.content_base64 as string, "base64").byteLength, 5 * 1024 * 1024);
    assert.deepEqual(events, ["auth", "prepare:3945971", "upload", "auth", "prepare:10485760", "upload"]);
    assert.equal(large.byteLength, 10 * 1024 * 1024);
  } finally { await rm(root, { recursive: true, force: true }); }
});

function jpegWithMetadataBytes(size: number): Buffer {
  if (!Number.isSafeInteger(size) || size < JPEG_1X1.byteLength) throw new Error("bad fixture size");
  let remaining = size - JPEG_1X1.byteLength;
  const segments: Buffer[] = [];
  while (remaining > 0) {
    const segmentBytes = Math.min(65_537, remaining);
    if (segmentBytes < 6) throw new Error("fixture tail cannot form a JPEG application segment");
    const segment = Buffer.alloc(segmentBytes);
    segment[0] = 0xff; segment[1] = 0xe1;
    segment.writeUInt16BE(segmentBytes - 2, 2);
    segments.push(segment);
    remaining -= segmentBytes;
  }
  return Buffer.concat([JPEG_1X1.subarray(0, 2), ...segments, JPEG_1X1.subarray(2)]);
}

async function createTempRoot(prefix: string): Promise<string> {
  return await mkdtemp(join(await realpath(tmpdir()), prefix));
}

test("Banana 2.1 local read stops at the source metadata bound before preparation", async () => {
  const root = await createTempRoot("syntx-local-image-banana-limit-");
  try {
    await writeFile(join(root, "too-large.jpg"), Buffer.alloc(20 * 1024 * 1024 + 1));
    const harness = createService(root);
    await assert.rejects(() => harness.service.upload({ attemptId: ATTEMPT, variant: "banana-2.1", absolute_path: join(root, "too-large.jpg") }),
      (error: unknown) => error instanceof OwnerLocalImageFileServiceError && error.code === "FILE_TOO_LARGE");
    assert.deepEqual(harness.events, ["auth"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("local file upload rejects paths outside configured roots, traversal and symlink aliases", async () => {
  const root = await createTempRoot("syntx-local-image-root-");
  const outside = await createTempRoot("syntx-local-image-outside-");
  try {
    const path = join(root, "reference.png");
    const external = join(outside, "external.png");
    await writeFile(path, PNG);
    await writeFile(external, PNG);
    const alias = join(root, "alias.png");
    await symlink(path, alias);
    const harness = createService(root);
    for (const absolute_path of [external, alias, `${root}/../outside/external.png`]) {
      await assert.rejects(() => harness.service.upload({ attemptId: ATTEMPT, variant: "banana", absolute_path }),
        (error: unknown) => error instanceof OwnerLocalImageFileServiceError && ["PATH_NOT_ALLOWED", "INVALID_REQUEST"].includes(error.code));
    }
    assert.deepEqual(harness.events, ["auth", "auth"]);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test("local file upload rejects directories, unsupported suffixes and oversized sources", async () => {
  const root = await createTempRoot("syntx-local-image-");
  try {
    await mkdir(join(root, "folder"));
    await writeFile(join(root, "not-image.txt"), "x");
    await writeFile(join(root, "large.png"), Buffer.alloc(9));
    const harness = createService(root, { maxBytes: 8 });
    for (const [absolute_path, code] of [[join(root, "folder"), "FILE_UNAVAILABLE"], [join(root, "not-image.txt"), "PREPARATION_FAILED"],
      [join(root, "large.png"), "FILE_TOO_LARGE"]] as const) {
      await assert.rejects(() => harness.service.upload({ attemptId: ATTEMPT, variant: "banana", absolute_path }),
        (error: unknown) => error instanceof OwnerLocalImageFileServiceError && error.code === code);
    }
    assert.deepEqual(harness.events, ["auth", "auth", "auth"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
