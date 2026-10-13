import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { OwnerGrokT2iImageUploadService } from "../src/application/owner-grok-t2i-image-upload-service.js";
import { createOwnerGrokT2iRequestPreparer } from "../src/application/owner-grok-t2i-request-preparer.js";
import { OWNER_GROK_T2I_MODELS, type OwnerGrokT2iModel } from "../src/application/owner-grok-t2i-parameters.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import {
  OwnerGrokT2iGenerationService,
  OwnerGrokT2iGenerationServiceError,
  type OwnerGrokT2iGenerationServiceOptions
} from "../src/application/owner-grok-t2i-generation-service.js";

const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION), "utf8"))));
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BINDING = Object.freeze({ tenant_id: "grok-generation-tenant", subject: "grok-generation-owner" });
const ATTEMPT = "link_grok_generation_0000000000001";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);

function linked(attemptId: string) { return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
  status: "LINKED" as const, expires_at: null, linked: true as const }; }
function credentialBroker(): SyntxCredentialBroker { return { async useCredential<T>(operation: (credential: string) => Promise<T>) {
  return operation("synthetic-grok-generation-credential");
} }; }
function jpegWithWidth(width: number): Buffer { const bytes = Buffer.from(JPEG); bytes[9] = (width >>> 8) & 0xff; bytes[10] = width & 0xff; return bytes; }
function freshPreflight(model_id: string, parameter_keys: string[], observed = Date.now()) {
  return { account: { balance: { unit: "tokens" as const, available: "100" },
    subscription: { active: true, plan_type: "PRO", end_date: null, end_date_kind: null },
    contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD, observed_at: new Date(observed).toISOString() },
    model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT" as const,
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id, ai_name: "grok_image", model_type: model_id, account_read_live: true as const,
      parameter_keys, parameters_redacted: true as const, access: true, cost: 1, discount_cost: null,
      free_remaining_generations: null, limit: null, show_warning: false, observed_at: new Date(observed).toISOString() } };
}

