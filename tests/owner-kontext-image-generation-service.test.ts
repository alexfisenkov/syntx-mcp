import assert from "node:assert/strict";
import test from "node:test";
import {
  OWNER_KONTEXT_IMAGE_GENERATION_ERROR_CODES,
  OWNER_KONTEXT_IMAGE_GENERATION_PHASES,
  OWNER_KONTEXT_IMAGE_GENERATION_RESULT_REASONS,
  OwnerKontextImageGenerationService,
  OwnerKontextImageGenerationServiceError,
  type OwnerKontextImageGenerationResult,
  type OwnerKontextImageGenerationPreflightInput,
  type OwnerKontextImageGenerationPreflightResult
} from "../src/application/owner-kontext-image-generation-service.js";
import { OwnerKontextImageUploadService } from "../src/application/owner-kontext-image-upload-service.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import type { OwnerKontextImageParameters } from "../src/application/owner-kontext-image-parameters.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

test("generation diagnostics expose only the closed owner lifecycle phases", () => {
  assert.deepEqual(OWNER_KONTEXT_IMAGE_GENERATION_PHASES, [
    "REQUEST_PREPARE", "PREFLIGHT", "CHAT_CREATE", "GENERATION_POST", "POST_ACK_KNOWN",
    "HISTORY_GET", "HISTORY_BINDING", "IN_PROGRESS_GET", "RESULT_GET", "RESULT_BINDING", "RESULT_WAIT"
  ]);
  assert.equal(new Set(OWNER_KONTEXT_IMAGE_GENERATION_PHASES).size, OWNER_KONTEXT_IMAGE_GENERATION_PHASES.length);
  assert.equal(new Set(OWNER_KONTEXT_IMAGE_GENERATION_ERROR_CODES).size, OWNER_KONTEXT_IMAGE_GENERATION_ERROR_CODES.length);
  assert.equal(new Set(OWNER_KONTEXT_IMAGE_GENERATION_RESULT_REASONS).size, OWNER_KONTEXT_IMAGE_GENERATION_RESULT_REASONS.length);
});

const ATTEMPT = "link_kontext_generation_service_012345";
const BINDING = Object.freeze({ tenant_id: "kontext-generation-tenant", subject: "kontext-generation-subject" });
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const NOW = Date.now();
const PARAMETERS = Object.freeze({ resolution: "1024x1024", cfg: 1.05, steps: 10.5, image_strength: 0.123 });

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

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED",
    expires_at: new Date(NOW + 60 * 60_000).toISOString(), linked: true };
}

function freshPreflight(variant: "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi"): OwnerKontextImageGenerationPreflightResult {
  return {
    account: {
      balance: { unit: "tokens", available: null },
      subscription: { active: true, plan_type: "PAID", end_date: null, end_date_kind: null },
      contract_evidence: ACCOUNT_CONTRACT_EVIDENCE,
      source_build: ACCOUNT_SOURCE_BUILD,
      observed_at: new Date(NOW).toISOString()
    },
    model_access: {
      catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
      catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
      model_id: variant, ai_name: "flux", model_type: variant, account_read_live: true,
      parameter_keys: [], parameters_redacted: true, access: true, cost: 1,
      discount_cost: null, free_remaining_generations: null, limit: null,
      show_warning: false, observed_at: new Date(NOW).toISOString()
    }
  };
}

function freshPreflightAt(variant: "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi", now: number): OwnerKontextImageGenerationPreflightResult {
  const result = freshPreflight(variant);
  const observedAt = new Date(now).toISOString();
  return { account: { ...result.account, observed_at: observedAt },
    model_access: { ...result.model_access, observed_at: observedAt } };
}

