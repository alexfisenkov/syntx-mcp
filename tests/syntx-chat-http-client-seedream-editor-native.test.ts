import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION as C5,
  OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION as SETTINGS_62 } from "../src/application/owner-seedream-editor-original-upload-source-profile.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS } from "../src/application/owner-seedream-image-parameters.js";
import { createOwnerSeedreamEditorImageOneShotPermit } from "../src/application/owner-seedream-editor-image-one-shot-policy.js";

const ATTEMPT = "link_seedream_editor_native_0123456789";
const BINDING = Object.freeze({ tenant_id: "editor-native-tenant", subject: "editor-native-subject" });
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const NOW = 1_791_829_200_000;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const RESOLUTIONS: Record<string, readonly string[]> = { "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"],
  "seedream-5": ["2K", "3K", "4K"], "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"] };
const CATALOG = loadSelectedDiscoveryCatalog(C5, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(SETTINGS_62, join(process.cwd(), "catalog"));

function jsonResponse(payload: unknown): Response { return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }); }
function linked(attempt_id: string) { return { attempt_id, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const, status: "LINKED" as const, expires_at: null, linked: true }; }

function makeFixture(options: { history?: (page: number, chatUuid: string) => unknown; progress?: unknown; sameUploadUrl?: boolean;
  message?: (messageId: string, chatUuid: string) => unknown; generate?: unknown; delayGenerate?: () => Promise<Response>; requestTimeoutMs?: number } = {}) {
  let uploadId = 0, chatId = 0, generationPosts = 0, getCount = 0;
  const requests: { url: URL; method: string; body?: Record<string, unknown> }[] = [];
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-editor-native-credential"); } };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, ...(options.requestTimeoutMs ? { requestTimeoutMs: options.requestTimeoutMs } : {}), fetchImpl: async (input, init) => {
    const url = new URL(String(input)), method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ url, method, ...(body ? { body } : {}) });
    if (url.pathname.endsWith("/chats/upload-files") && method === "POST") {
      const form = init?.body as FormData; uploadId += 1;
      const isOriginal = form.get("destination") === "uploaded";
      return jsonResponse({ files: [{ id: String(uploadId), file_id: String(uploadId), url: `https://r2.syntx.ai/editor/${options.sameUploadUrl ? "shared" : uploadId}.png`,
        ...(isOriginal ? { mime_type: "image/png", size: PNG.byteLength, status: "accepted" } : {}) }] });
    }
    if (url.pathname.endsWith("/chats") && method === "POST") { chatId += 1; return jsonResponse({ uuid: `editor-chat-${chatId}` }); }
    if (url.pathname.endsWith("/design/generate") && method === "POST") {
      generationPosts += 1;
      if (options.delayGenerate) return options.delayGenerate();
      return jsonResponse(options.generate ?? { id: `editor-ack-${generationPosts}` });
    }
    if (/\/inprogress$/u.test(url.pathname) && method === "GET") return jsonResponse(options.progress ?? []);
    if (url.pathname.endsWith("/messages") && method === "GET") return jsonResponse(options.history?.(Number(url.searchParams.get("page")), url.pathname.split("/").at(-2)!) ?? {
      messages: [], pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0, has_next: false, has_previous: false }
    });
    const msgMatch = /\/chats\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
    if (msgMatch && method === "GET") { getCount += 1; return jsonResponse(options.message?.(msgMatch[2]!, msgMatch[1]!) ?? { id: msgMatch[2], chat_id: 421, author_id: -1, message_object: [] }); }
    throw new Error(`Unexpected fake request ${method} ${url.pathname}`);
  } });
  const linkService = { async getStatus(_binding: unknown, attempt: string) { return linked(attempt); } };
  const setup = async () => {
    const { OwnerSeedreamEditorOriginalReferenceService } = await import("../src/application/owner-seedream-editor-original-reference-service.js");
    const { OwnerSeedreamEditorDrawingReferenceService } = await import("../src/application/owner-seedream-editor-drawing-reference-service.js");
    const { createOwnerSeedreamEditorImageRequestPreparer } = await import("../src/application/owner-seedream-editor-image-request-preparer.js");
    const originalReferenceService = new OwnerSeedreamEditorOriginalReferenceService({ binding: BINDING, linkService, catalog: CATALOG,
      public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62, resolveClient: () => client, now: () => NOW });
    const drawingReferenceService = new OwnerSeedreamEditorDrawingReferenceService({ originalReferenceService, binding: BINDING,
      linkService, catalog: CATALOG, public_catalog_version: C5, settings_inventory: SETTINGS, settings_inventory_version: SETTINGS_62,
      resolveClient: () => client, now: () => NOW });
    const preparer = createOwnerSeedreamEditorImageRequestPreparer({ binding: BINDING, linkService, originalReferenceService,
      drawingReferenceService, now: () => NOW });
    return { originalReferenceService, drawingReferenceService, preparer };
  };
  return { client, requests, setup, counts: () => ({ generationPosts, getCount }), async uploadPair(services: Awaited<ReturnType<typeof setup>>, variant: string) {
    const original = await services.originalReferenceService.upload({ attemptId: ATTEMPT, variant, content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
    const drawing = await services.drawingReferenceService.uploadDrawing({ attemptId: ATTEMPT, variant, original_handle: original.reference_handle,
      content_base64: PNG.toString("base64"), filename: "drawing.png", mime_type: "image/png" });
    return { original, drawing };
  }, async close(services: Awaited<ReturnType<typeof setup>>) {
    await services.preparer.close(); await services.drawingReferenceService.close(); await services.originalReferenceService.close();
  } };
}

async function candidate(fx: ReturnType<typeof makeFixture>, services: Awaited<ReturnType<ReturnType<typeof makeFixture>["setup"]>>,
  variant: typeof OWNER_SEEDREAM_IMAGE_VARIANTS[number], aspect_ratio: string, resolution: string, drawing = false) {
  const pair = await fx.uploadPair(services, variant);
  const prepared = await services.preparer.prepare({ attemptId: ATTEMPT, variant, prompt: `Native ${variant} ${aspect_ratio} ${resolution}`,
    parameters: { aspect_ratio, resolution }, original_handle: pair.original.reference_handle,
    drawing_handle: drawing ? pair.drawing.drawing_handle : null });
  const permit = await createOwnerSeedreamEditorImageOneShotPermit({ preparer: services.preparer, candidate: prepared, principal: PRINCIPAL, attemptId: ATTEMPT });
  return { candidate: prepared, permit };
}

test("exposes isolated native Seedream Editor generation and result reads", () => {
  const client = SyntxChatHttpClient.prototype as unknown as Record<string, unknown>;
  assert.equal(typeof client.createSeedreamEditorChat, "function", "MISSING_SEEDREAM_EDITOR_CHAT");
  assert.equal(typeof client.startSeedreamEditorImageWithOwnedCandidate, "function", "MISSING_SEEDREAM_EDITOR_NATIVE_START");
  assert.equal(typeof client.listSeedreamEditorImageResultCandidates, "function", "MISSING_SEEDREAM_EDITOR_RESULT_CANDIDATES");
  assert.equal(typeof client.getSeedreamEditorImageResult, "function", "MISSING_SEEDREAM_EDITOR_RESULT_GET");
});

test("posts all 104 exact Editor control combinations through the genuine one-shot path", async (t) => {
  const fx = makeFixture(), services = await fx.setup();
  t.after(() => fx.close(services));
  let controls = 0;
  for (const variant of OWNER_SEEDREAM_IMAGE_VARIANTS) {
    for (const resolution of RESOLUTIONS[variant]!) for (const aspect_ratio of RATIOS) {
      const prepared = await candidate(fx, services, variant, aspect_ratio, resolution);
      const chat = await fx.client.createSeedreamEditorChat(`native ${variant} ${aspect_ratio} ${resolution}`);
      const receipt = await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer,
        candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
      const post = fx.requests.filter((request) => request.url.pathname.endsWith("/design/generate")).at(-1)!;
      assert.equal(post.url.searchParams.get("ai_name"), "seedream");
      assert.deepEqual(Object.keys(post.body!).sort(), ["chat_uuid", "prompt", "settings"]);
      assert.equal(post.body!.chat_uuid, chat.chat_uuid);
      assert.equal(post.body!.prompt, services.preparer.getPrivateRequest(prepared.candidate).prompt);
      const settings = post.body!.settings as Record<string, unknown>;
      assert.deepEqual(Object.keys(settings).sort(), ["aspect_ratio", "file_urls", "model_type", "n", "resolution", "stream"]);
      assert.equal(settings.n, 1); assert.equal(settings.stream, false); assert.equal(settings.model_type, variant);
      assert.equal(settings.aspect_ratio, aspect_ratio); assert.equal(settings.resolution, resolution);
      assert.deepEqual(settings.file_urls, services.preparer.getPrivateRequest(prepared.candidate).settings.file_urls);
      assert.ok((settings.file_urls as readonly { type: string }[]).every((file) => file.type === "image"));
      assert.deepEqual(receipt, { chat_uuid: chat.chat_uuid, message_id: `editor-ack-${controls + 1}` });
      controls += 1;
    }
  }
  assert.equal(controls, 104);
  assert.equal(fx.counts().generationPosts, 104);
});

test("deduplicates original and drawing on the wire but preserves drawn Pro cost input", async (t) => {
  const fx = makeFixture({ sameUploadUrl: true }), services = await fx.setup();
  t.after(() => fx.close(services));
  for (const variant of OWNER_SEEDREAM_IMAGE_VARIANTS) {
    const resolution = RESOLUTIONS[variant]![0]!;
    const prepared = await candidate(fx, services, variant, "1:1", resolution, true);
    const privateRequest = services.preparer.getPrivateRequest(prepared.candidate);
    assert.equal(prepared.candidate.references.length, 2);
    assert.equal(privateRequest.settings.file_urls.length, 1);
    assert.deepEqual(prepared.candidate.cost_inputs, variant === "seedream-5.0-pro" ? { batch_size: 2, resolution } : {});
    const chat = await fx.client.createSeedreamEditorChat(`dedup ${variant}`);
    await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer, candidate: prepared.candidate,
      permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
    const post = fx.requests.filter((request) => request.url.pathname.endsWith("/design/generate")).at(-1)!;
    assert.deepEqual((post.body!.settings as { file_urls: unknown[] }).file_urls, privateRequest.settings.file_urls);
  }
  assert.equal(fx.counts().generationPosts, 5);
});

test("rejects forged ownership, foreign clients, generic chats, replay, and preserves a pre-aborted permit", async (t) => {
  const fx = makeFixture(), services = await fx.setup(), foreign = makeFixture(), foreignServices = await foreign.setup();
  t.after(async () => { await fx.close(services); await foreign.close(foreignServices); });
  const prepared = await candidate(fx, services, "seedream-5.0-pro", "1:1", "2K");
  const chat = await fx.client.createSeedreamEditorChat("one dedicated native chat");
  const generic = await fx.client.createChat("image", "ordinary image chat");
  const input = { preparer: services.preparer, candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid };
  const before = fx.counts();
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate({ ...input, candidate: { ...prepared.candidate } }));
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate({ ...input, permit: { ...(prepared.permit as object) } }));
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate({ ...input, principal: { ...PRINCIPAL, subject_id: "foreign" } }));
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate({ ...input, chat_uuid: generic.chat_uuid }));
  await assert.rejects(() => foreign.client.startSeedreamEditorImageWithOwnedCandidate(input));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate(input, controller.signal));
  assert.deepEqual(fx.counts(), before);
  assert.deepEqual(await fx.client.startSeedreamEditorImageWithOwnedCandidate(input), { chat_uuid: chat.chat_uuid, message_id: "editor-ack-1" });
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate(input));
  assert.equal(fx.counts().generationPosts, 1);
});

