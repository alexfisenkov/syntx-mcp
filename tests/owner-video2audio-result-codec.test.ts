import assert from "node:assert/strict";
import test from "node:test";

const MODULE_URL = new URL("../src/application/owner-video2audio-result-codec.js", import.meta.url).href;
const codecModule = await import(MODULE_URL).catch(() => null) as Record<string, unknown> | null;

function correlate(input: unknown): Record<string, unknown> {
  assert.ok(codecModule, "MISSING_OWNER_VIDEO2AUDIO_RESULT_CODEC_MODULE");
  const fn = codecModule.correlateOwnerVideo2AudioHistory as (value: unknown) => Record<string, unknown>;
  assert.equal(typeof fn, "function", "MISSING_OWNER_VIDEO2AUDIO_HISTORY_CORRELATOR");
  return fn(input);
}

function decode(raw: unknown, context: unknown): Record<string, unknown> {
  assert.ok(codecModule, "MISSING_OWNER_VIDEO2AUDIO_RESULT_CODEC_MODULE");
  const fn = codecModule.decodeOwnerVideo2AudioResult as (message: unknown, value: unknown) => Record<string, unknown>;
  assert.equal(typeof fn, "function", "MISSING_OWNER_VIDEO2AUDIO_RESULT_DECODER");
  return fn(raw, context);
}

const chatUuid = "video2audio-owned-chat-1128";
const prompt = "A short, gentle ripple of water with a soft breeze.";
const ownerAckMessageId = "video2audio-owner-ack-1128";
const resultMessageId = "video2audio-result-1128";
const videoObjectId = "video2audio-video-object-1128";
const videoUrl = "https://r2.syntx.ai/generated/video2audio-1128.mp4";

const observedPage = {
  messages: [
    { id: ownerAckMessageId, chat_id: 41356, author_id: 7021, message_object: [
      { id: "video2audio-ack-object", message_id: ownerAckMessageId, object_type: "text", object_text: prompt, model_type: "video2audio" }
    ] },
    { id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [
      { id: videoObjectId, message_id: resultMessageId, object_type: "video", model_type: "video2audio", completed: true, object_url: videoUrl }
    ] }
  ],
  pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
};

test("correlates the exact V2A owner ACK and retains the observed video result context", () => {
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [observedPage] }) as {
      status: string; owner_ack_status: string; history_page_status: string; contexts: readonly Record<string, unknown>[];
      gaps: readonly unknown[]; backend_acceptance: string;
    };
  assert.equal(history.status, "COMPLETE");
  assert.equal(history.owner_ack_status, "MATCHED");
  assert.equal(history.history_page_status, "COMPLETE");
  assert.deepEqual(history.contexts, [{ chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio",
    provider_chat_id: "41356", message_object_ids: [videoObjectId], owner_echo_message_id: ownerAckMessageId }]);
  assert.deepEqual(history.gaps, []);
  assert.equal(history.backend_acceptance, "UNPROVEN");
  assert.equal("output_count" in history, false);
  assert.equal("provider_terminal_status" in history, false);
});

test("matches only the exact Video2Audio display-prefixed owner ACK", () => {
  const pageWithAckText = (objectText: string) => {
    const page = JSON.parse(JSON.stringify(observedPage)) as { messages: Array<{ message_object: Array<Record<string, unknown>> }>;
      pagination: Record<string, unknown> };
    page.messages[0]!.message_object[0]!.object_text = objectText;
    return page;
  };
  const prefixed = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [pageWithAckText(`🎵 ${prompt}`)] }) as { status: string; owner_ack_status: string; contexts: readonly unknown[]; gaps: readonly string[] };
  assert.equal(prefixed.status, "COMPLETE");
  assert.equal(prefixed.owner_ack_status, "MATCHED");
  assert.equal(prefixed.contexts.length, 1);
  assert.deepEqual(prefixed.gaps, []);

  for (const wrongText of ["A different prompt", `untrusted prefix: ${prompt}`, `${prompt} additional suffix`]) {
    const rejected = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
      prompt, pages: [pageWithAckText(wrongText)] }) as {
        status: string; owner_ack_status: string; contexts: readonly unknown[]; gaps: readonly string[];
      };
    assert.equal(rejected.status, "UNVERIFIED", wrongText);
    assert.equal(rejected.owner_ack_status, "MISMATCH", wrongText);
    assert.deepEqual(rejected.contexts, [], wrongText);
    assert.deepEqual(rejected.gaps, ["OWNER_ACK_MISMATCH"], wrongText);
  }
});

