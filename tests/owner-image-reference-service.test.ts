import assert from "node:assert/strict";
import test from "node:test";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedPublicCatalog } from "../src/catalog/public-catalog-history.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { OwnerContractMediaError, type OwnerContractMediaReadClient, type OwnerImageReferenceDispatchClient } from "../src/application/owner-contract-media.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { OwnerImageReferenceService, OwnerImageReferenceServiceError } from "../src/application/owner-image-reference-service.js";
import { OwnerMediaReferenceStore, OwnerMediaReferenceStoreError } from "../src/application/owner-media-reference-store.js";
import type { AuthBinding, PublicAuthLinkAttempt } from "../src/auth/types.js";

const ROOT = process.cwd();
const ATTEMPT = "link_owner_reference_service_test_01";
const OTHER_ATTEMPT = "link_other_owner_reference_test_01";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "tenant_local_owner", subject: "subject_local_owner" });
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";

function linkedService() {
  return {
    async getStatus(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
      const linked = attemptId === ATTEMPT && binding.tenant_id === BINDING.tenant_id && binding.subject === BINDING.subject;
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: linked ? "LINKED" : "REVOKED", expires_at: null, linked };
    }
  };
}

function createHarness(options: {
  readonly uncertain?: boolean;
  readonly registry?: ReturnType<typeof loadGenerationContractRegistryV2>;
  readonly catalog?: DiscoveryCatalogRepository;
  readonly binding?: AuthBinding;
} = {}) {
  const registry = options.registry ?? loadGenerationContractRegistryV2(REGISTRY_VERSION, `${ROOT}/catalog`);
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: `${ROOT}/catalog` }).snapshot;
  const catalog = options.catalog ?? new DiscoveryCatalogRepository(snapshot);
  const binding = options.binding ?? BINDING;
  const store = new OwnerMediaReferenceStore({ now: () => Date.now() });
  const calls = { upload: 0, create: 0, post: 0, get: 0, list: 0, subscription: 0, access: 0, cost: 0 };
  let lastDispatch: { request: unknown; references: unknown } | undefined;
  const client = (): OwnerImageReferenceDispatchClient & Pick<SyntxChatHttpClient, "uploadFileReferences"> => ({
    async uploadFileReferences(input: Parameters<SyntxChatHttpClient["uploadFileReferences"]>[0]) {
      calls.upload += 1;
      assert.equal(input.destination, "hidden");
      assert.equal(input.check_duplicates, true);
      assert.equal(input.model_type, "banana-2.1");
      assert.deepEqual([...input.bytes], [...Buffer.from(PNG, "base64")]);
      return [{ url: "https://r2.syntx.ai/owned/opaque-reference.png" }];
    },
    async createChat() { calls.create += 1; return { chat_uuid: "reference-service-chat" }; },
    async startImageWithInternalReferences(request, references) {
      calls.post += 1;
      lastDispatch = { request: structuredClone(request), references: structuredClone(references) };
      if (options.uncertain) throw new Error("network timeout after invocation");
      return { chat_uuid: request.chat_uuid, message_id: "reference-service-result" };
    },
    async listInProgress() { calls.list += 1; return [{ message_id: "reference-service-result", message_object_id: null, object_type: "image", model_type: "banana-2.1" }]; },
    async getMessage(chatUuid, messageId) {
      calls.get += 1;
      return { chat_uuid: chatUuid, message_id: messageId, object_type: "image", model_type: "banana-2.1", artifacts: [{ url: "https://r2.syntx.ai/generated/opaque-result.jpg", mime_type: "image/jpeg", byte_size: 756187, width: 1024, height: 1024 }] };
    }
  });
  const readClient: OwnerContractMediaReadClient = {
    async listInProgress(_chatUuid) { calls.list += 1; return [{ message_id: "reference-service-result", message_object_id: null, object_type: "image", model_type: "banana-2.1" }]; },
    async getMessage(chatUuid, messageId) {
      calls.get += 1;
      return { chat_uuid: chatUuid, message_id: messageId, object_type: "image", model_type: "banana-2.1", artifacts: [{ url: "https://r2.syntx.ai/generated/opaque-result.jpg", mime_type: "image/jpeg", byte_size: 756187, width: 1024, height: 1024 }] };
    }
  };
  const service = new OwnerImageReferenceService({
    binding,
    registry,
    catalog,
    linkService: linkedService(),
    referenceStore: store,
    createChatClient: client,
    createReadClient: () => readClient,
    preflightFactory: (attemptId, principal, candidate) => ({
      async verifyFreshSubscription(actualAttempt) { assert.equal(actualAttempt, attemptId); assert.equal(principal.connection_id, attemptId); assert.equal(candidate.model_id, "banana-2.1"); calls.subscription += 1; },
      async verifyModelAccess(actualAttempt, actualPrincipal, modelId) { assert.equal(actualAttempt, attemptId); assert.equal(actualPrincipal.subject_id, BINDING.subject); assert.equal(modelId, "banana-2.1"); calls.access += 1; },
      async authorizeCost(actualAttempt, actualPrincipal, actualCandidate) { assert.equal(actualAttempt, attemptId); assert.equal(actualPrincipal.tenant_id, BINDING.tenant_id); assert.equal(actualCandidate, candidate); calls.cost += 1; }
    }),
    now: () => Date.now()
  });
  return { service, store, calls, registry, catalog, binding, lastDispatch: () => lastDispatch };
}

