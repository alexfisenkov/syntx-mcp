import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import { buildSyntxPublicCatalogSnapshot, serializeSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { buildSyntxMaintenanceAuditPlan } from "../src/application/syntx-maintenance-audit-plan.js";

const PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";

test("source inventory projects a deterministic per-control row with origins but never emits setting values", async () => {
  const publicSnapshot = loadPublicCatalogVersion(PUBLIC_VERSION);
  const settings = loadMaplessSettingsInventoryVersion(SETTINGS_VERSION);
  const plan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot,
    candidate_public: publicSnapshot,
    baseline_settings: settings,
    candidate_settings: settings
  });
  const modulePath = "../src/application/syntx-maintenance-control-walk.js";
  const controlWalkModule = await import(modulePath) as {
    buildSyntxMaintenanceControlWalk(input: {
      audit_plan: typeof plan;
      baseline_settings: typeof settings;
      candidate_settings: typeof settings;
    }): { controls: readonly Record<string, unknown>[]; automatic_runtime_promotion?: unknown; paid_operations?: unknown };
  };
  const walk = controlWalkModule.buildSyntxMaintenanceControlWalk({
    audit_plan: plan,
    baseline_settings: settings,
    candidate_settings: settings
  });
  const modelType = walk.controls.find((item) => item.model_id === "banana-2.1" && item.control_key === "model_type");
  assert.ok(modelType);
  assert.deepEqual(modelType, {
    control_id: modelType.control_id,
    model_id: "banana-2.1",
    form_id: "banana",
    control_key: "model_type",
    origins: ["FORM_MODEL_VALUE", "PAYLOAD_FIELD"],
    fingerprint: modelType.fingerprint,
    change_status: "UNCHANGED",
    status: "NOT_VISITED"
  });
  assert.match(String(modelType.control_id), /^ctl_[a-f0-9]{32}$/u);
  assert.match(String(modelType.fingerprint), /^sha256:[a-f0-9]{64}$/u);
  assert.equal(Object.hasOwn(modelType, "value"), false);
  assert.equal(JSON.stringify(modelType).includes("image/png"), false);
  assert.equal(walk.automatic_runtime_promotion, false);
  assert.equal(walk.paid_operations, false);
});

test("checkpoint resumes individual controls and invalidates controls from a changed form hash", async () => {
  const publicSnapshot = loadPublicCatalogVersion(PUBLIC_VERSION);
  const baselineSettings = loadMaplessSettingsInventoryVersion(SETTINGS_VERSION);
  const baselinePlan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot,
    candidate_public: publicSnapshot,
    baseline_settings: baselineSettings,
    candidate_settings: baselineSettings
  });
  const modulePath = "../src/application/syntx-maintenance-control-walk.js";
  const api = await import(modulePath) as {
    buildSyntxMaintenanceControlWalk(input: {
      audit_plan: typeof baselinePlan;
      baseline_settings: typeof baselineSettings;
      candidate_settings: typeof baselineSettings;
      checkpoint?: unknown;
    }): {
      controls: readonly Record<string, unknown>[];
      checkpoint_template: { schema_version: "1.0.0"; source_identity: object; observations: readonly object[] };
      checkpoint_resume: { status: string; carried_observation_count: number; stale_control_ids: readonly string[] };
    };
  };
  const original = api.buildSyntxMaintenanceControlWalk({
    audit_plan: baselinePlan, baseline_settings: baselineSettings, candidate_settings: baselineSettings
  });
  const observedBanana = original.controls.find((row) => row.model_id === "banana-2.1" && row.control_key === "model_type")!;
  const observedSeedream = original.controls.find((row) => row.model_id === "seedream-4" && row.control_key === "resolution")!;
  const checkpoint = {
    ...original.checkpoint_template,
    observations: [
      { control_id: observedBanana.control_id, fingerprint: observedBanana.fingerprint, status: "OBSERVED" },
      { control_id: observedSeedream.control_id, fingerprint: observedSeedream.fingerprint, status: "UNSUPPORTED" }
    ]
  };
  const exact = api.buildSyntxMaintenanceControlWalk({
    audit_plan: baselinePlan, baseline_settings: baselineSettings, candidate_settings: baselineSettings, checkpoint
  });
  assert.equal(exact.checkpoint_resume.status, "EXACT_SOURCE");
  assert.equal(exact.controls.find((row) => row.control_id === observedBanana.control_id)?.status, "OBSERVED");
  assert.equal(exact.controls.find((row) => row.control_id === observedSeedream.control_id)?.status, "UNSUPPORTED");

  const changedSettings = structuredClone(baselineSettings);
  const bananaForm = changedSettings.forms.find((form) => form.form_id === "banana")!;
  bananaForm.javascript.sha256 = `sha256:${"f".repeat(64)}`;
  const changedPlan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot,
    candidate_public: publicSnapshot,
    baseline_settings: baselineSettings,
    candidate_settings: changedSettings
  });
  const resumed = api.buildSyntxMaintenanceControlWalk({
    audit_plan: changedPlan, baseline_settings: baselineSettings, candidate_settings: changedSettings, checkpoint
  });
  assert.equal(resumed.checkpoint_resume.status, "CARRIED_UNAFFECTED");
  assert.deepEqual(resumed.checkpoint_resume.stale_control_ids, [observedBanana.control_id]);
  assert.equal(resumed.controls.find((row) => row.control_id === observedBanana.control_id)?.status, "STALE");
  assert.equal(resumed.controls.find((row) => row.control_id === observedSeedream.control_id)?.status, "UNSUPPORTED");
});

