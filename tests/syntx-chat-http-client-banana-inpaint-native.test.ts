import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
  OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
  OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS,
  getOwnerBananaInpaintOriginalUploadSourceProfile
} from "../src/application/owner-banana-inpaint-original-upload-source-profile.js";
import { OwnerBananaInpaintOriginalReferenceService } from "../src/application/owner-banana-inpaint-original-reference-service.js";
import { OwnerBananaInpaintPaintedCompositeReferenceService } from "../src/application/owner-banana-inpaint-painted-composite-reference-service.js";
import { OwnerBananaInpaintAuxiliaryReferenceService } from "../src/application/owner-banana-inpaint-auxiliary-reference-service.js";
import { getOwnerBananaInpaintPaintedCompositeSourceProfile } from "../src/application/owner-banana-inpaint-painted-composite-source-profile.js";
import { getOwnerBananaInpaintSourceParameters } from "../src/application/owner-banana-inpaint-parameters.js";
import { getOwnerBananaInpaintImageSourceProfile } from "../src/application/owner-banana-inpaint-image-source-profile.js";
import { createOwnerBananaInpaintImageRequestPreparer } from "../src/application/owner-banana-inpaint-image-request-preparer.js";
import { createOwnerBananaInpaintImageOneShotPermit } from "../src/application/owner-banana-inpaint-image-one-shot-policy.js";

test("exposes a dedicated fixed native start for an owned Banana Inpaint chat", () => {
  assert.equal(typeof SyntxChatHttpClient.prototype.createImageInpaintChat, "function");
const prototype = SyntxChatHttpClient.prototype as unknown as Record<string, unknown>;
  assert.equal(typeof prototype.startBananaInpaintImageWithOwnedCandidate, "function",
    "MISSING_BANANA_INPAINT_NATIVE_START");
});

const ATTEMPT = "link_banana_inpaint_native_0123456789";
const BINDING = Object.freeze({ tenant_id: "banana-native-tenant", subject: "banana-native-subject" });
const NOW = Date.parse("2026-10-12T00:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const CATALOG = loadSelectedDiscoveryCatalog(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, join(process.cwd(), "catalog")).discoveryCatalog;
const SETTINGS = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, join(process.cwd(), "catalog"));

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

interface NativeFetchRecord {
  readonly url: URL;
  readonly init: RequestInit | undefined;
  readonly body?: Record<string, unknown>;
}

