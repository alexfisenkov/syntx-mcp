import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";

const profileModuleUrl = new URL("../src/application/owner-grok-t2i-source-profile.js", import.meta.url).href;
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const BASE_RATIOS = ["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"];
const IMAGINE_RATIOS = ["1:1", "2:3", "3:2", "9:16", "16:9"];
const catalogSnapshot = syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
)));
const catalog = new DiscoveryCatalogRepository(catalogSnapshot);

test("binds all four source profiles to complete exact e551 public rows without granting execution", async () => {
  let profileModule: Record<string, unknown> | null = null;
  try {
    profileModule = await import(profileModuleUrl) as Record<string, unknown>;
  } catch {
    // A missing implementation is asserted below as the intended RED result.
  }
  assert.equal(typeof profileModule?.getOwnerGrokT2iSourceProfile, "function", "MISSING_OWNER_GROK_T2I_SOURCE_PROFILE");
  const readProfile = profileModule!.getOwnerGrokT2iSourceProfile as (
    model: string, catalogInput: typeof catalog, version: string
  ) => Record<string, unknown>;
  const expected = [
    { id: "grok_t2i", default: true, file_count_limit: 3, uploadable: false, reference_maximum: 0,
      reference_ratios: BASE_RATIOS, record_hash: "sha256:907e7763ec4d7f29a1b076bfc3eacb63505b177a3734da8ab35f525d9bc794ea" },
    { id: "grok_t2i_pro", default: false, file_count_limit: 3, uploadable: false, reference_maximum: 0,
      reference_ratios: BASE_RATIOS, record_hash: "sha256:e580faab3470ebc62eeaacad867f28a20b06fd07872f577a96255db17c2a6cf5" },
    { id: "grok_imagine_2", default: false, file_count_limit: 5, uploadable: true, reference_maximum: 5,
      reference_ratios: BASE_RATIOS, no_reference_ratios: IMAGINE_RATIOS,
      record_hash: "sha256:475201e9ecd7cd80cc0406eb4542fe7677e464aa92bc5a3e018d08cee6c9aa39" },
    { id: "grok_imagine_quality", default: false, file_count_limit: 3, uploadable: true, reference_maximum: 3,
      reference_ratios: BASE_RATIOS, no_reference_ratios: IMAGINE_RATIOS,
      record_hash: "sha256:dcfc23cf05a050a8975049eb7d3f9299bfd43f4eaa5f7ac7d83c7ec422db3d4c" }
  ] as const;
  for (const row of expected) {
    const profile = readProfile(row.id, catalog, CATALOG_VERSION);
    assert.equal(profile.model_id, row.id);
    assert.equal(profile.ai_name, "grok_image");
    assert.equal(profile.operation_id, "generate-image");
    assert.equal(profile.public_catalog_version, CATALOG_VERSION);
    assert.equal(profile.catalog_default_flag, row.default);
    const sourceBinding = profile.source_binding as Record<string, unknown>;
    assert.equal(sourceBinding.full_public_record_sha256, row.record_hash);
    assert.equal((sourceBinding.source_form as Record<string, unknown>).sha256,
      "sha256:1bbf68ba51172eeacaa936e66755236179d8595bde98b54f78414b30645b2f5d");
    const publicSettings = profile.public_settings as Record<string, unknown>;
    assert.equal(publicSettings.file_count_limit, row.file_count_limit);
    assert.equal(publicSettings.uploadable, row.uploadable);
    const selector = profile.reference_selector as Record<string, unknown>;
    assert.equal(selector.maximum, row.reference_maximum);
    assert.equal(selector.confidence, "PUBLIC_CATALOG_METADATA_ONLY_NOT_UPLOAD_PERMISSION");
    assert.equal(selector.permission, "SOURCE_SELECTOR_ONLY_NOT_UPLOAD_PERMISSION");
    const parameters = profile.parameters_source as { source_pins: Record<string, unknown>; models_by_id: Record<string, {
      aspect_ratio_without_references: readonly string[]; aspect_ratio_with_references: readonly string[];
      reference_count_selector_maximum: number; details_quality?: { values: readonly string[] }
    }> };
    assert.equal(parameters.source_pins.form_build_id, "1791467421");
    assert.equal(parameters.source_pins.form_sha256, "sha256:1bbf68ba51172eeacaa936e66755236179d8595bde98b54f78414b30645b2f5d");
    assert.equal(parameters.models_by_id[row.id]?.reference_count_selector_maximum, row.reference_maximum);
    assert.deepEqual(parameters.models_by_id[row.id]?.aspect_ratio_with_references, row.reference_ratios);
    const noReferenceRatios = "no_reference_ratios" in row ? row.no_reference_ratios : row.reference_ratios;
    assert.deepEqual(parameters.models_by_id[row.id]?.aspect_ratio_without_references, noReferenceRatios);
    assert.equal(Object.hasOwn(parameters.models_by_id[row.id] ?? {}, "details_quality"), row.id === "grok_imagine_2");
    if (row.id === "grok_imagine_2") assert.deepEqual(parameters.models_by_id[row.id]?.details_quality?.values, ["low", "medium"]);
    assert.equal(profile.cost_inputs, null);
    assert.equal(profile.cost_projection_status, "NOT_JOINED");
    assert.equal(profile.effective_defaults, "SOURCE_CANDIDATES_ONLY_NOT_RUNTIME_DEFAULTS");
    assert.equal(profile.dispatch_allowed, false);
    assert.equal(profile.runtime_activation, false);
    assert.equal(profile.backend_acceptance, "UNPROVEN");
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(Object.isFrozen(publicSettings), true);
  }
});

