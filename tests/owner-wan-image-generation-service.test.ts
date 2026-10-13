import assert from "node:assert/strict";
import test from "node:test";
import { OwnerWanImageUploadService } from "../src/application/owner-wan-image-upload-service.js";
import type { OwnerWanImageParameters, OwnerWanImageVariant } from "../src/application/owner-wan-image-parameters.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const NOW = Date.now();
const ATTEMPT = "link_wan_generation_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "wan-generation-tenant", subject: "wan-generation-subject" });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VARIANTS = ["wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"] as const;

function bmp24(width = 384, height = 384): Buffer {
  const stride = Math.ceil(width * 24 / 32) * 4;
  const bytes = Buffer.alloc(54 + stride * height);
  bytes.write("BM", 0, "ascii"); bytes.writeUInt32LE(bytes.byteLength, 2); bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14); bytes.writeInt32LE(width, 18); bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26); bytes.writeUInt16LE(24, 28); bytes.writeUInt32LE(0, 30);
  bytes.writeUInt32LE(stride * height, 34);
  return bytes;
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: new Date(NOW + 60 * 60_000).toISOString(), linked: true as const };
}

function freshPreflight(variant: OwnerWanImageVariant, status: "PAID" | "FREE" = "PAID", observedAt = NOW) {
  return {
    account: { balance: { unit: "tokens" as const, available: null },
      subscription: { active: true, plan_type: status, end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: new Date(observedAt).toISOString() },
    model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT" as const,
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: variant, ai_name: "wan_image", model_type: variant, account_read_live: true as const,
      parameter_keys: ["batch_size"], parameters_redacted: true as const, access: true,
      cost: 12, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false,
      observed_at: new Date(observedAt).toISOString() }
  };
}

function parameters(variant: OwnerWanImageVariant, batchSize: number, referenceCount: number, withBox = false): OwnerWanImageParameters {
  const resolution = variant === "wan_25_i2i_preview" ? "720P"
    : variant === "wan_26_image" ? "1080P" : "2K";
  const bbox_list = Array.from({ length: referenceCount }, (_, index) => withBox && index === 0 ? [[1, 2, 100, 200] as const] : []);
  return Object.freeze({ aspect_ratio: "1:1", resolution, batch_size: batchSize, prompt_extend: true,
    seed: null, color_palette: variant.includes("27") ? [
      Object.freeze({ hex: "#FF0000", ratio: "50.00%" }), Object.freeze({ hex: "#00FF00", ratio: "30.00%" }),
      Object.freeze({ hex: "#0000FF", ratio: "20.00%" })
    ] : null, bbox_list: Object.freeze(bbox_list) }) as OwnerWanImageParameters;
}

interface RigOptions {
  readonly preflight?: (variant: OwnerWanImageVariant, call: number) => ReturnType<typeof freshPreflight>;
  readonly preflightGate?: (variant: OwnerWanImageVariant, call: number) => Promise<void>;
  readonly generationStatus?: (attemptId: string, call: number) => unknown;
  readonly nativeClientOverride?: unknown;
  readonly failPostAck?: boolean;
  readonly partialHistoryFirst?: boolean;
  readonly maxPollAttempts?: number;
  readonly pendingFirstResult?: boolean;
  readonly afterChat?: () => void;
  readonly afterResult?: () => void;
  readonly now?: () => number;
}