test("rejects history rows whose provider chat id is not the observed numeric field", () => {
  const page = JSON.parse(JSON.stringify(observedPage)) as { messages: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
  page.messages[0]!.chat_id = "41356";
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [page] }) as { status: string; contexts: readonly unknown[]; gaps: readonly string[] };
  assert.equal(history.status, "UNVERIFIED");
  assert.deepEqual(history.contexts, []);
  assert.deepEqual(history.gaps, ["HISTORY_ROW_INVALID"]);
});

test("ignores inert provider timestamps and metadata while binding the exact history messages", () => {
  const page = JSON.parse(JSON.stringify(observedPage)) as { messages: Array<Record<string, unknown>>; pagination: Record<string, unknown> };
  page.messages = page.messages.map((row) => ({ ...row, created_at: "2026-10-13T00:00:00.000Z", updated_at: "2026-10-13T00:00:01.000Z",
    is_favorite: false }));
  page.pagination.snapshot_version = "nonbinding-metadata";
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [page] }) as { status: string; contexts: readonly unknown[]; gaps: readonly string[] };
  assert.equal(history.status, "COMPLETE");
  assert.equal(history.contexts.length, 1);
  assert.deepEqual(history.gaps, []);
  assert.equal(JSON.stringify(history).includes("nonbinding-metadata"), false);
});

test("accepts inert task metadata on owned ACK and bot objects but rejects unknown object fields", () => {
  const withInertFields = JSON.parse(JSON.stringify(observedPage)) as { messages: Array<{ message_object: Array<Record<string, unknown>> }>;
    pagination: Record<string, unknown> };
  withInertFields.messages = withInertFields.messages.map((row) => ({
    ...row,
    message_object: row.message_object.map((object) => ({ ...object, created_at: "2026-10-14T00:00:00.000Z",
      updated_at: "2026-10-14T00:00:01.000Z", task_id: "task-private-inert-value", metadata: { private: "metadata-inert-value" } }))
  }));
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [withInertFields] }) as { status: string; contexts: readonly unknown[]; gaps: readonly string[] };
  assert.equal(history.status, "COMPLETE");
  assert.equal(history.contexts.length, 1);
  assert.deepEqual(history.gaps, []);
  const serialized = JSON.stringify(history);
  assert.equal(serialized.includes("2026-10-14T00:00:00.000Z"), false);
  assert.equal(serialized.includes("2026-10-14T00:00:01.000Z"), false);
  assert.equal(serialized.includes("task-private-inert-value"), false);
  assert.equal(serialized.includes("metadata-inert-value"), false);

  const withUnknownField = JSON.parse(JSON.stringify(withInertFields)) as typeof withInertFields;
  withUnknownField.messages[1]!.message_object[0]!.unexpected_payload = "must-not-bind";
  const rejected = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [withUnknownField] }) as { status: string; contexts: readonly unknown[]; gaps: readonly string[] };
  assert.equal(rejected.status, "UNVERIFIED");
  assert.deepEqual(rejected.contexts, []);
  assert.deepEqual(rejected.gaps, ["HISTORY_OBJECTS_INVALID"]);
  assert.equal(JSON.stringify(rejected).includes("must-not-bind"), false);
});

test("aggregates every bot result across complete consistent history pages", () => {
  const fillerRows = Array.from({ length: 8 }, (_, index) => ({ id: `other-owner-${index}`, chat_id: 41356, author_id: 7021, message_object: [] }));
  const firstBotMessageId = "video2audio-result-page-1";
  const secondBotMessageId = "video2audio-result-page-2";
  const firstBotObjectId = "video2audio-object-page-1";
  const secondBotObjectId = "video2audio-object-page-2";
  const firstPage = {
    messages: [
      observedPage.messages[0], ...fillerRows,
      { id: firstBotMessageId, chat_id: 41356, author_id: -1, message_object: [
        { id: firstBotObjectId, message_id: firstBotMessageId, object_type: "video", model_type: "video2audio", completed: true,
          object_url: "https://r2.syntx.ai/generated/page-one.mp4" }
      ] }
    ],
    pagination: { page: 1, page_size: 10, total_count: 11, total_pages: 2, has_next: true, has_previous: false }
  };
  const secondPage = {
    messages: [{ id: secondBotMessageId, chat_id: 41356, author_id: -1, message_object: [
      { id: secondBotObjectId, message_id: secondBotMessageId, object_type: "audio", model_type: "video2audio", completed: true,
        object_url: "https://r2.syntx.ai/generated/page-two.mp3" }
    ] }],
    pagination: { page: 2, page_size: 10, total_count: 11, total_pages: 2, has_next: false, has_previous: true }
  };
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [firstPage, secondPage] }) as { status: string; history_page_status: string; contexts: readonly Record<string, unknown>[]; gaps: readonly unknown[] };
  assert.equal(history.status, "COMPLETE");
  assert.equal(history.history_page_status, "COMPLETE");
  assert.deepEqual(history.contexts.map(({ message_id, message_object_ids }) => ({ message_id, message_object_ids })), [
    { message_id: firstBotMessageId, message_object_ids: [firstBotObjectId] },
    { message_id: secondBotMessageId, message_object_ids: [secondBotObjectId] }
  ]);
  assert.deepEqual(history.gaps, []);
});

