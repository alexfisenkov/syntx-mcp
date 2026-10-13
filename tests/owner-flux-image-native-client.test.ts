import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { decodeOwnerFluxImageResult } from "../src/adapter/syntx/flux-image-result.js";
import { createOwnerFluxImageAssetBindingIssuer, prepareOwnerFluxImageRequest, type OwnerFluxAssetResolverContext } from "../src/application/owner-flux-image-request-preparer.js";
import { createOwnerFluxImageOneShotPermit, consumeOwnerFluxImageOneShotPermit } from "../src/application/owner-flux-image-one-shot-policy.js";
import type { OwnerFluxImageModel } from "../src/application/owner-flux-image-parameters.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const CREDENTIAL = "synthetic-flux-image-credential";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation(CREDENTIAL); } };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const catalog = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_flux_test", subject_id: "owner_flux_test", connection_id: "link_flux_test_0123456789abcdef" });
const CHAT = "flux-chat-001";
const IMAGE_HANDLE = "flux_image_00000000-0000-4000-8000-000000000001";
const LORA_HANDLES = [
  "flux_lora_00000000-0000-4000-8000-000000000001",
  "flux_lora_00000000-0000-4000-8000-000000000002",
  "flux_lora_00000000-0000-4000-8000-000000000003"
];

async function prepared(model: OwnerFluxImageModel, withImage = model === "flux-1", loraCount = 0, resolutionOverride?: string) {
  const issuer = createOwnerFluxImageAssetBindingIssuer({
    async resolveImage(context: Readonly<OwnerFluxAssetResolverContext>) {
      return { ...context, provenance: "private_r2_owned", provenance_verified: true, asset_id: "flux-owned-image-1",
        canonical_url: "https://r2.syntx.ai/private/flux/reference.png", mime_type: "image/png", width: 1200, height: 800,
        size: PNG.byteLength, sha256: `sha256:${"1".repeat(64)}`, expires_at: Date.now() + 600_000 };
    },
    async resolveLora(context: Readonly<OwnerFluxAssetResolverContext>) {
      const index = LORA_HANDLES.indexOf(context.asset_handle);
      return { ...context, provenance: "public_civitai_verified", provenance_verified: true, asset_id: String(900 + index),
        canonical_url: `https://civitai.com/api/download/models/${900 + index}`, size: 3000 + index,
        sha256: `sha256:${String(index + 2).repeat(64)}`, expires_at: Date.now() + 600_000 };
    }
  }, { catalog, catalog_version: CATALOG_VERSION });
  const loras = LORA_HANDLES.slice(0, loraCount).map((handle, index) => ({ handle, strength_model: [0.25, 0.875, 1.5][index]!, strength_clip: [0.25, 0.875, 1.5][index]! }));
  const assetSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, model_id: model,
    ...(withImage ? { image_reference_handle: IMAGE_HANDLE } : {}), lora_references: loras });
  const resolution = resolutionOverride ?? (model === "flux-1" ? "1024x1024" : model === "flux-pro-1.1" ? "1152x896" : "2048x2048");
  const candidate = prepareOwnerFluxImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, model_id: model,
    parameters: { resolution, cfg: 2.375, steps: 17.25, image_strength: 0.625, workflow_type: loraCount ? "civitai" : "default",
      raw: model === "flux-pro-1.1-ultra" ? false : null, civitai_loras: loras }, asset_set: assetSet, prompt: "exact Flux source intent" },
  { catalog, catalog_version: CATALOG_VERSION });
  const permit = createOwnerFluxImageOneShotPermit({ candidate, principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id,
    catalog, catalog_version: CATALOG_VERSION });
  return { issuer, candidate, permit };
}

const VARIANTS = ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"] as const;

test("Flux native client exposes only its fixed upload, owned start, and exact-result read seams", () => {
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => new Response("{}") });
  const seams = client as unknown as Record<string, unknown>;
  assert.equal(typeof seams.uploadFluxImageReference, "function");
  assert.equal(typeof seams.startFluxImageWithOwnedCandidate, "function");
  assert.equal(typeof seams.getFluxImageResult, "function");
});

