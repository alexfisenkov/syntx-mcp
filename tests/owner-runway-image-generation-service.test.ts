import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { OwnerRunwayImageUploadService } from "../src/application/owner-runway-image-upload-service.js";
import type { OwnerRunwayImageGenerationPreflightResult, OwnerRunwayImageGenerationResult } from "../src/application/owner-runway-image-generation-service.js";
import type { OwnerRunwayImageVariant } from "../src/application/owner-runway-image-parameters.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

async function serviceModule(): Promise<Record<string, unknown>> {
  const target = new URL("../src/application/owner-runway-image-generation-service.js", import.meta.url);
  return await import(target.href) as Record<string, unknown>;
}

test("Runway image generation service exposes the frozen lifecycle enums and public class", async () => {
  const module = await serviceModule();
  assert.ok(module && typeof module.OwnerRunwayImageGenerationService === "function",
    "the generation service module should expose its public class");
  assert.deepEqual(module.OWNER_RUNWAY_IMAGE_GENERATION_PHASES, [
    "REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
    "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
  ]);
  assert.deepEqual(module.OWNER_RUNWAY_IMAGE_GENERATION_ERROR_CODES, [
    "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
    "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED",
    "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
  ]);
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00]);
const REFERENCE_BYTES = [PNG, JPEG, WEBP] as const;
const REFERENCE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const BINDING = Object.freeze({ tenant_id: "runway-generation-tenant", subject: "runway-generation-owner" });
const ATTEMPT = "link_runway_generation_service_0123456789";
const RELINKED_ATTEMPT = "link_runway_generation_service_9876543210";

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), linked: true as const };
}

function freshPreflight(variant: OwnerRunwayImageVariant, observedAt = Date.now()): OwnerRunwayImageGenerationPreflightResult {
  return {
    account: { balance: { unit: "tokens" as const, available: null },
      subscription: { active: true, plan_type: "FREE", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: new Date(observedAt).toISOString() },
    model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT" as const,
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: variant, ai_name: "runway-frames", model_type: variant, account_read_live: true as const,
      parameter_keys: [] as string[], parameters_redacted: true as const, access: true,
      cost: 0, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false,
      observed_at: new Date(observedAt).toISOString() }
  };
}

interface RigOptions {
  readonly preflight?: (variant: OwnerRunwayImageVariant, call: number) => ReturnType<typeof freshPreflight> | Promise<ReturnType<typeof freshPreflight>>;
  readonly afterChat?: () => void;
  readonly onPost?: (signal: AbortSignal | undefined) => void;
  readonly holdPostUntilAbort?: boolean;
  readonly pendingHistoryFirst?: boolean;
  readonly pendingHistoryAlways?: boolean;
  readonly now?: () => number;
}

