import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerIdeogramImageUploadService } from "../src/application/owner-ideogram-image-upload-service.js";
import { encodeOwnerIdeogramPaintedMaskVariants } from "../src/application/owner-ideogram-painted-mask-codec.js";
import {
  OwnerIdeogramImageMaskUploadService
} from "../src/application/owner-ideogram-image-mask-upload-service.js";

const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BINDING = Object.freeze({ tenant_id: "ideogram-mask-tenant", subject: "ideogram-mask-owner" });
const ATTEMPT = "link_ideogram_mask_service_0123456789";

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(body), data.byteLength + 8);
  return chunk;
}

function rgbaPng(width: number, height: number, alphas: readonly number[]): Buffer {
  assert.equal(alphas.length, width * height);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      const offset = rowStart + 1 + x * 4;
      raw[offset] = (pixel * 17) & 0xff;
      raw[offset + 1] = (pixel * 29) & 0xff;
      raw[offset + 2] = (pixel * 43) & 0xff;
      raw[offset + 3] = alphas[pixel]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  try {
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0))
    ]);
  } finally { raw.fill(0); ihdr.fill(0); }
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-ideogram-mask-credential");
  } };
}

function errorCode(value: unknown): string | undefined {
  return value instanceof Error && "code" in value ? String(value.code) : undefined;
}

interface RigOptions {
  readonly failInverse?: boolean;
  readonly holdInverse?: boolean;
  readonly sameHiddenUrl?: boolean;
}

function createRig(options: RigOptions = {}) {
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  const realDateNow = Date.now;
  Date.now = () => now;
  const linked = new Map<string, boolean>();
  const uploads: Array<Readonly<{
    destination: string;
    model_type: string;
    check_duplicates: string;
    filename: string;
    mime_type: string;
    bytes: Buffer;
    url: string;
  }>> = [];
  const hiddenCalls: string[] = [];
  let nextFile = 0;
  let inverseStarted!: () => void;
  const inverseStartedPromise = new Promise<void>((resolve) => { inverseStarted = resolve; });
  const linkService = {
    async getStatus(_binding: unknown, attemptId: string) {
      const isLinked = linked.get(attemptId) === true;
      return {
        attempt_id: attemptId,
        authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: isLinked ? "LINKED" as const : "UNLINKED" as const,
        expires_at: isLinked ? new Date(now + 60 * 60_000).toISOString() : null,
        linked: isLinked
      };
    }
  };
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.pathname, "/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      const form = init?.body as FormData;
      const file = form.get("files");
      assert.ok(file instanceof File);
      const bytes = Buffer.from(await file.arrayBuffer());
      const destination = String(form.get("destination"));
      const filename = file.name;
      const model_type = String(form.get("model_type"));
      const check_duplicates = String(form.get("check_duplicates"));
      nextFile += 1;
      const fileUrl = options.sameHiddenUrl && destination === "hidden"
        ? "https://r2.syntx.ai/private/ideogram/deduplicated-mask.png"
        : `https://r2.syntx.ai/private/ideogram/test-${nextFile}.png`;
      uploads.push(Object.freeze({ destination, model_type, check_duplicates, filename,
        mime_type: file.type, bytes, url: fileUrl }));
      if (destination === "hidden") {
        hiddenCalls.push(filename);
        if (filename.includes("inverse")) {
          inverseStarted();
          if (options.holdInverse) {
            return await new Promise<Response>((_resolve, reject) => {
              const signal = init?.signal;
              if (!(signal instanceof AbortSignal)) { reject(new Error("mask upload missing abort signal")); return; }
              const abort = () => reject(new DOMException("synthetic mask upload aborted", "AbortError"));
              if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
            });
          }
          if (options.failInverse) throw new Error("synthetic inverse upload response lost");
        }
      }
      return Response.json({ files: [{ id: `mask-file-${nextFile}`, url: fileUrl, mime_type: file.type, size: bytes.byteLength }] });
    }
  });
  const baseUploadService = new OwnerIdeogramImageUploadService({
    binding: BINDING, linkService, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    resolveClient: () => client, now: () => now
  });
  const maskUploadService = new OwnerIdeogramImageMaskUploadService({
    baseUploadService, catalog: CATALOG, catalog_version: CATALOG_VERSION,
    resolveClient: () => client, now: () => now
  });
  async function linkAttempt(attemptId: string): Promise<void> { linked.set(attemptId, true); }
  async function uploadBase(attemptId: string, bytes = rgbaPng(1, 1, [255])) {
    await linkAttempt(attemptId);
    return baseUploadService.upload({ attemptId, model_id: "ideogram_45", mode: "precise_edit",
      content_base64: bytes.toString("base64"), filename: "base.png", mime_type: "image/png" });
  }
  async function close(): Promise<void> {
    try { await maskUploadService.close(); }
    finally {
      await baseUploadService.close();
      Date.now = realDateNow;
      for (const upload of uploads) upload.bytes.fill(0);
    }
  }
  return {
    maskUploadService, baseUploadService, linkService, uploads, hiddenCalls, inverseStartedPromise,
    get now() { return now; }, setNow(value: number) { now = value; },
    linkAttempt, uploadBase, close
  };
}