function makeRig(options: RigOptions = {}) {
  const events: string[] = [];
  const counters = { uploads: 0, chats: 0, posts: 0, histories: 0, results: 0, inProgress: 0, preflights: 0 };
  const preflightInputs: unknown[] = [];
  const generated: Array<{ variant: OwnerWanImageVariant; batch: number; referenceCount: number; chatUuid: string; echoId: string; botId: string; objectIds: string[] }> = [];
  let badFirstResult = options.pendingFirstResult === true;
  let generationStatusCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-wan-generation-credential"); } },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats/upload-files") {
        counters.uploads += 1; events.push("upload");
        assert.equal(init?.method, "POST");
        const form = init?.body as FormData;
        const file = form.get("files");
        assert.ok(file instanceof File);
        return Response.json({ files: [{ id: `private-upload-id-${counters.uploads}`, url: `https://r2.syntx.ai/private/${counters.uploads}.bmp`,
          mime_type: "image/bmp", size: file.size }] });
      }
      if (url.pathname === "/api/v1/chats") {
        counters.chats += 1; events.push("chat");
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.scope, "image");
        options.afterChat?.();
        return Response.json({ uuid: `wan-chat-${counters.chats}` });
      }
      if (url.pathname === "/api/v1/design/generate") {
        counters.posts += 1; events.push("post");
        assert.equal(init?.method, "POST");
        assert.equal(url.searchParams.get("ai_name"), "wan_image");
        const body = JSON.parse(String(init?.body));
        const variant = body.settings.model_type as OwnerWanImageVariant;
        generated.push({ variant, batch: body.settings.batch_size, referenceCount: body.settings.file_urls.length,
          chatUuid: body.chat_uuid, echoId: `owner-echo-${counters.posts}`, botId: `bot-result-${counters.posts}`,
          objectIds: Array.from({ length: body.settings.batch_size }, (_, index) => `wan-object-${counters.posts}-${index + 1}`) });
        if (options.failPostAck) throw new Error("synthetic lost POST ACK");
        return Response.json({ id: `owner-echo-${counters.posts}` });
      }
      const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/(wan-chat-\d+)\/messages$/u);
      if (historyMatch) {
        counters.histories += 1; events.push("history");
        const item = generated.find((record) => record.chatUuid === historyMatch[1]);
        assert.ok(item);
        const botObjects = options.partialHistoryFirst && counters.histories === 1
          ? item.objectIds.slice(0, Math.max(1, item.batch - 1)) : item.objectIds;
        return Response.json({ messages: [
          { id: item.echoId, chat_id: 700 + counters.posts, author_id: 12345,
            message_object: Array.from({ length: item.referenceCount }, (_, index) => ({ id: `owner-object-${counters.posts}-${index + 1}`,
              message_id: item.echoId, object_type: "image", model_type: item.variant })) },
          { id: item.botId, chat_id: 700 + counters.posts, author_id: -1,
            message_object: botObjects.map((id) => ({ id, message_id: item.botId, object_type: "image", model_type: item.variant })) }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      const resultMatch = url.pathname.match(/^\/api\/v1\/chats\/(wan-chat-\d+)\/(bot-result-\d+)$/u);
      if (resultMatch) {
        counters.results += 1; events.push("result");
        const item = generated.find((record) => record.chatUuid === resultMatch[1]);
        assert.ok(item);
        if (badFirstResult) { badFirstResult = false; return Response.json({ id: item.botId, chat_id: 700 + counters.posts,
          author_id: -1, message_object: [] }); }
        options.afterResult?.();
        return Response.json({ id: item.botId, chat_id: 700 + counters.posts, author_id: -1,
          message_object: item.objectIds.map((id, index) => ({ id, message_id: item.botId, object_type: "image",
            model_type: item.variant, completed: true, object_url: `https://r2.syntx.ai/results/${item.variant}-${index + 1}.png` })) });
      }
      const progressMatch = url.pathname.match(/^\/api\/v1\/chats\/wan-chat-\d+\/inprogress$/u);
      if (progressMatch) { counters.inProgress += 1; events.push("inprogress"); return Response.json([]); }
      throw new Error(`Unexpected synthetic route ${url.pathname}`);
    }
  });
  const uploadService = new OwnerWanImageUploadService({ binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client,
    now: options.now ?? (() => NOW) });
  const serviceModulePromise = import("../src/application/owner-wan-image-generation-service.js").catch(() => null);
  const servicePromise = serviceModulePromise.then((serviceModule) => {
    assert.ok(serviceModule && typeof serviceModule.OwnerWanImageGenerationService === "function");
    return new serviceModule.OwnerWanImageGenerationService({ binding: BINDING,
      linkService: { async getStatus(_binding: unknown, attemptId: string) {
        generationStatusCalls += 1;
        return options.generationStatus?.(attemptId, generationStatusCalls) ?? linkedAttempt(attemptId);
      } } as never,
      catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService,
      resolveChatClient: () => options.nativeClientOverride ?? client,
      preflight: async (input: { variant: OwnerWanImageVariant }) => {
        counters.preflights += 1; events.push("preflight");
        preflightInputs.push(input);
        await options.preflightGate?.(input.variant, counters.preflights);
        return options.preflight?.(input.variant, counters.preflights) ?? freshPreflight(input.variant, "PAID", (options.now ?? (() => NOW))());
      },
      now: options.now ?? (() => NOW), timeoutMs: 10_000, pollDelayMs: 0, maxPollAttempts: options.maxPollAttempts ?? 1,
      wait: async () => undefined });
  });
  return { events, counters, generated, preflightInputs, uploadService, servicePromise };
}