test("uploads one sniffed PNG, dispatches the exact one-reference tuple once, and consumes its handle", async () => {
  const harness = createHarness();
  try {
    const upload = await harness.service.upload({ link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png" });
    assert.equal(upload.image.width, 1);
    assert.equal(upload.image.height, 1);
    const result = await harness.service.generate({ link_attempt_id: ATTEMPT, reference_handle: upload.reference_handle, prompt: "A red house" });
    assert.equal(result.variant_id, "banana21-image-1k-minimal-square");
    assert.equal(result.confidence.profile.image_size, "1K");
    assert.equal(result.confidence.profile.thinking_level, "minimal");
    assert.equal(result.confidence.profile.aspect_ratio, "1:1");
    assert.equal(result.confidence.profile.n, 1);
    assert.equal(result.confidence.backend_acceptance, "one_observed_png_reference_on_exact_tuple");
    assert.deepEqual(harness.lastDispatch()?.request, {
      ai_name: "banana", prompt: "A red house", settings: { aspect_ratio: "1:1", file_urls: [], image_size: "1K", model_type: "banana-2.1", n: 1, thinking_level: "minimal" }, chat_uuid: "reference-service-chat"
    });
    assert.deepEqual(harness.lastDispatch()?.references, [{ url: "https://r2.syntx.ai/owned/opaque-reference.png" }]);
    assert.deepEqual(harness.calls, { upload: 1, create: 1, post: 1, get: 1, list: 0, subscription: 1, access: 1, cost: 1 });
    await assert.rejects(() => harness.service.generate({ link_attempt_id: ATTEMPT, reference_handle: upload.reference_handle, prompt: "second" }));
    assert.equal(harness.calls.post, 1);
    assert.equal(JSON.stringify(result).includes("owned/opaque-reference.png"), false);
  } finally { await harness.service.close(); }
});

test("unknown dispatch is GET-only recoverable, and foreign attempts cannot use the handle or enumerate recoveries", async () => {
  const harness = createHarness({ uncertain: true });
  try {
    const upload = await harness.service.upload({ link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png" });
    let recoveryId = "";
    await assert.rejects(() => harness.service.generate({ link_attempt_id: ATTEMPT, reference_handle: upload.reference_handle, prompt: "A red house" }),
      (error: unknown) => {
        if (error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN") { recoveryId = error.recoveryId ?? ""; return Boolean(recoveryId); }
        return false;
      });
    assert.equal(harness.calls.post, 1);
    assert.equal(harness.calls.create, 1);
    const beforeGet = harness.calls.get;
    const recovered = await harness.service.reconcile({ link_attempt_id: ATTEMPT, recovery_id: recoveryId });
    assert.equal(recovered.status, "result_observed");
    assert.equal(harness.calls.post, 1);
    assert.equal(harness.calls.get, beforeGet + 1);
    await assert.rejects(() => harness.service.generate({ link_attempt_id: OTHER_ATTEMPT, reference_handle: upload.reference_handle, prompt: "foreign" }));
    await assert.rejects(() => harness.service.listRecoveries({ link_attempt_id: OTHER_ATTEMPT, limit: 20 }));
    assert.equal(harness.calls.post, 1);
  } finally { await harness.service.close(); }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function createDeferredUploadHarness(fetchImpl: typeof fetch) {
  const registry = loadGenerationContractRegistryV2(REGISTRY_VERSION, `${ROOT}/catalog`);
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: `${ROOT}/catalog` }).snapshot;
  const catalog = new DiscoveryCatalogRepository(snapshot);
  let linked = true;
  const linkService = {
    async getStatus(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
      const owner = binding.tenant_id === BINDING.tenant_id && binding.subject === BINDING.subject;
      const isLinked = linked && owner && attemptId === ATTEMPT;
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: isLinked ? "LINKED" : "REVOKED", expires_at: null, linked: isLinked };
    }
  };
  const chatClient = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("fake-test-credential"); } },
    fetchImpl
  });
  const service = new OwnerImageReferenceService({
    binding: BINDING,
    registry,
    catalog,
    linkService,
    createChatClient: () => chatClient,
    createReadClient: () => ({ async listInProgress() { return []; }, async getMessage() { throw new Error("unused"); } }),
    preflightFactory: () => ({ async verifyFreshSubscription() {}, async verifyModelAccess() {}, async authorizeCost() {} })
  });
  return { service, revoke() { linked = false; } };
}