test("Flux-1 upload uses the fixed singular image route and returns only its safe receipt", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const form = init?.body as FormData;
    assert.deepEqual(Array.from(form.keys()), ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "flux-1");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "reference.png");
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    return json({ files: [{ id: "flux-file-1", url: "https://r2.syntx.ai/flux/input.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });

  const receipt = await client.uploadFluxImageReference({ variant: "flux-1", bytes: PNG, filename: "reference.png", mime_type: "image/png" });
  assert.deepEqual(receipt, { file_id: "flux-file-1", url: "https://r2.syntx.ai/flux/input.png" });
  assert.equal(calls, 1);
  assert.ok(PNG.some((byte) => byte !== 0), "caller bytes stay unchanged");
});

test("Flux upload rejects Pro input locally and does not echo an unsafe receipt URL or retry", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentialCalls += 1;
    return operation(CREDENTIAL);
  } }, fetchImpl: async () => {
    fetchCalls += 1;
    return json({ files: [{ id: "flux-upload", url: "https://attacker.invalid/private.png", mime_type: "image/png", size: PNG.byteLength }] });
  } });
  await assert.rejects(client.uploadFluxImageReference({ variant: "flux-pro-1.1", bytes: PNG, filename: "reference.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  await assert.rejects(client.uploadFluxImageReference({ variant: "runway_frames", bytes: PNG, filename: "reference.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
  await assert.rejects(client.uploadFluxImageReference({ variant: "flux-1", bytes: PNG, filename: "reference.png", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
  await assert.rejects(client.uploadFluxImageReference({ variant: "flux-1", bytes: PNG, filename: "reference.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" && !error.message.includes("attacker.invalid"));
  assert.equal(credentialCalls, 1);
  assert.equal(fetchCalls, 1);
});

test("pre-aborted Flux upload performs no credential or network work and preserves caller bytes", async () => {
  let credentialCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentialCalls += 1;
    return operation(CREDENTIAL);
  } }, fetchImpl: async () => {
    fetchCalls += 1;
    return json({ files: [{ id: "unused", url: "https://r2.syntx.ai/flux/unused.png" }] });
  } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.uploadFluxImageReference({ variant: "flux-1", bytes: PNG, filename: "reference.png", mime_type: "image/png" }, controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(credentialCalls, 0);
  assert.equal(fetchCalls, 0);
  assert.ok(PNG.some((byte) => byte !== 0));
});

test("Flux owned POST preserves all three variants, source omissions, one input image and all three LoRA controls", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as unknown;
    calls.push({ url, body });
    return json({ id: `flux-message-${calls.length}` });
  } });
  const variants: OwnerFluxImageModel[] = ["flux-1", "flux-pro-1.1", "flux-pro-1.1-ultra"];
  for (const variant of variants) {
    const value = await prepared(variant, variant === "flux-1", variant === "flux-1" ? 3 : 0);
    const receipt = await client.startFluxImageWithOwnedCandidate({ candidate: value.candidate, permit: value.permit,
      principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT });
    assert.deepEqual(receipt, { chat_uuid: CHAT, message_id: `flux-message-${calls.length}` });
    value.issuer.close();
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.url === "https://api.syntx.ai/api/v1/design/generate?ai_name=flux"));
  assert.deepEqual(calls.map((call) => call.body), [
    { chat_uuid: CHAT, prompt: "exact Flux source intent", settings: {
      model_type: "flux-1", resolution: "1024x1024", cfg: 2.375, steps: 17.25, image_strength: 0.625,
      workflow_type: "civitai", n: 1, file_urls: [{ type: "image", url: "https://r2.syntx.ai/private/flux/reference.png" }],
      civitai_loras: [0, 1, 2].map((index) => ({ id: String(900 + index), url: `https://civitai.com/api/download/models/${900 + index}`,
        strength_model: [0.25, 0.875, 1.5][index], strength_clip: [0.25, 0.875, 1.5][index] }))
    } },
    { chat_uuid: CHAT, prompt: "exact Flux source intent", settings: {
      model_type: "flux-pro-1.1", resolution: "1152x896", cfg: 2.375, steps: 17.25, image_strength: 0.625,
      workflow_type: "default", n: 1, file_urls: []
    } },
    { chat_uuid: CHAT, prompt: "exact Flux source intent", settings: {
      model_type: "flux-pro-1.1-ultra", resolution: "2048x2048", cfg: 2.375, steps: 17.25, image_strength: 0.625,
      workflow_type: "default", n: 1, file_urls: [], raw: false
    } }
  ]);
});