test("native owner generation runs one fixed image request and returns only exact bound result metadata", async () => {
  let preflightCalls = 0;
  let chatCalls = 0;
  let generationPosts = 0;
  let historyGets = 0;
  let resultGets = 0;
  let credentialCalls = 0;
  const variant = "flux-kontext-pro" as const;
  let currentVariant: "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi" = variant;
  let currentParameters: OwnerKontextImageParameters = PARAMETERS;
  let currentPrompt = "Preserve the original composition.";
  const client = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
        credentialCalls += 1;
        return operation("synthetic-kontext-generation-credential");
      }
    },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats") {
        chatCalls += 1;
        assert.equal(init?.method, "POST");
        const chatBody = JSON.parse(String(init?.body));
        assert.equal(chatBody.scope, "image");
        assert.match(chatBody.title, /^owner-kontext-[0-9a-f-]{36}$/u);
        return Response.json({ uuid: `kontext-chat-${chatCalls}` });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationPosts += 1;
        assert.equal(url.searchParams.get("ai_name"), "flux");
        assert.equal(init?.method, "POST");
        const body = JSON.parse(String(init?.body));
        assert.deepEqual(body, {
          chat_uuid: `kontext-chat-${generationPosts}`, prompt: currentPrompt,
          settings: { n: 1, model_type: currentVariant, workflow_type: "default", civitai_loras: [],
            resolution: currentParameters.resolution, cfg: currentParameters.cfg, steps: currentParameters.steps,
            image_strength: currentParameters.image_strength, file_urls: [] }
        });
        return Response.json({ id: `kontext-owner-echo-${generationPosts}` });
      }
      const historyMatch = url.pathname.match(/^\/api\/v1\/chats\/(kontext-chat-\d+)\/messages$/u);
      if (historyMatch) {
        historyGets += 1;
        const index = Number(historyMatch[1]!.slice("kontext-chat-".length));
        const echoId = `kontext-owner-echo-${index}`;
        const botId = `kontext-bot-message-${index}`;
        const objectId = `kontext-image-object-${index}`;
        return Response.json({
          messages: [
            { id: echoId, chat_id: 700 + index, author_id: 12345, message_object: [] },
            { id: botId, chat_id: 700 + index, author_id: -1,
              message_object: [{ id: objectId, message_id: botId, object_type: "image", model_type: currentVariant }] }
          ],
          pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false }
        });
      }
      const resultMatch = url.pathname.match(/^\/api\/v1\/chats\/(kontext-chat-\d+)\/(kontext-bot-message-\d+)$/u);
      if (resultMatch) {
        resultGets += 1;
        const index = Number(resultMatch[1]!.slice("kontext-chat-".length));
        const botId = resultMatch[2]!;
        const objectId = `kontext-image-object-${index}`;
        return Response.json({
          id: botId, chat_id: 700 + index, author_id: -1,
          message_object: [{ id: objectId, message_id: botId, object_type: "image",
            model_type: currentVariant, completed: true, object_url: "https://r2.syntx.ai/kontext/output.png" }]
        });
      }
      throw new Error(`Unexpected native URL ${url.pathname}`);
    }
  });
  const uploadService = new OwnerKontextImageUploadService({
    binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
  const preflightInputs: OwnerKontextImageGenerationPreflightInput[] = [];
  const service = new OwnerKontextImageGenerationService({
    binding: BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    uploadService,
    resolveChatClient: () => client,
    preflight: async (input: OwnerKontextImageGenerationPreflightInput) => {
      preflightInputs.push(input);
      preflightCalls += 1;
      return freshPreflight(input.variant);
    },
    now: () => NOW,
    timeoutMs: 100,
    pollDelayMs: 0
  });
  try {
    const callerParameters = { resolution: PARAMETERS.resolution, cfg: Number(PARAMETERS.cfg),
      steps: Number(PARAMETERS.steps), image_strength: Number(PARAMETERS.image_strength) };
    const callerHandles: string[] = [];
    const callerInput = { attemptId: ATTEMPT, variant, reference_handles: callerHandles, parameters: callerParameters,
      prompt: "Preserve the original composition.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const };
    const outcomePromise = service.generate(callerInput).then((result) => ({ result }), (error: unknown) => ({ error }));
    callerParameters.cfg = 4;
    callerHandles.push("kontext_image_00000000-0000-4000-8000-000000000000");
    callerInput.prompt = "Mutated after the call began.";
    const outcome = await outcomePromise;
    assert.ok("result" in outcome, `generation failed after preflight=${preflightCalls} chat=${chatCalls} post=${generationPosts} history=${historyGets} result=${resultGets} error=${String((outcome as { error?: unknown }).error)}`);
    const result = outcome.result;
    assert.equal(result.status, "result_observed");
    assert.equal(result.backend_acceptance, "unproven");
    assert.equal(result.variant, variant);
    assert.equal(result.reference_count, 0);
    assert.deepEqual(result.input_images, []);
    assert.deepEqual(result.parameters, PARAMETERS);
    assert.deepEqual(Object.keys(result.parameters).sort(), ["cfg", "image_strength", "resolution", "steps"]);
    assert.equal(result.requested_resolution, PARAMETERS.resolution);
    assert.equal(result.workflow_policy, "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA");
    assert.equal(result.actual_image.width, null);
    assert.equal(result.actual_image.height, null);
    assert.equal(result.geometry_verified, false);
    assert.deepEqual(result.artifact, { url: "https://r2.syntx.ai/kontext/output.png", mime_type: "image/png", mime_source: "URL_EXTENSION" });
    currentParameters = { resolution: "1152x896", cfg: 1.15, steps: 11.5, image_strength: 0.234 };
    const repeated = await service.generate({
      attemptId: ATTEMPT, variant, reference_handles: [], parameters: currentParameters,
      prompt: "Preserve the original composition.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA"
    });
    assert.equal(repeated.status, "result_observed");
    assert.notEqual(repeated.request_fingerprint, result.request_fingerprint,
      "a completed zero-reference Pro intent may change settings without reissuing its original set");
    currentVariant = "flux-kontext-max";
    currentParameters = PARAMETERS;
    const maxResult = await service.generate({
      attemptId: ATTEMPT, variant: currentVariant, reference_handles: [], parameters: currentParameters,
      prompt: "Preserve the original composition.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA"
    });
    assert.equal(maxResult.status, "result_observed", "Max can issue its own zero-reference set for the same attempt");
    assert.equal(maxResult.variant, currentVariant);
    assert.equal(preflightCalls, 6);
    assert.ok(preflightInputs.every((input) => JSON.stringify(input.cost_inputs) === "{}"));
    assert.equal(chatCalls, 3);
    assert.equal(generationPosts, 3);
    assert.equal(historyGets, 3);
    assert.equal(resultGets, 3);
    assert.equal(credentialCalls, 12);
    const output = JSON.stringify(result);
    for (const privateValue of ["kontext-chat-1", "kontext-owner-echo-1", "kontext-bot-message-1", "kontext-image-object-1"]) {
      assert.equal(output.includes(privateValue), false);
    }
  } finally {
    await service.close();
  }
});

test("known-ACK Kontext recovery remains GET-only after the source TTL", async () => {
  let now = NOW;
  let postCalls = 0;
  let historyGets = 0;
  let resultGets = 0;
  let resultReady = false;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-ttl-credential");
    } },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats") return Response.json({ uuid: "kontext-ttl-chat" });
      if (url.pathname === "/api/v1/design/generate") {
        postCalls += 1;
        assert.equal(init?.method, "POST");
        return Response.json({ id: "kontext-ttl-owner-echo" });
      }
      if (url.pathname === "/api/v1/chats/kontext-ttl-chat/messages") {
        historyGets += 1;
        return Response.json({ messages: [
          { id: "kontext-ttl-owner-echo", chat_id: 813, author_id: 12345, message_object: [] },
          { id: "kontext-ttl-bot", chat_id: 813, author_id: -1,
            message_object: [{ id: "kontext-ttl-object", message_id: "kontext-ttl-bot", object_type: "image", model_type: "flux-kontext-pro" }] }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      if (url.pathname === "/api/v1/chats/kontext-ttl-chat/kontext-ttl-bot") {
        resultGets += 1;
        return Response.json({ id: "kontext-ttl-bot", chat_id: 813, author_id: -1,
          message_object: [{ id: "kontext-ttl-object", message_id: "kontext-ttl-bot", object_type: "image",
            model_type: "flux-kontext-pro", completed: resultReady,
            ...(resultReady ? { object_url: "https://r2.syntx.ai/kontext/ttl-output.png" } : {}) }] });
      }
      throw new Error(`unexpected Kontext TTL route ${url.pathname}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => freshPreflight(input.variant), now: () => now, timeoutMs: 5_000,
    pollDelayMs: 0, maxPollAttempts: 1 });
  try {
    let recoveryId = "";
    await assert.rejects(() => service.generate({ attemptId: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [],
      parameters: PARAMETERS, prompt: "bounded pending output", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" }),
    (error: unknown) => {
      if (!(error instanceof OwnerKontextImageGenerationServiceError) || error.code !== "OUTCOME_UNKNOWN" || !error.recovery_id) return false;
      recoveryId = error.recovery_id;
      return true;
    });
    assert.equal(postCalls, 1);
    const readsBeforeReconcile = historyGets + resultGets;
    now = NOW + 16 * 60_000;
    resultReady = true;
    let result: OwnerKontextImageGenerationResult;
    try { result = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }); }
    catch (error) {
      const diagnostic = error && typeof error === "object" && "diagnostic" in error ? error.diagnostic : undefined;
      const code = error && typeof error === "object" && "code" in error ? error.code : "UNKNOWN";
      throw new Error(`Kontext TTL reconcile failed: ${JSON.stringify({ code, diagnostic })}`);
    }
    assert.equal(result.status, "result_observed");
    assert.equal(postCalls, 1, "reconcile after source TTL must never repeat the paid POST");
    assert.ok(historyGets + resultGets > readsBeforeReconcile, "same recovery adds a bound owner history/result GET");
  } finally { await service.close(); }
});

test("all variants join real owned uploads, explicit controls, and ordered Multi references", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
  const resolutions = ["1344x768", "1152x896", "1024x1024", "896x1152", "768x1344"] as const;
  const cases = [
    { variant: "flux-kontext-pro" as const, resolution: resolutions[0], cfg: 1.05, steps: 10.5, image_strength: 0.123 },
    { variant: "flux-kontext-pro" as const, resolution: resolutions[1], cfg: 1.15, steps: 11.5, image_strength: 0.234 },
    { variant: "flux-kontext-max" as const, resolution: resolutions[2], cfg: 2.25, steps: 17.5, image_strength: 0.345 },
    { variant: "flux-kontext-max" as const, resolution: resolutions[3], cfg: 2.35, steps: 18.5, image_strength: 0.456 },
    { variant: "flux-kontext-multi" as const, resolution: resolutions[4], cfg: 3.05, steps: 21.5, image_strength: 0.567 }
  ];
  let uploadCalls = 0;
  let chatCalls = 0;
  let generationCalls = 0;
  let historyCalls = 0;
  let resultCalls = 0;
  let preflightCalls = 0;
  let currentCase: typeof cases[number] | undefined;
  const references = new Map<string, string[]>();
  const chats = new Map<string, typeof cases[number]["variant"]>();
  const echoes = new Map<string, string>();
  const resultObjects = new Map<string, string>();
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats/upload-files") {
        uploadCalls += 1;
        assert.equal(init?.method, "POST");
        assert.ok(init?.body instanceof FormData);
        const form = init.body as FormData;
        assert.equal(form.get("destination"), "uploaded");
        assert.equal(form.get("check_duplicates"), "true");
        const variant = String(form.get("model_type")) as typeof cases[number]["variant"];
        assert.ok(cases.some((entry) => entry.variant === variant));
        const file = form.get("files");
        assert.ok(file instanceof File);
        assert.equal(file.type, "image/png");
        const objectUrl = `https://r2.syntx.ai/kontext/owned-input-${uploadCalls}.png`;
        const byVariant = references.get(variant) ?? [];
        byVariant.push(objectUrl);
        references.set(variant, byVariant);
        return Response.json({ files: [{ id: `private-provider-file-${uploadCalls}`, url: objectUrl,
          mime_type: "image/png", size: file.size }] });
      }
      if (url.pathname === "/api/v1/chats") {
        chatCalls += 1;
        assert.equal(init?.method, "POST");
        assert.equal(JSON.parse(String(init?.body)).scope, "image");
        const chatUuid = `kontext-matrix-chat-${chatCalls}`;
        assert.ok(currentCase);
        chats.set(chatUuid, currentCase.variant);
        expectedByChat.set(chatUuid, currentCase);
        return Response.json({ uuid: chatUuid });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationCalls += 1;
        assert.equal(url.searchParams.get("ai_name"), "flux");
        const body = JSON.parse(String(init?.body));
        const variant = body.settings.model_type as typeof cases[number]["variant"];
        const chatUuid = body.chat_uuid as string;
        assert.equal(chats.get(chatUuid), variant);
        assert.deepEqual(body.settings, {
          n: 1, model_type: variant, workflow_type: "default", civitai_loras: [],
          resolution: expectedByChat.get(chatUuid)!.resolution, cfg: expectedByChat.get(chatUuid)!.cfg,
          steps: expectedByChat.get(chatUuid)!.steps, image_strength: expectedByChat.get(chatUuid)!.image_strength,
          file_urls: (references.get(variant) ?? []).map((urlValue) => ({ type: "image", url: urlValue }))
        });
        assert.equal(body.prompt, "Keep authored image geometry unchanged.");
        const echo = `kontext-matrix-owner-${generationCalls}`;
        echoes.set(chatUuid, echo);
        resultObjects.set(chatUuid, `kontext-matrix-object-${generationCalls}`);
        return Response.json({ id: echo });
      }
      if (url.pathname.endsWith("/messages")) {
        historyCalls += 1;
        const chatUuid = url.pathname.split("/").at(-2)!;
        const variant = chats.get(chatUuid)!;
        const echo = echoes.get(chatUuid)!;
        const objectId = resultObjects.get(chatUuid)!;
        const botId = `kontext-matrix-bot-${generationCalls}`;
        botByChat.set(chatUuid, botId);
        return Response.json({ messages: [
          { id: echo, chat_id: 900 + historyCalls, author_id: 12345, message_object: [] },
          { id: botId, chat_id: 900 + historyCalls, author_id: -1,
            message_object: [{ id: objectId, message_id: botId, object_type: "image", model_type: variant }] }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      const resultMatch = url.pathname.match(/^\/api\/v1\/chats\/(kontext-matrix-chat-\d+)\/(kontext-matrix-bot-\d+)$/u);
      assert.ok(resultMatch);
      resultCalls += 1;
      const chatUuid = resultMatch[1]!;
      const botId = resultMatch[2]!;
      const variant = chats.get(chatUuid)!;
      return Response.json({ id: botId, chat_id: 900 + resultCalls, author_id: -1,
        message_object: [{ id: resultObjects.get(chatUuid), message_id: botId, object_type: "image", model_type: variant,
          completed: true, object_url: `https://r2.syntx.ai/kontext/output-${variant}.png` }] });
    }
  });
  const botByChat = new Map<string, string>();
  const expectedByChat = new Map<string, typeof cases[number]>();
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => { preflightCalls += 1; assert.deepEqual(input.cost_inputs, {}); return freshPreflight(input.variant); },
    now: () => NOW, timeoutMs: 100, pollDelayMs: 0 });
  try {
    const handles = new Map<string, string[]>();
    for (const variant of ["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"] as const) {
      const count = variant === "flux-kontext-multi" ? 4 : 1;
      const current: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const receipt = await uploadService.upload({ attemptId: ATTEMPT, variant, content_base64: png,
          filename: `${variant}-${index}.png`, mime_type: "image/png" });
        current.push(receipt.reference_handle);
      }
      handles.set(variant, current);
    }
    assert.equal(uploadCalls, 6);
    assert.equal(new Set(references.get("flux-kontext-multi")).size, 4);
    for (const item of cases) {
      currentCase = item;
      const result = await service.generate({ attemptId: ATTEMPT, variant: item.variant,
        reference_handles: handles.get(item.variant)!, parameters: {
          resolution: item.resolution, cfg: item.cfg, steps: item.steps, image_strength: item.image_strength
        }, prompt: "Keep authored image geometry unchanged.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" });
      assert.equal(result.variant, item.variant);
      assert.equal(result.reference_count, item.variant === "flux-kontext-multi" ? 4 : 1);
      assert.equal(result.input_images.length, result.reference_count);
      assert.ok(result.input_images.every((image) => image.mime_type === "image/png" && image.width === 1 && image.height === 1));
      assert.deepEqual(result.parameters, { resolution: item.resolution, cfg: item.cfg, steps: item.steps, image_strength: item.image_strength });
      assert.equal(JSON.stringify(result).includes("owned-input-"), false);
      assert.equal(JSON.stringify(result).includes("private-provider-file"), false);
    }
    assert.equal(chatCalls, 5);
    assert.equal(generationCalls, 5);
    assert.equal(historyCalls, 5);
    assert.equal(resultCalls, 5);
    assert.equal(preflightCalls, 10);
  } finally { await service.close(); }
});

test("expired idle principal entries are pruned before the 128-attempt capacity check", async () => {
  let now = NOW;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async () => { throw new Error("read-only recovery listing must not use the chat client"); }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => freshPreflight(input.variant), now: () => now, timeoutMs: 100, pollDelayMs: 0 });
  try {
    for (let index = 0; index < 128; index += 1) {
      const attemptId = `link_kontext_idle_capacity_${index.toString().padStart(3, "0")}`;
      assert.deepEqual(await service.listRecoveries({ attemptId, limit: 1 }), []);
    }
    now += 15 * 60_000 + 1;
    const attemptId = "link_kontext_idle_capacity_afterexpiry";
    assert.deepEqual(await service.listRecoveries({ attemptId, limit: 1 }), []);
  } finally { await service.close(); }
});

