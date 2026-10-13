import assert from "node:assert/strict";
import test from "node:test";

const HISTORY_BINDING_URL = new URL("../src/application/owner-wan-t2i-history-binding.js", import.meta.url).href;
const CHAT_CLIENT_URL = new URL("../src/adapter/syntx/chat-http-client.js", import.meta.url).href;
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SHA = `sha256:${"a".repeat(64)}`;
const CHAT = "wan-t2i-chat";
const ACK = "wan-t2i-owner-ack";
const BOT = "wan-t2i-bot-message";

interface Api {
  correlateOwnerWanT2iHistoryBinding(input: unknown): HistoryBinding;
}
interface T2iReadContext {
  readonly message_object_ids: readonly string[];
  readonly [key: string]: unknown;
}
type HistoryBinding =
  | { readonly status: "READY"; readonly read_context: T2iReadContext }
  | { readonly status: "PENDING"; readonly reason: string }
  | { readonly status: "UNVERIFIED"; readonly reason: string };
interface T2iArtifact {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly model_type: string;
  readonly mime_type: string | null;
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}
interface T2iResult {
  readonly status: "COMPLETE" | "PARTIAL" | "PENDING" | "UNVERIFIED";
  readonly actual_result_count: number;
  readonly count_confidence: string;
  readonly provider_terminal_confidence: "UNPROVEN";
  readonly artifacts: readonly T2iArtifact[];
}

async function loadApi(): Promise<Api> {
  let module: Record<string, unknown> | undefined;
  try { module = await import(HISTORY_BINDING_URL) as Record<string, unknown>; }
  catch { /* Expected RED before the T2I history module is added. */ }
  assert.equal(typeof module?.correlateOwnerWanT2iHistoryBinding, "function", "MISSING_OWNER_WAN_T2I_HISTORY_BINDER");
  return module as unknown as Api;
}

function profileBinding(model_id: "wan_25_t2i_preview" | "wan_26_t2i") {
  return { profile_id: "owner-wan-t2i-source-profile-v1", model_id, model_type: model_id, ai_name: "wan_image",
    catalog_version: CATALOG_VERSION, profile_schema_hash: SHA, request_fingerprint: `sha256:${"b".repeat(64)}`,
    intent_fingerprint: `sha256:${"c".repeat(64)}` };
}

function history(model_id: "wan_25_t2i_preview" | "wan_26_t2i", objectIds: readonly string[], options: {
  chat?: string; provider?: string; ownerId?: string; botId?: string;
  ownerRole?: "owner" | "bot" | "other"; botRole?: "owner" | "bot" | "other";
  ownerObjects?: readonly unknown[]; modelType?: string | null; complete?: boolean; extraRows?: readonly unknown[];
} = {}) {
  const chat = options.chat ?? CHAT;
  const provider = options.provider ?? "9001";
  return { complete: options.complete ?? true, page: 1, page_size: 10, total_count: options.extraRows ? 2 + options.extraRows.length : 2,
    total_pages: 1, has_next: false, has_previous: false, requested_chat_uuid: chat, provider_chat_id: provider,
    messages: [
      { message_id: options.ownerId ?? ACK, provider_chat_id: provider, author_role: options.ownerRole ?? "owner",
        objects: options.ownerObjects ?? [] },
      { message_id: options.botId ?? BOT, provider_chat_id: provider, author_role: options.botRole ?? "bot",
        objects: objectIds.map((id) => ({ message_object_id: id, object_type: "image", model_type: options.modelType ?? model_id })) },
      ...(options.extraRows ?? [])
    ] };
}

function bindInput(model_id: "wan_25_t2i_preview" | "wan_26_t2i", requested_batch_size: 1 | 2 | 3 | 4,
  objectIds: readonly string[], options: Parameters<typeof history>[2] = {}) {
  return { snapshot: history(model_id, objectIds, options), requested_chat_uuid: options.chat ?? CHAT,
    owner_echo_message_id: options.ownerId ?? ACK, requested_batch_size, profile_binding: profileBinding(model_id) };
}

async function readNativeResult(model_id: "wan_25_t2i_preview" | "wan_26_t2i", requested_batch_size: 1 | 2 | 3 | 4,
  expectedIds: readonly string[], raw: unknown, contextOverride?: unknown) {
  const harness = await createNativeClient(raw);
  const context = contextOverride ?? resultContext(model_id, requested_batch_size, expectedIds);
  const result = await harness.client.getWanT2iImageResult(context);
  return { result, requests: harness.requests, credential_calls: harness.credentialCalls(), context, client: harness.client };
}