async function uploadReferences(rig: ReturnType<typeof makeRig>, variant: OwnerWanImageVariant, count: number): Promise<string[]> {
  const handles: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const bytes = bmp24();
    const receipt = await rig.uploadService.upload({ attemptId: ATTEMPT, variant, content_base64: bytes.toString("base64"),
      filename: `owner-${index + 1}.bmp`, mime_type: "image/bmp" });
    handles.push(receipt.reference_handle);
  }
  return handles;
}

test("WAN generation service exposes its owner lifecycle API", async () => {
  const serviceModule = await import("../src/application/owner-wan-image-generation-service.js").catch(() => null);
  assert.ok(serviceModule && typeof serviceModule.OwnerWanImageGenerationService === "function");
  assert.equal(typeof serviceModule.OWNER_WAN_IMAGE_GENERATION_ERROR_CODES, "object");
  assert.equal(typeof serviceModule.OWNER_WAN_IMAGE_GENERATION_PHASES, "object");
});

test("fresh FREE preflight stops before creating a chat", async () => {
  const rig = makeRig({ preflight: (variant) => freshPreflight(variant, "FREE") });
  const service = await rig.servicePromise;
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 1, 0), prompt: "A quiet mountain lake.", bbox_coordinate_policy: null }),
      (error: { code?: string }) => error.code === "PREFLIGHT_FAILED");
    assert.equal(rig.counters.preflights, 1);
    assert.equal(rig.counters.chats, 0);
    assert.equal(rig.counters.posts, 0);
  } finally { await service.close(); }
});

test("second fresh preflight runs after chat and a denied second read prevents the generation POST", async () => {
  const rig = makeRig({ preflight: (variant, call) => freshPreflight(variant, call === 1 ? "PAID" : "FREE") });
  const service = await rig.servicePromise;
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 3, 0), prompt: "Final gate.", bbox_coordinate_policy: null }),
      (error: { code?: string }) => error.code === "PREFLIGHT_FAILED");
    assert.equal(rig.counters.preflights, 2);
    assert.equal(rig.counters.chats, 1);
    assert.equal(rig.counters.posts, 0);
    assert.deepEqual(rig.events.slice(0, 3), ["preflight", "chat", "preflight"]);
    assert.deepEqual(rig.preflightInputs.map((value) => (value as { cost_inputs: unknown }).cost_inputs),
      [{ batch_size: 3 }, { batch_size: 3 }]);
  } finally { await service.close(); }
});

test("original reference expiry after chat blocks final dispatch without renewing the handle", async () => {
  let now = NOW;
  const rig = makeRig({ now: () => now, afterChat: () => { now = NOW + 15 * 60_000 + 1; } });
  const service = await rig.servicePromise;
  try {
    const handles = await uploadReferences(rig, "wan_25_i2i_preview", 1);
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "wan_25_i2i_preview", reference_handles: handles,
      parameters: parameters("wan_25_i2i_preview", 1, 1), prompt: "Original TTL only.", bbox_coordinate_policy: null }),
      (error: { code?: string }) => error.code === "REFERENCE_EXPIRED" || error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(rig.counters.uploads, 1);
    assert.equal(rig.counters.chats, 1);
    assert.equal(rig.counters.posts, 0);
    assert.equal(rig.counters.preflights, 1);
  } finally { await service.close(); }
});