test("aggregates every consistent history page and reads all 80 ready objects without confusing ACK and bot IDs", async (t) => {
  const ackId = "editor-owner-echo-1";
  const botRows = Array.from({ length: 10 }, (_, messageIndex) => ({ id: `editor-bot-${messageIndex + 1}`, chat_id: 421, author_id: -1,
    message_object: Array.from({ length: 8 }, (_, objectIndex) => ({ id: `object-${messageIndex + 1}-${objectIndex + 1}`,
      message_id: `editor-bot-${messageIndex + 1}`, object_type: objectIndex % 2 === 0 ? "image" : "image_url",
      ...(objectIndex === 0 ? {} : { model_type: "seedream-5.0-pro" }) })) }));
  const rows = [{ id: ackId, chat_id: 421, author_id: 7, message_object: [] }, ...botRows];
  const fx = makeFixture({ generate: { id: ackId }, history: (page) => ({ messages: rows.slice((page - 1) * 10, page * 10),
    pagination: { page, page_size: 10, total_count: rows.length, total_pages: 2, has_next: page === 1, has_previous: page > 1 } }),
  message: (messageId) => ({ id: messageId, chat_id: 421, author_id: -1, message_object: botRows.find((row) => row.id === messageId)!.message_object.map((object) => ({
    id: object.id, object_type: object.object_type, object_url: `https://r2.syntx.ai/results/${object.id}.png`, completed: true,
    ...(object.model_type ? { model_type: object.model_type } : {}) })) }) });
  const services = await fx.setup(); t.after(() => fx.close(services));
  const prepared = await candidate(fx, services, "seedream-5.0-pro", "1:1", "2K", true);
  const chat = await fx.client.createSeedreamEditorChat("paged Editor output");
  const receipt = await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(receipt.message_id, ackId);
  const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(listed.history_binding_status, "BOUND", JSON.stringify(listed)); assert.equal(listed.history_page_status, "COMPLETE");
  assert.equal(listed.owner_echo_message_id, ackId); assert.equal(listed.contexts.length, 10);
  assert.ok(listed.contexts.every((context) => context.message_id !== ackId && context.owner_echo_message_id === ackId));
  assert.deepEqual(fx.requests.filter((request) => request.url.pathname.endsWith("/messages")).map((request) => request.url.searchParams.get("page")), ["1", "2"]);
  let ready = 0, unknownModel = 0;
  for (const context of listed.contexts) {
    const result = await fx.client.getSeedreamEditorImageResult(context);
    assert.equal(result.message_binding, "BOUND", JSON.stringify(result));
    ready += result.ready_images.length;
    unknownModel += result.ready_images.filter((image) => image.model_echo === "UNKNOWN" && image.model_type === null).length;
  }
  assert.equal(ready, 80); assert.equal(unknownModel, 10);
  assert.equal(fx.counts().generationPosts, 1); assert.equal(fx.counts().getCount, 10);
});