test("mask service converts the painted RGBA bytes through the real codec and privately owns the hidden normal/inverse pair", async () => {
  const rig = createRig();
  const attemptId = ATTEMPT;
  const base = await rig.uploadBase(attemptId);
  const painted = rgbaPng(1, 1, [1]);
  const expected = encodeOwnerIdeogramPaintedMaskVariants(painted.toString("base64"));
  try {
    const receipt = await rig.maskUploadService.upload({ attemptId, base_reference_handle: base.reference_handle,
      painted_rgba_png_base64: painted.toString("base64") });
    assert.equal(receipt.status, "uploaded");
    assert.match(receipt.mask_handle, /^ideogram_mask_[0-9a-f-]{36}$/u);
    assert.equal(receipt.width, 1);
    assert.equal(receipt.height, 1);
    assert.equal(receipt.expires_in_seconds, 900);
    assert.equal(receipt.confidence_scope, "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE");
    assert.equal(Object.isFrozen(receipt), true);
    assert.equal(JSON.stringify(receipt).includes("https://r2.syntx.ai"), false);
    assert.equal(JSON.stringify(receipt).includes(base.reference_handle), false);
    assert.deepEqual(rig.uploads.map((upload) => upload.destination), ["uploaded", "hidden", "hidden"]);
    assert.deepEqual(rig.hiddenCalls, ["ideogram-mask-normal.png", "ideogram-mask-inverse.png"]);
    assert.deepEqual(rig.uploads.slice(1).map((upload) => [upload.model_type, upload.check_duplicates, upload.mime_type]), [
      ["ideogram_45", "true", "image/png"], ["ideogram_45", "true", "image/png"]
    ]);
    assert.deepEqual(rig.uploads.slice(1).map((upload) => upload.bytes), [
      expected.source_inverted_mask_false.bytes, expected.source_inverted_mask_true.bytes
    ]);
    const resolved = await rig.maskUploadService.resolveMask({ attemptId, mask_handle: receipt.mask_handle,
      base_reference_handle: base.reference_handle });
    assert.equal(resolved.role, "mask");
    assert.equal(resolved.model_id, "ideogram_45");
    assert.equal(resolved.mode, "precise_edit");
    assert.equal(resolved.base_reference_handle, base.reference_handle);
    assert.equal(resolved.base_sha256, base.sha256);
    assert.equal(resolved.width, base.width);
    assert.equal(resolved.height, base.height);
    assert.equal(resolved.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.equal(resolved.geometry_verified, false);
    assert.equal(resolved.generation_permit, false);
    assert.equal(resolved.pair_sha256, receipt.pair_sha256);
    assert.equal(resolved.primary_url, resolved.normal_url);
    assert.notEqual(resolved.normal_url, resolved.inverse_url);
    assert.equal(Object.isFrozen(resolved), true);
  } finally {
    painted.fill(0);
    expected.source_inverted_mask_false.bytes.fill(0);
    expected.source_inverted_mask_true.bytes.fill(0);
    await rig.close();
  }
});

test("mask geometry must match the exact ordinary handle metadata before either hidden upload", async () => {
  const rig = createRig();
  const base = await rig.uploadBase(ATTEMPT, rgbaPng(2, 1, [255, 255]));
  const painted = rgbaPng(1, 1, [1]);
  try {
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "MASK_GEOMETRY_MISMATCH");
    assert.equal(rig.hiddenCalls.length, 0);
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: "not-png" }),
    (error: unknown) => errorCode(error) === "INVALID_PAINTED_MASK");
    assert.equal(rig.hiddenCalls.length, 0);
  } finally { painted.fill(0); await rig.close(); }
});

