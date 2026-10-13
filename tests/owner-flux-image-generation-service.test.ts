import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../src/adapter/syntx/account-decoder.js";
import { CivitaiPinnedHttpsDownloadTransport } from "../src/adapter/civitai/pinned-https-download-transport.js";
import { CivitaiPublicModelFileClient } from "../src/adapter/civitai/public-model-file-client.js";
import { CivitaiPublicModelFileAttestor } from "../src/adapter/civitai/public-model-file-attestor.js";
import { OwnerFluxImageAssetService } from "../src/application/owner-flux-image-asset-service.js";
import { OwnerFluxImageUploadService } from "../src/application/owner-flux-image-upload-service.js";
import { OwnerFluxImageGenerationService, type OwnerFluxImageGenerationPreflightInput } from "../src/application/owner-flux-image-generation-service.js";
import { OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS, OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS } from "../src/application/owner-flux-image-generation-service.js";
import { getOwnerFluxImageSourceParameters, OWNER_FLUX_IMAGE_MODELS } from "../src/application/owner-flux-image-parameters.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const ATTEMPT = "link_flux_generation_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "flux-generation-tenant", subject: "flux-generation-owner" });
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const LORA_SELECTORS = [{ model_id: 101, version_id: 202, file_id: 303 }, { model_id: 104, version_id: 205, file_id: 306 },
  { model_id: 107, version_id: 208, file_id: 309 }] as const;

function loraBytes(index: number): Buffer {
  const header = Buffer.from(JSON.stringify({ [`tensor_${index}`]: { dtype: "F32", shape: [2], data_offsets: [0, 8] } }), "utf8");
  const length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(header.byteLength));
  return Buffer.concat([length, header, Buffer.from([index, 1, 2, 3, 4, 5, 6, 7])]);
}
function sha256(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

function linkedAttempt(attemptId: string) { return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
  status: "LINKED" as const, expires_at: null, linked: true as const }; }

