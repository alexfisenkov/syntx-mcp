import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeOwnerIdeogramImageResult,
  snapshotOwnerIdeogramImageResultReadContext
} from "../src/adapter/syntx/ideogram-image-result.js";

const CONTEXT = Object.freeze({ chat_uuid: "ideogram-chat-1", message_id: "bot-message-1", model_id: "ideogram_45",
  mode: "generate", requested_mask_present: false, provider_chat_id: "12345", message_object_ids: Object.freeze(["out-1", "out-2"]), output_count: 2 });

function envelope(objects: readonly Record<string, unknown>[]) {
  return { id: "bot-message-1", chat_id: 12345, author_id: -1, message_object: objects };
}
function image(id: string, model = "ideogram_45", completed = true, suffix = ".png") {
  return { id, message_id: "bot-message-1", object_type: "image", model_type: model,
    completed, object_url: `https://r2.syntx.ai/ideogram/${id}${suffix}` };
}

test("decodes exact ordered batch artifacts without collapsing to one output", () => {
  const result = decodeOwnerIdeogramImageResult(envelope([image("out-1"), image("out-2", "ideogram_45", true, ".webp")]), CONTEXT);
  assert.equal(result.status, "COMPLETE");
  if (result.status !== "COMPLETE") return;
  assert.equal(result.model_id, "ideogram_45");
  assert.equal(result.mode, "generate");
  assert.equal(result.output_count, 2);
  assert.deepEqual(result.artifacts.map((item) => item.message_object_id), ["out-1", "out-2"]);
  assert.deepEqual(result.artifacts.map((item) => item.mime_type), ["image/png", "image/webp"]);
  assert.equal(result.artifacts[0]!.geometry_verified, false);
  assert.equal(result.artifacts[0]!.width, null);
});

test("preserves pending, partial, and unverified states for literal output counts 1, 2, and 8", () => {
  for (const output_count of [1, 2, 8] as const) {
    const ids = Array.from({ length: output_count }, (_, index) => `batch-${output_count}-${index + 1}`);
    const context = { ...CONTEXT, output_count, message_object_ids: ids };
    const complete = decodeOwnerIdeogramImageResult(envelope(ids.map((id) => image(id))), context);
    assert.equal(complete.status, "COMPLETE");
    if (complete.status === "COMPLETE") assert.equal(complete.artifacts.length, output_count);
  }
  const pending = decodeOwnerIdeogramImageResult(envelope([]), { ...CONTEXT, message_object_ids: [] });
  assert.equal(pending.status, "PENDING");
  const partialContext = { ...CONTEXT, message_object_ids: ["out-1"] };
  const partial = decodeOwnerIdeogramImageResult(envelope([image("out-1")]), partialContext);
  assert.equal(partial.status, "PARTIAL");
  const notReady = decodeOwnerIdeogramImageResult(envelope([image("out-1", "ideogram_45", false)]), { ...CONTEXT, message_object_ids: ["out-1"] });
  assert.equal(notReady.status, "PENDING");
});

test("rejects context extras, duplicate/reordered IDs, wrong chat/message/model, and unsafe URLs", () => {
  assert.throws(() => snapshotOwnerIdeogramImageResultReadContext({ ...CONTEXT, surprise: true }));
  assert.throws(() => snapshotOwnerIdeogramImageResultReadContext({ ...CONTEXT, message_object_ids: ["out-1", "out-1"] }));
  assert.equal(decodeOwnerIdeogramImageResult(envelope([image("out-2"), image("out-1")]), CONTEXT).status, "UNVERIFIED");
  assert.equal(decodeOwnerIdeogramImageResult({ ...envelope([image("out-1"), image("out-2")]), id: "other" }, CONTEXT).status, "UNVERIFIED");
  assert.equal(decodeOwnerIdeogramImageResult({ ...envelope([image("out-1"), image("out-2")]), chat_id: 999 }, CONTEXT).status, "UNVERIFIED");
  assert.equal(decodeOwnerIdeogramImageResult(envelope([image("out-1"), image("out-2", "ideogram_40")]), CONTEXT).status, "UNVERIFIED");
  assert.equal(decodeOwnerIdeogramImageResult(envelope([{ ...image("out-1"), object_url: "https://attacker.invalid/out.png" }, image("out-2")]), CONTEXT).status, "UNVERIFIED");
});

test("does not execute getters or trust mode as a provider echo", () => {
  let called = false;
  const getter = Object.defineProperty({}, "object_url", { enumerable: true, get() { called = true; return "https://r2.syntx.ai/x.png"; } });
  const result = decodeOwnerIdeogramImageResult(envelope([getter, image("out-2")]), CONTEXT);
  assert.equal(called, false);
  assert.equal(result.status, "UNVERIFIED");
  const complete = decodeOwnerIdeogramImageResult(envelope([image("out-1"), image("out-2")]), CONTEXT);
  assert.equal(complete.mode_confidence, "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO");
  assert.equal(complete.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
  assert.equal(complete.backend_acceptance, "UNPROVEN");

  const preciseWithoutMask = decodeOwnerIdeogramImageResult(envelope([image("out-1", "ideogram_45")]), {
    ...CONTEXT, mode: "precise_edit", requested_mask_present: false, output_count: 1, message_object_ids: ["out-1"]
  });
  assert.equal(preciseWithoutMask.status, "COMPLETE");
  assert.throws(() => snapshotOwnerIdeogramImageResultReadContext({ ...CONTEXT, requested_mask_present: true }));
});
