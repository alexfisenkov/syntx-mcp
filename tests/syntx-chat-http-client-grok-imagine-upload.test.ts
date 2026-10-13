import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const CREDENTIAL = "synthetic-grok-imagine-upload-credential";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function broker(onCredential: () => void): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    onCredential();
    return operation(CREDENTIAL);
  } };
}

test("Grok Imagine upload uses the fixed ordinary native multipart route and returns one internal receipt", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
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
      assert.equal(form.get("model_type"), "grok_imagine_2");
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.name, "source.png");
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG_1X1);
      return jsonResponse({ files: [{ id: "grok-imagine-upload-1", url: "https://r2.syntx.ai/grok-imagine/source.png",
        mime_type: "image/png", size: PNG_1X1.byteLength }] });
    }
  });

  const result = await client.uploadGrokImagineImageReference({
    model_id: "grok_imagine_2", bytes: PNG_1X1, filename: "source.png", mime_type: "image/png"
  });

  assert.deepEqual(result, { file_id: "grok-imagine-upload-1", url: "https://r2.syntx.ai/grok-imagine/source.png" });
  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls, 1);
  assert.ok(PNG_1X1.some((byte) => byte !== 0), "caller-owned bytes remain intact");
});

test("only the two source-uploadable Grok Imagine model IDs are sent as multipart model_type", async () => {
  const sentModelTypes: string[] = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => {}),
    fetchImpl: async (_input, init) => {
      const form = init?.body as FormData;
      sentModelTypes.push(String(form.get("model_type")));
      const file = form.get("files");
      assert.ok(file instanceof File);
      return jsonResponse({ files: [{ url: `https://r2.syntx.ai/grok-imagine/${sentModelTypes.length}.png`,
        mime_type: "image/png", size: PNG_1X1.byteLength }] });
    }
  });

  for (const model_id of ["grok_imagine_2", "grok_imagine_quality"] as const) {
    const result = await client.uploadGrokImagineImageReference({ model_id, bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" });
    assert.equal(result.url, `https://r2.syntx.ai/grok-imagine/${sentModelTypes.length}.png`);
  }
  assert.deepEqual(sentModelTypes, ["grok_imagine_2", "grok_imagine_quality"]);
});

test("non-uploadable models and hostile/foreign request shapes reject before credentials or fetch", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  let getterCalls = 0;
  let proxyTraps = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(() => { credentialCalls += 1; }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  const base = { model_id: "grok_imagine_2", bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" };
  const accessor = { bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" };
  Object.defineProperty(accessor, "model_id", { enumerable: true, get() { getterCalls += 1; return base.model_id; } });
  const proxied = new Proxy(base, { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
  const sharedBuffer = new SharedArrayBuffer(PNG_1X1.byteLength);
  new Uint8Array(sharedBuffer).set(PNG_1X1);
  const invalid: unknown[] = [
    { ...base, model_id: "grok_t2i" },
    { ...base, model_id: "grok_t2i_pro" },
    { ...base, model_id: "grok_imagine_3" },
    { ...base, mime_type: "image/gif" },
    { ...base, destination: "hidden" },
    { ...base, reference_count: 5 },
    accessor,
    proxied,
    { ...base, bytes: new Uint8Array(sharedBuffer) }
  ];

  for (const input of invalid) {
    await assert.rejects(client.uploadGrokImagineImageReference(input as never), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(getterCalls, 0);
  assert.equal(proxyTraps, 0);
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
});

test("credential failure stops before fetch and cannot change the fixed upload route", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(_operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      throw new Error("No linked credential.");
    } },
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({}); }
  });
  await assert.rejects(client.uploadGrokImagineImageReference({
    model_id: "grok_imagine_quality", bytes: PNG_1X1, filename: "source.png", mime_type: "image/png"
  }), (error: unknown) => error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED");
  assert.equal(credentialCalls, 1);
  assert.equal(fetchCalls, 0);
});

test("ambiguous, unsafe, or mismatched native upload responses fail after one POST without echoing private values", async () => {
  const size = PNG_1X1.byteLength;
  const valid = { id: "grok-upload-1", url: "https://r2.syntx.ai/grok-imagine/input.png", mime_type: "image/png", size };
  const invalidResponses: unknown[] = [
    {}, { files: [] }, { files: [valid, valid] },
    { files: [{ ...valid, mime_type: "image/jpeg" }] },
    { files: [{ ...valid, size: size + 1 }] },
    { files: [{ ...valid, url: "https://attacker.invalid/private.png" }] },
    { files: [{ ...valid, url: "https://r2.syntx.ai/grok-imagine/private.png#fragment" }] },
    { files: [{ ...valid, file_id: "other-upload-id", id: "grok-upload-1" }] },
    { files: [{ ...valid, status: "error" }] },
    { files: [{ ...valid, size: 64 * 1024 * 1024 + 1 }] }
  ];
  for (const body of invalidResponses) {
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(() => {}),
      fetchImpl: async () => { fetchCalls += 1; return jsonResponse(body); }
    });
    await assert.rejects(client.uploadGrokImagineImageReference({
      model_id: "grok_imagine_2", bytes: PNG_1X1, filename: "source.png", mime_type: "image/png"
    }), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
      !error.message.includes("attacker.invalid") && !error.message.includes("other-upload-id"));
    assert.equal(fetchCalls, 1);
  }
});

