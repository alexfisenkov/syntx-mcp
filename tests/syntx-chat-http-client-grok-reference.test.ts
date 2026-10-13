import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { InternalUploadReference } from "../src/adapter/syntx/upload-reference-bridge.js";
import type { StartImageRequest } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const HOST = "https://r2.syntx.ai/owned/";
const RATIOS = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"] as const;
type GrokModel = "grok_i2i" | "grok_i2i_pro";

function createClient(fetchImpl: typeof fetch) {
  let credentialCalls = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential(operation) {
      credentialCalls += 1;
      return operation("synthetic-grok-http-credential");
    }
  };
  return { client: new SyntxChatHttpClient({ credentialBroker, fetchImpl }), credentialCalls: () => credentialCalls };
}

function makeRequest(modelType: GrokModel, overrides: Record<string, unknown> = {}): StartImageRequest {
  const settings: Record<string, unknown> = {
    model_type: modelType, resolution: "1k", batch_size: 1, n: 1, file_urls: [],
    ...(modelType === "grok_i2i_pro" ? {} : {}),
    ...overrides
  };
  return { ai_name: "grok_image", chat_uuid: "grok-chat-1", prompt: "A source photo", settings };
}

function refs(count: number): InternalUploadReference[] {
  return Array.from({ length: count }, (_, index) => ({
    file_id: `grok-file-${index + 1}`,
    url: `${HOST}reference-${index + 1}.png`
  }));
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function botMessage(modelType: GrokModel, count: number, customize: (object: Record<string, unknown>, index: number) => Record<string, unknown> = (object) => object) {
  return {
    id: "grok-result-1",
    author_id: -1,
    message_object: Array.from({ length: count }, (_, index) => customize({
      id: `grok-object-${index + 1}`,
      message_id: "grok-result-1",
      object_type: "image",
      model_type: modelType,
      completed: true,
      object_url: `${HOST}result-${index + 1}.jpg`
    }, index))
  };
}

test("Grok HTTP bridge preserves ordered 1-3 I2I references and explicit batch settings", async () => {
  const cases = [
    ...[[1, 1], [2, 2], [3, 3], [2, 4], [3, 5]] as const,
    ...RATIOS.map((ratio) => [2, 4, ratio] as const)
  ];
  for (const [referenceCount, batchSize, ratio] of cases) {
    const bodies: Array<Record<string, unknown>> = [];
    const harness = createClient(async (_input, init) => {
      assert.equal(init?.method, "POST");
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return json({ id: `grok-echo-${referenceCount}` });
    });
    const settings = {
      ...makeRequest("grok_i2i").settings,
      batch_size: batchSize,
      ...(referenceCount === 1 ? {} : { aspect_ratio: ratio ?? "4:3" })
    };
    const receipt = await harness.client.startGrokImageWithInternalReferences(
      { ...makeRequest("grok_i2i"), settings }, refs(referenceCount)
    );
    assert.deepEqual(receipt, { chat_uuid: "grok-chat-1", message_id: `grok-echo-${referenceCount}` });
    assert.deepEqual((bodies[0]!.settings as Record<string, unknown>).file_urls,
      refs(referenceCount).map((reference) => ({ type: "image", url: reference.url })));
    assert.equal(bodies.length, 1, "one Grok dispatch call must emit one HTTP POST");
    assert.equal((bodies[0]!.settings as Record<string, unknown>).batch_size, batchSize);
    assert.equal(harness.credentialCalls(), 1);
  }
});

test("Grok Pro bridge permits exactly one reference, omits ratio, and keeps canonical request body", async () => {
  let body: Record<string, unknown> | undefined;
  const harness = createClient(async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return json({ id: "grok-pro-echo" });
  });
  const proRequest = makeRequest("grok_i2i_pro", { batch_size: 5 });
  const proSettings = { ...proRequest.settings };
  delete proSettings.file_urls;
  await harness.client.startGrokImageWithInternalReferences(
    { ...proRequest, settings: proSettings }, refs(1)
  );
  assert.deepEqual(Object.keys(body!).sort(), ["chat_uuid", "prompt", "settings"]);
  assert.equal((body!.settings as Record<string, unknown>).aspect_ratio, undefined);
  assert.deepEqual((body!.settings as Record<string, unknown>).file_urls,
    [{ type: "image", url: `${HOST}reference-1.png` }]);
});