test("rejects a foreign archive and drift anywhere in the complete selected public record", async () => {
  const profileModule = await import(profileModuleUrl) as Record<string, unknown>;
  const readProfile = profileModule.getOwnerGrokT2iSourceProfile as (
    model: string, catalogInput: unknown, version: string
  ) => unknown;
  const ProfileError = profileModule.OwnerGrokT2iSourceProfileError as new (...args: never[]) => Error & { code: string };
  const makeCatalogPort = (getModel: (model: string) => unknown, overrides: Record<string, unknown> = {}) => ({
    fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata,
    catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable,
    getModel,
    ...overrides
  });
  const isProfileMismatch = (error: unknown) => error instanceof ProfileError && error.code === "PROFILE_BINDING_MISMATCH";

  assert.throws(() => readProfile("grok_t2i", catalog, "sha256-foreign.json"), isProfileMismatch);
  const original = catalog.getModel("grok_imagine_2");
  const changedLabel = { ...structuredClone(original), display_name: "Different display label" };
  assert.throws(() => readProfile("grok_imagine_2", makeCatalogPort((model) => model === "grok_imagine_2" ? changedLabel : catalog.getModel(model)), CATALOG_VERSION), isProfileMismatch);
  const changedSettings = structuredClone(original);
  assert.ok(changedSettings.settings);
  changedSettings.settings.file_count_limit = 4;
  assert.throws(() => readProfile("grok_imagine_2", makeCatalogPort((model) => model === "grok_imagine_2" ? changedSettings : catalog.getModel(model)), CATALOG_VERSION), isProfileMismatch);
  const changedHashes = { ...catalog.source_hashes, models: "sha256:" + "0".repeat(64) };
  assert.throws(() => readProfile("grok_imagine_2", makeCatalogPort((model) => catalog.getModel(model), { source_hashes: changedHashes }), CATALOG_VERSION), isProfileMismatch);
});

