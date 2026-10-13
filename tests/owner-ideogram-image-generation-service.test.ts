import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerIdeogramImageUploadService } from "../src/application/owner-ideogram-image-upload-service.js";
import { OwnerIdeogramImageMaskUploadService } from "../src/application/owner-ideogram-image-mask-upload-service.js";
import {
  OwnerIdeogramImageGenerationService,
  OwnerIdeogramImageGenerationServiceError,
  OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS,
  OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS
} from "../src/application/owner-ideogram-image-generation-service.js";

const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BINDING = Object.freeze({ tenant_id: "ideogram-generation-tenant", subject: "ideogram-generation-owner" });
const ATTEMPT = "link_ideogram_generation_service_0123456789";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
interface PreflightInput {
  readonly attemptId: string;
  readonly model_id: string;
  readonly mode: string;
  readonly cost_inputs: Readonly<Record<string, string | number>>;
  readonly request_fingerprint: string;
  readonly signal?: AbortSignal;
}

interface ModeCase {
  readonly model_id: string;
  readonly mode: string;
  readonly prompt: string | null;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly images: readonly Readonly<{ bytes: Buffer; mime_type: string; filename: string }>[];
}

function modeCases(): readonly ModeCase[] {
  const jpeg = Buffer.from([0xff,0xd8,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0x00,0xff,0xd9]);
  const webp = Buffer.from([0x52,0x49,0x46,0x46,0x12,0x00,0x00,0x00,0x57,0x45,0x42,0x50,0x56,0x50,0x38,0x4c,0x05,0x00,0x00,0x00,0x2f,0x00,0x00,0x00,0x00,0x00]);
  return [
    { model_id: "ideogram", mode: "generate", prompt: "private-prompt-secret-base-731", parameters: { rendering_speed: "TURBO", num_images: 1, aspect_ratio: "1:1", resolution: "1024x1024" }, images: [] },
    { model_id: "ideogram", mode: "remix", prompt: "private-prompt-secret-remix-842", parameters: { rendering_speed: "TURBO", num_images: 2, aspect_ratio: "1:1", resolution: "1024x1024", image_weight: 50 }, images: [{ bytes: jpeg, mime_type: "image/jpeg", filename: "remix.jpg" }] },
    { model_id: "ideogram", mode: "reframe", prompt: null, parameters: { rendering_speed: "TURBO", num_images: 3, resolution: "1024x1024" }, images: [{ bytes: PNG, mime_type: "image/png", filename: "reframe.png" }] },
    { model_id: "ideogram", mode: "replace_background", prompt: "private-prompt-secret-background-953", parameters: { rendering_speed: "TURBO", num_images: 4 }, images: [{ bytes: webp, mime_type: "image/webp", filename: "replace.webp" }] },
    { model_id: "ideogram", mode: "character_reference", prompt: "private-prompt-secret-character-164", parameters: { rendering_speed: "TURBO", num_images: 5, aspect_ratio: "1:1", resolution: "1024x1024" }, images: [{ bytes: jpeg, mime_type: "image/jpeg", filename: "character.jpg" }] },
    { model_id: "ideogram_40", mode: "generate", prompt: "private-prompt-secret-v4-275", parameters: { rendering_speed: "TURBO", num_images: 6, aspect_ratio: null, resolution: "1K", image_weight_auto: false, image_weight: 37.5 }, images: [{ bytes: PNG, mime_type: "image/png", filename: "v4.png" }] },
    { model_id: "ideogram_40", mode: "transparent", prompt: "private-prompt-secret-alpha-386", parameters: { rendering_speed: "TURBO", num_images: 7, aspect_ratio: "1:1", resolution: "4K" }, images: [] },
    { model_id: "ideogram_45", mode: "generate", prompt: "private-prompt-secret-v45-497", parameters: { rendering_speed: "TURBO", num_images: 8, aspect_ratio: "1:1", resolution: "1K" }, images: [{ bytes: PNG, mime_type: "image/png", filename: "v45-a.png" }, { bytes: jpeg, mime_type: "image/jpeg", filename: "v45-b.jpg" }] },
    { model_id: "ideogram_45", mode: "precise_edit", prompt: "private-prompt-secret-edit-508", parameters: { rendering_speed: "TURBO", num_images: 5 }, images: [{ bytes: PNG, mime_type: "image/png", filename: "edit-a.png" }, { bytes: jpeg, mime_type: "image/jpeg", filename: "edit-b.jpg" }] }
  ];
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-ideogram-generation-credential"); } };
}
function linkedAttempt(attemptId: string, now: number) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: new Date(now + 60 * 60_000).toISOString(), linked: true as const };
}
function freshPreflight(model_id: string, cost_inputs: Readonly<Record<string, string | number>>, now: number) {
  return {
    account: { balance: { unit: "tokens" as const, available: null },
      subscription: { active: true, plan_type: "FREE", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD, observed_at: new Date(now).toISOString() },
    model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT" as const,
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id, ai_name: "ideogram", model_type: model_id, account_read_live: true as const,
      parameter_keys: Object.keys(cost_inputs).sort(), parameters_redacted: true as const, access: true,
      cost: 7.25, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false,
      observed_at: new Date(now).toISOString() }
  };
}
function errorCode(value: unknown): string | undefined { return value instanceof Error && "code" in value ? String(value.code) : undefined; }
async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !predicate(); i += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(predicate(), true, "bounded wait did not reach the expected synthetic lifecycle state");
}

