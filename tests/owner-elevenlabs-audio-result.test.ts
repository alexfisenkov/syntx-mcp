import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-elevenlabs-audio-result.js", import.meta.url).href;
const codecModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const context = Object.freeze({ chat_uuid: "synthetic-audio-chat", message_id: "synthetic-audio-message",
  model_id: "eleven_v4_turbo", provider_chat_id: "42001", message_object_ids: Object.freeze(["synthetic-audio-1", "synthetic-audio-2"]) });

type Decode = (raw: unknown, readContext: unknown) => Record<string, unknown>;
function decode(raw: unknown, readContext: unknown = context): Record<string, unknown> {
  assert.ok(codecModule, "MISSING_OWNER_ELEVENLABS_AUDIO_RESULT_CODEC_MODULE");
  const decoder = codecModule.decodeOwnerElevenLabsAudioResult as Decode;
  assert.equal(typeof decoder, "function", "MISSING_OWNER_ELEVENLABS_AUDIO_RESULT_CODEC");
  return decoder(raw, readContext);
}

function audio(id: string, extension = "mp3", model = "eleven_v4_turbo", completed: unknown = true) {
  return { id, object_type: "audio", object_url: `https://r2.syntx.ai/synthetic/${id}.${extension}`, model_type: model, completed };
}

function envelope(objects: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return { id: "synthetic-audio-message", chat_id: 42001, author_id: -1, message_object: objects, ...overrides };
}

test("binds completed audio objects to the exact message/model and uses extension-only local MIME policy", () => {
  const result = decode(envelope([audio("synthetic-audio-1", "mp3"), audio("synthetic-audio-2", "wav")])) as {
    message_binding: string; model_echo: string; ready_audio: readonly Record<string, unknown>[];
    gaps: readonly unknown[]; backend_acceptance: string;
  };
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.deepEqual(result.ready_audio, [
    { object_index: 0, message_object_id: "synthetic-audio-1", object_type: "audio",
      object_url: "https://r2.syntx.ai/synthetic/synthetic-audio-1.mp3", mime_type: "audio/mpeg", mime_source: "URL_EXTENSION_LOCAL_POLICY" },
    { object_index: 1, message_object_id: "synthetic-audio-2", object_type: "audio",
      object_url: "https://r2.syntx.ai/synthetic/synthetic-audio-2.wav", mime_type: "audio/wav", mime_source: "URL_EXTENSION_LOCAL_POLICY" }
  ]);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal("provider_terminal_status" in result, false);
  assert.equal("output_count" in result, false);
});

test("retains ready siblings when one expected audio object is incomplete", () => {
  const result = decode(envelope([audio("synthetic-audio-1"), audio("synthetic-audio-2", "mp3", "eleven_v4_turbo", false)])) as {
    ready_audio: readonly Record<string, unknown>[]; gaps: readonly Record<string, unknown>[];
  };
  assert.deepEqual(result.ready_audio.map((item) => item.message_object_id), ["synthetic-audio-1"]);
  assert.deepEqual(result.gaps, [{ object_index: 1, code: "OBJECT_INCOMPLETE" }]);
});

test("maps m4a only through the local URL-extension policy", () => {
  const result = decode(envelope([audio("synthetic-audio-1", "m4a")]),
    { ...context, message_object_ids: ["synthetic-audio-1"] }) as { ready_audio: readonly Record<string, unknown>[] };
  assert.equal(result.ready_audio[0]?.mime_type, "audio/mp4");
  assert.equal(result.ready_audio[0]?.mime_source, "URL_EXTENSION_LOCAL_POLICY");
});

test("keeps model echo unknown instead of replacing a missing object model with request context", () => {
  const missing = { id: "synthetic-audio-1", object_type: "audio", object_url: "https://r2.syntx.ai/synthetic/unknown.mp3", completed: true };
  const result = decode(envelope([missing]), { ...context, message_object_ids: ["synthetic-audio-1"] }) as {
    model_echo: string; ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[];
  };
  assert.equal(result.model_echo, "UNKNOWN");
  assert.equal(result.ready_audio.length, 1);
  assert.deepEqual(result.gaps, [{ object_index: 0, code: "MODEL_TYPE_UNAVAILABLE" }]);
});

test("a foreign model on any expected audio sibling invalidates the whole message binding", () => {
  const result = decode(envelope([audio("synthetic-audio-1"), audio("synthetic-audio-2", "mp3", "eleven_v3")])) as {
    message_binding: string; model_echo: string; ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[];
  };
  assert.equal(result.message_binding, "UNVERIFIED");
  assert.equal(result.model_echo, "MISMATCH");
  assert.deepEqual(result.ready_audio, []);
  assert.deepEqual(result.gaps, [{ object_index: 1, code: "MODEL_TYPE_MISMATCH" }]);
});

test("rejects a non-audio object without treating its URL as audio", () => {
  const result = decode(envelope([{ ...audio("synthetic-audio-1"), object_type: "image" }]),
    { ...context, message_object_ids: ["synthetic-audio-1"] }) as {
      message_binding: string; ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[];
    };
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_audio, []);
  assert.deepEqual(result.gaps, [{ object_index: 0, code: "OBJECT_TYPE_UNSUPPORTED" }]);
});