function createRig(options: { partialHistory?: boolean; partialOutput?: boolean; postFailure?: boolean; inactive?: boolean; secondAccessDrift?: boolean;
  expiredOffset?: boolean; dateOnly?: boolean; fractionalLimit?: boolean; holdPostUntilAbort?: boolean; holdFirstPreflight?: boolean;
  stallStatusCall?: number; now?: () => number } = {}) {
  const calls = { chats: 0, posts: 0, histories: 0, results: 0, preflights: 0 };
  let uploads = 0;
  let releaseHistory = !options.partialHistory && !options.partialOutput;
  let releaseFirstPreflight!: () => void;
  let firstPreflightEntered!: () => void;
  let releaseStalledStatus!: () => void;
  let stalledStatusEntered!: () => void;
  let statusCalls = 0;
  const firstPreflightGate = new Promise<void>((resolve) => { releaseFirstPreflight = resolve; });
  const firstPreflightPromise = new Promise<void>((resolve) => { firstPreflightEntered = resolve; });
  const stalledStatusGate = new Promise<void>((resolve) => { releaseStalledStatus = resolve; });
  const stalledStatusPromise = new Promise<void>((resolve) => { stalledStatusEntered = resolve; });
  const transactions = new Map<string, { model_id: string; batch_size: number; reference_count: number; post: number }>();
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      const file = (init.body as FormData).get("files"); assert.ok(file instanceof File);
      uploads += 1;
      return Response.json({ files: [{ id: `grok-upload-${uploads}`,
        url: `https://r2.syntx.ai/private/grok/reference-${uploads}.jpg`, mime_type: "image/jpeg", size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      calls.chats += 1; return Response.json({ uuid: `grok-gen-chat-${calls.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      calls.posts += 1;
      const body = JSON.parse(String(init.body)) as { chat_uuid: string; settings: { model_type: string; batch_size: number; file_urls: unknown[] } };
      transactions.set(body.chat_uuid, { model_id: body.settings.model_type, batch_size: body.settings.batch_size,
        reference_count: body.settings.file_urls.length, post: calls.posts });
      if (options.postFailure) throw new Error("synthetic transport loss after POST dispatch");
      if (options.holdPostUntilAbort) return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal; assert.ok(signal instanceof AbortSignal);
        const abort = () => reject(new DOMException("private synthetic POST abort", "AbortError"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
      return Response.json({ id: `grok-gen-owner-${calls.posts}` });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(grok-gen-chat-\d+)\/messages$/u);
    if (history) {
      assert.equal(init?.method ?? "GET", "GET");
      calls.histories += 1;
      const tx = transactions.get(history[1]!); assert.ok(tx);
      const ownerId = `grok-gen-owner-${tx.post}`;
      const messages = [{ id: ownerId, chat_id: 9000 + tx.post, author_id: 101, message_object: Array.from({ length: tx.reference_count }, (_, index) => ({
        id: `grok-gen-ref-${tx.post}-${index + 1}`, message_id: ownerId, object_type: "image", model_type: tx.model_id
      })) as unknown[] }];
      if (releaseHistory || options.partialOutput) messages.push({ id: `grok-gen-bot-${tx.post}`, chat_id: 9000 + tx.post, author_id: -1,
        message_object: Array.from({ length: !releaseHistory && options.partialOutput ? Math.max(1, tx.batch_size - 1) : tx.batch_size }, (_, index) => ({ id: `grok-gen-object-${tx.post}-${index + 1}`,
          message_id: `grok-gen-bot-${tx.post}`, object_type: "image", model_type: tx.model_id })) });
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultPath = url.pathname.match(/^\/api\/v1\/chats\/(grok-gen-chat-\d+)\/(grok-gen-bot-\d+)$/u);
    if (resultPath) {
      assert.equal(init?.method ?? "GET", "GET");
      calls.results += 1;
      const tx = transactions.get(resultPath[1]!); assert.ok(tx);
      return Response.json({ id: resultPath[2], chat_id: 9000 + tx.post, author_id: -1,
        message_object: Array.from({ length: tx.batch_size }, (_, index) => ({ id: `grok-gen-object-${tx.post}-${index + 1}`,
          message_id: resultPath[2], object_type: "image", model_type: tx.model_id, completed: true,
          object_url: `https://r2.syntx.ai/grok-result-${tx.post}-${index + 1}.png` })) });
    }
    throw new Error(`unexpected route ${url.pathname}`);
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    statusCalls += 1;
    if (options.stallStatusCall === statusCalls) { stalledStatusEntered(); await stalledStatusGate; }
    return linked(attemptId);
  } };
  const uploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: options.now });
  const preparer = createOwnerGrokT2iRequestPreparer({ binding: BINDING, linkService, imageUploadService: uploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now: options.now });
  const service = new OwnerGrokT2iGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, imageUploadService: uploadService, preparer, resolveChatClient: () => client,
    preflight: async (input) => { calls.preflights += 1;
      if (options.holdFirstPreflight && calls.preflights === 1) { firstPreflightEntered(); await firstPreflightGate; }
      const snapshot = freshPreflight(input.model_id, Object.keys(input.cost_inputs).sort(), options.now?.() ?? Date.now());
      const subscription = snapshot.account.subscription as { active: boolean; plan_type: string; end_date: string | null; end_date_kind: string | null };
      if (options.inactive) subscription.active = false;
      if (options.expiredOffset) { subscription.end_date = "2020-01-01T00:00:00Z"; subscription.end_date_kind = "OFFSET_DATETIME"; }
      if (options.dateOnly) { subscription.end_date = "2099-01-01"; subscription.end_date_kind = "DATE_ONLY"; }
      if (options.secondAccessDrift && calls.preflights === 2) snapshot.model_access.access = false;
      if (options.fractionalLimit) (snapshot.model_access as { limit: number | null }).limit = 0.5;
      return snapshot;
    }, ...(options.now === undefined ? {} : { now: options.now }), pollDelayMs: 0, maxPollAttempts: 1, wait: async () => undefined });
  return { calls, service, uploadService, releaseHistory: () => { releaseHistory = true; },
    uploadCount: () => uploads, linkStatusReads: () => statusCalls,
    waitForFirstPreflight: () => firstPreflightPromise, releaseFirstPreflight: () => releaseFirstPreflight(),
    waitForStalledStatus: () => stalledStatusPromise, releaseStalledStatus: () => releaseStalledStatus(), transactions };
}

test("Grok T2I generation service is a distinct full-four owner service", () => {
  assert.equal(typeof OwnerGrokT2iGenerationService, "function");
  assert.equal(typeof OwnerGrokT2iGenerationServiceError, "function");
  const options: Partial<OwnerGrokT2iGenerationServiceOptions> = {};
  assert.deepEqual(Object.keys(options), []);
});

test("unknown result errors do not expose private provider response content", () => {
  const error = new OwnerGrokT2iGenerationServiceError("OUTCOME_UNKNOWN", "grok_t2i_recovery_00000000-0000-4000-8000-000000000000");
  assert.equal(error.message.includes("private"), false);
  assert.equal(error.code, "OUTCOME_UNKNOWN");
});

