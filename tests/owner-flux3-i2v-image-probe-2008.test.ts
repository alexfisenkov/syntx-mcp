import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  OwnerFlux3I2vImageProbeError,
  isOwnerFlux3I2vImage,
  readOwnerFlux3I2vImageBytes,
  releaseOwnerFlux3I2vImage,
  validateOwnerFlux3I2vImage
} from "../src/application/owner-flux3-i2v-image-probe.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function png(width: number, height: number): Buffer {
  const bytes = Buffer.from(PNG_1X1); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function jpeg(width: number, height: number): Buffer {
  return Buffer.from([0xff,0xd8,0xff,0xc0,0,0x0b,8,height >> 8,height & 0xff,width >> 8,width & 0xff,1,1,0x11,0,
    0xff,0xda,0,8,1,1,0,0,0x3f,0,0,0xff,0xd9]);
}
function webp(width: number, height: number): Buffer {
  const chunk = Buffer.alloc(18); chunk.write("VP8 ", 0, 4, "ascii"); chunk.writeUInt32LE(10, 4);
  chunk[11] = 0x9d; chunk[12] = 0x01; chunk[13] = 0x2a; chunk.writeUInt16LE(width, 14); chunk.writeUInt16LE(height, 16);
  const out = Buffer.alloc(12 + chunk.length); out.write("RIFF", 0, 4, "ascii"); out.writeUInt32LE(out.length - 8, 4);
  out.write("WEBP", 8, 4, "ascii"); chunk.copy(out, 12); return out;
}
const input = (bytes: Uint8Array, filename: string, mime_type: string) => ({ model_id: "flux3_i2v", bytes, filename, mime_type });
const invalid = (error: unknown) => error instanceof OwnerFlux3I2vImageProbeError && error.code === "INVALID_IMAGE_INPUT";

test("Flux3 I2V image probe sniffs exact JPEG, PNG and WebP bytes and returns only safe metadata", () => {
  const inputs = [
    [jpeg(640, 360), "scene.jpeg", "image/jpeg"],
    [png(640, 360), "scene.png", "image/png"],
    [webp(640, 360), "scene.webp", "image/webp"]
  ] as const;
  for (const [bytes, filename, mimeType] of inputs) {
    const source = Buffer.from(bytes), image = validateOwnerFlux3I2vImage(input(source, filename, mimeType));
    assert.equal(image.model_id, "flux3_i2v"); assert.equal(image.status, "LOCAL_SOURCE_VALIDATED");
    assert.equal(image.mime_type, mimeType); assert.equal(image.width, 640); assert.equal(image.height, 360);
    assert.equal(image.size, bytes.byteLength); assert.equal(image.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(image.generation_permit, false); assert.equal(image.owner_upload_binding, "NOT_ESTABLISHED");
    assert.equal(isOwnerFlux3I2vImage(image), true);
    source.fill(0);
    const read = readOwnerFlux3I2vImageBytes(image);
    assert.ok(read); assert.deepEqual(Buffer.from(read.bytes), bytes); read.bytes.fill(0);
    assert.deepEqual(Buffer.from(readOwnerFlux3I2vImageBytes(image)!.bytes), bytes);
    const forged = Object.freeze({ ...image });
    assert.equal(isOwnerFlux3I2vImage(forged), false); assert.equal(readOwnerFlux3I2vImageBytes(forged), null);
    assert.equal(releaseOwnerFlux3I2vImage(forged), false);
    assert.equal(releaseOwnerFlux3I2vImage(image), true); assert.equal(isOwnerFlux3I2vImage(image), false);
    assert.equal(readOwnerFlux3I2vImageBytes(image), null); assert.equal(releaseOwnerFlux3I2vImage(image), false);
  }
});

test("Flux3 I2V keeps dimensions as positive observations instead of inheriting WAN side caps", () => {
  const image = validateOwnerFlux3I2vImage(input(png(5_001, 1), "wide.png", "image/png"));
  assert.equal(image.width, 5_001); assert.equal(image.height, 1);
  releaseOwnerFlux3I2vImage(image);
  assert.throws(() => validateOwnerFlux3I2vImage(input(png(0, 1), "zero.png", "image/png")), invalid);
  assert.throws(() => validateOwnerFlux3I2vImage(input(png(1, 0), "zero.png", "image/png")), invalid);
});

test("Flux3 I2V rejects MIME mismatches, foreign model IDs, Windows-unsafe names and oversized input", () => {
  const image = png(640, 360);
  assert.throws(() => validateOwnerFlux3I2vImage(input(image, "scene.png", "image/jpeg")), invalid);
  assert.throws(() => validateOwnerFlux3I2vImage({ ...input(image, "scene.png", "image/png"), model_id: "flux3_v2v" }), invalid);
  for (const filename of ["../scene.png", "C:\\scene.png", "scene.", "CON.png", "trail. ", "bad:name.png"]) {
    assert.throws(() => validateOwnerFlux3I2vImage(input(image, filename, "image/png")), invalid);
  }
  assert.throws(() => validateOwnerFlux3I2vImage(input(Buffer.alloc(10 * 1024 * 1024 + 1), "large.png", "image/png")),
    (error: unknown) => error instanceof OwnerFlux3I2vImageProbeError && error.code === "LOCAL_RESOURCE_LIMIT_EXCEEDED");
});