test("reference-set expiry after a complete result GET still prevents claiming completion", async () => {
  let now = NOW;
  const rig = makeRig({ now: () => now, afterResult: () => { now = NOW + 15 * 60_000 + 1; } });
  const service = await rig.servicePromise;
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 1, 0), prompt: "Late original set expiry.", bbox_coordinate_policy: null }),
      (error: { code?: string; recovery_id?: string }) => error.code === "OUTCOME_UNKNOWN" && Boolean(error.recovery_id));
    assert.equal(rig.counters.posts, 1);
    assert.equal(rig.counters.results, 1);
  } finally { await service.close(); }
});

test("final preflight is the last async admission before the exact native POST", async () => {
  const rig = makeRig();
  const service = await rig.servicePromise;
  try {
    await service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 2, 0), prompt: "Order gate.", bbox_coordinate_policy: null });
    assert.deepEqual(rig.events.slice(0, 4), ["preflight", "chat", "preflight", "post"]);
    assert.deepEqual(rig.preflightInputs.map((value) => (value as { cost_inputs: unknown }).cost_inputs),
      [{ batch_size: 2 }, { batch_size: 2 }]);
  } finally { await service.close(); }
});

test("partial WAN batch history remains pending until the exact requested object count appears", async () => {
  const rig = makeRig({ partialHistoryFirst: true, maxPollAttempts: 2 });
  const service = await rig.servicePromise;
  try {
    const result = await service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 4, 0), prompt: "Wait for all four outputs.", bbox_coordinate_policy: null });
    assert.equal(result.artifacts.length, 4);
    assert.equal(rig.counters.histories, 2);
    assert.equal(rig.counters.inProgress, 1);
    assert.equal(rig.counters.results, 1);
    assert.equal(rig.counters.posts, 1);
  } finally { await service.close(); }
});

test("an in-flight exact intent claim blocks a concurrent duplicate before preflight", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const rig = makeRig({ preflightGate: (_variant, call) => call === 1 ? held : Promise.resolve() });
  const service = await rig.servicePromise;
  const input = { attemptId: ATTEMPT, variant: "wan_27_image" as const, reference_handles: [],
    parameters: parameters("wan_27_image", 2, 0), prompt: "One exact intent.", bbox_coordinate_policy: null };
  try {
    const first = service.generate(input);
    for (let index = 0; index < 20 && rig.counters.preflights === 0; index += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rig.counters.preflights, 1);
    await assert.rejects(service.generate(input), (error: { code?: string }) => error.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(rig.counters.preflights, 1);
    release();
    const result = await first;
    assert.equal(result.artifacts.length, 2);
    assert.equal(rig.counters.posts, 1);
  } finally { release(); await service.close(); }
});

test("attempt invalidation aborts a pre-dispatch flow and prevents later POST stages", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const rig = makeRig({ preflightGate: (_variant, call) => call === 1 ? held : Promise.resolve() });
  const service = await rig.servicePromise;
  try {
    const resultPromise = service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 1, 0), prompt: "Revoke before chat.", bbox_coordinate_policy: null })
      .then((result) => ({ result }), (error: { code?: string }) => ({ error }));
    for (let index = 0; index < 20 && rig.counters.preflights === 0; index += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rig.counters.preflights, 1);
    const invalidatePromise = service.invalidateAttempt(ATTEMPT);
    release();
    const outcome = await resultPromise;
    await invalidatePromise;
    assert.ok("error" in outcome);
    assert.equal(rig.counters.posts, 0);
    assert.equal(rig.counters.results, 0);
  } finally { release(); await service.close(); }
});

test("successful observation releases its local claim instead of promising global exactly-once", async () => {
  const rig = makeRig();
  const service = await rig.servicePromise;
  const input = { attemptId: ATTEMPT, variant: "wan_27_image" as const, reference_handles: [],
    parameters: parameters("wan_27_image", 1, 0), prompt: "A genuinely separate dispatch after success.", bbox_coordinate_policy: null };
  try {
    await service.generate(input);
    await service.generate(input);
    assert.equal(rig.counters.posts, 2);
    assert.equal(rig.counters.chats, 2);
  } finally { await service.close(); }
});

