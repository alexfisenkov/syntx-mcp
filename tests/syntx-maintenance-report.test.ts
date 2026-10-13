import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import {
  buildMaplessSettingsInventory,
  loadMaplessSettingsInventoryVersion,
  type MaplessSettingsInventory
} from "../src/catalog/mapless-settings-inventory.js";
import {
  buildSyntxPublicCatalogSnapshot,
  serializeSyntxPublicCatalogSnapshot,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  compareSyntxMaintenanceSnapshots,
  SyntxMaintenanceReportError
} from "../src/application/syntx-maintenance-report.js";

const HASH_A = "sha256:" + "a".repeat(64);
const HASH_B = "sha256:" + "b".repeat(64);
const HASH_C = "sha256:" + "c".repeat(64);

function makeSnapshot(input: {
  readonly fetchedAt?: string;
  readonly ai?: readonly { value: string; label?: string; active?: boolean }[];
  readonly models?: readonly {
    value: string; ai_name?: string; label?: string; active?: boolean;
    settings?: Readonly<Record<string, unknown>> | null;
  }[];
  readonly llmIds?: readonly string[];
  readonly llmEnabled?: Readonly<Record<string, boolean>>;
} = {}): SyntxPublicCatalogSnapshot {
  const ai = (input.ai ?? [{ value: "demo", label: "Demo AI" }]).map((row) => ({
    active: row.active ?? true,
    description: null,
    label: row.label ?? row.value,
    scope: row.value,
    value: row.value
  }));
  const models = (input.models ?? [{ value: "image-a" }]).map((row) => ({
    active: row.active ?? true,
    ai_name: row.ai_name ?? "demo",
    default: false,
    description: "private-description-fixture",
    features: null,
    label: row.label ?? row.value,
    settings: row.settings === undefined ? { max_prompt_length: 100 } : row.settings,
    type: null,
    value: row.value
  }));
  const llmIds = input.llmIds ?? ["llm-a"];
  const llmModels = llmIds.map((id) => ({
    ai_name: "demo",
    available_subscriptions: ["pro"],
    capabilities: {
      deep_research: false, files: false, images: true, planning: false,
      streaming: true, system_message: true, thinking: false, web_explorer: false
    },
    context_window: 16_000,
    default_max_tokens: 2_000,
    description: "private-llm-description-fixture",
    enabled: input.llmEnabled?.[id] ?? true,
    free_from_sub: null,
    icon: null,
    id,
    is_free: false,
    label: id,
    max_images_count: 4,
    min_subscription: "pro",
    performance_level: 1,
    supported_tools: []
  }));
  return buildSyntxPublicCatalogSnapshot({
    aiPayload: ai,
    modelsPayload: models,
    llmModelsPayload: { count: llmModels.length, models: llmModels },
    fetchedAt: input.fetchedAt ?? "2026-10-10T00:00:00.000Z"
  });
}

function archiveVersion(snapshot: SyntxPublicCatalogSnapshot): string {
  const digest = createHash("sha256").update(serializeSyntxPublicCatalogSnapshot(snapshot)).digest("hex");
  return "sha256-" + digest + ".json";
}

function makeSettings(
  snapshot: SyntxPublicCatalogSnapshot,
  options: { readonly generatedAt?: string; readonly formSha?: string; readonly settings3Sha?: string } = {}
): MaplessSettingsInventory {
  const formId = "demo";
  return buildMaplessSettingsInventory({
    publicCatalog: snapshot,
    publicVersion: archiveVersion(snapshot),
    generatedAt: options.generatedAt ?? "2026-10-10T00:01:00.000Z",
    buildId: "1791467421",
    homepageSha256: HASH_A,
    appSha256: HASH_B,
    registry: {
      url: "https://syntx.ai/assets/1791467421/Settings2.js",
      bytes: 100,
      sha256: HASH_C
    },
    framework: {
      settings3: {
        url: "https://syntx.ai/assets/1791467421/settings3.js",
        bytes: 100,
        sha256: options.settings3Sha ?? HASH_A,
        generic_setting_keys: ["max_prompt_length"]
      },
      useSettingsParams: {
        url: "https://syntx.ai/assets/1791467421/useSettingsParams.js",
        bytes: 100,
        sha256: HASH_B,
        payload_field_keys: ["model_type"]
      }
    },
    forms: [{
      form_id: formId,
      module_name: "demo.js",
      javascript: {
        url: "https://syntx.ai/assets/1791467421/demo.js",
        bytes: 100,
        sha256: options.formSha ?? HASH_A,
        parse_diagnostics: 0,
        model_value_settings_keys: ["aspect_ratio"],
        static_setting_defaults: {}
      }
    }]
  });
}