test("actual full-four Grok chain performs two keyed preflights, one POST, owner ACK binding, and exact result GET", async () => {
  const rig = createRig();
  const cases: readonly { model_id: OwnerGrokT2iModel; parameters: Record<string, unknown> }[] = OWNER_GROK_T2I_MODELS.flatMap((model_id) =>
    [1, 2, 3, 4, 5].map((batch_size) => ({ model_id, parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size,
      ...(model_id === "grok_imagine_2" ? { details_quality: "medium" } : {}) } })));
  try {
    for (const [index, request] of cases.entries()) {
      const result = await rig.service.generate({ attemptId: ATTEMPT, model_id: request.model_id,
        parameters: request.parameters, prompt: `Full-four request ${index}`, reference_handles: [] });
      assert.equal(result.model_id, request.model_id);
      assert.equal(result.backend_acceptance, "UNPROVEN");
      assert.equal(result.artifacts.length, request.parameters.batch_size);
    }
    assert.equal(rig.calls.preflights, 40);
    assert.equal(rig.calls.chats, 20);
    assert.equal(rig.calls.posts, 20);
    assert.equal(rig.calls.histories, 20);
    assert.equal(rig.calls.results, 20);
  } finally { await rig.service.close(); }
});

test("pending history creates a stable semantic hold and later recovery remains GET-only", async () => {
  const rig = createRig({ partialHistory: true });
  const request = { attemptId: ATTEMPT, model_id: "grok_imagine_2" as const,
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1, details_quality: "low" },
    prompt: "unknown semantic intent", reference_handles: [] as string[] };
  try {
    let recoveryId = "";
    await assert.rejects(rig.service.generate(request), (cause: unknown) => {
      assert.ok(cause instanceof OwnerGrokT2iGenerationServiceError);
      assert.equal(cause.code, "OUTCOME_UNKNOWN"); recoveryId = cause.recovery_id ?? "";
      assert.equal(cause.diagnostic?.post_started, true);
      assert.equal(cause.diagnostic?.echo_ack_known, true);
      return true;
    });
    const posts = rig.calls.posts;
    await assert.rejects(rig.service.generate({ ...request, attemptId: "link_grok_generation_new_000000001" }),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(rig.calls.posts, posts);
    assert.equal((await rig.service.listRecoveries({ attemptId: ATTEMPT }))[0]?.recovery_id, recoveryId);
    rig.releaseHistory();
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "result_observed");
    assert.equal(rig.calls.posts, posts);
    assert.ok(rig.calls.histories >= 2);
  } finally { await rig.service.close(); }
});

test("expired Grok input still blocks new GEN but a known ACK recovers by GET after 16 minutes", async () => {
  let now = Date.now();
  const rig = createRig({ partialHistory: true, now: () => now });
  const uploaded = await rig.uploadService.upload({ attemptId: ATTEMPT, model_id: "grok_imagine_2",
    content_base64: jpegWithWidth(1).toString("base64"), filename: "grok-long-job.jpg", mime_type: "image/jpeg" });
  const request = { attemptId: ATTEMPT, model_id: "grok_imagine_2" as const,
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1, details_quality: "medium" },
    prompt: "Pending known-ACK result after source expiry.", reference_handles: [uploaded.reference_handle] };
  try {
    let recoveryId = "";
    await assert.rejects(rig.service.generate(request), (cause: unknown) => {
      assert.ok(cause instanceof OwnerGrokT2iGenerationServiceError);
      assert.equal(cause.code, "OUTCOME_UNKNOWN");
      assert.equal(cause.diagnostic?.echo_ack_known, true);
      recoveryId = cause.recovery_id ?? "";
      return recoveryId.startsWith("grok_t2i_recovery_");
    });
    const before = { ...rig.calls };
    const uploadsBefore = rig.uploadCount();
    now += 16 * 60_000;
    await assert.rejects(rig.service.generate({ ...request, prompt: "New GEN cannot revive the expired reference." }),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "PRE_DISPATCH_FAILED");
    assert.deepEqual(rig.calls, before);
    assert.equal(rig.uploadCount(), uploadsBefore);

    rig.releaseHistory();
    const statusReadsBefore = rig.linkStatusReads();
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "result_observed");
    assert.equal(result.model_id, "grok_imagine_2");
    assert.equal(rig.calls.posts, before.posts);
    assert.equal(rig.calls.chats, before.chats);
    assert.equal(rig.uploadCount(), uploadsBefore);
    assert.equal(rig.calls.histories, before.histories + 1);
    assert.equal(rig.calls.results, before.results + 1);
    assert.ok(rig.linkStatusReads() > statusReadsBefore);
  } finally { await rig.service.close(); }
});