function createNativeFixture(options: { readonly urlForUpload?: (id: number) => string;
  readonly onGenerate?: (record: NativeFetchRecord) => Promise<Response>;
  readonly onInProgress?: (record: NativeFetchRecord) => Promise<Response>;
  readonly onHistory?: (record: NativeFetchRecord) => Promise<Response>;
  readonly onMessage?: (record: NativeFetchRecord) => Promise<Response>; } = {}) {
  let uploadId = 0;
  let chatId = 0;
  let generationPosts = 0;
  let credentialCalls = 0;
  const generationRecords: NativeFetchRecord[] = [];
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation("synthetic-inpaint-native-credential");
    }
  };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/chats/upload-files") && init?.method === "POST") {
      uploadId += 1;
      const fileUrl = options.urlForUpload?.(uploadId) ?? `https://r2.syntx.ai/native/${uploadId}.png`;
      return jsonResponse({ files: [{ id: uploadId, file_id: String(uploadId), url: fileUrl, mime_type: "image/png",
        size: PNG.byteLength, status: "accepted" }] });
    }
    if (url.pathname.endsWith("/chats") && init?.method === "POST") {
      chatId += 1;
      return jsonResponse({ uuid: `inpaint-native-chat-${chatId}` });
    }
    if (url.pathname.endsWith("/design/generate") && init?.method === "POST") {
      generationPosts += 1;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const record = { url, init, body };
      generationRecords.push(record);
      if (options.onGenerate) return options.onGenerate(record);
      return jsonResponse({ id: `inpaint-ack-${generationPosts}` });
    }
    if (/\/chats\/[^/]+\/inprogress$/u.test(url.pathname) && init?.method === "GET") {
      const record = { url, init };
      if (options.onInProgress) return options.onInProgress(record);
      return jsonResponse([]);
    }
    if (/\/chats\/[^/]+\/messages$/u.test(url.pathname) && init?.method === "GET") {
      const record = { url, init };
      if (options.onHistory) return options.onHistory(record);
      return jsonResponse({ messages: [], pagination: { page: 1, page_size: 10, total_count: 0, total_pages: 0,
        has_next: false, has_previous: false } });
    }
    if (/\/chats\/[^/]+\/[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(url.pathname) && init?.method === "GET") {
      const record = { url, init };
      if (options.onMessage) return options.onMessage(record);
      return jsonResponse({ id: "unknown-message", author_id: -1, message_object: [] });
    }
    throw new Error(`Unexpected synthetic native request: ${init?.method ?? "GET"} ${url.pathname}`);
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } };
  const originalReferenceService = new OwnerBananaInpaintOriginalReferenceService({ binding: BINDING, linkService,
    catalog: CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, resolveClient: () => client, now: () => NOW });
  const paintedCompositeReferenceService = new OwnerBananaInpaintPaintedCompositeReferenceService({ originalReferenceService,
    binding: BINDING, linkService, catalog: CATALOG, public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
    settings_inventory: SETTINGS, settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
    resolveClient: () => client, now: () => NOW });
  const auxiliaryReferenceService = new OwnerBananaInpaintAuxiliaryReferenceService({ binding: BINDING, linkService, catalog: CATALOG,
    public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, settings_inventory: SETTINGS,
    settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION, resolveClient: () => client, now: () => NOW });
  const profiles = OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS.map((variant) => {
    const originalProfile = getOwnerBananaInpaintOriginalUploadSourceProfile(variant, CATALOG,
      OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, SETTINGS, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION);
    const paintedProfile = getOwnerBananaInpaintPaintedCompositeSourceProfile(variant, originalProfile);
    const controlsProfile = getOwnerBananaInpaintSourceParameters(variant, originalProfile);
    const imageProfile = getOwnerBananaInpaintImageSourceProfile(variant, originalProfile, paintedProfile, controlsProfile);
    return { originalProfile, paintedProfile, controlsProfile, imageProfile };
  });
  const preparer = createOwnerBananaInpaintImageRequestPreparer({ attemptId: ATTEMPT, originalReferenceService,
    paintedCompositeReferenceService, auxiliaryReferenceService, profiles, now: () => NOW });
  return {
    client, preparer, originalReferenceService, paintedCompositeReferenceService, auxiliaryReferenceService,
    generationRecords,
    counts: () => ({ credentialCalls, generationPosts }),
    async close() {
      await preparer.close();
      await paintedCompositeReferenceService.close();
      await auxiliaryReferenceService.close();
      await originalReferenceService.close();
    }
  };
}

async function prepareCandidate(fixture: ReturnType<typeof createNativeFixture>, variant: typeof OWNER_BANANA_INPAINT_ORIGINAL_UPLOAD_VARIANTS[number],
  image_size: string | null, withAuxiliary = false) {
  const original = await fixture.originalReferenceService.upload({ attemptId: ATTEMPT, variant,
    content_base64: PNG.toString("base64"), filename: "original.png", mime_type: "image/png" });
  const painted = await fixture.paintedCompositeReferenceService.uploadPaintedComposite({ attemptId: ATTEMPT, variant,
    original_handle: original.reference_handle, content_base64: PNG.toString("base64"), filename: "painted.png", mime_type: "image/png" });
  const auxiliary = withAuxiliary ? await fixture.auxiliaryReferenceService.upload({ attemptId: ATTEMPT, variant,
    content_base64: PNG.toString("base64"), filename: "auxiliary.png", mime_type: "image/png" }) : null;
  const candidate = await fixture.preparer.prepare({ variant, prompt: `preserve ${variant} ${image_size ?? "base"}`,
    image_size, original_handle: original.reference_handle, painted_handle: painted.painted_handle,
    auxiliary_reference_handle: auxiliary?.reference_handle ?? null });
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  const permit = await createOwnerBananaInpaintImageOneShotPermit({ preparer: fixture.preparer, candidate, principal, attemptId: ATTEMPT });
  return { candidate, permit, principal, original, painted, auxiliary };
}

async function closeFixture(fixture: ReturnType<typeof createNativeFixture>): Promise<void> { await fixture.close(); }