test("Flux transport preserves all eighteen source resolutions and each nonempty LoRA cardinality", async () => {
  const resolutions: Record<OwnerFluxImageModel, readonly string[]> = {
    "flux-1": ["1344x768", "1216x832", "1152x896", "1280x1024", "1024x1024", "1024x1280", "896x1152", "832x1216", "768x1344"],
    "flux-pro-1.1": ["1152x896", "1280x1024"],
    "flux-pro-1.1-ultra": ["3136x1344", "2752x1536", "2368x1792", "2048x2048", "1792x2368", "1536x2752", "1344x3136"]
  };
  const observed: Array<{ model_type: unknown; resolution: unknown; cfg: unknown; steps: unknown; image_strength: unknown; loras: number }> = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { settings: Record<string, unknown> };
    observed.push({ model_type: body.settings.model_type, resolution: body.settings.resolution,
      cfg: body.settings.cfg, steps: body.settings.steps, image_strength: body.settings.image_strength,
      loras: Array.isArray(body.settings.civitai_loras) ? body.settings.civitai_loras.length : 0 });
    return json({ id: `flux-resolution-${observed.length}` });
  } });
  let count = 0;
  for (const model of VARIANTS) for (const resolution of resolutions[model]) {
    const loraCount = model === "flux-1" ? (count % 4) : 0;
    const value = await prepared(model, model === "flux-1" && count % 2 === 0, loraCount, resolution);
    await client.startFluxImageWithOwnedCandidate({ candidate: value.candidate, permit: value.permit,
      principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT });
    value.issuer.close();
    count += 1;
  }
  assert.equal(count, 18);
  assert.deepEqual(observed.map((entry) => [entry.model_type, entry.resolution]),
    VARIANTS.flatMap((model) => resolutions[model].map((resolution) => [model, resolution])));
  assert.ok(observed.every((entry) => entry.cfg === 2.375 && entry.steps === 17.25 && entry.image_strength === 0.625));
  assert.deepEqual(observed.slice(0, 9).map((entry) => entry.loras), [0, 1, 2, 3, 0, 1, 2, 3, 0]);
});

test("pre-aborted Flux dispatch leaves its permit unspent and an uncertain POST is single-use without retry", async () => {
  const before = await prepared("flux-1");
  let preAbortCalls = 0;
  const preAbortClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    preAbortCalls += 1;
    return json({ id: "unused" });
  } });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(preAbortClient.startFluxImageWithOwnedCandidate({ candidate: before.candidate, permit: before.permit,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT }, controller.signal),
  (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(preAbortCalls, 0);
  assert.equal(consumeOwnerFluxImageOneShotPermit({ permit: before.permit, candidate: before.candidate,
    principal: PRINCIPAL, attemptId: PRINCIPAL.connection_id }).status, "consumed");
  before.issuer.close();

  const after = await prepared("flux-pro-1.1");
  let postCalls = 0;
  const unknownClient = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    postCalls += 1;
    throw new Error("synthetic connection loss");
  } });
  const request = { candidate: after.candidate, permit: after.permit, principal: PRINCIPAL,
    attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT };
  await assert.rejects(unknownClient.startFluxImageWithOwnedCandidate(request));
  await assert.rejects(unknownClient.startFluxImageWithOwnedCandidate(request),
    (error: unknown) => (error as { code?: string }).code === "PERMIT_ALREADY_CONSUMED");
  assert.equal(postCalls, 1);
  after.issuer.close();
});

test("Flux POST rejects a forged candidate before dispatch and keeps private caller data out of errors", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    calls += 1;
    return json({ id: "must-not-dispatch" });
  } });
  const privateMarker = "https://private.invalid/secret-weight.safetensors?token=do-not-echo";
  await assert.rejects(client.startFluxImageWithOwnedCandidate({
    candidate: { variant: "flux-1", prompt: privateMarker, dispatch_allowed: true },
    permit: { request_fingerprint: privateMarker }, principal: PRINCIPAL,
    attemptId: PRINCIPAL.connection_id, chat_uuid: CHAT
  }), (error: unknown) => (error as { code?: string; message?: string }).code === "INVALID_REQUEST" &&
    !(error as Error).message.includes(privateMarker));
  assert.equal(calls, 0);
});

test("Flux exact result read performs one GET and preserves unknown MIME and unverified geometry", async () => {
  let calls = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    calls += 1;
    assert.equal(String(input), `https://api.syntx.ai/api/v1/chats/${CHAT}/flux-message-result`);
    assert.equal(init?.method, "GET");
    return json({ id: "flux-message-result", chat_id: 987654321, author_id: -1, message_object: [{
      id: "flux-object-result", message_id: "flux-message-result", object_type: "image", model_type: "flux-pro-1.1-ultra",
      completed: true, object_url: "https://r2.syntx.ai/flux/generated"
    }] });
  } });
  const result = await client.getFluxImageResult({ chat_uuid: CHAT, message_id: "flux-message-result", variant: "flux-pro-1.1-ultra",
    provider_chat_id: "987654321", message_object_ids: ["flux-object-result"] });
  assert.equal(result.status, "COMPLETE");
  if (result.status !== "COMPLETE") return;
  assert.equal(result.artifact.url, "https://r2.syntx.ai/flux/generated");
  assert.equal(result.artifact.mime_type, null);
  assert.equal(result.artifact.mime_source, "UNKNOWN");
  assert.equal(result.artifact.geometry_verified, false);
  await assert.rejects(client.getFluxImageResult({ chat_uuid: CHAT, message_id: "flux-message-result", variant: "flux-pro-1.1-ultra",
    provider_chat_id: "987654321", message_object_ids: ["wrong-object", "extra-object"] }));
  assert.equal(calls, 1, "invalid read binding is rejected before another GET");
});