test("lost generation ACK remains outcome-unknown and same full zero-reference intent cannot replay", async () => {
  let now = NOW;
  let chatCalls = 0;
  let generationPosts = 0;
  let getCalls = 0;
  let preflightCalls = 0;
  let signalPostEntered!: () => void;
  let releasePost!: () => void;
  const postEntered = new Promise<void>((resolve) => { signalPostEntered = resolve; });
  const postGate = new Promise<void>((resolve) => { releasePost = resolve; });
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats") {
        chatCalls += 1;
        return Response.json({ uuid: "kontext-unknown-chat" });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationPosts += 1;
        assert.equal(init?.method, "POST");
        signalPostEntered();
        await postGate;
        throw new Error("simulated transport loss after the single native POST began");
      }
      getCalls += 1;
      throw new Error(`unexpected read after lost ACK: ${url.pathname}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => { preflightCalls += 1; return freshPreflightAt(input.variant, now); },
    now: () => now, timeoutMs: 5_000, pollDelayMs: 0 });
  const input = { attemptId: ATTEMPT, variant: "flux-kontext-pro" as const, reference_handles: [],
    parameters: PARAMETERS, prompt: "One exact intent.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const };
  try {
    const generation = service.generate(input).then(() => undefined, (error: unknown) => error);
    await waitForBarrier(postEntered, "Kontext generation POST entry");
    const duringPost = await service.listRecoveries({ attemptId: ATTEMPT, limit: 5 });
    assert.equal(duringPost.length, 1);
    assert.equal(duringPost[0]?.diagnostic.post_started, true);
    assert.equal(duringPost[0]?.diagnostic.echo_ack_known, false);
    releasePost();
    const unknown = await generation;
    assert.ok(unknown instanceof OwnerKontextImageGenerationServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    assert.match(unknown.recovery_id ?? "", /^kontext_recovery_[0-9a-f-]{36}$/u);
    assert.equal(unknown.diagnostic?.post_started, true);
    assert.equal(unknown.diagnostic?.echo_ack_known, false);
    const recoveryId = unknown.recovery_id!;
    await assert.rejects(service.generate(input), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
      error.code === "REFERENCE_ALREADY_CLAIMED");
    const listed = await service.listRecoveries({ attemptId: ATTEMPT, limit: 5 });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.recovery_id, recoveryId);
    assert.equal(listed[0]?.diagnostic.echo_ack_known, false);
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
    assert.equal(chatCalls, 1);
    assert.equal(generationPosts, 1);
    assert.equal(getCalls, 0);
    assert.equal(preflightCalls, 2);
    const safeOutput = JSON.stringify(listed);
    for (const privateValue of ["kontext-unknown-chat", "One exact intent", "kontext-owner-echo"]) {
      assert.equal(safeOutput.includes(privateValue), false);
    }
    now = NOW + 900_001;
    const retained = await service.listRecoveries({ attemptId: ATTEMPT, limit: 5 });
    assert.equal(retained.length, 1, "post-dispatch unknown remains held after input TTL despite missing ACK");
    assert.equal(retained[0]?.recovery_id, recoveryId);
    await assert.rejects(service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId }),
      (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError && error.code === "OUTCOME_UNKNOWN");
    await assert.rejects(service.generate(input), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
      error.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(generationPosts, 1, "recovery retention neither renews source TTL nor repeats POST");
    assert.equal(chatCalls, 1, "post-dispatch hold denies a replacement chat");
    assert.equal(getCalls, 0);
  } finally { releasePost(); await service.close(); }
});

test("late ACK-known history/result can reconcile by exact GET without new preflight or mutation", async () => {
  let now = NOW;
  let chatCalls = 0;
  let generationPosts = 0;
  let historyGets = 0;
  let resultGets = 0;
  let preflightCalls = 0;
  const variant = "flux-kontext-max" as const;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats") {
        chatCalls += 1;
        return Response.json({ uuid: "kontext-late-chat" });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationPosts += 1;
        return Response.json({ id: "kontext-late-owner-echo" });
      }
      if (url.pathname === "/api/v1/chats/kontext-late-chat/messages") {
        historyGets += 1;
        if (historyGets === 1) throw new Error("transient local history read failure");
        return Response.json({ messages: [
          { id: "kontext-late-owner-echo", chat_id: 812, author_id: 44, message_object: [] },
          { id: "kontext-late-bot", chat_id: 812, author_id: -1,
            message_object: [{ id: "kontext-late-object", message_id: "kontext-late-bot", object_type: "image", model_type: variant }] }
        ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
      }
      if (url.pathname === "/api/v1/chats/kontext-late-chat/kontext-late-bot") {
        resultGets += 1;
        return Response.json({ id: "kontext-late-bot", chat_id: 812, author_id: -1,
          message_object: [{ id: "kontext-late-object", message_id: "kontext-late-bot", object_type: "image", model_type: variant,
            completed: true, object_url: "https://r2.syntx.ai/kontext/late.png" }] });
      }
      throw new Error(`unexpected request ${url.pathname} ${String(init?.method)}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => { preflightCalls += 1; return freshPreflight(input.variant); }, now: () => now,
    timeoutMs: 100, pollDelayMs: 0 });
  const input = { attemptId: ATTEMPT, variant, reference_handles: [], parameters: PARAMETERS,
    prompt: "Keep the exact composition.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const };
  try {
    let unknown: unknown;
    try { await service.generate(input); } catch (error) { unknown = error; }
    assert.ok(unknown instanceof OwnerKontextImageGenerationServiceError);
    assert.equal(unknown.code, "OUTCOME_UNKNOWN");
    assert.equal(unknown.diagnostic?.echo_ack_known, true);
    assert.equal(unknown.diagnostic?.history_get_calls, 1);
    const recoveryId = unknown.recovery_id!;
    now = NOW + 899_000;
    const reconciled = await service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(reconciled.status, "result_observed");
    assert.equal(reconciled.artifact.url, "https://r2.syntx.ai/kontext/late.png");
    assert.equal(chatCalls, 1);
    assert.equal(generationPosts, 1);
    assert.equal(historyGets, 2);
    assert.equal(resultGets, 1);
    assert.equal(preflightCalls, 2);
  } finally { await service.close(); }
});

