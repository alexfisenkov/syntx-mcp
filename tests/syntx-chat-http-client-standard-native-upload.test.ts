import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CREDENTIAL = "synthetic-standard-upload-credential";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } };
}

function jpegWithExactSize(byteLength: number): Buffer {
  const tail = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
    0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]).subarray(2);
  const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let remaining = byteLength - 2 - tail.byteLength;
  while (remaining > 65_537) {
    const marker = Buffer.alloc(65_537);
    marker[0] = 0xff; marker[1] = 0xe1; marker.writeUInt16BE(65_535, 2);
    chunks.push(marker);
    remaining -= marker.byteLength;
  }
  if (remaining < 4) throw new Error("JPEG fixture size is too small.");
  const finalMarker = Buffer.alloc(remaining);
  finalMarker[0] = 0xff; finalMarker[1] = 0xe1; finalMarker.writeUInt16BE(remaining - 2, 2);
  chunks.push(finalMarker, tail);
  return Buffer.concat(chunks);
}

function mp4Fixture(brand = "isom"): Buffer {
  const box = (type: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.byteLength + 8, 0);
    header.write(type, 4, 4, "ascii");
    return Buffer.concat([header, payload]);
  };
  return Buffer.concat([box("ftyp", Buffer.concat([Buffer.from(brand), Buffer.alloc(4), Buffer.from(brand)])),
    box("mdat", Buffer.from([1])), box("moov", Buffer.alloc(0))]);
}

function heifFixture(mime: "image/heic" | "image/heif"): Buffer {
  const box = (type: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.byteLength + 8, 0);
    header.write(type, 4, 4, "ascii");
    return Buffer.concat([header, payload]);
  };
  const brands = mime === "image/heic" ? ["heic", "mif1", "heic"] : ["mif1", "heif", "mif1"];
  const ftyp = box("ftyp", Buffer.concat([Buffer.from(brands[0]!), Buffer.alloc(4), ...brands.slice(1).map((brand) => Buffer.from(brand))]));
  const hdlr = box("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from("pict"), Buffer.alloc(12)]));
  const pitm = box("pitm", Buffer.from([0,0,0,0,0,1]));
  const infe = box("infe", Buffer.concat([Buffer.from([2,0,0,0,0,1,0,0]), Buffer.from("hvc1"), Buffer.from([0])]));
  const iinf = box("iinf", Buffer.concat([Buffer.from([0,0,0,0,0,1]), infe]));
  const ispe = box("ispe", Buffer.from([0,0,0,0,0,0,0,1,0,0,0,1]));
  const ipco = box("ipco", ispe);
  const iprp = box("iprp", Buffer.concat([ipco, box("ipma", Buffer.from([0,0,0,0,0,0,0,1,0,1,1,1]))]));
  return Buffer.concat([ftyp, box("meta", Buffer.concat([Buffer.alloc(4), hdlr, pitm, iinf, iprp])), box("mdat", Buffer.from([1]))]);
}

function pdfFixture(): Buffer {
  return Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n30\n%%EOF\n", "ascii");
}

test("standard image upload sends one fixed multipart object and returns one private internal reference", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), "banana");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "reference.png");
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG_1X1);
      return jsonResponse({ files: [{ id: "standard-file-1", url: "https://r2.syntx.ai/standard/input.png", mime_type: "image/png", size: PNG_1X1.byteLength }] });
    }
  });

  const reference = await client.uploadStandardImageReference({
    bytes: PNG_1X1, filename: "reference.png", mime_type: "image/png", variant: "banana"
  });

  assert.deepEqual(reference, { file_id: "standard-file-1", url: "https://r2.syntx.ai/standard/input.png" });
  assert.equal(calls, 1);
  assert.ok(PNG_1X1.some((byte) => byte !== 0), "caller-owned bytes stay unchanged");
});

test("standard image upload sends the exact model_type for all ten admitted variants", async () => {
  const variants = [
    "banana", "banana-2.1", "banana2", "banana3", "banana3_light",
    "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"
  ] as const;
  let expectedVariant: typeof variants[number] = variants[0];
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      calls += 1;
      const form = init?.body as FormData;
      assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
      assert.equal(form.get("model_type"), expectedVariant);
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG_1X1);
      return jsonResponse({ files: [{ url: `https://r2.syntx.ai/standard/${calls}.png`, mime_type: "image/png", size: PNG_1X1.byteLength }] });
    }
  });

  for (expectedVariant of variants) {
    const result = await client.uploadStandardImageReference({
      bytes: PNG_1X1, filename: "reference.png", mime_type: "image/png", variant: expectedVariant
    });
    assert.equal(result.url, `https://r2.syntx.ai/standard/${calls}.png`);
  }
  assert.equal(calls, variants.length);
});