function compare(
  baseline: SyntxPublicCatalogSnapshot,
  candidate: SyntxPublicCatalogSnapshot,
  baselineSettings?: MaplessSettingsInventory,
  candidateSettings?: MaplessSettingsInventory
) {
  return compareSyntxMaintenanceSnapshots({
    baseline_public: baseline,
    candidate_public: candidate,
    ...(baselineSettings === undefined ? {} : { baseline_settings: baselineSettings }),
    ...(candidateSettings === undefined ? {} : { candidate_settings: candidateSettings })
  });
}

test("reports sorted identity deltas and changed key paths without copying row values", () => {
  const baseline = makeSnapshot({
    ai: [{ value: "demo" }, { value: "retired-ai" }],
    models: [
      { value: "image-a", settings: { max_prompt_length: 100 } },
      { value: "remove-me" }
    ],
    llmIds: ["llm-a", "llm-remove"]
  });
  const candidate = makeSnapshot({
    ai: [{ value: "demo", label: "Renamed AI" }, { value: "new-ai" }],
    models: [
      { value: "image-a", label: "Renamed image", settings: { max_prompt_length: 120 } },
      { value: "new-model" }
    ],
    llmIds: ["llm-a", "llm-new"],
    llmEnabled: { "llm-a": false }
  });

  const report = compare(baseline, candidate);
  assert.deepEqual(report.deltas.ai.added_ids, ["new-ai"]);
  assert.deepEqual(report.deltas.ai.removed_ids, ["retired-ai"]);
  assert.deepEqual(report.deltas.ai.changed, [{ id: "demo", changed_keys: ["label"] }]);
  assert.deepEqual(report.deltas.models.added_ids, ["new-model"]);
  assert.deepEqual(report.deltas.models.removed_ids, ["remove-me"]);
  assert.deepEqual(report.deltas.models.changed, [{
    id: "image-a",
    changed_keys: ["label", "settings.max_prompt_length"]
  }]);
  assert.deepEqual(report.deltas.llm_models.added_ids, ["llm-new"]);
  assert.deepEqual(report.deltas.llm_models.removed_ids, ["llm-remove"]);
  assert.deepEqual(report.deltas.llm_models.changed, [{ id: "llm-a", changed_keys: ["enabled"] }]);
  assert.equal(report.coverage.account_availability, "NOT_CHECKED");
  assert.equal(report.coverage.rendered_ui, "NOT_CHECKED");
  assert.equal(report.coverage.provider_acceptance, "NOT_CHECKED");
  assert.equal(report.automatic_runtime_promotion, false);
  assert.equal(report.paid_operations, false);
  const serialized = JSON.stringify(report);
  assert.equal(serialized.includes("private-description-fixture"), false);
  assert.equal(serialized.includes("Renamed image"), false);
  assert.equal(JSON.stringify(report.deltas).includes("120"), false);
});

test("reordered rows and a fetched-at-only change do not become model changes", () => {
  const baseline = makeSnapshot({
    models: [{ value: "image-a" }, { value: "image-b" }]
  });
  const reordered = makeSnapshot({
    fetchedAt: "2026-10-10T01:00:00.000Z",
    models: [{ value: "image-b" }, { value: "image-a" }]
  });
  const report = compare(baseline, reordered);

  assert.deepEqual(report.deltas.ai.changed, []);
  assert.deepEqual(report.deltas.models.changed, []);
  assert.deepEqual(report.deltas.llm_models.changed, []);
  assert.equal(report.public_source_hashes.source_hash_only_drift, true);
  assert.deepEqual(report.public_source_hashes.changed.map((entry) => entry.source_id), ["models"]);
  assert.equal(report.public_source_hashes.proof_revalidation_required, true);
  assert.deepEqual(report.public_source_hashes.affected_model_ids, ["image-a", "image-b"]);
  assert.notEqual(report.baseline.public.fetched_at, report.candidate.public.fetched_at);
});

test("a fetched-at-only change stays metadata-only", () => {
  const baseline = makeSnapshot({ fetchedAt: "2026-10-10T00:00:00.000Z" });
  const candidate = makeSnapshot({ fetchedAt: "2026-10-10T01:00:00.000Z" });
  const report = compare(baseline, candidate);

  assert.deepEqual(report.deltas.ai.changed, []);
  assert.deepEqual(report.deltas.models.changed, []);
  assert.deepEqual(report.deltas.llm_models.changed, []);
  assert.deepEqual(report.public_source_hashes.changed, []);
  assert.equal(report.public_source_hashes.source_hash_only_drift, false);
  assert.equal(report.public_source_hashes.proof_revalidation_required, false);
  assert.deepEqual(report.public_source_hashes.affected_model_ids, []);
});

