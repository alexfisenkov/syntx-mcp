import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/adapter/syntx/owner-elevenlabs-sts-result-codec.js", import.meta.url).href;
const moduleValue = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const context = Object.freeze({ chat_uuid: "synthetic-sts-chat", message_id: "synthetic-sts-message",
  model_id: "eleven_multilingual_sts_v2", provider_chat_id: "42001",
  message_object_ids: Object.freeze(["synthetic-sts-audio-1"]) });

type Decode = (raw: unknown, readContext: unknown) => Record<string, unknown>;
function decode(raw: unknown, readContext: unknown = context): Record<string, unknown> {
  assert.ok(moduleValue, "MISSING_OWNER_ELEVENLABS_STS_RESULT_CODEC_MODULE");
  const decoder = moduleValue.decodeOwnerElevenLabsStsResult as Decode;
  assert.equal(typeof decoder, "function", "MISSING_OWNER_ELEVENLABS_STS_RESULT_CODEC");
  return decoder(raw, readContext);
}

function object(overrides: Record<string, unknown> = {}) {
  return { id: "synthetic-sts-audio-1", object_type: "audio",
    object_url: "https://r2.syntx.ai/synthetic/synthetic-sts-audio-1.mp3",
    model_type: "eleven_multilingual_sts_v2", completed: true, ...overrides };
}
function envelope(objects: readonly Record<string, unknown>[], overrides: Record<string, unknown> = {}) {
  return { id: "synthetic-sts-message", chat_id: 42001, author_id: -1, message_object: objects, ...overrides };
}

test("binds one completed STS v2 bot MP3 object to its message, chat, and expected object ID", () => {
  const result = decode(envelope([object()])) as { message_binding: string; model_echo: string;
    ready_audio: readonly Record<string, unknown>[]; gaps: readonly unknown[]; backend_acceptance: string };
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.deepEqual(result.ready_audio, [{ object_index: 0, message_object_id: "synthetic-sts-audio-1",
    object_type: "audio", object_url: "https://r2.syntx.ai/synthetic/synthetic-sts-audio-1.mp3",
    mime_type: "audio/mpeg", mime_source: "URL_EXTENSION_LOCAL_POLICY" }]);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal("provider_terminal_status" in result, false);
});

test("keeps pending, incomplete, or unknown-model STS results artifact-free", () => {
  for (const value of [object({ completed: false }), object({ completed: null }), object({ model_type: undefined })]) {
    const result = decode(envelope([value])) as { ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[] };
    assert.deepEqual(result.ready_audio, []);
    assert.equal(result.gaps.length, 1);
    assert.equal("id" in result.gaps[0]!, false);
    assert.equal("object_url" in result.gaps[0]!, false);
  }
});

test("never binds a foreign model, message, object, or unsafe URL", () => {
  const cases = [
    { raw: envelope([object({ model_type: "eleven_multilingual_v2" })]), code: "MODEL_TYPE_MISMATCH", binding: "UNVERIFIED" },
    { raw: envelope([object()], { id: "synthetic-other-message" }), code: "OUTER_MESSAGE_ID_MISMATCH", binding: "UNVERIFIED" },
    { raw: envelope([object({ id: "synthetic-other-object" })]), code: "OBJECT_ID_MISMATCH", binding: "UNVERIFIED" },
    { raw: envelope([object({ object_url: "https://evil.invalid/private.mp3" })]), code: "OBJECT_URL_UNSAFE", binding: "BOUND" },
    { raw: envelope([object({ object_url: "https://r2.syntx.ai/private.wav" })]), code: "OBJECT_MIME_UNSUPPORTED", binding: "BOUND" }
  ];
  for (const entry of cases) {
    const result = decode(entry.raw) as { message_binding: string; ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[] };
    assert.equal(result.message_binding, entry.binding);
    assert.deepEqual(result.ready_audio, []);
    assert.equal(result.gaps[0]?.code, entry.code);
    assert.equal("message_id" in result.gaps[0]!, false);
    assert.equal("object_url" in result.gaps[0]!, false);
  }
});

test("rejects provider-pending and malformed contexts without exposing any result artifact", () => {
  const pending = decode(envelope([])) as { ready_audio: readonly unknown[]; gaps: readonly Record<string, unknown>[] };
  assert.deepEqual(pending.ready_audio, []);
  assert.deepEqual(pending.gaps, [{ object_index: null, code: "MESSAGE_OBJECT_ARRAY_EMPTY" }]);
  assert.throws(() => decode(envelope([object()]), { ...context, model_id: "eleven_multilingual_v2" }),
    /INVALID_OWNER_ELEVENLABS_STS_RESULT_CONTEXT/u);
});