test("all WAN variants and requested batches produce ordered per-artifact results", async () => {
  const rig = makeRig();
  const service = await rig.servicePromise;
  try {
    const refCounts = new Map<OwnerWanImageVariant, number>([
      ["wan_25_i2i_preview", 1], ["wan_26_image", 1], ["wan_27_image", 0], ["wan_27_image_pro", 0]
    ]);
    for (const variant of VARIANTS) {
      const count = refCounts.get(variant)!;
      const handles = await uploadReferences(rig, variant, count);
      for (const batch of [1, 2, 3, 4]) {
        const result = await service.generate({ attemptId: ATTEMPT, variant, reference_handles: handles,
          parameters: parameters(variant, batch, count), prompt: `${variant} batch ${batch}.`, bbox_coordinate_policy: null });
        assert.equal(result.status, "result_observed");
        assert.equal(result.backend_acceptance, "unproven");
        assert.equal(result.variant, variant);
        assert.equal(result.parameters.batch_size, batch);
        assert.equal(result.artifacts.length, batch);
        assert.deepEqual(result.artifacts.map((artifact) => artifact.url),
          Array.from({ length: batch }, (_, index) => `https://r2.syntx.ai/results/${variant}-${index + 1}.png`));
        assert.ok(result.artifacts.every((artifact) => artifact.width === null && artifact.height === null && artifact.geometry_verified === false));
      }
    }
    assert.equal(rig.counters.posts, 16);
    assert.equal(rig.counters.preflights, 32);
  } finally { await service.close(); }
});

test("nine ordered references, explicit bbox projection policy, and public metadata stay scoped", async () => {
  const rig = makeRig();
  const service = await rig.servicePromise;
  try {
    const handles = await uploadReferences(rig, "wan_27_image_pro", 9);
    const result = await service.generate({ attemptId: ATTEMPT, variant: "wan_27_image_pro", reference_handles: handles,
      parameters: parameters("wan_27_image_pro", 4, 9, true), prompt: "Private prompt sentinel.",
      bbox_coordinate_policy: "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" });
    assert.equal(result.artifacts.length, 4);
    assert.equal(result.reference_count, 9);
    assert.deepEqual(Object.keys(result.input_images[0]!), ["mime_type", "width", "height", "size", "sha256", "metadata_confidence"]);
    assert.equal(JSON.stringify(result).includes("wan_image_"), false);
    assert.equal(JSON.stringify(result).includes("r2.syntx.ai/private/"), false);
    assert.equal(JSON.stringify(result).includes("private-upload-id"), false);
    assert.equal(JSON.stringify(result).includes("owner-1.bmp"), false);
    assert.equal(JSON.stringify(result).includes("Private prompt sentinel."), false);
    assert.equal(result.parameters.color_palette?.length, 3);
    assert.equal(rig.counters.posts, 1);
  } finally { await service.close(); }
});

test("maximum source reference counts remain distinct across the four WAN variants", async () => {
  const rig = makeRig();
  const service = await rig.servicePromise;
  const expected = [["wan_25_i2i_preview", 3], ["wan_26_image", 4], ["wan_27_image", 9], ["wan_27_image_pro", 9]] as const;
  try {
    for (const [variant, count] of expected) {
      const handles = await uploadReferences(rig, variant, count);
      const withBox = variant === "wan_27_image" || variant === "wan_27_image_pro";
      const result = await service.generate({ attemptId: ATTEMPT, variant, reference_handles: handles,
        parameters: parameters(variant, 1, count, withBox), prompt: `${variant} maximum references.`,
        bbox_coordinate_policy: withBox ? "LOCAL_HEADER_ORIENTATION_PROJECTION_UNVERIFIED_BROWSER" : null });
      assert.equal(result.reference_count, count);
      assert.equal(result.input_images.length, count);
      assert.equal(rig.generated.at(-1)?.referenceCount, count);
    }
    assert.deepEqual(rig.generated.map((item) => item.referenceCount), [3, 4, 9, 9]);
  } finally { await service.close(); }
});

test("strict top-level input rejects accessors without invoking them or mutating a chat", async () => {
  const rig = makeRig();
  const service = await rig.servicePromise;
  let getterRead = false;
  const input = Object.defineProperties({}, {
    attemptId: { value: ATTEMPT, enumerable: true }, variant: { value: "wan_27_image", enumerable: true },
    reference_handles: { get() { getterRead = true; return []; }, enumerable: true },
    parameters: { value: parameters("wan_27_image", 1, 0), enumerable: true },
    prompt: { value: "No getter execution.", enumerable: true }, bbox_coordinate_policy: { value: null, enumerable: true }
  });
  try {
    assert.throws(() => service.generate(input), (error: { code?: string }) => error.code === "INVALID_REQUEST");
    assert.equal(getterRead, false);
    assert.equal(rig.counters.chats, 0);
    assert.equal(rig.counters.posts, 0);
  } finally { await service.close(); }
});