test("standard image upload accepts a structurally valid 32 MiB GPT image without the legacy 10 MiB cap", async () => {
  const bytes = jpegWithExactSize(32 * 1024 * 1024);
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      calls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      assert.equal(file.size, 32 * 1024 * 1024);
      assert.equal(file.type, "image/jpeg");
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/standard/large.jpg", mime_type: "image/jpeg", size: file.size }] });
    }
  });

  const result = await client.uploadStandardImageReference({
    bytes, filename: "large.jpg", mime_type: "image/jpeg", variant: "gpt-image-2.5-flare"
  });

  assert.deepEqual(result, { url: "https://r2.syntx.ai/standard/large.jpg" });
  assert.equal(calls, 1);
  assert.ok(bytes.some((byte) => byte !== 0), "caller bytes remain owned by the caller");
});

test("source-specific Banana image, video, and PDF ceilings reject oversized raw bytes before auth", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  const overLimit: readonly [number, string, string][] = [
    [7 * 1024 * 1024 + 1, "image/png", "banana-2.1"],
    [20 * 1024 * 1024 + 1, "video/mp4", "banana-2.1"],
    [5 * 1024 * 1024 + 1, "application/pdf", "banana-2.1"]
  ];

  for (const [length, mime_type, variant] of overLimit) {
    await assert.rejects(client.uploadStandardImageReference({
      bytes: new Uint8Array(length), filename: "oversized.bin", mime_type, variant
    } as never), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }

  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("Banana 2.1 uploads its validated video and PDF source kinds through the same fixed route", async () => {
  const inputs = [
    { bytes: mp4Fixture(), filename: "clip.mp4", mime_type: "video/mp4", expectedMime: "video/mp4" },
    { bytes: mp4Fixture("qt  "), filename: "legacy.mov", mime_type: "video/mov", expectedMime: "video/quicktime" },
    { bytes: pdfFixture(), filename: "document.pdf", mime_type: "application/pdf", expectedMime: "application/pdf" }
  ] as const;
  let current: typeof inputs[number] = inputs[0];
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      calls += 1;
      const form = init?.body as FormData;
      assert.equal(form.get("model_type"), "banana-2.1");
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, current.filename);
      assert.equal(file.type, current.expectedMime);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), current.bytes);
      return jsonResponse({ files: [{ url: `https://r2.syntx.ai/standard/${calls}`, mime_type: current.expectedMime, size: current.bytes.byteLength }] });
    }
  });

  for (current of inputs) {
    const result = await client.uploadStandardImageReference({
      bytes: current.bytes, filename: current.filename, mime_type: current.mime_type, variant: "banana-2.1"
    });
    assert.equal(result.url, `https://r2.syntx.ai/standard/${calls}`);
  }
  assert.equal(calls, 3);
});

test("image/jpg is uploaded with the validator's canonical image/jpeg MIME", async () => {
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,
    0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      calls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      assert.equal(file.type, "image/jpeg");
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/standard/canonical.jpg", mime_type: "image/jpeg", size: jpeg.byteLength }] });
    }
  });

  const result = await client.uploadStandardImageReference({
    bytes: jpeg, filename: "canonical.jpg", mime_type: "image/jpg", variant: "gpt-image-1"
  });

  assert.equal(result.url, "https://r2.syntx.ai/standard/canonical.jpg");
  assert.equal(calls, 1);
});

test("Banana 2.1 HEIC and HEIF uploads retain their declared canonical MIME types", async () => {
  let currentMime: "image/heic" | "image/heif" = "image/heic";
  let calls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      calls += 1;
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      assert.equal(file.type, currentMime);
      return jsonResponse({ files: [{ url: `https://r2.syntx.ai/standard/${currentMime}`, mime_type: currentMime, size: file.size }] });
    }
  });

  for (currentMime of ["image/heic", "image/heif"] as const) {
    const result = await client.uploadStandardImageReference({
      bytes: heifFixture(currentMime), filename: `reference.${currentMime.slice(6)}`, mime_type: currentMime, variant: "banana-2.1"
    });
    assert.equal(result.url, `https://r2.syntx.ai/standard/${currentMime}`);
  }
  assert.equal(calls, 2);
});

