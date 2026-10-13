import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { OwnerSeedreamImageUploadService } from "../src/application/owner-seedream-image-upload-service.js";
import { OwnerSeedreamImageGenerationService, OwnerSeedreamImageGenerationServiceError } from "../src/application/owner-seedream-image-generation-service.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BINDING = Object.freeze({ tenant_id: "seedream-generation-tenant", subject: "seedream-generation-owner" });
const ATTEMPT = "link_seedream_generation_service_0123456789";
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function png15(alpha = 255, withExif = false, red = 20): Buffer {
  const width = 15, height = 15, header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const rows = Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => [red, 40, 60, alpha]).flat()]));
  return Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", header), ...(withExif ? [pngChunk("eXIf", Buffer.from([1, 2, 3]))] : []),
    pngChunk("IDAT", deflateSync(Buffer.concat(rows))), pngChunk("IEND", Buffer.alloc(0))]);
}

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: new Date(Date.now() + 60 * 60_000).toISOString(), linked: true as const };
}

function freshPreflight(variant: string, observedAt = Date.now()) {
  return {
    account: { balance: { unit: "tokens" as const, available: null },
      subscription: { active: true, plan_type: "FREE", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: new Date(observedAt).toISOString() },
    model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT" as const,
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: variant, ai_name: "seedream", model_type: variant, account_read_live: true as const,
      parameter_keys: variant === "seedream-5.0-pro" ? ["batch_size", "resolution"] as string[] : [] as string[], parameters_redacted: true as const, access: true,
      cost: 0, discount_cost: null, free_remaining_generations: null, limit: null, show_warning: false,
      observed_at: new Date(observedAt).toISOString() }
  };
}

interface RigOptions {
  readonly now?: () => number;
  readonly failPost?: boolean;
  readonly holdPostUntilAbort?: boolean;
  readonly pendingHistoryFirst?: boolean;
  readonly preflight?: (variant: string, call: number) => ReturnType<typeof freshPreflight>;
}