test("paired settings changes report form/helper identifiers and conservative impact", () => {
  const baseline = makeSnapshot();
  const candidate = makeSnapshot();
  const report = compare(
    baseline,
    candidate,
    makeSettings(baseline),
    makeSettings(candidate, { formSha: HASH_B, settings3Sha: HASH_C })
  );

  assert.equal(report.settings.status, "COMPARED");
  assert.deepEqual(report.settings.changed_forms, [{ form_id: "demo", changed_keys: ["javascript.sha256"] }]);
  assert.deepEqual(report.settings.changed_helper_ids, ["settings3"]);
  assert.deepEqual(report.settings.source_hash_changes, [
    { source_id: "form:demo", baseline_sha256: HASH_A, candidate_sha256: HASH_B },
    { source_id: "settings3", baseline_sha256: HASH_A, candidate_sha256: HASH_C }
  ]);
  assert.deepEqual(report.settings.affected_model_ids, ["image-a"]);
  assert.equal(report.settings.impact_status, "SHARED_HELPER_PARTIAL");
  assert.equal(report.coverage.settings_inventory, "COMPARED");
});

test("absent settings pair is explicit and does not imply no settings drift", () => {
  const report = compare(makeSnapshot(), makeSnapshot());
  assert.equal(report.settings.status, "NOT_CHECKED");
  assert.equal(report.coverage.settings_inventory, "NOT_CHECKED");
  assert.equal(report.settings.impact_status, "NOT_CHECKED");
});

test("rejects a one-sided settings inventory with a closed error", () => {
  const baseline = makeSnapshot();
  const candidate = makeSnapshot();
  assert.throws(
    () => compare(baseline, candidate, makeSettings(baseline)),
    (error: unknown) => error instanceof SyntxMaintenanceReportError && error.code === "SETTINGS_PAIR_REQUIRED"
  );
});

test("rejects an inventory bound to a different public snapshot", () => {
  const baseline = makeSnapshot();
  const candidate = makeSnapshot({
    models: [{ value: "image-a", settings: { max_prompt_length: 101 } }]
  });
  assert.throws(
    () => compare(baseline, candidate, makeSettings(baseline), makeSettings(baseline)),
    (error: unknown) => error instanceof SyntxMaintenanceReportError &&
      error.code === "SETTINGS_PUBLIC_BINDING_MISMATCH"
  );
});

test("rejects unsupported snapshot schemas with redacted errors", () => {
  const baseline = makeSnapshot();
  const candidate = makeSnapshot();
  assert.throws(
    () => compare({ ...baseline, schema_version: "2.0.0" } as unknown as SyntxPublicCatalogSnapshot, candidate),
    (error: unknown) => error instanceof SyntxMaintenanceReportError &&
      error.code === "INVALID_PUBLIC_SNAPSHOT" && !error.message.includes("2.0.0")
  );
  const invalidSettings = {
    ...makeSettings(candidate),
    account_secret_fixture: "never-return-this"
  } as MaplessSettingsInventory;
  assert.throws(
    () => compare(baseline, candidate, makeSettings(baseline), invalidSettings),
    (error: unknown) => error instanceof SyntxMaintenanceReportError &&
      error.code === "INVALID_SETTINGS_SNAPSHOT" && !error.message.includes("never-return-this")
  );
});