function createRig(options: RigOptions = {}) {
  const calls = { uploads: 0, chats: 0, posts: 0, histories: 0, results: 0, preflights: 0 };
  const events: string[] = [];
  const sent: Array<{ resolution: string; temperature: number; references: number }> = [];
  const observed: Array<{ resolution: string; temperature: number; references: number }> = [];
  const chatToPost = new Map<string, number>();
  const credentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-runway-generation-credential");
  } };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files") {
      calls.uploads += 1;
      events.push("upload");
      const form = init?.body as FormData;
      const file = form.get("files");
      assert.ok(file instanceof File);
      return Response.json({ files: [{ id: `private-upload-${calls.uploads}`,
        url: `https://r2.syntx.ai/private/runway/${calls.uploads}.${file.type.slice("image/".length)}`,
        mime_type: file.type, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") {
      calls.chats += 1;
      events.push("chat");
      assert.equal(init?.method, "POST");
      options.afterChat?.();
      return Response.json({ uuid: `runway-chat-${calls.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate") {
      calls.posts += 1;
      events.push("post");
      assert.equal(url.searchParams.get("ai_name"), "runway-frames");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as { chat_uuid: string; settings: { resolution: string; temperature: number; file_urls: unknown[] } };
      const item = { resolution: body.settings.resolution, temperature: body.settings.temperature, references: body.settings.file_urls.length };
      sent.push(item);
      chatToPost.set(body.chat_uuid, calls.posts);
      options.onPost?.(init?.signal as AbortSignal | undefined);
      if (options.holdPostUntilAbort) {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) { reject(new Error("native POST has no abort signal")); return; }
          const abort = () => reject(new DOMException("synthetic POST aborted", "AbortError"));
          if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
        });
      }
      return Response.json({ id: `owner-echo-${calls.posts}` });
    }
    const chatMatch = url.pathname.match(/^\/api\/v1\/chats\/(runway-chat-\d+)\/messages$/u);
    if (chatMatch) {
      calls.histories += 1;
      events.push("history");
      const index = chatToPost.get(chatMatch[1]!);
      assert.ok(index);
      const requested = sent[index - 1]!;
      const echo = `owner-echo-${index}`;
      const bot = `bot-result-${index}`;
      const refs = Array.from({ length: requested.references }, (_, ref) => ({ id: `owner-ref-${index}-${ref + 1}`,
        message_id: echo, object_type: "image", model_type: "runway_frames" }));
      const ownerMessage = { id: echo, chat_id: 9000 + index, author_id: 100, message_object: [...refs,
        { id: `owner-text-${index}`, message_id: echo, object_type: "text", model_type: "runway_frames" }] };
      const botMessage = { id: bot, chat_id: 9000 + index, author_id: -1, message_object: [{ id: `runway-object-${index}`,
        message_id: bot, object_type: "image", model_type: "runway_frames" }] };
      const historyPending = options.pendingHistoryAlways || options.pendingHistoryFirst && calls.histories === 1;
      const messages = historyPending ? [ownerMessage] : [ownerMessage, botMessage];
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = url.pathname.match(/^\/api\/v1\/chats\/(runway-chat-\d+)\/(bot-result-\d+)$/u);
    if (resultMatch) {
      calls.results += 1;
      events.push("result");
      const index = Number(resultMatch[2]!.slice("bot-result-".length));
      return Response.json({ id: `bot-result-${index}`, chat_id: 9000 + index, author_id: -1, message_object: [{
        id: `runway-object-${index}`, message_id: `bot-result-${index}`, object_type: "image", model_type: "runway_frames",
        completed: true, object_url: `https://r2.syntx.ai/runway/result-${index}.png`
      }] });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerRunwayImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: options.now });
  const preflightInputs: Array<{ attemptId: string; cost_inputs: Readonly<Record<string, never>>; request_fingerprint: string }> = [];
  const serviceModulePromise = serviceModule();
  const servicePromise = serviceModulePromise.then((module) => new (module.OwnerRunwayImageGenerationService as new (options: unknown) => {
    generate(input: unknown, signal?: AbortSignal): Promise<OwnerRunwayImageGenerationResult>;
    reconcile(input: unknown, signal?: AbortSignal): Promise<OwnerRunwayImageGenerationResult>;
    listRecoveries(input: unknown): Promise<readonly { recovery_id: string; diagnostic: unknown }[]>;
    invalidateAttempt(attemptId: string): Promise<void>;
    close(): Promise<void>;
  })({ binding: BINDING, linkService, catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
      uploadService, resolveChatClient: () => client,
    preflight: async (input: { attemptId: string; variant: OwnerRunwayImageVariant; cost_inputs: Readonly<Record<string, never>>; request_fingerprint: string }) => {
      calls.preflights += 1;
      events.push(`preflight-${calls.preflights}`);
      preflightInputs.push(input);
      return options.preflight ? options.preflight(input.variant, calls.preflights) : freshPreflight(input.variant, options.now?.() ?? Date.now());
    }, now: options.now ?? Date.now, timeoutMs: 10_000, pollDelayMs: 0, maxPollAttempts: 1, wait: async () => undefined }));
  return { calls, events, sent, observed, uploadService, servicePromise, preflightInputs };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 80 && !predicate(); index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true, "bounded lifecycle latch did not reach its expected state");
}

