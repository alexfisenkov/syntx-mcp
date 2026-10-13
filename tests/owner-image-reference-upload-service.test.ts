import assert from "node:assert/strict";
import test from "node:test";
import { loadGenerationContractRegistryV2 } from "../src/catalog/generation-contract-history-v2.js";
import { loadSelectedPublicCatalog } from "../src/catalog/public-catalog-history.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { OwnerMediaReferenceStore, OwnerMediaReferenceStoreError } from "../src/application/owner-media-reference-store.js";
import { prepareOwnerImageReferenceRequest } from "../src/application/owner-image-reference-request-preparer.js";
import {
  OwnerImageReferenceUploadError,
  uploadOwnerImageReference
} from "../src/application/owner-image-reference-upload-service.js";
import type { AuthBinding, PublicAuthLinkAttempt } from "../src/auth/types.js";
import type { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";

const ROOT = process.cwd();
const REGISTRY_VERSION = "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const ATTEMPT = "link_abcdefghijklmnopqrstuvwxyz123456";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "tenant_local_owner", subject: "subject_local_owner" });
const MAX_BANANA_IMAGE_BYTES = 7 * 1024 * 1024;

function currentContext() {
  const registry = loadGenerationContractRegistryV2(REGISTRY_VERSION, `${ROOT}/catalog`);
  const snapshot = loadSelectedPublicCatalog({ version: PUBLIC_VERSION, catalogDirectory: `${ROOT}/catalog` }).snapshot;
  return { registry, catalog: new DiscoveryCatalogRepository(snapshot) };
}

function linkedService(expectedAttemptId = ATTEMPT, expectedBinding: AuthBinding = BINDING) {
  return {
    async getStatus(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
      return {
        attempt_id: attemptId,
        authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: attemptId === expectedAttemptId && binding.tenant_id === expectedBinding.tenant_id &&
          binding.subject === expectedBinding.subject ? "LINKED" : "REVOKED",
        expires_at: null,
        linked: attemptId === expectedAttemptId && binding.tenant_id === expectedBinding.tenant_id &&
          binding.subject === expectedBinding.subject
      };
    }
  };
}

function mockClient(uploadCalls: { value: number }): Pick<SyntxChatHttpClient, "uploadFileReferences"> {
  return {
    async uploadFileReferences(input) {
      uploadCalls.value += 1;
      assert.equal(input.destination, "hidden");
      assert.equal(input.check_duplicates, true);
      assert.equal(input.model_type, "banana-2.1");
      return [{ url: "https://r2.syntx.ai/owned/reference.png" }];
    }
  };
}

function uploadInput(overrides: Record<string, unknown> = {}) {
  const { registry, catalog } = currentContext();
  const clientCalls = { value: 0 };
  const input = {
    registry,
    catalog,
    store: new OwnerMediaReferenceStore({ createHandle: () => "reference_823e4567-e89b-12d3-a456-426614174000" }),
    binding: BINDING,
    attemptId: ATTEMPT,
    linkService: linkedService(),
    client: mockClient(clientCalls),
    filename: "reference.png",
    mime_type: "image/png",
    bytes: Uint8Array.from([1]),
    ...overrides
  };
  return { input, clientCalls };
}

test("issues a max-edge Banana candidate-bound receipt once and that handle prepares blocked 91", async () => {
  const { input, clientCalls } = uploadInput({ bytes: new Uint8Array(MAX_BANANA_IMAGE_BYTES) });
  let storeCalls = 0;
  const originalUpload = input.store.uploadAndIssue.bind(input.store);
  input.store.uploadAndIssue = async (request) => {
    storeCalls += 1;
    return originalUpload(request);
  };
  const receipt = await uploadOwnerImageReference(input);
  assert.deepEqual(Object.keys(receipt).sort(), ["mime_type", "mime_type_source", "reference_handle", "size", "size_source", "status"]);
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.mime_type, "image/png");
  assert.equal(receipt.size, MAX_BANANA_IMAGE_BYTES);
  assert.equal(receipt.reference_handle, "reference_823e4567-e89b-12d3-a456-426614174000");
  assert.equal(clientCalls.value, 1);
  assert.equal(storeCalls, 1);

  const candidate = await prepareOwnerImageReferenceRequest({
    registry: input.registry,
    catalog: input.catalog,
    store: input.store,
    binding: input.binding,
    attemptId: input.attemptId,
    linkService: input.linkService,
    reference_handle: receipt.reference_handle,
    parameters: { prompt: "Use this image as the reference." }
  });
  assert.equal(candidate.dispatch_allowed, false);
  assert.deepEqual(candidate.request.settings.file_urls, [{ type: "image", url: "https://r2.syntx.ai/owned/reference.png" }]);
  assert.equal(storeCalls, 1);
});

test("rejects invalid size, MIME, filename and extra input before store or upload invocation", async () => {
  const cases: Array<Record<string, unknown>> = [
    { bytes: new Uint8Array(0) },
    { bytes: new Uint8Array(MAX_BANANA_IMAGE_BYTES + 1) },
    { mime_type: "image/gif" },
    { mime_type: "image/jpeg; charset=binary" },
    { filename: "../reference.png" },
    { url: "https://r2.syntx.ai/anything" },
    { path: "/tmp/reference.png" },
    { upstream_file_id: "file_123" },
    { unexpected: "anything" }
  ];
  for (const bad of cases) {
    const { input, clientCalls } = uploadInput(bad);
    let storeCalls = 0;
    const originalUpload = input.store.uploadAndIssue.bind(input.store);
    input.store.uploadAndIssue = async (request) => {
      storeCalls += 1;
      return originalUpload(request);
    };
    await assert.rejects(() => uploadOwnerImageReference(input),
      (error: unknown) => error instanceof OwnerImageReferenceUploadError && error.code === "INVALID_REQUEST");
    assert.equal(storeCalls, 0);
    assert.equal(clientCalls.value, 0);
  }
});

test("accepts only the three supported image MIME values", async () => {
  for (const mime_type of ["image/jpeg", "image/png", "image/webp"]) {
    const { input, clientCalls } = uploadInput({ mime_type });
    const receipt = await uploadOwnerImageReference(input);
    assert.equal(receipt.mime_type, mime_type);
    assert.equal(clientCalls.value, 1);
  }
});

test("foreign owner binding and mismatched link attempt stop before the upload client", async () => {
  for (const overrides of [
    { binding: { tenant_id: "tenant_foreign", subject: "subject_foreign" } },
    { linkService: linkedService("link_foreign_owner_attempt_123456") }
  ]) {
    const { input, clientCalls } = uploadInput(overrides);
    await assert.rejects(() => uploadOwnerImageReference(input),
      (error: unknown) => error instanceof OwnerMediaReferenceStoreError && error.code === "REFERENCE_PRINCIPAL_NOT_LINKED");
    assert.equal(clientCalls.value, 0);
  }
});

test("preserves an unknown upload outcome and never retries the store", async () => {
  const { input, clientCalls } = uploadInput();
  const unknown = new OwnerMediaReferenceStoreError("REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
  let storeCalls = 0;
  input.store.uploadAndIssue = async () => { storeCalls += 1; throw unknown; };
  await assert.rejects(() => uploadOwnerImageReference(input), (error: unknown) => error === unknown);
  assert.equal(storeCalls, 1);
  assert.equal(clientCalls.value, 0);
});
