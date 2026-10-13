import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const JPEG = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const WEBP = Buffer.from([0x52,0x49,0x46,0x46,0x12,0,0,0,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,5,0,0,0,0x2f,0,0,0,0,0]);
const AVIF = Buffer.from("AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==", "base64");
const MODELS = ["uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"] as const;
const MEDIA = [[JPEG, "image/jpeg", "image/jpeg"], [JPEG, "image/jpg", "image/jpeg"], [PNG, "image/png", "image/png"], [WEBP, "image/webp", "image/webp"], [AVIF, "image/avif", "image/avif"]] as const;
const CREDENTIAL = "synthetic-uni-upload-credential";

function response(value: unknown): Response { return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } }); }
function broker(onCredential: () => void): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { onCredential(); return operation(CREDENTIAL); } };
}

test("Uni upload binds all three model IDs and five MIME labels to one fixed ordinary multipart POST", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  for (const model_id of MODELS) for (const [bytes, declaredMime, canonicalMime] of MEDIA) {
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(() => { credentialCalls += 1; }),
      fetchImpl: async (input, init) => {
        fetchCalls += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        const form = init?.body as FormData;
        assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
        assert.equal(form.get("destination"), "uploaded");
        assert.equal(form.get("check_duplicates"), "true");
        assert.equal(form.get("model_type"), model_id);
        const file = form.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.name, "owner image.bin");
        assert.equal(file.type, canonicalMime);
        assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
        return response({ files: [{ id: `uni-${fetchCalls}`, url: `https://r2.syntx.ai/uni/${fetchCalls}.img`,
          mime_type: canonicalMime, size: bytes.byteLength }] });
      }
    });
    const result = await client.uploadUniImageReference({ model_id, bytes, filename: "owner image.bin", mime_type: declaredMime });
    assert.deepEqual(result, { file_id: `uni-${fetchCalls}`, url: `https://r2.syntx.ai/uni/${fetchCalls}.img` });
  }
  assert.equal(fetchCalls, 15);
  assert.equal(credentialCalls, 15);
});

test("invalid model/MIME/filename and hostile request shapes reject before credentials or fetch", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  let getterCalls = 0;
  let proxyTraps = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return response({}); }
  });
  const base = { model_id: "uni-1", bytes: PNG, filename: "source.png", mime_type: "image/png" };
  const accessor = { bytes: PNG, filename: "source.png", mime_type: "image/png" };
  Object.defineProperty(accessor, "model_id", { enumerable: true, get() { getterCalls += 1; return base.model_id; } });
  const proxied = new Proxy(base, { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
  const shared = new SharedArrayBuffer(PNG.byteLength);
  new Uint8Array(shared).set(PNG);
  const invalid: unknown[] = [
    { ...base, model_id: "uni-1.1" }, { ...base, model_id: "grok_t2i" },
    { ...base, mime_type: "image/gif" }, { ...base, filename: "../private.png" },
    { ...base, private_url: "https://r2.syntx.ai/private.png" }, accessor, proxied,
    { ...base, bytes: new Uint8Array(shared) }
  ];
  for (const input of invalid) await assert.rejects(client.uploadUniImageReference(input),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(getterCalls, 0);
  assert.equal(proxyTraps, 0);
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("malformed and mismatched upload receipts fail after exactly one POST", async () => {
  const size = PNG.byteLength;
  const valid = { id: "uni-receipt-1", url: "https://r2.syntx.ai/uni/source.png", mime_type: "image/png", size };
  const malformed: unknown[] = [
    {}, { files: [] }, { files: [valid, valid] },
    { files: [{ ...valid, mime_type: "image/jpeg" }] },
    { files: [{ ...valid, size: size + 1 }] },
    { files: [{ ...valid, url: "https://untrusted.invalid/private.png" }] },
    { files: [{ ...valid, url: "https://r2.syntx.ai/uni/private.png#fragment" }] },
    { files: [{ ...valid, id: "one-id", file_id: "other-id" }] },
    { files: [{ ...valid, status: "error" }] }
  ];
  for (const body of malformed) {
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(() => {}),
      fetchImpl: async () => { fetchCalls += 1; return response(body); }
    });
    await assert.rejects(client.uploadUniImageReference({ model_id: "uni-1", bytes: PNG, filename: "source.png", mime_type: "image/png" }),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
        !error.message.includes("untrusted.invalid") && !error.message.includes("other-id"));
    assert.equal(fetchCalls, 1);
  }
});

test("snapshots caller bytes before credential wait and deletes the multipart file after response", async () => {
  const source = Buffer.from(PNG);
  const expected = Buffer.from(source);
  let enterCredential!: () => void;
  let releaseCredential!: () => void;
  const credentialEntered = new Promise<void>((resolve) => { enterCredential = resolve; });
  const credentialGate = new Promise<void>((resolve) => { releaseCredential = resolve; });
  let fetchCalls = 0;
  let retainedForm: FormData | undefined;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      enterCredential();
      await credentialGate;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      retainedForm = init?.body as FormData;
      const file = retainedForm.get("files");
      assert.ok(file instanceof File);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), expected);
      return response({ files: [{ url: "https://r2.syntx.ai/uni/snapshot.png", mime_type: "image/png", size: expected.byteLength }] });
    }
  });
  const pending = client.uploadUniImageReference({ model_id: "uni-1", bytes: source, filename: "snapshot.png", mime_type: "image/png" });
  await credentialEntered;
  source.fill(0);
  releaseCredential();
  const receipt = await pending;
  assert.equal(receipt.url, "https://r2.syntx.ai/uni/snapshot.png");
  assert.equal(fetchCalls, 1);
  assert.ok(retainedForm);
  assert.equal(retainedForm.get("files"), null);
});

test("caller abort and absolute upload timeout stop after one POST without retry", async () => {
  const request = { model_id: "uni-1" as const, bytes: PNG, filename: "source.png", mime_type: "image/png" };
  let fetchCalls = 0;
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
  let retainedForm: FormData | undefined;
  const abortClient = new SyntxChatHttpClient({
    credentialBroker: broker(() => {}),
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      retainedForm = init?.body as FormData;
      fetchStarted();
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }
  });
  const controller = new AbortController();
  const pending = abortClient.uploadUniImageReference(request, controller.signal);
  await started;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 1);
  assert.ok(retainedForm);
  assert.equal(retainedForm.get("files"), null);

  const timeoutClient = new SyntxChatHttpClient({ requestTimeoutMs: 5, credentialBroker: broker(() => {}), fetchImpl: async (_input, init) => {
    fetchCalls += 1;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
  } });
  await assert.rejects(timeoutClient.uploadUniImageReference(request),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(fetchCalls, 2);
});
