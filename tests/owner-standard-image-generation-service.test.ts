import assert from "node:assert/strict";
import test from "node:test";
import { OwnerStandardImageGenerationService } from "../src/application/owner-standard-image-generation-service.js";
import { OwnerStandardImageUploadService } from "../src/application/owner-standard-image-upload-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const NOW = Date.now();
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const BINDING = Object.freeze({ tenant_id: "standard-image-service-tenant", subject: "standard-image-service-subject" });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;

const CASES = [
  { variant: "banana", parameters: { aspect_ratio: null, image_size: null, thinking_level: null }, costKeys: [] },
  { variant: "banana-2.1", parameters: { aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal" }, costKeys: ["image_size"] },
  { variant: "banana2", parameters: { aspect_ratio: "1:1", image_size: "1K", thinking_level: null }, costKeys: ["image_size"] },
  { variant: "banana3", parameters: { aspect_ratio: "1:1", image_size: "2K", thinking_level: null }, costKeys: ["image_size"] },
  { variant: "banana3_light", parameters: { aspect_ratio: "1:1", image_size: "1K", thinking_level: null }, costKeys: ["image_size"] },
  { variant: "gpt-image-1", parameters: { aspect_ratio: "1:1", quality: null, details_quality: null }, costKeys: [] },
  { variant: "gpt-image-1.5", parameters: { aspect_ratio: "3:2", quality: null, details_quality: null }, costKeys: [] },
  { variant: "gpt-image-2", parameters: { aspect_ratio: "1:1", quality: "2K", details_quality: "high" }, costKeys: ["details_quality", "quality"] },
  { variant: "gpt-image-2.5-flare", parameters: { aspect_ratio: "1:1", quality: "1K", details_quality: "xhigh" }, costKeys: ["details_quality", "quality"] },
  { variant: "gpt-image-2.5-sunburst", parameters: { aspect_ratio: "21:9", quality: "4K", details_quality: "max" }, costKeys: ["details_quality", "quality"] }
] as const;

async function waitForBarrier(barrier: Promise<void>, label: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([barrier, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 10_000);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function attempt(index: number): string { return `link_standard_image_generation_${String(index).padStart(12, "0")}`; }

function u32(value: number): Buffer { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(value); return bytes; }
function box(type: string, payload: Uint8Array): Buffer {
  return Buffer.concat([u32(payload.byteLength + 8), Buffer.from(type, "ascii"), Buffer.from(payload)]);
}
function pngWithWidth(width: number): Buffer {
  const bytes = Buffer.from(PNG_1X1, "base64");
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(1, 20);
  let crc = 0xffffffff;
  for (const byte of bytes.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  return bytes;
}
function tinyMp4(marker: number): Buffer {
  const fileType = box("ftyp", Buffer.concat([Buffer.from("isom", "ascii"), u32(0), Buffer.from("isom", "ascii")]));
  return Buffer.concat([fileType, box("mdat", Buffer.from([marker])), box("moov", Buffer.alloc(0))]);
}
function tinyPdf(marker: number): Buffer {
  return Buffer.from(`%PDF-1.7\n% reference ${marker}\n1 0 obj\n<<>>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n30\n%%EOF\n`, "ascii");
}

function freshPreflight(input: Record<string, unknown>, now: number = NOW, changes: {
  readonly active?: boolean;
  readonly planType?: string | null;
  readonly access?: boolean | null;
  readonly cost?: number | null;
  readonly observedAt?: number;
  readonly parameterKeys?: readonly string[];
  readonly endDate?: string | null;
  readonly endDateKind?: "DATE_ONLY" | "LOCAL_DATETIME" | "OFFSET_DATETIME" | null;
} = {}) {
  const variant = input.variant as string;
  return {
    account: { balance: { unit: "tokens", available: null },
      subscription: { active: changes.active ?? true, plan_type: changes.planType ?? "FREE",
        end_date: changes.endDate ?? null, end_date_kind: changes.endDateKind ?? null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: new Date(changes.observedAt ?? now).toISOString() },
    model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: variant, ai_name: variant.startsWith("banana") ? "banana" : "sora-images", model_type: variant,
      account_read_live: true, parameter_keys: [...(changes.parameterKeys ?? Object.keys(input.cost_inputs as object).sort())],
      parameters_redacted: true, access: changes.access ?? true, cost: changes.cost ?? 0,
      discount_cost: null, free_remaining_generations: 1, limit: null, show_warning: false,
      observed_at: new Date(changes.observedAt ?? now).toISOString() }
  };
}

function makeRig(options: {
  readonly preflightResult?: (input: Record<string, unknown>, call: number) => unknown;
  readonly failPostAck?: boolean;
  readonly pendingFirstResult?: boolean;
  readonly wrongResultObjectId?: boolean;
  readonly unknownResultMime?: boolean;
  readonly postGate?: (signal: AbortSignal | undefined) => Promise<void>;
  readonly now?: () => number;
  readonly linkStatus?: (attemptId: string, events: readonly string[]) => unknown;
} = {}) {
  const events: string[] = [];
  const preflightInputs: Array<Record<string, unknown>> = [];
  let chats = 0;
  let posts = 0;
  let histories = 0;
  let results = 0;
  let uploads = 0;
  const generated = new Map<string, { readonly echoId: string; readonly botId: string; readonly objectId: string;
    readonly variant: string; readonly referenceKinds: readonly string[] }>();
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-standard-image-generation-credential");
    } },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats/upload-files") {
        uploads += 1; events.push("upload");
        const form = init?.body as FormData;
        const file = form.get("files");
        assert.ok(file instanceof File);
        return Response.json({ files: [{ id: `private-standard-upload-${uploads}`,
          url: `https://r2.syntx.ai/standard-upload/${uploads}`, mime_type: file.type, size: file.size }] });
      }
      if (url.pathname === "/api/v1/chats") {
        chats += 1; events.push("chat");
        assert.equal(init?.method, "POST");
        assert.equal(JSON.parse(String(init?.body)).scope, "image");
        return Response.json({ uuid: `standard-chat-${chats}` });
      }
      if (url.pathname === "/api/v1/design/generate") {
        posts += 1; events.push("post");
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body));
        const variant = body.settings.model_type as string;
        assert.equal(url.searchParams.get("ai_name"), variant.startsWith("banana") ? "banana" : "sora-images");
        assert.equal(body.settings.n, 1);
        assert.equal(Array.isArray(body.settings.file_urls), true);
        const echoId = `owner-echo-${posts}`;
        generated.set(body.chat_uuid, { echoId, botId: `bot-result-${posts}`, objectId: `image-object-${posts}`, variant,
          referenceKinds: body.settings.file_urls.map((reference: { type: string }) => reference.type) });
        if (options.postGate) await options.postGate(init?.signal as AbortSignal | undefined);
        if (options.failPostAck) throw new Error("synthetic lost POST acknowledgement");
        return Response.json({ id: echoId });
      }
      const history = url.pathname.match(/^\/api\/v1\/chats\/(standard-chat-\d+)\/messages$/u);
      if (history) {
        assert.equal(init?.method ?? "GET", "GET");
        histories += 1; events.push("history");
        const item = generated.get(history[1]!);
        assert.ok(item);
        return Response.json({ messages: [
          { id: item.echoId, chat_id: 700 + histories, author_id: 12345,
            message_object: [...item.referenceKinds.map((kind, index) => ({ id: `owner-reference-${histories}-${index + 1}`,
              message_id: item.echoId, object_type: kind, model_type: item.variant })),
              { id: `text-object-${histories}`, message_id: item.echoId, object_type: "text", model_type: item.variant }] },
          { id: item.botId, chat_id: 700 + histories, author_id: -1,
            message_object: [{ id: item.objectId, message_id: item.botId, object_type: "image", model_type: item.variant }] }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      const result = url.pathname.match(/^\/api\/v1\/chats\/(standard-chat-\d+)\/(bot-result-\d+)$/u);
      if (result) {
        assert.equal(init?.method ?? "GET", "GET");
        results += 1; events.push("result");
        const item = generated.get(result[1]!);
        assert.ok(item);
        if (options.pendingFirstResult && results === 1) return Response.json({ id: item.botId, chat_id: 700 + posts, author_id: -1,
          message_object: [{ id: item.objectId, message_id: item.botId, object_type: "image", model_type: item.variant,
            completed: false, object_url: `https://r2.syntx.ai/standard-results/${item.variant}.png` }] });
        return Response.json({ id: item.botId, chat_id: 700 + posts, author_id: -1,
          message_object: [{ id: options.wrongResultObjectId ? "other-image-object" : item.objectId, message_id: item.botId, object_type: "image", model_type: item.variant,
            completed: true, object_url: `https://r2.syntx.ai/standard-results/${item.variant}.${options.unknownResultMime ? "unknown" : "png"}` }] });
      }
      if (/^\/api\/v1\/chats\/standard-chat-\d+\/inprogress$/u.test(url.pathname)) {
        events.push("inprogress"); return Response.json([]);
      }
      throw new Error(`Unexpected synthetic route ${url.pathname}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    const override = options.linkStatus?.(attemptId, events);
    if (override !== undefined) return override;
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED",
      expires_at: new Date((options.now ?? (() => NOW))() + 60 * 60_000).toISOString(), linked: true };
  } } as never;
  const uploadService = new OwnerStandardImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: options.now ?? (() => NOW) });
  const service = new OwnerStandardImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input: Record<string, unknown>) => {
      const call = preflightInputs.length + 1;
      preflightInputs.push(input);
      events.push("preflight");
      if (options.preflightResult) return options.preflightResult(input, call);
      return freshPreflight(input, (options.now ?? (() => NOW))());
    }, now: options.now ?? (() => NOW), timeoutMs: 5_000, pollDelayMs: 0, maxPollAttempts: 1, wait: async () => undefined });
  return { service, uploadService, client, events, preflightInputs, counters: () => ({ uploads, chats, posts, histories, results }) };
}

test("full standard image generation exposes the frozen lifecycle contract", async () => {
  const serviceModule = await import("../src/application/owner-standard-image-generation-service.js").catch(() => null);
  assert.ok(serviceModule && typeof serviceModule.OwnerStandardImageGenerationService === "function");
  for (const method of ["generate", "reconcile", "listRecoveries", "invalidateAttempt", "close"]) {
    assert.equal(typeof serviceModule.OwnerStandardImageGenerationService.prototype[method as keyof typeof serviceModule.OwnerStandardImageGenerationService.prototype], "function");
  }
  assert.deepEqual(serviceModule.OWNER_STANDARD_IMAGE_GENERATION_PHASES, [
    "REQUEST_PREPARE", "PRINCIPAL", "REFERENCE_BINDING", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST",
    "POST_ACK_KNOWN", "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
  ]);
  assert.deepEqual(serviceModule.OWNER_STANDARD_IMAGE_GENERATION_ERROR_CODES, [
    "INVALID_REQUEST", "SERVICE_CLOSED", "SERVICE_BUSY", "PRINCIPAL_NOT_LINKED", "MODEL_BINDING_MISMATCH",
    "REFERENCE_UNAVAILABLE", "REFERENCE_EXPIRED", "REFERENCE_ALREADY_CLAIMED", "PREFLIGHT_FAILED",
    "PRE_DISPATCH_FAILED", "OUTCOME_UNKNOWN", "RECOVERY_NOT_FOUND"
  ]);
  assert.deepEqual(serviceModule.OWNER_STANDARD_IMAGE_GENERATION_RESULT_REASONS, [
    "NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
    "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID",
    "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE",
    "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"
  ]);
  assert.deepEqual(serviceModule.OWNER_STANDARD_IMAGE_GENERATION_HISTORY_REASONS, [
    "INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
    "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
    "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
    "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS",
    "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"
  ]);
  for (const value of [serviceModule.OWNER_STANDARD_IMAGE_GENERATION_PHASES, serviceModule.OWNER_STANDARD_IMAGE_GENERATION_ERROR_CODES,
    serviceModule.OWNER_STANDARD_IMAGE_GENERATION_RESULT_REASONS, serviceModule.OWNER_STANDARD_IMAGE_GENERATION_HISTORY_REASONS]) {
    assert.equal(Object.isFrozen(value), true);
    assert.equal(new Set(value).size, value.length);
  }
});

test("generates each of the ten admitted models with the complete requested parameters and exact cost keys", async () => {
  const rig = makeRig();
  try {
    for (let index = 0; index < CASES.length; index += 1) {
      const item = CASES[index]!;
      const prompt = `Source-bound request ${item.variant}`;
      const result = await rig.service.generate({ attemptId: attempt(index + 1), variant: item.variant,
        reference_handles: [], parameters: item.parameters, prompt });
      assert.equal(result.status, "result_observed");
      assert.equal(result.backend_acceptance, "unproven");
      assert.equal(result.variant, item.variant);
      assert.equal(result.ai_name, item.variant.startsWith("banana") ? "banana" : "sora-images");
      assert.deepEqual(result.parameters, item.parameters);
      assert.deepEqual(Object.keys(result.cost_inputs).sort(), item.costKeys);
      assert.equal(result.reference_count, 0);
      assert.equal(result.total_reference_count, 0);
      assert.deepEqual(result.counts_by_kind, { image: 0, video: 0, file: 0 });
      assert.deepEqual(result.input_references, []);
      assert.deepEqual(result.actual_image, { mime_type: "image/png", width: null, height: null });
      assert.deepEqual(result.artifact, { url: `https://r2.syntx.ai/standard-results/${item.variant}.png`,
        mime_type: "image/png", mime_source: "URL_EXTENSION", width: null, height: null, geometry_verified: false });
      assert.equal(result.geometry_verified, false);
    }
    assert.equal(rig.preflightInputs.length, CASES.length * 2);
    for (let index = 0; index < CASES.length; index += 1) {
      const item = CASES[index]!;
      assert.deepEqual(Object.keys(rig.preflightInputs[index * 2]!.cost_inputs as object).sort(), item.costKeys);
      assert.deepEqual(Object.keys(rig.preflightInputs[index * 2 + 1]!.cost_inputs as object).sort(), item.costKeys);
    }
    let cursor = 0;
    for (let index = 0; index < CASES.length; index += 1) {
      const firstPreflight = rig.events.indexOf("preflight", cursor);
      const chat = rig.events.indexOf("chat", firstPreflight + 1);
      const finalPreflight = rig.events.indexOf("preflight", chat + 1);
      const post = rig.events.indexOf("post", finalPreflight + 1);
      assert.ok(firstPreflight >= cursor && chat > firstPreflight && finalPreflight > chat && post > finalPreflight);
      assert.equal(rig.events[post - 1], "preflight");
      cursor = rig.events.indexOf("result", post) + 1;
    }
    assert.deepEqual(rig.counters(), { uploads: 0, chats: CASES.length, posts: CASES.length, histories: CASES.length, results: CASES.length });
  } finally {
    await rig.service.close();
  }
});

