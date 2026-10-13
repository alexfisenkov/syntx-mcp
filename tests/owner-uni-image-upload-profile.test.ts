import assert from "node:assert/strict";
import { lstatSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { getOwnerUniImageUploadProfile, OwnerUniImageUploadProfileError, type OwnerUniImageUploadCatalogPort } from "../src/catalog/owner-uni-image-upload-profile.js";
import type { DiscoveryCatalogRepository, DiscoveryModelRecord } from "../src/catalog/discovery-catalog.js";
import { OWNER_UNI_IMAGE_INPUT_POLICY } from "../src/application/owner-uni-image-input-validator.js";

const EXPECTED_RECORD_HASHES = {
  "uni-1": "sha256:9c095d9bc71d214d8005b55038a4212f7b19fb3fb9255fe3b8c0e8d24ab7b02d",
  "uni-1.1-modify-image": "sha256:61fab99d9e121bc9e29742a071e328dc4ee2a9c5140472f2d2025fb4ce538796",
  "uni-1.1-remove-background": "sha256:88ac8c582d2ebbb3c65866c38b9638eaef1d1c1df1855ecf096b5c61575fd96c"
} as const;
const EXPECTED_PROFILE_HASHES = {
  "uni-1": "sha256:8a17f9b55edd9d924f0da97d11004a5ea5a97d510d84a06be8f95eb31c3ea79f",
  "uni-1.1-modify-image": "sha256:5e8e2e8511bc9eda356f016e889dc231871d1b26a6be0a7f0cdc854cd62ac5b7",
  "uni-1.1-remove-background": "sha256:abec7756c973f37c57024339a9ffbbd445fad557295f7a230b0de7d2d64a136f"
} as const;

test("binds every Uni upload profile to the exact full selected e551 record and catalog metadata", () => {
  const { discoveryCatalog } = loadSelectedDiscoveryCatalog(
    DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolvePhysicalCatalogDirectory()
  );
  for (const model_id of Object.keys(EXPECTED_RECORD_HASHES) as (keyof typeof EXPECTED_RECORD_HASHES)[]) {
    const profile = getOwnerUniImageUploadProfile(model_id, discoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
    assert.equal(profile.profile_id, "owner-uni-image-upload-profile-v1");
    assert.equal(profile.model_id, model_id);
    assert.equal(profile.ai_name, "luma_image");
    assert.equal(profile.model_type, model_id);
    assert.equal(profile.scope, "image");
    assert.equal(profile.operation_id, "upload-image-reference");
    assert.equal(profile.catalog_version, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
    assert.equal(profile.catalog_metadata_sha256, "sha256:fbd9ebb6cb75ff7d12737dc050d4467f0824cd4fdb575a847cb359258f8971f6");
    assert.equal(profile.full_public_record_sha256, EXPECTED_RECORD_HASHES[model_id]);
    assert.equal(profile.upload_profile_schema_hash, EXPECTED_PROFILE_HASHES[model_id]);
    assert.equal(profile.source_metadata.active, true);
    assert.equal(profile.source_metadata.uploadable, true);
    assert.deepEqual(profile.source_metadata.accepted_file_types, ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/avif"]);
    assert.equal(profile.source_metadata.max_file_size, 26_214_400);
    assert.notEqual(profile.source_metadata.accepted_file_types, profile.local_input_policy.accepted_mime_types);
    assert.deepEqual(profile.local_input_policy.accepted_mime_types, profile.source_metadata.accepted_file_types);
    assert.equal(profile.local_input_policy.local_max_bytes, 26_214_400);
    assert.equal(profile.local_input_policy.local_max_bytes_policy, "SELECTED_PUBLIC_METADATA_LOCAL_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
    assert.deepEqual(profile.local_input_policy.accepted_mime_types, OWNER_UNI_IMAGE_INPUT_POLICY.accepted_mime_types);
    assert.equal(profile.local_input_policy.local_max_bytes, OWNER_UNI_IMAGE_INPUT_POLICY.local_max_bytes);
    assert.equal(profile.local_input_policy.local_max_bytes_policy, OWNER_UNI_IMAGE_INPUT_POLICY.local_max_bytes_policy);
    assert.equal(profile.source_metadata.confidence, "PUBLIC_CATALOG_METADATA_NOT_PROVIDER_ACCEPTANCE");
    assert.equal(profile.local_input_policy.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.ok(!("reference_count" in profile));
    assert.ok(!("parameters" in profile));
    assert.ok(!("dispatch_allowed" in profile));
    assert.ok(Object.isFrozen(profile));
    assert.ok(Object.isFrozen(profile.source_metadata));
    assert.ok(Object.isFrozen(profile.source_metadata.accepted_file_types));
    assert.ok(Object.isFrozen(profile.local_input_policy));
  }
});

test("rejects missing or changed full model records, catalog metadata, and caller catalog versions", () => {
  const { discoveryCatalog } = loadCatalog();
  const invalidBinding = (error: unknown) => error instanceof OwnerUniImageUploadProfileError && error.code === "PROFILE_BINDING_MISMATCH";
  const validPort = portFor(discoveryCatalog);
  assert.throws(() => getOwnerUniImageUploadProfile("uni-1", validPort, "sha256-older.json"), invalidBinding);
  assert.throws(() => getOwnerUniImageUploadProfile("uni-1", portFor(discoveryCatalog, () => ({
    ...discoveryCatalog.getModel("uni-1"), description: "altered full record"
  })), DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION), invalidBinding);
  assert.throws(() => getOwnerUniImageUploadProfile("uni-1", portFor(discoveryCatalog, () => {
    const { default: _omitted, ...record } = discoveryCatalog.getModel("uni-1");
    return record as DiscoveryModelRecord;
  }), DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION), invalidBinding);
  const alteredMetadata = { ...discoveryCatalog.catalog_metadata,
    summary: { ...discoveryCatalog.catalog_metadata.summary, ai_active: -1 } };
  assert.throws(() => getOwnerUniImageUploadProfile("uni-1", { ...validPort, catalog_metadata: alteredMetadata }, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION), invalidBinding);
});

test("rejects catalog/model proxies and accessor fields without invoking user traps or getters", () => {
  const { discoveryCatalog } = loadCatalog();
  const invalidRequest = (error: unknown) => error instanceof OwnerUniImageUploadProfileError && error.code === "INVALID_REQUEST";
  const invalidBinding = (error: unknown) => error instanceof OwnerUniImageUploadProfileError && error.code === "PROFILE_BINDING_MISMATCH";
  let proxyTraps = 0;
  let getterCalls = 0;
  const port = portFor(discoveryCatalog);
  const proxyCatalog = new Proxy(port, { get(target, property, receiver) {
    proxyTraps += 1;
    return Reflect.get(target, property, receiver);
  } });
  assert.throws(() => getOwnerUniImageUploadProfile("uni-1", proxyCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION), invalidRequest);
  assert.equal(proxyTraps, 0);

  const accessorCatalog = Object.defineProperty({ ...port }, "getModel", {
    enumerable: true, get() { getterCalls += 1; return port.getModel; }
  });
  assert.throws(() => getOwnerUniImageUploadProfile("uni-1", accessorCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION), invalidRequest);
  assert.equal(getterCalls, 0);

  assert.throws(() => getOwnerUniImageUploadProfile("uni-1", portFor(discoveryCatalog, () =>
    new Proxy(discoveryCatalog.getModel("uni-1"), { ownKeys() { proxyTraps += 1; return []; } }) as DiscoveryModelRecord
  ), DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION), invalidBinding);
  assert.equal(proxyTraps, 0);

  const accessorModel = { ...discoveryCatalog.getModel("uni-1") };
  Object.defineProperty(accessorModel, "ai_name", { enumerable: true, get() { getterCalls += 1; return "luma_image"; } });
  assert.throws(() => getOwnerUniImageUploadProfile("uni-1", portFor(discoveryCatalog, () => accessorModel),
    DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION), invalidBinding);
  assert.equal(getterCalls, 0);
});

function loadCatalog() {
  return loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolvePhysicalCatalogDirectory());
}
function resolvePhysicalCatalogDirectory(): string {
  for (const candidate of [new URL("../catalog", import.meta.url), new URL("../../catalog", import.meta.url)]) {
    const path = fileURLToPath(candidate);
    try {
      const metadata = lstatSync(path);
      if (metadata.isDirectory() && !metadata.isSymbolicLink()) return path;
    } catch (error) {
      if (error === null || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("UNI_TEST_PHYSICAL_CATALOG_NOT_FOUND");
}
function portFor(catalog: DiscoveryCatalogRepository, getModel: (modelId: string) => DiscoveryModelRecord = (modelId) => catalog.getModel(modelId)): OwnerUniImageUploadCatalogPort {
  return {
    getModel,
    catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable,
    fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata
  };
}