test("malformed, foreign, accessor, proxy, and extra-field requests reject before auth or upload", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  let getterCalls = 0;
  let proxyTraps = 0;
  const countedBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation(CREDENTIAL);
    }
  };
  const client = new SyntxChatHttpClient({ credentialBroker: countedBroker, fetchImpl: async () => {
    fetchCalls += 1;
    return jsonResponse({});
  } });
  const valid = { bytes: PNG_1X1, filename: "reference.png", mime_type: "image/png", variant: "banana" };
  const getter = Object.defineProperty({ bytes: PNG_1X1, filename: "reference.png", mime_type: "image/png" }, "variant", {
    enumerable: true, get() { getterCalls += 1; return "banana"; }
  });
  const proxy = new Proxy(valid, { ownKeys() { proxyTraps += 1; return Reflect.ownKeys(valid); } });
  const invalid: unknown[] = [
    getter,
    proxy,
    { ...valid, extra: true },
    { ...valid, variant: "banana-21" },
    { ...valid, mime_type: "image/jpeg" },
    { ...valid, filename: "../private.png" },
    { ...valid, bytes: new Uint8Array(new SharedArrayBuffer(PNG_1X1.byteLength)) }
  ];

  for (const request of invalid) {
    await assert.rejects(client.uploadStandardImageReference(request as never), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }

  assert.equal(getterCalls, 0);
  assert.equal(proxyTraps, 0);
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("ambiguous, unsafe, or mismatched upload receipts fail after exactly one POST", async () => {
  const size = PNG_1X1.byteLength;
  const valid = { id: "standard-file-1", url: "https://r2.syntx.ai/standard/input.png", mime_type: "image/png", size };
  const invalidReceipts: unknown[] = [
    {}, { files: [] }, { files: [valid, valid] },
    { files: [{ ...valid, mime_type: "image/jpeg" }] },
    { files: [{ ...valid, size: size + 1 }] },
    { files: [{ ...valid, url: "https://attacker.invalid/private.png" }] },
    { files: [{ ...valid, url: "https://r2.syntx.ai/private.png#fragment" }] },
    { files: [{ ...valid, id: "standard-file-1", file_id: "other-file" }] },
    { files: [{ ...valid, status: "error" }] },
    { files: [{ ...valid, size: 32 * 1024 * 1024 + 1 }] }
  ];

  for (const receipt of invalidReceipts) {
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(),
      fetchImpl: async () => { fetchCalls += 1; return jsonResponse(receipt); }
    });
    await assert.rejects(client.uploadStandardImageReference({
      bytes: PNG_1X1, filename: "reference.png", mime_type: "image/png", variant: "banana"
    }), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
      !error.message.includes("attacker.invalid") && !error.message.includes("other-file"));
    assert.equal(fetchCalls, 1);
  }
});

test("snapshots caller bytes before waiting for credentials and releases the multipart file afterward", async () => {
  const source = Buffer.from(PNG_1X1);
  const expected = Buffer.from(source);
  let releaseCredential!: () => void;
  const credentialGate = new Promise<void>((resolve) => { releaseCredential = resolve; });
  let submitted: Buffer | undefined;
  let retainedForm: FormData | undefined;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      await credentialGate;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async (_input, init) => {
      retainedForm = init?.body as FormData;
      const file = retainedForm.get("files");
      assert.ok(file instanceof File);
      submitted = Buffer.from(await file.arrayBuffer());
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/standard/snapshot.png", mime_type: "image/png", size: expected.byteLength }] });
    }
  });

  const pending = client.uploadStandardImageReference({
    bytes: source, filename: "snapshot.png", mime_type: "image/png", variant: "banana"
  });
  source.fill(0);
  releaseCredential();
  await pending;

  assert.deepEqual(submitted, expected);
  assert.ok(retainedForm);
  assert.equal(retainedForm.get("files"), null);
  assert.ok(source.every((byte) => byte === 0), "caller mutation remains caller-owned");
});

test("caller abort after upload begins returns an unknown request outcome without replay", async () => {
  let fetchCalls = 0;
  let beginFetch!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { beginFetch = resolve; });
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(),
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      beginFetch();
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }
  });
  const controller = new AbortController();
  const pending = client.uploadStandardImageReference({
    bytes: PNG_1X1, filename: "reference.png", mime_type: "image/png", variant: "banana"
  }, controller.signal);

  await fetchStarted;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 1);
});