test("pending history and incomplete exact result use bounded GET-only observation until the same binding completes", async () => {
  let historyCalls = 0;
  let queueCalls = 0;
  let resultCalls = 0;
  let postCalls = 0;
  const variant = "flux-kontext-pro" as const;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats") return Response.json({ uuid: "kontext-pending-chat" });
      if (url.pathname === "/api/v1/design/generate") {
        postCalls += 1;
        return Response.json({ id: "kontext-pending-echo" });
      }
      if (url.pathname === "/api/v1/chats/kontext-pending-chat/messages") {
        historyCalls += 1;
        const messages: Array<{ id: string; chat_id: number; author_id: number; message_object: Array<{
          id: string; message_id: string; object_type: string; model_type: string;
        }> }> = [{ id: "kontext-pending-echo", chat_id: 913, author_id: 55, message_object: [] }];
        if (historyCalls > 1) messages.push({ id: "kontext-pending-bot", chat_id: 913, author_id: -1,
          message_object: [{ id: "kontext-pending-object", message_id: "kontext-pending-bot", object_type: "image", model_type: variant }] });
        return Response.json({ messages,
          pagination: { page: 1, page_size: 10, total_count: messages.length, total_pages: 1, has_next: false, has_previous: false } });
      }
      if (url.pathname === "/api/v1/chats/kontext-pending-chat/inprogress") {
        queueCalls += 1;
        return Response.json([]);
      }
      if (url.pathname === "/api/v1/chats/kontext-pending-chat/kontext-pending-bot") {
        resultCalls += 1;
        return Response.json({ id: "kontext-pending-bot", chat_id: 913, author_id: -1,
          message_object: [{ id: "kontext-pending-object", message_id: "kontext-pending-bot", object_type: "image",
            model_type: variant, completed: resultCalls > 1, object_url: "https://r2.syntx.ai/kontext/pending.png" }] });
      }
      throw new Error(`unexpected pending observation read ${url.pathname}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => freshPreflight(input.variant), now: () => NOW, timeoutMs: 1_000, pollDelayMs: 0, maxPollAttempts: 4 });
  try {
    const result = await service.generate({ attemptId: ATTEMPT, variant, reference_handles: [], parameters: PARAMETERS,
      prompt: "Wait without guessing.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" });
    assert.equal(result.status, "result_observed");
    assert.equal(historyCalls, 2);
    assert.equal(queueCalls, 1);
    assert.equal(resultCalls, 2);
    assert.equal(postCalls, 1);
  } finally { await service.close(); }
});

test("late result GET is withheld after original reference TTL or owner revocation", async () => {
  for (const scenario of ["expired", "revoked"] as const) {
    let now = NOW;
    let ownerRevoked = false;
    let signalResultEntered!: () => void;
    let releaseResult!: () => void;
    const resultEntered = new Promise<void>((resolve) => { signalResultEntered = resolve; });
    const resultGate = new Promise<void>((resolve) => { releaseResult = resolve; });
    let postCalls = 0;
    let resultGets = 0;
    const variant = "flux-kontext-pro" as const;
    const client = new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
        return operation("synthetic-kontext-generation-credential");
      } },
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/v1/chats") return Response.json({ uuid: `kontext-late-${scenario}-chat` });
        if (url.pathname === "/api/v1/design/generate") {
          postCalls += 1;
          return Response.json({ id: `kontext-late-${scenario}-echo` });
        }
        if (url.pathname.endsWith("/messages")) {
          const echoId = `kontext-late-${scenario}-echo`;
          const botId = `kontext-late-${scenario}-bot`;
          return Response.json({ messages: [
            { id: echoId, chat_id: 936, author_id: 25, message_object: [] },
            { id: botId, chat_id: 936, author_id: -1,
              message_object: [{ id: `kontext-late-${scenario}-object`, message_id: botId, object_type: "image", model_type: variant }] }
          ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
        }
        if (url.pathname.endsWith(`/kontext-late-${scenario}-bot`)) {
          resultGets += 1;
          signalResultEntered();
          await resultGate;
          return Response.json({ id: `kontext-late-${scenario}-bot`, chat_id: 936, author_id: -1,
            message_object: [{ id: `kontext-late-${scenario}-object`, message_id: `kontext-late-${scenario}-bot`,
              object_type: "image", model_type: variant, completed: true,
              object_url: "https://r2.syntx.ai/kontext/too-late.png" }] });
        }
        throw new Error(`unexpected late result route ${url.pathname}`);
      }
    });
    const linkService = { async getStatus(_binding: unknown, attemptId: string) {
      return ownerRevoked
        ? { ...linkedAttempt(attemptId), status: "REVOKED", linked: false }
        : linkedAttempt(attemptId);
    } } as never;
    const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
      catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
    const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
      catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
      preflight: async (input) => freshPreflight(input.variant), now: () => now, timeoutMs: 5_000, pollDelayMs: 0 });
    try {
      const generation = service.generate({ attemptId: ATTEMPT, variant, reference_handles: [], parameters: PARAMETERS,
        prompt: "Do not return expired or revoked output.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" });
      await waitForBarrier(resultEntered, "Kontext result GET entry");
      if (scenario === "expired") now = NOW + 900_001;
      else ownerRevoked = true;
      releaseResult();
      await assert.rejects(generation, (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
        error.code === "OUTCOME_UNKNOWN" && error.diagnostic?.echo_ack_known === true);
      assert.equal(resultGets, 1);
      assert.equal(postCalls, 1);
    } finally { releaseResult(); await service.close(); }
  }
});

test("overlapping Multi claims are atomic and a known preflight denial rolls back only its claim", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
  let uploadCalls = 0;
  let chatCalls = 0;
  let preflightCalls = 0;
  let signalEntered!: () => void;
  let releaseFirst!: () => void;
  const firstEntered = new Promise<void>((resolve) => { signalEntered = resolve; });
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const variant = "flux-kontext-multi" as const;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats/upload-files") {
        uploadCalls += 1;
        const form = init?.body as FormData;
        const file = form.get("files");
        assert.ok(file instanceof File);
        return Response.json({ files: [{ id: `private-upload-${uploadCalls}`,
          url: `https://r2.syntx.ai/kontext/claim-${uploadCalls}.png`, mime_type: "image/png", size: file.size }] });
      }
      if (url.pathname === "/api/v1/chats") chatCalls += 1;
      throw new Error("claim rollback test must stop before chat creation");
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => {
      preflightCalls += 1;
      if (preflightCalls === 1) { signalEntered(); await firstGate; }
      const value = freshPreflight(input.variant);
      value.model_access.access = false;
      return value;
    }, now: () => NOW, timeoutMs: 5_000, pollDelayMs: 0 });
  const receipts: string[] = [];
  try {
    for (let index = 0; index < 3; index += 1) {
      const uploaded = await uploadService.upload({ attemptId: ATTEMPT, variant, content_base64: png,
        filename: `claim-${index}.png`, mime_type: "image/png" });
      receipts.push(uploaded.reference_handle);
    }
    const inputA = { attemptId: ATTEMPT, variant, reference_handles: receipts.slice(0, 2),
      parameters: { ...PARAMETERS, cfg: 1.11 }, prompt: "Claim A", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const };
    const inputB = { attemptId: ATTEMPT, variant, reference_handles: receipts.slice(1, 3),
      parameters: { ...PARAMETERS, cfg: 1.22 }, prompt: "Claim B", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const };
    const first = service.generate(inputA).then(() => undefined, (error: unknown) => error);
    await waitForBarrier(firstEntered, "Kontext first preflight entry");
    await assert.rejects(service.generate(inputB), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
      error.code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(preflightCalls, 1);
    releaseFirst();
    const errorA = await first;
    assert.ok(errorA instanceof OwnerKontextImageGenerationServiceError);
    assert.equal(errorA.code, "PREFLIGHT_FAILED");
    await assert.rejects(service.generate(inputB), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
      error.code === "PREFLIGHT_FAILED");
    assert.equal(preflightCalls, 2, "B could claim its complete disjoint-from-A rollback set after A's denial");
    assert.equal(uploadCalls, 3);
    assert.equal(chatCalls, 0);
  } finally { releaseFirst(); await service.close(); }
});