function createRig(options: RigOptions = {}) {
  const calls = { uploads: 0, chats: 0, posts: 0, histories: 0, results: 0, preflights: 0 };
  const events: string[] = [];
  let principalReads = 0;
  const transactions = new Map<string, { readonly variant: string; readonly settings: Record<string, unknown>; readonly post: number }>();
  const preflightInputs: Array<{ readonly variant: string; readonly cost_inputs: Readonly<Record<string, string | number>>; readonly request_fingerprint: string }> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-seedream-generation-credential");
  } }, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files") {
      calls.uploads += 1; events.push("upload");
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      return Response.json({ files: [{ id: `seedream-private-${calls.uploads}`,
        url: `https://r2.syntx.ai/private/seedream/source-${calls.uploads}.${file.type.slice("image/".length)}`,
        mime_type: file.type, size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") {
      calls.chats += 1; events.push("chat");
      return Response.json({ uuid: `seedream-chat-${calls.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate") {
      calls.posts += 1; events.push("post");
      const body = JSON.parse(String(init?.body)) as { chat_uuid: string; settings: Record<string, unknown> };
      const variant = url.searchParams.get("ai_name") === "seedream" ? String(body.settings.model_type) : "invalid";
      transactions.set(body.chat_uuid, { variant, settings: body.settings, post: calls.posts });
      if (options.failPost) throw new Error("synthetic transport loss after dispatch");
      if (options.holdPostUntilAbort) {
        return await new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!(signal instanceof AbortSignal)) { reject(new Error("native POST has no abort signal")); return; }
          const abort = () => reject(new DOMException("synthetic POST aborted", "AbortError"));
          if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
        });
      }
      return Response.json({ id: `seedream-owner-echo-${calls.posts}` });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(seedream-chat-\d+)\/messages$/u);
    if (history) {
      calls.histories += 1; events.push("history");
      const transaction = transactions.get(history[1]!);
      assert.ok(transaction);
      const post = transaction.post;
      const ownerId = `seedream-owner-echo-${post}`;
      const referenceCount = (transaction.settings.file_urls as readonly unknown[]).length;
      const referenceObjects = Array.from({ length: referenceCount }, (_, index) => ({ id: `seedream-owner-ref-${post}-${index + 1}`,
        message_id: ownerId, object_type: "image", model_type: transaction.variant }));
      const ownerMessage = { id: ownerId, chat_id: 9000 + post, author_id: 100, message_object: [...referenceObjects,
        { id: `seedream-owner-text-${post}`, message_id: ownerId, object_type: "text", model_type: transaction.variant }] };
      const botMessage =
        { id: `seedream-bot-result-${post}`, chat_id: 9000 + post, author_id: -1, message_object: [{
          id: `seedream-image-object-${post}`, message_id: `seedream-bot-result-${post}`, object_type: "image", model_type: transaction.variant
        }] };
      const messages = options.pendingHistoryFirst && calls.histories === 1 ? [ownerMessage] : [ownerMessage, botMessage];
      return Response.json({ messages, pagination: { page: 1, page_size: 10, total_count: messages.length,
        total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = url.pathname.match(/^\/api\/v1\/chats\/(seedream-chat-\d+)\/(seedream-bot-result-\d+)$/u);
    if (result) {
      calls.results += 1; events.push("result");
      const transaction = transactions.get(result[1]!);
      assert.ok(transaction);
      const post = transaction.post;
      return Response.json({ id: result[2], chat_id: 9000 + post, author_id: -1, message_object: [{
        id: `seedream-image-object-${post}`, message_id: result[2], object_type: "image", model_type: transaction.variant,
        completed: true, object_url: `https://r2.syntx.ai/seedream/result-${post}.png`
      }] });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { principalReads += 1; return linkedAttempt(attemptId); } };
  const uploadService = new OwnerSeedreamImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: options.now });
  const service = new OwnerSeedreamImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input: { variant: string; cost_inputs: Readonly<Record<string, string | number>>; request_fingerprint: string }) => {
      calls.preflights += 1; events.push(`preflight-${calls.preflights}`); preflightInputs.push(input);
      return options.preflight?.(input.variant, calls.preflights) ?? freshPreflight(input.variant, options.now?.() ?? Date.now());
    }, now: options.now ?? Date.now, pollDelayMs: 0, maxPollAttempts: 1, wait: async () => undefined });
  return { calls, events, transactions, preflightInputs, client, uploadService, service,
    get principalReads() { return principalReads; } };
}