test("history PARTIAL remains unknown until exact ordered batch GET can be recovered", async () => {
  const rig = createRig({ partialOutput: true });
  const request = { attemptId: ATTEMPT, model_id: "grok_imagine_2" as const,
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 2, details_quality: "low" },
    prompt: "partial then complete", reference_handles: [] as string[] };
  try {
    let recoveryId = "";
    await assert.rejects(rig.service.generate(request), (cause: unknown) => {
      assert.ok(cause instanceof OwnerGrokT2iGenerationServiceError);
      assert.equal(cause.code, "OUTCOME_UNKNOWN"); recoveryId = cause.recovery_id ?? "";
      assert.equal(cause.diagnostic?.history_status, "PARTIAL");
      assert.equal(cause.diagnostic?.history_reason, "OUTPUT_BATCH_PARTIAL");
      assert.equal(cause.diagnostic?.result_status, "NOT_READ");
      return true;
    });
    rig.releaseHistory();
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.artifacts.length, 2);
    assert.equal(rig.calls.posts, 1);
  } finally { await rig.service.close(); }
});

test("full service resolves actual 765 references at both Imagine selector maxima in order", async () => {
  const rig = createRig();
  try {
    for (const [model_id, count, aspect_ratio] of [["grok_imagine_2", 5, "2:3"], ["grok_imagine_quality", 3, "2:3"]] as const) {
      const handles: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const uploaded = await rig.uploadService.upload({ attemptId: ATTEMPT, model_id, content_base64: jpegWithWidth(index + 1).toString("base64"),
          filename: `grok-ref-${index + 1}.jpg`, mime_type: "image/jpeg" });
        handles.push(uploaded.reference_handle);
      }
      const result = await rig.service.generate({ attemptId: ATTEMPT, model_id,
        parameters: { aspect_ratio, resolution: "2k", batch_size: 1, ...(model_id === "grok_imagine_2" ? { details_quality: "medium" } : {}) },
        prompt: `references ${model_id}`, reference_handles: handles });
      assert.equal(result.reference_count, count);
      assert.equal(result.artifacts.length, 1);
    }
    assert.equal(rig.calls.posts, 2);
    assert.equal(rig.calls.preflights, 4);
  } finally { await rig.service.close(); }
});

test("preflight denial or second-read access drift never reaches the generation POST", async () => {
  for (const options of [{ inactive: true }, { expiredOffset: true }, { dateOnly: true }, { secondAccessDrift: true }] as const) {
    const rig = createRig(options);
    try {
      await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, model_id: "grok_t2i",
        parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "preflight guard", reference_handles: [] }),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "PREFLIGHT_FAILED");
      assert.equal(rig.calls.posts, 0);
      assert.equal(rig.calls.preflights, options.inactive || options.expiredOffset || options.dateOnly ? 1 : 2);
    } finally { await rig.service.close(); }
  }
});

test("preflight preserves a finite fractional model-access limit without treating it as a spending cap", async () => {
  const rig = createRig({ fractionalLimit: true });
  try {
    const result = await rig.service.generate({ attemptId: ATTEMPT, model_id: "grok_t2i",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "fractional read-only limit", reference_handles: [] });
    assert.equal(result.status, "result_observed");
    assert.equal(rig.calls.preflights, 2);
    assert.equal(rig.calls.posts, 1);
  } finally { await rig.service.close(); }
});

test("successful semantic result cache reuses its original asset candidate without accumulating 773 issuances", async () => {
  const rig = createRig();
  const request = { attemptId: ATTEMPT, model_id: "grok_t2i" as const,
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "completed cache intent", reference_handles: [] as string[] };
  try {
    const first = await rig.service.generate(request);
    for (let index = 0; index < 130; index += 1) assert.strictEqual(await rig.service.generate(request), first);
    assert.equal(rig.calls.posts, 1);
    assert.equal(rig.calls.chats, 1);
    assert.equal(rig.calls.preflights, 2);
  } finally { await rig.service.close(); }
});

test("128 unknown semantic holds are non-evicting and the 129th request fails before another chat or POST", async () => {
  const rig = createRig({ postFailure: true });
  try {
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, model_id: "grok_t2i",
        parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: `unknown hold ${index}`, reference_handles: [] }),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "OUTCOME_UNKNOWN");
    }
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, model_id: "grok_t2i",
      parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "unknown hold 128", reference_handles: [] }),
    (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "SERVICE_BUSY");
    assert.equal(rig.calls.posts, 128);
    assert.equal(rig.calls.chats, 128);
  } finally { await rig.service.close(); }
});