test("public source-hash drift invalidates per-control evidence even when normalized setting keys are unchanged", async () => {
  const publicSnapshot = loadPublicCatalogVersion(PUBLIC_VERSION);
  const baselineSettings = loadMaplessSettingsInventoryVersion(SETTINGS_VERSION);
  const baselinePlan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot, candidate_public: publicSnapshot,
    baseline_settings: baselineSettings, candidate_settings: baselineSettings
  });
  const modulePath = "../src/application/syntx-maintenance-control-walk.js";
  const api = await import(modulePath) as {
    buildSyntxMaintenanceControlWalk(input: { audit_plan: typeof baselinePlan; baseline_settings: typeof baselineSettings;
      candidate_settings: typeof baselineSettings; checkpoint?: unknown }): {
        controls: readonly Record<string, unknown>[];
        checkpoint_template: { schema_version: "1.0.0"; source_identity: object; observations: readonly object[] };
        checkpoint_resume: { status: string; carried_observation_count: number; stale_control_ids: readonly string[] };
      };
  };
  const initial = api.buildSyntxMaintenanceControlWalk({ audit_plan: baselinePlan,
    baseline_settings: baselineSettings, candidate_settings: baselineSettings });
  const row = initial.controls.find((item) => item.model_id === "banana-2.1" && item.control_key === "model_type")!;
  const checkpoint = { ...initial.checkpoint_template, observations: [
    { control_id: row.control_id, fingerprint: row.fingerprint, status: "OBSERVED" }
  ] };
  const changedPublic = buildSyntxPublicCatalogSnapshot({
    aiPayload: publicSnapshot.ai.map((item) => ({ ...item, label: item.label + " revised" })),
    llmModelsPayload: { count: publicSnapshot.llm_models.length, models: publicSnapshot.llm_models },
    modelsPayload: publicSnapshot.models,
    fetchedAt: publicSnapshot.fetched_at
  });
  const changedPublicVersion = `sha256-${createHash("sha256").update(serializeSyntxPublicCatalogSnapshot(changedPublic), "utf8").digest("hex")}.json`;
  const changedSettings = structuredClone(baselineSettings);
  changedSettings.public_catalog.version = changedPublicVersion;
  const changedPlan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot, candidate_public: changedPublic,
    baseline_settings: baselineSettings, candidate_settings: changedSettings
  });
  const resumed = api.buildSyntxMaintenanceControlWalk({ audit_plan: changedPlan,
    baseline_settings: baselineSettings, candidate_settings: changedSettings, checkpoint });
  assert.equal(resumed.checkpoint_resume.status, "SOURCE_CHANGED_RESET");
  assert.deepEqual(resumed.checkpoint_resume.stale_control_ids, [row.control_id]);
  assert.equal(resumed.controls.find((item) => item.control_id === row.control_id)?.status, "STALE");
});