test("aborting or revoking during the real upload adapter request preserves UNKNOWN and never retries", async () => {
  for (const mode of ["abort", "revoke"] as const) {
    const fetchStarted = deferred<void>();
    const fetchImpl: typeof fetch = async (_input, init) => {
      const requestSignal = init?.signal;
      fetchStarted.resolve();
      return new Promise<Response>((_resolve, reject) => {
        if (requestSignal?.aborted) reject(new DOMException("aborted", "AbortError"));
        else requestSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    };
    const harness = createDeferredUploadHarness(fetchImpl);
    const controller = new AbortController();
    const upload = harness.service.upload({ link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png" },
      mode === "abort" ? controller.signal : undefined);
    await fetchStarted.promise;
    if (mode === "abort") controller.abort();
    else { harness.revoke(); await harness.service.invalidateAttempt(ATTEMPT); }
    await assert.rejects(upload, (error: unknown) => error instanceof OwnerMediaReferenceStoreError && error.code === "REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
    await harness.service.close();
  }
});

test("revocation clears every exact-attempt recovery beyond the public list page", async () => {
  const harness = createHarness({ uncertain: true });
  try {
    for (let index = 0; index < 21; index += 1) {
      const upload = await harness.service.upload({ link_attempt_id: ATTEMPT, content_base64: PNG, filename: `reference-${index}.png`, mime_type: "image/png" });
      await assert.rejects(() => harness.service.generate({ link_attempt_id: ATTEMPT, reference_handle: upload.reference_handle, prompt: `image ${index}` }),
        (error: unknown) => error instanceof OwnerContractMediaError && error.code === "OUTCOME_UNKNOWN" && !!error.recoveryId);
    }
    const before = await harness.service.listRecoveries({ link_attempt_id: ATTEMPT, limit: 20 });
    assert.equal(before.recoveries.length, 20);
    await harness.service.invalidateAttempt(ATTEMPT);
    const after = await harness.service.listRecoveries({ link_attempt_id: ATTEMPT, limit: 20 });
    assert.equal(after.recoveries.length, 0);
    assert.equal(harness.calls.post, 21);
  } finally { await harness.service.close(); }
});

test("caps pending uploads before decoding another base64 image", async () => {
  const eightStarted = deferred<void>();
  let uploadRequests = 0;
  const fetchImpl: typeof fetch = async (_input, init) => {
    uploadRequests += 1;
    if (uploadRequests === 8) eightStarted.resolve();
    const requestSignal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (requestSignal?.aborted) reject(new DOMException("aborted", "AbortError"));
      else requestSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  };
  const harness = createDeferredUploadHarness(fetchImpl);
  const pending = Array.from({ length: 8 }, () => harness.service.upload({
    link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png"
  }));
  await eightStarted.promise;
  await assert.rejects(() => harness.service.upload({
    link_attempt_id: ATTEMPT, content_base64: "A".repeat(9_786_712), filename: "oversized.png", mime_type: "image/png"
  }), (error: unknown) => error instanceof OwnerImageReferenceServiceError && error.code === "SERVICE_BUSY");
  assert.equal(uploadRequests, 8);
  await harness.service.close();
  await Promise.allSettled(pending);
});

test("snapshots trusted source bindings and rejects accessor/proxy options before constructing the service", async () => {
  const registry = structuredClone(loadGenerationContractRegistryV2(REGISTRY_VERSION, `${ROOT}/catalog`));
  const catalog = new DiscoveryCatalogRepository(loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: `${ROOT}/catalog` }).snapshot);
  const binding = { tenant_id: BINDING.tenant_id, subject: BINDING.subject };
  const harness = createHarness({ registry, catalog, binding });
  try {
    binding.subject = "mutated-after-construction";
    (registry.contracts[0] as { status: string }).status = "reviewed";
    (catalog as unknown as { fetched_at: string }).fetched_at = "tampered-after-construction";
    const upload = await harness.service.upload({ link_attempt_id: ATTEMPT, content_base64: PNG, filename: "reference.png", mime_type: "image/png" });
    assert.equal(upload.status, "accepted");

    const options = {
      binding: BINDING,
      registry: loadGenerationContractRegistryV2(REGISTRY_VERSION, `${ROOT}/catalog`),
      catalog: new DiscoveryCatalogRepository(loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: `${ROOT}/catalog` }).snapshot),
      linkService: linkedService(),
      createChatClient: () => { throw new Error("unused"); },
      createReadClient: () => ({ async listInProgress() { return []; }, async getMessage() { throw new Error("unused"); } }),
      preflightFactory: () => ({ async verifyFreshSubscription() {}, async verifyModelAccess() {}, async authorizeCost() {} })
    };
    const withGetter = { ...options };
    let getterReads = 0;
    Object.defineProperty(withGetter, "registry", { enumerable: true, get: () => { getterReads += 1; return options.registry; } });
    const invalidOptions = (error: unknown) => error instanceof Error && error.message === "The owner image input is invalid.";
    assert.throws(() => new OwnerImageReferenceService(withGetter), invalidOptions);
    assert.equal(getterReads, 0);
    assert.throws(() => new OwnerImageReferenceService(new Proxy(options, {})), invalidOptions);
  } finally { await harness.service.close(); }
});