test("Seedream 4 generation uses two fresh preflights, one POST, and exact history/result reads", async () => {
  const events: string[] = [];
  const bodies: Array<{ ai_name: string | null; settings: Record<string, unknown> }> = [];
  let preflightCount = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-seedream-generation-credential");
  } }, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats") {
      events.push("chat");
      assert.equal(init?.method, "POST");
      return Response.json({ uuid: "seedream-chat-01" });
    }
    if (url.pathname === "/api/v1/design/generate") {
      events.push("post");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as { settings: Record<string, unknown> };
      bodies.push({ ai_name: url.searchParams.get("ai_name"), settings: body.settings });
      return Response.json({ id: "seedream-owner-echo-01" });
    }
    if (url.pathname === "/api/v1/chats/seedream-chat-01/messages") {
      events.push("history");
      return Response.json({ messages: [
        { id: "seedream-owner-echo-01", chat_id: 9001, author_id: 100,
          message_object: [{ id: "seedream-owner-text-01", message_id: "seedream-owner-echo-01", object_type: "text", model_type: "seedream-4" }] },
        { id: "seedream-bot-result-01", chat_id: 9001, author_id: -1,
          message_object: [{ id: "seedream-image-object-01", message_id: "seedream-bot-result-01", object_type: "image", model_type: "seedream-4" }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    if (url.pathname === "/api/v1/chats/seedream-chat-01/seedream-bot-result-01") {
      events.push("result");
      return Response.json({ id: "seedream-bot-result-01", chat_id: 9001, author_id: -1,
        message_object: [{ id: "seedream-image-object-01", message_id: "seedream-bot-result-01", object_type: "image",
          model_type: "seedream-4", completed: true, object_url: "https://r2.syntx.ai/seedream/result-01.png" }] });
    }
    throw new Error(`Unexpected synthetic route ${url.pathname}`);
  } });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const uploadService = new OwnerSeedreamImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client });
  const service = new OwnerSeedreamImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input: { variant: string; cost_inputs: Readonly<Record<string, string | number>> }) => {
      preflightCount += 1;
      events.push(`preflight-${preflightCount}`);
      assert.deepEqual(input.cost_inputs, {});
      return freshPreflight(input.variant);
    }, pollDelayMs: 0, maxPollAttempts: 1, wait: async () => undefined });
  try {
    const result = await service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: [],
      parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null }, prompt: "synthetic prompt" });
    assert.deepEqual(events, ["preflight-1", "chat", "preflight-2", "post", "history", "result"]);
    assert.equal(preflightCount, 2);
    assert.deepEqual(bodies, [{ ai_name: "seedream", settings: { aspect_ratio: "1:1", resolution: "2K", stream: false, n: 1, model_type: "seedream-4", file_urls: [] } }]);
    assert.equal(result.status, "result_observed");
    assert.equal(result.variant, "seedream-4");
    assert.equal(result.namespace_confidence, "SOURCE_SHAPED_UNVERIFIED");
    assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(result.artifact.geometry_verified, false);
  } finally {
    await service.close();
  }
});

test("exports exact frozen Seedream history and result reason arrays from the native unions", async () => {
  const module = await import("../src/application/owner-seedream-image-generation-service.js") as Record<string, unknown>;
  const historyReasons = [
    "INVALID_INPUT", "HISTORY_INCOMPLETE", "HISTORY_SHAPE_INVALID", "HISTORY_PAGE_INVALID", "CHAT_SCOPE_MISMATCH",
    "PROVIDER_CHAT_INVALID", "HISTORY_EMPTY", "HISTORY_MESSAGE_SET_INVALID", "MESSAGE_ID_INVALID", "MESSAGE_ID_DUPLICATE",
    "MESSAGE_CHAT_MISMATCH", "OBJECT_ID_INVALID", "OBJECT_ID_DUPLICATE", "OWNER_ACK_NOT_FOUND", "OWNER_ACK_MISMATCH",
    "OWNER_ACK_AMBIGUOUS", "OWNER_OBJECTS_INVALID", "BOT_MESSAGE_NOT_FOUND", "BOT_MESSAGE_AMBIGUOUS",
    "BOT_MESSAGE_BEFORE_ACK", "BOT_OBJECTS_INVALID", "BOT_MODEL_MISMATCH"
  ];
  const resultReasons = [
    "NO_RESULT_OBJECTS", "RESULT_NOT_COMPLETED", "RESPONSE_SHAPE_INVALID", "OUTER_MESSAGE_MISMATCH",
    "PROVIDER_CHAT_MISMATCH", "NOT_BOT_MESSAGE", "RESULT_OBJECT_CARDINALITY_INVALID", "RESULT_OBJECT_SHAPE_INVALID",
    "OBJECT_ID_MISMATCH", "OBJECT_MESSAGE_MISMATCH", "OBJECT_TYPE_MISMATCH", "MODEL_TYPE_UNAVAILABLE",
    "MODEL_TYPE_MISMATCH", "RESULT_URL_UNSAFE"
  ];
  assert.deepEqual(module.OWNER_SEEDREAM_IMAGE_GENERATION_HISTORY_REASONS, historyReasons);
  assert.deepEqual(module.OWNER_SEEDREAM_IMAGE_GENERATION_RESULT_REASONS, resultReasons);
  assert.equal(Object.isFrozen(module.OWNER_SEEDREAM_IMAGE_GENERATION_HISTORY_REASONS), true);
  assert.equal(Object.isFrozen(module.OWNER_SEEDREAM_IMAGE_GENERATION_RESULT_REASONS), true);
  assert.equal(new Set(historyReasons).size, historyReasons.length);
  assert.equal(new Set(resultReasons).size, resultReasons.length);
});