test("Runway service sends every source resolution, fractional temperature, and zero-to-three owned references", async () => {
  const rig = createRig();
  const service = await rig.servicePromise;
  const handles: string[] = [];
  try {
    for (let index = 0; index < 3; index += 1) {
      const receipt = await rig.uploadService.upload({ attemptId: ATTEMPT, variant: "runway_frames",
        content_base64: REFERENCE_BYTES[index]!.toString("base64"), filename: `owned-${index + 1}.${REFERENCE_MIMES[index]!.slice("image/".length)}`,
        mime_type: REFERENCE_MIMES[index]! });
      handles.push(receipt.reference_handle);
    }
    const referenceSet = await rig.uploadService.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: handles });
    assert.equal(referenceSet.reference_count, 3);
    const resolutions = ["2112x912", "1920x1088", "1456x1088", "1088x1088", "1088x1456", "1088x1920"];
    const temperatures = [1, 1.375, 2.25, 3.5, 4.625, 5];
    for (let index = 0; index < resolutions.length; index += 1) {
      const parameters = { resolution: resolutions[index]!, temperature: temperatures[index]! };
      const referenceHandles = handles.slice(0, index % 4);
      const result = await service.generate({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: referenceHandles,
        parameters, prompt: `Source-bound prompt ${index + 1}` });
      rig.observed.push({ resolution: result.parameters.resolution, temperature: result.parameters.temperature,
        references: result.reference_count });
      assert.equal(result.status, "result_observed");
      assert.equal(result.backend_acceptance, "unproven");
      assert.equal(result.geometry_verified, false);
      assert.deepEqual(result.cost_inputs, {});
      assert.match(result.cost_input_confidence, /NOT_FREE_PRICE/u);
    }
    assert.deepEqual(rig.sent, resolutions.map((resolution, index) => ({ resolution, temperature: temperatures[index]!, references: index % 4 })));
    assert.deepEqual(rig.observed, rig.sent);
    assert.equal(rig.calls.preflights, 12);
    assert.equal(rig.calls.chats, 6);
    assert.equal(rig.calls.posts, 6);
    assert.equal(rig.calls.histories, 6);
    assert.equal(rig.calls.results, 6);
    assert.ok(rig.preflightInputs.every((input) => Object.keys(input.cost_inputs).length === 0));
  } finally {
    await Promise.all([service.close(), rig.uploadService.close()]);
  }
});

test("second preflight is fresh after chat and rejects stale snapshots or ambiguous date-only expiry before POST", async () => {
  for (const invalidation of ["stale", "date-only"] as const) {
    const rig = createRig({ preflight: (variant, call) => {
      const result = freshPreflight(variant, call === 2 && invalidation === "stale" ? Date.now() - 60_000 : Date.now());
      if (call === 2 && invalidation === "date-only") {
        result.account.subscription.end_date = "2026-12-31";
        result.account.subscription.end_date_kind = "DATE_ONLY";
      }
      return result;
    } });
    const service = await rig.servicePromise;
    try {
      await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [],
        parameters: { resolution: "1088x1088", temperature: 2.375 }, prompt: `late admission ${invalidation}` }),
      (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "PREFLIGHT_FAILED");
      assert.equal(rig.calls.chats, 1);
      assert.equal(rig.calls.preflights, 2);
      assert.equal(rig.calls.posts, 0);
      assert.ok(rig.events.indexOf("chat") < rig.events.indexOf("preflight-2"));
      assert.equal(rig.events.includes("post"), false);
    } finally { await Promise.all([service.close(), rig.uploadService.close()]); }
  }
});