test("posts actual prepared candidates for all four variants and nine explicit image-size choices", async (t) => {
  const fixture = createNativeFixture();
  t.after(() => closeFixture(fixture));
  const selections = [
    ["banana", null], ["banana2", "1K"], ["banana2", "2K"], ["banana2", "4K"],
    ["banana3", "0.5K"], ["banana3", "1K"], ["banana3", "2K"], ["banana3", "4K"], ["banana3_light", "1K"]
  ] as const;
  for (const [variant, image_size] of selections) {
    const { candidate, permit, principal } = await prepareCandidate(fixture, variant, image_size);
    const chat = await fixture.client.createImageInpaintChat(`native ${variant} ${image_size ?? "base"}`);
    const receipt = await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer,
      candidate, permit, principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
    const request = fixture.generationRecords.at(-1)!;
    assert.equal(String(request.url), "https://api.syntx.ai/api/v1/design/generate?ai_name=banana");
    assert.deepEqual(Object.keys(request.body!), ["chat_uuid", "prompt", "settings"]);
    assert.equal(request.body!.chat_uuid, chat.chat_uuid);
    assert.equal(request.body!.prompt, fixture.preparer.getPrivateRequest(candidate).prompt);
    const settings = request.body!.settings as Record<string, unknown>;
    assert.deepEqual(Object.keys(settings), ["editor", "model_type", "image_size", "file_urls"]);
    assert.equal(settings.editor, true);
    assert.equal(settings.model_type, variant);
    assert.equal(settings.image_size, image_size);
    assert.deepEqual(settings.file_urls, fixture.preparer.getPrivateRequest(candidate).settings.file_urls);
    assert.deepEqual(receipt, { chat_uuid: chat.chat_uuid, message_id: `inpaint-ack-${fixture.generationRecords.length}` });
  }
  assert.equal(fixture.generationRecords.length, 9);
});

test("preserves ordered original, painted mask, and one actual auxiliary image on the native wire", async (t) => {
  const fixture = createNativeFixture();
  t.after(() => closeFixture(fixture));
  const { candidate, permit, principal } = await prepareCandidate(fixture, "banana3", "2K", true);
  const privateFiles = fixture.preparer.getPrivateRequest(candidate).settings.file_urls;
  assert.deepEqual(privateFiles.map((file) => file.type), ["image", "mask", "image"]);
  const chat = await fixture.client.createImageInpaintChat("auxiliary native fixture");
  await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer, candidate, permit, principal,
    attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const body = fixture.generationRecords[0]!.body!;
  const settings = body.settings as { readonly file_urls: readonly { readonly type: string; readonly url: string }[] };
  assert.deepEqual(settings.file_urls, privateFiles);
});

test("preserves type-aware first-stable dedup for an auxiliary URL equal to original image", async (t) => {
  const originalUrl = "https://r2.syntx.ai/native/shared-original-aux.png";
  const fixture = createNativeFixture({ urlForUpload: (id) => id === 1 || id === 3 ? originalUrl : `https://r2.syntx.ai/native/${id}.png` });
  t.after(() => closeFixture(fixture));
  const { candidate, permit, principal } = await prepareCandidate(fixture, "banana2", "4K", true);
  const privateFiles = fixture.preparer.getPrivateRequest(candidate).settings.file_urls;
  assert.equal(privateFiles.length, 2);
  assert.deepEqual(privateFiles.map((file) => file.type), ["image", "mask"]);
  assert.equal(privateFiles[0]?.url, originalUrl);
  const chat = await fixture.client.createImageInpaintChat("dedup native fixture");
  await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer, candidate, permit, principal,
    attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const body = fixture.generationRecords[0]!.body!;
  const settings = body.settings as { readonly file_urls: readonly { readonly type: string; readonly url: string }[] };
  assert.deepEqual(settings.file_urls, privateFiles);
});

