import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-kling-keyframes-video-result.js", import.meta.url).href;
const codecModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const context = { chat_uuid: "keyframes-chat", message_id: "bot-1", provider_chat_id: "421", message_object_ids: ["video-1", "video-2"] } as const;

function decode(raw: unknown, readContext: unknown = context): Record<string, unknown> {
  assert.ok(codecModule, "MISSING_OWNER_KLING_KEYFRAMES_VIDEO_RESULT_CODEC_MODULE");
  const decoder = codecModule.decodeOwnerKlingKeyframesVideoResult as (message: unknown, ctx: unknown) => Record<string, unknown>;
  assert.equal(typeof decoder, "function", "MISSING_OWNER_KLING_KEYFRAMES_VIDEO_RESULT_CODEC");
  return decoder(raw, readContext);
}

function video(id: string, extension = "mp4", model: unknown = "kling_keyframes", completed: unknown = true) {
  return { id, message_id: "bot-1", object_type: "video", object_url: `https://r2.syntx.ai/result/${id}.${extension}`, model_type: model, completed };
}

function message(objects: unknown[], overrides: Record<string, unknown> = {}) {
  return { id: "bot-1", chat_id: 421, author_id: -1, message_object: objects, ...overrides };
}

test("Keyframes result binds the exact bot message and returns one or multiple completed videos", () => {
  const single = decode(message([video("video-1")]), { ...context, message_object_ids: ["video-1"] });
  assert.equal((single.ready_videos as unknown[]).length, 1);
  assert.equal(single.message_binding, "BOUND");
  const result = decode(message([video("video-1"), video("video-2", "webm")]));
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.deepEqual(result.ready_videos, [
    { object_index: 0, message_object_id: "video-1", object_type: "video", object_url: "https://r2.syntx.ai/result/video-1.mp4",
      mime_type: "video/mp4", mime_source: "URL_EXTENSION_LOCAL_POLICY" },
    { object_index: 1, message_object_id: "video-2", object_type: "video", object_url: "https://r2.syntx.ai/result/video-2.webm",
      mime_type: "video/webm", mime_source: "URL_EXTENSION_LOCAL_POLICY" }
  ]);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal("provider_terminal" in result, false);
  assert.equal("output_count" in result, false);
  assert.equal("billing" in result, false);
  assert.equal(decode(message([])).model_echo, "UNKNOWN");
});

test("missing or wrong model echo is a conservative local guard and excludes only the offending result", () => {
  const missing = decode(message([{ ...video("video-1"), model_type: undefined }]), { ...context, message_object_ids: ["video-1"] });
  assert.equal(missing.model_echo, "UNKNOWN");
  assert.deepEqual(missing.ready_videos, []);
  assert.deepEqual(missing.gaps, [{ object_index: 0, code: "MODEL_ECHO_UNKNOWN" }]);
  const mismatch = decode(message([video("video-1", "mp4", "kling_v2")]), { ...context, message_object_ids: ["video-1"] });
  assert.equal(mismatch.model_echo, "MISMATCH");
  assert.deepEqual(mismatch.ready_videos, []);
  assert.deepEqual(mismatch.gaps, [{ object_index: 0, code: "MODEL_ECHO_MISMATCH" }]);
});

test("message binding rejects wrong outer identity, provider chat, author, and child message identity", () => {
  const badOuter = decode(message([video("video-1")], { id: "different" }));
  assert.equal(badOuter.message_binding, "UNVERIFIED");
  assert.equal(badOuter.model_echo, "UNKNOWN");
  assert.deepEqual(badOuter.ready_videos, []);
  assert.deepEqual(badOuter.gaps, [{ object_index: null, code: "OUTER_MESSAGE_ID_MISMATCH" }]);
  const wrongChat = decode(message([video("video-1")], { chat_id: 422 }));
  assert.deepEqual(wrongChat.gaps, [{ object_index: null, code: "PROVIDER_CHAT_ID_MISMATCH" }]);
  assert.equal(wrongChat.model_echo, "UNKNOWN");
  const nonBot = decode(message([video("video-1")], { author_id: 5 }));
  assert.deepEqual(nonBot.gaps, [{ object_index: null, code: "NOT_BOT_MESSAGE" }]);
  assert.equal(nonBot.model_echo, "UNKNOWN");
  assert.deepEqual(decode(message([{ ...video("video-1"), message_id: "another" }])).gaps,
    [{ object_index: 0, code: "CHILD_MESSAGE_ID_MISMATCH" }, { object_index: null, code: "EXPECTED_OBJECT_ID_MISSING" }]);
});

