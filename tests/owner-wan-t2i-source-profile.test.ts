import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { getOwnerWanT2iSourceParameters } from "../src/application/owner-wan-t2i-parameters.js";
import { schemaHash } from "../src/domain/generation-contract.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const catalogSnapshot = syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
)));
const catalog = new DiscoveryCatalogRepository(catalogSnapshot);
const profileModuleUrl = new URL("../src/application/owner-wan-t2i-source-profile.js", import.meta.url).href;

test("binds both full WAN T2I profiles to their exact active e551 rows and source pins", async () => {
  let profileModule: Record<string, unknown> | null = null;
  try { profileModule = await import(profileModuleUrl) as Record<string, unknown>; }
  catch { /* Expected RED until the source profile is implemented. */ }
  assert.equal(typeof profileModule?.getOwnerWanT2iSourceProfile, "function", "MISSING_OWNER_WAN_T2I_SOURCE_PROFILE");

  const readProfile = profileModule!.getOwnerWanT2iSourceProfile as (
    model: string, catalogInput: typeof catalog, version: string
  ) => Record<string, unknown>;
  const sourceParameters = getOwnerWanT2iSourceParameters();
  const expected = [
    { id: "wan_25_t2i_preview", default: false,
      publicRowHash: "sha256:85dd8513cc1fb51429fef15454ec7959935284734cbb4d0f58c7feb7e046883a",
      discoveryRecordHash: "sha256:46c6575ccb75a4e8475979993b5f0f7142d96c5f3ec68c075816798352321d26" },
    { id: "wan_26_t2i", default: true,
      publicRowHash: "sha256:44ab97682526f0564452a190742c059754a16427e5b09ce5c4736d79e2000f6e",
      discoveryRecordHash: "sha256:608eca0223fedd4ad09afcdf772774f04542dd2a266176aa3b10cc24a9c74b9b" }
  ] as const;

  for (const row of expected) {
    const profile = readProfile(row.id, catalog, CATALOG_VERSION);
    assert.equal(profile.profile_id, "owner-wan-t2i-source-profile-v1");
    assert.equal(profile.model_id, row.id);
    assert.equal(profile.ai_name, "wan_image");
    assert.equal(profile.model_type, row.id);
    assert.equal(profile.operation_id, "generate-image");
    assert.equal(profile.public_catalog_version, CATALOG_VERSION);
    assert.equal(profile.catalog_default_flag, row.default);
    const binding = profile.source_binding as Record<string, unknown>;
    const rawPublicCatalog = JSON.parse(readFileSync(join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8")) as {
      models: Array<Record<string, unknown>>
    };
    const rawRow = rawPublicCatalog.models.find((item) => item.value === row.id);
    assert.ok(rawRow);
    assert.equal(schemaHash(rawRow), row.publicRowHash);
    assert.equal(binding.public_catalog_raw_model_row_schema_hash, row.publicRowHash);
    assert.equal(binding.public_catalog_raw_model_row_hash_codec, "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD");
    assert.equal(schemaHash(catalog.getModel(row.id)), row.discoveryRecordHash);
    assert.equal(binding.discovery_model_record_schema_hash, row.discoveryRecordHash);
    assert.equal(binding.source_control_confidence,
      "PINNED_STATIC_SOURCE_NOT_EFFECTIVE_CACHE_OR_PROVIDER_PROOF");
    assert.deepEqual(profile.parameters_source, sourceParameters);
    const pins = (profile.parameters_source as { source_pins: Record<string, unknown> }).source_pins;
    assert.equal(pins.model_row_hash_codec, "SHA256_JSON_STRINGIFY_EXACT_RAW_PUBLIC_RECORD");
    assert.equal(pins.public_models_sha256,
      "sha256:36e6960df3549da228d569a64a80148ff264a59dc7d3a1c138e19a99d39d6444");
    assert.equal(pins.form_sha256, "sha256:c1190674e29d4b943eaa3bfb3571a8716f4a9901de433fc423840aed393f11a3");
    assert.deepEqual(sourceParameters.cost.declared_get_cost_params, ["size", "batch_size"]);
    assert.deepEqual(sourceParameters.cost.cost_inputs, ["batch_size"]);
    assert.equal(sourceParameters.cost.size, "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS");
    const settings = profile.public_settings as Record<string, unknown>;
    assert.deepEqual(settings.get_cost_params, ["size", "batch_size"]);
    assert.equal(settings.file_count_limit, 0);
    assert.equal(settings.max_prompt_length, 1500);
    assert.equal(settings.max_file_size, 0);
    assert.equal(settings.uploadable, false);
    assert.deepEqual(settings.accepted_file_types, []);
    const costPolicy = profile.cost_policy as Record<string, unknown>;
    assert.deepEqual(costPolicy.declared_model_info_keys, ["size", "batch_size"]);
    assert.deepEqual(costPolicy.controlled_input_keys, ["batch_size"]);
    assert.equal(costPolicy.size_policy, "OMITTED_NO_CONTROLLED_SIZE_OR_RESOLUTION_ALIAS");
    assert.equal(costPolicy.source_hook, "COMMON_UNGUARDED_WAN_IMAGE_COST2_CALL_NO_OVERRIDES");
    assert.equal(costPolicy.query_route, "GET_MODEL_INFO_AI_NAME_AND_EXACT_SELECTED_MODEL_TYPE");
    assert.equal(costPolicy.query_is_generation_wire, false);
    assert.equal(costPolicy.quote_units_billing_hard_cap, "UNPROVEN");
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(profile.effective_defaults, "UNKNOWN");
    assert.match(String(profile.profile_schema_hash), /^sha256:[a-f0-9]{64}$/u);
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(settings), true);
  }
});