test("generation rejects a forged native-client port before any chat or preflight", async () => {
  const forged = { async createChat() { return { chat_uuid: "forged-chat" }; },
    async startWanImageWithOwnedCandidate() { return { chat_uuid: "forged-chat", message_id: "forged-ack" }; },
    async listMessageCandidates() { return {}; }, async listInProgress() { return []; }, async getWanImageResult() { return {}; } };
  const rig = makeRig({ nativeClientOverride: forged });
  const service = await rig.servicePromise;
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 1, 0), prompt: "No forged clients.", bbox_coordinate_policy: null }),
      (error: { code?: string }) => error.code === "MODEL_BINDING_MISMATCH");
    assert.equal(rig.counters.preflights, 0);
    assert.equal(rig.counters.chats, 0);
    assert.equal(rig.counters.posts, 0);
  } finally { await service.close(); }
});

test("a principal change observed after the final result GET keeps completion unknown", async () => {
  const rig = makeRig({ generationStatus: (attemptId, call) => {
    const linked = linkedAttempt(attemptId);
    return call < 6 ? linked : { ...linked, status: "REVOKED", linked: false };
  } });
  const service = await rig.servicePromise;
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 1, 0), prompt: "late principal check", bbox_coordinate_policy: null }),
      (error: { code?: string; recovery_id?: string }) => error.code === "OUTCOME_UNKNOWN" && Boolean(error.recovery_id));
    assert.equal(rig.counters.posts, 1);
    assert.equal(rig.counters.results, 1);
  } finally { await service.close(); }
});

test("unknown result recovery remains GET-only and omits prompt and palette", async () => {
  const rig = makeRig({ pendingFirstResult: true });
  const service = await rig.servicePromise;
  try {
    const input = { attemptId: ATTEMPT, variant: "wan_27_image" as const, reference_handles: [],
      parameters: parameters("wan_27_image", 1, 0), prompt: "Recovery prompt sentinel.", bbox_coordinate_policy: null };
    let recoveryId = "";
    await assert.rejects(service.generate(input), (error: { code?: string; recovery_id?: string }) => {
      recoveryId = error.recovery_id ?? "";
      return error.code === "OUTCOME_UNKNOWN" && recoveryId.startsWith("wan_image_recovery_");
    });
    const before = { chats: rig.counters.chats, posts: rig.counters.posts };
    const summaries = await service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(summaries.length, 1);
    assert.equal(JSON.stringify(summaries).includes("Recovery prompt sentinel."), false);
    assert.equal(JSON.stringify(summaries).includes("color_palette"), false);
    const result = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.artifacts.length, 1);
    assert.deepEqual({ chats: rig.counters.chats, posts: rig.counters.posts }, before);
  } finally { await service.close(); }
});

test("lost generation POST ACK creates a handle but never replays or guesses a history GET", async () => {
  const rig = makeRig({ failPostAck: true });
  const service = await rig.servicePromise;
  try {
    let recoveryId = "";
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "wan_27_image", reference_handles: [],
      parameters: parameters("wan_27_image", 1, 0), prompt: "Unknown ACK case.", bbox_coordinate_policy: null }),
      (error: { code?: string; recovery_id?: string }) => {
        recoveryId = error.recovery_id ?? "";
        return error.code === "OUTCOME_UNKNOWN" && recoveryId.startsWith("wan_image_recovery_");
      });
    const before = { posts: rig.counters.posts, histories: rig.counters.histories, results: rig.counters.results };
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: { code?: string; recovery_id?: string }) => error.code === "OUTCOME_UNKNOWN" && error.recovery_id === recoveryId);
    assert.deepEqual({ posts: rig.counters.posts, histories: rig.counters.histories, results: rig.counters.results }, before);
  } finally { await service.close(); }
});