test("rejects a stale second preflight before the sole Seedream POST", async () => {
  const rig = createRig({ preflight: (variant, call) => freshPreflight(variant, Date.now() - (call === 2 ? 60_000 : 0)) });
  try {
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: [],
      parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null }, prompt: "stale second preflight" }),
    (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.deepEqual(rig.events, ["preflight-1", "chat", "preflight-2"]);
    assert.equal(rig.calls.posts, 0);
  } finally { await rig.service.close(); }
});

test("reconciles an unknown acknowledged request through exact history and result GETs without another POST", async () => {
  const rig = createRig({ pendingHistoryFirst: true });
  try {
    let recoveryId = "";
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: [],
      parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null }, prompt: "history arrives later" }),
    (error: unknown) => {
      if (!(error instanceof OwnerSeedreamImageGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      recoveryId = error.recovery_id ?? "";
      return recoveryId.length > 0;
    });
    assert.equal(rig.calls.posts, 1);
    assert.equal((await rig.service.listRecoveries({ attemptId: ATTEMPT }))[0]?.recovery_id, recoveryId);
    const result = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "result_observed");
    assert.equal(rig.calls.posts, 1);
    assert.equal(rig.calls.histories, 2);
    assert.equal(rig.calls.results, 1);
    assert.deepEqual(rig.events.filter((event) => event === "post" || event === "history" || event === "result"),
      ["post", "history", "history", "result"]);
  } finally { await rig.service.close(); }
});

test("keeps an acknowledged pending-history recovery GET-only after the source TTL", async () => {
  let now = Date.now();
  const rig = createRig({ now: () => now, pendingHistoryFirst: true });
  const source = png15(255, false, 31);
  const parameters = { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null } as const;
  let recoveryId = "";
  try {
    const uploaded = await rig.uploadService.upload({ attemptId: ATTEMPT, variant: "seedream-4",
      content_base64: source.toString("base64"), filename: "long-job-source.png", mime_type: "image/png" });
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4",
      reference_handles: [uploaded.reference_handle], parameters, prompt: "pending Seedream history past source TTL" }), (error: unknown) => {
      if (!(error instanceof OwnerSeedreamImageGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      recoveryId = error.recovery_id ?? "";
      return /^seedream_image_recovery_[0-9a-f-]{36}$/u.test(recoveryId);
    });
    assert.deepEqual(rig.calls, { uploads: 1, chats: 1, posts: 1, histories: 1, results: 0, preflights: 2 });
    const readsBeforeRecovery = rig.principalReads;
    const historyBeforeRecovery = rig.calls.histories;
    const resultsBeforeRecovery = rig.calls.results;
    now += 16 * 60_000;

    const recovered = await rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });

    assert.equal(recovered.status, "result_observed");
    assert.equal(recovered.variant, "seedream-4");
    assert.equal(recovered.reference_count, 1);
    assert.equal(recovered.artifact.url, "https://r2.syntx.ai/seedream/result-1.png");
    assert.equal(rig.calls.uploads, 1, "GET recovery must not upload again");
    assert.equal(rig.calls.chats, 1, "GET recovery must keep the original chat");
    assert.equal(rig.calls.posts, 1, "GET recovery must not repeat generation");
    assert.equal(rig.calls.histories, historyBeforeRecovery + 1);
    assert.equal(rig.calls.results, resultsBeforeRecovery + 1);
    assert.ok(rig.principalReads > readsBeforeRecovery, "reconciliation re-reads the same linked principal");
    assert.deepEqual(rig.events.slice(-2), ["history", "result"]);
  } finally { await rig.service.close(); }
});