function resultContext(model_id: "wan_25_t2i_preview" | "wan_26_t2i", requested_batch_size: 1 | 2 | 3 | 4,
  expectedIds: readonly string[]) {
  return { chat_uuid: "t2i-chat", provider_chat_id: "9001", owner_echo_message_id: "101", message_id: "102",
    requested_batch_size, message_object_ids: expectedIds, ...profileBinding(model_id) };
}

async function createNativeClient(raw: unknown, requestTimeoutMs?: number, fetchOverride?: typeof fetch) {
  const module = await import(CHAT_CLIENT_URL) as unknown as { SyntxChatHttpClient: new (options: {
    credentialBroker: { useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> };
    fetchImpl: typeof fetch;
    requestTimeoutMs?: number;
  }) => { getWanT2iImageResult: (context: unknown, signal?: AbortSignal) => Promise<T2iResult> } };
  const requests: Array<{ url: string; method: string }> = [];
  let credentialCalls = 0;
  const client = new module.SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation("synthetic-wan-t2i-result-credential");
    } },
    fetchImpl: fetchOverride ?? (async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET" });
      return Response.json(raw);
    }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs })
  });
  assert.equal(typeof client.getWanT2iImageResult, "function", "MISSING_OWNER_WAN_T2I_RESULT_GET");
  return { client, requests, credentialCalls: () => credentialCalls };
}

test("exports the dedicated WAN T2I normalized-history binder", async () => {
  const api = await loadApi();
  const result = api.correlateOwnerWanT2iHistoryBinding(bindInput("wan_25_t2i_preview", 1, ["201"]));
  assert.equal(result.status, "READY");
  assert.deepEqual(result.read_context, {
    chat_uuid: CHAT, provider_chat_id: "9001", owner_echo_message_id: ACK, message_id: BOT,
    requested_batch_size: 1,
    message_object_ids: ["201"], ...profileBinding("wan_25_t2i_preview")
  });
});

test("history binding covers both exact models, batch sizes 1–4, and partial ordered IDs", async () => {
  const api = await loadApi();
  for (const model_id of ["wan_25_t2i_preview", "wan_26_t2i"] as const) for (const requested_batch_size of [1, 2, 3, 4] as const) {
    const allIds = Array.from({ length: requested_batch_size }, (_, index) => String(300 + index));
    const completeHistory = api.correlateOwnerWanT2iHistoryBinding(bindInput(model_id, requested_batch_size, allIds));
    assert.equal(completeHistory.status, "READY", `${model_id} batch ${requested_batch_size}`);
    if (completeHistory.status === "READY") assert.deepEqual(completeHistory.read_context.message_object_ids, allIds);
    if (requested_batch_size > 1) {
      const sparseIds = requested_batch_size === 2 ? [allIds[1]!] : [allIds[0]!, allIds[requested_batch_size - 1]!];
      const partialHistory = api.correlateOwnerWanT2iHistoryBinding(bindInput(model_id, requested_batch_size, sparseIds));
      assert.equal(partialHistory.status, "READY", `${model_id} partial history batch ${requested_batch_size}`);
      if (partialHistory.status === "READY") assert.deepEqual(partialHistory.read_context.message_object_ids, sparseIds);
    }
  }
});

test("history binding fails closed on wrong chat, owner/bot order, wrong model, duplicate, and excess IDs", async () => {
  const api = await loadApi();
  const base = bindInput("wan_25_t2i_preview", 2, ["401", "402"]);
  const reversed = { ...base, snapshot: { ...base.snapshot, messages: [...base.snapshot.messages].reverse() } };
  const otherChat = { ...base, snapshot: { ...base.snapshot, requested_chat_uuid: "another-chat" } };
  const wrongModel = bindInput("wan_25_t2i_preview", 2, ["401", "402"], { modelType: "wan_26_t2i" });
  const duplicate = bindInput("wan_25_t2i_preview", 2, ["401", "401"]);
  const excess = bindInput("wan_25_t2i_preview", 1, ["401", "402"]);
  const otherRow = bindInput("wan_25_t2i_preview", 2, ["401", "402"], {
    extraRows: [{ message_id: "unrelated-row", provider_chat_id: "9001", author_role: "other", objects: [] }]
  });
  for (const [input, reason] of [[otherChat, "CHAT_SCOPE_MISMATCH"], [reversed, "OWNER_ACK_AMBIGUOUS"],
    [wrongModel, "RESULT_OBJECTS_INVALID"], [duplicate, "OBJECT_ID_DUPLICATE"],
    [excess, "RESULT_OBJECTS_OVER_LIMIT"], [otherRow, "HISTORY_MESSAGE_SET_INVALID"]] as const) {
    const result = api.correlateOwnerWanT2iHistoryBinding(input);
    assert.deepEqual(result, { status: "UNVERIFIED", reason });
  }
});