interface RigOptions {
  readonly preflight?: (input: Readonly<PreflightInput>, call: number) => Promise<unknown> | unknown;
  readonly pendingHistoryFirst?: boolean;
  readonly pendingHistoryUntilReady?: boolean;
  readonly failFirstHistory?: boolean;
  readonly advanceClockOnPostMs?: number;
  readonly incompleteResultFirst?: boolean;
  readonly failPostAfterDispatch?: boolean;
  readonly holdPostUntilAbort?: boolean;
  readonly withMaskService?: boolean;
}
function createRig(options: RigOptions = {}) {
  let now = Date.parse("2026-10-11T00:00:00.000Z");
  const realDateNow = Date.now;
  Date.now = () => now;
  let activeCase: ModeCase | undefined;
  let uploadIndex = 0;
  const counts = { uploads: 0, chats: 0, posts: 0, histories: 0, results: 0, preflights: 0, statusReads: 0 };
  const events: string[] = [];
  const transactions = new Map<string, { readonly item: ModeCase; readonly chat_uuid: string; settings: Record<string, unknown>;
    post: number; ack: string; result_message: string; history_reads: number; result_reads: number }>();
  const postBodies: Array<Record<string, unknown>> = [];
  const preflightInputs: Array<Readonly<PreflightInput>> = [];
  let linked = true;
  let historyReady = false;
  let enteredPost!: () => void;
  const postEntered = new Promise<void>((resolve) => { enteredPost = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files") {
      counts.uploads += 1; uploadIndex += 1; events.push("upload");
      const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File);
      return Response.json({ files: [{ id: `ideogram-private-${uploadIndex}`,
        url: `https://r2.syntx.ai/private/ideogram/source-${uploadIndex}.${file.type.slice("image/".length)}`,
        mime_type: file.type, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") {
      counts.chats += 1; events.push("chat"); assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { title: "owner-ideogram-image", scope: "image" });
      const item = activeCase; assert.ok(item, "test chooses mode before a generation run");
      const chat_uuid = `ideogram-chat-${counts.chats}`;
      transactions.set(chat_uuid, { item, chat_uuid, settings: {}, post: 0, ack: "", result_message: "", history_reads: 0, result_reads: 0 });
      return Response.json({ uuid: chat_uuid });
    }
    if (url.pathname === "/api/v1/design/generate") {
      counts.posts += 1; events.push("post"); enteredPost();
      assert.equal(url.searchParams.get("ai_name"), "ideogram"); assert.equal(init?.method, "POST"); assert.equal(init?.redirect, "error");
      const body = JSON.parse(String(init?.body)) as { chat_uuid: string; prompt: string; settings: Record<string, unknown> };
      const transaction = transactions.get(body.chat_uuid); assert.ok(transaction);
      transaction.post = counts.posts; transaction.ack = `ideogram-owner-ack-${counts.posts}`;
      transaction.result_message = `ideogram-bot-result-${counts.posts}`; transaction.settings = body.settings;
      postBodies.push({ ...body });
      assert.equal(Object.hasOwn(body.settings, "n"), false);
      assert.equal(Object.hasOwn(body.settings, "mask"), false);
      if (options.advanceClockOnPostMs !== undefined) now += options.advanceClockOnPostMs;
      if (options.failPostAfterDispatch) throw new Error("synthetic lost POST response");
      if (options.holdPostUntilAbort) return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!(signal instanceof AbortSignal)) { reject(new Error("POST missing abort signal")); return; }
        const abort = () => reject(new DOMException("synthetic POST aborted", "AbortError"));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
      return Response.json({ id: transaction.ack });
    }
    const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/(ideogram-chat-\d+)\/messages$/u);
    if (historyMatch) {
      counts.histories += 1; events.push("history");
      const transaction = transactions.get(historyMatch[1]!); assert.ok(transaction); assert.equal(init?.method, "GET");
      transaction.history_reads += 1;
      if (options.failFirstHistory && counts.histories === 1) throw new Error("synthetic temporary history read failure");
      const owner = { id: transaction.ack, chat_id: 7100 + transaction.post, author_id: 100,
        message_object: [{ id: `owner-text-${transaction.post}`, message_id: transaction.ack, object_type: "text", model_type: transaction.item.model_id }] };
      if ((options.pendingHistoryUntilReady && !historyReady) || (options.pendingHistoryFirst && transaction.history_reads === 1)) return Response.json({ messages: [owner], pagination: {
        page: 1, page_size: 10, total_count: 1, total_pages: 1, has_next: false, has_previous: false } });
      const requested = Number(transaction.settings.num_images);
      const outputCount = options.pendingHistoryFirst && transaction.history_reads === 2 ? Math.max(1, requested - 1) : requested;
      const bot = { id: transaction.result_message, chat_id: 7100 + transaction.post, author_id: -1,
        message_object: Array.from({ length: outputCount }, (_, i) => ({ id: `ideogram-object-${transaction.post}-${i + 1}`,
          message_id: transaction.result_message, object_type: "image", model_type: transaction.item.model_id })) };
      const messages = [owner, bot];
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const resultMatch = url.pathname.match(/^\/api\/v1\/chats\/(ideogram-chat-\d+)\/(ideogram-bot-result-\d+)$/u);
    if (resultMatch) {
      counts.results += 1; events.push("result");
      const transaction = transactions.get(resultMatch[1]!); assert.ok(transaction); assert.equal(init?.method, "GET");
      transaction.result_reads += 1;
      const requested = Number(transaction.settings.num_images);
      const objects = Array.from({ length: requested }, (_, i) => ({ id: `ideogram-object-${transaction.post}-${i + 1}`,
        message_id: resultMatch[2], object_type: "image", model_type: transaction.item.model_id,
        completed: !(options.incompleteResultFirst && transaction.result_reads === 1 && i > 0),
        object_url: `https://r2.syntx.ai/ideogram/generated-${transaction.post}-${i + 1}.png` }));
      return Response.json({ id: resultMatch[2], chat_id: 7100 + transaction.post, author_id: -1, message_object: objects });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    counts.statusReads += 1;
    return linked ? linkedAttempt(attemptId, now) : { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "UNLINKED" as const, expires_at: null, linked: false as const };
  } };
  const uploadService = new OwnerIdeogramImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const maskUploadService = new OwnerIdeogramImageMaskUploadService({ baseUploadService: uploadService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: () => now });
  let service: OwnerIdeogramImageGenerationService;
  service = new OwnerIdeogramImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    ...(options.withMaskService ? { maskUploadService } : {}),
    preflight: async (input: Readonly<PreflightInput>) => {
      counts.preflights += 1; events.push(`preflight-${counts.preflights}`); preflightInputs.push(input);
      return options.preflight ? await options.preflight(input, counts.preflights) : freshPreflight(input.model_id, input.cost_inputs, now);
    }, now: () => now, pollDelayMs: 0, maxPollAttempts: 4, wait: async () => undefined });
  const closeService = service.close.bind(service);
  service.close = () => closeService().finally(async () => { await maskUploadService.close(); await uploadService.close(); Date.now = realDateNow; });
  return { service, uploadService, maskUploadService, counts, events, transactions, postBodies, preflightInputs, postEntered,
    setCase(value: ModeCase) { activeCase = value; }, setNow(value: number) { now = value; }, setLinked(value: boolean) { linked = value; },
    setHistoryReady(value: boolean) { historyReady = value; } };
}

