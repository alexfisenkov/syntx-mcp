import assert from "node:assert/strict";
import test from "node:test";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedPublicCatalog } from "../src/catalog/public-catalog-history.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import {
  isOwnerImageReferencePreparedCandidateForPrincipal,
  getOwnerImageReferenceCandidateStoreBinding,
  OwnerImageReferencePrepareError,
  prepareOwnerImageReferenceRequest
} from "../src/application/owner-image-reference-request-preparer.js";
import { OwnerMediaReferenceStore } from "../src/application/owner-media-reference-store.js";
import type { OwnerMediaReferenceContractBinding } from "../src/application/owner-media-reference-store.js";
import type { AuthBinding, PublicAuthLinkAttempt } from "../src/auth/types.js";

const ROOT = process.cwd();
const REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const ATTEMPT = "link_abcdefghijklmnopqrstuvwxyz123456";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "tenant_local_owner", subject: "subject_local_owner" });

function currentContext() {
  const registry = loadGenerationContractRegistryV2(REGISTRY_VERSION, `${ROOT}/catalog`);
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: `${ROOT}/catalog` }).snapshot;
  return { registry, catalog: new DiscoveryCatalogRepository(snapshot) };
}

function linkedService() {
  return {
    async getStatus(): Promise<PublicAuthLinkAttempt> {
      return {
        attempt_id: ATTEMPT,
        authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: "LINKED" as const,
        expires_at: null,
        linked: true
      };
    }
  };
}

async function issueReference(options: {
  readonly now?: () => number;
  readonly binding?: AuthBinding;
  readonly contract?: OwnerMediaReferenceContractBinding;
  readonly handle?: string;
} = {}) {
  const { registry, catalog } = currentContext();
  const binding = options.binding ?? BINDING;
  const attemptId = ATTEMPT;
  const linkService = linkedService();
  let uploadCalls = 0;
  const store = new OwnerMediaReferenceStore({
    ...(options.now ? { now: options.now } : {}),
    createHandle: () => options.handle ?? "reference_823e4567-e89b-12d3-a456-426614174000"
  });
  const candidateBinding = getOwnerImageReferenceCandidateStoreBinding(registry, catalog);
  const receipt = await store.uploadAndIssue({
    binding,
    attemptId,
    linkService,
    client: { async uploadFileReferences() {
      uploadCalls += 1;
      return [{ url: "https://r2.syntx.ai/owned/reference.png" }];
    } },
    contract: options.contract ?? candidateBinding,
    filename: "reference.png",
    mime_type: "image/png",
    bytes: Uint8Array.from([1, 2, 3])
  });
  return { registry, catalog, binding, attemptId, linkService, store, receipt, uploadCalls: () => uploadCalls };
}

function prepareArgs(context: Awaited<ReturnType<typeof issueReference>>, overrides: Record<string, unknown> = {}) {
  return {
    registry: context.registry,
    catalog: context.catalog,
    store: context.store,
    binding: context.binding,
    attemptId: context.attemptId,
    linkService: context.linkService,
    reference_handle: context.receipt.reference_handle,
    parameters: { prompt: "Use the supplied photo as a visual reference." },
    ...overrides
  };
}

test("prepares one owned Banana 2.1 image reference as an immutable, blocked source-shaped candidate", async () => {
  const context = await issueReference();
  const uploadsBeforePrepare = context.uploadCalls();
  const candidate = await prepareOwnerImageReferenceRequest(prepareArgs(context));

  assert.equal(candidate.dispatch_allowed, false);
  assert.equal(candidate.status, "blocked");
  assert.equal(candidate.confidence, "PREPARED_REFERENCE_CANDIDATE");
  assert.equal(candidate.backend_acceptance, "unproven");
  assert.equal(candidate.model_id, "banana-2.1");
  assert.equal(candidate.operation_id, "generate-image");
  assert.equal(candidate.base_variant_id, "banana21-image-1k-minimal-square");
  assert.equal(candidate.base_schema_hash, "sha256:7f413ab9269b958508ccfaeb07bd05cab03f90e6f0ff809d447139aac0296e5d");
  assert.deepEqual(candidate.request.settings, {
    aspect_ratio: "1:1",
    image_size: "1K",
    n: 1,
    thinking_level: "minimal",
    model_type: "banana-2.1",
    file_urls: [{ type: "image", url: "https://r2.syntx.ai/owned/reference.png" }]
  });
  assert.equal(candidate.request.prompt, "Use the supplied photo as a visual reference.");
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.request), true);
  assert.equal(Object.isFrozen(candidate.request.settings), true);
  assert.equal(Object.isFrozen(candidate.request.settings.file_urls), true);
  assert.equal(Object.isFrozen(candidate.request.settings.file_urls[0]), true);
  assert.equal(candidate.candidate_variant_id, "banana21-image-1k-minimal-square-reference-candidate");
  assert.match(candidate.candidate_schema_hash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(context.uploadCalls(), uploadsBeforePrepare);
});