test("native WAN T2I result GET decodes numeric IDs against the exact bound context", async () => {
  for (const model_id of ["wan_25_t2i_preview", "wan_26_t2i"] as const) for (const batch_size of [1, 2, 3, 4] as const) {
    const ids = Array.from({ length: batch_size }, (_, index) => String(201 + index));
    const raw = { id: 102, chat_id: 9001, author_id: -1, message_object: ids.map((id) => ({ id: Number(id),
      message_id: 102, object_type: "image", model_type: model_id, completed: true,
      object_url: `https://r2.syntx.ai/wan-t2i/result-${id}.png` })) };
    const { result, requests, credential_calls: credentialCalls } = await readNativeResult(model_id, batch_size, ids, raw);
    assert.equal(result.status, "COMPLETE", `${model_id} batch ${batch_size}`);
    assert.equal(result.actual_result_count, batch_size);
    assert.equal(result.provider_terminal_confidence, "UNPROVEN");
    assert.equal(result.count_confidence, "CURRENT_MESSAGE_MATCHES_EXPLICIT_BATCH_NOT_PROVIDER_TERMINAL");
    assert.deepEqual(result.artifacts.map((artifact) => artifact.message_object_id), ids);
    assert.ok(result.artifacts.every((artifact) => artifact.model_type === model_id && artifact.mime_type === "image/png" &&
      artifact.width === null && artifact.height === null && artifact.geometry_verified === false));
    assert.deepEqual(requests, [{ url: "https://api.syntx.ai/api/v1/chats/t2i-chat/102", method: "GET" }]);
    assert.equal(credentialCalls, 1);
  }
});

test("normalizes safe numeric zero IDs without truthiness or arbitrary coercion", async () => {
  const context = { chat_uuid: "t2i-zero-chat", provider_chat_id: "0", owner_echo_message_id: "1", message_id: "2",
    requested_batch_size: 1, message_object_ids: ["0"], ...profileBinding("wan_26_t2i") };
  const raw = { id: 2, chat_id: 0, author_id: -1, message_object: [{ id: 0, message_id: 2, object_type: "image",
    model_type: "wan_26_t2i", completed: true, object_url: "https://r2.syntx.ai/wan-t2i/zero.webp" }] };
  const { result, requests, credential_calls } = await readNativeResult("wan_26_t2i", 1, ["0"], raw, context);
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.artifacts[0]?.message_object_id, "0");
  assert.equal(result.artifacts[0]?.message_id, "2");
  assert.equal(result.artifacts[0]?.mime_type, "image/webp");
  assert.equal(requests.length, 1);
  assert.equal(credential_calls, 1);
});

test("keeps known partial T2I artifacts when a middle object or URI is pending", async () => {
  const raw = { id: 102, chat_id: 9001, author_id: -1, message_object: [
    { id: 201, message_id: 102, object_type: "image", model_type: "wan_25_t2i_preview", completed: true,
      object_url: "https://r2.syntx.ai/wan-t2i/first.png" },
    { id: 203, message_id: 102, object_type: "image", model_type: "wan_25_t2i_preview", completed: false, object_url: null },
    { id: 204, message_id: 102, object_type: "image", model_type: "wan_25_t2i_preview", completed: true, object_url: null }
  ] };
  const { result, requests, credential_calls } = await readNativeResult("wan_25_t2i_preview", 4, ["201", "202", "203", "204"], raw);
  assert.equal(result.status, "PARTIAL");
  assert.equal(result.actual_result_count, 3);
  assert.equal(result.count_confidence, "OBSERVED_CURRENT_MESSAGE_NOT_REQUESTED_TOTAL");
  assert.deepEqual(result.artifacts.map((artifact) => artifact.message_object_id), ["201"]);
  assert.equal(result.provider_terminal_confidence, "UNPROVEN");
  assert.equal(requests.length, 1);
  assert.equal(credential_calls, 1);
});

