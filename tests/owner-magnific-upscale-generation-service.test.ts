import assert from "node:assert/strict";
import test from "node:test";
import {
  OwnerMagnificUpscaleGenerationService,
  type OwnerMagnificUpscalePreflightInput,
  type OwnerMagnificUpscalePreflightResult
} from "../src/application/owner-magnific-upscale-generation-service.js";
import { OwnerMagnificUpscaleUploadService } from "../src/application/owner-magnific-upscale-upload-service.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import type { AuthBinding } from "../src/auth/types.js";

const ATTEMPT = "link_magnific_generation_service_123456";
const AUTH_BINDING = Object.freeze({ tenant_id: "magnific-generation-tenant", subject: "magnific-generation-subject" });
const PRINCIPAL = Object.freeze({
  tenant_id: AUTH_BINDING.tenant_id,
  subject_id: AUTH_BINDING.subject,
  connection_id: ATTEMPT
});
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const BASE_NOW = Date.now();
let NOW = BASE_NOW;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const PARAMETERS = Object.freeze({
  scale_factor: "2x",
  optimized_for: "films_n_photography",
  engine: "magnific_sparkle",
  creativity: 2,
  hdr: -3,
  resemblance: 4,
  fractality: 1,
  sharpen: 37,
  smart_grain: 28,
  ultra_detail: 61,
  flavor: "sublime"
} as const);

function linkedAttempt(attemptId: string, status: "LINKED" | "REVOKED" = "LINKED") {
  return {
    attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status,
    expires_at: new Date(NOW + 60 * 60_000).toISOString(),
    linked: status === "LINKED"
  };
}

function expectedSettings(variant: "creative" | "precision_v1" | "precision_v2", fileUrl: string) {
  return {
    n: 1,
    model_type: variant,
    width: 1,
    height: 1,
    scale_factor: "2x",
    optimized_for: "films_n_photography",
    engine: "magnific_sparkle",
    creativity: 2,
    hdr: -3,
    resemblance: 4,
    fractality: 1,
    sharpen: 37,
    smart_grain: 28,
    ultra_detail: 61,
    flavor: "sublime",
    file_urls: [{ type: "image", url: fileUrl }]
  };
}

function freshPreflight(variant: "creative" | "precision_v1" | "precision_v2"): OwnerMagnificUpscalePreflightResult {
  return {
    account: {
      balance: { unit: "tokens", available: null },
      subscription: { active: true, plan_type: "PAID", end_date: "2030-01-01T12:00:00", end_date_kind: "LOCAL_DATETIME" },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE,
      source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: new Date(NOW).toISOString()
    },
    model_access: {
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: variant,
      ai_name: "magnific",
      model_type: variant,
      account_read_live: true,
      parameter_keys: ["height", "scale_factor", "width"],
      parameters_redacted: true,
      access: true,
      cost: 1.25,
      discount_cost: null,
      free_remaining_generations: null,
      limit: null,
      show_warning: false,
      observed_at: new Date(NOW).toISOString()
    }
  };
}