test("explicit expired instants fail preflight while date-only/local dates are not guessed as UTC", async () => {
  let chatCalls = 0;
  let generationPosts = 0;
  const endDateByAttempt = new Map<string, { end_date: string; end_date_kind: "OFFSET_DATETIME" | "DATE_ONLY" | "LOCAL_DATETIME" }>();
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats") {
        chatCalls += 1;
        return Response.json({ uuid: `kontext-expiry-chat-${chatCalls}` });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationPosts += 1;
        throw new Error("intentional ACK loss after allowed preflight");
      }
      throw new Error(`unexpected expiry request ${url.pathname}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => {
      const result = freshPreflight(input.variant);
      const endDate = endDateByAttempt.get(input.attemptId);
      if (endDate) result.account.subscription = { active: true, plan_type: "PAID", ...endDate };
      return result;
    }, now: () => NOW, timeoutMs: 1_000, pollDelayMs: 0 });
  const generateForAttempt = (attemptId: string) => service.generate({ attemptId, variant: "flux-kontext-pro",
    reference_handles: [], parameters: PARAMETERS, prompt: "Date semantics only.",
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" });
  try {
    const expired = "link_kontext_expired_offset_012345";
    endDateByAttempt.set(expired, { end_date: "2020-01-01T00:00:00.000Z", end_date_kind: "OFFSET_DATETIME" });
    await assert.rejects(generateForAttempt(expired), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
      error.code === "PREFLIGHT_FAILED");
    assert.equal(chatCalls, 0);
    assert.equal(generationPosts, 0);

    for (const [slug, end_date_kind, end_date] of [
      ["date", "DATE_ONLY", "2020-01-01"],
      ["local", "LOCAL_DATETIME", "2020-01-01T00:00:00"]
    ] as const) {
      const attemptId = `link_kontext_old_${slug}_0123456789`;
      endDateByAttempt.set(attemptId, { end_date_kind, end_date });
      await assert.rejects(generateForAttempt(attemptId), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
        error.code === "OUTCOME_UNKNOWN");
    }
    assert.equal(chatCalls, 2);
    assert.equal(generationPosts, 2);
  } finally { await service.close(); }
});

test("preflight snapshots are revalidated after the final owner lookup before generation POST", async () => {
  let now = NOW;
  let statusCalls = 0;
  let chatCalls = 0;
  let generationPosts = 0;
  let preflightCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats") {
        chatCalls += 1;
        return Response.json({ uuid: "kontext-stale-preflight-chat" });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationPosts += 1;
        return Response.json({ id: "unexpected-post" });
      }
      throw new Error(`stale preflight must not read result ${url.pathname}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    statusCalls += 1;
    if (statusCalls === 6) now += 31_000;
    return linkedAttempt(attemptId);
  } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => { preflightCalls += 1; return freshPreflight(input.variant); }, now: () => now,
    timeoutMs: 5_000, pollDelayMs: 0 });
  try {
    await assert.rejects(service.generate({ attemptId: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [],
      parameters: PARAMETERS, prompt: "Fresh preflight only.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" }),
    (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError && error.code === "PREFLIGHT_FAILED");
    assert.equal(statusCalls, 6);
    assert.equal(preflightCalls, 2);
    assert.equal(chatCalls, 1);
    assert.equal(generationPosts, 0);
  } finally { await service.close(); }
});

