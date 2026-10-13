import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-seedream-editor-image-result.js", import.meta.url).href;
const resultModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const context = { chat_uuid: "editor-chat", message_id: "bot-1", variant: "seedream-5" } as const;

test("Editor decoder keeps every completed image/image_url observed across the bounded result", () => {
  assert.ok(resultModule, "MISSING_SEEDREAM_EDITOR_RESULT_CODEC_MODULE");
  const decode = resultModule.decodeOwnerSeedreamEditorImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  assert.equal(typeof decode, "function", "MISSING_SEEDREAM_EDITOR_RESULT_CODEC");
  const objects = Array.from({ length: 64 }, (_, index) => ({
    id: `object-${index + 1}`, object_type: index % 2 === 0 ? "image" : "image_url",
    object_url: `https://r2.syntx.ai/editor/result-${index + 1}.png`, completed: true, model_type: "seedream-5"
  }));
  const result = decode({ id: "bot-1", author_id: -1, message_object: objects }, context);
  assert.equal(result.message_binding, "BOUND");
  assert.equal((result.ready_images as unknown[]).length, 64);
  assert.equal((result.gaps as unknown[]).length, 0);
  assert.equal((result.ready_images as Array<Record<string, unknown>>)[63]?.message_object_id, "object-64");
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal("output_count" in result, false);
});

test("Editor decoder leaves missing model echo unknown and blocks a present mismatch", () => {
  assert.ok(resultModule, "MISSING_SEEDREAM_EDITOR_RESULT_CODEC_MODULE");
  const decode = resultModule.decodeOwnerSeedreamEditorImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  const missing = decode({ id: "bot-1", author_id: -1, message_object: [
    { id: "object-1", object_type: "image_url", object_url: "https://r2.syntx.ai/a.png", completed: true }
  ] }, context);
  assert.equal(missing.model_echo, "UNKNOWN");
  assert.deepEqual(missing.ready_images, [{ object_index: 0, object_type: "image_url", object_url: "https://r2.syntx.ai/a.png",
    message_object_id: "object-1", model_echo: "UNKNOWN", model_type: null, mime_type: "image/png", mime_source: "URL_EXTENSION",
    width: null, height: null, geometry_verified: false }]);
  assert.deepEqual(missing.gaps, [{ object_index: 0, code: "MODEL_TYPE_UNAVAILABLE" }]);
  const mismatch = decode({ id: "bot-1", author_id: -1, message_object: [
    { id: "object-1", object_type: "image", object_url: "https://r2.syntx.ai/a.png", completed: true, model_type: "seedream-4" }
  ] }, context);
  assert.equal(mismatch.message_binding, "UNVERIFIED");
  assert.deepEqual(mismatch.ready_images, []);
  assert.deepEqual(mismatch.gaps, [{ object_index: 0, code: "MODEL_TYPE_MISMATCH" }]);
});

