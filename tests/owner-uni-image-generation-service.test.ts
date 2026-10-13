import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerUniImageUploadService } from "../src/application/owner-uni-image-upload-service.js";
import { OwnerUniImageRequestPreparer } from "../src/application/owner-uni-image-request-preparer.js";
import { OwnerUniImageGenerationService, type OwnerUniImageGenerationPreflightInput } from "../src/application/owner-uni-image-generation-service.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));
const BINDING = Object.freeze({ tenant_id: "uni-generation-tenant", subject: "uni-generation-subject" });
const ATTEMPT = "link_uni_generation_00000000000000000001";
const RETRY_ATTEMPT = "link_uni_generation_00000000000000000002";
const FIXED_NOW = Date.parse("2026-10-11T00:00:00.000Z");

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11,
  0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
function jpegWithWidth(width: number): Buffer { const bytes = Buffer.from(JPEG); bytes.writeUInt16BE(width, 9); return bytes; }

function createRig(options: { failPostAfterDispatch?: boolean; denySecondModelRead?: boolean; partialResultFirst?: boolean;
  holdPostUntilAbort?: boolean; revokeOnSecondModelRead?: boolean; holdFirstPreflight?: boolean; pendingHistoryUntilReady?: boolean } = {}) {
  const counts = { accountReads: 0, modelReads: 0, uploads: 0, chats: 0, posts: 0, histories: 0, results: 0 };
  let now = FIXED_NOW;
  let preflightCount = 0;
  let signalFirstPreflightEntered: (() => void) | undefined;
  const firstPreflightEntered = new Promise<void>((resolve) => { signalFirstPreflightEntered = resolve; });
  let releaseFirstPreflight: (() => void) | undefined;
  const firstPreflightGate = new Promise<void>((resolve) => { releaseFirstPreflight = resolve; });
  let signalPostEntered: (() => void) | undefined;
  const postEntered = new Promise<void>((resolve) => { signalPostEntered = resolve; });
  const postBodies: Array<{ chat_uuid: string; prompt: string; settings: Record<string, unknown> }> = [];
  let nextChat = 0;
  let linked = true;
  let historyReady = false;
  let principalReads = 0;
  const transactions = new Map<string, { model_id: string; ack: string; result_message: string; file_urls: unknown[] }>();
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    return operation("synthetic-credential");
  } };
  const syntheticFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/user/balance") { counts.accountReads += 1; return Response.json({ balance: "0.000" }); }
    if (url.pathname === "/api/v1/user/subscription") { counts.accountReads += 1; return Response.json({ active: true, type: "pro", end_date: null }); }
    if (url.pathname === "/api/v2/get_model_info") {
      counts.modelReads += 1;
      if (options.revokeOnSecondModelRead && counts.modelReads === 2) linked = false;
      return Response.json({ access: !(options.denySecondModelRead && counts.modelReads === 2), cost: 1,
        discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      counts.uploads += 1;
      const form = init.body as FormData; const file = form.get("files");
      assert.ok(file instanceof File);
      const model = String(form.get("model_type"));
      return Response.json({ files: [{ id: `uni-file-${counts.uploads}`,
        url: `https://r2.syntx.ai/uni/input-${counts.uploads}.jpg`, mime_type: file.type,
        size: file.size, model_type: model }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      nextChat += 1; counts.chats += 1; return Response.json({ uuid: `uni-chat-${nextChat}` });
    }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      counts.posts += 1;
      const body = JSON.parse(String(init.body)) as { chat_uuid: string; prompt: string; settings: { model_type: string; file_urls?: unknown[] } };
      postBodies.push(body as unknown as { chat_uuid: string; prompt: string; settings: Record<string, unknown> });
      const tx = { model_id: body.settings.model_type, ack: `uni-owner-ack-${counts.posts}`,
        result_message: `uni-result-message-${counts.posts}`, file_urls: body.settings.file_urls ?? [] };
      transactions.set(body.chat_uuid, tx);
      signalPostEntered?.();
      if (options.holdPostUntilAbort) return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal; assert.ok(signal instanceof AbortSignal);
        const abort = () => reject(new DOMException("synthetic POST aborted", "AbortError"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
      if (options.failPostAfterDispatch) throw new Error("synthetic POST response lost after dispatch");
      return Response.json({ id: tx.ack });
    }
    const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/(uni-chat-\d+)\/messages$/u);
    if (historyMatch && init?.method === "GET") {
      counts.histories += 1;
      const tx = transactions.get(historyMatch[1]!); assert.ok(tx);
      const ownerObjects = tx.file_urls.map((_, index) => ({ id: `uni-input-${counts.posts}-${index + 1}`,
        message_id: tx.ack, object_type: "image", model_type: tx.model_id }));
      if (options.pendingHistoryUntilReady && !historyReady) return Response.json({ messages: [
        { id: tx.ack, chat_id: 7711 + counts.posts, author_id: 100, message_object: ownerObjects }
      ], pagination: { page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
      const resultObjects = [1, 2].map((index) => ({ id: `uni-result-object-${counts.posts}-${index}`,
        message_id: tx.result_message, object_type: "image", model_type: tx.model_id }));
      return Response.json({ messages: [
        { id: tx.ack, chat_id: 7711 + counts.posts, author_id: 100, message_object: ownerObjects },
        { id: tx.result_message, chat_id: 7711 + counts.posts, author_id: -1, message_object: resultObjects }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = url.pathname.match(/^\/api\/v1\/chats\/(uni-chat-\d+)\/(uni-result-message-\d+)$/u);
    if (resultMatch && init?.method === "GET") {
      counts.results += 1;
      const tx = transactions.get(resultMatch[1]!); assert.ok(tx); assert.equal(resultMatch[2], tx.result_message);
      const indexes = options.partialResultFirst && counts.results === 1 ? [1] : [1, 2];
      return Response.json({ id: tx.result_message, chat_id: 7711 + counts.posts, author_id: -1,
        message_object: indexes.map((index) => ({ id: `uni-result-object-${counts.posts}-${index}`,
          message_id: tx.result_message, object_type: "image", model_type: tx.model_id, completed: true,
          object_url: `https://r2.syntx.ai/uni/result-${counts.posts}-${index}.png` })) });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  };
  const chatClient = new SyntxChatHttpClient({ credentialBroker, fetchImpl: syntheticFetch });
  const readClient = new SyntxHttpClient({ credentialBroker, fetchImpl: syntheticFetch });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    principalReads += 1;
    return linked ? linkedAttempt(attemptId) : { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "UNLINKED" as const, expires_at: null, linked: false as const };
  } };
  const uploadService = new OwnerUniImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => chatClient, now: () => now });
  const preparer = new OwnerUniImageRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
  const account = new AccountStatusService(readClient, () => now);
  const modelAccess = new ModelAccessService(CATALOG, readClient, () => now);
  const service = new OwnerUniImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, preparer, resolveChatClient: () => chatClient,
    preflight: async (input: Readonly<OwnerUniImageGenerationPreflightInput>) => {
      const result = { account: await account.getAccountStatus(input.signal),
        model_access: await modelAccess.getModelAccess({ model_id: input.model_id, cost_parameters: input.cost_inputs }, input.signal) };
      preflightCount += 1;
      if (options.holdFirstPreflight && preflightCount === 1) { signalFirstPreflightEntered?.(); await firstPreflightGate; }
      return result;
    },
    now: () => now, pollDelayMs: 0, maxPollAttempts: 2, wait: async () => undefined });
  return { service, preparer, uploadService, counts, postEntered, postBodies, firstPreflightEntered,
    releaseFirstPreflight() { releaseFirstPreflight?.(); },
    setNow(value: number) { now = value; },
    setHistoryReady(value: boolean) { historyReady = value; },
    get principalReads() { return principalReads; },
    async upload(model_id: "uni-1" | "uni-1.1-modify-image" | "uni-1.1-remove-background", width: number, attemptId = ATTEMPT) {
      return uploadService.upload({ attemptId, model_id, content_base64: jpegWithWidth(width).toString("base64"),
        filename: `uni-input-${width}.jpg`, mime_type: "image/jpeg" });
    } };
}

test("generates Uni-1 using two real read-only preflights and exact observed result binding", async () => {
  const rig = createRig();
  try {
    const result = await rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "explicit prompt",
      parameters: { aspect_ratio: "16:9", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
    assert.equal(result.status, "result_observed");
    assert.equal(result.observation_status, "COMPLETE");
    assert.equal(result.actual_result_count, 2);
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.deepEqual(result.artifacts.map((artifact) => artifact.url), ["https://r2.syntx.ai/uni/result-1-1.png", "https://r2.syntx.ai/uni/result-1-2.png"]);
    assert.deepEqual(rig.counts, { accountReads: 4, modelReads: 2, uploads: 0, chats: 1, posts: 1, histories: 1, results: 1 });
    const cached = await rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "explicit prompt",
      parameters: { aspect_ratio: "16:9", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
    assert.equal(cached, result);
    assert.equal(rig.counts.posts, 1, "successful cache keeps its original candidate TTL and prevents duplicate POST");
    rig.setNow(FIXED_NOW + 15 * 60_000 + 1);
    const afterOriginalTtl = await rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "explicit prompt",
      parameters: { aspect_ratio: "16:9", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
    assert.equal(afterOriginalTtl.observation_status, "COMPLETE");
    assert.equal(rig.counts.posts, 2, "expired successful cache is not renewed; an explicit new operation may run");
    assert.equal(rig.postBodies.every((body) => !Object.hasOwn(body.settings, "n") && !Object.hasOwn(body.settings, "batch_size")), true);
  } finally {
    await rig.service.close();
  }
});

test("requires the second actual account/model-access read before the sole POST", async () => {
  const rig = createRig({ denySecondModelRead: true });
  try {
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "explicit prompt",
      parameters: { aspect_ratio: "16:9", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PREFLIGHT_FAILED");
    assert.deepEqual(rig.counts, { accountReads: 4, modelReads: 2, uploads: 0, chats: 1, posts: 0, histories: 0, results: 0 });
  } finally { await rig.service.close(); }
});

test("rechecks the linked principal after the second preflight and before dispatch", async () => {
  const rig = createRig({ revokeOnSecondModelRead: true });
  try {
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "explicit prompt",
      parameters: { aspect_ratio: "16:9", seed: null, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED");
    assert.deepEqual(rig.counts, { accountReads: 4, modelReads: 2, uploads: 0, chats: 1, posts: 0, histories: 0, results: 0 });
  } finally { await rig.service.close(); }
});

test("a rejected same-intent contender cannot release the first run's reservation", async () => {
  const rig = createRig({ holdFirstPreflight: true });
  let first: Promise<Awaited<ReturnType<typeof rig.service.generate>>> | undefined;
  try {
    const request = { attemptId: ATTEMPT, variant: "uni-1" as const, prompt: "one reserved intent",
      parameters: { aspect_ratio: "1:1" as const, seed: null, mode: "auto" as const },
      image_reference_handles: [] as string[], main_image_reference_handle: null as string | null };
    first = rig.service.generate(request);
    await rig.firstPreflightEntered;
    for (let contender = 0; contender < 2; contender += 1) {
      await assert.rejects(rig.service.generate(request),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_BUSY");
    }
    rig.releaseFirstPreflight();
    const completed = await first;
    assert.equal(completed.observation_status, "COMPLETE");
    assert.equal(rig.counts.posts, 1); assert.equal(rig.counts.chats, 1);
  } finally {
    rig.releaseFirstPreflight();
    if (first) await Promise.allSettled([first]);
    await rig.service.close();
  }
});

test("keeps a lost-ACK semantic hold across nonce changes and exposes GET-only recovery", async () => {
  const rig = createRig({ failPostAfterDispatch: true });
  let recoveryId = "";
  try {
    const firstUpload = await rig.upload("uni-1", 8);
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "uncertain intent",
      parameters: { aspect_ratio: "1:1", seed: 7, mode: "auto" }, image_reference_handles: [firstUpload.reference_handle], main_image_reference_handle: null }),
    (error: unknown) => {
      if (!(error instanceof Error) || !("code" in error) || !("recovery_id" in error) || error.code !== "OUTCOME_UNKNOWN" || typeof error.recovery_id !== "string") return false;
      recoveryId = error.recovery_id as string; return true;
    });
    const listed = await rig.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(listed.length, 1); assert.equal(listed[0]?.recovery_id, recoveryId);
    const beforeLostAckReconcile = { ...rig.counts };
    rig.setNow(FIXED_NOW + 16 * 60_000);
    await assert.rejects(rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
    assert.equal(rig.counts.histories, beforeLostAckReconcile.histories, "no owner echo means no safe history GET after expiry");
    assert.equal(rig.counts.results, beforeLostAckReconcile.results);
    await rig.service.invalidateAttempt(ATTEMPT);
    const relinkedUpload = await rig.upload("uni-1", 8, RETRY_ATTEMPT);
    assert.notEqual(relinkedUpload.reference_handle, firstUpload.reference_handle);
    await assert.rejects(rig.service.generate({ attemptId: RETRY_ATTEMPT, variant: "uni-1", prompt: "uncertain intent",
      parameters: { aspect_ratio: "1:1", seed: 7, mode: "auto" }, image_reference_handles: [relinkedUpload.reference_handle], main_image_reference_handle: null }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(rig.counts.posts, 1); assert.equal(rig.counts.chats, 1); assert.equal(rig.counts.uploads, 2);
    assert.equal(rig.counts.histories, 0); assert.equal(rig.counts.results, 0);
  } finally { await rig.service.close(); }
});

test("rejects caller-invented fields and accessors before principal, account, or chat reads", async () => {
  const rig = createRig();
  try {
    assert.throws(() => rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "explicit prompt",
      parameters: { aspect_ratio: "16:9", seed: null, mode: "auto" }, image_reference_handles: [],
      main_image_reference_handle: null, n: 1 }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    const accessorInput = { attemptId: ATTEMPT, variant: "uni-1" as const, prompt: "explicit prompt",
      parameters: { aspect_ratio: "16:9" as const, seed: null, mode: "auto" as const }, image_reference_handles: [],
      main_image_reference_handle: null as string | null };
    Object.defineProperty(accessorInput, "prompt", { enumerable: true, get() { throw new Error("must not execute"); } });
    assert.throws(() => rig.service.generate(accessorInput),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    assert.deepEqual(rig.counts, { accountReads: 0, modelReads: 0, uploads: 0, chats: 0, posts: 0, histories: 0, results: 0 });
  } finally { await rig.service.close(); }
});

test("returns partial observations with a recovery handle and reconciles by GET only", async () => {
  const rig = createRig({ partialResultFirst: true });
  try {
    const partial = await rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "partial observation",
      parameters: { aspect_ratio: "2:1", seed: 1, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
    assert.equal(partial.observation_status, "PARTIAL"); assert.equal(partial.actual_result_count, 1);
    assert.equal(typeof partial.recovery_id, "string"); assert.equal(partial.backend_acceptance, "UNPROVEN");
    const complete = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: partial.recovery_id! });
    assert.equal(complete.observation_status, "COMPLETE"); assert.equal(complete.actual_result_count, 2);
    assert.deepEqual(rig.counts, { accountReads: 4, modelReads: 2, uploads: 0, chats: 1, posts: 1, histories: 1, results: 2 });
  } finally { await rig.service.close(); }
});

test("keeps an acknowledged pending-history recovery GET-only after source expiry", async () => {
  const rig = createRig({ pendingHistoryUntilReady: true });
  let recoveryId = "";
  try {
    const upload = await rig.upload("uni-1", 8);
    const input = { attemptId: ATTEMPT, variant: "uni-1" as const, prompt: "long-running observed intent",
      parameters: { aspect_ratio: "1:1" as const, seed: 19, mode: "auto" as const }, image_reference_handles: [upload.reference_handle],
      main_image_reference_handle: null };
    await assert.rejects(rig.service.generate(input), (error: unknown) => {
      if (!(error instanceof Error) || !("code" in error) || !("recovery_id" in error) || error.code !== "OUTCOME_UNKNOWN" ||
          typeof error.recovery_id !== "string") return false;
      recoveryId = error.recovery_id;
      return true;
    });
    assert.match(recoveryId, /^uni_image_recovery_[0-9a-f-]{36}$/u);
    assert.equal(rig.counts.uploads, 1);
    assert.equal(rig.counts.chats, 1);
    assert.equal(rig.counts.posts, 1);
    assert.equal(rig.counts.results, 0);
    const beforeRecovery = { ...rig.counts };
    const readsBeforeRecovery = rig.principalReads;

    rig.setNow(FIXED_NOW + 16 * 60_000);
    rig.setHistoryReady(true);
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });

    assert.equal(result.status, "result_observed");
    assert.equal(result.observation_status, "COMPLETE");
    assert.equal(result.actual_result_count, 2);
    assert.ok(rig.principalReads > readsBeforeRecovery, "GET recovery must re-read the currently linked owner");
    assert.equal(rig.counts.uploads, beforeRecovery.uploads);
    assert.equal(rig.counts.chats, beforeRecovery.chats);
    assert.equal(rig.counts.posts, beforeRecovery.posts);
    assert.equal(rig.counts.histories, beforeRecovery.histories + 1);
    assert.equal(rig.counts.results, beforeRecovery.results + 1);

    await assert.rejects(rig.service.generate({ ...input, prompt: "new intent after source expiry" }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "ASSET_UNAVAILABLE");
    assert.equal(rig.counts.uploads, beforeRecovery.uploads);
    assert.equal(rig.counts.chats, beforeRecovery.chats);
    assert.equal(rig.counts.posts, beforeRecovery.posts);
  } finally { await rig.service.close(); }
});

test("close aborts and drains a held native POST without retrying or starting result reads", async () => {
  const rig = createRig({ holdPostUntilAbort: true });
  const pending = rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: "close while dispatch pending",
    parameters: { aspect_ratio: "1:1", seed: 2, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null });
  await rig.postEntered;
  await rig.service.close();
  await assert.rejects(pending, (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
  assert.equal(rig.counts.posts, 1); assert.equal(rig.counts.histories, 0); assert.equal(rig.counts.results, 0);
});

test("does not expire or evict unknown semantic holds and enforces the 128-entry lifetime bound", async () => {
  const rig = createRig({ failPostAfterDispatch: true });
  try {
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1", prompt: `unknown intent ${index}`,
        parameters: { aspect_ratio: "1:1", seed: index, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "OUTCOME_UNKNOWN");
    }
    rig.setNow(FIXED_NOW + 30 * 60_000);
    await assert.rejects(rig.service.generate({ attemptId: RETRY_ATTEMPT, variant: "uni-1", prompt: "unknown intent 0",
      parameters: { aspect_ratio: "1:1", seed: 0, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_ALREADY_CLAIMED");
    await assert.rejects(rig.service.generate({ attemptId: RETRY_ATTEMPT, variant: "uni-1", prompt: "new unknown intent 128",
      parameters: { aspect_ratio: "1:1", seed: 128, mode: "auto" }, image_reference_handles: [], main_image_reference_handle: null }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_BUSY");
    assert.equal(rig.counts.posts, 128); assert.equal(rig.counts.chats, 128);
  } finally { await rig.service.close(); }
});

test("keeps Modify main first and accepts the explicit empty-prompt background-removal branch", async () => {
  const rig = createRig();
  try {
    const first = await rig.upload("uni-1.1-modify-image", 2);
    const main = await rig.upload("uni-1.1-modify-image", 3);
    const modified = await rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1.1-modify-image", prompt: "modify",
      parameters: { seed: 0, mode: "manga" }, image_reference_handles: [first.reference_handle, main.reference_handle],
      main_image_reference_handle: main.reference_handle });
    assert.equal(modified.observation_status, "COMPLETE");

    const background = await rig.upload("uni-1.1-remove-background", 4);
    const removed = await rig.service.generate({ attemptId: ATTEMPT, variant: "uni-1.1-remove-background", prompt: "",
      parameters: { invert_mask: false }, image_reference_handles: [background.reference_handle], main_image_reference_handle: null });
    assert.equal(removed.observation_status, "COMPLETE");
    assert.deepEqual(rig.postBodies.map((body) => body.settings), [
      { model_type: "uni-1.1-modify-image", seed: 0, mode: "manga", file_urls: [
        { type: "image", url: "https://r2.syntx.ai/uni/input-2.jpg" },
        { type: "image", url: "https://r2.syntx.ai/uni/input-1.jpg" }
      ] },
      { model_type: "uni-1.1-remove-background", invert_mask: false,
        file_urls: [{ type: "image", url: "https://r2.syntx.ai/uni/input-3.jpg" }] }
    ]);
    assert.equal(rig.postBodies[1]?.prompt, "");
    assert.deepEqual(rig.counts, { accountReads: 8, modelReads: 4, uploads: 3, chats: 2, posts: 2, histories: 2, results: 2 });
  } finally { await rig.service.close(); }
});