function rig(options: { readonly withLora?: boolean; readonly losePost?: boolean; readonly denyPreflight?: number;
  readonly pendingResultOnce?: boolean; readonly holdPostUntilAbort?: boolean } = {}) {
  const calls = { uploads: 0, chats: 0, posts: 0, history: 0, results: 0, preflight: 0 };
  const events: string[] = [];
  const bodies: Array<{ readonly ai_name: string | null; readonly body: Record<string, unknown> }> = [];
  const transactions = new Map<string, { readonly post: number; readonly model: string; readonly referenceCount: number }>();
  const loraContents = LORA_SELECTORS.map((_selector, index) => loraBytes(index + 1));
  let clockNow = Date.now(); const clock = () => clockNow;
  let markPosted!: () => void; const waitForPost = new Promise<void>((resolve) => { markPosted = resolve; });
  let postAbortObserved = false;
  const linkService = { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } };
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-flux-generation-credential");
  } }, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/v1/chats/upload-files") {
      calls.uploads += 1; events.push("upload"); const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File); return Response.json({ files: [{ id: `flux-upload-${calls.uploads}`,
        url: `https://r2.syntx.ai/private/flux/${calls.uploads}.png`, mime_type: "image/png", size: file.size }] });
    }
    if (url.pathname === "/api/v1/chats") { calls.chats += 1; events.push("chat"); return Response.json({ uuid: `flux-chat-${calls.chats}` }); }
    if (url.pathname === "/api/v1/design/generate") {
      calls.posts += 1; events.push("post"); const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push({ ai_name: url.searchParams.get("ai_name"), body }); const settings = body.settings as Record<string, unknown>;
      transactions.set(String(body.chat_uuid), { post: calls.posts, model: String(settings.model_type),
        referenceCount: (settings.file_urls as readonly unknown[]).length });
      markPosted();
      if (options.losePost) throw new Error("synthetic response loss after dispatch");
      if (options.holdPostUntilAbort) return await new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal; if (!(signal instanceof AbortSignal)) { reject(new Error("missing post abort signal")); return; }
        const abort = () => { postAbortObserved = true; reject(new DOMException("synthetic POST aborted", "AbortError")); };
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      });
      return Response.json({ id: `flux-owner-echo-${calls.posts}` });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(flux-chat-\d+)\/messages$/u);
    if (history) {
      assert.equal(init?.method ?? "GET", "GET");
      calls.history += 1; events.push("history"); const transaction = transactions.get(history[1]!); assert.ok(transaction);
      const { post, model, referenceCount } = transaction; const owner = `flux-owner-echo-${post}`; const bot = `flux-bot-result-${post}`;
      return Response.json({ messages: [
        { id: owner, chat_id: 9000 + post, author_id: 100, message_object: [
          ...Array.from({ length: referenceCount }, (_, index) => ({ id: `flux-owner-ref-${post}-${index + 1}`, message_id: owner, object_type: "image", model_type: model })),
          { id: `flux-owner-text-${post}`, message_id: owner, object_type: "text", model_type: model }] },
        { id: bot, chat_id: 9000 + post, author_id: -1, message_object: [
          { id: `flux-image-object-${post}`, message_id: bot, object_type: "image", model_type: model }] }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = url.pathname.match(/^\/api\/v1\/chats\/(flux-chat-\d+)\/(flux-bot-result-\d+)$/u);
    if (result) { assert.equal(init?.method ?? "GET", "GET"); calls.results += 1; events.push("result"); const transaction = transactions.get(result[1]!); assert.ok(transaction);
      return Response.json({ id: result[2], chat_id: 9000 + transaction.post, author_id: -1,
        message_object: [{ id: `flux-image-object-${transaction.post}`, message_id: result[2], object_type: "image",
          model_type: transaction.model, completed: !(options.pendingResultOnce && calls.results === 1), object_url: "https://r2.syntx.ai/results/flux.png" }] }); }
    throw new Error(`Unexpected synthetic native route ${url.pathname}`);
  } });
  const uploadService = new OwnerFluxImageUploadService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => client, now: clock });
  const metadataClient = new CivitaiPublicModelFileClient({ fetchImpl: async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const selected = LORA_SELECTORS.findIndex((x) => url.pathname === `/api/v1/model-versions/${x.version_id}` || url.pathname === `/api/v1/models/${x.model_id}`);
    if (!options.withLora || selected < 0) return new Response("unexpected metadata route", { status: 404 });
    const selector = LORA_SELECTORS[selected]!; const bytes = loraContents[selected]!;
    if (url.pathname === `/api/v1/model-versions/${selector.version_id}`) return Response.json({ id: selector.version_id,
      modelId: selector.model_id, baseModel: "Flux.1 D", status: "Published", availability: "Public", usageControl: "Download",
      files: [{ id: selector.file_id, type: "Model", name: `private-file-${selected}.safetensors`, primary: true,
        sizeKB: bytes.byteLength / 1024, metadata: { format: "SafeTensor" }, hashes: { SHA256: sha256(bytes) },
        virusScanResult: "Success", pickleScanResult: "Success", downloadUrl: `https://civitai.com/api/download/models/${selector.version_id}?fileId=${selector.file_id}` }] });
    return Response.json({ id: selector.model_id, type: "LORA", status: "Published", availability: "Public", mode: null,
      modelVersions: [{ id: selector.version_id }], allowCommercialUse: null, allowNoCredit: null, allowDerivatives: null, allowDifferentLicense: null });
  } });
  const transport = new CivitaiPinnedHttpsDownloadTransport({ approvedOrigins: ["https://civitai.com"], ports: {
    dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    request: async ({ hostname, path }: { readonly hostname: string; readonly path: string }) => {
      const selected = LORA_SELECTORS.findIndex((x) => path === `/api/download/models/${x.version_id}?fileId=${x.file_id}`);
      if (!options.withLora || hostname !== "civitai.com" || selected < 0) return { statusCode: 404, headers: {}, remoteAddress: "93.184.216.34",
        tlsAuthorized: true, body: (async function* () {})(), async cancel() {} };
      const bytes = loraContents[selected]!;
      return { statusCode: 200, headers: { "content-length": String(bytes.byteLength), "content-type": "application/octet-stream", "content-encoding": "identity" },
        remoteAddress: "93.184.216.34", tlsAuthorized: true,
        body: (async function* () { for (let i = 0; i < bytes.length; i += 7) yield bytes.subarray(i, i + 7); })(), async cancel() {} };
    }
  } });
  const assetService = new OwnerFluxImageAssetService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, uploadService, loraAttestor: new CivitaiPublicModelFileAttestor({ metadataClient, transport }), now: clock });
  const service = new OwnerFluxImageGenerationService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, assetService, resolveChatClient: () => client,
    preflight: async (input: Readonly<OwnerFluxImageGenerationPreflightInput>) => {
      calls.preflight += 1; events.push(`preflight-${calls.preflight}`); assert.deepEqual(input.cost_inputs, {});
      const observed = new Date(clock()).toISOString(); const model = input.variant;
      return { account: { balance: { unit: "tokens", available: null }, subscription: { active: true, plan_type: "FREE", end_date: null, end_date_kind: null },
        contract_evidence: ACCOUNT_CONTRACT_EVIDENCE, source_build: ACCOUNT_SOURCE_BUILD, observed_at: observed },
        model_access: { catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT", catalog_version: `${CATALOG.fetched_at}.${CATALOG.source_hashes.models.slice(7, 19)}`,
          model_id: model, ai_name: "flux", model_type: model, account_read_live: true, parameter_keys: [], parameters_redacted: true,
          access: options.denyPreflight === calls.preflight ? false : true, cost: 0, discount_cost: null, free_remaining_generations: null, limit: null,
          show_warning: false, observed_at: observed } };
    }, now: clock, pollDelayMs: 0, maxPollAttempts: 1, wait: async () => undefined });
  return { service, uploadService, assetService, client, calls, events, bodies, loraContents, waitForPost, clock,
    advanceClock(milliseconds: number) { clockNow += milliseconds; }, get postAbortObserved() { return postAbortObserved; } };
}

