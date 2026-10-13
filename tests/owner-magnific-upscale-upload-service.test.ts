import assert from "node:assert/strict";
import test from "node:test";
import {
  OwnerMagnificUpscaleUploadService,
  OwnerMagnificUpscaleUploadServiceError
} from "../src/application/owner-magnific-upscale-upload-service.js";
import {
  OwnerMagnificUpscalePrepareError,
  prepareOwnerMagnificUpscaleRequest
} from "../src/application/owner-magnific-upscale-request-preparer.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { AuthBinding } from "../src/auth/types.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";

const ATTEMPT = "link_magnific_upload_test_1234567890";
const FOREIGN_ATTEMPT = "link_magnific_foreign_test_123456";
const BINDING = Object.freeze({ tenant_id: "tenant_magnific_test", subject: "subject_magnific_test" });
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const FILE_URLS = Object.freeze([
  "https://r2.syntx.ai/magnific/private-asset-1.png",
  "https://r2.syntx.ai/magnific/private-asset-2.png",
  "https://r2.syntx.ai/magnific/private-asset-3.png"
]);
const CATALOG = loadSelectedDiscoveryCatalog().discoveryCatalog;

function linkedAttempt(attemptId: string, status: "LINKED" | "REVOKED" = "LINKED") {
  return {
    attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status,
    expires_at: new Date(1_900_000_000_000).toISOString(),
    linked: status === "LINKED"
  };
}