test("dispatches all 104 source ratio/resolution pairs and derives Pro zero-reference cost inputs", async () => {
  const rig = createRig();
  const ratios = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
  const variants = [
    ["seedream-4", ["1K", "2K", "4K"]],
    ["seedream-4.5", ["2K", "4K"]],
    ["seedream-5", ["2K", "3K", "4K"]],
    ["seedream-5.0-flash", ["1K", "1.5K", "2K"]],
    ["seedream-5.0-pro", ["1K", "2K"]]
  ] as const;
  const expected: Array<{ variant: string; ratio: string; resolution: string }> = [];
  try {
    for (const [variant, resolutions] of variants) {
      for (const resolution of resolutions) {
        for (const aspect_ratio of ratios) {
          const parameters = variant === "seedream-5.0-flash"
            ? { aspect_ratio, resolution, output_format: "jpeg" as const, background: "opaque" as const }
            : { aspect_ratio, resolution, output_format: null, background: null };
          await rig.service.generate({ attemptId: ATTEMPT, variant, reference_handles: [], parameters, prompt: `matrix ${variant} ${aspect_ratio} ${resolution}` });
          expected.push({ variant, ratio: aspect_ratio, resolution });
        }
      }
    }
    assert.equal(expected.length, 104);
    assert.equal(rig.calls.posts, 104);
    assert.equal(rig.calls.preflights, 208);
    assert.equal(rig.calls.histories, 104);
    assert.equal(rig.calls.results, 104);
    assert.equal(rig.transactions.size, 104);
    const posted = [...rig.transactions.values()];
    assert.deepEqual(posted.map(({ variant, settings }) => [variant, settings.aspect_ratio, settings.resolution]),
      expected.map(({ variant, ratio, resolution }) => [variant, ratio, resolution]));
    for (let index = 0; index < expected.length; index += 1) {
      const item = expected[index]!;
      const settings = posted[index]!.settings;
      assert.equal(settings.n, 1);
      assert.equal(settings.stream, false);
      assert.deepEqual(settings.file_urls, []);
      if (item.variant === "seedream-5.0-flash") {
        assert.equal(settings.output_format, "jpeg");
        assert.equal(settings.background, "opaque");
      } else {
        assert.equal(Object.hasOwn(settings, "output_format"), false);
        assert.equal(Object.hasOwn(settings, "background"), false);
      }
      for (const preflight of rig.preflightInputs.slice(index * 2, index * 2 + 2)) {
        assert.equal(preflight.variant, item.variant);
        assert.deepEqual(preflight.cost_inputs, item.variant === "seedream-5.0-pro"
          ? { batch_size: 0, resolution: item.resolution } : {});
      }
    }
  } finally { await rig.service.close(); }
});