test("Flux image generation uses actual 653-issued assets, two fresh preflights, one POST, and exact history/result GETs", async () => {
  const f = rig();
  try {
    const image = await f.uploadService.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
      filename: "reference.png", mime_type: "image/png" });
    const result = await f.service.generate({ attemptId: ATTEMPT, model_id: "flux-1", prompt: "synthetic source-bound prompt",
      image_reference_handle: image.reference_handle, parameters: { resolution: "1024x1024", cfg: 2.375, steps: 17.25,
        image_strength: 0.625, workflow_type: "default", raw: null, civitai_loras: [] } });
    assert.equal(f.calls.uploads, 1); assert.equal(f.calls.chats, 1); assert.equal(f.calls.posts, 1);
    assert.equal(f.calls.preflight, 2); assert.equal(f.calls.history, 1); assert.equal(f.calls.results, 1);
    assert.deepEqual(f.events, ["upload", "preflight-1", "chat", "preflight-2", "post", "history", "result"]);
    assert.equal(f.bodies[0]?.ai_name, "flux");
    assert.deepEqual((f.bodies[0]?.body.settings as Record<string, unknown>), { model_type: "flux-1", resolution: "1024x1024",
      cfg: 2.375, steps: 17.25, image_strength: 0.625, workflow_type: "default", n: 1,
      file_urls: [{ type: "image", url: "https://r2.syntx.ai/private/flux/1.png" }], civitai_loras: [] });
    assert.equal(result.status, "result_observed"); assert.equal(result.reference_count, 1); assert.equal(result.artifact.mime_type, "image/png");
    assert.equal(result.artifact.geometry_verified, false); assert.equal(result.backend_acceptance, "UNPROVEN");
    assert.equal(Object.isFrozen(OWNER_FLUX_IMAGE_GENERATION_HISTORY_REASONS), true);
    assert.equal(Object.isFrozen(OWNER_FLUX_IMAGE_GENERATION_RESULT_REASONS), true);
    for (const secret of ["synthetic source-bound prompt", "/private/flux/1.png", "flux-upload-1", "reference.png"]) assert.equal(JSON.stringify(result).includes(secret), false);
  } finally { await f.service.close(); }
});

