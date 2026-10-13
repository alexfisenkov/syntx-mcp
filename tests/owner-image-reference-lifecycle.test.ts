import assert from "node:assert/strict";
import test from "node:test";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedPublicCatalog } from "../src/catalog/public-catalog-history.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { AuthBinding, PublicAuthLinkAttempt } from "../src/auth/types.js";
import type { OwnerImageReferenceDispatchClient, OwnerContractMediaContractContext } from "../src/application/owner-contract-media.js";
import { OwnerContractMediaError, OwnerContractMediaService } from "../src/application/owner-contract-media.js";
import { OwnerContractMediaRecoveryStore } from "../src/application/owner-contract-media-recovery.js";
import { createOwnerImageReferenceOneShotPermit } from "../src/application/owner-image-reference-one-shot-policy.js";
import { getOwnerImageReferenceCandidateStoreBinding, prepareOwnerImageReferenceRequest } from "../src/application/owner-image-reference-request-preparer.js";
import { OwnerMediaReferenceStore, OwnerMediaReferenceStoreError } from "../src/application/owner-media-reference-store.js";

const ROOT = process.cwd();
const REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const ATTEMPT = "link_abcdefghijklmnopqrstuvwxyz123456";
const BINDING: AuthBinding = { tenant_id: "tenant_local_owner", subject: "subject_local_owner" };
const PRINCIPAL = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
const CONTRACT: OwnerContractMediaContractContext = {
  model_id: "banana-2.1", operation_id: "generate-image", modality: "image", ai_name: "banana",
  model_type: "banana-2.1", variant_id: "banana21-image-1k-minimal-square",
  schema_hash: "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d",
  status: "live_verified", mime_types: ["image/jpeg"]
};

async function fixture(options: { readonly failRecoveryCreate?: boolean; readonly startError?: Error } = {}) {
  const registry = loadGenerationContractRegistryV2(REGISTRY_VERSION, `${ROOT}/catalog`);
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: `${ROOT}/catalog` }).snapshot;
  const catalog = new DiscoveryCatalogRepository(snapshot);
  const linkService = { async getStatus(_binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  let handleIndex = 0;
  const handles = [
    "reference_823e4567-e89b-12d3-a456-426614174000",
    "reference_923e4567-e89b-12d3-a456-426614174000",
    "reference_a23e4567-e89b-12d3-a456-426614174000"
  ];
  const store = new OwnerMediaReferenceStore({ createHandle: () => handles[handleIndex++]! });
  const contractBinding = getOwnerImageReferenceCandidateStoreBinding(registry, catalog);
  const receipt = await store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/owned/reference.png" }]; } },
    contract: contractBinding, filename: "reference.png", mime_type: "image/png", bytes: Uint8Array.from([1, 2, 3])
  });
  const otherReceipt = await store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/owned/other.png" }]; } },
    contract: contractBinding, filename: "other.png", mime_type: "image/png", bytes: Uint8Array.from([4, 5, 6])
  });
  const sameUrlReceipt = await store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/owned/reference.png" }]; } },
    contract: contractBinding, filename: "reference-copy.png", mime_type: "image/png", bytes: Uint8Array.from([7, 8, 9])
  });
  const candidate = await prepareOwnerImageReferenceRequest({
    registry, catalog, store, binding: BINDING, attemptId: ATTEMPT, linkService,
    reference_handle: receipt.reference_handle, parameters: { prompt: "Use this source image as a visual reference." }
  });
  let permitNow = 1_000;
  const permit = createOwnerImageReferenceOneShotPermit({ candidate, registry, catalog, principal: PRINCIPAL, attemptId: ATTEMPT, now: () => permitNow });
  const calls = { chat: 0, image: 0, video: 0, get: 0, preflight: 0, principal: 0 };
  const client: OwnerImageReferenceDispatchClient = {
    async createChat() { calls.chat += 1; return { chat_uuid: "reference-chat" }; },
    async startImageWithInternalReferences(request, references) {
      calls.image += 1;
      assert.deepEqual(request.settings.file_urls, []);
      assert.deepEqual(references, [{ url: "https://r2.syntx.ai/owned/reference.png" }]);
      if (options.startError) throw options.startError;
      return { chat_uuid: request.chat_uuid, message_id: "reference-echo" };
    },
    async getMessage(chatUuid, messageId) {
      calls.get += 1;
      return { chat_uuid: chatUuid, message_id: messageId, object_type: "image", model_type: "banana-2.1", artifacts: [{ url: "https://r2.syntx.ai/generated/result.jpg", mime_type: "image/jpeg" }] };
    },
    async listInProgress() { return []; }
  };
  const recoveryStore = options.failRecoveryCreate
    ? { create() { throw new Error("recovery capacity unavailable"); }, get() { return undefined; }, list() { return []; }, updateMessageId() {}, remove() {} }
    : new OwnerContractMediaRecoveryStore();
  const service = new OwnerContractMediaService({ recoveryStore, wait: async () => undefined, imageTimeoutMs: 20 });
  const lifecycle = {
    client, attemptId: ATTEMPT, contract: { ...CONTRACT, mime_types: [...CONTRACT.mime_types] }, candidate, permit, binding: { ...BINDING },
    referenceStore: store, referenceHandle: receipt.reference_handle, linkService,
    resolveAuthPrincipal: async () => { calls.principal += 1; return PRINCIPAL; },
    preflight: {
      verifyFreshSubscription: async () => { calls.preflight += 1; },
      verifyModelAccess: async () => { calls.preflight += 1; },
      authorizeCost: async () => { calls.preflight += 1; }
    }
  };
  return {
    service, lifecycle, store, receipt, otherReceipt, sameUrlReceipt, calls, recoveryStore, linkService, contractBinding,
    advancePermitClock: (value: number) => { permitNow = value; }
  };
}