async function uploadHandles(rig: ReturnType<typeof createRig>, item: ModeCase, attemptId = ATTEMPT): Promise<string[]> {
  const handles: string[] = [];
  for (const image of item.images) {
    const receipt = await rig.uploadService.upload({ attemptId, model_id: item.model_id, mode: item.mode,
      content_base64: image.bytes.toString("base64"), filename: image.filename, mime_type: image.mime_type });
    handles.push(receipt.reference_handle);
  }
  return handles;
}
function generateInput(item: ModeCase, handles: readonly string[], attemptId = ATTEMPT) {
  return { attemptId, model_id: item.model_id, mode: item.mode, prompt: item.prompt,
    reference_handles: handles, parameters: item.parameters };
}

test("publishes exact frozen reason arrays for history and batch result unions", () => {
  assert.deepEqual(OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS, [
    "INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
    "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
    "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
    "OWNER_ACK_AMBIGUOUS", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS", "BOT_MESSAGE_BEFORE_ACK", "BOT_MODEL_MISMATCH",
    "BOT_OUTPUT_COUNT_INVALID", "OUTPUT_BATCH_PARTIAL", "MASK_ROLE_ECHO_NOT_SOURCE_BOUND"
  ]);
  assert.equal(Object.isFrozen(OWNER_IDEOGRAM_IMAGE_GENERATION_HISTORY_REASONS), true);
  assert.ok(OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS.includes("SOME_RESULTS_NOT_COMPLETED"));
  assert.equal(Object.isFrozen(OWNER_IDEOGRAM_IMAGE_GENERATION_RESULT_REASONS), true);
});