test("rejects a changed full DiscoveryModelRecord instead of binding only its model ID", async () => {
  const module = await import(profileModuleUrl) as Record<string, unknown>;
  const readProfile = module.getOwnerWanT2iSourceProfile as (
    model: string, catalogInput: unknown, version: string
  ) => unknown;
  const ProfileError = module.OwnerWanT2iSourceProfileError as new (...args: never[]) => Error & { code: string };
  const original = catalog.getModel("wan_25_t2i_preview");
  const altered = structuredClone(original);
  altered.display_name = "Altered WAN display label";
  const alteredCatalog = {
    fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata,
    catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable,
    getModel: (model: string) => model === "wan_25_t2i_preview" ? altered : catalog.getModel(model)
  };
  assert.throws(() => readProfile("wan_25_t2i_preview", alteredCatalog, CATALOG_VERSION),
    (error: unknown) => error instanceof ProfileError && error.code === "PROFILE_BINDING_MISMATCH");
});

test("rejects a foreign model/archive and refuses catalog accessors or proxies", async () => {
  const module = await import(profileModuleUrl) as Record<string, unknown>;
  const readProfile = module.getOwnerWanT2iSourceProfile as (
    model: string, catalogInput: unknown, version: string
  ) => unknown;
  const ProfileError = module.OwnerWanT2iSourceProfileError as new (...args: never[]) => Error & { code: string };
  assert.throws(() => readProfile("wan_25_i2i_preview", catalog, CATALOG_VERSION),
    (error: unknown) => error instanceof ProfileError && error.code === "INVALID_REQUEST");
  assert.throws(() => readProfile("wan_25_t2i_preview", catalog, "sha256-foreign.json"),
    (error: unknown) => error instanceof ProfileError && error.code === "PROFILE_BINDING_MISMATCH");

  let getterCalls = 0;
  const accessorCatalog = Object.defineProperties({}, {
    fetched_at: { enumerable: true, get() { getterCalls += 1; return catalog.fetched_at; } },
    source_hashes: { value: catalog.source_hashes, enumerable: true },
    catalog_metadata: { value: catalog.catalog_metadata, enumerable: true },
    catalog_kind: { value: catalog.catalog_kind, enumerable: true },
    runtime_usable: { value: catalog.runtime_usable, enumerable: true },
    getModel: { value: catalog.getModel.bind(catalog), enumerable: true }
  });
  assert.throws(() => readProfile("wan_25_t2i_preview", accessorCatalog, CATALOG_VERSION));
  assert.equal(getterCalls, 0);

  let proxyTraps = 0;
  const proxy = new Proxy(catalog, { get(target, key, receiver) {
    proxyTraps += 1;
    return Reflect.get(target, key, receiver);
  } });
  assert.throws(() => readProfile("wan_25_t2i_preview", proxy, CATALOG_VERSION),
    (error: unknown) => error instanceof ProfileError && error.code === "INVALID_REQUEST");
  assert.equal(proxyTraps, 0);
});