test("ordinary handles and masks bound to another first image cannot resolve as this mask role", async () => {
  const rig = createRig();
  const base = await rig.uploadBase(ATTEMPT);
  const otherBase = await rig.baseUploadService.upload({ attemptId: ATTEMPT, model_id: "ideogram_45", mode: "precise_edit",
    content_base64: rgbaPng(1, 1, [254]).toString("base64"), filename: "other.png", mime_type: "image/png" });
  const painted = rgbaPng(1, 1, [1]);
  try {
    const receipt = await rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") });
    await assert.rejects(rig.maskUploadService.resolveMask({ attemptId: ATTEMPT,
      mask_handle: base.reference_handle, base_reference_handle: base.reference_handle }),
    (error: unknown) => errorCode(error) === "MASK_HANDLE_UNAVAILABLE");
    await assert.rejects(rig.maskUploadService.resolveMask({ attemptId: ATTEMPT,
      mask_handle: receipt.mask_handle, base_reference_handle: otherBase.reference_handle }),
    (error: unknown) => errorCode(error) === "MASK_HANDLE_UNAVAILABLE");
    assert.equal(rig.hiddenCalls.length, 2);
  } finally { painted.fill(0); await rig.close(); }
});

test("uncertain inverse upload tombstones the painted semantic intent across invalidate and same-principal relink", async () => {
  const rig = createRig({ failInverse: true });
  const baseBytes = rgbaPng(1, 1, [255]);
  const painted = rgbaPng(1, 1, [1]);
  const base = await rig.uploadBase(ATTEMPT, baseBytes);
  try {
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
    assert.deepEqual(rig.hiddenCalls, ["ideogram-mask-normal.png", "ideogram-mask-inverse.png"]);
    await rig.maskUploadService.invalidateAttempt(ATTEMPT);
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
    const relinkedAttempt = "link_ideogram_mask_relinked_0123456789";
    const relinkedBase = await rig.uploadBase(relinkedAttempt, baseBytes);
    await assert.rejects(rig.maskUploadService.upload({ attemptId: relinkedAttempt,
      base_reference_handle: relinkedBase.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
    assert.equal(rig.hiddenCalls.length, 2, "unknown pair must never be replayed through new handles/nonces");
  } finally { baseBytes.fill(0); painted.fill(0); await rig.close(); }
});

test("128 uncertain mask intents are retained without eviction and refuse a 129th before hidden upload", async () => {
  const rig = createRig({ failInverse: true });
  const base = await rig.uploadBase(ATTEMPT, rgbaPng(8, 1, Array(8).fill(255)));
  try {
    for (let bits = 0; bits < 128; bits += 1) {
      const alphas = Array.from({ length: 8 }, (_, index) => (bits & (1 << index)) === 0 ? 0 : 1);
      const painted = rgbaPng(8, 1, alphas);
      try {
        await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
          base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
        (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
      } finally { painted.fill(0); }
    }
    const overflow = rgbaPng(8, 1, [1, 0, 0, 0, 0, 0, 0, 1]);
    try {
      const before = rig.hiddenCalls.length;
      await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
        base_reference_handle: base.reference_handle, painted_rgba_png_base64: overflow.toString("base64") }),
      (error: unknown) => errorCode(error) === "CAPACITY_EXCEEDED");
      assert.equal(rig.hiddenCalls.length, before);
    } finally { overflow.fill(0); }
  } finally { await rig.close(); }
});

test("successful mask receipts keep the first ordinary handle's original expiry and are not renewed", async () => {
  const rig = createRig();
  const baseBytes = rgbaPng(1, 1, [255]);
  const painted = rgbaPng(1, 1, [1]);
  const base = await rig.uploadBase(ATTEMPT, baseBytes);
  try {
    const first = await rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") });
    rig.setNow(Date.parse("2026-10-11T00:14:00.000Z"));
    const repeated = await rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") });
    assert.equal(repeated.mask_handle, first.mask_handle);
    assert.equal(repeated.expires_in_seconds, 60);
    assert.equal(rig.hiddenCalls.length, 2);
    rig.setNow(Date.parse("2026-10-11T00:15:00.000Z"));
    await assert.rejects(rig.maskUploadService.resolveMask({ attemptId: ATTEMPT,
      mask_handle: first.mask_handle, base_reference_handle: base.reference_handle }),
    (error: unknown) => errorCode(error) === "MASK_HANDLE_EXPIRED");
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "BASE_REFERENCE_EXPIRED");
    assert.equal(rig.hiddenCalls.length, 2);
  } finally { baseBytes.fill(0); painted.fill(0); await rig.close(); }
});