test("invalidate and close drain blocked trusted owner lookups and late results cannot proceed", async () => {
  const makeBlockedService = () => {
    let release!: (value: unknown) => void;
    let signalEntered!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const status = new Promise<unknown>((resolve) => { release = resolve; });
    let networkCalls = 0;
    const client = new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
        return operation("synthetic-kontext-generation-credential");
      } },
      fetchImpl: async () => { networkCalls += 1; throw new Error("blocked owner checks must stop before native HTTP"); }
    });
    const linkService = { async getStatus() { signalEntered(); return status; } } as never;
    const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
      catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
    const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
      catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
      preflight: async (input) => freshPreflight(input.variant), now: () => NOW, timeoutMs: 5_000, pollDelayMs: 0 });
    return { service, release, entered, get networkCalls() { return networkCalls; } };
  };
  const input = { attemptId: ATTEMPT, variant: "flux-kontext-pro" as const, reference_handles: [],
    parameters: PARAMETERS, prompt: "Wait for no owner.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const };
  for (const lifecycle of ["invalidate", "close"] as const) {
    const pending = makeBlockedService();
    const generation = pending.service.generate(input);
    try {
      await waitForBarrier(pending.entered, `Kontext ${lifecycle} owner lookup entry`);
      let completed: string;
      if (lifecycle === "invalidate") {
        completed = await Promise.race([pending.service.invalidateAttempt(ATTEMPT).then(() => "done"),
          new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 100))]);
      } else {
        completed = await Promise.race([pending.service.close().then(() => "done"),
          new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 100))]);
      }
      assert.equal(completed, "done");
      await assert.rejects(generation, (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
        error.code === "PRE_DISPATCH_FAILED");
      pending.release(linkedAttempt(ATTEMPT));
      assert.equal(pending.networkCalls, 0);
    } finally {
      pending.release(linkedAttempt(ATTEMPT));
      await pending.service.close();
    }
  }
});