test("rejects wrong outer message, author, and provider chat before exposing audio URLs", () => {
  const cases = [
    { raw: envelope([audio("synthetic-audio-1")], { id: "other-message" }), code: "OUTER_MESSAGE_ID_MISMATCH" },
    { raw: envelope([audio("synthetic-audio-1")], { author_id: 42 }), code: "NOT_BOT_MESSAGE" },
    { raw: envelope([audio("synthetic-audio-1")], { chat_id: 42002 }), code: "PROVIDER_CHAT_ID_MISMATCH" }
  ];
  for (const entry of cases) {
    const result = decode(entry.raw, { ...context, message_object_ids: ["synthetic-audio-1"] }) as {
      message_binding: string; ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[];
    };
    assert.equal(result.message_binding, "UNVERIFIED");
    assert.deepEqual(result.ready_audio, []);
    assert.equal(result.gaps[0]?.code, entry.code);
  }
});

test("enforces context object IDs and rejects unexpected, duplicate, or missing IDs", () => {
  const result = decode(envelope([audio("unexpected-audio")]), { ...context, message_object_ids: ["synthetic-audio-1"] }) as {
    ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[];
  };
  assert.deepEqual(result.ready_audio, []);
  assert.deepEqual(result.gaps, [
    { object_index: 0, code: "OBJECT_ID_UNEXPECTED" },
    { object_index: null, code: "EXPECTED_OBJECT_ID_MISSING" }
  ]);
  assert.throws(() => decode(envelope([]), { ...context, message_object_ids: ["same-id", "same-id"] }), /INVALID_OWNER_ELEVENLABS_AUDIO_RESULT_CONTEXT/u);
});

test("rejects unsafe audio URLs and reports unknown URL extensions without inventing a MIME", () => {
  const unsafe = decode(envelope([{ ...audio("synthetic-audio-1"), object_url: "https://evil.invalid/synthetic-audio-1.mp3" }]),
    { ...context, message_object_ids: ["synthetic-audio-1"] }) as { ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[] };
  assert.deepEqual(unsafe.ready_audio, []);
  assert.deepEqual(unsafe.gaps, [{ object_index: 0, code: "OBJECT_URL_UNSAFE" }]);
  const unknown = decode(envelope([audio("synthetic-audio-1", "aac")]),
    { ...context, message_object_ids: ["synthetic-audio-1"] }) as { ready_audio: readonly Record<string, unknown>[]; gaps: readonly Record<string, unknown>[] };
  assert.equal(unknown.ready_audio[0]?.mime_type, null);
  assert.equal(unknown.ready_audio[0]?.mime_source, "UNKNOWN");
  assert.deepEqual(unknown.gaps, [{ object_index: 0, code: "MIME_TYPE_UNKNOWN" }]);
});

test("accepts all 64 bound audio objects without claiming a provider output count", () => {
  const ids = Array.from({ length: 64 }, (_, index) => `synthetic-audio-${index}`);
  const result = decode(envelope(ids.map((id) => audio(id))), { ...context, message_object_ids: ids }) as {
    message_binding: string; ready_audio: readonly unknown[]; gaps: readonly unknown[]; backend_acceptance: string;
  };
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.ready_audio.length, 64);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.backend_acceptance, "UNPROVEN");
});

test("ignores known metadata without traversing it and reports future fields without echoing values", () => {
  let nestedReads = 0;
  let futureReads = 0;
  const metadata: Record<string, unknown> = {};
  Object.defineProperty(metadata, "secret", { enumerable: true, get() { nestedReads += 1; return "private"; } });
  const item: Record<string, unknown> = { ...audio("synthetic-audio-1"), message_id: "synthetic-audio-message", object_text: "ignored",
    created_at: "ignored", updated_at: "ignored", metadata };
  Object.defineProperty(item, "future_object_field", { enumerable: true, get() { futureReads += 1; return "private-object-value"; } });
  const raw: Record<string, unknown> = { ...envelope([item], { created_at: "ignored", updated_at: "ignored", is_favorite: false }) };
  Object.defineProperty(raw, "future_message_field", { enumerable: true, get() { futureReads += 1; return "private-message-value"; } });
  const result = decode(raw, { ...context, message_object_ids: ["synthetic-audio-1"] }) as {
    ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[];
  };
  assert.equal(result.ready_audio.length, 1);
  assert.deepEqual(result.gaps, [
    { object_index: null, code: "UNRECOGNIZED_MESSAGE_FIELDS" },
    { object_index: 0, code: "UNRECOGNIZED_OBJECT_FIELDS" }
  ]);
  assert.equal(nestedReads, 0);
  assert.equal(futureReads, 0);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("rejects proxy, sparse, and over-limit object arrays and malformed contexts", () => {
  const sparse = new Array(1);
  const sparseResult = decode(envelope(sparse), { ...context, message_object_ids: ["synthetic-audio-1"] }) as { gaps: readonly Record<string, unknown>[] };
  assert.deepEqual(sparseResult.gaps, [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_INVALID" }]);
  const oversized = Array.from({ length: 65 }, (_, index) => audio(`synthetic-audio-${index}`));
  const limitResult = decode(envelope(oversized), { ...context, message_object_ids: oversized.slice(0, 64).map((item) => String(item.id)) }) as {
    gaps: readonly Record<string, unknown>[];
  };
  assert.deepEqual(limitResult.gaps, [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_LOCAL_LIMIT" }]);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.throws(() => decode(envelope([]), revoked.proxy), /INVALID_OWNER_ELEVENLABS_AUDIO_RESULT_CONTEXT/u);
  assert.throws(() => decode(envelope([]), { ...context, model_id: "eleven_multilingual_sts_v2" }), /INVALID_OWNER_ELEVENLABS_AUDIO_RESULT_CONTEXT/u);
});