test("fails closed and mints no result context when history-page totals drift", () => {
  const firstPage = JSON.parse(JSON.stringify(observedPage)) as { messages: unknown[]; pagination: Record<string, unknown> };
  firstPage.pagination = { page: 1, page_size: 10, total_count: 11, total_pages: 2, has_next: true, has_previous: false };
  const secondPage = { messages: [], pagination: { page: 2, page_size: 10, total_count: 12, total_pages: 2,
    has_next: false, has_previous: true } };
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [firstPage, secondPage] }) as { status: string; history_page_status: string; contexts: readonly unknown[]; gaps: readonly string[] };
  assert.equal(history.status, "UNVERIFIED");
  assert.equal(history.history_page_status, "UNPROVEN");
  assert.deepEqual(history.contexts, []);
  assert.deepEqual(history.gaps, ["HISTORY_PAGE_INCONSISTENT"]);
});

test("bounds aggregate history to seven pages before inspecting results", () => {
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: Array.from({ length: 8 }, () => ({})) }) as {
      status: string; history_page_status: string; contexts: readonly unknown[]; gaps: readonly string[];
    };
  assert.equal(history.status, "INCOMPLETE");
  assert.equal(history.history_page_status, "INCOMPLETE");
  assert.deepEqual(history.contexts, []);
  assert.deepEqual(history.gaps, ["HISTORY_PAGE_LIMIT"]);
});

test("requires the exact posted owner prompt/model echo before exposing bot result contexts", () => {
  const page = JSON.parse(JSON.stringify(observedPage)) as { messages: Array<{ message_object: Array<Record<string, unknown>> }>;
    pagination: Record<string, unknown> };
  page.messages[0]!.message_object[0]!.object_text = `${prompt} altered`;
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [page] }) as { status: string; owner_ack_status: string; contexts: readonly unknown[]; gaps: readonly string[] };
  assert.equal(history.status, "UNVERIFIED");
  assert.equal(history.owner_ack_status, "MISMATCH");
  assert.deepEqual(history.contexts, []);
  assert.deepEqual(history.gaps, ["OWNER_ACK_MISMATCH"]);
});

test("treats duplicate exact owner ACK rows as ambiguous instead of selecting one", () => {
  const duplicateAck = { ...observedPage.messages[0], id: "video2audio-owner-ack-duplicate", message_object: [
    { ...observedPage.messages[0]!.message_object[0], id: "video2audio-ack-object-duplicate", message_id: "video2audio-owner-ack-duplicate" }
  ] };
  const page = { messages: [...observedPage.messages, duplicateAck], pagination: {
    page: 1, page_size: 10, total_count: 3, total_pages: 1, has_next: false, has_previous: false
  } };
  const history = correlate({ chat_uuid: chatUuid, model_id: "video2audio", owner_echo_message_id: ownerAckMessageId,
    prompt, pages: [page] }) as { status: string; owner_ack_status: string; contexts: readonly unknown[]; gaps: readonly string[] };
  assert.equal(history.status, "UNVERIFIED");
  assert.equal(history.owner_ack_status, "AMBIGUOUS");
  assert.deepEqual(history.contexts, []);
  assert.deepEqual(history.gaps, ["OWNER_ACK_AMBIGUOUS"]);
});

test("decodes the observed H.264-in-MP4 V2A result as a video artifact without requiring MIME echo", () => {
  const result = decode({ id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [
    { id: videoObjectId, message_id: resultMessageId, object_type: "video", model_type: "video2audio", completed: true, object_url: videoUrl }
  ] }, { chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio", provider_chat_id: "41356",
    message_object_ids: [videoObjectId], owner_echo_message_id: ownerAckMessageId }) as {
      message_binding: string; model_echo: string; ready_artifacts: readonly Record<string, unknown>[];
      gaps: readonly unknown[]; backend_acceptance: string;
    };
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.model_echo, "MATCHED");
  assert.deepEqual(result.ready_artifacts, [{ object_index: 0, message_object_id: videoObjectId, object_type: "video",
    object_url: videoUrl, mime_type: "video/mp4", mime_source: "URL_EXTENSION_LOCAL_POLICY", model_echo: "MATCHED" }]);
  assert.deepEqual(result.gaps, []);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal("output_count" in result, false);
  assert.equal("provider_terminal_status" in result, false);
});