test("Editor decoder ignores observed metadata without reading nested values and keeps incomplete objects pending", () => {
  assert.ok(resultModule, "MISSING_SEEDREAM_EDITOR_RESULT_CODEC_MODULE");
  const decode = resultModule.decodeOwnerSeedreamEditorImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  let nestedMetadataReads = 0;
  const metadata: Record<string, unknown> = {};
  Object.defineProperty(metadata, "private_value", { enumerable: true, get() { nestedMetadataReads += 1; return "must-not-read"; } });
  const result = decode({ id: "bot-1", chat_id: 421, author_id: -1, created_at: "2026-10-13T00:00:00Z",
    updated_at: "2026-10-13T00:00:01Z", is_favorite: false, message_object: [{
      id: "object-1", message_id: "bot-1", object_type: "image", object_url: "https://r2.syntx.ai/pending.png",
      completed: false, model_type: "seedream-5", object_text: "unconsumed", created_at: "2026-10-13T00:00:00Z",
      updated_at: "2026-10-13T00:00:01Z", task_id: "task-metadata", metadata
    }] }, { ...context, provider_chat_id: "421" });

  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_images, []);
  assert.deepEqual(result.gaps, [{ object_index: 0, code: "OBJECT_INCOMPLETE" }]);
  assert.equal(nestedMetadataReads, 0);
  assert.equal(JSON.stringify(result).includes("task-metadata"), false);
  assert.equal(JSON.stringify(result).includes("must-not-read"), false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("Editor decoder treats unsafe URLs, unknown fields, missing IDs, and over-limit arrays as explicit gaps", () => {
  assert.ok(resultModule, "MISSING_SEEDREAM_EDITOR_RESULT_CODEC_MODULE");
  const decode = resultModule.decodeOwnerSeedreamEditorImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  const unsafe = "https://evil.invalid/private.png";
  const result = decode({ id: "bot-1", author_id: -1, private_prompt: "hidden", message_object: [
    { object_type: "image", object_url: unsafe, completed: true, model_type: "seedream-5", private_data: "hidden" },
    { object_type: "image", object_url: "https://r2.syntx.ai/no-id.png", completed: true, model_type: "seedream-5" }
  ] }, context);
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_images, [{ object_index: 1, object_type: "image", object_url: "https://r2.syntx.ai/no-id.png",
    model_echo: "MATCHED", model_type: "seedream-5", mime_type: "image/png", mime_source: "URL_EXTENSION",
    width: null, height: null, geometry_verified: false }]);
  assert.deepEqual(result.gaps, [
    { object_index: null, code: "UNRECOGNIZED_MESSAGE_FIELDS" },
    { object_index: 0, code: "UNRECOGNIZED_OBJECT_FIELDS" },
    { object_index: 0, code: "OBJECT_ID_UNAVAILABLE" },
    { object_index: 0, code: "OBJECT_URL_UNSAFE" },
    { object_index: 1, code: "OBJECT_ID_UNAVAILABLE" }
  ]);
  assert.equal(JSON.stringify(result).includes("evil.invalid"), false);
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  const overflow = decode({ id: "bot-1", author_id: -1, message_object: Array(65).fill({ object_type: "image" }) }, context);
  assert.deepEqual(overflow.ready_images, []);
  assert.deepEqual(overflow.gaps, [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT" }]);
  const duplicate = decode({ id: "bot-1", author_id: -1, message_object: [
    { id: "same", object_type: "image", object_url: "https://r2.syntx.ai/a.png", completed: true, model_type: "seedream-5" },
    { id: "same", object_type: "image_url", object_url: "https://r2.syntx.ai/b.png", completed: true, model_type: "seedream-5" }
  ] }, context);
  assert.deepEqual(duplicate.ready_images, [{ object_index: 0, object_type: "image", object_url: "https://r2.syntx.ai/a.png",
    message_object_id: "same", model_echo: "MATCHED", model_type: "seedream-5", mime_type: "image/png",
    mime_source: "URL_EXTENSION", width: null, height: null, geometry_verified: false }]);
  assert.deepEqual(duplicate.gaps, [{ object_index: 1, code: "OBJECT_ID_DUPLICATE" }]);
});

test("Editor result decoder rejects accessor/proxy/revoked and sparse inputs without executing traps", () => {
  assert.ok(resultModule, "MISSING_SEEDREAM_EDITOR_RESULT_CODEC_MODULE");
  const decode = resultModule.decodeOwnerSeedreamEditorImageResult as (raw: unknown, context: unknown) => Record<string, unknown>;
  let getterReads = 0;
  const accessor: Record<string, unknown> = { author_id: -1, message_object: [] };
  Object.defineProperty(accessor, "id", { enumerable: true, get() { getterReads += 1; return "bot-1"; } });
  assert.equal(decode(accessor, context).message_binding, "UNVERIFIED");
  const proxied = new Proxy({ id: "bot-1", author_id: -1, message_object: [] }, { getPrototypeOf() { throw new Error("trap"); } });
  assert.equal(decode(proxied, context).message_binding, "UNVERIFIED");
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.equal(decode(revoked.proxy, context).message_binding, "UNVERIFIED");
  const sparse = new Array(1);
  assert.deepEqual(decode({ id: "bot-1", author_id: -1, message_object: sparse }, context).gaps,
    [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_INVALID" }]);
  assert.equal(getterReads, 0);
});