test("abort and attempt invalidation drain an in-flight inverse upload without issuing a mask handle", async () => {
  const rig = createRig({ holdInverse: true });
  const painted = rgbaPng(1, 1, [1]);
  const base = await rig.uploadBase(ATTEMPT);
  try {
    const pending = rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") });
    await rig.inverseStartedPromise;
    await rig.maskUploadService.invalidateAttempt(ATTEMPT);
    await assert.rejects(pending, (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
    assert.deepEqual(rig.hiddenCalls, ["ideogram-mask-normal.png", "ideogram-mask-inverse.png"]);
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
    assert.equal(rig.hiddenCalls.length, 2);
  } finally { painted.fill(0); await rig.close(); }
});

test("a concurrent duplicate semantic intent is rejected while the first normal/inverse pair is unresolved", async () => {
  const rig = createRig({ holdInverse: true });
  const painted = rgbaPng(1, 1, [1]);
  const base = await rig.uploadBase(ATTEMPT);
  try {
    const first = rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") });
    await rig.inverseStartedPromise;
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "SERVICE_BUSY");
    assert.deepEqual(rig.hiddenCalls, ["ideogram-mask-normal.png", "ideogram-mask-inverse.png"]);
    await rig.maskUploadService.invalidateAttempt(ATTEMPT);
    await assert.rejects(first, (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
  } finally { painted.fill(0); await rig.close(); }
});

test("the service refuses a pair when both opposite variants resolve to one hidden object URL", async () => {
  const rig = createRig({ sameHiddenUrl: true });
  const painted = rgbaPng(1, 1, [1]);
  const base = await rig.uploadBase(ATTEMPT);
  try {
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
    assert.deepEqual(rig.hiddenCalls, ["ideogram-mask-normal.png", "ideogram-mask-inverse.png"]);
    await assert.rejects(rig.maskUploadService.upload({ attemptId: ATTEMPT,
      base_reference_handle: base.reference_handle, painted_rgba_png_base64: painted.toString("base64") }),
    (error: unknown) => errorCode(error) === "MASK_OUTCOME_UNKNOWN");
    assert.equal(rig.hiddenCalls.length, 2);
  } finally { painted.fill(0); await rig.close(); }
});