test("client snapshots caller bytes before credential wait and releases the multipart file afterward", async () => {
  const source = Buffer.from(PNG_1X1);
  const expected = Buffer.from(source);
  let releaseCredential!: () => void;
  const credentialGate = new Promise<void>((resolve) => { releaseCredential = resolve; });
  let credentialCalls = 0;
  let fetchCalls = 0;
  let retainedForm: FormData | undefined;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      await credentialGate;
      return operation(CREDENTIAL);
    } },
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      retainedForm = init?.body as FormData;
      const file = retainedForm.get("files");
      assert.ok(file instanceof File);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), expected);
      return jsonResponse({ files: [{ url: "https://r2.syntx.ai/grok-imagine/snapshot.png", mime_type: "image/png", size: expected.byteLength }] });
    }
  });
  const pending = client.uploadGrokImagineImageReference({
    model_id: "grok_imagine_quality", bytes: source, filename: "snapshot.png", mime_type: "image/png"
  });
  source.fill(0);
  releaseCredential();
  await pending;
  assert.equal(credentialCalls, 1);
  assert.equal(fetchCalls, 1);
  assert.ok(retainedForm);
  assert.equal(retainedForm.get("files"), null);
});

test("redirect, caller abort, and upload timeout each stop after one POST", async () => {
  const request = { model_id: "grok_imagine_2" as const, bytes: PNG_1X1, filename: "source.png", mime_type: "image/png" };
  let fetchCalls = 0;
  const redirectResponse = jsonResponse({ files: [{ url: "https://r2.syntx.ai/grok-imagine/x.png", mime_type: "image/png", size: PNG_1X1.byteLength }] });
  Object.defineProperty(redirectResponse, "redirected", { value: true });
  const redirectClient = new SyntxChatHttpClient({ credentialBroker: broker(() => {}), fetchImpl: async () => {
    fetchCalls += 1;
    return redirectResponse;
  } });
  await assert.rejects(redirectClient.uploadGrokImagineImageReference(request), (error: unknown) =>
    error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  assert.equal(fetchCalls, 1);

  let beginFetch!: () => void;
  const fetchStarted = new Promise<void>((resolve) => { beginFetch = resolve; });
  const abortClient = new SyntxChatHttpClient({ credentialBroker: broker(() => {}), fetchImpl: async (_input, init) => {
    fetchCalls += 1;
    beginFetch();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  } });
  const controller = new AbortController();
  const pendingAbort = abortClient.uploadGrokImagineImageReference(request, controller.signal);
  await fetchStarted;
  controller.abort();
  await assert.rejects(pendingAbort, (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 2);

  const timeoutClient = new SyntxChatHttpClient({ requestTimeoutMs: 5, credentialBroker: broker(() => {}), fetchImpl: async (_input, init) => {
    fetchCalls += 1;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
  } });
  await assert.rejects(timeoutClient.uploadGrokImagineImageReference(request), (error: unknown) =>
    error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(fetchCalls, 3);
});