test("caller URL fields and accessor parameters are rejected before assets or native traffic", async () => {
  const f = rig(); const lora = { handle: "flux_lora_00000000-0000-4000-8000-000000000001", strength_model: 0.5, strength_clip: 0.5,
    url: "https://civitai.com/api/download/models/2?token=must-not-be-read" };
  const callerUrlParameters = { resolution: "1024x1024", cfg: 2, steps: 16, image_strength: 0.5,
    workflow_type: "civitai", raw: null, civitai_loras: [lora] };
  const parameters = { resolution: "1024x1024", steps: 16, image_strength: 0.5, workflow_type: "default", raw: null,
    civitai_loras: [] } as Record<string, unknown>;
  let getterCalled = false;
  Object.defineProperty(parameters, "cfg", { enumerable: true, get() { getterCalled = true; throw new Error("sentinel getter executed"); } });
  try {
    assert.throws(() => f.service.generate({ attemptId: ATTEMPT, model_id: "flux-1", prompt: "reject caller URL", parameters: callerUrlParameters }),
      (error: unknown) => (error as { code?: string }).code === "INVALID_REQUEST");
    assert.throws(() => f.service.generate({ attemptId: ATTEMPT, model_id: "flux-1", prompt: "reject accessor", parameters }),
      (error: unknown) => (error as { code?: string }).code === "INVALID_REQUEST");
    assert.equal(getterCalled, false); assert.equal(f.calls.preflight, 0); assert.equal(f.calls.chats, 0); assert.equal(f.calls.posts, 0);
  } finally { await f.service.close(); }
});

test("Flux generation accepts every source resolution across all three model variants", async () => {
  const resolutions = getOwnerFluxImageSourceParameters().resolutions;
  const cases = OWNER_FLUX_IMAGE_MODELS.flatMap((model) => resolutions[model].map((resolution) => ({ model, resolution })));
  assert.equal(cases.length, 18);
  for (const { model, resolution } of cases) {
    const f = rig();
    try {
      const result = await f.service.generate({ attemptId: ATTEMPT, model_id: model, prompt: "offline matrix",
        parameters: { resolution, cfg: 2.375, steps: 17.25, image_strength: 0.625,
          workflow_type: "default", raw: model === "flux-pro-1.1-ultra" ? false : null, civitai_loras: [] } });
      assert.equal(result.model_id, model); assert.equal(result.parameters.resolution, resolution);
      assert.equal(f.calls.posts, 1); assert.equal(f.calls.preflight, 2);
    } finally { await f.service.close(); }
  }
});

test("three actual public Civitai LoRAs remain opaque handles and preserve ordered manual fractional strengths", async () => {
  const f = rig({ withLora: true });
  try {
    const receipts = [];
    for (const selector of LORA_SELECTORS) receipts.push(await f.assetService.registerPublicLora({ attemptId: ATTEMPT, model_id: "flux-1",
      model_id_source: selector.model_id, model_version_id: selector.version_id, file_id: selector.file_id }));
    assert.equal(receipts.length, 3);
    const strengths = [0, 0.375, 1.5] as const;
    const loras = receipts.map((receipt, index) => ({ handle: receipt.reference_handle,
      strength_model: strengths[index]!, strength_clip: strengths[index]! }));
    for (let count = 1; count <= 3; count += 1) {
      const selectedLoras = loras.slice(0, count);
      const result = await f.service.generate({ attemptId: ATTEMPT, model_id: "flux-1", prompt: `owned reference count ${count}`,
        parameters: { resolution: "1024x1024", cfg: 2.375, steps: 17.25, image_strength: 0.625,
          workflow_type: "civitai", raw: null, civitai_loras: selectedLoras } });
      const settings = f.bodies[count - 1]?.body.settings as Record<string, unknown>;
      assert.deepEqual(settings.civitai_loras, LORA_SELECTORS.slice(0, count).map((selector, index) => ({ id: String(selector.version_id),
        url: `https://civitai.com/api/download/models/${selector.version_id}?fileId=${selector.file_id}`,
        strength_model: strengths[index], strength_clip: strengths[index] })));
      assert.equal(result.lora_assets.length, count); assert.deepEqual(result.lora_assets.map((x) => [x.strength_model, x.strength_clip]),
        strengths.slice(0, count).map((x) => [x, x]));
      assert.equal(result.parameters.workflow_type, "civitai");
      for (const secret of ["civitai.com", "private-file", "flux_lora_"]) assert.equal(JSON.stringify(result).includes(secret), false);
    }
    assert.equal(f.calls.posts, 3);
  } finally { await f.service.close(); }
});

test("a denied fresh preflight fails before chat creation or billable dispatch", async () => {
  const f = rig({ denyPreflight: 1 });
  try {
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT, model_id: "flux-1", prompt: "preflight denial",
      parameters: { resolution: "1024x1024", cfg: 2, steps: 16, image_strength: 0.5, workflow_type: "default", raw: null, civitai_loras: [] } }),
    (error: unknown) => (error as { code?: string }).code === "PREFLIGHT_FAILED");
    assert.equal(f.calls.preflight, 1); assert.equal(f.calls.chats, 0); assert.equal(f.calls.posts, 0);
  } finally { await f.service.close(); }
});

