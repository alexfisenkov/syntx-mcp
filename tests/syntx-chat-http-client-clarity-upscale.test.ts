import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import {
  createOwnerClarityUpscaleOwnedImageBindingIssuer,
  prepareOwnerClarityUpscaleRequest
} from "../src/application/owner-clarity-upscale-request-preparer.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";

const ATTEMPT = "link_owner_clarity_http_attempt_000001";
const PRINCIPAL: Readonly<GenerationPrincipalRef> = Object.freeze({
  tenant_id: "owner-clarity-http-tenant", subject_id: "owner-clarity-http-subject", connection_id: ATTEMPT
});
const IMAGE = Object.freeze({
  principal: PRINCIPAL, attempt_id: ATTEMPT, scope: "tool_image_upscaler", model_id: "clarity",
  file_url: "https://r2.syntx.ai/private/clarity-http-input?sig=synthetic", mime_type: "image/png",
  width: 2000, height: 1000
});
const SECRET = "synthetic-clarity-credential";
const policyUrl = new URL("../src/application/owner-clarity-upscale-one-shot-policy.js", import.meta.url).href;

async function loadPolicy(): Promise<Record<string, any> | null> {
  try { return await import(policyUrl) as Record<string, any>; }
  catch { return null; }
}

async function buildCandidate(prompt: string | undefined) {
  const issuer = createOwnerClarityUpscaleOwnedImageBindingIssuer(async () => IMAGE);
  const imageBinding = await issuer.issue({
    principal: PRINCIPAL, attempt_id: ATTEMPT, opaque_image_handle: "synthetic-owned-image-002"
  });
  return prepareOwnerClarityUpscaleRequest({
    principal: PRINCIPAL, attempt_id: ATTEMPT, ...(prompt === undefined ? {} : { prompt }),
    parameters: { professional_mode: false, scale_factor: 2, strength: 0.85, cfg: 6, denoise: 0.2 },
    image_binding: imageBinding
  });
}

async function permitFor(candidate: unknown) {
  const module = await loadPolicy();
  assert.ok(module?.createOwnerClarityUpscaleOneShotPermit, "Clarity one-shot policy must exist");
  const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
  return { module, permit: module.createOwnerClarityUpscaleOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog
  }) };
}

function clientWith(fetchImpl: typeof fetch) {
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation(SECRET); }
  };
  return new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl });
}

function startClarity(client: SyntxChatHttpClient, input: unknown) {
  const method = (client as unknown as {
    startClarityUpscaleWithOwnedCandidate?: (request: unknown, signal?: AbortSignal) => Promise<unknown>;
  }).startClarityUpscaleWithOwnedCandidate;
  assert.equal(typeof method, "function", "permit-gated Clarity dispatch bridge must exist");
  return method!.call(client, input);
}

function getClarityResult(client: SyntxChatHttpClient, chatUuid: string, messageId: string) {
  const method = (client as unknown as {
    getClarityUpscaleResult?: (chatUuid: string, messageId: string) => Promise<unknown>;
  }).getClarityUpscaleResult;
  assert.equal(typeof method, "function", "fixed Clarity result decoder must exist");
  return method!.call(client, chatUuid, messageId);
}