test("runs the full local all-nine ordinary-image path with two source-input preflights and one POST", async () => {
  const rig = createRig();
  try {
    for (const item of modeCases()) {
      rig.setCase(item);
      const handles = await uploadHandles(rig, item);
      const before = { ...rig.counts };
      const result = await rig.service.generate(generateInput(item, handles));
      assert.equal(result.status, "result_observed");
      assert.equal(result.model_id, item.model_id);
      assert.equal(result.mode, item.mode);
      assert.equal(result.output_count, item.parameters.num_images);
      assert.equal(result.artifacts.length, item.parameters.num_images);
      assert.deepEqual(result.artifacts.map((artifact) => artifact.url),
        Array.from({ length: Number(item.parameters.num_images) }, (_, index) => `https://r2.syntx.ai/ideogram/generated-${before.posts + 1}-${index + 1}.png`));
      assert.equal(result.mode_confidence, "PRIVATE_REQUEST_CONTEXT_NOT_PROVIDER_ECHO");
      assert.equal(result.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
      assert.equal(result.backend_acceptance, "UNPROVEN");
      const resultFlags = result as typeof result & { readonly mask_present?: boolean; readonly mask_acceptance?: string };
      assert.equal(resultFlags.mask_present, false);
      assert.equal(resultFlags.mask_acceptance, "NOT_REQUESTED");
      assert.equal(JSON.stringify(result).includes(item.prompt ?? "__NO_USER_PROMPT__"), false);
      assert.equal(JSON.stringify(result).includes("https://r2.syntx.ai/private/ideogram"), false);
      assert.equal(rig.counts.uploads, before.uploads, "generation never repeats the native input upload");
      assert.equal(rig.counts.chats, before.chats + 1);
      assert.equal(rig.counts.posts, before.posts + 1);
      assert.equal(rig.counts.histories, before.histories + 1);
      assert.equal(rig.counts.results, before.results + 1);
      assert.equal(rig.counts.preflights, before.preflights + 2);
      const body = rig.postBodies.at(-1)!;
      assert.equal(body.prompt, item.prompt ?? "");
      const settings = body.settings as Record<string, unknown>;
      assert.equal(settings.model_type, item.model_id);
      assert.equal(settings.num_images, item.parameters.num_images);
      assert.equal(Object.hasOwn(settings, "n"), false);
      assert.equal(Object.hasOwn(settings, "mask"), false);
      assert.deepEqual((settings.file_urls as readonly { type: string; url: string }[]).map((file) => file.type), Array(handles.length).fill("image"));
      const firstInputUpload = before.uploads - item.images.length + 1;
      assert.deepEqual((settings.file_urls as readonly { type: string; url: string }[]).map((file) => file.url),
        Array.from({ length: item.images.length }, (_, index) => `https://r2.syntx.ai/private/ideogram/source-${firstInputUpload + index}.${item.images[index]!.mime_type.slice("image/".length)}`));
      const preflights = rig.preflightInputs.slice(-2);
      assert.equal(preflights.length, 2);
      assert.deepEqual(preflights[0]!.cost_inputs, preflights[1]!.cost_inputs);
      assert.equal(preflights[0]!.model_id, item.model_id);
      assert.equal(preflights[0]!.mode, item.mode);
      if (item.model_id === "ideogram") assert.deepEqual(preflights[0]!.cost_inputs,
        { rendering_speed: "TURBO", batch_size: item.parameters.num_images });
      if (item.model_id === "ideogram_40" && item.mode === "transparent") assert.deepEqual(preflights[0]!.cost_inputs,
        { rendering_speed: "TURBO", mode: "transparent", resolution: "4K", batch_size: 7 });
      if (item.model_id === "ideogram_45" && item.mode === "precise_edit") assert.deepEqual(preflights[0]!.cost_inputs,
        { rendering_speed: "TURBO", ref_count: item.images.length, batch_size: item.parameters.num_images });
    }
    assert.equal(rig.counts.posts, 9);
  } finally { await rig.service.close(); }
});

test("generates precise_edit with a nominal first-image-bound mask, while cost ref_count remains ordinary-only", async () => {
  const rig = createRig({ withMaskService: true });
  const item = modeCases()[8]!;
  const painted = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  try {
    rig.setCase(item);
    const handles = await uploadHandles(rig, item);
    const mask = await rig.maskUploadService.upload({ attemptId: ATTEMPT, base_reference_handle: handles[0]!,
      painted_rgba_png_base64: painted.toString("base64") });
    const result = await rig.service.generate({ ...generateInput(item, handles), mask_handle: mask.mask_handle });
    assert.equal(result.status, "result_observed");
    assert.equal(result.model_id, "ideogram_45");
    assert.equal(result.mode, "precise_edit");
    assert.equal(result.reference_count, 2);
    assert.equal(result.output_count, 5);
    assert.equal(result.artifacts.length, 5);
    const resultFlags = result as typeof result & { readonly mask_present?: boolean; readonly mask_acceptance?: string };
    assert.equal(resultFlags.mask_present, true);
    assert.equal(resultFlags.mask_acceptance, "UNPROVEN");
    assert.equal(rig.counts.preflights, 2);
    assert.deepEqual(rig.preflightInputs.map((input) => input.cost_inputs), [
      { rendering_speed: "TURBO", ref_count: 2, batch_size: 5 },
      { rendering_speed: "TURBO", ref_count: 2, batch_size: 5 }
    ]);
    assert.equal(rig.counts.posts, 1);
    const files = (rig.postBodies[0]!.settings as Record<string, unknown>).file_urls as readonly { type: string; url: string }[];
    assert.deepEqual(files.map((file) => file.type), ["image", "image", "mask"]);
    assert.equal(files[2]!.url, "https://r2.syntx.ai/private/ideogram/source-3.png");
    assert.equal(JSON.stringify(result).includes(mask.mask_handle), false);
    assert.equal(JSON.stringify(result).includes("private/ideogram/source-"), false);
  } finally { painted.fill(0); await rig.service.close(); }
});

test("generate accepts neither a caller mask boolean nor a mask handle outside precise_edit", async () => {
  const rig = createRig({ withMaskService: true });
  const item = modeCases()[0]!;
  const validImageHandle = "ideogram_image_00000000-0000-4000-8000-000000000001";
  const validMaskHandle = "ideogram_mask_00000000-0000-4000-8000-000000000002";
  try {
    assert.throws(() => rig.service.generate({ ...generateInput(item, [validImageHandle]), mask_handle: validMaskHandle }),
      (error: unknown) => errorCode(error) === "INVALID_REQUEST");
    assert.throws(() => rig.service.generate({ ...generateInput(item, [validImageHandle]), mask_present: true }),
      (error: unknown) => errorCode(error) === "INVALID_REQUEST");
    assert.equal(rig.counts.uploads, 0);
    assert.equal(rig.counts.posts, 0);
  } finally { await rig.service.close(); }
});

test("masked precise_edit preserves literal output batches 1, 2, 4, and 8", async () => {
  const rig = createRig({ withMaskService: true });
  const source = modeCases()[8]!;
  const painted = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  try {
    const handles = await uploadHandles(rig, source);
    const mask = await rig.maskUploadService.upload({ attemptId: ATTEMPT, base_reference_handle: handles[0]!,
      painted_rgba_png_base64: painted.toString("base64") });
    for (const count of [1, 2, 4, 8] as const) {
      const item = { ...source, parameters: { ...source.parameters, num_images: count } };
      rig.setCase(item);
      const result = await rig.service.generate({ ...generateInput(item, handles), mask_handle: mask.mask_handle });
      assert.equal(result.output_count, count);
      assert.equal(result.artifacts.length, count);
      const settings = rig.postBodies.at(-1)!.settings as Record<string, unknown>;
      assert.equal(settings.num_images, count);
      assert.deepEqual(rig.preflightInputs.at(-1)!.cost_inputs, { rendering_speed: "TURBO", ref_count: 2, batch_size: count });
      const files = settings.file_urls as readonly { type: string; url: string }[];
      assert.deepEqual(files.map((file) => file.type), ["image", "image", "mask"]);
    }
    assert.equal(rig.counts.posts, 4);
    assert.equal(rig.counts.preflights, 8);
  } finally { painted.fill(0); await rig.service.close(); }
});

test("masked unknown recovery remains GET-only and exposes only UNPROVEN mask status", async () => {
  const rig = createRig({ withMaskService: true, failFirstHistory: true });
  const item = modeCases()[8]!;
  const painted = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  try {
    rig.setCase(item);
    const handles = await uploadHandles(rig, item);
    const mask = await rig.maskUploadService.upload({ attemptId: ATTEMPT, base_reference_handle: handles[0]!,
      painted_rgba_png_base64: painted.toString("base64") });
    let recoveryId = "";
    await assert.rejects(rig.service.generate({ ...generateInput(item, handles), mask_handle: mask.mask_handle }), (error: unknown) => {
      if (errorCode(error) === "OUTCOME_UNKNOWN" && error instanceof OwnerIdeogramImageGenerationServiceError) recoveryId = error.recovery_id ?? "";
      return errorCode(error) === "OUTCOME_UNKNOWN";
    });
    assert.ok(recoveryId);
    const listed = await rig.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]!.mask_present, true);
    assert.equal(listed[0]!.mask_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify(listed).includes(mask.mask_handle), false);
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.mask_present, true);
    assert.equal(result.mask_acceptance, "UNPROVEN");
    assert.equal(result.output_count, 5);
    assert.equal(rig.counts.posts, 1);
    assert.equal(rig.counts.histories, 2);
  } finally { painted.fill(0); await rig.service.close(); }
});

