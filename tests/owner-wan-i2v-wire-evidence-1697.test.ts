import assert from "node:assert/strict";
import test from "node:test";
import { bindOwnerWan25I2vHistory } from "../src/adapter/syntx/owner-wan25-i2v-history.js";
import { decodeOwnerWan25I2vVideoResult } from "../src/adapter/syntx/owner-wan25-i2v-video-result.js";
import { bindOwnerWan26I2vHistory } from "../src/adapter/syntx/owner-wan26-i2v-history.js";
import { decodeOwnerWan26I2vVideoResult } from "../src/adapter/syntx/owner-wan26-i2v-video-result.js";
import { projectOwnerWanI2vHistoryPageEvidence, projectOwnerWanI2vResultEnvelopeEvidence } from "../src/adapter/syntx/wan-i2v-wire-evidence.js";

const PREVIEW = "wan_25_i2v_preview" as const;
const WAN26 = "wan_26_i2v" as const;
const FLASH26 = "wan_26_i2v_flash" as const;

function deepInert(depth: number): unknown {
  let value: unknown = "non-semantic-provider-metadata";
  for (let index = 0; index < depth; index += 1) value = { nested: value };
  return value;
}

function historyPage(modelId: string, metadata: unknown, extraObjectFields: Record<string, unknown> = {}) {
  const ownerMessage = "owner-text-message";
  const botMessage = "bot-video-message";
  const owner = { id: ownerMessage, chat_id: 421, author_id: 27,
    message_object: [{ id: "owner-text-object", message_id: ownerMessage, object_type: "text", model_type: modelId,
      object_text: "prompt echoed exactly", completed: true }] };
  const bot = { id: botMessage, chat_id: 421, author_id: -1,
    message_object: [
      { id: "video-object", message_id: botMessage, object_type: "video", model_type: modelId, completed: true,
        object_url: "https://r2.syntx.ai/known-inert-history.mp4", created_at: "2026-10-15T00:00:00Z", task_id: "unused-task",
        metadata, ...extraObjectFields },
      { id: "other-object", message_id: botMessage, object_type: "other", model_type: modelId, completed: true }
    ] };
  return { messages: [owner, bot], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1,
    has_next: false, has_previous: false, next: null, next_cursor: null, prev_cursor: 1 },
    created_at: "2026-10-15T00:00:00Z", chat_limits: { opaque_limit: 10 }, context: { opaque_context: { nested: true } } };
}

function historyInput(modelId: string, page: unknown) {
  return { pages: [page], expected: { chat_uuid: "chat-preview-1", owner_echo_message_id: "owner-text-message",
    prompt: "prompt echoed exactly", model_id: modelId } };
}

function resultEnvelope(modelId: string, metadata: unknown, extraObjectFields: Record<string, unknown> = {}) {
  return { id: "bot-video-message", chat_id: 421, author_id: -1, created_at: "2026-10-15T00:00:00Z",
    message_object: [{ id: "video-object", message_id: "bot-video-message", object_type: "video", model_type: modelId,
      completed: true, object_url: "https://r2.syntx.ai/known-inert-result.mp4", metadata, object_text: "not consumed by result join",
      updated_at: "2026-10-15T00:00:00Z", task_id: "unused-task", ...extraObjectFields }] };
}

function resultContext(modelId: typeof PREVIEW | typeof WAN26 | typeof FLASH26) {
  return { chat_uuid: "chat-preview-1", message_id: "bot-video-message", provider_chat_id: "421",
    message_object_ids: ["video-object"], model_id: modelId };
}

test("projects only known inert deep metadata and preserves 25/26 model-specific history and result joins", () => {
  const inert = deepInert(12);
  for (const modelId of [PREVIEW, WAN26, FLASH26] as const) {
    const rawPage = historyPage(modelId, inert);
    const bind = modelId === PREVIEW ? bindOwnerWan25I2vHistory : bindOwnerWan26I2vHistory;
    const rawWitness = bind(historyInput(modelId, rawPage));
    assert.ok(rawWitness.gaps.includes("HISTORY_INPUT_INVALID"), "control fixture reproduces the old whole-graph rejection");
    const historyProjection = projectOwnerWanI2vHistoryPageEvidence(rawPage);
    assert.equal(historyProjection.status, "PROJECTED");
    const witness = bind(historyInput(modelId, historyProjection.value));
    assert.equal(witness.status, "COMPLETE"); assert.equal(witness.owner_ack_status, "MATCHED");
    assert.equal(witness.history_binding_status, "BOUND"); assert.equal(witness.gaps.length, 0);
    assert.deepEqual(witness.candidate_messages, [{ message_id: "bot-video-message", message_object_ids: ["video-object"] }]);

    const rawResult = resultEnvelope(modelId, inert);
    const decode = modelId === PREVIEW ? decodeOwnerWan25I2vVideoResult : decodeOwnerWan26I2vVideoResult;
    const rawDecoded = decode(rawResult, resultContext(modelId));
    assert.ok(rawDecoded.gaps.some(({ code }) => code === "ENVELOPE_SHAPE_INVALID"), "control fixture reproduces the old result graph rejection");
    const resultProjection = projectOwnerWanI2vResultEnvelopeEvidence(rawResult);
    assert.equal(resultProjection.status, "PROJECTED");
    const projectedEnvelope = resultProjection.value as { readonly message_object: readonly Record<string, unknown>[] };
    assert.equal(Object.hasOwn(projectedEnvelope.message_object[0]!, "object_text"), false);
    assert.equal(Object.hasOwn(projectedEnvelope.message_object[0]!, "metadata"), false);
    const result = decode(resultProjection.value, resultContext(modelId));
    assert.equal(result.message_binding, "BOUND"); assert.equal(result.model_echo, "MATCHED");
    assert.equal(result.result_status, "OBSERVED"); assert.equal(result.gaps.length, 0);
    assert.equal(result.ready_videos.length, 1); assert.equal(result.ready_videos[0]?.object_url,
      "https://r2.syntx.ai/known-inert-result.mp4");
  }
});