test("the second fresh preflight is still before POST and denial leaves only the temporary chat", async () => {
  const f = rig({ denyPreflight: 2 });
  try {
    await assert.rejects(f.service.generate({ attemptId: ATTEMPT, model_id: "flux-1", prompt: "second preflight denial",
      parameters: { resolution: "1024x1024", cfg: 2, steps: 16, image_strength: 0.5, workflow_type: "default", raw: null, civitai_loras: [] } }),
    (error: unknown) => (error as { code?: string }).code === "PREFLIGHT_FAILED");
    assert.equal(f.calls.preflight, 2); assert.equal(f.calls.chats, 1); assert.equal(f.calls.posts, 0);
  } finally { await f.service.close(); }
});

test("uncertain POST creates a stable semantic hold that survives attempt invalidation and blocks replay", async () => {
  const f = rig({ losePost: true });
  const request = { attemptId: ATTEMPT, model_id: "flux-1" as const, prompt: "uncertain semantic intent",
    parameters: { resolution: "1024x1024", cfg: 2.125, steps: 15.5, image_strength: 0.625,
      workflow_type: "default" as const, raw: null, civitai_loras: [] } };
  try {
    let recoveryId = "";
    await assert.rejects(f.service.generate(request), (error: unknown) => {
      const typed = error as { code?: string; recovery_id?: string };
      recoveryId = typed.recovery_id ?? ""; return typed.code === "OUTCOME_UNKNOWN" && Boolean(recoveryId);
    });
    assert.equal(f.calls.posts, 1);
    const listed = await f.service.listRecoveries({ attemptId: ATTEMPT });
    assert.equal(listed.length, 1); assert.equal(listed[0]?.recovery_id, recoveryId);
    assert.deepEqual(Object.keys(listed[0]!).sort(), ["created_at", "diagnostic", "model_id", "operation_id", "recovery_id", "status"]);
    assert.equal(JSON.stringify(listed).includes("uncertain semantic intent"), false);
    await f.service.invalidateAttempt(ATTEMPT);
    const relinked = { ...request, attemptId: "link_flux_generation_service_relinked_9876543210" };
    await assert.rejects(f.service.generate(relinked), (error: unknown) => (error as { code?: string }).code === "REFERENCE_ALREADY_CLAIMED");
    assert.equal(f.calls.posts, 1);
  } finally { await f.service.close(); }
});

test("D-131 holds are capped at 128 without eviction and the 129th uncertain intent fails before POST", async () => {
  const f = rig({ losePost: true });
  const requestAt = (index: number) => ({ attemptId: ATTEMPT, model_id: "flux-1" as const, prompt: `bounded hold ${index}`,
    parameters: { resolution: "1024x1024", cfg: 2, steps: 16, image_strength: 0.5,
      workflow_type: "default" as const, raw: null, civitai_loras: [] } });
  try {
    let firstRecovery = "";
    for (let i = 0; i < 128; i += 1) {
      const error = await f.service.generate(requestAt(i)).catch((failure: unknown) => failure) as { code?: string; recovery_id?: string };
      assert.equal(error.code, "OUTCOME_UNKNOWN", `intent ${i} did not retain its uncertain outcome`);
      if (i === 0) firstRecovery = error.recovery_id ?? "";
    }
    const first = await f.service.listRecoveries({ attemptId: ATTEMPT, limit: 20 });
    assert.equal(first.length, 20); assert.equal(first.some((item) => item.recovery_id === firstRecovery), true);
    const overflow = await f.service.generate(requestAt(128)).catch((error: unknown) => error) as { code?: string };
    assert.equal(overflow.code, "SERVICE_BUSY");
    const replay = await f.service.generate(requestAt(0)).catch((error: unknown) => error) as { code?: string };
    assert.ok(replay.code === "REFERENCE_ALREADY_CLAIMED" || replay.code === "SERVICE_BUSY" || replay.code === "REFERENCE_UNAVAILABLE");
    assert.equal(f.calls.posts, 128); assert.equal(f.calls.chats, 128);
  } finally { await f.service.close(); }
});