test("native Magnific generation uploads, binds, preflights, posts once, correlates, and returns exact results for all variants", async () => {
  let currentVariant: "creative" | "precision_v1" | "precision_v2" = "creative";
  let uploadCalls = 0;
  let chatCalls = 0;
  let generationCalls = 0;
  let historyCalls = 0;
  let resultCalls = 0;
  let queueCalls = 0;
  let credentialCalls = 0;
  let preflightCalls = 0;
  let failGenerationPost = false;
  let delayHistoryOnce = false;
  let delayResultOnce = false;
  let denyPreflight = false;
  let wrongResultVariant = false;
  let expireOnResult = false;
  let expiryAfterResult = 0;
  let failHistoryOnce = false;
  let blockLinkStatus = false;
  let linkGate: Promise<void> | undefined;
  let signalLinkEntered: (() => void) | undefined;
  const getLinkedStatus = async (_binding: AuthBinding, attemptId: string) => {
    if (blockLinkStatus) {
      signalLinkEntered?.();
      await linkGate;
    }
    return linkedAttempt(attemptId);
  };
  let blockPreflight = false;
  let preflightEntries = 0;
  let preflightTarget = 1;
  let signalPreflightEntered: (() => void) | undefined;
  let releasePreflightGate: (() => void) | undefined;
  let preflightGate: Promise<void> | undefined;
  const events: string[] = [];
  const fileUrls: Record<"creative" | "precision_v1" | "precision_v2", string> = {
    creative: "https://r2.syntx.ai/magnific/input-creative.png",
    precision_v1: "https://r2.syntx.ai/magnific/input-precision-v1.png",
    precision_v2: "https://r2.syntx.ai/magnific/input-precision-v2.png"
  };
  const clients = new Map<string, SyntxChatHttpClient>();
  const ownerEchoByChat = new Map<string, string>();
  const createClient = () => new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
        credentialCalls += 1;
        return operation("synthetic-magnific-generation-credential");
      }
    },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats/upload-files") {
        uploadCalls += 1;
        events.push("upload");
        assert.equal(init?.method, "POST");
        assert.ok(init?.body instanceof FormData);
        assert.equal(init.body.get("destination"), "uploaded");
        assert.equal(init.body.get("check_duplicates"), "true");
        assert.equal(init.body.get("model_type"), currentVariant);
        const file = init.body.get("files");
        assert.ok(file instanceof File);
        return new Response(JSON.stringify({ files: [{
          id: `private-input-file-${uploadCalls}`,
          url: fileUrls[currentVariant],
          mime_type: "image/png",
          size: file.size
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname === "/api/v1/chats") {
        chatCalls += 1;
        events.push("chat");
        assert.equal(init?.method, "POST");
        assert.equal(JSON.parse(String(init?.body)).scope, "tool_image_upscaler");
        return new Response(JSON.stringify({ uuid: `magnific-chat-${chatCalls}` }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationCalls += 1;
        events.push("generation");
        assert.equal(init?.method, "POST");
        assert.equal(url.searchParams.get("ai_name"), "magnific");
        const body = JSON.parse(String(init?.body));
        assert.match(body.chat_uuid, /^magnific-chat-\d+$/u);
        assert.deepEqual(body.settings, expectedSettings(currentVariant, fileUrls[currentVariant]), JSON.stringify(body.settings));
        if (currentVariant === "creative" && chatCalls === 1) assert.equal(body.prompt, "Keep the fine edge detail.");
        else assert.equal(Object.hasOwn(body, "prompt"), false);
        if (failGenerationPost) throw new Error("synthetic connection loss after dispatch began");
        const echoId = `magnific-owner-echo-${generationCalls}`;
        ownerEchoByChat.set(body.chat_uuid, echoId);
        return new Response(JSON.stringify({ id: echoId }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
      if (url.pathname.endsWith("/messages")) {
        historyCalls += 1;
        events.push("history");
        if (failHistoryOnce) { failHistoryOnce = false; throw new Error("synthetic history read failure"); }
        assert.equal(url.searchParams.get("page"), "1");
        assert.equal(url.searchParams.get("page_size"), "10");
        const chatMatch = url.pathname.match(/^\/api\/v1\/chats\/(magnific-chat-\d+)\/messages$/u);
        assert.ok(chatMatch);
        const chatUuid = chatMatch[1]!;
        const chatNumber = Number(chatUuid.slice("magnific-chat-".length));
        const echoId = ownerEchoByChat.get(chatUuid);
        assert.ok(echoId);
        const botId = `magnific-bot-message-${chatNumber}`;
        const objectId = `magnific-image-object-${chatNumber}`;
        const objects = delayHistoryOnce ? [] : [{
          id: objectId, message_id: botId, object_type: "image", model_type: currentVariant
        }];
        if (delayHistoryOnce) delayHistoryOnce = false;
        return new Response(JSON.stringify({
          messages: [
            { id: echoId, chat_id: 700 + chatNumber, author_id: 12345, message_object: [] },
            { id: botId, chat_id: 700 + chatNumber, author_id: -1, message_object: objects }
          ],
          pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith("/inprogress")) {
        queueCalls += 1;
        events.push("queue");
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      const match = url.pathname.match(/^\/api\/v1\/chats\/(magnific-chat-\d+)\/(magnific-bot-message-\d+)$/u);
      assert.ok(match, `unexpected fake native route: ${url.pathname}`);
      resultCalls += 1;
      events.push("result");
      const index = Number(match[1]!.slice("magnific-chat-".length));
      const botId = match[2]!;
      if (expireOnResult) {
        expireOnResult = false;
        NOW = expiryAfterResult;
      }
      if (delayResultOnce) {
        delayResultOnce = false;
        return new Response(JSON.stringify({
          id: botId, chat_id: 700 + index, author_id: -1,
          message_object: [{ id: `magnific-image-object-${index}`, message_id: botId, object_type: "image",
            model_type: currentVariant, completed: false, object_url: `https://r2.syntx.ai/magnific/output-${currentVariant}.png` }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        id: botId,
        chat_id: 700 + index,
        author_id: -1,
        message_object: [{
          id: `magnific-image-object-${index}`,
          message_id: botId,
          object_type: "image",
          model_type: wrongResultVariant ? "creative" : currentVariant,
          completed: true,
          object_url: `https://r2.syntx.ai/magnific/output-${currentVariant}.png`
        }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const uploadService = new OwnerMagnificUpscaleUploadService({
    binding: AUTH_BINDING,
    linkService: { getStatus: getLinkedStatus } as never,
    catalog: CATALOG,
    catalogVersion: CATALOG_VERSION,
    resolveClient: (attemptId) => {
      let client = clients.get(attemptId);
      if (!client) { client = createClient(); clients.set(attemptId, client); }
      return client;
    },
    now: () => NOW
  });
  const preflightInputs: OwnerMagnificUpscalePreflightInput[] = [];
  const service = new OwnerMagnificUpscaleGenerationService({
    binding: AUTH_BINDING,
    linkService: { getStatus: getLinkedStatus } as never,
    catalog: CATALOG,
    catalogVersion: CATALOG_VERSION,
    uploadService,
    resolveChatClient: (attemptId) => clients.get(attemptId) ?? createClient(),
    preflight: async (input: OwnerMagnificUpscalePreflightInput) => {
      preflightCalls += 1;
      preflightInputs.push(input);
      events.push("preflight");
      if (blockPreflight) {
        preflightEntries += 1;
        if (preflightEntries >= preflightTarget) signalPreflightEntered?.();
        await preflightGate;
      }
      const response = freshPreflight(input.variant as typeof currentVariant);
      if (denyPreflight) response.model_access.access = false;
      return response;
    },
    now: () => NOW,
    pollDelayMs: 0,
    timeoutMs: 100
  });

  try {
    const cases = [
      { variant: "creative" as const, prompt: "Keep the fine edge detail." },
      { variant: "precision_v1" as const },
      { variant: "precision_v2" as const }
    ];
    for (const item of cases) {
      currentVariant = item.variant;
      const uploaded = await uploadService.upload({
        attemptId: ATTEMPT, variant: item.variant, content_base64: PNG,
        filename: `input-${item.variant}.png`, mime_type: "image/png"
      });
      const result = await service.generate({
        attemptId: ATTEMPT,
        variant: item.variant,
        image_handle: uploaded.image_handle,
        parameters: PARAMETERS,
        ...(item.prompt === undefined ? {} : { prompt: item.prompt })
      });
      assert.equal(result.status, "result_observed");
      assert.equal(result.backend_acceptance, "unproven");
      assert.equal(result.model_id, item.variant);
      assert.equal(result.variant, item.variant);
      assert.equal(result.requested_scale_factor, "2x");
      assert.deepEqual(result.input_image, {
        mime_type: "image/png", width: 1, height: 1, size: 68,
        sha256: uploaded.sha256, metadata_confidence: "CONTAINER_METADATA_ONLY"
      });
      assert.equal(result.actual_image.width, null);
      assert.equal(result.actual_image.height, null);
      assert.equal(result.geometry_verified, false);
      assert.deepEqual(result.artifact, {
        url: `https://r2.syntx.ai/magnific/output-${item.variant}.png`,
        mime_type: "image/png",
        mime_source: "URL_EXTENSION"
      });
      const serialized = JSON.stringify(result);
      for (const secret of ["magnific-private-chat", "magnific-owner-echo", "magnific-bot-message", "magnific-image-object", fileUrls[item.variant]]) {
        assert.equal(serialized.includes(secret), false);
      }
    }
    assert.equal(uploadCalls, 3);
    assert.equal(chatCalls, 3);
    assert.equal(generationCalls, 3);
    assert.equal(historyCalls, 3);
    assert.equal(resultCalls, 3);
    assert.equal(queueCalls, 0);
    assert.equal(preflightCalls, 6);
    assert.equal(credentialCalls, 15);
    assert.deepEqual(preflightInputs.map((input) => ({
      attemptId: input.attemptId,
      principal: input.principal,
      variant: input.variant,
      cost_inputs: input.cost_inputs
    })), Array.from({ length: 6 }, (_item, index) => ({
      attemptId: ATTEMPT,
      principal: PRINCIPAL,
      variant: cases[Math.floor(index / 2)]!.variant,
      cost_inputs: { width: 1, height: 1, scale_factor: "2x" }
    })));
    assert.ok(preflightInputs.every((input) => /^sha256:[a-f0-9]{64}$/u.test(input.request_fingerprint)));
    assert.equal(events.filter((event) => event === "generation").length, 3, "exactly one generation POST per variant");

    currentVariant = "precision_v1";
    delayHistoryOnce = true;
    delayResultOnce = true;
    const delayedUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "delayed.png", mime_type: "image/png"
    });
    const callerParameters = { ...PARAMETERS, creativity: Number(PARAMETERS.creativity) };
    const delayedPromise = service.generate({ attemptId: ATTEMPT, variant: currentVariant, image_handle: delayedUpload.image_handle, parameters: callerParameters });
    callerParameters.creativity = 9;
    const delayed = await delayedPromise;
    assert.equal(delayed.status, "result_observed");
    assert.equal(historyCalls, 5, "pending bot history is retried before exact result reads");
    assert.equal(queueCalls, 1, "pending history consults in-progress state without treating it as binding");
    assert.equal(resultCalls, 5, "incomplete exact result remains pending and is fetched again");

    const beforeDenied = { chatCalls, generationCalls };
    denyPreflight = true;
    const deniedUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "denied.png", mime_type: "image/png"
    });
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: currentVariant, image_handle: deniedUpload.image_handle, parameters: PARAMETERS }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "PREFLIGHT_FAILED");
    assert.deepEqual({ chatCalls, generationCalls }, beforeDenied, "denied preflight stops before chat creation and dispatch");
    denyPreflight = false;

    const invalidParameterCases = [
      { variant: "precision_v1" as const, parameters: { ...PARAMETERS, scale_factor: "4x" } },
      { variant: "precision_v2" as const, parameters: { ...PARAMETERS, scale_factor: "4x", flavor: "photo" } }
    ];
    for (const invalidCase of invalidParameterCases) {
      currentVariant = invalidCase.variant;
      const parameterUpload = await uploadService.upload({
        attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
        filename: `invalid-${currentVariant}.png`, mime_type: "image/png"
      });
      const beforeInvalidParameters: { chatCalls: number; generationCalls: number } = { chatCalls, generationCalls };
      await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: currentVariant,
        image_handle: parameterUpload.image_handle, parameters: invalidCase.parameters }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "INVALID_REQUEST");
      assert.deepEqual({ chatCalls, generationCalls }, beforeInvalidParameters, "variant-invalid settings stop before chat/dispatch");
      const corrected = await service.generate({ attemptId: ATTEMPT, variant: currentVariant,
        image_handle: parameterUpload.image_handle, parameters: PARAMETERS });
      assert.equal(corrected.status, "result_observed", "corrected settings may reuse the untouched owned image handle");
      assert.equal(generationCalls, beforeInvalidParameters.generationCalls + 1);
    }

    currentVariant = "creative";
    const expiringUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "expires-during-result.png", mime_type: "image/png"
    });
    expireOnResult = true;
    expiryAfterResult = NOW + 15 * 60_000 + 1;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: currentVariant, image_handle: expiringUpload.image_handle, parameters: PARAMETERS }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "OUTCOME_UNKNOWN");
    assert.equal(generationCalls, 7, "result arriving after original owned-image TTL is not returned");
    NOW = BASE_NOW;

    currentVariant = "creative";
    const concurrentUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "concurrent.png", mime_type: "image/png"
    });
    const concurrentInput = { attemptId: ATTEMPT, variant: currentVariant, image_handle: concurrentUpload.image_handle, parameters: PARAMETERS };
    let entered!: () => void;
    let release!: () => void;
    const enteredGate = new Promise<void>((resolve) => { entered = resolve; });
    preflightGate = new Promise<void>((resolve) => { release = resolve; });
    signalPreflightEntered = entered;
    releasePreflightGate = release;
    preflightEntries = 0;
    preflightTarget = 1;
    blockPreflight = true;
    const generationCountBeforeConcurrent = generationCalls;
    const firstConcurrent = service.generate(concurrentInput);
    await enteredGate;
    await assert.rejects(service.generate(concurrentInput),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "IMAGE_HANDLE_ALREADY_USED");
    await assert.rejects(service.generate(concurrentInput),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "IMAGE_HANDLE_ALREADY_USED");
    assert.equal(generationCalls, generationCountBeforeConcurrent, "competing calls do not dispatch while the first owns the claim");
    releasePreflightGate?.();
    blockPreflight = false;
    await firstConcurrent;
    await assert.rejects(service.generate(concurrentInput),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "IMAGE_HANDLE_ALREADY_USED");
    assert.equal(generationCalls, generationCountBeforeConcurrent + 1, "one reserved handle reaches exactly one POST");
    preflightGate = undefined;
    signalPreflightEntered = undefined;
    releasePreflightGate = undefined;

    currentVariant = "precision_v1";
    wrongResultVariant = true;
    const mismatchUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "mismatch.png", mime_type: "image/png"
    });
    let mismatch: unknown;
    try {
      await service.generate({ attemptId: ATTEMPT, variant: currentVariant, image_handle: mismatchUpload.image_handle, parameters: PARAMETERS });
    } catch (error) { mismatch = error; }
    assert.equal((mismatch as { code?: string }).code, "OUTCOME_UNKNOWN");
    assert.equal((mismatch as { diagnostic?: { result_status?: string; result_reason?: string } }).diagnostic?.result_status, "UNVERIFIED");
    assert.equal((mismatch as { diagnostic?: { result_reason?: string } }).diagnostic?.result_reason, "MODEL_TYPE_MISMATCH");
    assert.equal((mismatch as { diagnostic?: { model_eq_requested?: boolean } }).diagnostic?.model_eq_requested, false);
    assert.equal((mismatch as { diagnostic?: { model_eq_family?: boolean } }).diagnostic?.model_eq_family, true);
    wrongResultVariant = false;

    currentVariant = "creative";
    failGenerationPost = true;
    const ambiguousUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "ambiguous.png", mime_type: "image/png"
    });
    let unknown: unknown;
    try {
      await service.generate({ attemptId: ATTEMPT, variant: currentVariant, image_handle: ambiguousUpload.image_handle, parameters: PARAMETERS });
    } catch (error) { unknown = error; }
    assert.ok(unknown instanceof Error);
    assert.equal((unknown as { code?: string }).code, "OUTCOME_UNKNOWN");
    const recoveryId = (unknown as { recovery_id?: string }).recovery_id;
    assert.match(String(recoveryId), /^magnific_recovery_[0-9a-f-]{36}$/u);
    assert.equal((unknown as { diagnostic?: { phase?: string; post_started?: boolean; echo_ack_known?: boolean } }).diagnostic?.phase, "GENERATION_POST");
    assert.equal((unknown as { diagnostic?: { post_started?: boolean } }).diagnostic?.post_started, true);
    assert.equal((unknown as { diagnostic?: { echo_ack_known?: boolean } }).diagnostic?.echo_ack_known, false);
    assert.equal(historyCalls, 10, "ambiguous POST without acknowledgement must not guess an echo or read history");
    const recoveries = await service.listRecoveries({ attemptId: ATTEMPT, limit: 5 });
    const noAckRecovery = recoveries.find((item) => item.recovery_id === recoveryId);
    assert.ok(noAckRecovery);
    assert.equal(noAckRecovery.diagnostic.echo_ack_known, false);
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId! }), (error: unknown) =>
      error instanceof Error && (error as { code?: string }).code === "OUTCOME_UNKNOWN");
    assert.equal(generationCalls, 10, "reconciliation must never issue a second POST");
    assert.equal(historyCalls, 10, "no ACK means reconciliation performs no guessed GET");

    failGenerationPost = false;
    currentVariant = "creative";
    const capacityUploads = [];
    for (let index = 0; index < 4; index += 1) {
      capacityUploads.push(await uploadService.upload({
        attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
        filename: `pending-${index}.png`, mime_type: "image/png"
      }));
    }
    let capacityEntered!: () => void;
    let releaseCapacity!: () => void;
    const capacityGateEntered = new Promise<void>((resolve) => { capacityEntered = resolve; });
    preflightGate = new Promise<void>((resolve) => { releaseCapacity = resolve; });
    signalPreflightEntered = capacityEntered;
    releasePreflightGate = releaseCapacity;
    preflightEntries = 0;
    preflightTarget = 4;
    blockPreflight = true;
    const beforeCapacityPosts = generationCalls;
    const capacityRuns = capacityUploads.map((uploaded) => service.generate({
      attemptId: ATTEMPT, variant: currentVariant, image_handle: uploaded.image_handle, parameters: PARAMETERS
    }));
    await capacityGateEntered;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: currentVariant,
      image_handle: "magnific_image_00000000-0000-4000-8000-000000000000", parameters: PARAMETERS }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "SERVICE_BUSY");
    releaseCapacity();
    blockPreflight = false;
    await Promise.all(capacityRuns);
    assert.equal(generationCalls, beforeCapacityPosts + 4, "four in-flight slots complete once; a fifth is rejected before work");

    currentVariant = "creative";
    failHistoryOnce = true;
    const reconUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "reconcile-budget.png", mime_type: "image/png"
    });
    let historyUnknown: unknown;
    try {
      await service.generate({ attemptId: ATTEMPT, variant: currentVariant, image_handle: reconUpload.image_handle, parameters: PARAMETERS });
    } catch (error) { historyUnknown = error; }
    assert.equal((historyUnknown as { code?: string }).code, "OUTCOME_UNKNOWN");
    const historyRecoveryId = (historyUnknown as { recovery_id?: string }).recovery_id;
    assert.equal((historyUnknown as { diagnostic?: { echo_ack_known?: boolean } }).diagnostic?.echo_ack_known, true);
    let linkEntered!: () => void;
    let releaseLink!: () => void;
    const linkEnteredPromise = new Promise<void>((resolve) => { linkEntered = resolve; });
    linkGate = new Promise<void>((resolve) => { releaseLink = resolve; });
    signalLinkEntered = linkEntered;
    blockLinkStatus = true;
    const beforeSlowReconcile = { generationCalls, historyCalls };
    const slowReconcile = service.reconcile({ attemptId: ATTEMPT, recovery_id: historyRecoveryId! });
    const observedSlowReconcile = slowReconcile.then(
      (value) => ({ value, error: undefined as unknown }),
      (error: unknown) => ({ value: undefined, error })
    );
    await linkEnteredPromise;
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    const slowReconcileError = (await observedSlowReconcile).error;
    assert.equal((slowReconcileError as { code?: string }).code, "OUTCOME_UNKNOWN");
    await service.invalidateAttempt(ATTEMPT);
    blockLinkStatus = false;
    releaseLink();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assert.deepEqual({ generationCalls, historyCalls }, beforeSlowReconcile, "expired reconcile and late revoked link read start no GET or POST");

    currentVariant = "creative";
    failHistoryOnce = true;
    const longJobUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "long-job-recovery.png", mime_type: "image/png"
    });
    let longJobUnknown: unknown;
    try {
      await service.generate({ attemptId: ATTEMPT, variant: currentVariant,
        image_handle: longJobUpload.image_handle, parameters: PARAMETERS });
    } catch (error) { longJobUnknown = error; }
    assert.equal((longJobUnknown as { code?: string }).code, "OUTCOME_UNKNOWN");
    const longJobRecoveryId = (longJobUnknown as { recovery_id?: string }).recovery_id;
    assert.ok(longJobRecoveryId);
    const longJobCounts = { uploadCalls, generationCalls, historyCalls, resultCalls };
    NOW = BASE_NOW + 16 * 60_000;
    const recoveredLongJob = await service.reconcile({ attemptId: ATTEMPT, recovery_id: longJobRecoveryId! });
    assert.equal(recoveredLongJob.status, "result_observed", "a linked owner can recover the same dispatched result after 15 minutes");
    assert.equal(recoveredLongJob.artifact.url, "https://r2.syntx.ai/magnific/output-creative.png");
    assert.deepEqual({ uploadCalls, generationCalls },
      { uploadCalls: longJobCounts.uploadCalls, generationCalls: longJobCounts.generationCalls },
      "long-job recovery performs no upload or generation POST replay");
    assert.equal(historyCalls, longJobCounts.historyCalls + 1, "long-job recovery correlates the existing owner echo through GET");
    assert.equal(resultCalls, longJobCounts.resultCalls + 1, "long-job recovery reads the same bound result through GET");
    NOW = BASE_NOW;
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: currentVariant,
      image_handle: longJobUpload.image_handle, parameters: PARAMETERS }),
    (error: unknown) => error instanceof Error && (error as { code?: string }).code === "IMAGE_HANDLE_ALREADY_USED");
    assert.equal(generationCalls, longJobCounts.generationCalls, "completed one-shot claim remains consumed after recovery");

    for (let index = 0; index < 200; index += 1) {
      await service.invalidateAttempt(`link_idle_${String(index).padStart(4, "0")}_xxxxxxxxxxxxxxxx`);
    }
    await service.listRecoveries({ attemptId: ATTEMPT, limit: 1 });
    for (let index = 0; index < 127; index += 1) {
      const attemptId = `link_capacity_${String(index).padStart(4, "0")}_xxxxxxxxxxxxxxxx`;
      await service.listRecoveries({ attemptId, limit: 1 });
    }
    await assert.rejects(service.listRecoveries({ attemptId: "link_capacity_0127_xxxxxxxxxxxxxxxx", limit: 1 }),
      (error: unknown) => error instanceof Error && (error as { code?: string }).code === "SERVICE_BUSY");

    const revokeUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "revoke-pending.png", mime_type: "image/png"
    });
    let revokeEntered!: () => void;
    let releaseRevoke!: () => void;
    const revokeGateEntered = new Promise<void>((resolve) => { revokeEntered = resolve; });
    preflightGate = new Promise<void>((resolve) => { releaseRevoke = resolve; });
    signalPreflightEntered = revokeEntered;
    releasePreflightGate = releaseRevoke;
    preflightEntries = 0;
    preflightTarget = 1;
    blockPreflight = true;
    const beforeRevokePosts = generationCalls;
    const revokedGeneration = service.generate({ attemptId: ATTEMPT, variant: currentVariant, image_handle: revokeUpload.image_handle, parameters: PARAMETERS });
    await revokeGateEntered;
    await service.invalidateAttempt(ATTEMPT);
    releaseRevoke();
    blockPreflight = false;
    await assert.rejects(revokedGeneration);
    assert.equal(generationCalls, beforeRevokePosts, "revocation aborts blocked preflight before dispatch");

    const closeUpload = await uploadService.upload({
      attemptId: ATTEMPT, variant: currentVariant, content_base64: PNG,
      filename: "close-pending.png", mime_type: "image/png"
    });
    let closeEntered!: () => void;
    let releaseClose!: () => void;
    const closeGateEntered = new Promise<void>((resolve) => { closeEntered = resolve; });
    preflightGate = new Promise<void>((resolve) => { releaseClose = resolve; });
    signalPreflightEntered = closeEntered;
    releasePreflightGate = releaseClose;
    preflightEntries = 0;
    blockPreflight = true;
    const beforeClosePosts = generationCalls;
    const closingGeneration = service.generate({ attemptId: ATTEMPT, variant: currentVariant, image_handle: closeUpload.image_handle, parameters: PARAMETERS });
    await closeGateEntered;
    await service.close();
    releaseClose();
    blockPreflight = false;
    await assert.rejects(closingGeneration);
    assert.equal(generationCalls, beforeClosePosts, "close drains and blocks late work before dispatch");
  } finally {
    await service.close();
  }
});