test("Clarity bridge sends only the exact branded candidate body and query", async () => {
  const candidate = await buildCandidate("clean edges");
  const { permit } = await permitFor(candidate);
  let calls = 0;
  let captured: { url: string; method: string; auth: string | null; body: unknown } | undefined;
  const client = clientWith(async (input, init) => {
    calls += 1;
    captured = {
      url: String(input), method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null
    };
    return new Response(JSON.stringify({ id: 681 }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.deepEqual(await startClarity(client, { candidate, permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "clarity-chat-001" }), {
    chat_uuid: "clarity-chat-001", message_id: "681"
  });
  assert.equal(calls, 1);
  assert.deepEqual(captured, {
    url: "https://api.syntx.ai/api/v1/design/generate?ai_name=clarity",
    method: "POST", auth: `Bearer ${SECRET}`,
    body: {
      chat_uuid: "clarity-chat-001",
      prompt: "clean edges",
      settings: {
        n: 1, model_type: "clarity", scale: 0.5, is_professional_mode: false,
        strength: 0.85, cfg: 6, denoise: 0.2,
        file_urls: [{ type: "image", url: IMAGE.file_url }]
      }
    }
  });
});

test("Clarity bridge omits an absent prompt and rejects forged or caller-extended requests before POST", async () => {
  const candidate = await buildCandidate(undefined);
  const { module, permit } = await permitFor(candidate);
  let calls = 0;
  const client = clientWith(async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body));
    assert.equal(Object.hasOwn(body, "prompt"), false);
    return new Response(JSON.stringify({ id: "safe-message" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const base = { candidate, permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "clarity-chat-002" };
  await assert.rejects(() => startClarity(client, { ...base, ai_name: "attacker" }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  await assert.rejects(() => startClarity(client, { ...base, candidate: { ...candidate } }),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  assert.equal(calls, 0);
  assert.deepEqual(await startClarity(client, base), { chat_uuid: "clarity-chat-002", message_id: "safe-message" });
  assert.equal(calls, 1);
  assert.ok(module);
});

test("Clarity bridge consumes permit before POST and never retries a failed response", async () => {
  const candidate = await buildCandidate("clean edges");
  const { module, permit } = await permitFor(candidate);
  let calls = 0;
  const client = clientWith(async () => {
    calls += 1;
    return new Response(JSON.stringify({ error: SECRET }), { status: 401, headers: { "content-type": "application/json" } });
  });
  const request = { candidate, permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "clarity-chat-003" };
  await assert.rejects(() => startClarity(client, request),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "AUTH_OR_ACCESS_DENIED" && !String(error).includes(SECRET));
  await assert.rejects(() => startClarity(client, request),
    (error: unknown) => error instanceof Error &&
      (error as Error & { code?: unknown }).code === "PERMIT_ALREADY_CONSUMED" &&
      error.name === module.OwnerClarityUpscaleOneShotPolicyError.name);
  assert.equal(calls, 1);
});

test("Clarity result decoder uses one fixed GET and returns one strictly bound bot image", async () => {
  let calls = 0;
  let seen: { url: string; method: string } | undefined;
  const client = clientWith(async (input, init) => {
    calls += 1;
    seen = { url: String(input), method: init?.method ?? "GET" };
    return new Response(JSON.stringify({
      id: "clarity-message-004", author_id: -1,
      message_object: [{ id: 801, message_id: "clarity-message-004", object_type: "image", model_type: "clarity",
        completed: true, object_url: "https://r2.syntx.ai/generated/clarity-result.png?signature=synthetic" }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = await getClarityResult(client, "clarity-chat-004", "clarity-message-004") as Record<string, any>;
  assert.equal(calls, 1);
  assert.deepEqual(seen, { url: "https://api.syntx.ai/api/v1/chats/clarity-chat-004/clarity-message-004", method: "GET" });
  assert.equal(result.status, "COMPLETE");
  assert.equal(result.chat_uuid, "clarity-chat-004");
  assert.equal(result.message_id, "clarity-message-004");
  assert.equal(result.message_object_id, "801");
  assert.equal(result.model_type, "clarity");
  assert.deepEqual(result.artifact, {
    url: "https://r2.syntx.ai/generated/clarity-result.png?signature=synthetic",
    mime_type: "image/png", mime_source: "URL_EXTENSION"
  });
  assert.equal("width" in result.artifact, false);
  assert.equal("byte_size" in result.artifact, false);
});

test("Clarity result decoder fails closed on nonbot, multi-object, wrong-model, foreign-message and unknown-MIME results", async () => {
  const base = {
    id: "clarity-message-005", author_id: -1,
    message_object: [{ id: "801", message_id: "clarity-message-005", object_type: "image", model_type: "clarity",
      completed: true, object_url: "https://r2.syntx.ai/generated/result.jpg" }]
  };
  const cases = [
    { payload: { ...base, author_id: 5 }, reason: "NOT_BOT_MESSAGE" },
    { payload: { ...base, message_object: [] }, reason: "NO_IMAGE_OBJECTS" },
    { payload: { ...base, message_object: [...base.message_object, ...base.message_object] }, reason: "RESULT_COUNT_OUT_OF_RANGE" },
    { payload: { ...base, message_object: [{ ...base.message_object[0], message_id: "foreign-message" }] }, reason: "RESULT_OBJECT_MISMATCH" },
    { payload: { ...base, message_object: [{ ...base.message_object[0], model_type: "banana" }] }, reason: "RESULT_OBJECT_MISMATCH" },
    { payload: { ...base, message_object: [{ ...base.message_object[0], object_type: "video" }] }, reason: "RESULT_OBJECT_MISMATCH" },
    { payload: { ...base, message_object: [{ ...base.message_object[0], extra: "deny" }] }, reason: "RESULT_OBJECT_INCOMPLETE" },
    { payload: { ...base, message_object: [{ ...base.message_object[0], object_url: "https://evil.invalid/result.jpg" }] }, reason: "RESULT_URL_UNSAFE" },
    { payload: { ...base, message_object: [{ ...base.message_object[0], object_url: "https://r2.syntx.ai/generated/result.unknown" }] }, reason: "RESULT_MIME_UNKNOWN" }
  ];
  for (const { payload, reason } of cases) {
    let calls = 0;
    const client = clientWith(async () => {
      calls += 1;
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    });
    const result = await getClarityResult(client, "clarity-chat-005", "clarity-message-005") as Record<string, any>;
    assert.equal(result.status, "UNVERIFIED");
    assert.equal(result.reason, reason);
    assert.deepEqual(result.objects, []);
    assert.equal("artifact" in result, false);
    assert.equal(calls, 1, "unverified results must not trigger a fallback GET");
  }
});