test("unknown POST outcome permits only GET recovery contexts from its dedicated chat", async (t) => {
  const resultMessage = { id: "unknown-result-message", chat_id: 421, author_id: -1, message_object: [
    { id: "unknown-result-object", object_type: "image_url", model_type: "seedream-5", object_url: "https://r2.syntx.ai/results/unknown.png", completed: true }
  ] };
  const fx = makeFixture({ generate: {}, history: () => ({ messages: [{ id: resultMessage.id, chat_id: 421, author_id: -1,
    message_object: [{ id: "unknown-result-object", message_id: resultMessage.id, object_type: "image_url", model_type: "seedream-5" }] }],
    pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } }), message: () => resultMessage });
  const services = await fx.setup(); t.after(() => fx.close(services));
  const prepared = await candidate(fx, services, "seedream-5", "1:1", "2K");
  const chat = await fx.client.createSeedreamEditorChat("unknown outcome recovery");
  const input = { preparer: services.preparer, candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid };
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate(input));
  assert.equal(fx.counts().generationPosts, 1);
  const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(listed.history_binding_status, "UNVERIFIED"); assert.ok(listed.gaps.includes("POST_OUTCOME_UNKNOWN"));
  assert.equal(listed.contexts.length, 1); assert.equal(listed.contexts[0]!.owner_echo_message_id, undefined);
  const result = await fx.client.getSeedreamEditorImageResult(listed.contexts[0]);
  assert.equal(result.message_binding, "BOUND"); assert.equal(result.ready_images.length, 1);
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate(input));
  assert.equal(fx.counts().generationPosts, 1);
});