test("unsafe keys are counted without echo and unmapped models remain in the census as gaps", async () => {
  const publicSnapshot = loadPublicCatalogVersion(PUBLIC_VERSION);
  const settings = structuredClone(loadMaplessSettingsInventoryVersion(SETTINGS_VERSION));
  const form = settings.forms.find((item) => item.form_id === "banana")!;
  form.javascript.model_value_settings_keys.push("session_token");
  for (const model of settings.models.filter((item) => item.form_id === "banana")) {
    model.model_value_settings_keys.push("session_token");
    model.unknown_reasons.push("CONTROL_CONSTRAINTS_NOT_IN_PUBLIC_SETTINGS");
  }
  const plan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot, candidate_public: publicSnapshot,
    baseline_settings: settings, candidate_settings: settings
  });
  const modulePath = "../src/application/syntx-maintenance-control-walk.js";
  const api = await import(modulePath) as {
    buildSyntxMaintenanceControlWalk(input: { audit_plan: typeof plan; baseline_settings: typeof settings; candidate_settings: typeof settings; checkpoint?: unknown }): {
      controls: readonly Record<string, unknown>[];
      models: readonly { model_id: string | null; gaps: readonly { code: string; count: number }[] }[];
    };
  };
  const walk = api.buildSyntxMaintenanceControlWalk({ audit_plan: plan, baseline_settings: settings, candidate_settings: settings });
  const banana = walk.models.find((entry) => entry.model_id === "banana-2.1")!;
  assert.deepEqual(banana.gaps.find((gap) => gap.code === "UNSAFE_CONTROL_KEY"), { code: "UNSAFE_CONTROL_KEY", count: 1 });
  assert.equal(walk.controls.some((entry) => entry.control_key === "session_token"), false);
  assert.equal(JSON.stringify(walk).includes("session_token"), false);
  const unmapped = walk.models.find((entry) => entry.model_id === "audio2text");
  assert.ok(unmapped);
  assert.ok(unmapped.gaps.some((gap) => gap.code === "FORM_BINDING_UNKNOWN"));
  assert.ok(unmapped.gaps.some((gap) => gap.code === "PUBLIC_SETTINGS_UNKNOWN"));
});

test("form-only control defaults enter the walk even when the model settings-key list is unchanged", async () => {
  const publicSnapshot = loadPublicCatalogVersion(PUBLIC_VERSION);
  const settings = structuredClone(loadMaplessSettingsInventoryVersion(SETTINGS_VERSION));
  const model = settings.models.find((item) => item.model_id === "banana-2.1")!;
  const previousModelKeys = [...model.model_value_settings_keys];
  const form = settings.forms.find((item) => item.form_id === "banana")!;
  form.javascript.static_setting_defaults.form_only_control = "private-default-value";
  const plan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot, candidate_public: publicSnapshot,
    baseline_settings: settings, candidate_settings: settings
  });
  const modulePath = "../src/application/syntx-maintenance-control-walk.js";
  const api = await import(modulePath) as {
    buildSyntxMaintenanceControlWalk(input: { audit_plan: typeof plan; baseline_settings: typeof settings; candidate_settings: typeof settings; checkpoint?: unknown }): {
      controls: readonly Record<string, unknown>[];
      checkpoint_template: { source_identity: object; observations: readonly object[] };
    };
  };
  const walk = api.buildSyntxMaintenanceControlWalk({ audit_plan: plan, baseline_settings: settings, candidate_settings: settings });
  const control = walk.controls.find((item) => item.model_id === "banana-2.1" && item.control_key === "form_only_control");
  assert.deepEqual(model.model_value_settings_keys, previousModelKeys);
  assert.deepEqual(control?.origins, ["STATIC_DEFAULT"]);
  assert.equal(JSON.stringify(control).includes("private-default-value"), false);

  const checkpoint = {
    ...walk.checkpoint_template,
    observations: [{ control_id: control?.control_id, fingerprint: control?.fingerprint, status: "OBSERVED" }]
  };
  const changedSettings = structuredClone(settings);
  changedSettings.forms.find((item) => item.form_id === "banana")!.javascript.static_setting_defaults.form_only_control = "changed-private-default";
  const changedPlan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot, candidate_public: publicSnapshot,
    baseline_settings: settings, candidate_settings: changedSettings
  });
  const changedWalk = api.buildSyntxMaintenanceControlWalk({
    audit_plan: changedPlan, baseline_settings: settings, candidate_settings: changedSettings, checkpoint
  });
  const stale = changedWalk.controls.find((item) => item.control_id === control?.control_id);
  assert.notEqual(stale?.fingerprint, control?.fingerprint);
  assert.equal(stale?.status, "STALE");
  assert.equal(JSON.stringify(stale).includes("changed-private-default"), false);
});