test("keeps unknown history/result fields as explicit gaps rather than deleting them into success", () => {
  const page = projectOwnerWanI2vHistoryPageEvidence(historyPage(WAN26, deepInert(12), { future_provider_field: "future" }));
  assert.equal(page.status, "PROJECTED");
  const history = bindOwnerWan26I2vHistory(historyInput(WAN26, page.value));
  assert.ok(history.gaps.includes("HISTORY_UNKNOWN_FIELDS"));
  assert.notEqual(history.history_binding_status, "BOUND");

  const result = projectOwnerWanI2vResultEnvelopeEvidence(resultEnvelope(WAN26, deepInert(12), { future_provider_field: "future" }));
  assert.equal(result.status, "PROJECTED");
  const decoded = decodeOwnerWan26I2vVideoResult(result.value, resultContext(WAN26));
  assert.ok(decoded.gaps.some(({ code }) => code === "UNRECOGNIZED_OBJECT_FIELDS"));
  assert.notEqual(decoded.gaps.length, 0, "native zero-gap admission must remain impossible");
});

test("only skips proven auxiliary envelope shapes and markers bad shapes or cursor types", () => {
  const fixture = historyPage(WAN26, deepInert(12));
  const accepted = projectOwnerWanI2vHistoryPageEvidence(fixture);
  assert.equal(accepted.status, "PROJECTED");
  const acceptedWitness = bindOwnerWan26I2vHistory(historyInput(WAN26, accepted.value));
  assert.equal(acceptedWitness.gaps.length, 0); assert.equal(acceptedWitness.history_binding_status, "BOUND");

  const badRecord = projectOwnerWanI2vHistoryPageEvidence({ ...fixture, context: "unexpected-string" });
  assert.equal(badRecord.status, "PROJECTED");
  const recordWitness = bindOwnerWan26I2vHistory(historyInput(WAN26, badRecord.value));
  assert.ok(recordWitness.gaps.includes("HISTORY_UNKNOWN_FIELDS"));
  assert.notEqual(recordWitness.history_binding_status, "BOUND");

  const badCursor = projectOwnerWanI2vHistoryPageEvidence({ ...fixture,
    pagination: { ...fixture.pagination, prev_cursor: "1" } });
  assert.equal(badCursor.status, "PROJECTED");
  const cursorWitness = bindOwnerWan26I2vHistory(historyInput(WAN26, badCursor.value));
  assert.ok(cursorWitness.gaps.includes("HISTORY_UNKNOWN_FIELDS"));
  assert.notEqual(cursorWitness.history_binding_status, "BOUND");

  const badLimits = projectOwnerWanI2vHistoryPageEvidence({ ...fixture, chat_limits: [] });
  assert.equal(badLimits.status, "PROJECTED");
  const limitsWitness = bindOwnerWan26I2vHistory(historyInput(WAN26, badLimits.value));
  assert.ok(limitsWitness.gaps.includes("HISTORY_UNKNOWN_FIELDS"));
  assert.notEqual(limitsWitness.history_binding_status, "BOUND");
});

test("never invokes accessors and fails closed for proxies, cycles, and non-dense arrays inside inert metadata", () => {
  let getterCalls = 0;
  const getter = historyPage(WAN26, deepInert(10));
  Object.defineProperty(getter.messages[1]!.message_object[0]!, "metadata", { enumerable: true, get() { getterCalls += 1; return deepInert(12); } });
  assert.equal(projectOwnerWanI2vHistoryPageEvidence(getter).status, "INVALID");
  assert.equal(getterCalls, 0);

  const cyclic: { nested?: unknown } = {}; cyclic.nested = cyclic;
  assert.equal(projectOwnerWanI2vHistoryPageEvidence(historyPage(WAN26, cyclic)).status, "INVALID");
  assert.equal(projectOwnerWanI2vResultEnvelopeEvidence(resultEnvelope(WAN26, new Proxy({}, {}))).status, "INVALID");

  const sparse: unknown[] = []; sparse.length = 2; sparse[1] = "value";
  assert.equal(projectOwnerWanI2vResultEnvelopeEvidence(resultEnvelope(WAN26, sparse)).status, "INVALID");
});