test("Grok bridge rejects wrong model, reference counts, URL fields, and settings before credentials or fetch", async () => {
  let fetchCalls = 0;
  const harness = createClient(async () => { fetchCalls += 1; return json({ id: "unexpected" }); });
  const cases: Array<{ request: StartImageRequest; references: unknown }> = [
    { request: makeRequest("grok_i2i"), references: [] },
    { request: makeRequest("grok_i2i"), references: refs(4) },
    { request: makeRequest("grok_i2i_pro"), references: refs(2) },
    { request: { ...makeRequest("grok_i2i"), ai_name: "banana" }, references: refs(1) },
    { request: makeRequest("grok_i2i", { model_type: "banana" }), references: refs(1) },
    { request: makeRequest("grok_i2i", { batch_size: 0 }), references: refs(1) },
    { request: makeRequest("grok_i2i", { batch_size: 5.5 }), references: refs(1) },
    { request: makeRequest("grok_i2i", { batch_size: 6 }), references: refs(1) },
    { request: makeRequest("grok_i2i", { n: 2 }), references: refs(1) },
    { request: makeRequest("grok_i2i", { resolution: "4k" }), references: refs(1) },
    { request: makeRequest("grok_i2i", { aspect_ratio: "4:3" }), references: refs(1) },
    { request: makeRequest("grok_i2i", { aspect_ratio: "unknown" }), references: refs(2) },
    { request: makeRequest("grok_i2i_pro", { aspect_ratio: "1:1" }), references: refs(1) },
    { request: makeRequest("grok_i2i", { file_urls: ["https://caller.invalid/x.png"] }), references: refs(1) },
    { request: makeRequest("grok_i2i"), references: [{ url: "https://evil.invalid/input.png" }] },
    { request: makeRequest("grok_i2i"), references: [refs(1)[0], refs(1)[0]] }
  ];
  for (const [index, invalid] of cases.entries()) {
    await assert.rejects(() => harness.client.startGrokImageWithInternalReferences(
      invalid.request, invalid.references as never
    ), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST", `invalid case ${index}`);
  }
  assert.equal(harness.credentialCalls(), 0);
  assert.equal(fetchCalls, 0);
});

test("Grok bridge rejects unsafe reference containers and a forbidden quality field before fetch", async () => {
  let fetchCalls = 0;
  const harness = createClient(async () => { fetchCalls += 1; return json({ id: "unexpected" }); });
  const withGetter = [{ url: `${HOST}one.jpg` }];
  Object.defineProperty(withGetter[0]!, "file_id", { enumerable: true, get() { throw new Error("must not run"); } });
  const withSymbol = Object.assign([{ url: `${HOST}one.jpg` }], { [Symbol("extra")]: true });
  const withCustomPrototype = Object.setPrototypeOf([{ url: `${HOST}one.jpg` }], { inherited: true }) as unknown[];
  const proxy = new Proxy([{ url: `${HOST}one.jpg` }], {});
  for (const bad of [withGetter, withSymbol, withCustomPrototype, proxy]) {
    await assert.rejects(() => harness.client.startGrokImageWithInternalReferences(
      makeRequest("grok_i2i"), bad as never
    ), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  await assert.rejects(() => harness.client.startGrokImageWithInternalReferences(
    makeRequest("grok_i2i", { batch_size: 1, details_quality: "low" }), refs(1)
  ), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(harness.credentialCalls(), 0);
  assert.equal(fetchCalls, 0);
});

test("Grok result GET decodes five ordered bot images with per-object MIME provenance", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const harness = createClient(async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return json(botMessage("grok_i2i", 5));
  });
  const result = await harness.client.getGrokImageBatchMessage("grok-chat-1", "grok-result-1", "grok_i2i");
  assert.equal(result.status, "COMPLETE");
  if (result.status !== "COMPLETE") throw new Error("expected verified batch");
  assert.equal(result.objects.length, 5);
  assert.deepEqual(result.objects.map((item) => item.message_object_id),
    ["grok-object-1", "grok-object-2", "grok-object-3", "grok-object-4", "grok-object-5"]);
  assert.ok(result.objects.every((item) => item.model_type === "grok_i2i" && item.object_type === "image" && item.mime_type === "image/jpeg" && item.mime_source === "URL_EXTENSION"));
  assert.deepEqual(requests, [{ url: "https://api.syntx.ai/api/v1/chats/grok-chat-1/grok-result-1", method: "GET" }]);
  assert.equal(harness.credentialCalls(), 1);
});

test("Grok result GET returns unverified for owner/pending/mixed/duplicate/oversize/unknown MIME results", async () => {
  const invalidMessages = [
    { ...botMessage("grok_i2i", 1), author_id: 12 },
    { id: "grok-result-1", author_id: -1, message_object: [] },
    botMessage("grok_i2i", 1, (object) => ({ ...object, completed: false })),
    botMessage("grok_i2i", 1, (object) => ({ ...object, model_type: "grok_i2i_pro" })),
    botMessage("grok_i2i", 1, (object) => ({ ...object, object_type: "video" })),
    botMessage("grok_i2i", 6),
    botMessage("grok_i2i", 2, (object, index) => ({ ...object, id: index === 1 ? "grok-object-1" : object.id })),
    botMessage("grok_i2i", 2, (object, index) => ({ ...object, object_url: index === 1 ? `${HOST}result-1.jpg` : object.object_url })),
    botMessage("grok_i2i", 1, (object) => ({ ...object, object_url: `${HOST}result.unknown` })),
    botMessage("grok_i2i", 1, (object) => ({ ...object, object_url: "https://evil.invalid/result.jpg" }))
  ];
  for (const message of invalidMessages) {
    const harness = createClient(async () => json(message));
    const result = await harness.client.getGrokImageBatchMessage("grok-chat-1", "grok-result-1", "grok_i2i");
    assert.equal(result.status, "UNVERIFIED");
    assert.deepEqual(result.objects, []);
    assert.equal(harness.credentialCalls(), 1);
  }
});

test("Grok result GET rejects unsupported model types and does not dispatch or retry", async () => {
  let getCalls = 0;
  const harness = createClient(async () => { getCalls += 1; return json(botMessage("grok_i2i", 1)); });
  await assert.rejects(() => harness.client.getGrokImageBatchMessage(
    "grok-chat-1", "grok-result-1", "banana" as never
  ), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(harness.credentialCalls(), 0);
  assert.equal(getCalls, 0);

  const failed = createClient(async (_input, init) => {
    assert.equal(init?.method, "GET");
    getCalls += 1;
    throw new Error("synthetic GET failure");
  });
  await assert.rejects(() => failed.client.getGrokImageBatchMessage("grok-chat-1", "grok-result-1", "grok_i2i"));
  assert.equal(getCalls, 1);
  assert.equal(failed.credentialCalls(), 1);
});

test("Grok dispatch transport failure is ambiguous and never retries the internal or ordinary POST", async () => {
  let fetchCalls = 0;
  const harness = createClient(async (_input, init) => {
    fetchCalls += 1;
    assert.equal(init?.method, "POST");
    assert.match(String(_input), /\/design\/generate\?ai_name=grok_image/u);
    throw new Error("synthetic network failure");
  });
  await assert.rejects(() => harness.client.startGrokImageWithInternalReferences(
    makeRequest("grok_i2i", { batch_size: 2, aspect_ratio: "4:3" }), refs(2)
  ));
  assert.equal(fetchCalls, 1);
  assert.equal(harness.credentialCalls(), 1);
});