test("control checkpoint rejects foreign, malformed, duplicated, account, and hostile observations", async () => {
  const publicSnapshot = loadPublicCatalogVersion(PUBLIC_VERSION);
  const settings = loadMaplessSettingsInventoryVersion(SETTINGS_VERSION);
  const plan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot, candidate_public: publicSnapshot,
    baseline_settings: settings, candidate_settings: settings
  });
  const modulePath = "../src/application/syntx-maintenance-control-walk.js";
  const api = await import(modulePath) as {
    buildSyntxMaintenanceControlWalk(input: { audit_plan: typeof plan; baseline_settings: typeof settings;
      candidate_settings: typeof settings; checkpoint?: unknown }): unknown;
  };
  const input = { audit_plan: plan, baseline_settings: settings, candidate_settings: settings };
  const walk = api.buildSyntxMaintenanceControlWalk(input) as {
    checkpoint_template: { source_identity: Record<string, unknown>; observations: readonly Record<string, unknown>[] };
    controls: readonly Record<string, unknown>[];
  };
  const control = walk.controls.find((row) => row.model_id === "banana-2.1" && row.control_key === "model_type")!;
  const validObservation = { control_id: control.control_id, fingerprint: control.fingerprint, status: "OBSERVED" };
  const template = walk.checkpoint_template;
  const foreignIdentity = { ...template.source_identity, public_version: `sha256-${"f".repeat(64)}.json`, public_hash: `sha256:${"f".repeat(64)}` };
  const malformed: readonly [unknown, string][] = [
    [{ ...template, source_identity: foreignIdentity, observations: [validObservation] }, "CHECKPOINT_SOURCE_MISMATCH"],
    [{ ...template, observations: [{ ...validObservation, notes: "private note" }] }, "UNSAFE_CHECKPOINT"],
    [{ ...template, account_id: "private-account", observations: [validObservation] }, "UNSAFE_CHECKPOINT"],
    [{ ...template, observations: [{ ...validObservation, status: "BLOCKED_BY_PLAN" }] }, "UNSAFE_CHECKPOINT"],
    [{ ...template, observations: [{ ...validObservation, control_id: `ctl_${"0".repeat(32)}` }] }, "UNSAFE_CHECKPOINT"],
    [{ ...template, observations: [{ ...validObservation, fingerprint: "sha256-not-a-hash" }] }, "UNSAFE_CHECKPOINT"],
    [{ ...template, observations: [validObservation, validObservation] }, "UNSAFE_CHECKPOINT"]
  ];
  for (const [checkpoint, code] of malformed) {
    assert.throws(() => api.buildSyntxMaintenanceControlWalk({ ...input, checkpoint }), { code });
  }
  const tooManyObservations = Array.from({ length: 4_001 }, (_, index) => ({
    control_id: "ctl_" + index.toString(16).padStart(32, "0"),
    fingerprint: "sha256:" + "a".repeat(64),
    status: "OBSERVED"
  }));
  assert.throws(() => api.buildSyntxMaintenanceControlWalk({ ...input,
    checkpoint: { ...template, observations: tooManyObservations } }), { code: "CONTROL_CHECKPOINT_LIMIT_EXCEEDED" });
  const sparse: unknown[] = [];
  sparse.length = 1;
  assert.throws(() => api.buildSyntxMaintenanceControlWalk({ ...input, checkpoint: { ...template, observations: sparse } }),
    { code: "UNSAFE_CHECKPOINT" });
  let getterReads = 0;
  const hostile = Object.create(null);
  Object.defineProperties(hostile, {
    schema_version: { value: "1.0.0", enumerable: true },
    source_identity: { get() { getterReads += 1; throw new Error("private data"); }, enumerable: true },
    observations: { value: [], enumerable: true }
  });
  assert.throws(() => api.buildSyntxMaintenanceControlWalk({ ...input, checkpoint: hostile }), { code: "UNSAFE_CHECKPOINT" });
  assert.throws(() => api.buildSyntxMaintenanceControlWalk({ ...input, checkpoint: new Proxy({}, { get() { getterReads += 1; throw new Error("trap"); } }) }),
    { code: "UNSAFE_CHECKPOINT" });
  assert.equal(getterReads, 0);
});