test("masked history/output partial states continue polling the same batch without another POST", async () => {
  const rig = createRig({ withMaskService: true, pendingHistoryFirst: true, incompleteResultFirst: true });
  const source = modeCases()[8]!;
  const item = { ...source, parameters: { ...source.parameters, num_images: 2 } };
  const painted = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  try {
    rig.setCase(item);
    const handles = await uploadHandles(rig, item);
    const mask = await rig.maskUploadService.upload({ attemptId: ATTEMPT, base_reference_handle: handles[0]!,
      painted_rgba_png_base64: painted.toString("base64") });
    const result = await rig.service.generate({ ...generateInput(item, handles), mask_handle: mask.mask_handle });
    assert.equal(result.status, "result_observed");
    assert.equal(result.mask_present, true);
    assert.equal(result.mask_acceptance, "UNPROVEN");
    assert.equal(result.output_count, 2);
    assert.equal(result.artifacts.length, 2);
    assert.equal(rig.counts.posts, 1);
    assert.equal(rig.counts.histories, 3);
    assert.equal(rig.counts.results, 2);
  } finally { painted.fill(0); await rig.service.close(); }
});

test("uncertain masked POST blocks the same semantic mask after invalidation and fresh relink uploads", async () => {
  const rig = createRig({ withMaskService: true, failPostAfterDispatch: true });
  const item = modeCases()[8]!;
  const painted = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  try {
    rig.setCase(item);
    const firstHandles = await uploadHandles(rig, item);
    const firstMask = await rig.maskUploadService.upload({ attemptId: ATTEMPT, base_reference_handle: firstHandles[0]!,
      painted_rgba_png_base64: painted.toString("base64") });
    let recoveryId = "";
    await assert.rejects(rig.service.generate({ ...generateInput(item, firstHandles), mask_handle: firstMask.mask_handle }),
      (error: unknown) => {
        if (errorCode(error) === "OUTCOME_UNKNOWN") recoveryId = (error as OwnerIdeogramImageGenerationServiceError).recovery_id ?? "";
        return errorCode(error) === "OUTCOME_UNKNOWN";
      });
    assert.match(recoveryId, /^ideogram_image_recovery_[0-9a-f-]{36}$/u);
    rig.setNow(Date.parse("2026-10-11T00:00:00.000Z") + 16 * 60_000);
    await assert.rejects(rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => errorCode(error) === "OUTCOME_UNKNOWN");
    assert.equal(rig.counts.histories, 0, "without an owner echo there is no safe history GET witness");
    assert.equal(rig.counts.results, 0);
    await assert.rejects(rig.service.generate({ ...generateInput(item, firstHandles), mask_handle: firstMask.mask_handle }),
      (error: unknown) => errorCode(error) === "REFERENCE_EXPIRED");
    await rig.service.invalidateAttempt(ATTEMPT);

    const nextAttempt = "link_ideogram_generation_relinked_0123456789";
    const nextHandles = await uploadHandles(rig, item, nextAttempt);
    const nextMask = await rig.maskUploadService.upload({ attemptId: nextAttempt, base_reference_handle: nextHandles[0]!,
      painted_rgba_png_base64: painted.toString("base64") });
    await assert.rejects(rig.service.generate({ ...generateInput(item, nextHandles, nextAttempt), mask_handle: nextMask.mask_handle }),
      (error: unknown) => errorCode(error) === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(rig.counts.posts, 1);
  } finally { painted.fill(0); await rig.service.close(); }
});

test("waits for a complete all-output history identity and then polls unfinished batch results", async () => {
  const rig = createRig({ pendingHistoryFirst: true, incompleteResultFirst: true });
  try {
    for (const item of [modeCases()[1]!, modeCases()[7]!]) {
      rig.setCase(item);
      const handles = await uploadHandles(rig, item);
      const result = await rig.service.generate(generateInput(item, handles));
      assert.equal(result.status, "result_observed");
      assert.equal(result.artifacts.length, item.parameters.num_images);
    }
    assert.equal(rig.counts.posts, 2);
    assert.ok(rig.counts.histories >= 6, "history IDs must be complete before result GET");
    assert.equal(rig.counts.results, 4, "two batches are polled again with their stable full ID lists");
  } finally { await rig.service.close(); }
});

test("preflight compares ModelAccess's canonical sorted parameter keys without accepting omissions or extras", async () => {
  const source = modeCases()[8]!;
  for (const mutation of ["missing", "extra", "duplicate"] as const) {
    const rig = createRig({ preflight: async (input, call) => {
      const result = freshPreflight(input.model_id, input.cost_inputs, Date.parse("2026-10-11T00:00:00.000Z"));
      if (call === 1) {
        const sorted = [...result.model_access.parameter_keys];
        if (mutation === "missing") sorted.pop();
        if (mutation === "extra") sorted.push("unsupported_control");
        if (mutation === "duplicate") sorted.push(sorted[0]!);
        result.model_access.parameter_keys = sorted;
      }
      return result;
    } });
    try {
      rig.setCase(source);
      const handles = await uploadHandles(rig, source);
      await assert.rejects(rig.service.generate(generateInput(source, handles)),
        (error: unknown) => errorCode(error) === "PREFLIGHT_FAILED");
      assert.equal(rig.counts.preflights, 1);
      assert.equal(rig.counts.chats, 0);
      assert.equal(rig.counts.posts, 0);
    } finally { await rig.service.close(); }
  }
});

test("second preflight denial and attempt revoke after the second read both stop before POST", async () => {
  const item = modeCases()[0]!;
  const denied = createRig({ preflight: async (input, call) => {
    const result = freshPreflight(input.model_id, input.cost_inputs, Date.parse("2026-10-11T00:00:00.000Z"));
    if (call === 2) result.model_access.access = false;
    return result;
  } });
  try {
    denied.setCase(item);
    const handles = await uploadHandles(denied, item);
    await assert.rejects(denied.service.generate(generateInput(item, handles)), (error: unknown) => errorCode(error) === "PREFLIGHT_FAILED");
    assert.equal(denied.counts.preflights, 2);
    assert.equal(denied.counts.posts, 0);
  } finally { await denied.service.close(); }

  let entered!: () => void; let release!: () => void;
  const atSecond = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const revoked = createRig({ preflight: async (input, call) => {
    if (call === 2) { entered(); await gate; }
    return freshPreflight(input.model_id, input.cost_inputs, Date.parse("2026-10-11T00:00:00.000Z"));
  } });
  try {
    revoked.setCase(item);
    const handles = await uploadHandles(revoked, item);
    const generation = revoked.service.generate(generateInput(item, handles));
    await atSecond;
    let drained = false;
    const invalidation = revoked.service.invalidateAttempt(ATTEMPT).then(() => { drained = true; });
    await waitUntil(() => revoked.preflightInputs.at(-1)?.signal?.aborted === true);
    release();
    await assert.rejects(generation, (error: unknown) => errorCode(error) !== "OUTCOME_UNKNOWN");
    await invalidation;
    assert.equal(drained, true);
    assert.equal(revoked.counts.posts, 0);
  } finally { release(); await revoked.service.close(); }
});

test("unknown acknowledged POST is never replayed; exact recovery is GET-only", async () => {
  const rig = createRig({ failFirstHistory: true });
  const item = modeCases()[0]!;
  const input: ReturnType<typeof generateInput> = generateInput(item, []);
  let recoveryId = "";
  try {
    rig.setCase(item);
    await assert.rejects(rig.service.generate(input), (error: unknown) => {
      if (errorCode(error) === "OUTCOME_UNKNOWN") {
        recoveryId = (error as OwnerIdeogramImageGenerationServiceError).recovery_id ?? "";
      }
      return errorCode(error) === "OUTCOME_UNKNOWN";
    });
    assert.match(recoveryId, /^ideogram_image_recovery_[0-9a-f-]{36}$/u);
    await assert.rejects(rig.service.generate(input), (error: unknown) => errorCode(error) === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(rig.counts.posts, 1);
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.artifacts.length, 1);
    assert.equal(rig.counts.posts, 1);
    assert.equal(rig.events.includes("post:replay"), false);
  } finally { await rig.service.close(); }
});

test("keeps an acknowledged pending-history recovery GET-only after source expiry", async () => {
  const original = Date.parse("2026-10-11T00:00:00.000Z");
  const rig = createRig({ pendingHistoryUntilReady: true });
  const item = modeCases()[1]!;
  let recoveryId = "";
  try {
    rig.setCase(item);
    const handles = await uploadHandles(rig, item);
    await assert.rejects(rig.service.generate(generateInput(item, handles)), (error: unknown) => {
      if (errorCode(error) === "OUTCOME_UNKNOWN") recoveryId = (error as OwnerIdeogramImageGenerationServiceError).recovery_id ?? "";
      return errorCode(error) === "OUTCOME_UNKNOWN";
    });
    assert.match(recoveryId, /^ideogram_image_recovery_[0-9a-f-]{36}$/u);
    assert.equal(rig.counts.uploads, 1);
    assert.equal(rig.counts.posts, 1);
    assert.equal(rig.counts.results, 0);
    const beforeRecovery = { ...rig.counts };

    rig.setNow(original + 16 * 60_000);
    rig.setHistoryReady(true);
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });

    assert.equal(result.status, "result_observed");
    assert.equal(result.model_id, item.model_id);
    assert.equal(result.artifacts.length, item.parameters.num_images);
    assert.ok(rig.counts.statusReads > beforeRecovery.statusReads, "GET recovery must re-read the currently linked owner");
    assert.equal(rig.counts.uploads, beforeRecovery.uploads);
    assert.equal(rig.counts.chats, beforeRecovery.chats);
    assert.equal(rig.counts.posts, beforeRecovery.posts);
    assert.equal(rig.counts.histories, beforeRecovery.histories + 1);
    assert.equal(rig.counts.results, beforeRecovery.results + 1);

    await assert.rejects(rig.service.generate({ ...generateInput(item, handles), prompt: "new intent after source expiry" }),
      (error: unknown) => errorCode(error) === "REFERENCE_EXPIRED");
    assert.equal(rig.counts.uploads, beforeRecovery.uploads);
    assert.equal(rig.counts.chats, beforeRecovery.chats);
    assert.equal(rig.counts.posts, beforeRecovery.posts);
  } finally { await rig.service.close(); }
});