function createService(options: {
  readonly now?: () => number;
  readonly fetchImpl?: typeof fetch;
  readonly statusForCall?: (call: number, attemptId: string) => "LINKED" | "REVOKED";
  readonly catalog?: typeof CATALOG;
  readonly resolveClient?: (attemptId: string) => unknown;
} = {}) {
  let statusCalls = 0;
  let fetchCalls = 0;
  let credentialCalls = 0;
  const requestFetch: typeof fetch = options.fetchImpl ?? (async (_input, init) => {
    const form = init?.body;
    assert.ok(form instanceof FormData);
    const modelType = String(form.get("model_type"));
    const index = ["creative", "precision_v1", "precision_v2"].indexOf(modelType);
    assert.ok(index >= 0);
    return new Response(JSON.stringify({ files: [{
      id: `private-provider-file-${index + 1}`, url: FILE_URLS[index], mime_type: "image/png", size: 68
    }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  const fetchImpl: typeof fetch = async (input, init) => {
    fetchCalls += 1;
    return requestFetch(input, init);
  };
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation("synthetic-magnific-upload-credential");
    }
  };
  const service = new OwnerMagnificUpscaleUploadService({
    binding: BINDING,
    linkService: {
      async getStatus(_binding: AuthBinding, attemptId: string) {
        statusCalls += 1;
        return linkedAttempt(attemptId, options.statusForCall?.(statusCalls, attemptId) ?? "LINKED");
      }
    } as never,
    catalog: options.catalog ?? CATALOG,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: options.resolveClient ?? (() => new SyntxChatHttpClient({ credentialBroker, fetchImpl })),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  return {
    service,
    get statusCalls() { return statusCalls; },
    get fetchCalls() { return fetchCalls; },
    get credentialCalls() { return credentialCalls; }
  };
}

function request(variant: string, overrides: Record<string, unknown> = {}) {
  return {
    attemptId: ATTEMPT,
    variant,
    content_base64: PNG,
    filename: "magnific-input.png",
    mime_type: "image/png",
    ...overrides
  };
}

test("native upload binds all three variants through the real 421 issuer and full-state preparer", async () => {
  const received: Array<{ model_type: string; filename: string; mime_type: string; bytes: number }> = [];
  const fileUrls = [
    "https://r2.syntx.ai/magnific/private-asset-1.png",
    "https://r2.syntx.ai/magnific/private-asset-2.png",
    "https://r2.syntx.ai/magnific/private-asset-3.png"
  ];
  let fetchCalls = 0;
  const context = createService({ fetchImpl: async (input, init) => {
    fetchCalls += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("destination"), "uploaded");
    assert.equal(init.body.get("check_duplicates"), "true");
    const modelType = String(init.body.get("model_type"));
    const file = init.body.get("files");
    assert.ok(file instanceof File);
    received.push({ model_type: modelType, filename: file.name, mime_type: file.type, bytes: file.size });
    return new Response(JSON.stringify({ files: [{
      id: `private-provider-file-${fetchCalls}`, url: fileUrls[fetchCalls - 1], mime_type: "image/png", size: 68
    }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } });

  const params = {
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
  } as const;
  const cases: readonly {
    readonly variant: string;
    readonly prompt?: string;
    readonly parameters: Record<string, unknown>;
    readonly expected: Record<string, unknown>;
  }[] = [
    {
      variant: "creative",
      prompt: "Keep the fine edge detail.",
      parameters: params,
      expected: {
        n: 1, model_type: "creative", width: 1, height: 1, scale_factor: "2x",
        optimized_for: "films_n_photography", engine: "magnific_sparkle", creativity: 2, hdr: -3,
        resemblance: 4, fractality: 1, sharpen: 37, smart_grain: 28, ultra_detail: 61,
        flavor: "sublime", file_urls: [{ type: "image", url: "https://r2.syntx.ai/magnific/private-asset-1.png" }]
      }
    },
    {
      variant: "precision_v1",
      parameters: params,
      expected: {
        n: 1, model_type: "precision_v1", width: 1, height: 1, scale_factor: "2x",
        optimized_for: "films_n_photography", engine: "magnific_sparkle", creativity: 2, hdr: -3,
        resemblance: 4, fractality: 1, sharpen: 37, smart_grain: 28, ultra_detail: 61,
        flavor: "sublime", file_urls: [{ type: "image", url: "https://r2.syntx.ai/magnific/private-asset-2.png" }]
      }
    },
    {
      variant: "precision_v2",
      parameters: { ...params, flavor: "photo" },
      expected: {
        n: 1, model_type: "precision_v2", width: 1, height: 1, scale_factor: "2x",
        optimized_for: "films_n_photography", engine: "magnific_sparkle", creativity: 2, hdr: -3,
        resemblance: 4, fractality: 1, sharpen: 37, smart_grain: 28, ultra_detail: 61,
        flavor: "photo", file_urls: [{ type: "image", url: "https://r2.syntx.ai/magnific/private-asset-3.png" }]
      }
    }
  ] as const;

  try {
    for (const [index, item] of cases.entries()) {
      const uploaded = await context.service.upload(request(item.variant));
      assert.equal(uploaded.status, "accepted");
      assert.match(uploaded.image_handle, /^magnific_image_[0-9a-f-]{36}$/u);
      assert.equal(uploaded.mime_type, "image/png");
      assert.equal(uploaded.size, 68);
      assert.equal(uploaded.width, 1);
      assert.equal(uploaded.height, 1);
      assert.match(uploaded.sha256, /^sha256:[a-f0-9]{64}$/u);
      assert.equal(uploaded.expires_in_seconds, 900);
      assert.equal(uploaded.metadata_confidence, "CONTAINER_METADATA_ONLY");
      const safeJson = JSON.stringify(uploaded);
      for (const secret of [fileUrls[index]!, `private-provider-file-${index + 1}`, "magnific-input.png", PNG]) {
        assert.equal(safeJson.includes(secret), false);
      }

      const issuer = context.service.createOwnedImageBindingIssuer();
      const imageBinding = await issuer.issue({
        principal: PRINCIPAL,
        attempt_id: ATTEMPT,
        opaque_image_handle: uploaded.image_handle,
        variant: item.variant
      });
      const candidate = prepareOwnerMagnificUpscaleRequest({
        principal: PRINCIPAL,
        attempt_id: ATTEMPT,
        variant: item.variant,
        parameters: item.parameters,
        image_binding: imageBinding,
        ...(item.prompt === undefined ? {} : { prompt: item.prompt })
      }, { now: () => 1000 });
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.equal(candidate.ai_name, "magnific");
      assert.equal(candidate.model_id, item.variant);
      assert.equal(candidate.model_type, item.variant);
      assert.deepEqual(candidate.request.settings, item.expected);
      if (item.prompt === undefined) assert.equal(Object.hasOwn(candidate.request, "prompt"), false);
      else assert.equal(candidate.request.prompt, item.prompt);
      issuer.close();
    }
    assert.deepEqual(received, [
      { model_type: "creative", filename: "magnific-input.png", mime_type: "image/png", bytes: 68 },
      { model_type: "precision_v1", filename: "magnific-input.png", mime_type: "image/png", bytes: 68 },
      { model_type: "precision_v2", filename: "magnific-input.png", mime_type: "image/png", bytes: 68 }
    ]);
    assert.equal(fetchCalls, 3);
    assert.equal(context.credentialCalls, 3);
  } finally {
    await context.service.close();
  }
});

test("invalid Magnific input is rejected before credentialed native upload", async () => {
  const context = createService();
  try {
    await assert.rejects(() => context.service.upload(request("creative", { mime_type: "image/gif" })),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "UNSUPPORTED_SOURCE_FORMAT");
    await assert.rejects(() => context.service.upload(request("creative", { content_base64: "%%%=" })),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "INVALID_IMAGE_INPUT");
    await assert.rejects(() => context.service.upload(request("creative", { filename: "question?mark.png" })),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "INVALID_REQUEST");
    assert.equal(context.fetchCalls, 0);
    assert.equal(context.credentialCalls, 0);
  } finally {
    await context.service.close();
  }
});

test("a lost native upload ACK is never retried or turned into an owned handle", async () => {
  let fetchCalls = 0;
  const context = createService({ fetchImpl: async () => {
    fetchCalls += 1;
    throw new SyntxHttpError("UPSTREAM_TIMEOUT", "private upload URL and response body");
  } });
  try {
    let failure: unknown;
    await assert.rejects(() => context.service.upload(request("creative")), (error: unknown) => {
      failure = error;
      return error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN";
    });
    assert.equal(fetchCalls, 1);
    assert.equal(String(failure).includes("private upload URL"), false);
    assert.equal(String(failure).includes("private-provider-file"), false);
  } finally {
    await context.service.close();
  }
});

test("an explicit native rejection is returned without retry or private handle", async () => {
  let fetchCalls = 0;
  const context = createService({ fetchImpl: async () => {
    fetchCalls += 1;
    return new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
  } });
  try {
    await assert.rejects(() => context.service.upload(request("creative")),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "UPLOAD_REJECTED");
    assert.equal(fetchCalls, 1);
  } finally {
    await context.service.close();
  }
});

test("a non-native structural upload client cannot mint a Magnific handle", async () => {
  let invoked = 0;
  const context = createService({ resolveClient: () => ({
    async uploadMagnificUpscaleImageReference() {
      invoked += 1;
      return { url: FILE_URLS[0] };
    }
  }) });
  try {
    await assert.rejects(() => context.service.upload(request("creative")),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "INVALID_REQUEST");
    assert.equal(invoked, 0);
    assert.equal(context.fetchCalls, 0);
  } finally {
    await context.service.close();
  }
});

test("a replaced native prototype method is rejected instead of trusted as the upload port", async () => {
  const original = Object.getOwnPropertyDescriptor(SyntxChatHttpClient.prototype, "uploadMagnificUpscaleImageReference");
  assert.ok(original && "value" in original && typeof original.value === "function");
  let tamperedCalls = 0;
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-magnific-upload-credential");
    } },
    fetchImpl: async () => {
      fetchCalls += 1;
      throw new Error("must not fetch");
    }
  });
  Object.defineProperty(SyntxChatHttpClient.prototype, "uploadMagnificUpscaleImageReference", {
    ...original,
    value: async () => {
      tamperedCalls += 1;
      return { url: FILE_URLS[0] };
    }
  });
  const context = createService({ resolveClient: () => client });
  try {
    await assert.rejects(() => context.service.upload(request("creative")),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "INVALID_REQUEST");
    assert.equal(tamperedCalls, 0);
    assert.equal(fetchCalls, 0);
  } finally {
    Object.defineProperty(SyntxChatHttpClient.prototype, "uploadMagnificUpscaleImageReference", original);
    await context.service.close();
  }
});

test("an already-aborted request never reaches the credentialed upload", async () => {
  const context = createService();
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(() => context.service.upload(request("creative", { signal: controller.signal })),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "REQUEST_ABORTED");
    assert.equal(context.fetchCalls, 0);
    assert.equal(context.credentialCalls, 0);
  } finally {
    await context.service.close();
  }
});

test("the fifth concurrent upload is rejected and close aborts and drains the four pending uploads", async () => {
  let resolveFourStarted!: () => void;
  const fourStarted = new Promise<void>((resolve) => { resolveFourStarted = resolve; });
  const signals: AbortSignal[] = [];
  const context = createService({ fetchImpl: async (_input, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    signals.push(signal);
    if (signals.length === 4) resolveFourStarted();
    return await new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    });
  } });
  const pending = Array.from({ length: 4 }, () => context.service.upload(request("creative")));
  try {
    await fourStarted;
    await assert.rejects(() => context.service.upload(request("creative")),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "SERVICE_BUSY");
    assert.equal(context.fetchCalls, 4);
    await context.service.close();
    const settled = await Promise.allSettled(pending);
    assert.equal(settled.every((item) => item.status === "rejected"), true);
    assert.equal(signals.every((signal) => signal.aborted), true);
  } finally {
    await context.service.close();
  }
});

test("a late upload response after attempt invalidation cannot mint a handle", async () => {
  let resolveStarted!: () => void;
  const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });
  const context = createService({ fetchImpl: async (_input, init) => {
    assert.ok(init?.signal);
    resolveStarted();
    await responseGate;
    return new Response(JSON.stringify({ files: [{
      id: "private-provider-file", url: FILE_URLS[0], mime_type: "image/png", size: 68
    }] }), { status: 200, headers: { "content-type": "application/json" } });
  } });
  const pending = context.service.upload(request("creative"));
  try {
    await started;
    context.service.invalidateAttempt(ATTEMPT);
    releaseResponse();
    await assert.rejects(() => pending,
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  } finally {
    releaseResponse();
    await context.service.close();
  }
});

test("attempt invalidation revokes issued bindings and removes the private handle", async () => {
  const context = createService();
  try {
    const uploaded = await context.service.upload(request("precision_v1"));
    const issuer = context.service.createOwnedImageBindingIssuer();
    const binding = await issuer.issue({
      principal: PRINCIPAL, attempt_id: ATTEMPT, opaque_image_handle: uploaded.image_handle, variant: "precision_v1"
    });
    context.service.invalidateAttempt(ATTEMPT);
    assert.throws(() => prepareOwnerMagnificUpscaleRequest({
      principal: PRINCIPAL,
      attempt_id: ATTEMPT,
      variant: "precision_v1",
      parameters: {
        scale_factor: "2x", optimized_for: "standard", engine: "automatic", creativity: 3, hdr: 3,
        resemblance: 3, fractality: 3, sharpen: 30, smart_grain: 30, ultra_detail: 30, flavor: "sublime"
      },
      image_binding: binding
    }, { now: () => 1000 }), (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === "IMAGE_BINDING_INVALID");
    issuer.close();
  } finally {
    await context.service.close();
  }
});

test("opaque handles cannot be rebound across variants or linked attempts", async () => {
  const context = createService();
  try {
    const uploaded = await context.service.upload(request("creative"));
    const issuer = context.service.createOwnedImageBindingIssuer();
    await assert.rejects(() => issuer.issue({
      principal: PRINCIPAL, attempt_id: ATTEMPT, opaque_image_handle: uploaded.image_handle, variant: "precision_v2"
    }), (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === "IMAGE_BINDING_INVALID");
    const foreignPrincipal = Object.freeze({
      tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: FOREIGN_ATTEMPT
    });
    await assert.rejects(() => issuer.issue({
      principal: foreignPrincipal,
      attempt_id: FOREIGN_ATTEMPT,
      opaque_image_handle: uploaded.image_handle,
      variant: "creative"
    }), (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === "IMAGE_BINDING_INVALID");
    issuer.close();
  } finally {
    await context.service.close();
  }
});

test("a prepared candidate expires at the same original upload-handle deadline", async () => {
  let now = 1000;
  const context = createService({ now: () => now });
  try {
    const uploaded = await context.service.upload(request("precision_v1"));
    const issuer = context.service.createOwnedImageBindingIssuer();
    const imageBinding = await issuer.issue({
      principal: PRINCIPAL,
      attempt_id: ATTEMPT,
      opaque_image_handle: uploaded.image_handle,
      variant: "precision_v1"
    });
    now += 15 * 60_000 + 1;
    assert.throws(() => prepareOwnerMagnificUpscaleRequest({
      principal: PRINCIPAL,
      attempt_id: ATTEMPT,
      variant: "precision_v1",
      parameters: {
        scale_factor: "2x", optimized_for: "standard", engine: "automatic", creativity: 3, hdr: 3,
        resemblance: 3, fractality: 3, sharpen: 30, smart_grain: 30, ultra_detail: 30, flavor: "sublime"
      },
      image_binding: imageBinding
    }, { now: () => now }),
    (error: unknown) => error instanceof OwnerMagnificUpscalePrepareError && error.code === "IMAGE_BINDING_EXPIRED");
    issuer.close();
  } finally {
    await context.service.close();
  }
});

test("private handle storage is capped at 128 and prunes expired entries", async () => {
  let now = 1000;
  const context = createService({ now: () => now });
  try {
    for (let index = 0; index < 128; index += 1) {
      await context.service.upload(request("creative", { filename: `image-${index}.png` }));
    }
    assert.equal(context.fetchCalls, 128);
    await assert.rejects(() => context.service.upload(request("creative")),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "CAPACITY_EXCEEDED");
    assert.equal(context.fetchCalls, 128);
    now += 15 * 60_000 + 1;
    const afterExpiry = await context.service.upload(request("creative"));
    assert.match(afterExpiry.image_handle, /^magnific_image_[0-9a-f-]{36}$/u);
    assert.equal(context.fetchCalls, 129);
  } finally {
    await context.service.close();
  }
});

test("revocation after the one native upload yields unknown and never mints a handle", async () => {
  const context = createService({ statusForCall: (call) => call === 1 ? "LINKED" : "REVOKED" });
  try {
    await assert.rejects(() => context.service.upload(request("creative")),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(context.fetchCalls, 1);
    assert.equal(context.statusCalls, 2);
  } finally {
    await context.service.close();
  }
});

test("catalog eligibility is rechecked after the native upload before issuing a handle", async () => {
  let stillActive = true;
  const catalog = {
    getModel(modelId: string) {
      const model = CATALOG.getModel(modelId);
      return stillActive ? model : { ...model, active: false };
    }
  } as typeof CATALOG;
  const context = createService({ catalog, fetchImpl: async (_input, init) => {
    const form = init?.body;
    assert.ok(form instanceof FormData);
    stillActive = false;
    return new Response(JSON.stringify({ files: [{
      id: "private-provider-file", url: FILE_URLS[0], mime_type: "image/png", size: 68
    }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  } });
  try {
    await assert.rejects(() => context.service.upload(request("creative")),
      (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(context.fetchCalls, 1);
  } finally {
    await context.service.close();
  }
});

test("catalog must still identify an active Magnific image-upscale model", async () => {
  const badCatalog = {
    getModel(modelId: string) {
      const model = CATALOG.getModel(modelId);
      return { ...model, active: false };
    }
  } as typeof CATALOG;
  const service = new OwnerMagnificUpscaleUploadService({
    binding: BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: badCatalog,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("not-used"); } },
      fetchImpl: async () => { throw new Error("must not fetch"); }
    })
  });
  await assert.rejects(() => service.upload(request("creative")),
    (error: unknown) => error instanceof OwnerMagnificUpscaleUploadServiceError && error.code === "MODEL_BINDING_MISMATCH");
  await service.close();
});