test("a timed-out POST stays unknown when its fake ACK arrives late and recovery remains GET-only", async (t) => {
  let releaseLateAck!: (response: Response) => void;
  const lateAck = new Promise<Response>((resolve) => { releaseLateAck = resolve; });
  const bot = { id: "late-bot-message", chat_id: 421, author_id: -1, message_object: [
    { id: "late-object", object_type: "image", model_type: "seedream-5", object_url: "https://r2.syntx.ai/results/late.png", completed: true }
  ] };
  const fx = makeFixture({ requestTimeoutMs: 25, delayGenerate: () => lateAck,
    history: () => ({ messages: [{ id: bot.id, chat_id: bot.chat_id, author_id: bot.author_id, message_object: [
      { id: "late-object", message_id: bot.id, object_type: "image", model_type: "seedream-5" }] }],
      pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } }), message: () => bot });
  const services = await fx.setup(); t.after(() => fx.close(services));
  const prepared = await candidate(fx, services, "seedream-5", "1:1", "2K");
  const chat = await fx.client.createSeedreamEditorChat("late ACK cannot revive unknown POST");
  const input = { preparer: services.preparer, candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid };
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate(input));
  assert.equal(fx.counts().generationPosts, 1);
  releaseLateAck(jsonResponse({ id: "late-owner-echo" }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(listed.owner_echo_message_id, undefined); assert.ok(listed.gaps.includes("POST_OUTCOME_UNKNOWN"));
  assert.equal(listed.contexts.length, 1);
  assert.equal((await fx.client.getSeedreamEditorImageResult(listed.contexts[0])).ready_images.length, 1);
  await assert.rejects(() => fx.client.startSeedreamEditorImageWithOwnedCandidate(input));
  assert.equal(fx.counts().generationPosts, 1);
});

