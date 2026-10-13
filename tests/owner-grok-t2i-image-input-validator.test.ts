import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_GROK_T2I_IMAGE_INPUT_POLICY,
  OwnerGrokT2iImageInputError,
  validateOwnerGrokT2iImageUploadData
} from "../src/application/owner-grok-t2i-image-input-validator.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function jpeg1x1(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
}

function webp1x1(): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii"); bytes.writeUInt32LE(bytes.byteLength - 8, 4); bytes.write("WEBPVP8 ", 8, "ascii");
  bytes.writeUInt32LE(10, 16); bytes[23] = 0x9d; bytes[24] = 0x01; bytes[25] = 0x2a;
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(1, 28);
  return bytes;
}

test("Grok Imagine image input policy keeps public metadata separate from the local byte ceiling", () => {
  assert.deepEqual(OWNER_GROK_T2I_IMAGE_INPUT_POLICY.model_ids, ["grok_imagine_2", "grok_imagine_quality"]);
  assert.deepEqual(OWNER_GROK_T2I_IMAGE_INPUT_POLICY.accepted_source_mime_types,
    ["image/jpeg", "image/jpg", "image/png", "image/webp"]);
  assert.equal(OWNER_GROK_T2I_IMAGE_INPUT_POLICY.public_max_file_size, 0);
  assert.equal(OWNER_GROK_T2I_IMAGE_INPUT_POLICY.public_size_confidence, "CATALOG_ZERO_NOT_UNLIMITED_OR_PROVIDER_CAP");
  assert.equal(OWNER_GROK_T2I_IMAGE_INPUT_POLICY.local_max_bytes, 64 * 1024 * 1024);
  assert.equal(OWNER_GROK_T2I_IMAGE_INPUT_POLICY.local_size_confidence, "LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
  assert.equal(OWNER_GROK_T2I_IMAGE_INPUT_POLICY.validation_confidence, "CONTAINER_METADATA_ONLY_NOT_PROVIDER_ACCEPTANCE");

  const source = Buffer.from(PNG_1X1);
  const result = validateOwnerGrokT2iImageUploadData({
    model_id: "grok_imagine_2", bytes: source, filename: "source.png", mime_type: "image/png"
  });
  assert.equal(result.model_id, "grok_imagine_2");
  assert.equal(result.source_mime_type, "image/png");
  assert.equal(result.mime_type, "image/png");
  assert.equal(result.size, source.byteLength);
  assert.equal(result.width, 1);
  assert.equal(result.height, 1);
  assert.deepEqual(Buffer.from(result.bytes), source);
  assert.notEqual(result.bytes.buffer, source.buffer);
  assert.ok(source.some((byte) => byte !== 0), "caller bytes remain caller-owned");
  result.bytes.fill(0);
});

test("all public Grok Imagine source MIME choices are structurally checked and JPG is canonicalized", () => {
  const inputs = [
    { mime_type: "image/jpeg", bytes: jpeg1x1(), canonical: "image/jpeg" },
    { mime_type: "image/jpg", bytes: jpeg1x1(), canonical: "image/jpeg" },
    { mime_type: "image/png", bytes: PNG_1X1, canonical: "image/png" },
    { mime_type: "image/webp", bytes: webp1x1(), canonical: "image/webp" }
  ] as const;
  for (const input of inputs) {
    const result = validateOwnerGrokT2iImageUploadData({
      model_id: "grok_imagine_quality", bytes: input.bytes, filename: "source.img", mime_type: input.mime_type
    });
    assert.equal(result.source_mime_type, input.mime_type);
    assert.equal(result.mime_type, input.canonical);
    assert.deepEqual(Buffer.from(result.bytes), input.bytes);
    result.bytes.fill(0);
  }
});

test("non-uploadable models, accessors, proxies, shared bytes, wrong MIME, and local overflow reject safely", () => {
  let getterCalls = 0;
  let proxyTraps = 0;
  let byteProxyTraps = 0;
  const accessor = { bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" };
  Object.defineProperty(accessor, "model_id", { enumerable: true, get() { getterCalls += 1; return "grok_imagine_2"; } });
  const proxied = new Proxy({ model_id: "grok_imagine_2", bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" }, {
    ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); }
  });
  const proxiedBytes = new Proxy(PNG_1X1, {
    getPrototypeOf(target) { byteProxyTraps += 1; return Reflect.getPrototypeOf(target); }
  });
  const shared = new SharedArrayBuffer(PNG_1X1.byteLength);
  new Uint8Array(shared).set(PNG_1X1);
  const tooLarge = new Uint8Array(64 * 1024 * 1024 + 1);
  const invalid: Array<{ input: unknown; code: OwnerGrokT2iImageInputError["code"] }> = [
    { input: { model_id: "grok_t2i", bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" }, code: "INVALID_IMAGE_INPUT" },
    { input: { model_id: "grok_t2i_pro", bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" }, code: "INVALID_IMAGE_INPUT" },
    { input: { model_id: "grok_imagine_quality", bytes: PNG_1X1, filename: "source.png", mime_type: "image/gif" }, code: "INVALID_IMAGE_INPUT" },
    { input: { model_id: "grok_imagine_2", bytes: PNG_1X1, filename: "../source.png", mime_type: "image/png" }, code: "INVALID_IMAGE_INPUT" },
    { input: { model_id: "grok_imagine_2", bytes: PNG_1X1, filename: "source.png", mime_type: "image/jpeg" }, code: "INVALID_IMAGE_INPUT" },
    { input: { model_id: "grok_imagine_2", bytes: new Uint8Array(shared), filename: "source.png", mime_type: "image/png" }, code: "INVALID_IMAGE_INPUT" },
    { input: { model_id: "grok_imagine_2", bytes: proxiedBytes, filename: "source.png", mime_type: "image/png" }, code: "INVALID_IMAGE_INPUT" },
    { input: { model_id: "grok_imagine_2", bytes: tooLarge, filename: "source.png", mime_type: "image/png" }, code: "LOCAL_RESOURCE_LIMIT_EXCEEDED" },
    { input: accessor, code: "INVALID_IMAGE_INPUT" },
    { input: proxied, code: "INVALID_IMAGE_INPUT" },
    { input: { model_id: "grok_imagine_2", bytes: PNG_1X1, filename: "source.png", mime_type: "image/png", destination: "hidden" }, code: "INVALID_IMAGE_INPUT" }
  ];
  for (const item of invalid) {
    assert.throws(() => validateOwnerGrokT2iImageUploadData(item.input), (error: unknown) =>
      error instanceof OwnerGrokT2iImageInputError && error.code === item.code);
  }
  assert.equal(getterCalls, 0);
  assert.equal(proxyTraps, 0);
  assert.equal(byteProxyTraps, 0);
});
