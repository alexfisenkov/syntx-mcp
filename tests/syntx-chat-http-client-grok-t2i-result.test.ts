import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OWNER_GROK_T2I_MODELS, type OwnerGrokT2iModel } from "../src/application/owner-grok-t2i-parameters.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const HOST = "https://r2.syntx.ai/owned/";
const CHAT = "grok-t2i-chat-1";
const BOT_MESSAGE = "grok-t2i-result-1";
const PROVIDER_CHAT_ID = "12345";

function context(model_id: OwnerGrokT2iModel, outputCount: number) {
  return {
    chat_uuid: CHAT, message_id: BOT_MESSAGE, model_id, provider_chat_id: PROVIDER_CHAT_ID,
    message_object_ids: Array.from({ length: outputCount }, (_, index) => `grok-t2i-object-${index + 1}`),
    requested_batch_size: outputCount
  };
}

function message(model_id: string, count: number) {
  return {
    id: BOT_MESSAGE, chat_id: Number(PROVIDER_CHAT_ID), author_id: -1,
    message_object: Array.from({ length: count }, (_, index) => ({
      id: `grok-t2i-object-${index + 1}`, message_id: BOT_MESSAGE, object_type: "image",
      model_type: model_id, completed: true, object_url: `${HOST}grok-t2i-${index + 1}.png`
    }))
  };
}

function createClient(fetchImpl: typeof fetch) {
  let credentialCalls = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential(operation) {
      credentialCalls += 1;
      return operation("synthetic-grok-t2i-http-credential");
    }
  };
  return { client: new SyntxChatHttpClient({ credentialBroker, fetchImpl }), credentialCalls: () => credentialCalls };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

test("separate T2I result GET binds every full4 model and requested batch 1..5 in exact object order", async () => {
  for (const model_id of OWNER_GROK_T2I_MODELS) {
    for (const outputCount of [1, 2, 3, 4, 5]) {
      const requests: Array<{ url: string; method: string }> = [];
      const harness = createClient(async (input, init) => {
        requests.push({ url: String(input), method: init?.method ?? "GET" });
        return json(message(model_id, outputCount));
      });
      const result = await harness.client.getGrokT2iBatchMessage(context(model_id, outputCount));
      assert.equal(result.status, "COMPLETE", `${model_id} batch ${outputCount}`);
      if (result.status !== "COMPLETE") continue;
      assert.equal(result.model_id, model_id);
      assert.equal(result.provider_chat_id, PROVIDER_CHAT_ID);
      assert.deepEqual(result.objects.map((item) => item.message_object_id), context(model_id, outputCount).message_object_ids);
      assert.ok(result.objects.every((item) => item.model_id === model_id && item.object_type === "image" &&
        item.completed === true && item.mime_type === "image/png" && item.mime_source === "URL_EXTENSION"));
      assert.deepEqual(requests, [{ url: `https://api.syntx.ai/api/v1/chats/${CHAT}/${BOT_MESSAGE}`, method: "GET" }]);
      assert.equal(harness.credentialCalls(), 1);
      assert.equal(result.backend_acceptance, "UNPROVEN");
    }
  }
});

test("a short fully completed provider batch is preserved as PARTIAL, not mistaken for pending or complete", async () => {
  const requested = context("grok_imagine_2", 5);
  const harness = createClient(async () => json(message("grok_imagine_2", 2)));
  const result = await harness.client.getGrokT2iBatchMessage(requested);
  assert.equal(result.status, "PARTIAL");
  if (result.status !== "PARTIAL") return;
  assert.equal(result.actual_result_count, 2);
  assert.equal(result.batch_count_matches_requested, false);
  assert.equal(result.requested_batch_size, 5);
  assert.deepEqual(result.objects.map((item) => item.message_object_id), requested.message_object_ids.slice(0, 2));
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("a known incomplete object remains PENDING rather than exposing a completed subset", async () => {
  const requested = context("grok_imagine_quality", 2);
  const raw = message("grok_imagine_quality", 2);
  raw.message_object[1]!.completed = false;
  const harness = createClient(async () => json(raw));
  const result = await harness.client.getGrokT2iBatchMessage(requested);
  assert.equal(result.status, "PENDING");
  if (result.status === "PENDING") assert.equal(result.reason, "RESULT_OBJECTS_PENDING");
});

test("wrong message, foreign chat, author, namespace, object IDs/order, count, and unsafe URLs fail closed", async () => {
  const requested = context("grok_imagine_quality", 2);
  const badCases: Array<[string, unknown]> = [
    ["outer message", { ...message("grok_imagine_quality", 2), id: "other-message" }],
    ["foreign chat", { ...message("grok_imagine_quality", 2), chat_id: 777 }],
    ["non-bot author", { ...message("grok_imagine_quality", 2), author_id: 99 }],
    ["foreign model namespace", message("grok_i2i", 2)],
    ["wrong object type", { ...message("grok_imagine_quality", 2), message_object: message("grok_imagine_quality", 2).message_object.map((item) => ({ ...item, object_type: "video" })) }],
    ["wrong ordered object id", { ...message("grok_imagine_quality", 2), message_object: [...message("grok_imagine_quality", 2).message_object].reverse() }],
    ["duplicate object id", { ...message("grok_imagine_quality", 2), message_object: message("grok_imagine_quality", 2).message_object.map((item) => ({ ...item, id: "same" })) }],
    ["duplicate URL", { ...message("grok_imagine_quality", 2), message_object: message("grok_imagine_quality", 2).message_object.map((item) => ({ ...item, object_url: `${HOST}same.png` })) }],
    ["count above request", message("grok_imagine_quality", 3)],
    ["unsafe URL", { ...message("grok_imagine_quality", 2), message_object: message("grok_imagine_quality", 2).message_object.map((item) => ({ ...item, object_url: "https://evil.example/secret.png" })) }]
  ];
  for (const [label, raw] of badCases) {
    let calls = 0;
    const harness = createClient(async () => { calls += 1; return json(raw); });
    const result = await harness.client.getGrokT2iBatchMessage(requested);
    assert.equal(result.status, "UNVERIFIED", label);
    assert.equal(calls, 1, `${label} must not trigger fallback/retry`);
    assert.equal(JSON.stringify(result).includes("evil.example"), false, `${label} must not expose untrusted URL`);
  }
});

test("rejects malformed read context before credentials or network and aborts the single fixed GET", async () => {
  let fetchCalls = 0;
  const harness = createClient(async () => { fetchCalls += 1; return json(message("grok_imagine_2", 1)); });
  await assert.rejects(harness.client.getGrokT2iBatchMessage({ ...context("grok_imagine_2", 1), extra: "no" }));
  assert.equal(fetchCalls, 0);
  assert.equal(harness.credentialCalls(), 0);

  const aborter = new AbortController();
  let observedSignal: AbortSignal | undefined;
  let started!: () => void;
  const startedPromise = new Promise<void>((resolve) => { started = resolve; });
  const abortHarness = createClient((_input, init) => {
    observedSignal = init?.signal ?? undefined;
    started();
    return new Promise<Response>((_resolve, reject) => {
      observedSignal?.addEventListener("abort", () => reject(new DOMException("private upstream body", "AbortError")), { once: true });
    });
  });
  const pending = abortHarness.client.getGrokT2iBatchMessage(context("grok_imagine_2", 1), aborter.signal);
  await startedPromise;
  aborter.abort();
  await assert.rejects(pending);
  assert.equal(observedSignal?.aborted, true);
  assert.equal(abortHarness.credentialCalls(), 1);
});