test("merges pending progress with complete owned history before minting provider-chat-bound contexts", async (t) => {
  const ackId = "editor-owner-echo-progress";
  const botId = "editor-bot-pending";
  const objectId = "editor-object-pending";
  const fx = makeFixture({ generate: { id: ackId },
    progress: [{ message_id: botId, message_object_id: objectId, object_type: "image", model_type: "seedream-5" }],
    history: () => ({ messages: [
      { id: ackId, chat_id: 421, author_id: 7, message_object: [] },
      { id: botId, chat_id: 421, author_id: -1, message_object: [
        { id: objectId, message_id: botId, object_type: "image", model_type: "seedream-5" }
      ] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } }),
    message: () => ({ id: botId, chat_id: 421, author_id: -1, created_at: "2026-10-13T00:00:00Z",
      updated_at: "2026-10-13T00:00:01Z", is_favorite: false, message_object: [{ id: objectId, message_id: botId,
        object_type: "image", object_url: "https://r2.syntx.ai/editor/pending.png", completed: false, model_type: "seedream-5",
        object_text: "ignored metadata", created_at: "2026-10-13T00:00:00Z", updated_at: "2026-10-13T00:00:01Z",
        task_id: "ignored-task", metadata: { owner_private: "not-consumed" } }] })
  });
  const services = await fx.setup(); t.after(() => fx.close(services));
  const prepared = await candidate(fx, services, "seedream-5", "1:1", "2K");
  const chat = await fx.client.createSeedreamEditorChat("progress plus complete history");
  await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });

  const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(listed.candidate_source, "HISTORY");
  assert.equal(listed.history_binding_status, "BOUND");
  assert.equal(listed.history_page_status, "COMPLETE");
  assert.deepEqual(listed.gaps, ["IN_PROGRESS_ENTRIES_AWAITING_MESSAGE_READ"]);
  assert.deepEqual(listed.contexts.map((value) => ({ message_id: value.message_id, provider_chat_id: value.provider_chat_id,
    owner_echo_message_id: value.owner_echo_message_id })), [{ message_id: botId, provider_chat_id: "421", owner_echo_message_id: ackId }]);
  const historyReads = fx.requests.filter((request) => request.url.pathname.endsWith("/messages") && request.method === "GET");
  assert.equal(historyReads.length, 1);

  const result = await fx.client.getSeedreamEditorImageResult(listed.contexts[0]);
  assert.equal(result.message_binding, "BOUND");
  assert.equal(result.ready_images.length, 0);
  assert.ok(result.gaps.some((entry) => entry.code === "OBJECT_INCOMPLETE"));
  assert.equal(result.gaps.some((entry) => entry.code === "UNRECOGNIZED_MESSAGE_FIELDS" || entry.code === "UNRECOGNIZED_OBJECT_FIELDS"), false);
  assert.equal(result.backend_acceptance, "UNPROVEN");
  assert.equal(fx.counts().generationPosts, 1);
});

