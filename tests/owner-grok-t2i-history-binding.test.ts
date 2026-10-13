import assert from "node:assert/strict";
import test from "node:test";
import type { CorrelateOwnerGrokT2iHistoryBindingInput } from "../src/application/owner-grok-t2i-history-binding.js";

const moduleUrl = new URL("../src/application/owner-grok-t2i-history-binding.js", import.meta.url).href;
const MODELS = ["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"] as const;

function snapshot(modelId: string, refs: number, outputs: number) {
  return {
    complete: true, page: 1, page_size: 10, total_count: 2, total_pages: 1,
    has_next: false, has_previous: false, requested_chat_uuid: "chat-t2i-1", provider_chat_id: "12345",
    messages: [
      { message_id: "owner-ack-1", provider_chat_id: "12345", author_role: "owner",
        objects: Array.from({ length: refs }, (_, index) => ({ message_object_id: `input-${index + 1}`, object_type: "image", model_type: null })) },
      { message_id: "bot-result-1", provider_chat_id: "12345", author_role: "bot",
        objects: Array.from({ length: outputs }, (_, index) => ({ message_object_id: `output-${index + 1}`, object_type: "image", model_type: modelId })) }
    ]
  };
}

function request(modelId: typeof MODELS[number], requestedBatch: number, history = snapshot(modelId, 0, requestedBatch), refs = 0) {
  return {
    snapshot: history, requested_chat_uuid: "chat-t2i-1", owner_echo_message_id: "owner-ack-1", model_id: modelId,
    requested_batch_size: requestedBatch, expected_reference_count: refs,
    expected_reference_types: Array.from({ length: refs }, () => "image" as const),
    profile_binding: { profile_id: "owner-grok-t2i-source-profile-v1" as const, model_id: modelId,
      public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
      profile_schema_hash: `sha256:${"a".repeat(64)}` }
  };
}

test("binds each exact Grok T2I model to its profile fingerprint and ordered result objects", async () => {
  let module: Record<string, unknown> | null = null;
  try { module = await import(moduleUrl) as Record<string, unknown>; } catch { /* assertion below reports a missing module/API */ }
  assert.equal(typeof module?.correlateOwnerGrokT2iHistoryBinding, "function", "MISSING_OWNER_GROK_T2I_HISTORY_BINDER");
  const bind = module!.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  for (const model_id of MODELS) {
    const result = bind({
      snapshot: snapshot(model_id, 0, 2), requested_chat_uuid: "chat-t2i-1", owner_echo_message_id: "owner-ack-1",
      model_id, requested_batch_size: 2, expected_reference_count: 0, expected_reference_types: [],
      profile_binding: { profile_id: "owner-grok-t2i-source-profile-v1", model_id,
        public_catalog_version: "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json",
        profile_schema_hash: `sha256:${"a".repeat(64)}` }
    });
    assert.equal(result.status, "READY", model_id);
    assert.equal(result.model_id, model_id);
    assert.equal(result.profile_schema_hash, `sha256:${"a".repeat(64)}`);
    assert.equal(result.public_catalog_version, "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json");
    assert.deepEqual(result.message_object_ids, ["output-1", "output-2"]);
    assert.equal(result.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.reference_selector_confidence, "PUBLIC_METADATA_ONLY_NOT_UPLOAD_PERMISSION");
    assert.equal(Object.hasOwn(result, "artifact_urls"), false);
  }
});

test("the typed input omits derived selector confidence while runtime rejects caller-supplied confidence", async () => {
  const input: CorrelateOwnerGrokT2iHistoryBindingInput = request("grok_t2i", 1);
  assert.equal(Object.hasOwn(input, "reference_selector_confidence"), false);
  const module = await import(moduleUrl) as Record<string, unknown>;
  const bind = module.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  assert.equal(bind(input).status, "READY");
  assert.deepEqual(bind({ ...input, reference_selector_confidence: "PUBLIC_METADATA_ONLY_NOT_UPLOAD_PERMISSION" }),
    { status: "INVALID", reason: "INVALID_INPUT" });
});