test("preserves a separate ready audio object beside the V2A MP4 video object", () => {
  const audioObjectId = "video2audio-audio-object-1128";
  const audioUrl = "https://r2.syntx.ai/generated/video2audio-1128.m4a";
  const result = decode({ id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [
    { id: videoObjectId, message_id: resultMessageId, object_type: "video", model_type: "video2audio", completed: true, object_url: videoUrl },
    { id: audioObjectId, message_id: resultMessageId, object_type: "audio", model_type: "video2audio", completed: true, object_url: audioUrl }
  ] }, { chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio", provider_chat_id: "41356",
    message_object_ids: [videoObjectId, audioObjectId], owner_echo_message_id: ownerAckMessageId }) as {
      ready_artifacts: readonly Record<string, unknown>[]; gaps: readonly unknown[];
    };
  assert.deepEqual(result.ready_artifacts.map(({ message_object_id, object_type, mime_type }) => ({ message_object_id, object_type, mime_type })), [
    { message_object_id: videoObjectId, object_type: "video", mime_type: "video/mp4" },
    { message_object_id: audioObjectId, object_type: "audio", mime_type: "audio/mp4" }
  ]);
  assert.deepEqual(result.gaps, []);
});

test("keeps a ready sibling but emits explicit gaps for incomplete and unknown result objects", () => {
  const audioObjectId = "video2audio-audio-ready";
  const incompleteId = "video2audio-video-incomplete";
  const unknownId = "video2audio-unknown-type";
  const result = decode({ id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [
    { id: incompleteId, message_id: resultMessageId, object_type: "video", model_type: "video2audio", completed: false,
      object_url: "https://r2.syntx.ai/generated/not-ready.mp4" },
    { id: audioObjectId, message_id: resultMessageId, object_type: "audio", model_type: "video2audio", completed: true,
      object_url: "https://r2.syntx.ai/generated/separate-track.mp3" },
    { id: unknownId, message_id: resultMessageId, object_type: "unknown-render", model_type: "video2audio", completed: true,
      object_url: "https://r2.syntx.ai/generated/unknown.bin" }
  ] }, { chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio", provider_chat_id: "41356",
    message_object_ids: [incompleteId, audioObjectId, unknownId], owner_echo_message_id: ownerAckMessageId }) as {
      message_binding: string; ready_artifacts: readonly Record<string, unknown>[]; gaps: readonly Record<string, unknown>[];
    };
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_artifacts.map(({ message_object_id }) => message_object_id), [audioObjectId]);
  assert.deepEqual(result.gaps, [
    { object_index: 0, code: "OBJECT_INCOMPLETE" },
    { object_index: 2, code: "OBJECT_TYPE_UNSUPPORTED" }
  ]);
});

test("a foreign object model invalidates the whole result and suppresses earlier ready URLs", () => {
  const audioObjectId = "video2audio-audio-foreign";
  const result = decode({ id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [
    { id: videoObjectId, message_id: resultMessageId, object_type: "video", model_type: "video2audio", completed: true, object_url: videoUrl },
    { id: audioObjectId, message_id: resultMessageId, object_type: "audio", model_type: "different-model", completed: true,
      object_url: "https://r2.syntx.ai/generated/foreign.mp3" }
  ] }, { chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio", provider_chat_id: "41356",
    message_object_ids: [videoObjectId, audioObjectId], owner_echo_message_id: ownerAckMessageId }) as {
      message_binding: string; model_echo: string; ready_artifacts: readonly unknown[]; gaps: readonly Record<string, unknown>[];
    };
  assert.equal(result.message_binding, "UNVERIFIED");
  assert.equal(result.model_echo, "MISMATCH");
  assert.deepEqual(result.ready_artifacts, []);
  assert.deepEqual(result.gaps, [{ object_index: 1, code: "MODEL_TYPE_MISMATCH" }]);
});