test("compares the actual archived C5 to B066 pair with optional source fields added or removed", () => {
  const catalogDirectory = join(process.cwd(), "catalog");
  const baselinePublic = loadPublicCatalogVersion(
    "sha256-c5c10b9b0bffdc4b75dab3363de10c2c2856f1130a559eb9e8a21a1493bf067c.json",
    catalogDirectory
  );
  const candidatePublic = loadPublicCatalogVersion(
    "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json",
    catalogDirectory
  );
  const baselineSettings = loadMaplessSettingsInventoryVersion(
    "sha256-62bcf08172eb75011055d9ae04c772362b72337646ee2e460944d7fcb2301bcf.json",
    catalogDirectory
  );
  const candidateSettings = loadMaplessSettingsInventoryVersion(
    "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json",
    catalogDirectory
  );

  const report = compareSyntxMaintenanceSnapshots({
    baseline_public: baselinePublic,
    candidate_public: candidatePublic,
    baseline_settings: baselineSettings,
    candidate_settings: candidateSettings
  });

  assert.equal(report.status, "COMPARED");
  assert.equal(report.baseline.public.counts.models, 200);
  assert.equal(report.candidate.public.counts.models, 200);
  assert.deepEqual(report.deltas.models.added_ids, []);
  assert.deepEqual(report.deltas.models.removed_ids, []);
  assert.equal(report.deltas.models.changed.length, 5);
  assert.deepEqual(report.deltas.models.changed.map((row) => row.id),
    [...report.deltas.models.changed.map((row) => row.id)].sort());
  for (const row of report.deltas.models.changed) {
    assert.deepEqual(row.changed_keys, [...row.changed_keys].sort());
  }
  assert.deepEqual(report.public_source_hashes.changed.map((row) => row.source_id), ["models", "llm_models"]);
  assert.equal(report.public_source_hashes.proof_revalidation_required, true);
  assert.equal(report.public_source_hashes.affected_model_ids.length, 200);
  assert.equal(report.settings.status, "COMPARED");
  assert.equal(report.settings.changed_forms.length, 45);
  assert.deepEqual(report.settings.changed_helper_ids, ["app", "asset_build", "homepage", "registry", "settings3", "useSettingsParams"]);
  assert.equal(report.settings.impact_status, "SHARED_HELPER_PARTIAL");
});

test("distinguishes an absent optional field from null, false, zero, and empty string in either direction", () => {
  const absent = makeSnapshot({ models: [{ value: "image-a", settings: {} }] });
  const present = makeSnapshot({ models: [{ value: "image-a", settings: {
    attach_info_text: null,
    max_prompt_length: 0,
    uploadable: false
  } }] });
  const emptyText = makeSnapshot({ models: [{ value: "image-a", settings: {
    attach_info_text: "",
    max_prompt_length: 0,
    uploadable: false
  } }] });
  const onlyEmptyText = makeSnapshot({ models: [{ value: "image-a", settings: { attach_info_text: "" } }] });
  const expected = [{ id: "image-a", changed_keys: [
    "settings.attach_info_text", "settings.max_prompt_length", "settings.uploadable"
  ] }];

  assert.deepEqual(compare(absent, absent).deltas.models.changed, []);
  assert.deepEqual(compare(absent, present).deltas.models.changed, expected);
  assert.deepEqual(compare(present, absent).deltas.models.changed, expected);
  assert.deepEqual(compare(absent, onlyEmptyText).deltas.models.changed, [{
    id: "image-a", changed_keys: ["settings.attach_info_text"]
  }]);
  assert.deepEqual(compare(present, emptyText).deltas.models.changed, [{
    id: "image-a", changed_keys: ["settings.attach_info_text"]
  }]);
});

test("rejects unsafe orphan form IDs instead of returning source IDs verbatim", () => {
  const baseline = makeSnapshot();
  const candidate = makeSnapshot();
  const candidateSettings = makeSettings(candidate);
  candidateSettings.forms.push({
    form_id: "../../private",
    module_name: "private.js",
    javascript: {
      url: "https://syntx.ai/assets/1791467421/private.js",
      bytes: 100,
      sha256: HASH_C,
      parse_diagnostics: 0,
      model_value_settings_keys: [],
      static_setting_defaults: {}
    }
  });
  assert.throws(
    () => compare(baseline, candidate, makeSettings(baseline), candidateSettings),
    (error: unknown) => error instanceof SyntxMaintenanceReportError &&
      error.code === "SETTINGS_PUBLIC_BINDING_MISMATCH"
  );
});

test("rejects hostile accessor and proxy inputs without echoing raw data", () => {
  const baseline = makeSnapshot();
  const accessorInput = { ...baseline } as Record<string, unknown>;
  Object.defineProperty(accessorInput, "fetched_at", {
    enumerable: true,
    get() { throw new Error("private accessor payload"); }
  });
  assert.throws(
    () => compare(accessorInput as unknown as SyntxPublicCatalogSnapshot, makeSnapshot()),
    (error: unknown) => error instanceof SyntxMaintenanceReportError &&
      error.code === "UNSAFE_INPUT" && !error.message.includes("private accessor payload")
  );
  assert.throws(
    () => compare(new Proxy(baseline, {}) as SyntxPublicCatalogSnapshot, makeSnapshot()),
    (error: unknown) => error instanceof SyntxMaintenanceReportError && error.code === "UNSAFE_INPUT"
  );
});
