import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { InternalUploadReference } from "../src/adapter/syntx/upload-reference-bridge.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  consumeOwnerVeoOmniValidatedReference,
  isOwnerVeoOmniValidatedReference,
  type OwnerVeoOmniValidatedReference,
  validateOwnerVeoOmniReferenceInput
} from "../src/application/owner-veo-omni-reference-input-validator.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const CREDENTIAL = "synthetic-veo-omni-upload-credential";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function broker(onUse: () => void): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    onUse();
    return operation(CREDENTIAL);
  } };
}

function nativeUpload(client: SyntxChatHttpClient, receipt: unknown, signal?: AbortSignal): Promise<InternalUploadReference> {
  const method = Reflect.get(client, "uploadOwnerVeoOmniReference");
  assert.equal(typeof method, "function", "the native client exposes the fixed owner Omni upload method");
  return Reflect.apply(method as (receipt: unknown, signal?: AbortSignal) => Promise<InternalUploadReference>, client, [receipt, signal]);
}

async function genuineReceipt(bytes: Uint8Array = PNG_1X1): Promise<Readonly<OwnerVeoOmniValidatedReference>> {
  return validateOwnerVeoOmniReferenceInput({ filename: "source.png", mime_type: "image/png", bytes, ffprobePath: process.execPath });
}

test("uploads a genuine receipt once with the fixed Omni multipart tuple and preserves its private byte snapshot", async () => {
  const callerBytes = Buffer.from(PNG_1X1), expected = Buffer.from(callerBytes);
  const receipt = await genuineReceipt(callerBytes);
  callerBytes.fill(0);
  let fetchCalls = 0, credentialCalls = 0;
  let retainedForm: FormData | undefined;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    retainedForm = init?.body as FormData;
    assert.deepEqual(Array.from(retainedForm.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(retainedForm.get("destination"), "uploaded");
    assert.equal(retainedForm.get("check_duplicates"), "true");
    assert.equal(retainedForm.get("model_type"), "veo_omni");
    const file = retainedForm.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "source.png");
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), expected);
    return jsonResponse({ files: [{ id: "veo-omni-upload-1", url: "https://r2.syntx.ai/veo-omni/source.png",
      status: "uploaded", mime_type: "image/png", size: expected.byteLength }] });
  } });

  const result = await nativeUpload(client, receipt);
  assert.deepEqual(result, { file_id: "veo-omni-upload-1", url: "https://r2.syntx.ai/veo-omni/source.png" });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls, 1);
  assert.equal(isOwnerVeoOmniValidatedReference(receipt), false);
  assert.ok(retainedForm);
  assert.equal(retainedForm.get("files"), null);
});

test("rejects cloned and already-consumed receipts before credential use or fetch", async () => {
  let fetchCalls = 0, credentialCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async () => {
    fetchCalls += 1;
    return jsonResponse({ files: [{ url: "https://r2.syntx.ai/veo-omni/unused.png" }] });
  } });
  const receipt = await genuineReceipt();
  const cloned = Object.freeze({ ...receipt });
  await assert.rejects(nativeUpload(client, cloned), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  const consumed = consumeOwnerVeoOmniValidatedReference(receipt);
  consumed.bytes.fill(0);
  await assert.rejects(nativeUpload(client, receipt), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("rejects ambiguous, unsafe, and mismatched upload receipts after exactly one POST", async () => {
  const size = PNG_1X1.byteLength;
  const valid = { id: "veo-upload-1", url: "https://r2.syntx.ai/veo-omni/source.png", mime_type: "image/png", size };
  const invalidResponses: unknown[] = [
    {}, { files: [] }, { files: [valid, { ...valid, id: "veo-upload-2" }] },
    { files: [{ ...valid, url: "https://attacker.invalid/private.png" }] },
    { files: [{ ...valid, mime_type: "image/jpeg" }] },
    { files: [{ ...valid, size: size + 1 }] },
    { files: [{ ...valid, status: "error" }] },
    { files: [{ ...valid, id: "one", file_id: "two" }] }
  ];
  for (const response of invalidResponses) {
    let fetchCalls = 0, form: FormData | undefined;
    const client = new SyntxChatHttpClient({ credentialBroker: broker(() => {}), fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      form = init?.body as FormData;
      return jsonResponse(response);
    } });
    const receipt = await genuineReceipt();
    await assert.rejects(nativeUpload(client, receipt), (error: unknown) => error instanceof SyntxHttpError &&
      error.code === "UPSTREAM_PROTOCOL_ERROR" && !error.message.includes("attacker.invalid") && !error.message.includes("private.png"));
    assert.equal(fetchCalls, 1);
    assert.equal(isOwnerVeoOmniValidatedReference(receipt), false);
    assert.ok(form);
    assert.equal(form.get("files"), null);
  }
});

test("HTTP and abort failures consume the receipt, release FormData, and never retry", async () => {
  let httpCalls = 0, httpForm: FormData | undefined;
  const httpClient = new SyntxChatHttpClient({ credentialBroker: broker(() => {}), fetchImpl: async (_input, init) => {
    httpCalls += 1;
    httpForm = init?.body as FormData;
    return jsonResponse({ rejected: true }, 503);
  } });
  const httpReceipt = await genuineReceipt();
  await assert.rejects(nativeUpload(httpClient, httpReceipt), (error: unknown) => error instanceof SyntxHttpError);
  assert.equal(httpCalls, 1);
  assert.equal(isOwnerVeoOmniValidatedReference(httpReceipt), false);
  assert.ok(httpForm);
  assert.equal(httpForm.get("files"), null);

  let beginFetch!: () => void, abortCalls = 0;
  const fetchStarted = new Promise<void>((resolve) => { beginFetch = resolve; });
  let abortForm: FormData | undefined;
  const abortClient = new SyntxChatHttpClient({ credentialBroker: broker(() => {}), fetchImpl: async (_input, init) => {
    abortCalls += 1;
    abortForm = init?.body as FormData;
    beginFetch();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const abortReceipt = await genuineReceipt();
  const controller = new AbortController();
  const pending = nativeUpload(abortClient, abortReceipt, controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(abortCalls, 1);
  assert.equal(isOwnerVeoOmniValidatedReference(abortReceipt), false);
  assert.ok(abortForm);
  assert.equal(abortForm.get("files"), null);
});

test("keeps the existing generic upload path capped at 10 MiB", async () => {
  let credentialCalls = 0, fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(() => { credentialCalls += 1; }), fetchImpl: async () => {
    fetchCalls += 1;
    return jsonResponse({ files: [] });
  } });
  const oversized = new Uint8Array(10 * 1024 * 1024 + 1);
  await assert.rejects(client.uploadFile({ bytes: oversized, filename: "too-large.png", mime_type: "image/png",
    destination: "uploaded", check_duplicates: true, model_type: "veo_omni" } as never), (error: unknown) =>
    error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});