test("fresh model access denial is rejected before chat creation", async () => {
  const rig = makeRig({ preflightResult: (input) => freshPreflight(input, NOW, { access: false }) });
  try {
    await assert.rejects(rig.service.generate({ attemptId: attempt(20), variant: "banana", reference_handles: [],
      parameters: CASES[0]!.parameters, prompt: "No dispatch when access is denied." }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "PREFLIGHT_FAILED");
    assert.deepEqual(rig.counters(), { uploads: 0, chats: 0, posts: 0, histories: 0, results: 0 });
    assert.equal(rig.preflightInputs.length, 1);
  } finally { await rig.service.close(); }
});

test("final fresh preflight runs after chat and blocks the fixed POST when access turns off", async () => {
  const rig = makeRig({ preflightResult: (input, call) => freshPreflight(input, NOW, { access: call === 1 }) });
  try {
    await assert.rejects(rig.service.generate({ attemptId: attempt(21), variant: "gpt-image-1", reference_handles: [],
      parameters: CASES[5]!.parameters, prompt: "Final access must still be current." }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "PREFLIGHT_FAILED");
    assert.deepEqual(rig.counters(), { uploads: 0, chats: 1, posts: 0, histories: 0, results: 0 });
    assert.deepEqual(rig.events, ["preflight", "chat", "preflight"]);
  } finally { await rig.service.close(); }
});

test("exact source cost-key mismatch fails before creating a chat", async () => {
  const rig = makeRig({ preflightResult: (input) => freshPreflight(input, NOW, { parameterKeys: [] }) });
  try {
    await assert.rejects(rig.service.generate({ attemptId: attempt(33), variant: "banana3", reference_handles: [],
      parameters: CASES[3]!.parameters, prompt: "Cost preflight keys must match the source profile." }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "PREFLIGHT_FAILED");
    assert.deepEqual(rig.counters(), { uploads: 0, chats: 0, posts: 0, histories: 0, results: 0 });
  } finally { await rig.service.close(); }
});

test("a backwards clock observed at the final admission gate fails before POST", async () => {
  let now = NOW;
  const rig = makeRig({ now: () => now, preflightResult: (input, call) => {
    if (call === 2) now = NOW - 1;
    return freshPreflight(input, NOW);
  } });
  try {
    await assert.rejects(rig.service.generate({ attemptId: attempt(35), variant: "banana", reference_handles: [],
      parameters: CASES[0]!.parameters, prompt: "A backward monotonic clock must fail closed." }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "PRE_DISPATCH_FAILED");
    assert.deepEqual(rig.counters(), { uploads: 0, chats: 1, posts: 0, histories: 0, results: 0 });
  } finally { await rig.service.close(); }
});

test("a link revoked after chat creation is detected before the final preflight and POST", async () => {
  const rig = makeRig({ linkStatus: (attemptId, events) => events.includes("chat")
    ? { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "REVOKED",
      expires_at: new Date(NOW + 60 * 60_000).toISOString(), linked: false }
    : undefined });
  try {
    await assert.rejects(rig.service.generate({ attemptId: attempt(34), variant: "banana", reference_handles: [],
      parameters: CASES[0]!.parameters, prompt: "Recheck the exact linked attempt after chat." }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "PRINCIPAL_NOT_LINKED");
    assert.deepEqual(rig.counters(), { uploads: 0, chats: 1, posts: 0, histories: 0, results: 0 });
    assert.deepEqual(rig.events, ["preflight", "chat"]);
  } finally { await rig.service.close(); }
});

test("an inactive historical subscription is rejected while a current active date-only plan is not expired locally", async () => {
  const expiredRig = makeRig({ preflightResult: (input) => freshPreflight(input, NOW, {
    active: false, planType: "PAID", endDate: "2026-10-11", endDateKind: "DATE_ONLY"
  }) });
  try {
    await assert.rejects(expiredRig.service.generate({ attemptId: attempt(22), variant: "banana", reference_handles: [],
      parameters: CASES[0]!.parameters, prompt: "Inactive current plan." }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "PREFLIGHT_FAILED");
    assert.equal(expiredRig.counters().chats, 0);
  } finally { await expiredRig.service.close(); }

  const activeRig = makeRig({ preflightResult: (input) => freshPreflight(input, NOW, {
    active: true, planType: "FREE", endDate: "2020-01-01", endDateKind: "DATE_ONLY"
  }) });
  try {
    const result = await activeRig.service.generate({ attemptId: attempt(23), variant: "banana", reference_handles: [],
      parameters: CASES[0]!.parameters, prompt: "Current active UI plan state is authoritative." });
    assert.equal(result.status, "result_observed");
    assert.equal(activeRig.counters().posts, 1);
  } finally { await activeRig.service.close(); }
});

test("a contradictory past explicit-offset subscription expiry blocks the POST", async () => {
  const rig = makeRig({ preflightResult: (input) => freshPreflight(input, NOW, {
    active: true, planType: "PAID", endDate: "2026-10-10T11:59:59.000Z", endDateKind: "OFFSET_DATETIME"
  }) });
  try {
    await assert.rejects(rig.service.generate({ attemptId: attempt(24), variant: "banana", reference_handles: [],
      parameters: CASES[0]!.parameters, prompt: "Contradictory explicit expiry." }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "PREFLIGHT_FAILED");
    assert.deepEqual(rig.counters(), { uploads: 0, chats: 0, posts: 0, histories: 0, results: 0 });
  } finally { await rig.service.close(); }
});

test("an unknown POST keeps the semantic intent tombstone across relink and fresh owned-handle upload", async () => {
  const rig = makeRig({ failPostAck: true });
  const firstAttempt = attempt(25);
  const secondAttempt = attempt(26);
  const parameters = { aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal" } as const;
  const prompt = "Same bytes and semantic intent after relink.";
  try {
    const firstUpload = await rig.uploadService.upload({ attemptId: firstAttempt, variant: "banana-2.1",
      content_base64: PNG_1X1, filename: "first.png", mime_type: "image/png" });
    let recoveryId = "";
    await assert.rejects(rig.service.generate({ attemptId: firstAttempt, variant: "banana-2.1",
      reference_handles: [firstUpload.reference_handle], parameters, prompt }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, "OUTCOME_UNKNOWN");
      recoveryId = (error as { recovery_id?: string }).recovery_id ?? "";
      assert.equal((error as { diagnostic?: { echo_ack_known?: boolean } }).diagnostic?.echo_ack_known, false);
      return recoveryId.startsWith("standard_image_recovery_");
    });
    await rig.service.invalidateAttempt(firstAttempt);
    await assert.rejects(rig.service.reconcile({ attemptId: firstAttempt, recovery_id: recoveryId }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "RECOVERY_NOT_FOUND");

    const secondUpload = await rig.uploadService.upload({ attemptId: secondAttempt, variant: "banana-2.1",
      content_base64: PNG_1X1, filename: "second.png", mime_type: "image/png" });
    assert.notEqual(secondUpload.reference_handle, firstUpload.reference_handle);
    assert.notEqual(rig.events.find((event) => event === "upload"), undefined);
    await assert.rejects(rig.service.generate({ attemptId: secondAttempt, variant: "banana-2.1",
      reference_handles: [secondUpload.reference_handle], parameters, prompt }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "REFERENCE_ALREADY_CLAIMED");
    assert.deepEqual(rig.counters(), { uploads: 2, chats: 1, posts: 1, histories: 0, results: 0 });
  } finally { await rig.service.close(); }
});

test("reconcile is GET-only, preserves exact history lineage, and releases a claim after result observation", async () => {
  const rig = makeRig({ pendingFirstResult: true });
  const request = { attemptId: attempt(27), variant: "gpt-image-2.5-flare" as const, reference_handles: [],
    parameters: CASES[8]!.parameters, prompt: "Reconcile the exact generated message." };
  try {
    let recoveryId = "";
    await assert.rejects(rig.service.generate(request), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, "OUTCOME_UNKNOWN");
      recoveryId = (error as { recovery_id?: string }).recovery_id ?? "";
      assert.equal((error as { diagnostic?: { echo_ack_known?: boolean; result_status?: string } }).diagnostic?.echo_ack_known, true);
      assert.equal((error as { diagnostic?: { result_status?: string } }).diagnostic?.result_status, "PENDING");
      return recoveryId.startsWith("standard_image_recovery_");
    });
    const listed = await rig.service.listRecoveries({ attemptId: request.attemptId });
    assert.equal(listed.length, 1);
    assert.deepEqual(Object.keys(listed[0]!).sort(), ["created_at", "diagnostic", "model_id", "operation_id", "recovery_id", "status"]);
    const before = rig.counters();
    const result = await rig.service.reconcile({ attemptId: request.attemptId, recovery_id: recoveryId });
    assert.equal(result.variant, request.variant);
    assert.deepEqual(rig.counters(), { uploads: 0, chats: before.chats, posts: before.posts,
      histories: before.histories, results: before.results + 1 });
    assert.equal(rig.counters().posts, 1);
    assert.equal(rig.counters().histories, 1);
    assert.equal((await rig.service.listRecoveries({ attemptId: request.attemptId })).length, 0);

    const next = await rig.service.generate(request);
    assert.equal(next.variant, request.variant);
    assert.equal(rig.counters().posts, 2);
  } finally { await rig.service.close(); }
});

test("expired source still blocks new GEN but a known Standard Image ACK recovers by GET after 16 minutes", async () => {
  let now = NOW;
  const rig = makeRig({ pendingFirstResult: true, now: () => now });
  const attemptId = attempt(37);
  const parameters = CASES[1]!.parameters;
  const uploaded = await rig.uploadService.upload({ attemptId, variant: "banana-2.1", content_base64: PNG_1X1,
    filename: "standard-long-job.png", mime_type: "image/png" });
  const request = { attemptId, variant: "banana-2.1" as const, reference_handles: [uploaded.reference_handle],
    parameters, prompt: "Pending known-ACK result after source expiry." };
  try {
    let recoveryId = "";
    await assert.rejects(rig.service.generate(request), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, "OUTCOME_UNKNOWN");
      assert.equal((error as { diagnostic?: { echo_ack_known?: boolean; result_status?: string } }).diagnostic?.echo_ack_known, true);
      assert.equal((error as { diagnostic?: { result_status?: string } }).diagnostic?.result_status, "PENDING");
      recoveryId = (error as { recovery_id?: string }).recovery_id ?? "";
      return recoveryId.startsWith("standard_image_recovery_");
    });
    const before = rig.counters();
    now += 16 * 60_000;
    await assert.rejects(rig.service.generate({ ...request, prompt: "A new GEN must not revive an expired source." }),
      (error: unknown) => error instanceof Error && ["REFERENCE_EXPIRED", "REFERENCE_UNAVAILABLE"].includes((error as { code?: string }).code ?? ""));
    assert.deepEqual(rig.counters(), before);

    const eventCount = rig.events.length;
    const result = await rig.service.reconcile({ attemptId, recovery_id: recoveryId });
    assert.equal(result.variant, request.variant);
    assert.deepEqual(rig.counters(), { uploads: before.uploads, chats: before.chats, posts: before.posts,
      histories: before.histories, results: before.results + 1 });
    assert.deepEqual(rig.events.slice(eventCount), ["result"]);
  } finally { await rig.service.close(); }
});

test("lost-ACK recovery stays held beyond input TTL but cannot make a native GET without its echo", async () => {
  let now = NOW;
  const rig = makeRig({ failPostAck: true, now: () => now });
  const attemptId = attempt(28);
  const parameters = { aspect_ratio: "1:1", image_size: "1K", thinking_level: "minimal" } as const;
  const prompt = "Private recovery expires but unknown paid intent does not.";
  try {
    const firstUpload = await rig.uploadService.upload({ attemptId, variant: "banana-2.1", content_base64: PNG_1X1,
      filename: "first.png", mime_type: "image/png" });
    await assert.rejects(rig.service.generate({ attemptId, variant: "banana-2.1", reference_handles: [firstUpload.reference_handle],
      parameters, prompt }), (error: unknown) => error instanceof Error && (error as { code?: string }).code === "OUTCOME_UNKNOWN");
    assert.equal((await rig.service.listRecoveries({ attemptId })).length, 1);
    now += 16 * 60_000;
    const listedAfterExpiry = await rig.service.listRecoveries({ attemptId });
    assert.equal(listedAfterExpiry.length, 1);
    const beforeReconcile = rig.counters();
    await assert.rejects(rig.service.reconcile({ attemptId, recovery_id: listedAfterExpiry[0]!.recovery_id }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "OUTCOME_UNKNOWN");
    assert.deepEqual(rig.counters(), beforeReconcile);
    const secondUpload = await rig.uploadService.upload({ attemptId, variant: "banana-2.1", content_base64: PNG_1X1,
      filename: "second.png", mime_type: "image/png" });
    assert.notEqual(secondUpload.reference_handle, firstUpload.reference_handle);
    await assert.rejects(rig.service.generate({ attemptId, variant: "banana-2.1", reference_handles: [secondUpload.reference_handle],
      parameters, prompt }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, "REFERENCE_ALREADY_CLAIMED");
      return true;
    });
    assert.deepEqual(rig.counters(), { uploads: 2, chats: 1, posts: 1, histories: 0, results: 0 });
  } finally { await rig.service.close(); }
});

test("unknown recovery capacity is bounded at 128 and the next distinct intent is rejected before chat", async () => {
  const rig = makeRig({ failPostAck: true });
  const shared = { attemptId: attempt(29), variant: "banana" as const, reference_handles: [], parameters: CASES[0]!.parameters };
  try {
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(rig.service.generate({ ...shared, prompt: `Unique bounded intent ${index}` }), (error: unknown) =>
        error instanceof Error && (error as { code?: string }).code === "OUTCOME_UNKNOWN");
    }
    await assert.rejects(rig.service.generate({ ...shared, prompt: "129th intent" }), (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "SERVICE_BUSY");
    assert.equal(rig.counters().chats, 128);
    assert.equal(rig.counters().posts, 128);
  } finally { await rig.service.close(); }
});

test("a Banana 2.1 result preserves the ordered 34-reference image/video/PDF mix without leaking owned URLs", async () => {
  const rig = makeRig();
  const handles: string[] = [];
  try {
    const sources = [
      ...Array.from({ length: 14 }, (_, index) => ({ bytes: pngWithWidth(index + 1),
        filename: `image-${index + 1}.png`, mime_type: "image/png" })),
      ...Array.from({ length: 10 }, (_, index) => ({ bytes: tinyMp4(index + 1), filename: `video-${index + 1}.mp4`, mime_type: "video/mp4" })),
      ...Array.from({ length: 10 }, (_, index) => ({ bytes: tinyPdf(index + 1), filename: `document-${index + 1}.pdf`, mime_type: "application/pdf" }))
    ];
    for (const source of sources) {
      const uploaded = await rig.uploadService.upload({ attemptId: attempt(31), variant: "banana-2.1",
        content_base64: source.bytes.toString("base64"), filename: source.filename, mime_type: source.mime_type });
      handles.push(uploaded.reference_handle);
    }
    assert.equal(handles.length, 34);
    let result;
    try {
      result = await rig.service.generate({ attemptId: attempt(31), variant: "banana-2.1", reference_handles: handles,
        parameters: { aspect_ratio: "16:9", image_size: "2K", thinking_level: "high" }, prompt: "Use every owned reference in order." });
    } catch (error) {
      assert.fail(`generation failed after uploads=${rig.counters().uploads} posts=${rig.counters().posts} events=${rig.events.join(",")} code=${(error as { code?: string }).code}`);
    }
    assert.equal(result.reference_count, 14);
    assert.equal(result.total_reference_count, 34);
    assert.deepEqual(result.counts_by_kind, { image: 14, video: 10, file: 10 });
    assert.deepEqual(result.input_references.map((reference) => reference.kind), [
      ...Array.from({ length: 14 }, () => "image"), ...Array.from({ length: 10 }, () => "video"), ...Array.from({ length: 10 }, () => "file")
    ]);
    assert.ok(result.input_references.every((reference) => !("url" in reference) && !("reference_handle" in reference) && !("filename" in reference)));
    assert.deepEqual(Object.keys(rig.preflightInputs.at(-1)!.cost_inputs as object).sort(), ["image_size"]);
    assert.equal(rig.counters().posts, 1);
  } finally { await rig.service.close(); }
});

test("an exact-history result object mismatch remains unknown and is never presented as an artifact", async () => {
  const rig = makeRig({ wrongResultObjectId: true });
  try {
    let recoveryId = "";
    await assert.rejects(rig.service.generate({ attemptId: attempt(32), variant: "banana", reference_handles: [],
      parameters: CASES[0]!.parameters, prompt: "Reject a result outside the exact history IDs." }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as { code?: string }).code, "OUTCOME_UNKNOWN");
      recoveryId = (error as { recovery_id?: string }).recovery_id ?? "";
      const diagnostic = (error as { diagnostic?: { history_binding?: string; result_status?: string; result_reason?: string } }).diagnostic;
      assert.equal(diagnostic?.history_binding, "READY");
      assert.equal(diagnostic?.result_status, "UNVERIFIED");
      assert.equal(diagnostic?.result_reason, "OBJECT_ID_MISMATCH");
      return recoveryId.startsWith("standard_image_recovery_");
    });
    assert.equal(rig.counters().posts, 1);
    assert.equal(rig.counters().results, 1);
    assert.equal((await rig.service.listRecoveries({ attemptId: attempt(32) }))[0]?.recovery_id, recoveryId);
  } finally { await rig.service.close(); }
});

test("a safe image result with unknown extension remains observable with null MIME and unverified geometry", async () => {
  const rig = makeRig({ unknownResultMime: true });
  try {
    const result = await rig.service.generate({ attemptId: attempt(36), variant: "banana", reference_handles: [],
      parameters: CASES[0]!.parameters, prompt: "MIME inference is extension-only." });
    assert.equal(result.artifact.mime_type, null);
    assert.equal(result.artifact.mime_source, "UNKNOWN");
    assert.equal(result.actual_image.mime_type, null);
    assert.equal(result.artifact.width, null);
    assert.equal(result.artifact.height, null);
    assert.equal(result.artifact.geometry_verified, false);
  } finally { await rig.service.close(); }
});

test("close aborts and drains a dispatched request before closing the owned upload service", async () => {
  let announcePost!: () => void;
  const postStarted = new Promise<void>((resolve) => { announcePost = resolve; });
  const rig = makeRig({ postGate: (signal) => new Promise<void>((_resolve, reject) => {
    announcePost();
    const abort = () => { rig.events.push("post-fetch-aborted"); reject(new Error("synthetic fetch aborted")); };
    if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  }) });
  const originalUploadClose = rig.uploadService.close.bind(rig.uploadService);
  Object.defineProperty(rig.uploadService, "close", { configurable: true, value: async () => {
    rig.events.push("upload-service-closed"); return originalUploadClose();
  } });
  const generation = rig.service.generate({ attemptId: attempt(30), variant: "banana", reference_handles: [],
    parameters: CASES[0]!.parameters, prompt: "Close must drain before credentials close." });
  try {
    await waitForBarrier(postStarted, "standard image POST entry");
    const closing = rig.service.close();
    await assert.rejects(generation, (error: unknown) => error instanceof Error && (error as { code?: string }).code === "OUTCOME_UNKNOWN");
    await closing;
  } finally {
    await rig.service.close();
  }
  assert.ok(rig.events.indexOf("post-fetch-aborted") >= 0);
  assert.ok(rig.events.indexOf("upload-service-closed") > rig.events.indexOf("post-fetch-aborted"));
  await assert.rejects(rig.service.generate({ attemptId: attempt(30), variant: "banana", reference_handles: [],
    parameters: CASES[0]!.parameters, prompt: "Closed service." }), (error: unknown) =>
    error instanceof Error && (error as { code?: string }).code === "SERVICE_CLOSED");
});