test("accepts each variant's full source reference cap and preserves the Pro reference count", async () => {
  const rig = createRig();
  const limits = [["seedream-4", 4], ["seedream-4.5", 4], ["seedream-5", 14],
    ["seedream-5.0-flash", 10], ["seedream-5.0-pro", 10]] as const;
  try {
    for (const [variant, count] of limits) {
      const handles: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const variedSource = png15(128, false, 20 + index);
        const uploaded = await rig.uploadService.upload({ attemptId: ATTEMPT, variant,
          content_base64: variedSource.toString("base64"), filename: `${variant}-${index}.png`, mime_type: "image/png" });
        handles.push(uploaded.reference_handle);
      }
      try {
        await rig.service.generate({ attemptId: ATTEMPT, variant, reference_handles: handles,
          parameters: variant === "seedream-5.0-flash"
            ? { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "opaque" }
            : { aspect_ratio: "1:1", resolution: variant === "seedream-5.0-pro" ? "1K" : variant === "seedream-4" ? "1K" : "2K",
                output_format: null, background: null },
          prompt: `max source references ${variant}` });
      } catch (error) {
        assert.fail(`${variant} at its ${count}-reference cap failed with ${(error as { code?: unknown }).code ?? "untyped error"}; events=${rig.events.join(",")}`);
      }
    }
    assert.equal(rig.calls.uploads, 42);
    assert.equal(rig.calls.posts, 5);
    assert.equal(rig.calls.preflights, 10);
    assert.deepEqual([...rig.transactions.values()].map((entry) => (entry.settings.file_urls as readonly unknown[]).length), [4, 4, 14, 10, 10]);
    const proPreflights = rig.preflightInputs.filter((input) => input.variant === "seedream-5.0-pro");
    assert.equal(proPreflights.length, 2);
    assert.deepEqual(proPreflights[0]!.cost_inputs, { batch_size: 10, resolution: "1K" });
  } finally { await rig.service.close(); }
});

test("Flash output format and background branches use owned PNG alpha and reject unsupported or caller-declared proofs", async () => {
  const rig = createRig();
  try {
    await rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [],
      parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "jpeg", background: "opaque" }, prompt: "Flash jpeg opaque" });
    await rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [],
      parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "opaque" }, prompt: "Flash png opaque" });

    const alphaPng = png15(128);
    const owned = await rig.uploadService.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-flash",
      content_base64: alphaPng.toString("base64"), filename: "owned-alpha.png", mime_type: "image/png" });
    assert.equal(owned.source_alpha_eligible, true);
    await rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [owned.reference_handle],
      parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" }, prompt: "Flash owned alpha PNG" });

    const settings = [...rig.transactions.values()].map((entry) => entry.settings);
    assert.deepEqual(settings.map((item) => [item.output_format, item.background]), [
      ["jpeg", "opaque"], ["png", "opaque"], ["png", "transparent"]
    ]);
    assert.equal((settings[2]!.file_urls as readonly unknown[]).length, 1);
    assert.equal(rig.calls.posts, 3);

    const unsupportedPng = png15(128, true);
    const unsupported = await rig.uploadService.upload({ attemptId: ATTEMPT, variant: "seedream-5.0-flash",
      content_base64: unsupportedPng.toString("base64"), filename: "unsupported-orientation.png", mime_type: "image/png" });
    assert.equal(unsupported.source_alpha_confidence, "UNSUPPORTED_PNG_ALPHA_COMPOSITION");
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [unsupported.reference_handle],
      parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" }, prompt: "unsupported alpha" }),
    (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "INVALID_REQUEST");
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [],
      parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "jpeg", background: "transparent" }, prompt: "invalid JPEG transparency" }),
    (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "INVALID_REQUEST");
    assert.throws(() => rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-5.0-flash", reference_handles: [],
      parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "opaque", transparency_context: true } as never,
      prompt: "caller proof must be rejected" }),
    (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "INVALID_REQUEST");
    assert.equal(rig.calls.posts, 3);
  } finally { await rig.service.close(); }
});