test("rejects nested public-record accessors without invoking them", async () => {
  const profileModule = await import(profileModuleUrl) as Record<string, unknown>;
  const readProfile = profileModule.getOwnerGrokT2iSourceProfile as (
    model: string, catalogInput: unknown, version: string
  ) => unknown;
  const original = catalog.getModel("grok_imagine_2");
  const changed = structuredClone(original);
  let getterCalls = 0;
  Object.defineProperty(changed.settings, "file_count_limit", {
    enumerable: true,
    get() { getterCalls += 1; return 5; }
  });
  const accessorCatalog = {
    fetched_at: catalog.fetched_at,
    source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata,
    catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable,
    getModel: (model: string) => model === "grok_imagine_2" ? changed : catalog.getModel(model)
  };
  assert.throws(() => readProfile("grok_imagine_2", accessorCatalog, CATALOG_VERSION));
  assert.equal(getterCalls, 0);
});

test("rejects catalog and model proxies plus unrecognized model-record fields without triggering proxy traps", async () => {
  const profileModule = await import(profileModuleUrl) as Record<string, unknown>;
  const readProfile = profileModule.getOwnerGrokT2iSourceProfile as (
    model: string, catalogInput: unknown, version: string
  ) => unknown;
  const ProfileError = profileModule.OwnerGrokT2iSourceProfileError as new (...args: never[]) => Error & { code: string };
  let catalogTraps = 0;
  const catalogProxy = new Proxy(catalog, {
    ownKeys(target) { catalogTraps += 1; return Reflect.ownKeys(target); },
    get(target, key, receiver) { catalogTraps += 1; return Reflect.get(target, key, receiver); }
  });
  assert.throws(() => readProfile("grok_t2i", catalogProxy, CATALOG_VERSION),
    (error: unknown) => error instanceof ProfileError && error.code === "INVALID_REQUEST");
  assert.equal(catalogTraps, 0);

  const original = catalog.getModel("grok_imagine_quality");
  const extraField = { ...structuredClone(original), unreviewed_public_field: "new" };
  const extraFieldCatalog = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata, catalog_kind: catalog.catalog_kind, runtime_usable: catalog.runtime_usable,
    getModel: (model: string) => model === "grok_imagine_quality" ? extraField : catalog.getModel(model)
  };
  assert.throws(() => readProfile("grok_imagine_quality", extraFieldCatalog, CATALOG_VERSION),
    (error: unknown) => error instanceof ProfileError && error.code === "PROFILE_BINDING_MISMATCH");

  let modelTraps = 0;
  const modelProxy = new Proxy(original, { ownKeys(target) { modelTraps += 1; return Reflect.ownKeys(target); } });
  const modelProxyCatalog = {
    fetched_at: catalog.fetched_at, source_hashes: catalog.source_hashes,
    catalog_metadata: catalog.catalog_metadata, catalog_kind: catalog.catalog_kind, runtime_usable: catalog.runtime_usable,
    getModel: (model: string) => model === "grok_imagine_quality" ? modelProxy : catalog.getModel(model)
  };
  assert.throws(() => readProfile("grok_imagine_quality", modelProxyCatalog, CATALOG_VERSION),
    (error: unknown) => error instanceof ProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.equal(modelTraps, 0);

  let nestedHashTraps = 0;
  const nestedHashProxy = new Proxy({}, { ownKeys() { nestedHashTraps += 1; return []; } });
  const nestedHashes = { ...catalog.source_hashes, models: nestedHashProxy };
  const nestedHashCatalog = {
    fetched_at: catalog.fetched_at,
    source_hashes: nestedHashes,
    catalog_metadata: { ...catalog.catalog_metadata, source_hashes: nestedHashes },
    catalog_kind: catalog.catalog_kind,
    runtime_usable: catalog.runtime_usable,
    getModel: (model: string) => catalog.getModel(model)
  };
  assert.throws(() => readProfile("grok_t2i", nestedHashCatalog, CATALOG_VERSION),
    (error: unknown) => error instanceof ProfileError && error.code === "PROFILE_BINDING_MISMATCH");
  assert.equal(nestedHashTraps, 0);
});
