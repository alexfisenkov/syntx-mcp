import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SECRET = "clarity-upload-test-credential";
const AVIF_16X16 = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG_1X1 = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const WEBP_1X1 = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 5, 0, 0, 0, 0x2f, 0, 0, 0, 0, 0]);

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(SECRET); } };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

test("Clarity upload uses one fixed uploaded multipart request and returns one private reference", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${SECRET}`);
    assert.equal(new Headers(init?.headers).get("content-type"), null);
    assert.equal(init?.redirect, "error");
    assert.ok(init?.body instanceof FormData);
    const form = init.body as FormData;
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "clarity");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "source.avif");
    assert.equal(file.type, "image/avif");
    assert.equal(file.size, AVIF_16X16.byteLength);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array(AVIF_16X16));
    return jsonResponse({ files: [{ id: 9001, url: "https://r2.syntx.ai/uploaded/source.avif" }] });
  } });

  const receipt = await client.uploadClarityUpscaleImageReference({
    bytes: new Uint8Array(AVIF_16X16), filename: "source.avif", mime_type: "image/avif"
  });
  assert.deepEqual(receipt, { file_id: "9001", url: "https://r2.syntx.ai/uploaded/source.avif" });
  assert.equal(calls, 1);
});

test("Clarity upload accepts all four source MIME formats and checks optional receipt MIME and size", async () => {
  const cases = [
    { bytes: JPEG_1X1, filename: "source.jpg", mime_type: "image/jpeg" },
    { bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" },
    { bytes: WEBP_1X1, filename: "source.webp", mime_type: "image/webp" },
    { bytes: AVIF_16X16, filename: "source.avif", mime_type: "image/avif" }
  ] as const;
  for (const [index, source] of cases.entries()) {
    let calls = 0;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
      calls += 1;
      const form = init?.body as FormData;
      const file = form.get("files") as File;
      assert.equal(file.type, source.mime_type);
      assert.equal(file.size, source.bytes.byteLength);
      return jsonResponse({ files: [{ id: index + 1, url: `https://r2.syntx.ai/uploaded/${source.filename}`, mime_type: source.mime_type, size: source.bytes.byteLength }] });
    } });
    const reference = await client.uploadClarityUpscaleImageReference({
      bytes: new Uint8Array(source.bytes), filename: source.filename, mime_type: source.mime_type
    });
    assert.equal(reference.url, `https://r2.syntx.ai/uploaded/${source.filename}`);
    assert.equal(calls, 1);
  }
});

test("Clarity upload rejects caller-selected model, destination, duplicate policy, URL, and extra fields", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/uploaded/x.jpg" }] });
  } });
  const base = { bytes: new Uint8Array(JPEG_1X1), filename: "x.jpg", mime_type: "image/jpeg" };
  const invalidRequests = [
    { ...base, model_type: "banana" },
    { ...base, destination: "hidden" },
    { ...base, check_duplicates: false },
    { ...base, url: "https://attacker.invalid/x.jpg" },
    { ...base, extra: true },
    { ...base, mime_type: "image/gif" },
    { ...base, filename: "../x.jpg" }
  ];
  for (const request of invalidRequests) {
    await assert.rejects(client.uploadClarityUpscaleImageReference(request as never), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(calls, 0);
});

test("Clarity accepts exactly 25 MiB while oversize and legacy generic 10 MiB requests stop before fetch", async () => {
  const maximum = new Uint8Array(25 * 1024 * 1024);
  maximum.set(AVIF_16X16);
  let clarityCalls = 0;
  const clarityClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    clarityCalls += 1;
    const file = (init?.body as FormData).get("files") as File;
    assert.equal(file.size, 25 * 1024 * 1024);
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/uploaded/max.avif", mime_type: "image/avif", size: 25 * 1024 * 1024 }] });
  } });
  await clarityClient.uploadClarityUpscaleImageReference({ bytes: maximum, filename: "max.avif", mime_type: "image/avif" });
  assert.equal(clarityCalls, 1);
  await assert.rejects(clarityClient.uploadClarityUpscaleImageReference({
    bytes: new Uint8Array(25 * 1024 * 1024 + 1), filename: "large.avif", mime_type: "image/avif"
  }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(clarityCalls, 1);

  let legacyCalls = 0;
  const legacyClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    legacyCalls += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/uploaded/legacy.png" }] });
  } });
  await assert.rejects(legacyClient.uploadFileReferences({
    bytes: new Uint8Array(10 * 1024 * 1024 + 1), filename: "legacy.png", mime_type: "image/png",
    destination: "uploaded", check_duplicates: true, model_type: "clarity"
  }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(legacyCalls, 0);
});

test("Clarity upload rejects non-single, unsafe, failed, mismatched, and oversized receipts without retry", async () => {
  const payloads: unknown[] = [
    { files: [] },
    { files: [{ url: "https://r2.syntx.ai/uploaded/one.jpg" }, { url: "https://r2.syntx.ai/uploaded/two.jpg" }] },
    { files: [{ url: "https://attacker.invalid/one.jpg" }] },
    { files: [{ url: "https://r2.syntx.ai/uploaded/one.jpg", status: "error" }] },
    { files: [{ url: "https://r2.syntx.ai/uploaded/one.jpg", mime_type: "image/png" }] },
    { files: [{ url: "https://r2.syntx.ai/uploaded/one.jpg", size: 2 }] },
    { files: [{ url: "https://r2.syntx.ai/uploaded/one.jpg", size: 25 * 1024 * 1024 + 1 }] }
  ];
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    const payload = payloads[calls];
    calls += 1;
    return jsonResponse(payload);
  } });
  for (const _payload of payloads) {
    await assert.rejects(client.uploadClarityUpscaleImageReference({
      bytes: new Uint8Array(JPEG_1X1), filename: "one.jpg", mime_type: "image/jpeg"
    }), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
  assert.equal(calls, payloads.length);
});

test("Clarity upload propagates caller cancellation and does not repeat a lost-ACK request", async () => {
  let canceledFetchCalls = 0;
  const canceledClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    canceledFetchCalls += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/uploaded/one.jpg" }] });
  } });
  const beforeSend = new AbortController();
  beforeSend.abort();
  await assert.rejects(canceledClient.uploadClarityUpscaleImageReference({
    bytes: new Uint8Array(JPEG_1X1), filename: "one.jpg", mime_type: "image/jpeg"
  }, beforeSend.signal), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(canceledFetchCalls, 0);

  let markFetchStarted!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { markFetchStarted = resolve; });
  const fetchSignals: AbortSignal[] = [];
  const inFlightClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    if (init?.signal) fetchSignals.push(init.signal);
    markFetchStarted();
    return new Promise<Response>((_resolve, reject) => {
      fetchSignals[0]?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  } });
  const duringSend = new AbortController();
  const inFlight = inFlightClient.uploadClarityUpscaleImageReference({
    bytes: new Uint8Array(JPEG_1X1), filename: "one.jpg", mime_type: "image/jpeg"
  }, duringSend.signal);
  await fetchStarted;
  duringSend.abort();
  await assert.rejects(inFlight, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchSignals[0]?.aborted, true);

  let lostAckCalls = 0;
  const lostAckClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    lostAckCalls += 1;
    throw new Error("private URL and credential must remain redacted");
  } });
  await assert.rejects(lostAckClient.uploadClarityUpscaleImageReference({
    bytes: new Uint8Array(JPEG_1X1), filename: "one.jpg", mime_type: "image/jpeg"
  }), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_UNAVAILABLE" &&
    !error.message.includes(SECRET) && !error.message.includes("private URL"));
  assert.equal(lostAckCalls, 1);
});