test("falls back to partial unbound progress only when the owned history read is unavailable", async (t) => {
  const fx = makeFixture({ progress: [{ message_id: "pending-message", message_object_id: null, object_type: "image", model_type: "seedream-5" }],
    history: () => { throw new Error("synthetic history unavailable"); } });
  const services = await fx.setup(); t.after(() => fx.close(services));
  const prepared = await candidate(fx, services, "seedream-5", "1:1", "2K");
  const chat = await fx.client.createSeedreamEditorChat("history unavailable fallback");
  await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });

  const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(listed.candidate_source, "IN_PROGRESS");
  assert.equal(listed.history_binding_status, "PARTIAL");
  assert.equal(listed.history_page_status, "INCOMPLETE");
  assert.ok(listed.gaps.includes("HISTORY_READ_INCOMPLETE"));
  assert.ok(listed.gaps.includes("IN_PROGRESS_ENTRIES_AWAITING_MESSAGE_READ"));
  assert.equal(listed.contexts.length, 1);
  assert.equal(listed.contexts[0]!.provider_chat_id, undefined);
  assert.equal(fx.counts().generationPosts, 1);
});

test("rejects cloned or source-expired read contexts before any message GET", async (t) => {
  const ackId = "owner-echo-context";
  const botId = "owned-progress-message";
  const objectId = "owned-progress-object";
  const fx = makeFixture({ generate: { id: ackId },
    progress: [{ message_id: botId, message_object_id: objectId, object_type: "image", model_type: "seedream-5" }],
    history: () => ({ messages: [
      { id: ackId, chat_id: 421, author_id: 7, message_object: [] },
      { id: botId, chat_id: 421, author_id: -1, message_object: [
        { id: objectId, message_id: botId, object_type: "image", model_type: "seedream-5" }
      ] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } })
  });
  const services = await fx.setup(); t.after(() => fx.close(services));
  const prepared = await candidate(fx, services, "seedream-5", "1:1", "2K");
  const chat = await fx.client.createSeedreamEditorChat("context binding");
  await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(listed.contexts.length, 1);
  await assert.rejects(() => fx.client.getSeedreamEditorImageResult({ ...listed.contexts[0]! }));
  await services.preparer.invalidateAttempt(ATTEMPT);
  const getsBefore = fx.counts().getCount;
  await assert.rejects(() => fx.client.getSeedreamEditorImageResult(listed.contexts[0]));
  assert.equal(fx.counts().getCount, getsBefore);
});

test("mismatched page metadata or an unrelated owner message yields explicit gaps and no result authority", async (t) => {
  const fx = makeFixture({ generate: { id: "expected-ack" }, history: (page) => ({ messages: page === 1
    ? [{ id: "expected-ack", chat_id: 421, author_id: 7, message_object: [] },
      { id: "other-owner", chat_id: 421, author_id: 8, message_object: [] },
      ...Array.from({ length: 8 }, (_, index) => ({ id: `page-one-${index}`, chat_id: 421, author_id: -1, message_object: [] }))]
    : [{ id: "later-bot", chat_id: 421, author_id: -1, message_object: [] }],
    pagination: { page, page_size: 10, total_count: page === 1 ? 11 : 12, total_pages: page === 1 ? 2 : 2,
      has_next: page === 1, has_previous: page > 1 } }) });
  const services = await fx.setup(); t.after(() => fx.close(services));
  const prepared = await candidate(fx, services, "seedream-4", "1:1", "1K");
  const chat = await fx.client.createSeedreamEditorChat("hostile aggregate metadata");
  await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(listed.history_binding_status, "UNVERIFIED"); assert.equal(listed.history_page_status, "UNPROVEN");
  assert.ok(listed.gaps.includes("HISTORY_METADATA_MISMATCH")); assert.equal(listed.contexts.length, 0);
});

test("a separate owner message blocks falling back to unmatched progress IDs", async (t) => {
  const fx = makeFixture({ generate: { id: "expected-ack" },
    progress: [{ message_id: "progress-not-in-history", message_object_id: "progress-object", object_type: "image", model_type: "seedream-4" }],
    history: () => ({ messages: [
    { id: "expected-ack", chat_id: 421, author_id: 7, message_object: [] },
    { id: "unrelated-owner", chat_id: 421, author_id: 8, message_object: [] }
  ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } }) });
  const services = await fx.setup(); t.after(() => fx.close(services));
  const prepared = await candidate(fx, services, "seedream-4", "1:1", "1K");
  const chat = await fx.client.createSeedreamEditorChat("unexpected other owner row");
  await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(listed.history_binding_status, "UNVERIFIED");
  assert.ok(listed.gaps.includes("HISTORY_UNEXPECTED_OWNER_MESSAGE")); assert.equal(listed.contexts.length, 0);
});

test("wrong provider chat or model in complete history never falls back to unbound progress IDs", async (t) => {
  const cases = [
    { label: "foreign-provider-chat", ack_chat_id: 421, bot_chat_id: 999, model_type: "seedream-5", gap: "HISTORY_CHAT_ID_MISMATCH" },
    { label: "foreign-model", ack_chat_id: 421, bot_chat_id: 421, model_type: "seedream-4", gap: "HISTORY_BINDING_INVALID" }
  ] as const;
  for (const scenario of cases) {
    const ackId = `ack-${scenario.label}`;
    const botId = `bot-${scenario.label}`;
    const fx = makeFixture({ generate: { id: ackId },
      progress: [{ message_id: botId, message_object_id: `object-${scenario.label}`, object_type: "image", model_type: "seedream-5" }],
      history: () => ({ messages: [
        { id: ackId, chat_id: scenario.ack_chat_id, author_id: 7, message_object: [] },
        { id: botId, chat_id: scenario.bot_chat_id, author_id: -1, message_object: [
          { id: `object-${scenario.label}`, message_id: botId, object_type: "image", model_type: scenario.model_type }
        ] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } })
    });
    const services = await fx.setup(); t.after(() => fx.close(services));
    const prepared = await candidate(fx, services, "seedream-5", "1:1", "2K");
    const chat = await fx.client.createSeedreamEditorChat(scenario.label);
    await fx.client.startSeedreamEditorImageWithOwnedCandidate({ preparer: services.preparer, candidate: prepared.candidate,
      permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
    const listed = await fx.client.listSeedreamEditorImageResultCandidates({ preparer: services.preparer, candidate: prepared.candidate,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
    assert.equal(listed.history_binding_status, "UNVERIFIED");
    assert.ok(listed.gaps.includes(scenario.gap));
    assert.equal(listed.contexts.length, 0);
    assert.equal(fx.counts().generationPosts, 1);
  }
});