test("resolves a transiently failed history read with GET-only recovery after source expiry", async () => {
  const original = Date.parse("2026-10-11T00:00:00.000Z");
  const rig = createRig({ failFirstHistory: true, advanceClockOnPostMs: 14 * 60_000 });
  const item = modeCases()[0]!;
  const input = generateInput(item, []);
  let recoveryId = "";
  try {
    rig.setCase(item);
    await assert.rejects(rig.service.generate(input), (error: unknown) => {
      if (errorCode(error) === "OUTCOME_UNKNOWN") recoveryId = (error as OwnerIdeogramImageGenerationServiceError).recovery_id ?? "";
      return errorCode(error) === "OUTCOME_UNKNOWN";
    });
    assert.match(recoveryId, /^ideogram_image_recovery_[0-9a-f-]{36}$/u);
    assert.equal(rig.counts.posts, 1);
    const beforeRecovery = { ...rig.counts };
    rig.setNow(original + 16 * 60_000);
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "result_observed");
    assert.equal(result.artifacts.length, 1);
    assert.equal(rig.counts.histories, beforeRecovery.histories + 1);
    assert.equal(rig.counts.results, beforeRecovery.results + 1);
    assert.equal(rig.counts.chats, beforeRecovery.chats);
    assert.equal(rig.counts.posts, 1);
    assert.equal(rig.counts.uploads, 0);
  } finally { await rig.service.close(); }
});