function context(variant: typeof VARIANTS[number] = "flux-1") {
  return { chat_uuid: "flux-chat", message_id: "bot-result", variant, provider_chat_id: "987654321", message_object_ids: ["image-result"] };
}

function response(variant = "flux-1", url = "https://r2.syntx.ai/flux/result.png") {
  return { id: "bot-result", chat_id: 987654321, author_id: -1, message_object: [{ id: "image-result", message_id: "bot-result",
    object_type: "image", model_type: variant, completed: true, object_url: url }] };
}

test("Flux result binds exactly one completed image for every source model and leaves MIME extension-only", () => {
  for (const variant of VARIANTS) {
    const result = decodeOwnerFluxImageResult(response(variant), context(variant));
    assert.equal(result.status, "COMPLETE", variant);
    if (result.status !== "COMPLETE") continue;
    assert.equal(result.model_type, variant);
    assert.equal(result.artifact.message_object_id, "image-result");
    assert.equal(result.artifact.mime_type, "image/png");
    assert.equal(result.artifact.mime_source, "URL_EXTENSION");
    assert.equal(result.artifact.geometry_verified, false);
    assert.equal(result.artifact.width, null);
  }
});

test("Flux result requires the exact bot row, producer model, safe URL and single output", () => {
  assert.deepEqual(decodeOwnerFluxImageResult({ ...response(), id: "other" }, context()),
    { ...context(), status: "UNVERIFIED", reason: "OUTER_MESSAGE_MISMATCH" });
  assert.deepEqual(decodeOwnerFluxImageResult({ ...response(), author_id: 12 }, context()),
    { ...context(), status: "UNVERIFIED", reason: "NOT_BOT_MESSAGE" });
  assert.deepEqual(decodeOwnerFluxImageResult({ ...response(), message_object: [
    response().message_object[0], response().message_object[0]
  ] }, context()), { ...context(), status: "UNVERIFIED", reason: "RESULT_OBJECT_CARDINALITY_INVALID" });
  assert.deepEqual(decodeOwnerFluxImageResult(response("flux-pro-1.1"), context()),
    { ...context(), status: "UNVERIFIED", reason: "MODEL_TYPE_MISMATCH" });
  const unknownExtension = decodeOwnerFluxImageResult(response("flux-1", "https://r2.syntx.ai/flux/result"), context());
  assert.equal(unknownExtension.status, "COMPLETE");
  if (unknownExtension.status === "COMPLETE") {
    assert.equal(unknownExtension.artifact.mime_type, null);
    assert.equal(unknownExtension.artifact.mime_source, "UNKNOWN");
  }
  assert.deepEqual(decodeOwnerFluxImageResult(response("flux-1", "https://files.example.invalid/result.png"), context()),
    { ...context(), status: "UNVERIFIED", reason: "RESULT_URL_UNSAFE" });
});

test("Flux result treats absent or unfinished artifacts as pending and rejects duplicate object identity", () => {
  assert.deepEqual(decodeOwnerFluxImageResult({ ...response(), message_object: [] }, context()),
    { ...context(), status: "PENDING", reason: "NO_RESULT_OBJECTS" });
  const unfinished = response();
  unfinished.message_object[0]!.completed = false;
  assert.deepEqual(decodeOwnerFluxImageResult(unfinished, context()),
    { ...context(), status: "PENDING", reason: "RESULT_NOT_COMPLETED" });
  const duplicate = response();
  duplicate.message_object[0]!.id = "unexpected-object";
  assert.deepEqual(decodeOwnerFluxImageResult(duplicate, context()),
    { ...context(), status: "UNVERIFIED", reason: "OBJECT_ID_MISMATCH" });
});

test("Flux result snapshots exact safe context and never reads accessor-backed provider fields", () => {
  const contextWithExtra = { ...context(), extra: "must-not-enter-binding" };
  assert.throws(() => decodeOwnerFluxImageResult(response(), contextWithExtra), TypeError);
  const hostile = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(hostile, "id", { enumerable: true, get() { throw new Error("provider getter invoked"); } });
  assert.deepEqual(decodeOwnerFluxImageResult(hostile, context()),
    { ...context(), status: "UNVERIFIED", reason: "RESPONSE_SHAPE_INVALID" });
});