test("a pre-aborted call uses no credentials or network and leaves the real permit available", async (t) => {
  const fixture = createNativeFixture();
  t.after(() => closeFixture(fixture));
  const { candidate, permit, principal } = await prepareCandidate(fixture, "banana3", "4K");
  const chat = await fixture.client.createImageInpaintChat("abort native fixture");
  const before = fixture.counts();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer,
    candidate, permit, principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid }, controller.signal),
  (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.deepEqual(fixture.counts(), before);
  assert.deepEqual(await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer,
    candidate, permit, principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid }),
  { chat_uuid: chat.chat_uuid, message_id: "inpaint-ack-1" });
});

test("rejects generic chats, foreign principals, and cloned candidate or permit before native POST", async (t) => {
  const fixture = createNativeFixture();
  t.after(() => closeFixture(fixture));
  const prepared = await prepareCandidate(fixture, "banana3_light", "1K");
  const chat = await fixture.client.createImageInpaintChat("native guards fixture");
  const genericChat = await fixture.client.createChat("image", "generic image chat");
  const valid = { preparer: fixture.preparer, candidate: prepared.candidate, permit: prepared.permit,
    principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid };
  const before = fixture.counts();
  const invalid = [
    { ...valid, chat_uuid: genericChat.chat_uuid },
    { ...valid, principal: { ...prepared.principal, subject_id: "foreign-subject" } },
    { ...valid, candidate: Object.assign(Object.create(null) as Record<string, unknown>, prepared.candidate) },
    { ...valid, permit: { ...(prepared.permit as object) } }
  ];
  for (const input of invalid) {
    await assert.rejects(() => fixture.client.startBananaInpaintImageWithOwnedCandidate(input));
  }
  assert.deepEqual(fixture.counts(), before);
  assert.equal(fixture.generationRecords.length, 0);
  assert.deepEqual(await fixture.client.startBananaInpaintImageWithOwnedCandidate(valid),
    { chat_uuid: chat.chat_uuid, message_id: "inpaint-ack-1" });
});