test("does not invent missing model or MIME echoes for a safe result URL", () => {
  const result = decode({ id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [
    { id: videoObjectId, message_id: resultMessageId, object_type: "video", completed: true,
      object_url: "https://r2.syntx.ai/generated/no-extension" }
  ] }, { chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio", provider_chat_id: "41356",
    message_object_ids: [videoObjectId], owner_echo_message_id: ownerAckMessageId }) as {
      model_echo: string; ready_artifacts: readonly Record<string, unknown>[]; gaps: readonly Record<string, unknown>[];
    };
  assert.equal(result.model_echo, "UNKNOWN");
  assert.equal(result.ready_artifacts[0]?.mime_type, null);
  assert.equal(result.ready_artifacts[0]?.mime_source, "UNKNOWN");
  assert.deepEqual(result.gaps, [
    { object_index: 0, code: "MODEL_TYPE_UNAVAILABLE" },
    { object_index: 0, code: "MIME_TYPE_UNKNOWN" }
  ]);
});

test("rejects unsafe result destinations without echoing the provider URL", () => {
  const unsafeUrl = "https://evil.invalid/private/video2audio-secret.mp4?token=not-for-output";
  const result = decode({ id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [
    { id: videoObjectId, message_id: resultMessageId, object_type: "video", model_type: "video2audio", completed: true,
      object_url: unsafeUrl }
  ] }, { chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio", provider_chat_id: "41356",
    message_object_ids: [videoObjectId], owner_echo_message_id: ownerAckMessageId }) as {
      ready_artifacts: readonly unknown[]; gaps: readonly Record<string, unknown>[];
    };
  assert.deepEqual(result.ready_artifacts, []);
  assert.deepEqual(result.gaps, [{ object_index: 0, code: "OBJECT_URL_UNSAFE" }]);
  assert.equal(JSON.stringify(result).includes("evil.invalid"), false);
  assert.equal(JSON.stringify(result).includes("not-for-output"), false);
});

test("reports duplicate, unexpected, and missing object identities while retaining only the exact ready object", () => {
  const unexpectedId = "video2audio-unexpected-object";
  const expectedMissingId = "video2audio-expected-missing";
  const result = decode({ id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [
    { id: videoObjectId, message_id: resultMessageId, object_type: "video", model_type: "video2audio", completed: true, object_url: videoUrl },
    { id: videoObjectId, message_id: resultMessageId, object_type: "video", model_type: "video2audio", completed: true,
      object_url: "https://r2.syntx.ai/generated/duplicate.mp4" },
    { id: unexpectedId, message_id: resultMessageId, object_type: "audio", model_type: "video2audio", completed: true,
      object_url: "https://r2.syntx.ai/generated/unexpected.mp3" }
  ] }, { chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio", provider_chat_id: "41356",
    message_object_ids: [videoObjectId, expectedMissingId], owner_echo_message_id: ownerAckMessageId }) as {
      ready_artifacts: readonly Record<string, unknown>[]; gaps: readonly Record<string, unknown>[];
    };
  assert.deepEqual(result.ready_artifacts.map(({ message_object_id }) => message_object_id), [videoObjectId]);
  assert.deepEqual(result.gaps, [
    { object_index: 1, code: "OBJECT_ID_DUPLICATE" },
    { object_index: 2, code: "OBJECT_ID_UNEXPECTED" },
    { object_index: null, code: "EXPECTED_OBJECT_ID_MISSING" }
  ]);
});

test("rejects invalid data-only contexts and never evaluates result-message accessors", () => {
  assert.throws(() => decode({ id: resultMessageId, chat_id: 41356, author_id: -1, message_object: [] }, {
    chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio", provider_chat_id: "41356",
    message_object_ids: [videoObjectId, videoObjectId], owner_echo_message_id: ownerAckMessageId
  }), /INVALID_OWNER_VIDEO2AUDIO_RESULT_CONTEXT/u);
  let getterReads = 0;
  const accessorEnvelope: Record<string, unknown> = { chat_id: 41356, author_id: -1, message_object: [] };
  Object.defineProperty(accessorEnvelope, "id", { enumerable: true, get() { getterReads += 1; return resultMessageId; } });
  const result = decode(accessorEnvelope, { chat_uuid: chatUuid, message_id: resultMessageId, model_id: "video2audio",
    provider_chat_id: "41356", message_object_ids: [videoObjectId], owner_echo_message_id: ownerAckMessageId }) as {
      message_binding: string; ready_artifacts: readonly unknown[]; gaps: readonly Record<string, unknown>[];
    };
  assert.equal(result.message_binding, "UNVERIFIED");
  assert.deepEqual(result.ready_artifacts, []);
  assert.deepEqual(result.gaps, [{ object_index: null, code: "ENVELOPE_SHAPE_INVALID" }]);
  assert.equal(getterReads, 0);
});