test("four pending owner runs are allowed and the fifth is rejected before lookup", async () => {
  let resolveStatus!: (attempt: unknown) => void;
  let signalEntries!: () => void;
  let statusCalls = 0;
  let networkCalls = 0;
  const allEntered = new Promise<void>((resolve) => { signalEntries = resolve; });
  const blocked = new Promise<unknown>((resolve) => { resolveStatus = resolve; });
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async () => { networkCalls += 1; throw new Error("pending-cap test must not reach HTTP"); }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) {
    statusCalls += 1;
    if (statusCalls === 4) signalEntries();
    return blocked.then(() => linkedAttempt(attemptId));
  } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => NOW });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => freshPreflight(input.variant), now: () => NOW, timeoutMs: 5_000, pollDelayMs: 0 });
  const inputFor = (index: number) => ({ attemptId: `link_kontext_pending_attempt_${index.toString().padStart(3, "0")}`,
    variant: "flux-kontext-pro" as const, reference_handles: [], parameters: PARAMETERS, prompt: "Pending only.",
    workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const });
  try {
    const pending = [0, 1, 2, 3].map((index) => service.generate(inputFor(index)));
    await waitForBarrier(allEntered, "Kontext four pending owner lookups");
    await assert.rejects(service.generate(inputFor(4)), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
      error.code === "SERVICE_BUSY");
    assert.equal(statusCalls, 4);
    assert.equal(networkCalls, 0);
    await service.close();
    for (const operation of pending) await assert.rejects(operation,
      (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError && error.code === "PRE_DISPATCH_FAILED");
    resolveStatus(linkedAttempt(ATTEMPT));
    assert.equal(networkCalls, 0);
  } finally { resolveStatus(linkedAttempt(ATTEMPT)); await service.close(); }
});