test("concurrent identical semantic intent is claimed once while its first preflight is pending", async () => {
  const rig = createRig({ holdFirstPreflight: true });
  const request = { attemptId: ATTEMPT, model_id: "grok_t2i" as const,
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "concurrent claim", reference_handles: [] as string[] };
  try {
    const first = rig.service.generate(request);
    await rig.waitForFirstPreflight();
    await assert.rejects(rig.service.generate(request),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "INTENT_ALREADY_CLAIMED");
    rig.releaseFirstPreflight();
    await first;
    assert.equal(rig.calls.posts, 1);
    assert.equal(rig.calls.chats, 1);
  } finally { rig.releaseFirstPreflight(); await rig.service.close(); }
});

test("close aborts and drains an in-flight POST and reports its outcome as unknown", async () => {
  const rig = createRig({ holdPostUntilAbort: true });
  const pending = rig.service.generate({ attemptId: ATTEMPT, model_id: "grok_t2i",
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "close drain", reference_handles: [] });
  for (let index = 0; index < 100 && rig.calls.posts === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(rig.calls.posts, 1);
  const closing = rig.service.close();
  await assert.rejects(pending, (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "OUTCOME_UNKNOWN");
  await closing;
  assert.equal(rig.calls.posts, 1);
});

test("caller abort during stalled 773 linked-principal preparation prevents late chat or POST", async () => {
  const rig = createRig({ stallStatusCall: 2 });
  const aborter = new AbortController();
  const pending = rig.service.generate({ attemptId: ATTEMPT, model_id: "grok_t2i",
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "abort during prepare", reference_handles: [] }, aborter.signal);
  try {
    await rig.waitForStalledStatus();
    aborter.abort();
    await assert.rejects(pending, (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "PRE_DISPATCH_FAILED");
    rig.releaseStalledStatus();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(rig.calls.chats, 0);
    assert.equal(rig.calls.posts, 0);
  } finally { rig.releaseStalledStatus(); await rig.service.close(); }
});

test("lost POST acknowledgement holds semantic intent and reconciliation never repeats POST", async () => {
  const rig = createRig({ postFailure: true });
  const request = { attemptId: ATTEMPT, model_id: "grok_t2i" as const,
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "lost acknowledgement intent", reference_handles: [] as string[] };
  try {
    let recoveryId = "";
    await assert.rejects(rig.service.generate(request), (cause: unknown) => {
      assert.ok(cause instanceof OwnerGrokT2iGenerationServiceError);
      assert.equal(cause.code, "OUTCOME_UNKNOWN"); recoveryId = cause.recovery_id ?? "";
      assert.equal(cause.diagnostic?.post_started, true);
      assert.equal(cause.diagnostic?.echo_ack_known, false);
      return true;
    });
    const postCount = rig.calls.posts;
    await assert.rejects(rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "OUTCOME_UNKNOWN");
    await assert.rejects(rig.service.generate({ ...request, attemptId: "link_grok_generation_second_000001" }),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(rig.calls.posts, postCount);
    assert.equal((await rig.service.listRecoveries({ attemptId: ATTEMPT }))[0]?.diagnostic.echo_ack_known, false);
  } finally { await rig.service.close(); }
});

test("unknown semantic hold survives recovery and asset TTL expiry without allowing a new-attempt replay", async () => {
  let now = Date.now();
  const rig = createRig({ postFailure: true, now: () => now });
  const request = { attemptId: ATTEMPT, model_id: "grok_t2i" as const,
    parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, prompt: "hold beyond original ttl", reference_handles: [] as string[] };
  try {
    await assert.rejects(rig.service.generate(request), (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "OUTCOME_UNKNOWN");
    const postCount = rig.calls.posts;
    now += 15 * 60_000 + 1;
    await assert.rejects(rig.service.generate({ ...request, attemptId: "link_grok_generation_afterttl_0001" }),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "INTENT_ALREADY_CLAIMED");
    assert.equal(rig.calls.posts, postCount);
    const listed = await rig.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(listed.length, 1);
    const beforeReconcile = { ...rig.calls };
    await assert.rejects(rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: listed[0]!.recovery_id }),
      (cause: unknown) => cause instanceof OwnerGrokT2iGenerationServiceError && cause.code === "OUTCOME_UNKNOWN");
    assert.deepEqual(rig.calls, beforeReconcile);
  } finally { await rig.service.close(); }
});