test("selector confidence is source-derived output metadata, never a caller input flag", async () => {
  const input: CorrelateOwnerGrokT2iHistoryBindingInput = request("grok_t2i", 1);
  const module = await import(moduleUrl) as Record<string, unknown>;
  const bind = module.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  const ready = bind(input);
  assert.equal(ready.status, "READY");
  assert.equal(ready.reference_selector_confidence, "PUBLIC_METADATA_ONLY_NOT_UPLOAD_PERMISSION");
  assert.deepEqual(bind({ ...input, reference_selector_confidence: "PUBLIC_METADATA_ONLY_NOT_UPLOAD_PERMISSION" }),
    { status: "INVALID", reason: "INVALID_INPUT" });
});

test("rejects a well-formed profile fingerprint from a different catalog snapshot", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const bind = module.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  const result = bind({
    snapshot: snapshot("grok_t2i", 0, 1), requested_chat_uuid: "chat-t2i-1", owner_echo_message_id: "owner-ack-1",
    model_id: "grok_t2i", requested_batch_size: 1, expected_reference_count: 0, expected_reference_types: [],
    profile_binding: { profile_id: "owner-grok-t2i-source-profile-v1", model_id: "grok_t2i",
      public_catalog_version: `sha256-${"b".repeat(64)}.json`, profile_schema_hash: `sha256:${"a".repeat(64)}` }
  });
  assert.deepEqual(result, { status: "INVALID", reason: "INVALID_INPUT" });
});

test("does not bind image references above this model profile's selector maximum", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const bind = module.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  assert.deepEqual(bind(request("grok_t2i", 1, snapshot("grok_t2i", 1, 1), 1)), { status: "INVALID", reason: "INVALID_INPUT" });
  assert.deepEqual(bind(request("grok_t2i_pro", 1, snapshot("grok_t2i_pro", 1, 1), 1)), { status: "INVALID", reason: "INVALID_INPUT" });
  assert.equal(bind(request("grok_imagine_2", 1, snapshot("grok_imagine_2", 5, 1), 5)).status, "READY");
  assert.equal(bind(request("grok_imagine_quality", 1, snapshot("grok_imagine_quality", 3, 1), 3)).status, "READY");
});

test("preserves exact result order for requested batches one through five and marks shorter batches partial", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const bind = module.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  const expected = [
    ["a1"], ["b2", "b1"], ["c3", "c2", "c1"], ["d4", "d3", "d2", "d1"], ["e5", "e4", "e3", "e2", "e1"]
  ] as const;
  for (let batch = 1; batch <= 5; batch += 1) {
    const model = MODELS[batch % MODELS.length]!;
    const ids = expected[batch - 1]!;
    const exact = snapshot(model, 0, batch);
    exact.messages[1]!.objects = ids.map((message_object_id) => ({ message_object_id, object_type: "image", model_type: model }));
    const ready = bind(request(model, batch, exact));
    assert.equal(ready.status, "READY", `batch ${batch}`);
    assert.deepEqual(ready.message_object_ids, ids);
    assert.equal(ready.observed_output_count, batch);

    if (batch > 1) {
      const partial = snapshot(model, 0, batch - 1);
      partial.messages[1]!.objects = ids.slice(0, batch - 1).map((message_object_id) => ({ message_object_id, object_type: "image", model_type: model }));
      const result = bind(request(model, batch, partial));
      assert.equal(result.status, "PARTIAL", `partial batch ${batch}`);
      assert.equal(result.reason, "OUTPUT_BATCH_PARTIAL");
      assert.deepEqual(result.message_object_ids, ids.slice(0, batch - 1));
    }
  }
});

test("leaves empty output pending and fails closed on a bot object outside the exact T2I namespace", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const bind = module.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  const empty = bind(request("grok_t2i", 1, snapshot("grok_t2i", 0, 0)));
  assert.deepEqual(empty, { status: "PENDING", reason: "BOT_MESSAGE_NOT_FOUND" });

  const wrongNamespace = snapshot("grok_i2i", 0, 1);
  const unknown = bind(request("grok_t2i", 1, wrongNamespace));
  assert.deepEqual(unknown, { status: "UNVERIFIED", reason: "BOT_OUTPUT_NAMESPACE_UNVERIFIED" });
});