test("a successful cached asset set is not renewed after its original candidate expiry", async () => {
  const rig = createRig();
  const original = Date.parse("2026-10-11T00:00:00.000Z");
  const item = modeCases()[1]!;
  try {
    rig.setCase(item);
    const handles = await uploadHandles(rig, item);
    const input = generateInput(item, handles);
    const result = await rig.service.generate(input);
    assert.equal(result.artifacts.length, item.parameters.num_images);
    assert.equal(rig.counts.posts, 1);
    rig.setNow(original + 15 * 60_000);
    await assert.rejects(rig.service.generate(input), (error: unknown) => errorCode(error) === "REFERENCE_EXPIRED");
    assert.equal(rig.counts.posts, 1);
    assert.equal(rig.counts.chats, 1);
    assert.equal(rig.counts.uploads, 1, "expiry must not re-upload or renew the original handle");
  } finally { await rig.service.close(); }
});

test("expired completed semantic asset keys do not consume capacity after TTL pruning", async () => {
  const original = Date.parse("2026-10-11T00:00:00.000Z");
  const rig = createRig();
  const base = modeCases()[0]!;
  try {
    for (let i = 0; i < 128; i += 1) {
      const item = { ...base, prompt: `completed known intent ${i}` };
      rig.setCase(item);
      let result: Awaited<ReturnType<typeof rig.service.generate>>;
      try { result = await rig.service.generate(generateInput(item, [])); }
      catch (error) { throw new Error(`completed semantic intent ${i} failed after ${rig.events.join(",")}`, { cause: error }); }
      assert.equal(result.status, "result_observed");
    }
    assert.equal(rig.counts.posts, 128);
    rig.setNow(original + 15 * 60_000);
    const next = { ...base, prompt: "independent intent after expired cache" };
    rig.setCase(next);
    const result = await rig.service.generate(generateInput(next, []));
    assert.equal(result.status, "result_observed");
    assert.equal(rig.counts.posts, 129);
  } finally {
    await rig.service.close();
  }
});