test("unknown Seedream dispatch remains retained after the private TTL and prevents same-owner replay", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const rig = createRig({ now: () => now, failPost: true });
  const parameters = { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null };
  const request = { attemptId: ATTEMPT, variant: "seedream-4" as const, reference_handles: [], parameters, prompt: "same semantic generation" };
  let recoveryId = "";
  try {
    await assert.rejects(rig.service.generate(request), (error: unknown) => {
      if (!(error instanceof OwnerSeedreamImageGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN") return false;
      recoveryId = error.recovery_id ?? "";
      return /^seedream_image_recovery_[0-9a-f-]{36}$/u.test(recoveryId);
    });
    assert.equal(rig.calls.posts, 1);
    assert.equal((await rig.service.listRecoveries({ attemptId: ATTEMPT }))[0]?.recovery_id, recoveryId);

    now += 16 * 60_000;
    const retained = await rig.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(retained[0]?.recovery_id, recoveryId, "the bounded dispatched recovery does not expire with input state");
    const historyGets = rig.calls.histories;
    const resultGets = rig.calls.results;
    await assert.rejects(rig.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(rig.calls.histories, historyGets, "lost ACK has no existing owner echo witness for a history GET");
    assert.equal(rig.calls.results, resultGets);
    const relinked = { ...request, attemptId: "link_seedream_generation_service_9876543210" };
    await assert.rejects(rig.service.generate(relinked),
      (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(rig.calls.posts, 1);
    assert.equal(rig.calls.chats, 1);
  } finally {
    await rig.service.close();
    Date.now = originalNow;
  }
});

test("retains all 128 uncertain semantic intents without eviction or a 129th POST", async () => {
  const rig = createRig({ failPost: true });
  const parameters = { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null };
  try {
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: [], parameters,
        prompt: `uncertain semantic intent ${index}` }),
      (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
    }
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: [], parameters,
      prompt: "uncertain semantic intent 128" }),
    (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "SERVICE_BUSY");
    assert.equal(rig.calls.posts, 128);
    assert.equal(rig.calls.chats, 128);
    assert.equal(rig.calls.preflights, 256);
  } finally { await rig.service.close(); }
});

test("reference-set cache keeps the original upload expiry and refuses dispatch after that lifetime", async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const rig = createRig({ now: () => now });
  const source = png15(255, false, 27);
  const params = { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null };
  try {
    const uploaded = await rig.uploadService.upload({ attemptId: ATTEMPT, variant: "seedream-4",
      content_base64: source.toString("base64"), filename: "source.png", mime_type: "image/png" });
    const handles = [uploaded.reference_handle];
    await rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: handles, parameters: params, prompt: "before cache ttl" });
    now += 14 * 60_000;
    await rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: handles, parameters: params, prompt: "near original expiry" });
    assert.equal(rig.calls.posts, 2);
    now += 2 * 60_000;
    await assert.rejects(rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: handles,
      parameters: params, prompt: "after original expiry" }),
    (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError &&
      (error.code === "REFERENCE_EXPIRED" || error.code === "REFERENCE_UNAVAILABLE"));
    assert.equal(rig.calls.posts, 2);
  } finally {
    await rig.service.close();
    Date.now = originalNow;
  }
});

test("close aborts and drains an in-flight Seedream POST while preserving its unknown outcome", async () => {
  const rig = createRig({ holdPostUntilAbort: true });
  const generation = rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: [],
    parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null }, prompt: "close during POST" });
  for (let index = 0; index < 100 && rig.calls.posts === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(rig.calls.posts, 1);
  const closing = rig.service.close();
  await assert.rejects(generation,
    (error: unknown) => error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
  await closing;
  assert.equal(rig.calls.posts, 1);
});

test("attempt invalidation aborts and drains an in-flight Seedream POST before reference revocation completes", async () => {
  const rig = createRig({ holdPostUntilAbort: true });
  const generation = rig.service.generate({ attemptId: ATTEMPT, variant: "seedream-4", reference_handles: [],
    parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null }, prompt: "invalidate during POST" });
  for (let index = 0; index < 100 && rig.calls.posts === 0; index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(rig.calls.posts, 1);
  const invalidating = rig.service.invalidateAttempt(ATTEMPT);
  await assert.rejects(generation, (error: unknown) =>
    error instanceof OwnerSeedreamImageGenerationServiceError && error.code === "OUTCOME_UNKNOWN" && error.recovery_id === undefined);
  await invalidating;
  assert.equal(rig.calls.posts, 1);
  assert.deepEqual(await rig.service.listRecoveries({ attemptId: ATTEMPT }), []);
  await rig.service.close();
});