test("pending exact history recovers by GET only and returns a sanitized single artifact", async () => {
  const rig = createRig({ pendingHistoryFirst: true });
  const service = await rig.servicePromise;
  const prompt = "private Runway prompt must not enter recovery records";
  try {
    let recoveryId = "";
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [],
      parameters: { resolution: "1456x1088", temperature: 2.75 }, prompt }), (error: unknown) => {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
          !("recovery_id" in error) || typeof error.recovery_id !== "string") return false;
      recoveryId = error.recovery_id;
      return true;
    });
    assert.match(recoveryId, /^runway_image_recovery_[0-9a-f-]{36}$/u);
    assert.equal(rig.calls.posts, 1);
    assert.equal(rig.calls.histories, 1);
    assert.equal(rig.calls.results, 0);
    const recoveries = await service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(recoveries.length, 1);
    assert.equal(JSON.stringify(recoveries).includes(prompt), false);
    const result = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "result_observed");
    assert.equal(result.backend_acceptance, "unproven");
    assert.equal(result.artifact.url, "https://r2.syntx.ai/runway/result-1.png");
    assert.equal(result.artifact.mime_type, "image/png");
    assert.equal(result.artifact.mime_source, "URL_EXTENSION");
    assert.equal(result.actual_image.width, null);
    assert.equal(result.geometry_verified, false);
    assert.equal(rig.calls.posts, 1);
    assert.equal(rig.calls.histories, 2);
    assert.equal(rig.calls.results, 1);
    assert.equal(rig.events.includes("inprogress"), false);
  } finally { await Promise.all([service.close(), rig.uploadService.close()]); }
});

test("unknown semantic intent survives private TTL, relinking, and same-byte reupload without a second POST", async () => {
  let now = Date.now();
  const rig = createRig({ pendingHistoryFirst: true, now: () => now });
  const service = await rig.servicePromise;
  const prompt = "same semantic intent after private expiry";
  let recoveryId = "";
  try {
    const original = await rig.uploadService.upload({ attemptId: ATTEMPT, variant: "runway_frames",
      content_base64: PNG.toString("base64"), filename: "first.png", mime_type: "image/png" });
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [original.reference_handle],
      parameters: { resolution: "1088x1088", temperature: 2.5 }, prompt }), (error: unknown) => {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "OUTCOME_UNKNOWN" ||
          !("recovery_id" in error) || typeof error.recovery_id !== "string") return false;
      recoveryId = error.recovery_id;
      return true;
    });
    assert.equal(rig.calls.posts, 1);
    now += 15 * 60_000 + 1;
    assert.deepEqual(await service.listRecoveries({ attemptId: ATTEMPT }), []);
    const reuploaded = await rig.uploadService.upload({ attemptId: RELINKED_ATTEMPT, variant: "runway_frames",
      content_base64: PNG.toString("base64"), filename: "relinked.png", mime_type: "image/png" });
    await assert.rejects(service.generate({ attemptId: RELINKED_ATTEMPT, variant: "runway_frames",
      reference_handles: [reuploaded.reference_handle], parameters: { resolution: "1088x1088", temperature: 2.5 }, prompt }),
    (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(rig.calls.chats, 1);
    assert.equal(rig.calls.posts, 1);
    assert.equal(rig.calls.preflights, 2);
    assert.equal(rig.calls.uploads, 2);
    assert.equal((await service.listRecoveries({ attemptId: ATTEMPT })).length, 0);
    assert.equal(recoveryId.length > 0, true);
  } finally { await Promise.all([service.close(), rig.uploadService.close()]); }
});

test("128 uncertain semantic intents remain bounded without eviction or a 129th POST", async () => {
  const rig = createRig({ pendingHistoryAlways: true });
  const service = await rig.servicePromise;
  const request = (index: number) => ({ attemptId: ATTEMPT, variant: "runway_frames" as const, reference_handles: [],
    parameters: { resolution: "1920x1088", temperature: 2.125 }, prompt: `uncertain distinct intent ${index}` });
  try {
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(service.generate(request(index)), (error: unknown) => error !== null && typeof error === "object" &&
        "code" in error && error.code === "OUTCOME_UNKNOWN");
    }
    assert.equal(rig.calls.posts, 128);
    await assert.rejects(service.generate(request(128)), (error: unknown) => error !== null && typeof error === "object" &&
      "code" in error && error.code === "SERVICE_BUSY");
    await assert.rejects(service.generate(request(0)), (error: unknown) => error !== null && typeof error === "object" &&
      "code" in error && error.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(rig.calls.posts, 128);
    assert.equal(rig.calls.chats, 128);
  } finally { await Promise.all([service.close(), rig.uploadService.close()]); }
});