test("prompt and parameter changes form distinct private asset intents, without re-uploading inputs", async () => {
  const rig = createRig();
  const item = modeCases()[0]!;
  try {
    rig.setCase(item);
    const firstHandles = await uploadHandles(rig, item);
    const uploadCount = rig.counts.uploads;
    const first = await rig.service.generate(generateInput(item, firstHandles));
    const secondItem = { ...item, prompt: "private-prompt-secret-different-619", parameters: { ...item.parameters, num_images: 2 } };
    rig.setCase(secondItem);
    const second = await rig.service.generate(generateInput(secondItem, firstHandles));
    assert.deepEqual(rig.postBodies.slice(-2).map((body) => body.prompt), ["private-prompt-secret-base-731", "private-prompt-secret-different-619"]);
    assert.deepEqual(rig.postBodies.slice(-2).map((body) => (body.settings as Record<string, unknown>).num_images), [1, 2]);
    assert.equal(first.artifacts.length, 1);
    assert.equal(second.artifacts.length, 2);
    assert.equal(rig.counts.uploads, uploadCount);
  } finally { await rig.service.close(); }
});

test("retains 128 unknown semantic intents without eviction and refuses a 129th", async () => {
  const rig = createRig({ failPostAfterDispatch: true });
  const base = modeCases()[0]!;
  try {
    rig.setCase(base);
    for (let i = 0; i < 128; i += 1) {
      const item = { ...base, prompt: `unknown intent ${i}` };
      await assert.rejects(rig.service.generate(generateInput(item, [])), (error: unknown) => errorCode(error) === "OUTCOME_UNKNOWN");
    }
    const retryFirst = { ...base, prompt: "unknown intent 0" };
    await assert.rejects(rig.service.generate(generateInput(retryFirst, [])), (error: unknown) => errorCode(error) === "REFERENCE_ALREADY_CLAIMED");
    const overflow = { ...base, prompt: "intent 129" };
    await assert.rejects(rig.service.generate(generateInput(overflow, [])), (error: unknown) => errorCode(error) === "SERVICE_BUSY");
    assert.equal(rig.counts.posts, 128);
    assert.equal(rig.counts.chats, 128);
  } finally { await rig.service.close(); }
});

test("close aborts and drains one in-flight native POST as unknown without a second POST", async () => {
  const rig = createRig({ holdPostUntilAbort: true });
  const item = modeCases()[0]!;
  try {
    rig.setCase(item);
    const handles = await uploadHandles(rig, item);
    const generation = rig.service.generate(generateInput(item, handles));
    await rig.postEntered;
    let closed = false;
    const closing = rig.service.close().then(() => { closed = true; });
    await assert.rejects(generation, (error: unknown) => errorCode(error) === "OUTCOME_UNKNOWN");
    await closing;
    assert.equal(closed, true);
    assert.equal(rig.counts.posts, 1);
  } finally { await rig.service.close(); }
});