test("candidate control census above four thousand remains complete and checkpoint-ready", async () => {
  const publicSnapshot = loadPublicCatalogVersion(PUBLIC_VERSION);
  const settings = structuredClone(loadMaplessSettingsInventoryVersion(SETTINGS_VERSION));
  const form = settings.forms.find((item) => item.form_id === "banana")!;
  for (let index = 0; index < 400; index += 1) {
    form.javascript.static_setting_defaults["form_default_" + String(index).padStart(4, "0")] = "value";
  }
  const plan = buildSyntxMaintenanceAuditPlan({
    baseline_public: publicSnapshot, candidate_public: publicSnapshot,
    baseline_settings: settings, candidate_settings: settings
  });
  const modulePath = "../src/application/syntx-maintenance-control-walk.js";
  const api = await import(modulePath) as {
    buildSyntxMaintenanceControlWalk(input: { audit_plan: typeof plan; baseline_settings: typeof settings; candidate_settings: typeof settings }): unknown;
  };
  const walk = api.buildSyntxMaintenanceControlWalk({
    audit_plan: plan, baseline_settings: settings, candidate_settings: settings
  }) as { controls: readonly Record<string, unknown>[]; checkpoint_template: { observations: readonly unknown[] } };
  assert.ok(walk.controls.length > 4_000);
  const lastAdded = walk.controls.find((control) => control.model_id === "banana-2.1" && control.control_key === "form_default_0399");
  assert.ok(lastAdded, "the highest indexed candidate control is not dropped at the checkpoint limit");
  assert.equal(lastAdded.status, "NOT_VISITED");
  assert.ok(walk.checkpoint_template.observations.length <= 4_000);
});

test("malicious frozen audit-plan getters are rejected before nested property access", async () => {
  const settings = loadMaplessSettingsInventoryVersion(SETTINGS_VERSION);
  const modulePath = "../src/application/syntx-maintenance-control-walk.js";
  const api = await import(modulePath) as {
    buildSyntxMaintenanceControlWalk(input: { audit_plan: unknown; baseline_settings: typeof settings; candidate_settings: typeof settings }): unknown;
  };
  let getterReads = 0;
  const hostilePlan = Object.create(null);
  Object.defineProperty(hostilePlan, "census", {
    get() { getterReads += 1; throw new Error("sensitive audit-plan payload"); }, enumerable: true
  });
  Object.freeze(hostilePlan);
  assert.throws(() => api.buildSyntxMaintenanceControlWalk({
    audit_plan: hostilePlan, baseline_settings: settings, candidate_settings: settings
  }), { code: "INVALID_INPUT" });
  assert.equal(getterReads, 0);
});