test("distinct private reference-set cache refuses a 129th live set before chat", async () => {
  const rig = createRig();
  const service = await rig.servicePromise;
  const handles: string[] = [];
  try {
    for (let index = 0; index < 128; index += 1) {
      const bytes = REFERENCE_BYTES[index % REFERENCE_BYTES.length]!;
      const mime = REFERENCE_MIMES[index % REFERENCE_MIMES.length]!;
      const receipt = await rig.uploadService.upload({ attemptId: ATTEMPT, variant: "runway_frames",
        content_base64: bytes.toString("base64"), filename: `cache-${index}.${mime.slice("image/".length)}`, mime_type: mime });
      handles.push(receipt.reference_handle);
    }
    for (let index = 0; index < handles.length; index += 1) {
      await service.generate({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [handles[index]!],
        parameters: { resolution: "1088x1088", temperature: 2.125 }, prompt: `completed cache use ${index}` });
    }
    assert.equal(rig.calls.posts, 128);
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "runway_frames",
      reference_handles: [handles[0]!, handles[1]!], parameters: { resolution: "1088x1088", temperature: 2.125 },
      prompt: "distinct 129th private reference set" }), (error: unknown) => error !== null && typeof error === "object" &&
      "code" in error && error.code === "SERVICE_BUSY");
    assert.equal(rig.calls.chats, 128);
    assert.equal(rig.calls.posts, 128);
  } finally { await Promise.all([service.close(), rig.uploadService.close()]); }
});

