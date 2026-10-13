import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-wan-t2v-video-result.js", import.meta.url).href;
const resultModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const context = {
  chat_uuid: "wan-chat", message_id: "bot-1", model_id: "wan_26_t2v", provider_chat_id: "421",
  message_object_ids: ["video-1", "video-2"]
} as const;

function decode(raw: unknown, readContext: unknown = context): Record<string, unknown> {
  assert.ok(resultModule, "MISSING_WAN_T2V_VIDEO_RESULT_CODEC_MODULE");
  const decoder = resultModule.decodeOwnerWanT2vVideoResult as (message: unknown, ctx: unknown) => Record<string, unknown>;
  assert.equal(typeof decoder, "function", "MISSING_WAN_T2V_VIDEO_RESULT_CODEC");
  return decoder(raw, readContext);
}

function video(id: string, extension = "mp4", model = "wan_26_t2v", completed: unknown = true) {
  return { id, object_type: "video", object_url: `https://r2.syntx.ai/result/${id}.${extension}`,
    model_type: model, completed };
}

test("WAN T2V codec binds exact bot message and emits every completed video with extension-only MIME", () => {
  const result = decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: [video("video-1"), video("video-2", "mov")] });
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.deepEqual(result.ready_videos, [
    { object_index: 0, message_object_id: "video-1", object_type: "video", object_url: "https://r2.syntx.ai/result/video-1.mp4",
      mime_type: "video/mp4", mime_source: "URL_EXTENSION" },
    { object_index: 1, message_object_id: "video-2", object_type: "video", object_url: "https://r2.syntx.ai/result/video-2.mov",
      mime_type: "video/quicktime", mime_source: "URL_EXTENSION" }
  ]);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal("provider_terminal" in result, false);
  assert.equal("output_count" in result, false);
});

test("WAN T2V codec preserves ready same-model video while a sibling remains incomplete", () => {
  const result = decode({ id: "bot-1", chat_id: 421, author_id: -1,
    message_object: [video("video-1"), video("video-2", "mp4", "wan_26_t2v", false)] });
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual((result.ready_videos as Array<Record<string, unknown>>).map((entry) => entry.message_object_id), ["video-1"]);
  assert.deepEqual(result.gaps, ["OBJECT_INCOMPLETE"]);
});

test("WAN T2V codec does not guess MIME when a safe URL has no recognized video extension", () => {
  const result = decode({ id: "bot-1", chat_id: 421, author_id: -1,
    message_object: [{ ...video("video-1", "bin"), object_url: "https://r2.syntx.ai/result/video-1" }] },
  { ...context, message_object_ids: ["video-1"] });
  assert.deepEqual(result.ready_videos, [{ object_index: 0, message_object_id: "video-1", object_type: "video",
    object_url: "https://r2.syntx.ai/result/video-1", mime_type: null, mime_source: "UNKNOWN" }]);
});

test("WAN T2V codec returns an unknown model echo only for absent echo and rejects foreign model", () => {
  const singleContext = { ...context, message_object_ids: ["video-1"] };
  const missing = decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: [
    { id: "video-1", object_type: "video", object_url: "https://r2.syntx.ai/a.mp4", completed: true }
  ] }, singleContext);
  assert.equal(missing.model_echo, "UNKNOWN");
  assert.equal((missing.ready_videos as unknown[]).length, 1);
  const mismatch = decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: [video("video-1", "mp4", "wan_27_t2v")] }, singleContext);
  assert.equal(mismatch.message_binding, "UNVERIFIED");
  assert.equal(mismatch.model_echo, "MISMATCH");
  assert.deepEqual(mismatch.ready_videos, []);
  assert.deepEqual(mismatch.gaps, ["MODEL_TYPE_MISMATCH"]);
});

test("WAN T2V codec enforces expected IDs, duplicate rejection, safe URLs, and object type", () => {
  const result = decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: [
    video("video-1"), video("video-1"), video("unexpected"),
    { ...video("video-2"), object_url: "https://evil.invalid/private.mp4" },
    { ...video("video-3"), object_type: "image" }
  ] }, { ...context, message_object_ids: ["video-1", "video-2", "video-3"] });
  assert.deepEqual((result.ready_videos as Array<Record<string, unknown>>).map((entry) => entry.message_object_id), ["video-1"]);
  assert.deepEqual(result.gaps, ["OBJECT_ID_DUPLICATE", "OBJECT_ID_UNEXPECTED", "OBJECT_URL_UNSAFE", "OBJECT_TYPE_UNSUPPORTED"]);
  const unexpected = decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: [video("not-expected")] },
    { ...context, message_object_ids: ["video-1"] });
  assert.deepEqual(unexpected.ready_videos, []);
  assert.deepEqual(unexpected.gaps, ["OBJECT_ID_UNEXPECTED", "EXPECTED_OBJECT_ID_MISSING"]);
});