test("rejects malformed T2I result contexts before credentials or GET", async () => {
  const raw = { id: 102, chat_id: 9001, author_id: -1, message_object: [{ id: 201, message_id: 102,
    object_type: "image", model_type: "wan_25_t2i_preview", completed: true, object_url: "https://r2.syntx.ai/image.png" }] };
  const harness = await createNativeClient(raw);
  const base = resultContext("wan_25_t2i_preview", 1, ["201"]);
  const wrongType = { ...base, model_type: "wan_26_t2i" };
  const wrongProfile = { ...base, profile_id: "owner-wan-image-source-profile-v1" };
  const malformedProfileHash = { ...base, profile_schema_hash: "not-a-sha256" };
  const wrongCatalog = { ...base, catalog_version: "sha256-previous.json" };
  const duplicateIds = { ...base, message_object_ids: ["201", "201"] };
  const requestedFive = { ...base, requested_batch_size: 5 };
  const extraneous = { ...base, unexpected: true };
  const proxied = new Proxy(base, {});
  for (const context of [wrongType, wrongProfile, malformedProfileHash, wrongCatalog,
    duplicateIds, requestedFive, extraneous, proxied]) {
    await assert.rejects(() => harness.client.getWanT2iImageResult(context),
      (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === "INVALID_REQUEST");
  }
  assert.deepEqual(harness.requests, []);
  assert.equal(harness.credentialCalls(), 0);
});

test("fails closed on mismatched, duplicate, unobserved, and excess T2I result objects", async () => {
  const baseObject = { id: 201, message_id: 102, object_type: "image", model_type: "wan_25_t2i_preview",
    completed: true, object_url: "https://r2.syntx.ai/wan-t2i/result-201.png" };
  const mismatchBodies = [
    { id: 103, chat_id: 9001, author_id: -1, message_object: [baseObject] },
    { id: 102, chat_id: 9002, author_id: -1, message_object: [baseObject] },
    { id: 102, chat_id: 9001, author_id: 42, message_object: [baseObject] },
    { id: 102, chat_id: 9001, author_id: -1, message_object: [{ ...baseObject, model_type: "wan_26_t2i" }] },
    { id: 102, chat_id: 9001, author_id: -1, message_object: [{ ...baseObject, message_id: 103 }] },
    { id: 102, chat_id: 9001, author_id: -1, message_object: [{ ...baseObject, id: 999 }] },
    { id: -1, chat_id: 9001, author_id: -1, message_object: [baseObject] },
    { id: 1.5, chat_id: 9001, author_id: -1, message_object: [baseObject] },
    { id: Number.MAX_SAFE_INTEGER + 1, chat_id: 9001, author_id: -1, message_object: [baseObject] },
    { id: 102, chat_id: 9001, author_id: -1, message_object: [{ ...baseObject, id: -1 }] },
    { id: 102, chat_id: 9001, author_id: -1, message_object: [{ ...baseObject, id: 1.5 }] },
    { id: 102, chat_id: 9001, author_id: -1, message_object: [{ ...baseObject, id: Number.MAX_SAFE_INTEGER + 1 }] },
    { id: 102, chat_id: 9001, author_id: -1, message_object: [baseObject, baseObject] },
    { id: 102, chat_id: 9001, author_id: -1, message_object: Array.from({ length: 5 }, (_, index) =>
      ({ ...baseObject, id: 201 + index, message_id: 102 })) },
    { id: 102, chat_id: 9001, author_id: -1, message_object: [{ ...baseObject, object_url: "https://evil.invalid/private.png" }] }
  ];
  for (const raw of mismatchBodies) {
    const { result, requests, credential_calls } = await readNativeResult("wan_25_t2i_preview", 4,
      ["201", "202", "203", "204"], raw);
    assert.equal(result.status, "UNVERIFIED");
    assert.deepEqual(result.artifacts, []);
    assert.equal(JSON.stringify(result).includes("evil.invalid"), false);
    assert.equal(requests.length, 1);
    assert.equal(credential_calls, 1);
  }
});

test("an aborted T2I result read makes no credential lookup or GET", async () => {
  const harness = await createNativeClient({ id: 102, chat_id: 9001, author_id: -1, message_object: [] });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => harness.client.getWanT2iImageResult(resultContext("wan_25_t2i_preview", 1, ["201"]), controller.signal),
    (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === "UPSTREAM_REQUEST_ABORTED");
  assert.deepEqual(harness.requests, []);
  assert.equal(harness.credentialCalls(), 0);
});

test("aborting an in-flight T2I result GET issues one request and never retries", async () => {
  let fetchCalls = 0;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const harness = await createNativeClient(null, undefined, async () => {
    fetchCalls += 1;
    markStarted();
    return await new Promise<Response>(() => {});
  });
  const controller = new AbortController();
  const pending = harness.client.getWanT2iImageResult(resultContext("wan_25_t2i_preview", 1, ["201"]), controller.signal);
  await started;
  controller.abort();
  await assert.rejects(() => pending,
    (error: unknown) => typeof error === "object" && error !== null && Reflect.get(error, "code") === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(fetchCalls, 1);
  assert.equal(harness.credentialCalls(), 1);
});