test("incomplete, unsupported, unknown-type, and unsafe URL objects become typed gaps", () => {
  const result = decode(message([
    video("video-1", "mp4", "kling_keyframes", false),
    { ...video("video-2"), object_type: "image" },
    { ...video("video-3"), object_url: "https://evil.invalid/secret.mp4" },
    { ...video("video-4"), completed: undefined }
  ]), { ...context, message_object_ids: ["video-1", "video-2", "video-3", "video-4"] });
  assert.deepEqual(result.ready_videos, []);
  assert.deepEqual(result.gaps, [
    { object_index: 0, code: "OBJECT_INCOMPLETE" }, { object_index: 1, code: "OBJECT_TYPE_UNSUPPORTED" },
    { object_index: 2, code: "OBJECT_URL_UNSAFE" }, { object_index: 3, code: "OBJECT_COMPLETION_UNKNOWN" }
  ]);
  assert.equal(result.model_echo, "MATCHED", "expected echo is observed on typed video objects despite readiness gaps");
  const unsupportedOnly = decode(message([{ ...video("video-1"), object_type: "image" }]), { ...context, message_object_ids: ["video-1"] });
  assert.equal(unsupportedOnly.model_echo, "UNKNOWN", "non-video objects do not establish the expected video echo");
});

test("valid owned videos survive mixed invalid objects, duplicates, and unexpected IDs", () => {
  const result = decode(message([video("video-1"), video("video-1"), video("unexpected"),
    { ...video("video-2"), model_type: "other" }, video("video-3")]),
  { ...context, message_object_ids: ["video-1", "video-2", "video-3"] });
  assert.deepEqual((result.ready_videos as Array<Record<string, unknown>>).map((item) => item.message_object_id), ["video-1", "video-3"]);
  assert.equal(result.model_echo, "MISMATCH");
  assert.deepEqual(result.gaps, [
    { object_index: 1, code: "OBJECT_ID_DUPLICATE" }, { object_index: 2, code: "OBJECT_ID_UNEXPECTED" },
    { object_index: 3, code: "MODEL_ECHO_MISMATCH" }
  ]);
});

test("context requires closed positive identity and a unique complete expected object-id set", () => {
  assert.throws(() => decode(message([]), { ...context, unexpected: true }), /INVALID_KLING_KEYFRAMES_VIDEO_RESULT_CONTEXT/u);
  assert.throws(() => decode(message([]), { ...context, message_object_ids: ["duplicate", "duplicate"] }), /INVALID_KLING_KEYFRAMES_VIDEO_RESULT_CONTEXT/u);
  assert.throws(() => decode(message([]), { ...context, message_object_ids: [] }), /INVALID_KLING_KEYFRAMES_VIDEO_RESULT_CONTEXT/u);
  const inherited = Object.assign(Object.create({ role: "trusted" }) as object, context);
  assert.throws(() => decode(message([]), inherited), /INVALID_KLING_KEYFRAMES_VIDEO_RESULT_CONTEXT/u);
  const proxied = new Proxy(context, { get() { throw new Error("context getter ran"); } });
  assert.throws(() => decode(message([]), proxied), /INVALID_KLING_KEYFRAMES_VIDEO_RESULT_CONTEXT/u);
  const missing = decode(message([video("video-1")]), { ...context, message_object_ids: ["video-1", "video-2"] });
  assert.deepEqual(missing.gaps, [{ object_index: null, code: "EXPECTED_OBJECT_ID_MISSING" }]);
});

test("unknown fields create value-free gaps while allowlisted inert metadata is never read", () => {
  let nestedReads = 0;
  const metadata: Record<string, unknown> = {};
  Object.defineProperty(metadata, "secret", { enumerable: true, get() { nestedReads += 1; return "private"; } });
  const result = decode(message([{ ...video("video-1"), metadata, future: "do-not-return" }], { created_at: "ignored", future: "hidden" }),
    { ...context, message_object_ids: ["video-1"] });
  assert.deepEqual(result.gaps, [
    { object_index: null, code: "UNRECOGNIZED_MESSAGE_FIELDS" }, { object_index: 0, code: "UNRECOGNIZED_OBJECT_FIELDS" }
  ]);
  assert.equal(nestedReads, 0);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal(JSON.stringify(result).includes("do-not-return"), false);
});

test("unsafe containers, accessors, proxies, malformed arrays, and whole-array overflow are refused", () => {
  let getterReads = 0;
  const accessor: Record<string, unknown> = { chat_id: 421, author_id: -1, message_object: [] };
  Object.defineProperty(accessor, "id", { enumerable: true, get() { getterReads += 1; return "bot-1"; } });
  assert.deepEqual(decode(accessor).gaps, [{ object_index: null, code: "ENVELOPE_SHAPE_INVALID" }]);
  const proxied = new Proxy(message([]), { getPrototypeOf() { throw new Error("trap"); } });
  assert.deepEqual(decode(proxied).gaps, [{ object_index: null, code: "ENVELOPE_SHAPE_INVALID" }]);
  const sparse = new Array(1);
  assert.deepEqual(decode(message(sparse)).gaps, [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_INVALID" }]);
  assert.deepEqual(decode(message(Array(65).fill(video("video-1")))).gaps,
    [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT" }]);
  assert.equal(getterReads, 0);
  assert.throws(() => decode(message([]), { ...context, provider_chat_id: "0" }), /INVALID_KLING_KEYFRAMES_VIDEO_RESULT_CONTEXT/u);
});