test("rejects ACK, chat, expected-reference, duplicate-ID, and shape mismatches without media fields", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const bind = module.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  const base = snapshot("grok_imagine_2", 2, 1);
  const accepted = bind(request("grok_imagine_2", 1, base, 2));
  assert.equal(accepted.status, "READY");

  const wrongChat = request("grok_imagine_2", 1, base, 2);
  wrongChat.snapshot = { ...base, requested_chat_uuid: "other-chat" };
  assert.deepEqual(bind(wrongChat), { status: "INVALID", reason: "CHAT_SCOPE_MISMATCH" });

  const wrongAck = request("grok_imagine_2", 1, base, 2);
  wrongAck.owner_echo_message_id = "not-the-ack";
  assert.deepEqual(bind(wrongAck), { status: "INVALID", reason: "OWNER_ACK_MISMATCH" });

  const wrongRefs = request("grok_imagine_2", 1, base, 1);
  assert.deepEqual(bind(wrongRefs), { status: "INVALID", reason: "OWNER_REFERENCE_SET_MISMATCH" });

  const duplicate = snapshot("grok_imagine_2", 2, 1);
  duplicate.messages[1]!.objects[0]!.message_object_id = "input-1";
  assert.deepEqual(bind(request("grok_imagine_2", 1, duplicate, 2)), { status: "INVALID", reason: "OBJECT_ID_DUPLICATE" });

  assert.equal(Object.hasOwn(accepted, "artifact_urls"), false);
  assert.equal(JSON.stringify(accepted).includes("object_url"), false);
  assert.equal(accepted.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
  assert.equal(accepted.backend_acceptance, "UNPROVEN");
});

test("handles no-ACK, multiple-bot, wrong-order, incomplete-page, getter, proxy, and unknown-field histories safely", async () => {
  const module = await import(moduleUrl) as Record<string, unknown>;
  const bind = module.correlateOwnerGrokT2iHistoryBinding as (input: unknown) => Record<string, unknown>;
  const noAck = snapshot("grok_t2i", 0, 1);
  noAck.messages = [noAck.messages[1]!];
  noAck.total_count = 1;
  assert.deepEqual(bind(request("grok_t2i", 1, noAck)), { status: "PENDING", reason: "OWNER_ACK_NOT_FOUND" });

  const multipleBots = snapshot("grok_t2i", 0, 1);
  multipleBots.messages.push({ message_id: "bot-result-2", provider_chat_id: "12345", author_role: "bot",
    objects: [{ message_object_id: "second-output", object_type: "image", model_type: "grok_t2i" }] });
  multipleBots.total_count = 3;
  assert.deepEqual(bind(request("grok_t2i", 1, multipleBots)), { status: "INVALID", reason: "BOT_MESSAGE_AMBIGUOUS" });

  const wrongOrder = snapshot("grok_t2i", 0, 1);
  wrongOrder.messages.reverse();
  assert.deepEqual(bind(request("grok_t2i", 1, wrongOrder)), { status: "INVALID", reason: "BOT_MESSAGE_BEFORE_ACK" });

  const incomplete = snapshot("grok_t2i", 0, 1);
  incomplete.complete = false;
  assert.deepEqual(bind(request("grok_t2i", 1, incomplete)), { status: "PENDING", reason: "HISTORY_INCOMPLETE" });

  let getterCalls = 0;
  const accessorObject = { message_object_id: "out", object_type: "image", model_type: "grok_t2i" };
  Object.defineProperty(accessorObject, "model_type", { enumerable: true, get() { getterCalls += 1; return "grok_t2i"; } });
  const getterHistory = snapshot("grok_t2i", 0, 1);
  getterHistory.messages[1]!.objects = [accessorObject];
  assert.deepEqual(bind(request("grok_t2i", 1, getterHistory)), { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" });
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const proxyHistory = new Proxy(snapshot("grok_t2i", 0, 1), { ownKeys(target) { proxyTraps += 1; return Reflect.ownKeys(target); } });
  assert.deepEqual(bind(request("grok_t2i", 1, proxyHistory)), { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" });
  assert.equal(proxyTraps, 0);

  const extraField = snapshot("grok_t2i", 0, 1) as ReturnType<typeof snapshot> & { extra: string };
  extraField.extra = "unreviewed";
  assert.deepEqual(bind(request("grok_t2i", 1, extraField)), { status: "INVALID", reason: "HISTORY_SHAPE_INVALID" });
});