test("a failed or ambiguous JSON ACK burns the chat and prevents another candidate POST", async (t) => {
  const fixture = createNativeFixture({ onGenerate: async () => jsonResponse({ id: "" }),
    onHistory: async () => jsonResponse({ messages: [
      { id: "observed-bot-after-unknown", chat_id: 412, author_id: -1, message_object: [
        { id: "unknown-result-object", message_id: "observed-bot-after-unknown", object_type: "image", model_type: null }
      ] }
    ], pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } }),
    onMessage: async () => jsonResponse({ id: "observed-bot-after-unknown", chat_id: 412, author_id: -1,
      message_object: [{ id: "unknown-result-object", object_type: "image", object_url: "https://r2.syntx.ai/native/unknown.png",
        completed: true }] }) });
  t.after(() => closeFixture(fixture));
  const first = await prepareCandidate(fixture, "banana2", "2K");
  const second = await prepareCandidate(fixture, "banana2", "4K");
  const chat = await fixture.client.createImageInpaintChat("unknown receipt fixture");
  const firstInput = { preparer: fixture.preparer, candidate: first.candidate, permit: first.permit,
    principal: first.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid };
  await assert.rejects(() => fixture.client.startBananaInpaintImageWithOwnedCandidate(firstInput),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  const afterUnknown = fixture.counts();
  await assert.rejects(() => fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer,
    candidate: second.candidate, permit: second.permit, principal: second.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid }),
  (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.deepEqual(fixture.counts(), afterUnknown);
  assert.equal(fixture.generationRecords.length, 1);
  const recovery = await fixture.client.listBananaInpaintImageResultCandidates({ preparer: fixture.preparer,
    candidate: first.candidate, principal: first.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(recovery.history_binding_status, "UNVERIFIED");
  assert.ok(recovery.gaps.includes("POST_OUTCOME_UNKNOWN"));
  assert.ok(recovery.gaps.includes("OWNER_ACK_ID_UNAVAILABLE"));
  assert.equal(recovery.contexts.length, 1);
  const observed = await fixture.client.getBananaInpaintImageResult(recovery.contexts[0]);
  assert.equal(observed.message_binding, "BOUND");
  assert.equal(observed.ready_images.length, 1);
  assert.equal(recovery.history_binding_status, "UNVERIFIED");
});

test("an aborted dispatched start recovers only through same-reservation GET observations", async (t) => {
  const controller = new AbortController();
  const fixture = createNativeFixture({ onGenerate: async () => {
    controller.abort();
    return new Promise<Response>(() => undefined);
  }, onInProgress: async (record) => {
    assert.equal(record.url.pathname, "/api/v1/chats/inpaint-native-chat-1/inprogress");
    return jsonResponse([{ message_id: "inpaint-after-abort", message_object_id: "abort-object",
      object_type: "image", model_type: "banana2" }]);
  }, onMessage: async (record) => {
    assert.equal(record.url.pathname, "/api/v1/chats/inpaint-native-chat-1/inpaint-after-abort");
    return jsonResponse({ id: "inpaint-after-abort", chat_id: 412, author_id: -1, message_object: [
      { id: "abort-object", object_type: "image", object_url: "https://r2.syntx.ai/native/abort.png", completed: true }
    ] });
  } });
  t.after(() => closeFixture(fixture));
  const prepared = await prepareCandidate(fixture, "banana2", "2K");
  const chat = await fixture.client.createImageInpaintChat("abort reconciliation fixture");
  const startInput = { preparer: fixture.preparer, candidate: prepared.candidate, permit: prepared.permit,
    principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid };
  await assert.rejects(() => fixture.client.startBananaInpaintImageWithOwnedCandidate(startInput, controller.signal));
  assert.equal(fixture.generationRecords.length, 1, "dispatch reached exactly one generation POST before abort");

  const countsBeforeRecovery = fixture.counts();
  const recovery = await fixture.client.listBananaInpaintImageResultCandidates({ preparer: fixture.preparer,
    candidate: prepared.candidate, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(recovery.candidate_source, "IN_PROGRESS");
  assert.equal(recovery.history_binding_status, "UNVERIFIED");
  assert.equal(recovery.history_page_status, "NOT_READ");
  assert.ok(recovery.gaps.includes("POST_OUTCOME_UNKNOWN"));
  assert.deepEqual(fixture.counts(), { credentialCalls: countsBeforeRecovery.credentialCalls + 1,
    generationPosts: countsBeforeRecovery.generationPosts });
  assert.equal(fixture.generationRecords.length, 1, "GET-only reconciliation must not replay the POST");

  const result = await fixture.client.getBananaInpaintImageResult(recovery.contexts[0]);
  assert.equal(result.message_id, "inpaint-after-abort");
  assert.equal(result.ready_images.length, 1, "ready data remains an observation, not an operation-completion claim");
  assert.equal("status" in result, false);
  assert.equal(fixture.generationRecords.length, 1);
});

test("serializes two candidates competing for one owned chat to one native POST", async (t) => {
  let signalGenerateStarted!: () => void;
  const generateStarted = new Promise<void>((resolve) => { signalGenerateStarted = resolve; });
  let acknowledge!: () => void;
  const fixture = createNativeFixture({ onGenerate: async () => {
    signalGenerateStarted();
    return new Promise<Response>((resolve) => { acknowledge = () => resolve(jsonResponse({ id: "inpaint-serialized-ack" })); });
  } });
  t.after(() => closeFixture(fixture));
  const first = await prepareCandidate(fixture, "banana2", "1K");
  const second = await prepareCandidate(fixture, "banana3", "2K");
  const chat = await fixture.client.createImageInpaintChat("single start fixture");
  const start = (prepared: typeof first) => fixture.client.startBananaInpaintImageWithOwnedCandidate({
    preparer: fixture.preparer, candidate: prepared.candidate, permit: prepared.permit, principal: prepared.principal,
    attemptId: ATTEMPT, chat_uuid: chat.chat_uuid
  });
  const firstStart = start(first);
  await generateStarted;
  const beforeContender = fixture.counts();
  await assert.rejects(() => start(second),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.deepEqual(fixture.counts(), beforeContender);
  acknowledge();
  assert.deepEqual(await firstStart, { chat_uuid: chat.chat_uuid, message_id: "inpaint-serialized-ack" });
  assert.equal(fixture.generationRecords.length, 1);
});

test("simultaneous start calls cannot overwrite the same chat reservation", async (t) => {
  let signalGenerateStarted!: () => void;
  const generateStarted = new Promise<void>((resolve) => { signalGenerateStarted = resolve; });
  let acknowledge!: () => void;
  const fixture = createNativeFixture({ onGenerate: async () => {
    signalGenerateStarted();
    return new Promise<Response>((resolve) => { acknowledge = () => resolve(jsonResponse({ id: "one-ack" })); });
  } });
  t.after(() => closeFixture(fixture));
  const first = await prepareCandidate(fixture, "banana2", "1K");
  const second = await prepareCandidate(fixture, "banana3", "2K");
  const chat = await fixture.client.createImageInpaintChat("simultaneous reservation fixture");
  const start = (prepared: typeof first) => fixture.client.startBananaInpaintImageWithOwnedCandidate({
    preparer: fixture.preparer, candidate: prepared.candidate, permit: prepared.permit, principal: prepared.principal,
    attemptId: ATTEMPT, chat_uuid: chat.chat_uuid
  });
  const outcomes = Promise.allSettled([start(first), start(second)]);
  await generateStarted;
  acknowledge();
  const settled = await outcomes;
  assert.equal(settled.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(settled.filter((outcome) => outcome.status === "rejected").length, 1);
  assert.equal(fixture.generationRecords.length, 1);
});

test("discovers only same-chat in-progress message IDs without inventing terminal status", async (t) => {
  const fixture = createNativeFixture({ onInProgress: async (record) => {
    assert.equal(record.url.pathname, "/api/v1/chats/inpaint-native-chat-1/inprogress");
    return jsonResponse([{ message_id: "inpaint-progress-message", message_object_id: "progress-object",
      object_type: "image", model_type: "banana3" }]);
  }, onMessage: async () => jsonResponse({ id: "inpaint-progress-message", chat_id: 412, author_id: -1,
    message_object: [{ id: "progress-object", object_type: "image", object_url: "https://r2.syntx.ai/native/progress-result.png",
      completed: true }] }) });
  t.after(() => closeFixture(fixture));
  const prepared = await prepareCandidate(fixture, "banana3", "2K");
  const chat = await fixture.client.createImageInpaintChat("progress context fixture");
  await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const port = fixture.client as unknown as {
    listBananaInpaintImageResultCandidates?: (input: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
  };
  assert.equal(typeof port.listBananaInpaintImageResultCandidates, "function", "MISSING_BANANA_INPAINT_OWNED_RESULT_DISCOVERY");
  const snapshot = await port.listBananaInpaintImageResultCandidates!({ preparer: fixture.preparer, candidate: prepared.candidate,
    principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(snapshot.history_binding_status, "PARTIAL");
  assert.equal(snapshot.history_page_status, "NOT_READ");
  assert.deepEqual(snapshot.gaps, ["IN_PROGRESS_ENTRIES_AWAITING_MESSAGE_READ"]);
  const contexts = snapshot.contexts as readonly Record<string, unknown>[];
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0]?.chat_uuid, chat.chat_uuid);
  assert.equal(contexts[0]?.owner_echo_message_id, "inpaint-ack-1");
  assert.equal(contexts[0]?.message_id, "inpaint-progress-message");
  assert.deepEqual(contexts[0]?.message_object_ids, ["progress-object"]);
  const result = await fixture.client.getBananaInpaintImageResult(contexts[0]);
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_images, [{ object_index: 0, object_type: "image",
    object_url: "https://r2.syntx.ai/native/progress-result.png", message_object_id: "progress-object" }]);
  assert.deepEqual(result.gaps, [{ object_index: null, code: "PROVIDER_CHAT_ID_UNBOUND" }]);
  assert.equal("status" in result, false);
});

test("discovers a bot result ID after the separate JSON owner echo and returns every ready object", async (t) => {
  const fixture = createNativeFixture({ onHistory: async (record) => {
    assert.equal(record.url.pathname, "/api/v1/chats/inpaint-native-chat-1/messages");
    assert.equal(record.url.searchParams.get("page"), "1");
    assert.equal(record.url.searchParams.get("page_size"), "10");
    return jsonResponse({ messages: [
      { id: "inpaint-ack-1", chat_id: 412, author_id: 7, message_object: [] },
      { id: "inpaint-bot-result-1", chat_id: 412, author_id: -1, message_object: [
        { id: "history-object-a", message_id: "inpaint-bot-result-1", object_type: "image", model_type: null },
        { id: "history-object-b", message_id: "inpaint-bot-result-1", object_type: "image_url", model_type: "unbound" }
      ] }
    ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
  }, onMessage: async (record) => {
    assert.equal(record.url.pathname, "/api/v1/chats/inpaint-native-chat-1/inpaint-bot-result-1");
    return jsonResponse({ id: "inpaint-bot-result-1", chat_id: 412, author_id: -1, message_object: [
      { id: "ready-a", object_type: "image", object_url: "https://r2.syntx.ai/native/a.png", completed: true },
      { id: "unfinished", object_type: "image", object_url: "https://r2.syntx.ai/native/pending.png", completed: false },
      { id: "ready-b", object_type: "image_url", object_url: "https://r2.syntx.ai/native/b.webp", completed: true }
    ] });
  } });
  t.after(() => closeFixture(fixture));
  const prepared = await prepareCandidate(fixture, "banana3", "1K");
  const chat = await fixture.client.createImageInpaintChat("history result fixture");
  const start = await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer,
    candidate: prepared.candidate, permit: prepared.permit, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(start.message_id, "inpaint-ack-1");
  const candidates = await fixture.client.listBananaInpaintImageResultCandidates({ preparer: fixture.preparer,
    candidate: prepared.candidate, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(candidates.history_binding_status, "BOUND");
  assert.equal(candidates.history_page_status, "COMPLETE");
  assert.equal(candidates.contexts.length, 1);
  assert.equal(candidates.contexts[0]?.message_id, "inpaint-bot-result-1");
  assert.equal(candidates.contexts[0]?.provider_chat_id, "412");
  assert.deepEqual(candidates.contexts[0]?.message_object_ids, ["history-object-a", "history-object-b"]);
  const result = await fixture.client.getBananaInpaintImageResult(candidates.contexts[0]);
  assert.equal(result.message_binding, "BOUND");
  assert.deepEqual(result.ready_images, [
    { object_index: 0, object_type: "image", object_url: "https://r2.syntx.ai/native/a.png", message_object_id: "ready-a" },
    { object_index: 2, object_type: "image_url", object_url: "https://r2.syntx.ai/native/b.webp", message_object_id: "ready-b" }
  ]);
  assert.deepEqual(result.gaps, [{ object_index: 1, code: "OBJECT_INCOMPLETE" }]);
  assert.equal("status" in result, false);
  assert.equal(JSON.stringify(result).includes("image_size"), false);
  await assert.rejects(() => fixture.client.getBananaInpaintImageResult({ ...candidates.contexts[0]! }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
});

test("treats the JSON ACK ID as a result candidate only when owned history reports author -1", async (t) => {
  const fixture = createNativeFixture({ onHistory: async () => jsonResponse({ messages: [
    { id: "inpaint-ack-1", chat_id: 412, author_id: -1, message_object: [
      { id: "ack-object", message_id: "inpaint-ack-1", object_type: "image", model_type: null }
    ] }
  ], pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } }),
  onMessage: async () => jsonResponse({ id: "inpaint-ack-1", chat_id: 412, author_id: -1, message_object: [
    { id: "ack-object", object_type: "image", object_url: "https://r2.syntx.ai/native/ack-result.png", completed: true }
  ] }) });
  t.after(() => closeFixture(fixture));
  const prepared = await prepareCandidate(fixture, "banana2", "2K");
  const chat = await fixture.client.createImageInpaintChat("bot ACK history fixture");
  await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer,
    candidate: prepared.candidate, permit: prepared.permit, principal: prepared.principal,
    attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const candidates = await fixture.client.listBananaInpaintImageResultCandidates({ preparer: fixture.preparer,
    candidate: prepared.candidate, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(candidates.history_binding_status, "BOUND");
  assert.equal(candidates.contexts.length, 1);
  assert.equal(candidates.contexts[0]?.message_id, "inpaint-ack-1");
  assert.equal((await fixture.client.getBananaInpaintImageResult(candidates.contexts[0])).ready_images.length, 1);
});

test("reports history paging as partial instead of inferring a complete result set", async (t) => {
  const messages = [
    { id: "inpaint-ack-1", chat_id: 412, author_id: 7, message_object: [] },
    { id: "inpaint-bot-result-1", chat_id: 412, author_id: -1,
      message_object: [{ id: "object-1", message_id: "inpaint-bot-result-1", object_type: "image", model_type: null }] },
    ...Array.from({ length: 8 }, (_, index) => ({ id: `other-${index}`, chat_id: 412, author_id: 4, message_object: [] }))
  ];
  const fixture = createNativeFixture({ onHistory: async () => jsonResponse({ messages,
    pagination: { page: 1, page_size: 10, total_count: 11, total_pages: 2, has_next: true, has_previous: false } }) });
  t.after(() => closeFixture(fixture));
  const prepared = await prepareCandidate(fixture, "banana2", "1K");
  const chat = await fixture.client.createImageInpaintChat("paged history fixture");
  await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const result = await fixture.client.listBananaInpaintImageResultCandidates({ preparer: fixture.preparer,
    candidate: prepared.candidate, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(result.history_binding_status, "PARTIAL");
  assert.equal(result.history_page_status, "MORE_PAGES");
  assert.deepEqual(result.gaps, ["HISTORY_HAS_MORE_PAGES"]);
  assert.equal(result.contexts.length, 1);
});

test("keeps wrong message, wrong bot, and unsafe result URLs unverified or redacted", async (t) => {
  const fixtures = new Map([
    ["wrong-id", { id: "foreign-message", chat_id: 412, author_id: -1,
      message_object: [{ id: "foreign-object", object_type: "image", object_url: "https://r2.syntx.ai/native/foreign.png", completed: true }] }],
    ["wrong-bot", { id: "wrong-bot", chat_id: 412, author_id: 7,
      message_object: [{ id: "wrong-bot-object", object_type: "image", object_url: "https://evil.invalid/native/private.png", completed: true }] }],
    ["unsafe-url", { id: "unsafe-url", chat_id: 412, author_id: -1,
      message_object: [{ id: "unsafe-object", object_type: "image", object_url: "https://evil.invalid/native/private.png", completed: true }] }]
  ]);
  const fixture = createNativeFixture({ onHistory: async () => jsonResponse({ messages: [
    { id: "inpaint-ack-1", chat_id: 412, author_id: 7, message_object: [] },
    ...[...fixtures.keys()].map((id, index) => ({ id, chat_id: 412, author_id: -1,
      message_object: [{ id: `history-${index}`, message_id: id, object_type: "image", model_type: null }] }))
  ], pagination: { page: 1, page_size: 10, total_count: 4, total_pages: 1, has_next: false, has_previous: false } }),
  onMessage: async (record) => jsonResponse(fixtures.get(record.url.pathname.split("/").at(-1)!) ?? {}) });
  t.after(() => closeFixture(fixture));
  const prepared = await prepareCandidate(fixture, "banana3", "2K");
  const chat = await fixture.client.createImageInpaintChat("result guard fixture");
  await fixture.client.startBananaInpaintImageWithOwnedCandidate({ preparer: fixture.preparer, candidate: prepared.candidate,
    permit: prepared.permit, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  const candidates = await fixture.client.listBananaInpaintImageResultCandidates({ preparer: fixture.preparer,
    candidate: prepared.candidate, principal: prepared.principal, attemptId: ATTEMPT, chat_uuid: chat.chat_uuid });
  assert.equal(candidates.history_binding_status, "BOUND");
  assert.equal(candidates.contexts.length, 3);
  const results = await Promise.all(candidates.contexts.map((context) => fixture.client.getBananaInpaintImageResult(context)));
  assert.equal(results[0]?.message_binding, "UNVERIFIED");
  assert.deepEqual(results[0]?.gaps, [{ object_index: null, code: "OUTER_MESSAGE_ID_MISMATCH" }]);
  assert.equal(results[1]?.message_binding, "UNVERIFIED");
  assert.deepEqual(results[1]?.gaps, [{ object_index: null, code: "NOT_BOT_MESSAGE" }]);
  assert.equal(JSON.stringify(results[1]).includes("evil.invalid"), false);
  assert.equal(results[2]?.message_binding, "BOUND");
  assert.deepEqual(results[2]?.gaps, [{ object_index: 0, code: "OBJECT_URL_UNSAFE" }]);
  assert.equal(JSON.stringify(results[2]).includes("evil.invalid"), false);
});