test("fails closed for foreign, expired, revoked, wrong-modality and unbound owner handles", async () => {
  const foreign = await issueReference({ binding: { tenant_id: "tenant_other", subject: "subject_other" } });
  await assert.rejects(() => prepareOwnerImageReferenceRequest(prepareArgs({ ...foreign, binding: BINDING })),
    (error: unknown) => error instanceof OwnerImageReferencePrepareError && error.code === "REFERENCE_UNAVAILABLE");

  let now = 1000;
  const expired = await issueReference({ now: () => now });
  now += 15 * 60_000 + 1;
  await assert.rejects(() => prepareOwnerImageReferenceRequest(prepareArgs(expired)),
    (error: unknown) => error instanceof OwnerImageReferencePrepareError && error.code === "REFERENCE_UNAVAILABLE");

  const revoked = await issueReference();
  revoked.store.invalidateByPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
  await assert.rejects(() => prepareOwnerImageReferenceRequest(prepareArgs(revoked)),
    (error: unknown) => error instanceof OwnerImageReferencePrepareError && error.code === "REFERENCE_UNAVAILABLE");

  const wrongModality = await issueReference({
    contract: {
      ...getOwnerImageReferenceCandidateStoreBinding(currentContext().registry, currentContext().catalog),
      operation_id: "generate-video",
      modality: "video"
    }
  });
  await assert.rejects(() => prepareOwnerImageReferenceRequest(prepareArgs(wrongModality)),
    (error: unknown) => error instanceof OwnerImageReferencePrepareError && error.code === "REFERENCE_UNAVAILABLE");

  const unbound = await issueReference();
  const altered = { ...unbound.registry, registry_sha256: `sha256:${"0".repeat(64)}` };
  await assert.rejects(() => prepareOwnerImageReferenceRequest(prepareArgs(unbound, { registry: altered })),
    (error: unknown) => error instanceof OwnerImageReferencePrepareError && error.code === "SOURCE_BINDING_MISMATCH");
});

test("rejects raw URLs, paths, upstream IDs, extra references, caller file_urls and proxied inputs", async () => {
  const context = await issueReference();
  for (const value of [
    "https://r2.syntx.ai/owned/reference.png",
    "/tmp/reference.png",
    "upstream_file_123"
  ]) {
    await assert.rejects(() => prepareOwnerImageReferenceRequest(prepareArgs(context, { reference_handle: value })),
      (error: unknown) => error instanceof OwnerImageReferencePrepareError && error.code === "INVALID_REQUEST");
  }
  for (const parameters of [
    { prompt: "Reference", file_urls: [] },
    { prompt: "Reference", reference_handles: [context.receipt.reference_handle] },
    { prompt: "Reference", extra: true }
  ]) {
    await assert.rejects(() => prepareOwnerImageReferenceRequest(prepareArgs(context, { parameters })),
      (error: unknown) => error instanceof OwnerImageReferencePrepareError && error.code === "INVALID_REQUEST");
  }
  await assert.rejects(() => prepareOwnerImageReferenceRequest(prepareArgs(context, {
    parameters: new Proxy({ prompt: "Reference" }, {})
  })), (error: unknown) => error instanceof OwnerImageReferencePrepareError && error.code === "INVALID_REQUEST");
});

test("binds a genuine prepared candidate to its exact owner principal and attempt", async () => {
  const context = await issueReference();
  const candidate = await prepareOwnerImageReferenceRequest(prepareArgs(context));
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  assert.equal(isOwnerImageReferencePreparedCandidateForPrincipal(candidate, principal, ATTEMPT), true);
  assert.equal(isOwnerImageReferencePreparedCandidateForPrincipal(candidate, {
    ...principal,
    tenant_id: "tenant_foreign"
  }, ATTEMPT), false);
  assert.equal(isOwnerImageReferencePreparedCandidateForPrincipal(candidate, principal, "link_other_attempt_123456"), false);
  assert.equal(isOwnerImageReferencePreparedCandidateForPrincipal(Object.freeze({ ...candidate }), principal, ATTEMPT), false);
});