test("WAN T2V codec validates optional child message ID, provider chat, and model binding", () => {
  const childMismatch = decode({ id: "bot-1", chat_id: 421, author_id: -1,
    message_object: [{ ...video("video-1"), message_id: "different-message" }] }, { ...context, message_object_ids: ["video-1"] });
  assert.equal(childMismatch.message_binding, "UNVERIFIED");
  assert.deepEqual(childMismatch.ready_videos, []);
  assert.deepEqual(childMismatch.gaps, ["CHILD_MESSAGE_ID_MISMATCH"]);
  const chatMismatch = decode({ id: "bot-1", chat_id: 422, author_id: -1, message_object: [video("video-1")] });
  assert.equal(chatMismatch.message_binding, "UNVERIFIED");
  assert.deepEqual(chatMismatch.gaps, ["PROVIDER_CHAT_ID_MISMATCH"]);
  const noModelEcho = decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: [video("video-1", "mp4", "", true)] });
  assert.equal(noModelEcho.model_echo, "MISMATCH");
});

test("WAN T2V codec refuses unknown fields without exposing values and ignores observed unconsumed metadata", () => {
  let nestedReads = 0;
  const metadata: Record<string, unknown> = {};
  Object.defineProperty(metadata, "secret", { enumerable: true, get() { nestedReads += 1; return "private"; } });
  const result = decode({ id: "bot-1", chat_id: 421, author_id: -1, created_at: "time", updated_at: "time", is_favorite: false,
    future: "do-not-echo", message_object: [{ ...video("video-1"), message_id: "bot-1", object_text: "ignored", created_at: "time",
      updated_at: "time", task_id: "ignored-task", metadata, future_object: "private-value" }] }, { ...context, message_object_ids: ["video-1"] });
  assert.deepEqual(result.gaps, ["UNRECOGNIZED_MESSAGE_FIELDS", "UNRECOGNIZED_OBJECT_FIELDS"]);
  assert.equal(nestedReads, 0);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("ignored-task"), false);
});

test("WAN T2V codec rejects unsafe containers, accessors, proxies, sparse arrays, and over-limit messages", () => {
  let getterReads = 0;
  const accessor: Record<string, unknown> = { chat_id: 421, author_id: -1, message_object: [] };
  Object.defineProperty(accessor, "id", { enumerable: true, get() { getterReads += 1; return "bot-1"; } });
  assert.equal(decode(accessor).message_binding, "UNVERIFIED");
  const proxied = new Proxy({ id: "bot-1", chat_id: 421, author_id: -1, message_object: [] }, { getPrototypeOf() { throw new Error("trap"); } });
  assert.equal(decode(proxied).message_binding, "UNVERIFIED");
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.equal(decode(revoked.proxy).message_binding, "UNVERIFIED");
  const sparse = new Array(1);
  assert.deepEqual(decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: sparse }).gaps,
    ["MESSAGE_OBJECT_ARRAY_INVALID"]);
  assert.deepEqual(decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: Array(65).fill(video("video-1")) }).gaps,
    ["MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT"]);
  assert.equal(getterReads, 0);
  assert.throws(() => decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: [] },
    { ...context, message_object_ids: ["duplicate", "duplicate"] }), /INVALID_WAN_T2V_VIDEO_RESULT_CONTEXT/u);
});

test("two bounded WAN T2V messages can aggregate 80 parsed video candidates without claiming provider completeness", () => {
  const firstIds = Array.from({ length: 64 }, (_, index) => `first-${index}`);
  const secondIds = Array.from({ length: 16 }, (_, index) => `second-${index}`);
  const first = decode({ id: "bot-1", chat_id: 421, author_id: -1, message_object: firstIds.map((id) => video(id)) },
    { ...context, message_object_ids: firstIds });
  const second = decode({ id: "bot-2", chat_id: 421, author_id: -1, message_object: secondIds.map((id) => video(id)) },
    { ...context, message_id: "bot-2", message_object_ids: secondIds });
  const aggregated = [...first.ready_videos as unknown[], ...second.ready_videos as unknown[]];
  assert.equal(aggregated.length, 80);
  assert.equal(first.backend_acceptance, "UNPROVEN");
  assert.equal(second.backend_acceptance, "UNPROVEN");
  assert.equal("provider_terminal" in first, false);
  assert.equal("output_count" in first, false);
});