test("abort before POST releases the claim while abort after POST preserves an unknown tombstone", async () => {
  const input = { attemptId: ATTEMPT, variant: "runway_frames" as const, reference_handles: [],
    parameters: { resolution: "1088x1088", temperature: 2.25 }, prompt: "abort boundary semantic intent" };
  const beforeController = new AbortController();
  const beforeRig = createRig({ afterChat: () => beforeController.abort() });
  const beforeService = await beforeRig.servicePromise;
  try {
    await assert.rejects(beforeService.generate({ ...input, prompt: "pre-dispatch abort" }, beforeController.signal),
      (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "PRE_DISPATCH_FAILED");
    assert.equal(beforeRig.calls.posts, 0);
    assert.deepEqual(await beforeService.listRecoveries({ attemptId: ATTEMPT }), []);
  } finally { await Promise.all([beforeService.close(), beforeRig.uploadService.close()]); }

  let postStarted = false;
  let releaseStarted!: () => void;
  const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
  const afterController = new AbortController();
  const afterRig = createRig({ holdPostUntilAbort: true, onPost: () => { postStarted = true; releaseStarted(); } });
  const afterService = await afterRig.servicePromise;
  try {
    const outcome = afterService.generate(input, afterController.signal).then((value) => ({ value }), (error: unknown) => ({ error }));
    await Promise.race([started, waitUntil(() => postStarted)]);
    assert.equal(postStarted, true);
    afterController.abort();
    const settled = await outcome;
    assert.ok("error" in settled);
    const error = settled.error as { code?: unknown; recovery_id?: unknown };
    assert.equal(error.code, "OUTCOME_UNKNOWN");
    assert.equal(typeof error.recovery_id, "string");
    assert.equal(afterRig.calls.posts, 1);
    await assert.rejects(afterService.generate(input), (duplicate: unknown) => duplicate !== null && typeof duplicate === "object" &&
      "code" in duplicate && duplicate.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(afterRig.calls.posts, 1);
  } finally { await Promise.all([afterService.close(), afterRig.uploadService.close()]); }
});

test("attempt invalidation drains a POST without exposing recovery and clears private references; close also drains", async () => {
  const uploadAndGenerate = async (rig: ReturnType<typeof createRig>,
    service: { generate(input: unknown): Promise<OwnerRunwayImageGenerationResult> }) => {
    const receipt = await rig.uploadService.upload({ attemptId: ATTEMPT, variant: "runway_frames",
      content_base64: PNG.toString("base64"), filename: "cleanup.png", mime_type: "image/png" });
    return { receipt,
      generated: service.generate({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [receipt.reference_handle],
        parameters: { resolution: "1920x1088", temperature: 3.25 }, prompt: "cleanup race intent" })
        .then((value) => ({ value }), (error: unknown) => ({ error })) };
  };

  let postEntered = false;
  let releasePost!: () => void;
  const invalidationEntered = new Promise<void>((resolve) => { releasePost = resolve; });
  const invalidationRig = createRig({ holdPostUntilAbort: true, onPost: () => { postEntered = true; releasePost(); } });
  const invalidationService = await invalidationRig.servicePromise;
  let staleHandle = "";
  try {
    const operation = await uploadAndGenerate(invalidationRig, invalidationService);
    staleHandle = operation.receipt.reference_handle;
    await Promise.race([invalidationEntered, waitUntil(() => postEntered)]);
    const invalidation = invalidationService.invalidateAttempt(ATTEMPT);
    await invalidation;
    const settled = await operation.generated;
    assert.ok("error" in settled);
    assert.equal((settled.error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
    assert.equal((settled.error as { recovery_id?: unknown }).recovery_id, undefined);
    assert.equal(invalidationRig.calls.posts, 1);
    assert.deepEqual(await invalidationService.listRecoveries({ attemptId: ATTEMPT }), []);
    await assert.rejects(invalidationRig.uploadService.issueReferences({ attemptId: ATTEMPT, variant: "runway_frames",
      reference_handles: [staleHandle] }), (error: unknown) => error !== null && typeof error === "object" &&
      "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    const replacement = await invalidationRig.uploadService.upload({ attemptId: ATTEMPT, variant: "runway_frames",
      content_base64: PNG.toString("base64"), filename: "replacement.png", mime_type: "image/png" });
    await assert.rejects(invalidationService.generate({ attemptId: ATTEMPT, variant: "runway_frames",
      reference_handles: [replacement.reference_handle], parameters: { resolution: "1920x1088", temperature: 3.25 }, prompt: "cleanup race intent" }),
    (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(invalidationRig.calls.posts, 1);
  } finally { await Promise.all([invalidationService.close(), invalidationRig.uploadService.close()]); }

  let closePostEntered = false;
  let releaseClosePost!: () => void;
  const closeEntered = new Promise<void>((resolve) => { releaseClosePost = resolve; });
  const closeRig = createRig({ holdPostUntilAbort: true, onPost: () => { closePostEntered = true; releaseClosePost(); } });
  const closeService = await closeRig.servicePromise;
  try {
    const operation = await uploadAndGenerate(closeRig, closeService);
    await Promise.race([closeEntered, waitUntil(() => closePostEntered)]);
    const closing = closeService.close();
    await closing;
    const settled = await operation.generated;
    assert.ok("error" in settled);
    assert.equal((settled.error as { code?: unknown }).code, "OUTCOME_UNKNOWN");
    assert.equal(closeRig.calls.posts, 1);
    await assert.rejects(closeService.generate({ attemptId: ATTEMPT, variant: "runway_frames", reference_handles: [],
      parameters: { resolution: "1088x1088", temperature: 2 }, prompt: "closed" }),
    (error: unknown) => error !== null && typeof error === "object" && "code" in error && error.code === "SERVICE_CLOSED");
  } finally { await Promise.all([closeService.close(), closeRig.uploadService.close()]); }
});
