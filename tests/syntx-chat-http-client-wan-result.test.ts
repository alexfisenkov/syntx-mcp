import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import type { OwnerWanImageVariant } from "../src/application/owner-wan-image-parameters.js";

const HOST = "https://r2.syntx.ai/wan/";
const VARIANTS: readonly OwnerWanImageVariant[] = [
  "wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"
];

function createClient(fetchImpl: typeof fetch, requestTimeoutMs?: number) {
  let credentialCalls = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential(operation) {
      credentialCalls += 1;
      return operation("synthetic-wan-http-credential");
    }
  };
  return {
    client: new SyntxChatHttpClient({ credentialBroker, fetchImpl, ...(requestTimeoutMs ? { requestTimeoutMs } : {}) }),
    credentialCalls: () => credentialCalls
  };
}

function context(variant = "wan_27_image", batchSize = 2, ids = ["object-1", "object-2"]) {
  return {
    chat_uuid: "wan-chat", message_id: "bot-result", variant, provider_chat_id: "2048",
    message_object_ids: ids, requested_batch_size: batchSize
  };
}

function rawMessage(variant = "wan_27_image", urls = [`${HOST}one.png`, `${HOST}two.bmp`]) {
  return {
    id: "bot-result", chat_id: 2048, author_id: -1,
    message_object: urls.map((object_url, index) => ({
      id: `object-${index + 1}`, message_id: "bot-result", object_type: "image", model_type: variant,
      completed: true, object_url
    }))
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("WAN result GET returns the exact ordered batch with URL-only MIME provenance", async () => {
  const requests: Array<{ url: string; method: string }> = [];
  const harness = createClient(async (input, init) => {
    requests.push({ url: String(input), method: init?.method ?? "GET" });
    return json(rawMessage());
  });
  const result = await harness.client.getWanImageResult(context());
  assert.equal(result.status, "COMPLETE");
  if (result.status !== "COMPLETE") throw new Error("expected completed WAN batch");
  assert.deepEqual(result.artifacts.map((artifact) => [artifact.message_object_id, artifact.mime_type, artifact.mime_source]), [
    ["object-1", "image/png", "URL_EXTENSION"],
    ["object-2", "image/bmp", "URL_EXTENSION"]
  ]);
  assert.deepEqual(requests, [{ url: "https://api.syntx.ai/api/v1/chats/wan-chat/bot-result", method: "GET" }]);
  assert.equal(harness.credentialCalls(), 1);
});

test("WAN native result decoder covers every exact variant and requested batch 1-4", async () => {
  for (const variant of VARIANTS) {
    for (let batchSize = 1; batchSize <= 4; batchSize += 1) {
      const ids = Array.from({ length: batchSize }, (_, index) => `object-${index + 1}`);
      const harness = createClient(async () => json(rawMessage(variant, ids.map((_, index) => `${HOST}${index + 1}.avif`))));
      const result = await harness.client.getWanImageResult(context(variant, batchSize, ids));
      assert.equal(result.status, "COMPLETE", `${variant} batch ${batchSize}`);
      if (result.status === "COMPLETE") {
        assert.equal(result.artifacts.length, batchSize);
        assert.ok(result.artifacts.every((artifact) => artifact.model_type === variant && artifact.mime_type === "image/avif"));
      }
      assert.equal(harness.credentialCalls(), 1);
    }
  }
});

test("WAN native decoder leaves absent or unfinished results pending and closes all mismatches", async () => {
  const pendingCases = [
    { ...rawMessage(), message_object: [] },
    rawMessage("wan_27_image", [`${HOST}one.png`]).message_object.map((object) => ({ ...object, completed: false })),
    rawMessage("wan_27_image", [`${HOST}one.png`])
  ];
  const pendingExpected = ["NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESULT_BATCH_PENDING"] as const;
  for (let index = 0; index < pendingCases.length; index += 1) {
    const payload = Array.isArray(pendingCases[index])
      ? { ...rawMessage("wan_27_image", [`${HOST}one.png`]), message_object: pendingCases[index] }
      : pendingCases[index];
    const harness = createClient(async () => json(payload));
    const result = await harness.client.getWanImageResult(context());
    assert.equal(result.status, "PENDING");
    if (result.status === "PENDING") assert.equal(result.reason, pendingExpected[index]);
  }

  const invalidMessages = [
    { ...rawMessage(), id: "other-message" },
    { ...rawMessage(), chat_id: 2049 },
    { ...rawMessage(), author_id: 42 },
    rawMessage("wan_27_image", [`${HOST}one.png`, `${HOST}two.png`]).message_object.map((object, index) =>
      ({ ...object, id: index === 1 ? "object-1" : object.id })),
    [...rawMessage("wan_27_image", [`${HOST}one.png`, `${HOST}two.png`]).message_object].reverse(),
    rawMessage("wan_27_image", [`${HOST}one.png`, `${HOST}two.png`]).message_object.map((object, index) =>
      ({ ...object, id: `object-${index + 1}`, message_id: index === 1 ? "other-message" : object.message_id })),
    rawMessage("wan_27_image", [`${HOST}one.png`, `${HOST}two.png`]).message_object.map((object, index) =>
      ({ ...object, object_type: index === 1 ? "video" : object.object_type })),
    rawMessage("wan_27_image", [`${HOST}one.png`, `${HOST}two.png`]).message_object.map((object, index) =>
      ({ ...object, model_type: index === 1 ? "wan_27_image_pro" : object.model_type })),
    rawMessage("wan_27_image", [`${HOST}one.png`, `${HOST}two.png`]).message_object.map((object, index) =>
      ({ ...object, model_type: index === 1 ? undefined : object.model_type })),
    rawMessage("wan_27_image", [`${HOST}one.png`, "https://evil.invalid/two.png"]),
    rawMessage("wan_27_image", [`${HOST}one.png`, `${HOST}one.png`]),
    rawMessage("wan_27_image", [`${HOST}one.png`, `${HOST}two.png`, `${HOST}three.png`])
  ];
  for (const message of invalidMessages) {
    const payload = Array.isArray(message)
      ? { ...rawMessage(), message_object: message, prompt: "PRIVATE_PROMPT_SENTINEL" }
      : message;
    const harness = createClient(async () => json(payload));
    const result = await harness.client.getWanImageResult(context());
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(JSON.stringify(result).includes("PRIVATE_PROMPT_SENTINEL"), false);
    assert.equal(JSON.stringify(result).includes("evil.invalid"), false);
  }

  const unknownRaw = rawMessage("wan_27_image", [`${HOST}one.tiff`, `${HOST}asset?filename=image.png`]);
  for (const object of unknownRaw.message_object) Object.assign(object, { mime_type: "image/jpeg" });
  const unknownMime = createClient(async () => json(unknownRaw));
  const unknownResult = await unknownMime.client.getWanImageResult(context());
  assert.equal(unknownResult.status, "COMPLETE");
  if (unknownResult.status === "COMPLETE") {
    assert.deepEqual(unknownResult.artifacts.map((artifact) => [artifact.mime_type, artifact.mime_source]), [
      [null, "UNKNOWN"], [null, "UNKNOWN"]
    ]);
  }
});

test("WAN result validates exact ordered context before credentials or GET", async () => {
  let fetchCalls = 0;
  const harness = createClient(async () => { fetchCalls += 1; return json(rawMessage()); });
  const duplicateIds = context();
  duplicateIds.message_object_ids = ["object-1", "object-1"];
  const wrongCount = context();
  wrongCount.requested_batch_size = 1;
  const alias = context("wan_27_image_alias");
  const getter = context();
  Object.defineProperty(getter, "variant", { enumerable: true, get() { throw new Error("must not execute"); } });
  const proxy = new Proxy(context(), {});
  for (const invalidContext of [duplicateIds, wrongCount, alias, getter, proxy]) {
    await assert.rejects(() => harness.client.getWanImageResult(invalidContext),
      (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  }
  assert.equal(fetchCalls, 0);
  assert.equal(harness.credentialCalls(), 0);
});

test("WAN result snapshots the ordered IDs before await and never repeats an aborted or timed out GET", async () => {
  let resolveResponse: ((response: Response) => void) | undefined;
  const delayed = createClient(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
  const mutable = context();
  const pending = delayed.client.getWanImageResult(mutable);
  mutable.message_object_ids[0] = "changed-after-call";
  resolveResponse!(json(rawMessage()));
  const completed = await pending;
  assert.equal(completed.status, "COMPLETE");
  assert.deepEqual(completed.message_object_ids, ["object-1", "object-2"]);

  let abortedFetches = 0;
  const abortedHarness = createClient(async () => { abortedFetches += 1; return json(rawMessage()); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => abortedHarness.client.getWanImageResult(context(), controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(abortedFetches, 0);
  assert.equal(abortedHarness.credentialCalls(), 0);

  let deadlineFetches = 0;
  const deadlineHarness = createClient(async () => {
    deadlineFetches += 1;
    return new Promise<Response>(() => undefined);
  }, 5);
  await assert.rejects(() => deadlineHarness.client.getWanImageResult(context()),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_TIMEOUT");
  assert.equal(deadlineFetches, 1);
  assert.equal(deadlineHarness.credentialCalls(), 1);
});