test("dispatches one exact reference image after fresh preflight and keeps candidate status blocked", async () => {
  const context = await fixture();
  const result = await context.service.generateImageReferenceCandidate(context.lifecycle);
  assert.equal(result.artifacts.length, 1);
  assert.deepEqual(context.calls, { chat: 1, image: 1, video: 0, get: 1, preflight: 3, principal: 3 });
  assert.equal(context.lifecycle.candidate.status, "blocked");
  assert.equal(context.lifecycle.candidate.dispatch_allowed, false);
  await assert.rejects(() => context.store.consumeImageReference({
    binding: BINDING, attemptId: ATTEMPT, linkService: context.lifecycle.linkService,
    contract: {
      schema_hash: context.lifecycle.candidate.candidate_schema_hash,
      catalog_version: `sha256-${context.lifecycle.candidate.registry_sha256.slice("sha256:".length)}.json`,
      model_id: context.lifecycle.candidate.model_id, model_type: context.lifecycle.candidate.model_type,
      operation_id: context.lifecycle.candidate.operation_id, modality: "image",
      variant_id: context.lifecycle.candidate.candidate_variant_id
    },
    reference_handles: [context.lifecycle.referenceHandle], reference_handle: context.lifecycle.referenceHandle,
    expected_url: "https://r2.syntx.ai/owned/reference.png"
  }), (error: unknown) => error instanceof OwnerMediaReferenceStoreError && error.code === "REFERENCE_NOT_FOUND");
  await assert.rejects(() => context.service.generateImageReferenceCandidate({
    ...context.lifecycle, referenceHandle: context.otherReceipt.reference_handle
  }), (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED");
  assert.deepEqual(await context.store.resolveImageReferences({
    binding: BINDING, attemptId: ATTEMPT, linkService: context.linkService,
    contract: context.contractBinding, reference_handles: [context.otherReceipt.reference_handle]
  }), { file_urls: ["https://r2.syntx.ai/owned/other.png"] });
  await assert.rejects(() => context.service.generateImageReferenceCandidate({
    ...context.lifecycle, referenceHandle: context.sameUrlReceipt.reference_handle
  }), (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED");
  assert.equal(context.calls.image, 1, "a reused permit must not produce another POST");
});

test("owner reference lifecycle reaches the real HTTP client only through its internal bridge", async () => {
  const context = await fixture();
  const requests: Array<{ url: string; method: string; body?: unknown }> = [];
  let credentialCalls = 0;
  const httpClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential(operation) { credentialCalls += 1; return operation("synthetic-http-credential"); } },
    fetchImpl: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(String(init.body)) as unknown : undefined;
      requests.push({ url, method, ...(body === undefined ? {} : { body }) });
      if (url === "https://api.syntx.ai/api/v1/chats") return new Response(JSON.stringify({ uuid: "reference-http-chat" }), {
        headers: { "content-type": "application/json" }
      });
      if (url === "https://api.syntx.ai/api/v1/design/generate?ai_name=banana") return new Response(JSON.stringify({ id: "reference-http-message" }), {
        headers: { "content-type": "application/json" }
      });
      if (url === "https://api.syntx.ai/api/v1/chats/reference-http-chat/reference-http-message") return new Response(JSON.stringify({
        id: "reference-http-message", author_id: -1,
        message_object: [{ id: "reference-http-object", object_type: "image", model_type: "banana-2.1", completed: true,
          object_url: "https://r2.syntx.ai/generated/reference-http-result.jpg" }]
      }), { headers: { "content-type": "application/json" } });
      throw new Error("unexpected synthetic HTTP route");
    }
  });
  const service = new OwnerContractMediaService({ recoveryStore: new OwnerContractMediaRecoveryStore(), wait: async () => undefined, imageTimeoutMs: 1_000 });
  const result = await service.generateImageReferenceCandidate({ ...context.lifecycle, client: httpClient });
  assert.equal(result.artifacts.length, 1);
  assert.deepEqual(requests.map(({ url, method }) => ({ url, method })), [
    { url: "https://api.syntx.ai/api/v1/chats", method: "POST" },
    { url: "https://api.syntx.ai/api/v1/design/generate?ai_name=banana", method: "POST" },
    { url: "https://api.syntx.ai/api/v1/chats/reference-http-chat/reference-http-message", method: "GET" }
  ]);
  const body = requests[1]?.body as { settings: { file_urls: unknown[] } };
  assert.deepEqual(body.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/owned/reference.png" }]);
  assert.equal(credentialCalls, 3);
});

test("preflight failure and recovery-reservation failure make zero generation POSTs", async () => {
  const preflight = await fixture();
  preflight.lifecycle.preflight.verifyModelAccess = async () => { throw new Error("access unavailable"); };
  await assert.rejects(() => preflight.service.generateImageReferenceCandidate(preflight.lifecycle),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED");
  assert.equal(preflight.calls.image, 0);

  const recovery = await fixture({ failRecoveryCreate: true });
  await assert.rejects(() => recovery.service.generateImageReferenceCandidate(recovery.lifecycle),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED");
  assert.equal(recovery.calls.image, 0);
});

test("missing internal-reference HTTP port fails before chat or generation", async () => {
  const context = await fixture();
  const { startImageWithInternalReferences: _missing, ...clientWithoutBridge } = context.lifecycle.client;
  await assert.rejects(() => context.service.generateImageReferenceCandidate({
    ...context.lifecycle, client: clientWithoutBridge as unknown as OwnerImageReferenceDispatchClient
  }), (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PREPARED_REQUEST_MISMATCH");
  assert.equal(context.calls.chat, 0);
  assert.equal(context.calls.image, 0);
});

test("expired permit and foreign fresh principal fail before chat or image POST", async () => {
  const expired = await fixture();
  expired.advancePermitClock(901_000);
  await assert.rejects(() => expired.service.generateImageReferenceCandidate(expired.lifecycle),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED");
  assert.equal(expired.calls.chat, 0);
  assert.equal(expired.calls.image, 0);

  const foreign = await fixture();
  foreign.lifecycle.resolveAuthPrincipal = async () => ({ ...PRINCIPAL, tenant_id: "tenant_foreign" });
  await assert.rejects(() => foreign.service.generateImageReferenceCandidate(foreign.lifecycle),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PREPARED_REQUEST_MISMATCH");
  assert.equal(foreign.calls.image, 0);
});

test("rechecks auth after preflight and immediately before image POST", async () => {
  const revokedDuringPreflight = await fixture();
  let current = PRINCIPAL;
  revokedDuringPreflight.lifecycle.resolveAuthPrincipal = async () => current;
  revokedDuringPreflight.lifecycle.preflight.authorizeCost = async () => {
    current = { ...PRINCIPAL, tenant_id: "tenant_foreign" };
  };
  await assert.rejects(() => revokedDuringPreflight.service.generateImageReferenceCandidate(revokedDuringPreflight.lifecycle),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED");
  assert.equal(revokedDuringPreflight.calls.chat, 0);
  assert.equal(revokedDuringPreflight.calls.image, 0);

  const revokedDuringChat = await fixture();
  let chatPrincipal = PRINCIPAL;
  revokedDuringChat.lifecycle.resolveAuthPrincipal = async () => chatPrincipal;
  revokedDuringChat.lifecycle.client.createChat = async () => {
    revokedDuringChat.calls.chat += 1;
    chatPrincipal = { ...PRINCIPAL, tenant_id: "tenant_foreign" };
    return { chat_uuid: "reference-chat" };
  };
  await assert.rejects(() => revokedDuringChat.service.generateImageReferenceCandidate(revokedDuringChat.lifecycle),
    (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PRE_DISPATCH_FAILED");
  assert.equal(revokedDuringChat.calls.chat, 1);
  assert.equal(revokedDuringChat.calls.image, 0);
});

test("preflight callback mutation cannot change the snapshotted contract identity", async () => {
  const context = await fixture();
  const mutableContract = context.lifecycle.contract;
  context.lifecycle.preflight.verifyFreshSubscription = async () => {
    (mutableContract as { model_id: string }).model_id = "foreign-model";
  };
  const result = await context.service.generateImageReferenceCandidate(context.lifecycle);
  assert.equal(result.model_id, "banana-2.1");
});

test("rejects non-base MIME and foreign optional source versions before chat or image POST", async () => {
  const cases = [
    (context: Awaited<ReturnType<typeof fixture>>) => {
      context.lifecycle.contract = { ...context.lifecycle.contract, mime_types: ["image/png"] };
    },
    (context: Awaited<ReturnType<typeof fixture>>) => {
      context.lifecycle.contract = { ...context.lifecycle.contract, registry_version: `sha256-${"a".repeat(64)}.json` };
    },
    (context: Awaited<ReturnType<typeof fixture>>) => {
      context.lifecycle.contract = { ...context.lifecycle.contract, catalog_version: `${context.lifecycle.candidate.catalog_version}-foreign` };
    }
  ];
  for (const change of cases) {
    const context = await fixture();
    change(context);
    await assert.rejects(() => context.service.generateImageReferenceCandidate(context.lifecycle),
      (error: unknown) => error instanceof OwnerContractMediaError && error.code === "PREPARED_REQUEST_MISMATCH");
    assert.equal(context.calls.chat, 0);
    assert.equal(context.calls.image, 0);
  }
});

test("recovery candidate metadata rejects unapproved extra URL fields", () => {
  const recovery = new OwnerContractMediaRecoveryStore();
  const input = {
    attemptId: ATTEMPT, chatUuid: "reference-chat", messageId: null, contract: CONTRACT,
    imageReferenceCandidate: {
      candidate_schema_hash: `sha256:${"c".repeat(64)}`, status: "blocked", dispatch_allowed: false,
      backend_acceptance: "unproven", url: "https://private.invalid/reference.png"
    }
  };
  assert.throws(() => recovery.create(input as never), /OWNER_CONTRACT_MEDIA_RECOVERY_REFERENCE_CANDIDATE_INVALID/u);
  assert.equal(recovery.size(), 0);
});

test("unknown image POST outcome never retries and can be reconciled through GET-only recovery", async () => {
  const context = await fixture({ startError: new Error("connection lost") });
  let recoveryId: string | undefined;
  await assert.rejects(() => context.service.generateImageReferenceCandidate(context.lifecycle), (error: unknown) => {
    if (!(error instanceof OwnerContractMediaError) || error.code !== "OUTCOME_UNKNOWN") return false;
    recoveryId = error.recoveryId;
    return true;
  });
  assert.equal(context.calls.image, 1);
  assert.ok(recoveryId);
  const record = context.recoveryStore.get(recoveryId!, ATTEMPT);
  assert.equal(record?.image_reference_candidate?.status, "blocked");
  assert.equal(record?.image_reference_candidate?.dispatch_allowed, false);
  assert.equal(record?.image_reference_candidate?.backend_acceptance, "unproven");
  await assert.rejects(() => context.service.reconcile({ client: context.lifecycle.client, attemptId: ATTEMPT, recoveryId: recoveryId!, contract: CONTRACT }));
  assert.equal(context.calls.image, 1);
});