test("pending result is recovered with GET-only calls using the same recovery handle", async () => {
  const f = rig({ pendingResultOnce: true });
  const request = { attemptId: ATTEMPT, model_id: "flux-1" as const, prompt: "same recovery intent",
    parameters: { resolution: "1024x1024", cfg: 2.2, steps: 17, image_strength: 0.5,
      workflow_type: "default" as const, raw: null, civitai_loras: [] } };
  try {
    let recoveryId = "";
    await assert.rejects(f.service.generate(request), (error: unknown) => {
      const typed = error as { code?: string; recovery_id?: string; diagnostic?: { result_reason: string | null } };
      recoveryId = typed.recovery_id ?? ""; return typed.code === "OUTCOME_UNKNOWN" && typed.diagnostic?.result_reason === "RESULT_NOT_COMPLETED";
    });
    const result = await f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "result_observed"); assert.equal(f.calls.posts, 1); assert.equal(f.calls.preflight, 2);
    assert.equal(f.calls.chats, 1); assert.equal(f.calls.history, 1); assert.equal(f.calls.results, 2);
  } finally { await f.service.close(); }
});

test("an expired source blocks new GEN but a known ACK remains GET-recoverable after 16 minutes", async () => {
  const f = rig({ pendingResultOnce: true });
  const uploaded = await f.uploadService.upload({ attemptId: ATTEMPT, model_id: "flux-1", content_base64: PNG.toString("base64"),
    filename: "long-job-reference.png", mime_type: "image/png" });
  const request = { attemptId: ATTEMPT, model_id: "flux-1" as const, prompt: "original private TTL",
    image_reference_handle: uploaded.reference_handle,
    parameters: { resolution: "1024x1024", cfg: 2.2, steps: 17, image_strength: 0.5,
      workflow_type: "default" as const, raw: null, civitai_loras: [] } };
  try {
    let recoveryId = "";
    await assert.rejects(f.service.generate(request), (error: unknown) => {
      recoveryId = (error as { recovery_id?: string }).recovery_id ?? ""; return (error as { code?: string }).code === "OUTCOME_UNKNOWN";
    });
    assert.equal(f.calls.posts, 1); assert.equal(f.calls.uploads, 1); assert.equal(f.calls.chats, 1);
    f.advanceClock(16 * 60_000);
    const eventCountBeforeExpiredGeneration = f.events.length;
    await assert.rejects(f.service.generate({ ...request, prompt: "new generation after source expiry" }),
      (error: unknown) => ["REFERENCE_EXPIRED", "REFERENCE_UNAVAILABLE"].includes((error as { code?: string }).code ?? ""));
    assert.equal(f.calls.posts, 1); assert.equal(f.calls.uploads, 1); assert.equal(f.calls.chats, 1);
    assert.equal(f.events.length, eventCountBeforeExpiredGeneration);

    const eventCountBeforeReconcile = f.events.length;
    const result = await f.service.reconcile({ attemptId: ATTEMPT, recovery_id: recoveryId });
    assert.equal(result.status, "result_observed");
    assert.equal(result.model_id, "flux-1");
    assert.equal(f.calls.posts, 1); assert.equal(f.calls.uploads, 1); assert.equal(f.calls.chats, 1);
    assert.equal(f.calls.preflight, 2); assert.equal(f.calls.history, 1); assert.equal(f.calls.results, 2);
    assert.deepEqual(f.events.slice(eventCountBeforeReconcile), ["result"]);
  } finally { await f.service.close(); }
});

test("close aborts a pending native POST, waits for drain, then rejects new work", async () => {
  const f = rig({ holdPostUntilAbort: true });
  const request = { attemptId: ATTEMPT, model_id: "flux-1" as const, prompt: "drain boundary",
    parameters: { resolution: "1024x1024", cfg: 2, steps: 16, image_strength: 0.5,
      workflow_type: "default" as const, raw: null, civitai_loras: [] } };
  const running = f.service.generate(request).catch((error: unknown) => error);
  await f.waitForPost; await f.service.close();
  const failure = await running as { code?: string };
  assert.equal(failure.code, "OUTCOME_UNKNOWN"); assert.equal(f.postAbortObserved, true); assert.equal(f.calls.posts, 1);
  await assert.rejects(f.service.generate(request), (error: unknown) => (error as { code?: string }).code === "SERVICE_CLOSED");
});