test("128 unknown recoveries are bounded and the next intent is rejected before another chat or POST", async () => {
  let now = NOW;
  let chatCalls = 0;
  let generationPosts = 0;
  let preflightCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kontext-generation-credential");
    } },
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/chats") {
        chatCalls += 1;
        return Response.json({ uuid: `kontext-cap-chat-${chatCalls}` });
      }
      if (url.pathname === "/api/v1/design/generate") {
        generationPosts += 1;
        throw new Error("synthetic response loss creates a bounded local unknown record");
      }
      throw new Error(`unexpected cap-case read ${url.pathname}`);
    }
  });
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never;
  const uploadService = new OwnerKontextImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, resolveClient: () => client, now: () => now });
  const service = new OwnerKontextImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, uploadService, resolveChatClient: () => client,
    preflight: async (input) => { preflightCalls += 1; return freshPreflightAt(input.variant, now); },
    now: () => now, timeoutMs: 100, pollDelayMs: 0 });
  const inputFor = (index: number) => ({ attemptId: ATTEMPT, variant: "flux-kontext-pro" as const,
    reference_handles: [], parameters: { ...PARAMETERS, cfg: 1 + (index + 1) / 100 },
    prompt: "Unique source-bound intent.", workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA" as const });
  try {
    for (let index = 0; index < 128; index += 1) {
      await assert.rejects(service.generate(inputFor(index)), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
        error.code === "OUTCOME_UNKNOWN");
    }
    now = NOW + 16 * 60_000;
    assert.equal(generationPosts, 128);
    assert.equal(chatCalls, 128);
    assert.equal(preflightCalls, 256);
    await assert.rejects(service.generate(inputFor(128)), (error: unknown) => error instanceof OwnerKontextImageGenerationServiceError &&
      error.code === "SERVICE_BUSY");
    assert.equal(generationPosts, 128);
    assert.equal(chatCalls, 128);
    const listed = await service.listRecoveries({ attemptId: ATTEMPT, limit: 20 });
    assert.equal(listed.length, 20);
    assert.ok(listed.every((item) => item.status === "OUTCOME_UNKNOWN"));
  } finally { await service.close(); }
});
